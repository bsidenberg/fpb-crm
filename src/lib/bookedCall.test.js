import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookedCallPresentation, pickDisplayAppointment } from './bookedCall.js'

const now = new Date('2026-10-13T16:00:00.000Z')

test('upcoming, rescheduled, outcome, completed, no-show, and cancelled labels', () => {
  const upcoming = bookedCallPresentation({
    status: 'scheduled',
    starts_at: '2026-10-14T18:00:00.000Z',
    ends_at: '2026-10-14T18:30:00.000Z',
    reschedule_count: 0,
  }, now)
  assert.equal(upcoming.key, 'booked')
  assert.equal(upcoming.label, 'Call booked')
  assert.match(upcoming.when, /Oct 14/)
  assert.match(upcoming.when, /2:00/)

  const moved = bookedCallPresentation({
    status: 'scheduled',
    starts_at: '2026-10-15T14:00:00.000Z',
    ends_at: '2026-10-15T14:30:00.000Z',
    reschedule_count: 1,
  }, now)
  assert.equal(moved.label, 'Rescheduled')

  const late = bookedCallPresentation({
    status: 'scheduled',
    starts_at: '2026-10-13T14:00:00.000Z',
    ends_at: '2026-10-13T14:30:00.000Z',
  }, now)
  assert.equal(late.label, 'Outcome needed')

  assert.equal(bookedCallPresentation({ status: 'completed', starts_at: '2026-10-08T14:00:00.000Z', ends_at: '2026-10-08T14:30:00.000Z' }, now).label, 'Call completed')
  assert.equal(bookedCallPresentation({ status: 'no_show', starts_at: '2026-10-08T15:00:00.000Z', ends_at: '2026-10-08T15:30:00.000Z' }, now).label, 'No-show')
  assert.equal(bookedCallPresentation({ status: 'cancelled', starts_at: '2026-10-08T16:00:00.000Z', ends_at: '2026-10-08T16:30:00.000Z' }, now).label, 'Call cancelled')
  assert.equal(bookedCallPresentation(null), null)
})

test('the tile prefers the next upcoming call over an older one', () => {
  const picked = pickDisplayAppointment([
    { id: 'old', status: 'completed', starts_at: '2026-10-01T14:00:00.000Z', ends_at: '2026-10-01T14:30:00.000Z' },
    { id: 'later', status: 'scheduled', starts_at: '2026-10-20T14:00:00.000Z', ends_at: '2026-10-20T14:30:00.000Z' },
    { id: 'soon', status: 'scheduled', starts_at: '2026-10-14T14:00:00.000Z', ends_at: '2026-10-14T14:30:00.000Z' },
  ], now)
  assert.equal(picked.id, 'soon')
})
