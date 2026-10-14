// Slot math, primary/backup assignment, and Outlook attendee list.
// Used by the CRM (via src/lib/bookingSlots.js) and the booking edge function.
// Times are stored as UTC instants. Working hours are wall-clock in the
// member's timezone (Florida Pole Barn uses America/New_York).
// Bookable window: Mon–Fri 8:30 AM–4:30 PM. Slots are 30 minutes and may
// start only on :00 or :30. The last start is 4:00 PM.

export const BUSINESS_TZ = 'America/New_York'

/** First bookable minute of the day (8:30). Calendar grid uses the same bound. */
export const BOOKING_DAY_START_MIN = 8 * 60 + 30

/** Close of the bookable day (4:30). A slot may end at this minute, not start. */
export const BOOKING_DAY_END_MIN = 16 * 60 + 30

export const DEFAULT_WEEKLY_HOURS = {
  mon: [['08:30', '16:30']],
  tue: [['08:30', '16:30']],
  wed: [['08:30', '16:30']],
  thu: [['08:30', '16:30']],
  fri: [['08:30', '16:30']],
  sat: [],
  sun: [],
}

const WEEKDAY_KEY = {
  Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
}

const ROLE_RANK = { primary: 0, backup: 1, member: 2 }

function pad(n) {
  return String(n).padStart(2, '0')
}

export function zonedParts(date, timeZone = BUSINESS_TZ) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday,
  }
}

/** Wall clock interpreted as UTC, minus the real instant. EDT is -4h. */
export function timeZoneOffsetMs(date, timeZone = BUSINESS_TZ) {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - date.getTime()
}

export function zonedTimeToUtc(year, month, day, hour, minute, timeZone = BUSINESS_TZ) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = guess - timeZoneOffsetMs(new Date(guess), timeZone)
  instant = guess - timeZoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

export function formatOffsetIso(date, timeZone = BUSINESS_TZ) {
  const p = zonedParts(date, timeZone)
  const offset = timeZoneOffsetMs(date, timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const hh = pad(Math.floor(abs / 3600000))
  const mm = pad(Math.floor((abs % 3600000) / 60000))
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${hh}:${mm}`
}

/** Graph dateTime without an offset; pair with timeZone America/New_York. */
export function formatWallClock(date, timeZone = BUSINESS_TZ) {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

/** Graph dateTime with a separate timeZone, or an ISO string that already has an offset. */
export function parseGraphDate(dateTime, timeZone = BUSINESS_TZ) {
  const raw = String(dateTime || '')
  if (!raw) return new Date(NaN)
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw)
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return new Date(raw)
  return zonedTimeToUtc(+match[1], +match[2], +match[3], +match[4], +match[5], timeZone || BUSINESS_TZ)
}

export function weekdayKey(date, timeZone = BUSINESS_TZ) {
  return WEEKDAY_KEY[zonedParts(date, timeZone).weekday] || 'sun'
}

/**
 * Hard window for a slot start, independent of a member's weekly_hours.
 * Weekdays only, 8:30 AM inclusive through 4:30 PM exclusive, minute :00 or :30.
 */
export function bookingStartAllowed(date, timeZone = BUSINESS_TZ) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false
  const p = zonedParts(date, timeZone)
  const key = WEEKDAY_KEY[p.weekday]
  if (key !== 'mon' && key !== 'tue' && key !== 'wed' && key !== 'thu' && key !== 'fri') return false
  if (p.second !== 0) return false
  if (p.minute !== 0 && p.minute !== 30) return false
  const mins = p.hour * 60 + p.minute
  return mins >= BOOKING_DAY_START_MIN && mins < BOOKING_DAY_END_MIN
}

function parseHm(value) {
  const [h, m] = String(value || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

export function slotFitsWorkingHours(member, slotStart, slotEnd) {
  if (!bookingStartAllowed(slotStart, BUSINESS_TZ)) return false
  const businessEnd = zonedParts(slotEnd, BUSINESS_TZ)
  const businessStart = zonedParts(slotStart, BUSINESS_TZ)
  if (businessStart.year !== businessEnd.year || businessStart.month !== businessEnd.month || businessStart.day !== businessEnd.day) return false
  if (businessEnd.hour * 60 + businessEnd.minute > BOOKING_DAY_END_MIN) return false

  const tz = member.timezone || BUSINESS_TZ
  const start = zonedParts(slotStart, tz)
  const end = zonedParts(new Date(slotEnd.getTime() - 1), tz)
  if (start.year !== end.year || start.month !== end.month || start.day !== end.day) return false
  const key = WEEKDAY_KEY[start.weekday]
  const hours = member.weekly_hours || DEFAULT_WEEKLY_HOURS
  const intervals = hours[key] || []
  const startMin = start.hour * 60 + start.minute
  const endSameDay = zonedParts(slotEnd, tz)
  const endMinutes = (endSameDay.year === start.year && endSameDay.month === start.month && endSameDay.day === start.day)
    ? endSameDay.hour * 60 + endSameDay.minute
    : 24 * 60
  return intervals.some(([from, to]) => {
    const a = parseHm(from)
    const b = parseHm(to)
    if (a == null || b == null) return false
    return startMin >= a && endMinutes <= b
  })
}

export function memberFreeForSlot(member, slotStart, slotEnd, { blocks = [], appointments = [], busy = [], now = new Date(), excludeAppointmentId = null } = {}) {
  if (!member || member.active === false) return false
  const noticeMs = (member.min_notice_minutes ?? 60) * 60 * 1000
  if (slotStart.getTime() < now.getTime() + noticeMs) return false
  if (!slotFitsWorkingHours(member, slotStart, slotEnd)) return false
  const bufferMs = (member.buffer_minutes ?? 0) * 60 * 1000
  const memberId = member.id

  for (const block of blocks) {
    if (block.team_member_id !== memberId) continue
    if (rangesOverlap(slotStart.getTime(), slotEnd.getTime(), new Date(block.starts_at).getTime(), new Date(block.ends_at).getTime())) {
      return false
    }
  }

  for (const appt of appointments) {
    if (excludeAppointmentId && appt.id === excludeAppointmentId) continue
    if (appt.team_member_id !== memberId) continue
    if (appt.status !== 'scheduled') continue
    const aStart = new Date(appt.starts_at).getTime()
    const aEnd = new Date(appt.ends_at).getTime() + bufferMs
    if (rangesOverlap(slotStart.getTime(), slotEnd.getTime(), aStart, aEnd)) return false
  }

  for (const item of busy) {
    const bStart = new Date(item.start).getTime()
    const bEnd = new Date(item.end).getTime() + bufferMs
    if (rangesOverlap(slotStart.getTime(), slotEnd.getTime(), bStart, bEnd)) return false
  }

  return true
}

export function consultationMinutes(members) {
  const active = (members || []).filter(m => m.active !== false)
  const primary = active.find(m => m.role === 'primary')
  const minutes = primary?.call_minutes ?? active[0]?.call_minutes ?? 30
  return minutes
}

function addDaysUtcWall(parts, days, timeZone) {
  return zonedTimeToUtc(parts.year, parts.month, parts.day + days, 0, 0, timeZone)
}

/**
 * Open consultation slots in the range. A slot is included when at least one
 * active member is free. Slot length follows the primary member's call_minutes.
 */
export function openSlots({
  members = [],
  blocks = [],
  appointments = [],
  busyByMember = {},
  rangeStart,
  rangeEnd,
  now = new Date(),
  slotMinutes,
  excludeAppointmentId = null,
} = {}) {
  const bookable = members.filter(m => m.active !== false)
  const duration = slotMinutes ?? consultationMinutes(bookable)
  const durationMs = duration * 60 * 1000
  const slots = []
  if (!rangeStart || !rangeEnd || !(rangeEnd > rangeStart)) {
    return { slotMinutes: duration, slots }
  }

  const tz = BUSINESS_TZ
  let dayCursor = zonedParts(rangeStart, tz)
  // Walk civil dates in Eastern Time, inclusive of the start date through the end instant.
  for (let guard = 0; guard < 70; guard += 1) {
    const dayStart = zonedTimeToUtc(dayCursor.year, dayCursor.month, dayCursor.day, 0, 0, tz)
    if (dayStart.getTime() >= rangeEnd.getTime() && guard > 0) break
    const key = WEEKDAY_KEY[dayCursor.weekday]
    const startKeys = new Set()

    for (const member of bookable) {
      const hours = member.weekly_hours || DEFAULT_WEEKLY_HOURS
      const intervals = hours[key] || []
      const memberTz = member.timezone || tz
      for (const [from, to] of intervals) {
        const a = parseHm(from)
        const b = parseHm(to)
        if (a == null || b == null || b <= a) continue
        const windowStart = zonedTimeToUtc(dayCursor.year, dayCursor.month, dayCursor.day, Math.floor(a / 60), a % 60, memberTz)
        const windowEnd = zonedTimeToUtc(dayCursor.year, dayCursor.month, dayCursor.day, Math.floor(b / 60), b % 60, memberTz)
        for (let t = windowStart.getTime(); t + durationMs <= windowEnd.getTime(); t += durationMs) {
          if (t < rangeStart.getTime() || t >= rangeEnd.getTime()) continue
          if (!bookingStartAllowed(new Date(t), BUSINESS_TZ)) continue
          startKeys.add(t)
        }
      }
    }

    for (const t of [...startKeys].sort((a, b) => a - b)) {
      const slotStart = new Date(t)
      const slotEnd = new Date(t + durationMs)
      const free = bookable.filter(member => memberFreeForSlot(member, slotStart, slotEnd, {
        blocks,
        appointments,
        busy: busyByMember[member.id] || [],
        now,
        excludeAppointmentId,
      }))
      if (free.length === 0) continue
      slots.push({
        start: slotStart,
        end: slotEnd,
        available_count: free.length,
        free_member_ids: free.map(m => m.id),
      })
    }

    const next = addDaysUtcWall(dayCursor, 1, tz)
    dayCursor = zonedParts(next, tz)
    if (next.getTime() > rangeEnd.getTime() + 36 * 3600 * 1000) break
  }

  return { slotMinutes: duration, slots }
}

/** Primary, then backup, then anyone else. Email breaks ties inside a role. */
export function orderCandidates(members) {
  return [...(members || [])].sort((a, b) => {
    const ra = ROLE_RANK[a.role] ?? 9
    const rb = ROLE_RANK[b.role] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.email || '').localeCompare(String(b.email || ''))
  })
}

export function pickAssignee(freeMembers) {
  return orderCandidates(freeMembers)[0] || null
}

/**
 * Notification is an optional attendee on the assignee's Outlook event.
 * notify_all members other than the assignee are added. The customer is a
 * required attendee only when an email is present and customerInvite is not false.
 */
export function outlookAttendees({ members = [], assignee, customer, customerInvite = true } = {}) {
  const attendees = []
  const email = String(customer?.email || '').trim()
  if (customerInvite !== false && email) {
    attendees.push({
      emailAddress: { address: email, name: customer.name || email },
      type: 'required',
    })
  }
  const owner = String(assignee?.email || '').toLowerCase()
  for (const member of members) {
    if (!member || member.active === false || !member.notify_all) continue
    const addr = String(member.email || '').trim()
    if (!addr || addr.toLowerCase() === owner) continue
    attendees.push({
      emailAddress: { address: addr, name: member.display_name || addr },
      type: 'optional',
    })
  }
  return attendees
}
