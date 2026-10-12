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
  return value && typeof value === 'object' ? value : {}
}

/**
 * Accept the booking POST body and the webhook body, which share fields.
 * service_type on the appointment is the consultation. It is not copied onto
 * leads.service_type (that column is Kit Delivery / Kit + Installation).
 */
export function normalizeBookingBody(body) {
  const src = body && typeof body === 'object' ? body : {}
  const customer = { ...nested(src, 'customer') }
  const intake = { ...nested(src, 'intake'), ...nested(src, 'answers') }
  const name = text(customer.name || src.customer_name || src.name)
  const email = text(customer.email || src.customer_email || src.email).toLowerCase()
  const phone = text(customer.phone || src.customer_phone || src.phone)
  const who = splitName(name)
  const buildingType = text(intake.building_type || intake.buildingType || src.building_type)
  const size = text(intake.size || intake.barn_size || src.size)
  const location = text(intake.location || src.location)
  const timeline = text(intake.timeline || src.timeline)
  const city = location.includes(',') ? text(location.split(',')[0]) : location
  return {
    bookingId: text(src.booking_id || src.appointment_id || src.bookingId),
    idempotencyKey: text(src.idempotency_key || src.idempotencyKey),
    signedRecordId: text(src.signed_record_id || src.signedRecordId),
    verificationUrl: text(src.verification_url || src.verificationUrl),
    eventId: text(src.event_id || src.eventId),
    eventType: text(src.type || src.event_type).toLowerCase(),
    status: text(src.status).toLowerCase(),
    serviceType: text(src.service_type || src.serviceType) || 'consultation_call',
    business: text(src.business),
    brand: text(src.brand),
    sourceAgent: text(src.source_agent || src.sourceAgent || src.agent),
    start: text(src.start || src.starts_at),
    end: text(src.end || src.ends_at),
    timezone: text(src.timezone) || 'America/New_York',
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
      city,
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
    parsed.signedRecordId ? `Signed record: ${parsed.signedRecordId}` : '',
    parsed.verificationUrl ? `Verification: ${parsed.verificationUrl}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function blank(value) {
  return value == null || String(value).trim() === ''
}

/**
 * Fields written onto a lead. Never includes stage, stage_changed_at, or
 * quote_sent_at. Does not overwrite a rep's existing kit/building fields.
 * consultation_call stays on the appointment, not leads.service_type.
 */
export function planLeadWrite(existing, parsed, { owner, whenLabel } = {}) {
  const note = intakeNote(parsed, whenLabel)
  const marker = noteMarker(parsed)
  const create = !existing
  const patch = { booked_call: true }
  const fill = (column, value) => {
    if (blank(value)) return
    if (create || blank(existing[column])) patch[column] = value
  }
  fill('building_type', parsed.intake.building_type)
  fill('barn_size', parsed.intake.size)
  fill('timeline', parsed.intake.timeline)
  fill('city', parsed.intake.city)
  fill('email', parsed.customer.email)
  fill('phone', parsed.customer.phone)
  fill('owner', owner)
  if (create || blank(existing.source)) {
    patch.source = BOOKING_SOURCE
    patch.lead_source = BOOKING_SOURCE
  }
  if (create) {
    patch.first_name = parsed.customer.first_name
    patch.last_name = parsed.customer.last_name
    patch.stage = 'new'
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
