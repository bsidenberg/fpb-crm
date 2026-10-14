import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  zonedTimeToUtc,
  formatOffsetIso,
  openSlots,
  pickAssignee,
  outlookAttendees,
  slotFitsWorkingHours,
  DEFAULT_WEEKLY_HOURS,
} from './bookingSlots.js'

const hours = DEFAULT_WEEKLY_HOURS

function member(partial) {
  return {
    active: true,
    timezone: 'America/New_York',
    call_minutes: 30,
    buffer_minutes: 0,
    min_notice_minutes: 0,
    weekly_hours: hours,
    ...partial,
  }
}

const mathew = member({
  id: 'mathew',
  email: 'mathew@floridapolebarn.com',
  display_name: 'Mathew',
  role: 'primary',
  notify_all: false,
})

const brian = member({
  id: 'brian',
  email: 'brian@floridapolebarn.com',
  display_name: 'Brian Sidenberg',
  role: 'backup',
  notify_all: true,
})

test('9:30 AM ET is UTC-4 in October and UTC-5 in December', () => {
  const oct = zonedTimeToUtc(2026, 10, 13, 9, 30)
  assert.equal(oct.toISOString(), '2026-10-13T13:30:00.000Z')
  assert.equal(formatOffsetIso(oct), '2026-10-13T09:30:00-04:00')
  const dec = zonedTimeToUtc(2026, 12, 15, 9, 30)
  assert.equal(dec.toISOString(), '2026-12-15T14:30:00.000Z')
  assert.equal(formatOffsetIso(dec), '2026-12-15T09:30:00-05:00')
})

test('a weekday offers 16 half-hour slots from 8:30 to 4:00 when either member is free', () => {
  const rangeStart = zonedTimeToUtc(2026, 10, 13, 0, 0)
  const rangeEnd = zonedTimeToUtc(2026, 10, 14, 0, 0)
  const { slotMinutes, slots } = openSlots({
    members: [brian, mathew],
    rangeStart,
    rangeEnd,
    now: zonedTimeToUtc(2026, 10, 1, 9, 0),
  })
  assert.equal(slotMinutes, 30)
  assert.equal(slots.length, 16)
  assert.equal(formatOffsetIso(slots[0].start), '2026-10-13T08:30:00-04:00')
  assert.equal(formatOffsetIso(slots[0].end), '2026-10-13T09:00:00-04:00')
  assert.equal(formatOffsetIso(slots[15].start), '2026-10-13T16:00:00-04:00')
  assert.equal(slots[0].available_count, 2)
  assert.equal(slots.every(s => s.available_count === 2), true)
})

function thirtyMinuteSlot(year, month, day, hour, minute) {
  const start = zonedTimeToUtc(year, month, day, hour, minute)
  return { start, end: new Date(start.getTime() + 30 * 60 * 1000) }
}

test('8:30 and 4:00 are bookable; 4:30, 3:33, and Saturday are rejected', () => {
  const tuesday = mathew
  const at830 = thirtyMinuteSlot(2026, 10, 13, 8, 30)
  const at400 = thirtyMinuteSlot(2026, 10, 13, 16, 0)
  const at430 = thirtyMinuteSlot(2026, 10, 13, 16, 30)
  const at333 = thirtyMinuteSlot(2026, 10, 13, 15, 33)
  const saturday = thirtyMinuteSlot(2026, 10, 17, 8, 30)
  assert.equal(slotFitsWorkingHours(tuesday, at830.start, at830.end), true)
  assert.equal(slotFitsWorkingHours(tuesday, at400.start, at400.end), true)
  assert.equal(slotFitsWorkingHours(tuesday, at430.start, at430.end), false)
  assert.equal(slotFitsWorkingHours(tuesday, at333.start, at333.end), false)
  assert.equal(slotFitsWorkingHours(tuesday, saturday.start, saturday.end), false)

  const openSaturday = member({
    ...mathew,
    weekly_hours: { ...hours, sat: [['08:30', '16:30']] },
  })
  assert.equal(slotFitsWorkingHours(openSaturday, saturday.start, saturday.end), false)

  const rangeStart = zonedTimeToUtc(2026, 10, 13, 0, 0)
  const rangeEnd = zonedTimeToUtc(2026, 10, 14, 0, 0)
  const { slots } = openSlots({
    members: [mathew],
    rangeStart,
    rangeEnd,
    now: zonedTimeToUtc(2026, 10, 1, 8, 0),
  })
  const labels = slots.map(s => formatOffsetIso(s.start))
  assert.equal(labels.includes('2026-10-13T08:30:00-04:00'), true)
  assert.equal(labels.includes('2026-10-13T16:00:00-04:00'), true)
  assert.equal(labels.includes('2026-10-13T16:30:00-04:00'), false)
  assert.equal(labels.some(label => label.includes('T15:33')), false)
})

test('weekends and times outside 8:30–4:30 are closed', () => {
  const rangeStart = zonedTimeToUtc(2026, 10, 17, 0, 0) // Saturday
  const rangeEnd = zonedTimeToUtc(2026, 10, 19, 0, 0) // Monday
  const { slots } = openSlots({
    members: [mathew, brian],
    rangeStart,
    rangeEnd,
    now: zonedTimeToUtc(2026, 10, 1, 9, 0),
  })
  assert.equal(slots.length, 0)
})

test('Mathew is assigned whenever he is free; Brian only when Mathew is busy', () => {
  assert.equal(pickAssignee([brian, mathew]).id, 'mathew')
  assert.equal(pickAssignee([brian]).id, 'brian')
  assert.equal(pickAssignee([]), null)

  const rangeStart = zonedTimeToUtc(2026, 10, 13, 9, 0)
  const rangeEnd = zonedTimeToUtc(2026, 10, 13, 11, 0)
  const blocked = openSlots({
    members: [mathew, brian],
    appointments: [{
      team_member_id: 'mathew',
      status: 'scheduled',
      starts_at: zonedTimeToUtc(2026, 10, 13, 9, 30).toISOString(),
      ends_at: zonedTimeToUtc(2026, 10, 13, 10, 0).toISOString(),
    }],
    rangeStart,
    rangeEnd,
    now: zonedTimeToUtc(2026, 10, 1, 9, 0),
  })
  const nineThirty = blocked.slots.find(s => formatOffsetIso(s.start) === '2026-10-13T09:30:00-04:00')
  const ten = blocked.slots.find(s => formatOffsetIso(s.start) === '2026-10-13T10:00:00-04:00')
  assert.deepEqual(nineThirty.free_member_ids, ['brian'])
  assert.equal(pickAssignee(nineThirty.free_member_ids.map(id => (id === 'brian' ? brian : mathew))).id, 'brian')
  assert.equal(ten.available_count, 2)
  assert.equal(pickAssignee([mathew, brian]).email, 'mathew@floridapolebarn.com')
})

test('a slot disappears only when both members are busy', () => {
  const start = zonedTimeToUtc(2026, 10, 13, 9, 30)
  const end = zonedTimeToUtc(2026, 10, 13, 10, 0)
  const { slots } = openSlots({
    members: [mathew, brian],
    appointments: [
      { team_member_id: 'mathew', status: 'scheduled', starts_at: start.toISOString(), ends_at: end.toISOString() },
      { team_member_id: 'brian', status: 'scheduled', starts_at: start.toISOString(), ends_at: end.toISOString() },
    ],
    blocks: [{
      team_member_id: 'brian',
      starts_at: zonedTimeToUtc(2026, 10, 13, 10, 0).toISOString(),
      ends_at: zonedTimeToUtc(2026, 10, 13, 10, 30).toISOString(),
    }],
    busyByMember: {
      mathew: [{ start: zonedTimeToUtc(2026, 10, 13, 10, 0).toISOString(), end: zonedTimeToUtc(2026, 10, 13, 10, 30).toISOString() }],
    },
    rangeStart: zonedTimeToUtc(2026, 10, 13, 9, 0),
    rangeEnd: zonedTimeToUtc(2026, 10, 13, 11, 0),
    now: zonedTimeToUtc(2026, 10, 1, 9, 0),
  })
  const labels = slots.map(s => formatOffsetIso(s.start))
  assert.equal(labels.includes('2026-10-13T09:30:00-04:00'), false)
  assert.equal(labels.includes('2026-10-13T10:00:00-04:00'), false)
  assert.equal(labels.includes('2026-10-13T10:30:00-04:00'), true)
})

test('buffer after a call blocks the next slot for that member only', () => {
  const buffered = member({ ...mathew, buffer_minutes: 15 })
  const { slots } = openSlots({
    members: [buffered, brian],
    appointments: [{
      team_member_id: 'mathew',
      status: 'scheduled',
      starts_at: zonedTimeToUtc(2026, 10, 13, 9, 30).toISOString(),
      ends_at: zonedTimeToUtc(2026, 10, 13, 10, 0).toISOString(),
    }],
    rangeStart: zonedTimeToUtc(2026, 10, 13, 9, 30),
    rangeEnd: zonedTimeToUtc(2026, 10, 13, 10, 30),
    now: zonedTimeToUtc(2026, 10, 1, 9, 0),
  })
  const ten = slots.find(s => formatOffsetIso(s.start) === '2026-10-13T10:00:00-04:00')
  assert.deepEqual(ten.free_member_ids, ['brian'])
})

test('minimum notice hides slots that start too soon', () => {
  const { slots } = openSlots({
    members: [member({ ...mathew, min_notice_minutes: 60 }), member({ ...brian, min_notice_minutes: 60 })],
    rangeStart: zonedTimeToUtc(2026, 10, 13, 9, 0),
    rangeEnd: zonedTimeToUtc(2026, 10, 13, 12, 0),
    now: zonedTimeToUtc(2026, 10, 13, 9, 0),
  })
  assert.equal(slots.some(s => formatOffsetIso(s.start) === '2026-10-13T09:30:00-04:00'), false)
  assert.equal(slots.some(s => formatOffsetIso(s.start) === '2026-10-13T10:00:00-04:00'), true)
})

test('Brian is an optional attendee on Mathew’s event, and not on his own', () => {
  const onMathew = outlookAttendees({
    members: [mathew, brian],
    assignee: mathew,
    customer: { email: 'sam@example.com', name: 'Sam Rivera' },
    customerInvite: true,
  })
  assert.deepEqual(onMathew.map(a => [a.emailAddress.address, a.type]), [
    ['sam@example.com', 'required'],
    ['brian@floridapolebarn.com', 'optional'],
  ])

  const onBrian = outlookAttendees({
    members: [mathew, brian],
    assignee: brian,
    customer: { email: 'sam@example.com', name: 'Sam Rivera' },
    customerInvite: false,
  })
  assert.deepEqual(onBrian, [])
})
