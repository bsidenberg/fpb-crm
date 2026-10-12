import { bookedCallPresentation } from '../lib/bookedCall'
import { BUSINESS_TZ, zonedParts, DEFAULT_WEEKLY_HOURS } from '../lib/bookingSlots'

const START_MIN = 9 * 60
const END_MIN = 17 * 60
const PX = 36

function dayKey(date) {
  const p = zonedParts(date, BUSINESS_TZ)
  return `${p.year}-${p.month}-${p.day}`
}

function minutesOf(date) {
  const p = zonedParts(date, BUSINESS_TZ)
  return p.hour * 60 + p.minute
}

function sameDay(a, b) {
  return dayKey(a) === dayKey(b)
}

function workingIntervals(member, date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, weekday: 'short' }).format(date)
  const map = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' }
  const hours = member.weekly_hours || DEFAULT_WEEKLY_HOURS
  return hours[map[weekday] || 'sun'] || []
}

function laneLabel(member) {
  const role = member.role === 'primary' ? 'Primary' : member.role === 'backup' ? 'Backup' : 'Team'
  const name = String(member.display_name || '').split(' ')[0]
  return name ? `${name} · ${role}` : role
}

export default function CallCalendar({ days, members, appointments, blocks, onSelect }) {
  const rows = (END_MIN - START_MIN) / 30
  return (
    <div style={{ display: 'flex', minWidth: 720, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
      <div style={{ width: 64, flexShrink: 0, borderRight: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
        <div style={{ height: 36, borderBottom: '1px solid var(--color-border)' }} />
        {Array.from({ length: rows }, (_, i) => {
          const mins = START_MIN + i * 30
          const hour = Math.floor(mins / 60)
          const minute = mins % 60
          const label = minute === 0
            ? `${((hour + 11) % 12) + 1}${hour < 12 ? 'a' : 'p'}`
            : ''
          return (
            <div key={mins} style={{ height: PX, padding: '2px 6px 0', fontSize: 10, color: 'var(--color-text-3)', textAlign: 'right' }}>
              {label}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
        {days.map(day => (
          <div key={dayKey(day)} style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--color-border)' }}>
            <div style={{ height: 36, borderBottom: '1px solid var(--color-border)', padding: '8px 8px 6px', background: 'var(--color-surface-2)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text)' }}>
                {new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(day)}
              </div>
            </div>
            <div style={{ display: 'flex' }}>
              {members.map(member => (
                <MemberLane
                  key={member.id}
                  day={day}
                  member={member}
                  appointments={appointments.filter(appt => appt.team_member_id === member.id && sameDay(new Date(appt.starts_at), day))}
                  blocks={blocks.filter(block => block.team_member_id === member.id && sameDay(new Date(block.starts_at), day))}
                  onSelect={onSelect}
                  rows={rows}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MemberLane({ day, member, appointments, blocks, onSelect, rows }) {
  const intervals = workingIntervals(member, day)
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, height: rows * PX, borderLeft: '1px solid var(--color-border-light)', background: '#F3F4F6' }}>
      <div style={{ position: 'absolute', top: 2, left: 4, right: 2, zIndex: 1, fontSize: 9, fontWeight: 700, letterSpacing: '0.2px', textTransform: 'uppercase', color: member.role === 'primary' ? '#1D4ED8' : '#B45309', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {laneLabel(member)}
      </div>
      {intervals.map(([from, to]) => {
        const [fh, fm] = from.split(':').map(Number)
        const [th, tm] = to.split(':').map(Number)
        const top = ((fh * 60 + fm - START_MIN) / 30) * PX
        const height = (((th * 60 + tm) - (fh * 60 + fm)) / 30) * PX
        return <div key={`${from}-${to}`} style={{ position: 'absolute', left: 0, right: 0, top, height, background: '#FFFFFF' }} />
      })}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * PX, height: PX, borderTop: '1px solid rgba(209,213,219,0.7)' }} />
      ))}
      {blocks.map(block => {
        const top = ((minutesOf(new Date(block.starts_at)) - START_MIN) / 30) * PX
        const height = Math.max(18, ((minutesOf(new Date(block.ends_at)) - minutesOf(new Date(block.starts_at))) / 30) * PX)
        return (
          <div key={block.id} title={block.reason || 'Blocked'} style={{
            position: 'absolute', left: 3, right: 3, top, height,
            background: 'repeating-linear-gradient(135deg, #E5E7EB, #E5E7EB 4px, #F9FAFB 4px, #F9FAFB 8px)',
            border: '1px dashed #9CA3AF', borderRadius: 4, fontSize: 9, color: '#4B5563', padding: '2px 4px',
          }}>
            {block.reason || 'Blocked'}
          </div>
        )
      })}
      {appointments.map(appt => {
        const view = bookedCallPresentation(appt) || { color: '#1D4ED8', wash: '#EFF6FF', label: 'Call' }
        const top = ((minutesOf(new Date(appt.starts_at)) - START_MIN) / 30) * PX
        const height = Math.max(PX - 4, ((minutesOf(new Date(appt.ends_at)) - minutesOf(new Date(appt.starts_at))) / 30) * PX - 2)
        return (
          <button
            key={appt.id}
            type="button"
            onClick={() => onSelect?.(appt)}
            style={{
              position: 'absolute', left: 3, right: 3, top: top + 1, height,
              background: view.wash, border: `1px solid ${view.color}`, borderLeft: `3px solid ${view.color}`,
              borderRadius: 4, textAlign: 'left', padding: '3px 5px', cursor: 'pointer', overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 800, color: view.color, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{view.label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {appt.lead_name || appt.customer_name || 'Consultation'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

