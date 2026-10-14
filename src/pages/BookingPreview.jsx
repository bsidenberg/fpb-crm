import { DndContext } from '@dnd-kit/core'
import { BrowserRouter } from 'react-router-dom'
import LeadCard from '../components/LeadCard'
import CallCalendar from '../components/CallCalendar'
import { weekDays } from '../lib/calendarRange'
import { ToastProvider } from '../lib/toast'
import { DEFAULT_WEEKLY_HOURS, zonedTimeToUtc } from '../lib/bookingSlots'

const mathew = {
  id: 'mathew',
  email: 'mathew@floridapolebarn.com',
  display_name: 'Mathew',
  role: 'primary',
  notify_all: false,
  active: true,
  weekly_hours: DEFAULT_WEEKLY_HOURS,
}
const brian = {
  id: 'brian',
  email: 'brian@floridapolebarn.com',
  display_name: 'Brian Sidenberg',
  role: 'backup',
  notify_all: true,
  active: true,
  weekly_hours: DEFAULT_WEEKLY_HOURS,
}

function at(daysAhead, hour, minute) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const bag = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return zonedTimeToUtc(+bag.year, +bag.month, +bag.day + daysAhead, hour, minute).toISOString()
}

function lead(partial) {
  return {
    id: partial.id,
    first_name: partial.first_name,
    last_name: partial.last_name,
    stage: 'new',
    priority: 'warm',
    score: 72,
    value: 42000,
    probability: 40,
    owner: partial.owner,
    company: '',
    city: partial.city,
    barn_size: partial.barn_size,
    source: 'Booking Agent',
    lead_source: 'Booking Agent',
    follow_up_date: null,
    last_contact_date: null,
    tags: [],
    booked_call: !!partial.booked_call,
    appointment: partial.appointment,
  }
}

const samples = [
  lead({
    id: 'preview-booked',
    first_name: 'Sam',
    last_name: 'Rivera',
    city: 'Clermont',
    barn_size: '30x40',
    owner: 'Mathew',
    booked_call: true,
    appointment: {
      id: 'a1', status: 'scheduled', reschedule_count: 0,
      starts_at: at(2, 14, 0), ends_at: at(2, 14, 30),
    },
  }),
  lead({
    id: 'preview-moved',
    first_name: 'Dana',
    last_name: 'Cole',
    city: 'Groveland',
    barn_size: '24x36',
    owner: 'Mathew',
    booked_call: true,
    appointment: {
      id: 'a2', status: 'scheduled', reschedule_count: 1,
      starts_at: at(3, 10, 0), ends_at: at(3, 10, 30),
    },
  }),
  lead({
    id: 'preview-done',
    first_name: 'Chris',
    last_name: 'Nguyen',
    city: 'Leesburg',
    barn_size: '40x60',
    owner: 'Brian Sidenberg',
    appointment: {
      id: 'a3', status: 'completed', reschedule_count: 0,
      starts_at: at(-3, 11, 0), ends_at: at(-3, 11, 30),
    },
  }),
  lead({
    id: 'preview-noshow',
    first_name: 'Pat',
    last_name: 'Alvarez',
    city: 'Tavares',
    barn_size: '30x50',
    owner: 'Mathew',
    appointment: {
      id: 'a4', status: 'no_show', reschedule_count: 0,
      starts_at: at(-2, 15, 30), ends_at: at(-2, 16, 0),
    },
  }),
]

const anchor = new Date()
const days = weekDays(anchor)

function upcomingTuesdayOffset() {
  const labels = days.map(day => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(day))
  const index = labels.indexOf('Tue')
  if (index === -1) return 1
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(anchor)
  const todayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(today)
  if (todayIndex === -1) return 1
  return index - todayIndex
}

export default function BookingPreview() {
  const offset = upcomingTuesdayOffset()
  const appts = [
    {
      id: 'c1', team_member_id: 'mathew', lead_name: 'Sam Rivera', customer_name: 'Sam Rivera',
      status: 'scheduled', reschedule_count: 0,
      starts_at: at(offset, 14, 0), ends_at: at(offset, 14, 30),
    },
    {
      id: 'c2', team_member_id: 'brian', lead_name: 'Dana Cole', customer_name: 'Dana Cole',
      status: 'scheduled', reschedule_count: 1,
      starts_at: at(offset, 15, 0), ends_at: at(offset, 15, 30),
    },
    {
      id: 'c3', team_member_id: 'mathew', lead_name: 'Chris Nguyen', customer_name: 'Chris Nguyen',
      status: 'completed', reschedule_count: 0,
      starts_at: at(offset === 0 ? 0 : offset, 11, 0), ends_at: at(offset === 0 ? 0 : offset, 11, 30),
    },
  ]
  const blocks = [{
    id: 'b1', team_member_id: 'mathew', reason: 'Site visit',
    starts_at: at(offset + 1, 9, 30), ends_at: at(offset + 1, 11, 0),
  }]

  return (
    <ToastProvider>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-3)', marginBottom: 8 }}>
            Booked-call tiles
          </div>
          <DndContext>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 240px)', gap: 12, marginBottom: 28 }}>
              {samples.map(item => <LeadCard key={item.id} lead={item} />)}
            </div>
          </DndContext>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-3)', marginBottom: 8 }}>
            Call calendar
          </div>
          <CallCalendar
            days={days}
            members={[mathew, brian]}
            appointments={appts}
            blocks={blocks}
          />
        </div>
      </BrowserRouter>
    </ToastProvider>
  )
}
