import { BUSINESS_TZ, zonedParts, zonedTimeToUtc } from './bookingSlots'

export function weekDays(anchor) {
  const parts = zonedParts(anchor, BUSINESS_TZ)
  const midday = zonedTimeToUtc(parts.year, parts.month, parts.day, 12, 0)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, weekday: 'short' }).format(midday)
  const index = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 1
  const mondayOffset = index === 0 ? -6 : 1 - index
  return Array.from({ length: 5 }, (_, i) => zonedTimeToUtc(parts.year, parts.month, parts.day + mondayOffset + i, 12, 0))
}

export function shiftAnchor(anchor, mode, direction) {
  const parts = zonedParts(anchor, BUSINESS_TZ)
  const days = mode === 'week' ? 7 : 1
  return zonedTimeToUtc(parts.year, parts.month, parts.day + days * direction, 12, 0)
}
