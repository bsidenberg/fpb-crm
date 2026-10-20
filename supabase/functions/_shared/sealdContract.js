// SEALD request/webhook parsing. Header names are not final; the edge function
// reads them from env. This module is the pure contract: payload shape, the
// signed string, timestamp freshness, and how intake maps onto a lead.

export const DEFAULT_API_KEY_HEADER = 'x-api-key'
export const DEFAULT_IDEMPOTENCY_HEADER = 'idempotency-key'
export const DEFAULT_SIGNATURE_HEADER = 'x-seald-signature'
export const DEFAULT_TIMESTAMP_HEADER = 'x-seald-timestamp'
export const DEFAULT_SIGNED_TEMPLATE = '{timestamp}.{body}'
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000
export const BOOKING_SOURCE = 'Booking Agent'
// Final SEALD contract (bsidenberg/seald docs/integrations/booking-webhook.md).
export const SEALD_SIGNATURE_HEADER = 'seald-signature'
export const SEALD_IDEMPOTENCY_HEADER = 'seald-idempotency-key'
export const SEALD_TOLERANCE_S = 300
export const SEALD_PAYLOAD_VERSION = 1
// Accepted webhook signature schemes, tried in order. Each is the same HMAC
// (hex sha256 of `${t}.${rawBody}`, 300 s tolerance) with its own header,
// version key, and secret env var. During a key rotation both entries exist;
// to retire a key, delete its entry. Seald-Signature-Key is informational
// only and never changes verification.
export const SEALD_SIGNATURE_SCHEMES = Object.freeze([
  Object.freeze({ header: 'seald-signature', versionKey: 'v1', secretEnv: 'SEALD_WEBHOOK_SECRET' }),
  Object.freeze({ header: 'seald-signature-next', versionKey: 'v2', secretEnv: 'SEALD_WEBHOOK_SECRET_NEXT' }),
])

/** Parse `t=<unix seconds>,v1=<hex>[,v1=<hex>]` (or another version key). */
export function parseSealdSignature(header, versionKey = 'v1') {
  let timestamp = null
  const signatures = []
  for (const part of String(header || '').split(',')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key === 't') timestamp = value
    else if (key === versionKey && value) signatures.push(value.toLowerCase())
  }
  return { timestamp, signatures }
}

/**
 * Verify Seald-Signature over `${t}.${rawBody}`. Returns null when valid, or an
 * error code: missing_signature, stale_timestamp, invalid_signature.
 */
export async function verifySealdSignature(rawBody, header, secret, nowMs = Date.now(), versionKey = 'v1') {
  if (!header) return 'missing_signature'
  if (!secret) return 'invalid_signature'
  const { timestamp, signatures } = parseSealdSignature(header, versionKey)
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return 'invalid_signature'
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SEALD_TOLERANCE_S) return 'stale_timestamp'
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
  let ok = false
  for (const sig of signatures) {
    if (/^[0-9a-f]{64}$/.test(sig) && safeEqual(sig, expected)) ok = true
  }
  return ok ? null : 'invalid_signature'
}

/**
 * Accept the request if any configured scheme verifies. getHeader(name) and
 * getSecret(envName) are lookups; a scheme whose secret is unset is skipped.
 * Returns null when valid; 'webhook_secret_not_configured' when no scheme has
 * a secret; otherwise the first error from a scheme whose header was present,
 * or 'missing_signature' when none was.
 */
export async function verifySealdSignatures(rawBody, getHeader, getSecret, nowMs = Date.now(), schemes = SEALD_SIGNATURE_SCHEMES) {
  let configured = 0
  let firstError = null
  for (const scheme of schemes) {
    const secret = getSecret(scheme.secretEnv) || ''
    if (!secret) continue
    configured += 1
    const header = getHeader(scheme.header) || ''
    if (!header) continue
    const err = await verifySealdSignature(rawBody, header, secret, nowMs, scheme.versionKey)
    if (!err) return null
    if (!firstError) firstError = err
  }
  if (!configured) return 'webhook_secret_not_configured'
  return firstError || 'missing_signature'
}

export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function safeEqual(a, b) {
  const enc = new TextEncoder()
  const left = enc.encode(String(a ?? ''))
  const right = enc.encode(String(b ?? ''))
  const len = Math.max(left.length, right.length, 1)
  let out = left.length === right.length ? 0 : 1
  for (let i = 0; i < len; i += 1) out |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return out === 0
}

export function headerLookup(headers, name) {
  if (!headers || !name) return ''
  const want = name.toLowerCase()
  if (typeof headers.get === 'function') {
    const direct = headers.get(name)
    if (direct) return String(direct).trim()
    const lower = headers.get(want)
    if (lower) return String(lower).trim()
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return String(value ?? '').trim()
  }
  return ''
}

export function signedPayload(template, timestamp, rawBody) {
  const pattern = template || DEFAULT_SIGNED_TEMPLATE
  return pattern.replaceAll('{timestamp}', timestamp).replaceAll('{body}', rawBody)
}

export function parseSignatureHeader(value) {
  const raw = String(value || '').trim()
  const hex = raw.replace(/^sha256=/i, '').trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return ''
  return hex
}

export function parseTimestampMs(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    // 10 digits is seconds; 13 is milliseconds. Anything shorter is seconds.
    return raw.length >= 13 ? n : n * 1000
  }
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return null
  return parsed
}

export function timestampSkewError(value, now = Date.now()) {
  const ms = parseTimestampMs(value, now)
  if (ms == null) return 'missing_or_invalid_timestamp'
  if (Math.abs(now - ms) > MAX_TIMESTAMP_SKEW_MS) return 'stale_timestamp'
  return null
}

export function splitName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return { first_name: 'Unknown', last_name: '—', name: '' }
  const parts = cleaned.split(' ')
  if (parts.length === 1) return { first_name: parts[0], last_name: '—', name: cleaned }
  return { first_name: parts[0], last_name: parts.slice(1).join(' '), name: cleaned }
}

function text(value) {
  if (value == null) return ''
  return String(value).trim()
}

function nested(body, key) {
  const value = body?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// business / brand / source_agent are objects in v1 ({id, name}); older shapes were strings.
function label(value) {
  if (value && typeof value === 'object') return text(value.name || value.id)
  return text(value)
}

// v1 intake is { answers: [{key, value}] }; flatten to an object.
function answersObject(intake) {
  const out = {}
  const list = Array.isArray(intake?.answers) ? intake.answers : []
  for (const item of list) {
    if (item && typeof item === 'object' && item.key) out[String(item.key)] = item.value
  }
  return out
}

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'FLORIDA',
])
const ZIP_RE = /^\d{5}(?:-\d{4})?$/
const COUNTRY_RE = /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?)$/i
const UNIT_RE = /^(?:apt|apartment|unit|suite|ste|#|bldg|building|lot|trlr|room|rm)\b\.?/i

/** True for a street line such as "8425 A D Mims Rd" or "PO Box 120386". */
export function looksLikeStreet(value) {
  const v = text(value)
  if (!v) return false
  if (/^p\.?\s*o\.?\s*box\b/i.test(v)) return true
  return /^\d+[a-z]?(?:-\d+)?\s+\S/i.test(v)
}

function stripStateZip(part) {
  let words = text(part).split(/\s+/).filter(Boolean)
  if (words.length && ZIP_RE.test(words[words.length - 1])) words = words.slice(0, -1)
  if (words.length && US_STATES.has(words[words.length - 1].replace(/\.$/, '').toUpperCase())) {
    words = words.slice(0, -1)
  }
  return words.join(' ')
}

function cleanCity(value) {
  const v = text(value)
  if (!v) return ''
  if (/\d/.test(v)) return ''
  if (/\bcounty\b/i.test(v)) return ''
  if (US_STATES.has(v.replace(/\.$/, '').toUpperCase())) return ''
  if (!/^[a-z][a-z .'-]*$/i.test(v)) return ''
  return v
}

/**
 * City from a one-line street address: "123 Main St, Orlando, FL 32801" and
 * "PO Box 1, Clermont FL 34712" give the city. Without a comma after the
 * street ("8425 A D Mims Rd") there is no reliable city, so return ''.
 */
export function cityFromAddress(address) {
  const parts = text(address).split(',').map(p => p.trim()).filter(Boolean)
  while (parts.length && COUNTRY_RE.test(parts[parts.length - 1])) parts.pop()
  if (parts.length < 2) return ''
  let rest = parts.slice(1)
  while (rest.length && UNIT_RE.test(rest[0])) rest = rest.slice(1)
  if (!rest.length) return ''
  return cleanCity(stripStateZip(rest[0]))
}

/**
 * City from a free-text location answer that is not a street: "Clermont, FL",
 * "Clermont FL 34711", "Clermont". ZIP-only and county answers give ''.
 */
export function cityFromLocation(location) {
  const v = text(location)
  if (!v || looksLikeStreet(v)) return ''
  const first = v.split(',')[0]
  return cleanCity(stripStateZip(first))
}

/**
 * Accept the booking POST body and the webhook body, which share fields.
 * service_type on the appointment is the consultation. It is not copied onto
 * leads.service_type (that column is Kit Delivery / Kit + Installation).
 */
export function normalizeBookingBody(body) {
  const src = body && typeof body === 'object' ? body : {}
  const customer = { ...nested(src, 'customer') }
  const intakeObj = nested(src, 'intake')
  const schedule = nested(src, 'schedule')
  const service = nested(src, 'service')
  const record = nested(src, 'record')
  const answers = answersObject(intakeObj)
  const intake = { ...intakeObj, ...nested(src, 'answers'), ...answers }
  const name = text(customer.name || src.customer_name || src.name)
  const email = text(customer.email || src.customer_email || src.email).toLowerCase()
  const phone = text(customer.phone || src.customer_phone || src.phone)
  const who = splitName(name)
  const buildingType = text(intake.building_type || intake.buildingType || intake.project_type || src.building_type)
  const size = text(intake.size || intake.barn_size || src.size)
  const location = text(intake.location || intake.county_or_zip || src.location)
  const timeline = text(intake.timeline || src.timeline)
  const serviceAddress = text(
    intake.service_address || intake.serviceAddress || intake.address || intake.street_address ||
      src.service_address || src.serviceAddress || src.address || customer.address,
  )
  const address = serviceAddress || (looksLikeStreet(location) ? location : '')
  const city = cleanCity(text(intake.city || src.city || customer.city)) ||
    cityFromAddress(address) ||
    cityFromLocation(location)
  return {
    bookingId: text(src.booking_id || src.appointment_id || src.bookingId),
    idempotencyKey: text(src.idempotency_key || src.idempotencyKey),
    signedRecordId: text(record.id || src.signed_record_id || src.signedRecordId),
    verificationUrl: text(record.verification_url || src.verification_url || src.verificationUrl),
    eventId: text(src.id || src.event_id || src.eventId),
    version: src.v == null ? null : Number(src.v),
    test: src.test === true,
    deposit: src.deposit && typeof src.deposit === 'object' ? src.deposit : null,
    eventType: text(src.type || src.event_type).toLowerCase(),
    status: text(src.status).toLowerCase(),
    serviceType: text(service.type || src.service_type || src.serviceType) || 'consultation_call',
    business: label(src.business),
    brand: label(src.brand),
    sourceAgent: label(src.source_agent || src.sourceAgent || src.agent),
    start: text(schedule.start || src.start || src.starts_at),
    end: text(schedule.end || src.end || src.ends_at),
    timezone: text(schedule.timezone || src.timezone) || 'America/New_York',
    customerInvite: src.customer_invite === false || src.customerInvite === false ? false : true,
    customer: {
      name: who.name || name,
      first_name: text(customer.first_name) || who.first_name,
      last_name: text(customer.last_name) || who.last_name,
      email,
      phone,
    },
    intake: {
      building_type: buildingType,
      size,
      location,
      timeline,
      address,
      city,
      description: text(intake.description),
    },
  }
}

export function statusFromEvent(parsed) {
  const type = parsed.eventType
  if (type === 'booking.cancelled' || type === 'booking.canceled') return 'cancelled'
  const status = parsed.status
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'
  if (['completed', 'complete'].includes(status)) return 'completed'
  if (['no_show', 'no-show', 'noshow'].includes(status)) return 'no_show'
  if (type === 'booking.updated' || type === 'booking.rescheduled' || status === 'rescheduled') {
    return 'rescheduled'
  }
  return 'scheduled'
}

const MARKER_PREFIX = '[booked-call:'

export function noteMarker(parsed) {
  return `${MARKER_PREFIX}${parsed.signedRecordId || parsed.idempotencyKey || parsed.eventId || 'new'}]`
}

export function intakeNote(parsed, whenLabel) {
  const lines = [
    noteMarker(parsed),
    `Booked consultation${whenLabel ? ` ${whenLabel}` : ''}`,
    parsed.sourceAgent ? `Source agent: ${parsed.sourceAgent}` : '',
    parsed.serviceType ? `Service: ${parsed.serviceType}` : '',
    parsed.business ? `Business: ${parsed.business}` : '',
    parsed.brand ? `Brand: ${parsed.brand}` : '',
    parsed.intake.building_type ? `Building type: ${parsed.intake.building_type}` : '',
    parsed.intake.size ? `Size: ${parsed.intake.size}` : '',
    parsed.intake.location ? `Location: ${parsed.intake.location}` : '',
    parsed.intake.timeline ? `Timeline: ${parsed.intake.timeline}` : '',
    parsed.intake.description ? `Description: ${parsed.intake.description}` : '',
    parsed.signedRecordId ? `Signed record: ${parsed.signedRecordId}` : '',
    parsed.verificationUrl ? `Verification: ${parsed.verificationUrl}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function blank(value) {
  return value == null || String(value).trim() === ''
}

/**
 * Fields written onto a lead. Every booking, including a match on an
 * existing lead, sets stage to 'new' and booked_call. lead_source becomes
 * Booking Agent only when it is blank. Never includes stage_changed_at or
 * quote_sent_at (the database function stamps stage_changed_at when the
 * stage actually changes). Does not overwrite a rep's existing kit/building
 * fields. consultation_call stays on the appointment, not leads.service_type.
 */
export function planLeadWrite(existing, parsed, { owner, whenLabel } = {}) {
  const note = intakeNote(parsed, whenLabel)
  const marker = noteMarker(parsed)
  const create = !existing
  const patch = { booked_call: true, stage: 'new' }
  const fill = (column, value) => {
    if (blank(value)) return
    if (create || blank(existing[column])) patch[column] = value
  }
  fill('building_type', parsed.intake.building_type)
  fill('barn_size', parsed.intake.size)
  fill('timeline', parsed.intake.timeline)
  fill('city', parsed.intake.city)
  fill('address', parsed.intake.address)
  fill('email', parsed.customer.email)
  fill('phone', parsed.customer.phone)
  fill('owner', owner)
  if (create || blank(existing.source)) patch.source = BOOKING_SOURCE
  if (create || blank(existing.lead_source)) patch.lead_source = BOOKING_SOURCE
  if (create) {
    patch.first_name = parsed.customer.first_name
    patch.last_name = parsed.customer.last_name
    patch.priority = 'warm'
    patch.notes = note
  } else {
    const prior = existing.notes || ''
    if (!prior.includes(marker)) {
      patch.notes = `${prior}${prior ? '\n\n' : ''}${note}`
    }
  }
  return patch
}
