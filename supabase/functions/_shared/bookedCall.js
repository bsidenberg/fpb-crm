// How a booked-call lead is labeled on the board and the calendar.
import { BUSINESS_TZ } from './bookingSlots.js'

export function pickDisplayAppointment(rows, now = new Date()) {
  if (!rows || rows.length === 0) return null
  const scheduled = rows.filter(row => row.status === 'scheduled')
  if (scheduled.length) {
    const upcoming = scheduled
      .filter(row => new Date(row.ends_at).getTime() >= now.getTime())
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    if (upcoming.length) return upcoming[0]
    return [...scheduled].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0]
  }
  const rest = rows.filter(row => row.status !== 'cancelled')
  const pool = rest.length ? rest : rows
  return [...pool].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0]
}

export function formatCallWhen(date, timeZone = BUSINESS_TZ) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value)
}

/**
 * Upcoming calls stay visually distinct. After the end time, a still-scheduled
 * call asks for an outcome. Reschedule keeps the call upcoming and says so.
 */
export function bookedCallPresentation(appointment, now = new Date()) {
  if (!appointment || !appointment.starts_at) return null
  const start = new Date(appointment.starts_at)
  const end = new Date(appointment.ends_at || appointment.starts_at)
  const when = formatCallWhen(start)
  const status = appointment.status

  if (status === 'completed') {
    return { key: 'completed', label: 'Call completed', when, color: '#15803D', wash: '#F0FDF4' }
  }
  if (status === 'no_show') {
    return { key: 'no_show', label: 'No-show', when, color: '#B91C1C', wash: '#FEF2F2' }
  }
  if (status === 'cancelled') {
    return { key: 'cancelled', label: 'Call cancelled', when, color: '#6B7280', wash: '#F3F4F6' }
  }
  if (status === 'scheduled' && end.getTime() < now.getTime()) {
    return { key: 'outcome', label: 'Outcome needed', when, color: '#7C3AED', wash: '#F5F3FF' }
  }
  if (status === 'scheduled' && (appointment.reschedule_count || 0) > 0) {
    return { key: 'rescheduled', label: 'Rescheduled', when, color: '#B45309', wash: '#FFFBEB' }
  }
  if (status === 'scheduled') {
    return { key: 'booked', label: 'Call booked', when, color: '#1D4ED8', wash: '#EFF6FF' }
  }
  return null
}

export function sameAppointment(a, b) {
  if (a === b) return true
  if (!a || !b) return !a && !b
  return a.id === b.id
    && a.status === b.status
    && a.starts_at === b.starts_at
    && a.ends_at === b.ends_at
    && (a.reschedule_count || 0) === (b.reschedule_count || 0)
    && (a.team_member_name || a.team_member?.display_name || '') === (b.team_member_name || b.team_member?.display_name || '')
}
