import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareColumnLeads } from './boardOrder.js'

const lead = (id, extra) => ({ id, stage: 'new', created_at: '2020-01-01T00:00:00.000Z', ...extra })

test('booked calls sort above older and newer unbooked leads', () => {
  const rows = [
    lead('old', { stage_changed_at: '2024-01-01T00:00:00.000Z' }),
    lead('fresh', { stage_changed_at: '2026-10-14T00:00:00.000Z' }),
    lead('booked', {
      booked_call: true,
      created_at: '2019-05-01T00:00:00.000Z',
      updated_at: '2026-10-13T12:00:00.000Z',
      appointment: { starts_at: '2026-10-16T18:00:00.000Z' },
    }),
  ]
  const ordered = [...rows].sort(compareColumnLeads).map(row => row.id)
  assert.deepEqual(ordered, ['booked', 'old', 'fresh'])
})

test('booked calls order by latest appointment, then updated time', () => {
  const rows = [
    lead('soon', {
      booked_call: true,
      appointment: { starts_at: '2026-10-14T14:00:00.000Z' },
      updated_at: '2026-10-14T12:00:00.000Z',
    }),
    lead('later', {
      booked_call: true,
      appointment: { starts_at: '2026-10-20T14:00:00.000Z' },
      updated_at: '2026-10-01T12:00:00.000Z',
    }),
    lead('no-appt', {
      booked_call: true,
      updated_at: '2026-10-18T12:00:00.000Z',
    }),
  ]
  const ordered = [...rows].sort(compareColumnLeads).map(row => row.id)
  assert.deepEqual(ordered, ['later', 'no-appt', 'soon'])
})

test('unbooked leads stay oldest in the column first', () => {
  const rows = [
    lead('b', { stage_changed_at: '2026-02-01T00:00:00.000Z', booked_call: false }),
    lead('a', { stage_changed_at: '2025-02-01T00:00:00.000Z' }),
  ]
  assert.deepEqual([...rows].sort(compareColumnLeads).map(row => row.id), ['a', 'b'])
})
