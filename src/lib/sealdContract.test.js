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
} from './sealdContract.js'

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
