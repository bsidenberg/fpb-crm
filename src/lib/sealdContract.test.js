import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  signedPayload,
  parseSignatureHeader,
  timestampSkewError,
  normalizeBookingBody,
  statusFromEvent,
  planLeadWrite,
  splitName,
  parseSealdSignature,
  verifySealdSignature,
  verifySealdSignatures,
  hmacSha256Hex,
  looksLikeStreet,
  cityFromAddress,
  cityFromLocation,
} from './sealdContract.js'
import { readFileSync } from 'node:fs'


test('signed payload joins timestamp and the raw body with the configured template', () => {
  assert.equal(signedPayload('{timestamp}.{body}', '1700000000', '{"a":1}'), '1700000000.{"a":1}')
  assert.equal(signedPayload('{timestamp}{body}', '1700000000', 'raw'), '1700000000raw')
  assert.equal(parseSignatureHeader('sha256=ABCD'), 'abcd')
  assert.equal(parseSignatureHeader('not-hex'), '')
})

test('timestamps older than five minutes are rejected', () => {
  const now = Date.parse('2026-10-13T15:00:00.000Z')
  assert.equal(timestampSkewError(String(Math.floor(now / 1000) - 60), now), null)
  assert.equal(timestampSkewError(String(Math.floor(now / 1000) - 6 * 60), now), 'stale_timestamp')
  assert.equal(timestampSkewError(new Date(now + 6 * 60 * 1000).toISOString(), now), 'stale_timestamp')
  assert.equal(timestampSkewError(String(now - 60 * 1000), now), null)
  assert.equal(timestampSkewError('', now), 'missing_or_invalid_timestamp')
})

test('webhook and booking bodies normalize to the same customer and intake', () => {
  const parsed = normalizeBookingBody({
    event_id: 'evt_1',
    type: 'booking.created',
    business: 'Florida Pole Barn',
    brand: 'FPB',
    service_type: 'consultation_call',
    start: '2026-10-14T18:00:00.000Z',
    end: '2026-10-14T18:30:00.000Z',
    timezone: 'America/New_York',
    customer: { name: 'Sam Rivera', phone: '(352) 555-0100', email: 'Sam@Example.com' },
    intake: { building_type: 'Enclosed Pole Barn', size: '30x40', location: 'Clermont, FL', timeline: '1-3 Months' },
    source_agent: 'seald-voice',
    signed_record_id: 'sig_9',
    verification_url: 'https://seald.example/v/sig_9',
    status: 'confirmed',
  })
  assert.equal(parsed.customer.email, 'sam@example.com')
  assert.deepEqual(splitName('Sam Rivera'), { first_name: 'Sam', last_name: 'Rivera', name: 'Sam Rivera' })
  assert.equal(parsed.intake.city, 'Clermont')
  assert.equal(parsed.intake.size, '30x40')
  assert.equal(statusFromEvent(parsed), 'scheduled')
  assert.equal(statusFromEvent({ ...parsed, eventType: 'booking.cancelled' }), 'cancelled')
  assert.equal(statusFromEvent({ ...parsed, eventType: 'booking.updated' }), 'rescheduled')
})

test('lead writes flag the booked call, fill empty intake fields, and return every lead to new', () => {
  const parsed = normalizeBookingBody({
    signed_record_id: 'sig_9',
    customer: { name: 'Sam', email: 'sam@example.com', phone: '3525550100' },
    intake: { building_type: 'Open Pole Barn', size: '24x30', location: 'Clermont, FL', timeline: 'Just Looking' },
    service_type: 'consultation_call',
    source_agent: 'seald-voice',
  })
  const created = planLeadWrite(null, parsed, { owner: 'Mathew', whenLabel: 'Oct 14' })
  assert.equal(created.booked_call, true)
  assert.equal(created.stage, 'new')
  assert.equal(created.source, 'Booking Agent')
  assert.equal(created.building_type, 'Open Pole Barn')
  assert.equal(created.barn_size, '24x30')
  assert.equal(created.city, 'Clermont')
  assert.equal(created.timeline, 'Just Looking')
  assert.equal(created.owner, 'Mathew')
  assert.equal(created.last_name, '—')
  assert.equal(Object.hasOwn(created, 'quote_sent_at'), false)
  assert.equal(Object.hasOwn(created, 'service_type'), false)
  assert.match(created.notes, /consultation_call/)
  assert.match(created.notes, /sig_9/)

  const existing = planLeadWrite({
    source: 'Google Ads',
    building_type: 'Enclosed Pole Barn',
    barn_size: '40x60',
    city: 'Groveland',
    timeline: '',
    notes: 'Spoke yesterday',
    stage: 'estimate_sent',
    quote_sent_at: '2026-10-01T12:00:00.000Z',
  }, parsed, { owner: 'Mathew' })
  assert.equal(existing.source, undefined)
  assert.equal(existing.lead_source, 'Booking Agent')
  assert.equal(existing.building_type, undefined)
  assert.equal(existing.barn_size, undefined)
  assert.equal(existing.city, undefined)
  assert.equal(existing.timeline, 'Just Looking')
  assert.equal(existing.stage, 'new')
  assert.equal(existing.booked_call, true)
  assert.equal(Object.hasOwn(existing, 'quote_sent_at'), false)
  assert.equal(Object.hasOwn(existing, 'stage_changed_at'), false)
  assert.match(existing.notes, /Spoke yesterday/)
  assert.match(existing.notes, /\[booked-call:sig_9\]/)

  const kept = planLeadWrite({
    source: 'Google Ads',
    lead_source: 'Referral',
    stage: 'won',
    notes: 'Spoke yesterday',
  }, parsed, { owner: 'Mathew' })
  assert.equal(kept.source, undefined)
  assert.equal(kept.lead_source, undefined)
  assert.equal(kept.stage, 'new')

  const again = planLeadWrite({ notes: existing.notes, source: 'Google Ads', lead_source: 'Google Ads' }, parsed, { owner: 'Mathew' })
  assert.equal(again.notes, undefined)
  assert.equal(again.lead_source, undefined)
  assert.equal(again.stage, 'new')
})

const EXAMPLE_RAW = readFileSync(new URL('./sealdWebhookExample.json', import.meta.url), 'utf8')
const EXAMPLE_SIG = 't=1791898205,v1=836190a331eae5fca11eef82a6720b6abe6bb2235dec82da3ae383c9aa15d943'
const EXAMPLE_NOW = 1791898205 * 1000

test('SEALD worked example verifies with Seald-Signature', async () => {
  assert.deepEqual(parseSealdSignature(EXAMPLE_SIG).timestamp, '1791898205')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, EXAMPLE_SIG, 'example-signing-secret', EXAMPLE_NOW), null)
})

test('SEALD signature rejects bad sig, wrong secret, re-serialized body, stale ts, missing header', async () => {
  const bad = EXAMPLE_SIG.replace(/.$/, '0')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, bad, 'example-signing-secret', EXAMPLE_NOW), 'invalid_signature')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, EXAMPLE_SIG, 'other', EXAMPLE_NOW), 'invalid_signature')
  assert.equal(await verifySealdSignature(JSON.stringify(JSON.parse(EXAMPLE_RAW)), EXAMPLE_SIG, 'example-signing-secret', EXAMPLE_NOW), 'invalid_signature')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, EXAMPLE_SIG, 'example-signing-secret', EXAMPLE_NOW + 301_000), 'stale_timestamp')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, EXAMPLE_SIG, 'example-signing-secret', EXAMPLE_NOW - 299_000), null)
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, '', 'example-signing-secret', EXAMPLE_NOW), 'missing_signature')
  assert.equal(await verifySealdSignature(EXAMPLE_RAW, 't=abc,v1=00', 'example-signing-secret', EXAMPLE_NOW), 'invalid_signature')
})

test('v1 payload normalizes schedule, service, record, intake answers, and object labels', () => {
  const p = normalizeBookingBody(JSON.parse(EXAMPLE_RAW))
  assert.equal(p.version, 1)
  assert.equal(p.eventId, 'evt_fsc_consult_created_example')
  assert.equal(p.eventType, 'booking.created')
  assert.equal(p.test, false)
  assert.equal(p.deposit, null)
  assert.equal(p.serviceType, 'consultation_call')
  assert.equal(p.start, '2026-10-13T09:30:00-04:00')
  assert.equal(p.end, '2026-10-13T10:00:00-04:00')
  assert.equal(p.business, 'Florida Pole Barn Builders LLC')
  assert.equal(p.brand, 'Florida Security Concepts')
  assert.equal(p.sourceAgent, 'FSC booking agent')
  assert.equal(p.signedRecordId, 'a'.repeat(64))
  assert.match(p.verificationUrl, /verify/)
  assert.equal(p.intake.building_type, 'security system')
  assert.equal(p.intake.location, '34711')
  assert.equal(p.intake.description, 'Alarm for a new pole barn office.')
  assert.equal(p.customer.first_name, 'Casey')
  assert.equal(normalizeBookingBody({ ...JSON.parse(EXAMPLE_RAW), test: true }).test, true)
})

test('rotation: accepts Seald-Signature v1 (old key) or Seald-Signature-Next v2 (new key)', async () => {
  const OLD = 'example-signing-secret'
  const NEW = 'next-signing-secret'
  const t = String(EXAMPLE_NOW / 1000)
  const v2 = await hmacSha256Hex(NEW, `${t}.${EXAMPLE_RAW}`)
  const env = (both = true) => name => ({ SEALD_WEBHOOK_SECRET: OLD, SEALD_WEBHOOK_SECRET_NEXT: both ? NEW : '' })[name] || ''
  const hdr = obj => name => obj[name] || ''
  const run = (h, e = env()) => verifySealdSignatures(EXAMPLE_RAW, hdr(h), e, EXAMPLE_NOW)

  // v1 path unchanged
  assert.equal(await run({ 'seald-signature': EXAMPLE_SIG }), null)
  assert.equal(await run({ 'seald-signature': EXAMPLE_SIG }, env(false)), null)
  // v2 path, with or without Seald-Signature-Key
  assert.equal(await run({ 'seald-signature-next': `t=${t},v2=${v2}` }), null)
  assert.equal(await run({ 'seald-signature-next': `t=${t},v2=${v2}`, 'seald-signature-key': 'v1' }), null)
  // either one valid is enough
  assert.equal(await run({ 'seald-signature': `t=${t},v1=${'0'.repeat(64)}`, 'seald-signature-next': `t=${t},v2=${v2}` }), null)
  assert.equal(await run({ 'seald-signature': EXAMPLE_SIG, 'seald-signature-next': `t=${t},v2=${'0'.repeat(64)}` }), null)
  // v2 header must use v2 key, and the new secret
  assert.equal(await run({ 'seald-signature-next': `t=${t},v1=${v2}` }), 'invalid_signature')
  assert.equal(await run({ 'seald-signature-next': `t=${t},v2=${'0'.repeat(64)}` }), 'invalid_signature')
  assert.equal(await run({ 'seald-signature-next': EXAMPLE_SIG.replace('v1=', 'v2=') }), 'invalid_signature')
  // a new-key signature in the old header is rejected
  assert.equal(await run({ 'seald-signature': `t=${t},v1=${v2}` }), 'invalid_signature')
  // NEXT unset: v2 path skipped
  assert.equal(await run({ 'seald-signature-next': `t=${t},v2=${v2}` }, env(false)), 'missing_signature')
  // stale v2, missing everything, nothing configured
  const stale = await verifySealdSignatures(EXAMPLE_RAW, hdr({ 'seald-signature-next': `t=${t},v2=${v2}` }), env(), EXAMPLE_NOW + 301_000)
  assert.equal(stale, 'stale_timestamp')
  assert.equal(await run({}), 'missing_signature')
  assert.equal(await run({ 'seald-signature-key': 'v1' }), 'missing_signature')
  assert.equal(await run({ 'seald-signature': EXAMPLE_SIG }, () => ''), 'webhook_secret_not_configured')
  // after the old key is dropped (only NEXT set), v1 is refused
  const nextOnly = name => (name === 'SEALD_WEBHOOK_SECRET_NEXT' ? NEW : '')
  assert.equal(await run({ 'seald-signature': EXAMPLE_SIG }, nextOnly), 'missing_signature')
  assert.equal(await run({ 'seald-signature-next': `t=${t},v2=${v2}` }, nextOnly), null)
})

test('cityFromAddress parses the city from a one-line street address', () => {
  assert.equal(cityFromAddress('123 Main St, Orlando, FL 32801'), 'Orlando')
  assert.equal(cityFromAddress('PO Box 120386, Clermont FL 34712'), 'Clermont')
  assert.equal(cityFromAddress('100 Demo Drive, Clermont FL 34711'), 'Clermont')
  assert.equal(cityFromAddress('55 Oak Ave, Apt 4, Winter Garden, FL'), 'Winter Garden')
  assert.equal(cityFromAddress('9 Elm St, Lake Mary, Florida 32746, USA'), 'Lake Mary')
  assert.equal(cityFromAddress('12 Pine Rd, Mount Dora'), 'Mount Dora')
  // No comma after the street, or only state/ZIP after it: no guess.
  assert.equal(cityFromAddress('8425 A D MIMS RD'), '')
  assert.equal(cityFromAddress('8425 A D Mims Rd Orlando FL 32818'), '')
  assert.equal(cityFromAddress('1 Main St, FL 32801'), '')
  assert.equal(cityFromAddress('1 Main St, 32801'), '')
  assert.equal(cityFromAddress(''), '')
  assert.equal(cityFromAddress(null), '')
})

test('cityFromLocation keeps city answers and rejects streets, ZIPs and counties', () => {
  assert.equal(cityFromLocation('Clermont, FL'), 'Clermont')
  assert.equal(cityFromLocation('Clermont FL 34711'), 'Clermont')
  assert.equal(cityFromLocation('Clermont'), 'Clermont')
  assert.equal(cityFromLocation('34711'), '')
  assert.equal(cityFromLocation('Lake County FL'), '')
  assert.equal(cityFromLocation('9237 Halsey Dr'), '')
  assert.equal(cityFromLocation('8425 A D MIMS RD'), '')
  assert.equal(looksLikeStreet('PO Box 5'), true)
  assert.equal(looksLikeStreet('34711'), false)
  assert.equal(looksLikeStreet('Clermont, FL'), false)
})

test('booking with a street in location/service_address: street goes to address, city stays clean', () => {
  // Shape of a real Booqer booking.created payload (answers list + top-level service_address).
  const body = {
    v: 1,
    type: 'booking.created',
    customer: { name: 'Pat Doe', email: 'pat@example.com', phone: '4075550100' },
    intake: {
      answers: [
        { key: 'size', value: '30x80x12' },
        { key: 'location', value: '8425 A D MIMS RD' },
        { key: 'service_address', value: '8425 A D MIMS RD' },
      ],
    },
    service_address: '8425 A D MIMS RD',
  }
  const p = normalizeBookingBody(body)
  assert.equal(p.intake.address, '8425 A D MIMS RD')
  assert.equal(p.intake.city, '')
  const created = planLeadWrite(null, p)
  assert.equal(created.address, '8425 A D MIMS RD')
  assert.equal(created.city, undefined)

  const full = normalizeBookingBody({
    ...body,
    intake: { answers: [{ key: 'location', value: 'clermont' }, { key: 'service_address', value: '100 Demo Drive, Clermont FL 34711' }] },
    service_address: '100 Demo Drive, Clermont FL 34711',
  })
  assert.equal(full.intake.address, '100 Demo Drive, Clermont FL 34711')
  assert.equal(full.intake.city, 'Clermont')

  // Street only in location (older payloads): address gets it, city is not the street.
  const old = normalizeBookingBody({ ...body, intake: { answers: [{ key: 'location', value: '9237 Halsey Dr' }] }, service_address: undefined })
  assert.equal(old.intake.address, '9237 Halsey Dr')
  assert.equal(old.intake.city, '')

  // A structured city wins over parsing.
  const structured = normalizeBookingBody({ ...body, intake: { city: 'Orlando', service_address: '8425 A D MIMS RD' } })
  assert.equal(structured.intake.city, 'Orlando')
  assert.equal(structured.intake.address, '8425 A D MIMS RD')
})

test('existing lead keeps its address and city; blank address is filled', () => {
  const p = normalizeBookingBody({ intake: { service_address: '123 Main St, Orlando, FL 32801' } })
  const keep = planLeadWrite({ id: 'x', city: 'Ocoee', address: '1 Old Rd', notes: '' }, p)
  assert.equal(keep.city, undefined)
  assert.equal(keep.address, undefined)
  const fillIn = planLeadWrite({ id: 'x', city: '', address: null, notes: '' }, p)
  assert.equal(fillIn.city, 'Orlando')
  assert.equal(fillIn.address, '123 Main St, Orlando, FL 32801')
})
