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

function firstText(...values) {
  for (const value of values) {
    const cleaned = text(value)
    if (cleaned) return cleaned
  }
  return ''
}

function firstLabel(...values) {
  for (const value of values) {
    const cleaned = label(value)
    if (cleaned) return cleaned
  }
  return ''
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
  const attribution = nested(src, 'attribution')
  const utm = { ...nested(attribution, 'utm'), ...nested(src, 'utm') }
  const asNote = value => (typeof value === 'string' || typeof value === 'number') ? text(value) : ''
  const customerNotes = [...new Set([
    asNote(intake.notes),
    asNote(intake.customer_notes || intake.customerNotes),
    asNote(intake.description),
    asNote(src.notes),
    asNote(customer.notes),
  ].filter(Boolean))].join('\n')
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
    channel: firstLabel(src.channel, attribution.channel, intake.channel),
    assistant: firstLabel(src.assistant, attribution.assistant, intake.assistant),
    sourceLabel: firstLabel(
      src.source_label, src.sourceLabel, attribution.source_label, attribution.sourceLabel, intake.source_label,
    ),
    referrerHost: firstText(src.referrer_host, src.referrerHost, attribution.referrer_host, intake.referrer_host),
    referrerUrl: firstText(src.referrer_url, src.referrerUrl, attribution.referrer_url, intake.referrer_url),
    landingPage: firstText(
      src.landing_page, src.landingPage, src.landing_url, src.landingUrl, src.landing,
      attribution.landing_page, attribution.landing_url, attribution.landing, intake.landing_page,
    ),
    consentSource: firstText(
      src.consent_source, src.consentSource, attribution.consent_source, customer.consent_source, intake.consent_source,
    ),
    utmSource: firstText(src.utm_source, src.utmSource, utm.source, utm.utm_source, attribution.utm_source, intake.utm_source),
    utmMedium: firstText(src.utm_medium, src.utmMedium, utm.medium, utm.utm_medium, attribution.utm_medium, intake.utm_medium),
    utmCampaign: firstText(src.utm_campaign, src.utmCampaign, utm.campaign, utm.utm_campaign, attribution.utm_campaign, intake.utm_campaign),
    utmTerm: firstText(src.utm_term, src.utmTerm, utm.term, utm.utm_term, attribution.utm_term, intake.utm_term),
    utmContent: firstText(src.utm_content, src.utmContent, utm.content, utm.utm_content, attribution.utm_content, intake.utm_content),
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
      notes: customerNotes,
      channel: firstLabel(src.channel, attribution.channel, intake.channel),
      assistant: firstLabel(src.assistant, attribution.assistant, intake.assistant),
      source_label: firstLabel(
        src.source_label, src.sourceLabel, attribution.source_label, attribution.sourceLabel, intake.source_label,
      ),
      referrer_host: firstText(src.referrer_host, src.referrerHost, attribution.referrer_host, intake.referrer_host),
      consent_source: firstText(
        src.consent_source, src.consentSource, attribution.consent_source, customer.consent_source, intake.consent_source,
      ),
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
const MARKER_RE = /\[booked-call:[^\]]+\]/g

const SERVICE_LABELS = {
  consultation_call: 'Project consultation',
}

const CONSENT_LABELS = {
  web: 'Website',
  website: 'Website',
  mcp: 'AI assistant',
  api: 'API',
}

export function noteMarker(parsed) {
  return `${MARKER_PREFIX}${parsed.signedRecordId || parsed.idempotencyKey || parsed.eventId || 'new'}]`
}

export function bookingServiceLabel(serviceType) {
  const key = text(serviceType)
  if (!key || SERVICE_LABELS[key]) return SERVICE_LABELS[key] || 'Project consultation'
  return key.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, char => char.toUpperCase())
}

/**
 * Lead source written for a booking. Booqer's source_label wins. Otherwise
 * "Booqer", plus consent_source when that field is present.
 */
export function bookingLeadSource(parsed) {
  const label = text(parsed?.sourceLabel)
  if (label) return label
  const consent = text(parsed?.consentSource)
  if (!consent) return 'Booqer'
  const mapped = CONSENT_LABELS[consent.toLowerCase()]
  return `Booqer: ${mapped || consent}`
}

/** referrer_url, or https:// plus referrer_host when only the host was sent. */
export function bookingReferrerUrl(parsed) {
  const url = text(parsed?.referrerUrl)
  if (url) return url
  const host = text(parsed?.referrerHost)
  if (!host) return ''
  if (/^https?:\/\//i.test(host)) return host
  return `https://${host.replace(/^\/+/, '')}`
}

export function intakeNote(parsed, whenLabel, options = {}) {
  const withName = text(options.withName || options.owner || '')
  const when = text(whenLabel)
  const whenLine = [when, withName ? `with ${withName}` : ''].filter(Boolean).join(' ')
  const customer = [parsed.customer?.name, parsed.customer?.phone, parsed.customer?.email].map(text).filter(Boolean)
  const notes = text(parsed.intake?.notes)
  const lines = [
    `Booqer booking: ${bookingServiceLabel(parsed.serviceType)}`,
    whenLine,
    customer.length ? `Customer: ${customer.join(', ')}` : '',
    parsed.intake?.size ? `Project size: ${parsed.intake.size}` : '',
    parsed.intake?.location ? `Location: ${parsed.intake.location}` : '',
    notes ? `Notes: ${notes}` : '',
    `Source: ${bookingLeadSource(parsed)}`,
    parsed.verificationUrl ? `View booking: ${parsed.verificationUrl}` : '',
    // Hidden from the shop. SQL and planLeadWrite match this exact string,
    // including notes that already store it in plain text.
    `<!-- ${noteMarker(parsed)} -->`,
  ].filter(Boolean)
  return lines.join('\n')
}

/** Marker tokens already stored on a note, in first-seen order. */
export function bookingMarkers(value) {
  const found = []
  const re = new RegExp(MARKER_RE.source, 'g')
  let match
  const source = String(value ?? '')
  while ((match = re.exec(source))) {
    if (!found.includes(match[0])) found.push(match[0])
  }
  return found
}

/**
 * Shop-facing note. Drops the dedupe marker (plain line or HTML comment)
 * and the booking lines that are not job details. Rep notes that are not
 * a booked-call entry are left alone, aside from a bare marker line.
 */
export function shopVisibleNote(value) {
  const raw = String(value ?? '')
  const booking = raw.includes(MARKER_PREFIX)
  const withoutComment = raw.replace(/[ \t]*<!--\s*\[booked-call:[^\]]*\]\s*-->[ \t]*/g, '')
  const lines = withoutComment.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (/^\[booked-call:[^\]]+\]$/.test(trimmed)) return []
    if (!booking) return [line]
    if (/^(?:service|business|brand|signed record|source agent):/i.test(trimmed)) return []
    let next = line.replace(/^(\s*)Verification:/i, '$1View booking:')
    next = next.replace(/^(\s*)Size:/i, '$1Project size:')
    return [next]
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Keep dedupe markers when a rep edits the visible note text. */
export function retainBookingMarkers(stored, visible) {
  let next = String(visible ?? '').replace(/\s+$/, '')
  for (const marker of bookingMarkers(stored)) {
    if (!next.includes(marker)) next = `${next}${next ? '\n' : ''}<!-- ${marker} -->`
  }
  return next
}

function blank(value) {
  return value == null || String(value).trim() === ''
}

/**
 * Fields written onto a lead. Every booking, including a match on an
 * existing lead, sets stage to 'new' and booked_call. source and
 * lead_source become the Booqer attribution label only when blank.
 * referrer, landing page, and UTM fields fill the same way. Never includes
 * stage_changed_at or quote_sent_at (the database function stamps
 * stage_changed_at when the stage actually changes). Does not overwrite a
 * rep's existing kit/building fields. consultation_call stays on the
 * appointment, not leads.service_type.
 */
export function planLeadWrite(existing, parsed, { owner, whenLabel } = {}) {
  const note = intakeNote(parsed, whenLabel, { withName: owner })
  const marker = noteMarker(parsed)
  const create = !existing
  const patch = { booked_call: true, stage: 'new' }
  const leadSource = bookingLeadSource(parsed)
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
  fill('referrer_url', bookingReferrerUrl(parsed))
  fill('landing_page', parsed.landingPage)
  fill('utm_source', parsed.utmSource)
  fill('utm_medium', parsed.utmMedium)
  fill('utm_campaign', parsed.utmCampaign)
  fill('utm_term', parsed.utmTerm)
  fill('utm_content', parsed.utmContent)
  if (create || blank(existing.source)) patch.source = leadSource
  if (create || blank(existing.lead_source)) patch.lead_source = leadSource
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
