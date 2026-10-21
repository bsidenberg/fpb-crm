import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  signedPayload,
  parseSignatureHeader,
  timestampSkewError,
  normalizeBookingBody,
  statusFromEvent,
  planLeadWrite,
  intakeNote,
  bookingLeadSource,
  shopVisibleNote,
  retainBookingMarkers,
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
import { calendarInviteContent } from '../../supabase/functions/_shared/calendarInvite.js'


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
  assert.equal(created.source, 'Booqer')
  assert.equal(created.lead_source, 'Booqer')
  assert.equal(created.building_type, 'Open Pole Barn')
  assert.equal(created.barn_size, '24x30')
  assert.equal(created.city, 'Clermont')
  assert.equal(created.timeline, 'Just Looking')
  assert.equal(created.owner, 'Mathew')
  assert.equal(created.last_name, '—')
  assert.equal(Object.hasOwn(created, 'quote_sent_at'), false)
  assert.equal(Object.hasOwn(created, 'service_type'), false)
  assert.match(created.notes, /Booqer booking: Project consultation/)
  assert.match(created.notes, /Oct 14 with Mathew/)
  assert.match(created.notes, /Customer: Sam, 3525550100, sam@example.com/)
  assert.match(created.notes, /Project size: 24x30/)
  assert.match(created.notes, /Source: Booqer/)
  assert.match(created.notes, /<!-- \[booked-call:sig_9\] -->/)
  assert.doesNotMatch(created.notes, /consultation_call/)
  assert.doesNotMatch(created.notes, /Signed record/)
  assert.doesNotMatch(created.notes, /seald-voice/)
  assert.doesNotMatch(created.notes, /^\[booked-call:/m)
  assert.equal(shopVisibleNote(created.notes).includes('booked-call'), false)

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
  assert.equal(existing.lead_source, 'Booqer')
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

  const legacy = planLeadWrite({
    source: 'Google Ads',
    lead_source: 'Google Ads',
    notes: '[booked-call:sig_9]\nBooked consultation Oct 14\nSigned record: sig_9',
  }, parsed, { owner: 'Mathew' })
  assert.equal(legacy.notes, undefined)

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

test('shop note hides the dedupe marker and the lines that are not job details', () => {
  const legacy = [
    '[booked-call:abc]',
    'Booked consultation Wed, Oct 21, 1:30 PM EDT',
    'Service: consultation_call',
    'Business: Florida Pole Barn Builders LLC',
    'Brand: Florida Pole Barn',
    'Size: 16 X 37 Aprox.',
    'Location: 4290 5Th St SW',
    'Signed record: abc',
    'Verification: https://booqer.ai/v/abc',
  ].join('\n')
  assert.equal(shopVisibleNote(legacy), [
    'Booked consultation Wed, Oct 21, 1:30 PM EDT',
    'Project size: 16 X 37 Aprox.',
    'Location: 4290 5Th St SW',
    'View booking: https://booqer.ai/v/abc',
  ].join('\n'))
  assert.equal(shopVisibleNote('Spoke yesterday'), 'Spoke yesterday')
  const edited = retainBookingMarkers(legacy, 'Spoke yesterday')
  assert.match(edited, /<!-- \[booked-call:abc\] -->/)
  assert.equal(shopVisibleNote(edited), 'Spoke yesterday')
})

test('attribution label, consent fallback, and UTM fields fill blank lead columns', () => {
  const labeled = normalizeBookingBody({
    signed_record_id: 'sig_attr',
    source_label: 'Booqer: Website, referred by floridapolebarn.com',
    channel: 'website',
    assistant: 'ChatGPT',
    consent_source: 'web',
    referrer_host: 'floridapolebarn.com',
    referrer_url: 'https://floridapolebarn.com/pole-barns',
    landing_page: 'https://floridapolebarn.com/quote',
    utm_source: 'chatgpt',
    utm_medium: 'ai',
    utm_campaign: 'spring',
    utm_term: 'pole barn',
    utm_content: 'card',
    customer: { name: 'Josh', phone: '772-766-2433', email: 'josh@infocrg.com' },
    intake: { size: '16 x 37 approx.', location: '4290 5th St SW', notes: 'Gate code 1234' },
    verification_url: 'https://booqer.ai/shops/florida-pole-barn/requests/30e',
    service_type: 'consultation_call',
    business: 'Florida Pole Barn Builders LLC',
    brand: 'Florida Pole Barn',
  })
  assert.equal(labeled.channel, 'website')
  assert.equal(labeled.assistant, 'ChatGPT')
  assert.equal(bookingLeadSource(labeled), 'Booqer: Website, referred by floridapolebarn.com')
  const note = intakeNote(labeled, 'Wed, Oct 21, 1:30 PM EDT', { withName: 'Mathew' })
  assert.equal(note, [
    'Booqer booking: Project consultation',
    'Wed, Oct 21, 1:30 PM EDT with Mathew',
    'Customer: Josh, 772-766-2433, josh@infocrg.com',
    'Project size: 16 x 37 approx.',
    'Location: 4290 5th St SW',
    'Notes: Gate code 1234',
    'Source: Booqer: Website, referred by floridapolebarn.com',
    'View booking: https://booqer.ai/shops/florida-pole-barn/requests/30e',
    '<!-- [booked-call:sig_attr] -->',
  ].join('\n'))
  assert.doesNotMatch(note, /Florida Pole Barn Builders/)
  assert.doesNotMatch(note, /SEALD/i)

  const created = planLeadWrite(null, labeled, { owner: 'Mathew', whenLabel: 'Wed, Oct 21, 1:30 PM EDT' })
  assert.equal(created.source, 'Booqer: Website, referred by floridapolebarn.com')
  assert.equal(created.lead_source, 'Booqer: Website, referred by floridapolebarn.com')
  assert.equal(created.referrer_url, 'https://floridapolebarn.com/pole-barns')
  assert.equal(created.landing_page, 'https://floridapolebarn.com/quote')
  assert.equal(created.utm_source, 'chatgpt')
  assert.equal(created.utm_medium, 'ai')
  assert.equal(created.utm_campaign, 'spring')
  assert.equal(created.utm_term, 'pole barn')
  assert.equal(created.utm_content, 'card')

  const kept = planLeadWrite({
    source: 'Google Ads',
    lead_source: 'Google Ads',
    utm_source: 'google',
    referrer_url: 'https://google.com',
    notes: '',
  }, labeled, { owner: 'Mathew' })
  assert.equal(kept.source, undefined)
  assert.equal(kept.lead_source, undefined)
  assert.equal(kept.utm_source, undefined)
  assert.equal(kept.referrer_url, undefined)
  assert.equal(kept.utm_medium, 'ai')
  assert.equal(kept.landing_page, 'https://floridapolebarn.com/quote')

  const web = normalizeBookingBody({ consent_source: 'web', customer: { name: 'Pat' } })
  assert.equal(bookingLeadSource(web), 'Booqer: Website')
  assert.equal(bookingLeadSource(normalizeBookingBody({ consent_source: 'mcp' })), 'Booqer: AI assistant')
  assert.equal(bookingLeadSource(normalizeBookingBody({ consent_source: 'api' })), 'Booqer: API')
  assert.equal(bookingLeadSource(normalizeBookingBody({})), 'Booqer')

  const nested = normalizeBookingBody({
    attribution: {
      source_label: 'Booqer: ChatGPT',
      referrer_host: 'chatgpt.com',
      consent_source: 'mcp',
      utm: { source: 'chatgpt', medium: 'assistant' },
    },
  })
  assert.equal(bookingLeadSource(nested), 'Booqer: ChatGPT')
  assert.equal(nested.utmSource, 'chatgpt')
  assert.equal(nested.utmMedium, 'assistant')
  assert.equal(nested.consentSource, 'mcp')
  assert.equal(planLeadWrite(null, nested).referrer_url, 'https://chatgpt.com')

  const hostOnly = normalizeBookingBody({ referrer_host: 'floridapolebarn.com', channel: 'website' })
  assert.equal(hostOnly.channel, 'website')
  const hostLead = planLeadWrite(null, hostOnly)
  assert.equal(hostLead.referrer_url, 'https://floridapolebarn.com')
  assert.equal(hostLead.source, 'Booqer')
  assert.match(hostLead.notes, /Source: Booqer/)
  assert.doesNotMatch(hostLead.notes, /Source: website/)

  const partial = intakeNote(normalizeBookingBody({
    customer: { phone: '772-766-2433' },
    intake: { description: 'Call after 5' },
  }), '')
  assert.match(partial, /Customer: 772-766-2433/)
  assert.doesNotMatch(partial, /Customer: ,/)
  assert.match(partial, /Notes: Call after 5/)
  assert.doesNotMatch(partial, /Project size:/)
})

test('calendar invite keeps job details and drops the signed record and SEALD line', () => {
  const invite = calendarInviteContent({
    leadId: 'lead-1',
    name: 'Josh',
    email: 'josh@infocrg.com',
    phone: '772-766-2433',
    assignee: 'Mathew',
    intake: { size: '16 x 37 approx.', location: '4290 5th St SW', notes: 'Gate code 1234', building_type: 'Open' },
    verificationUrl: 'https://booqer.ai/records/abc',
  })
  assert.equal(invite.subject, 'FPB consultation — Josh')
  assert.match(invite.html, /Customer:/)
  assert.match(invite.html, /josh@infocrg.com/)
  assert.match(invite.html, /772-766-2433/)
  assert.match(invite.html, /With:/)
  assert.match(invite.html, /Mathew/)
  assert.match(invite.html, /Size:/)
  assert.match(invite.html, /Location:/)
  assert.match(invite.html, /Notes:/)
  assert.match(invite.html, /Gate code 1234/)
  assert.match(invite.html, /Open in FPB CRM/)
  assert.match(invite.html, /\/leads\/lead-1/)
  assert.doesNotMatch(invite.html, /Signed record/)
  assert.doesNotMatch(invite.html, /SEALD/)
  assert.doesNotMatch(invite.html, /separate reminder/)
  assert.doesNotMatch(invite.html, /Building/)
  assert.doesNotMatch(invite.html, /booqer\.ai\/records/)
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
