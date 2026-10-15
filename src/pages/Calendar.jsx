import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { BOOKING_DAY_END_MIN, BOOKING_DAY_START_MIN, BUSINESS_TZ, DEFAULT_WEEKLY_HOURS, orderCandidates, zonedParts, zonedTimeToUtc } from '../lib/bookingSlots'
import { formatCallWhen } from '../lib/bookedCall'
import { cancelBooking, rescheduleBooking, setBookingOutcome, syncBookingOutlook } from '../lib/bookingClient'
import CallCalendar from '../components/CallCalendar'
import PinnedHScroll from '../components/PinnedHScroll'
import { shiftAnchor, weekDays } from '../lib/calendarRange'

const HOURS = DEFAULT_WEEKLY_HOURS
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function rangeFor(anchor, mode) {
  const days = mode === 'week' ? weekDays(anchor) : [anchor]
  const first = zonedParts(days[0])
  const last = zonedParts(days[days.length - 1])
  const start = zonedTimeToUtc(first.year, first.month, first.day, 0, 0)
  const end = zonedTimeToUtc(last.year, last.month, last.day + 1, 0, 0)
  return { days, start: start.toISOString(), end: end.toISOString() }
}

function hoursToText(weekly) {
  const out = {}
  for (const key of DAY_KEYS) {
    const intervals = (weekly || HOURS)[key] || []
    out[key] = intervals.map(pair => pair.join('-')).join(', ')
  }
  return out
}

function textToHours(fields) {
  const weekly = {}
  for (const key of DAY_KEYS) {
    const raw = (fields[key] || '').trim()
    if (!raw) {
      weekly[key] = []
      continue
    }
    weekly[key] = raw.split(',').map(part => {
      const [from, to] = part.trim().split('-')
      return [from.trim(), to.trim()]
    })
  }
  return weekly
}

export default function Calendar() {
  const toast = useToast()
  const navigate = useNavigate()
  const [mode, setMode] = useState('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [members, setMembers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [settingsFor, setSettingsFor] = useState(null)
  const [rescheduleAt, setRescheduleAt] = useState('')
  const [blockForm, setBlockForm] = useState({ start: '', end: '', reason: '' })

  const { days, start, end } = useMemo(() => rangeFor(anchor, mode), [anchor, mode])

  const load = useCallback(async () => {
    const [memberRes, apptRes, blockRes] = await Promise.all([
      supabase.from('team_members').select('*').order('role').order('email'),
      supabase.from('appointments').select('id, team_member_id, lead_id, starts_at, ends_at, status, reschedule_count, customer_name, outlook_sync_status').gte('starts_at', start).lt('starts_at', end),
      supabase.from('team_blocks').select('*').lt('starts_at', end).gt('ends_at', start),
    ])
    if (memberRes.error) return { error: memberRes.error.message }
    const rows = apptRes.data || []
    const leadIds = [...new Set(rows.map(row => row.lead_id).filter(Boolean))]
    let names = {}
    if (leadIds.length) {
      const { data } = await supabase.from('leads').select('id, first_name, last_name').in('id', leadIds)
      names = Object.fromEntries((data || []).map(lead => [lead.id, `${lead.first_name || ''} ${lead.last_name || ''}`.trim()]))
    }
    return {
      error: '',
      members: orderCandidates(memberRes.data || []),
      appointments: rows.map(row => ({ ...row, lead_name: names[row.lead_id] || row.customer_name })),
      blocks: blockRes.error ? [] : (blockRes.data || []),
    }
  }, [start, end])

  const applyLoaded = useCallback(next => {
    if (!next) return
    if (next.error) {
      setError(next.error)
      return
    }
    setError('')
    setMembers(next.members)
    setAppointments(next.appointments)
    setBlocks(next.blocks)
  }, [])

  useEffect(() => {
    let cancelled = false
    load().then(next => {
      if (!cancelled) applyLoaded(next)
    })
    return () => { cancelled = true }
  }, [load, applyLoaded])

  const title = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(mode === 'week' ? days[0] : anchor)

  async function runAction(work, success) {
    const result = await work()
    if (!result.ok) {
      toast(result.body?.message || result.body?.error || 'Could not update the booking', 'error')
      return
    }
    toast(result.fallback ? `${success}. Outlook sync waits on the booking function.` : success)
    setSelected(null)
    applyLoaded(await load())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 750, letterSpacing: '-0.3px' }}>Booked calls</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 2 }}>
            Mon–Fri 8:30 AM–4:30 PM Eastern · 30-minute slots · Mathew takes the call when he is free · Brian is backup and notified on Outlook
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setAnchor(current => shiftAnchor(current, mode, -1))} style={navBtn}>Prev</button>
          <div style={{ fontSize: 13, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{title}</div>
          <button type="button" onClick={() => setAnchor(current => shiftAnchor(current, mode, 1))} style={navBtn}>Next</button>
          <button type="button" onClick={() => setMode('day')} style={mode === 'day' ? modeOn : navBtn}>Day</button>
          <button type="button" onClick={() => setMode('week')} style={mode === 'week' ? modeOn : navBtn}>Week</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
        {members.map(member => (
          <button key={member.id} type="button" onClick={() => setSettingsFor(member)} style={chip}>
            <strong>{member.display_name}</strong>
            <span style={{ color: member.role === 'primary' ? '#1D4ED8' : '#B45309' }}>{member.role}</span>
            {member.notify_all ? <span>notified</span> : null}
          </button>
        ))}
      </div>

      <PinnedHScroll scrollY contentStyle={{ padding: '0 20px 12px' }}>
        {error ? (
          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: 16, fontSize: 13, maxWidth: 640 }}>
            The calendar tables are not available yet. Apply <code>supabase/migrations/20261012000002_booked_calls.sql</code> in the Supabase SQL editor. {error}
          </div>
        ) : (
          <CallCalendar
            days={days}
            members={members.filter(member => member.active !== false)}
            appointments={appointments}
            blocks={blocks}
            startMin={BOOKING_DAY_START_MIN}
            endMin={BOOKING_DAY_END_MIN}
            onSelect={appt => { setSelected(appt); setRescheduleAt(toLocalInput(appt.starts_at)) }}
          />
        )}
      </PinnedHScroll>

      {selected && (
        <Drawer title={selected.lead_name || selected.customer_name || 'Consultation'} onClose={() => setSelected(null)}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{formatCallWhen(selected.starts_at)}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginBottom: 12 }}>
            Outlook: {selected.outlook_sync_status || 'pending'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" style={navBtn} onClick={() => selected.lead_id && navigate(`/leads/${selected.lead_id}`)}>Open lead</button>
            <button type="button" style={navBtn} onClick={() => runAction(() => setBookingOutcome(selected.id, 'completed'), 'Marked completed')}>Completed</button>
            <button type="button" style={navBtn} onClick={() => runAction(() => setBookingOutcome(selected.id, 'no_show'), 'Marked no-show')}>No-show</button>
            <button type="button" style={navBtn} onClick={() => runAction(() => cancelBooking(selected.id), 'Call cancelled')}>Cancel</button>
            <button type="button" style={navBtn} onClick={() => runAction(() => syncBookingOutlook(selected.id), 'Outlook sync requested')}>Sync Outlook</button>
          </div>
          <label style={lbl}>Reschedule (Eastern Time)</label>
          <input type="datetime-local" value={rescheduleAt} onChange={e => setRescheduleAt(e.target.value)} style={input} />
          <button
            type="button"
            style={{ ...modeOn, marginTop: 8 }}
            onClick={() => {
              const start = etInputToIso(rescheduleAt)
              if (!start) { toast('Enter a date and time', 'error'); return }
              const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString()
              runAction(() => rescheduleBooking(selected.id, start, end), 'Call rescheduled')
            }}
          >
            Move call
          </button>
        </Drawer>
      )}

      {settingsFor && (
        <MemberSettings
          member={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={() => { setSettingsFor(null); load().then(applyLoaded) }}
          blockForm={blockForm}
          setBlockForm={setBlockForm}
          blocks={blocks.filter(block => block.team_member_id === settingsFor.id)}
        />
      )}
    </div>
  )
}

function MemberSettings({ member, onClose, onSaved, blockForm, setBlockForm, blocks }) {
  const toast = useToast()
  const [form, setForm] = useState(() => ({
    display_name: member.display_name,
    role: member.role,
    notify_all: member.notify_all,
    active: member.active,
    call_minutes: member.call_minutes,
    buffer_minutes: member.buffer_minutes,
    min_notice_minutes: member.min_notice_minutes,
    hours: hoursToText(member.weekly_hours),
  }))
  const [saving, setSaving] = useState(false)

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('team_members').update({
      display_name: form.display_name,
      role: form.role,
      notify_all: form.notify_all,
      active: form.active,
      call_minutes: Number(form.call_minutes),
      buffer_minutes: Number(form.buffer_minutes),
      min_notice_minutes: Number(form.min_notice_minutes),
      weekly_hours: textToHours(form.hours),
    }).eq('id', member.id).select()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Team member updated')
    onSaved()
  }

  async function addBlock(event) {
    event.preventDefault()
    const starts = etInputToIso(blockForm.start)
    const ends = etInputToIso(blockForm.end)
    if (!starts || !ends) { toast('Start and end are required', 'error'); return }
    const { error } = await supabase.from('team_blocks').insert({
      team_member_id: member.id,
      starts_at: starts,
      ends_at: ends,
      reason: blockForm.reason || null,
    })
    if (error) { toast(error.message, 'error'); return }
    toast('Blocked time added')
    setBlockForm({ start: '', end: '', reason: '' })
    onSaved()
  }

  return (
    <Drawer title={member.email} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
        <label style={lbl}>Name</label>
        <input style={input} value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
        <label style={lbl}>Role</label>
        <select style={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="primary">Primary — gets the call when free</option>
          <option value="backup">Backup — only when every primary is busy</option>
          <option value="member">Member — after primary and backup</option>
        </select>
        <label style={{ ...lbl, display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none' }}>
          <input type="checkbox" checked={form.notify_all} onChange={e => setForm({ ...form, notify_all: e.target.checked })} />
          Notify on every booking (optional Outlook attendee)
        </label>
        <label style={{ ...lbl, display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none' }}>
          <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
          Bookable
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Field label="Call min" value={form.call_minutes} onChange={value => setForm({ ...form, call_minutes: value })} />
          <Field label="Buffer" value={form.buffer_minutes} onChange={value => setForm({ ...form, buffer_minutes: value })} />
          <Field label="Notice" value={form.min_notice_minutes} onChange={value => setForm({ ...form, min_notice_minutes: value })} />
        </div>
        {DAY_KEYS.map(key => (
          <div key={key}>
            <label style={lbl}>{key} hours</label>
            <input
              style={input}
              placeholder="08:30-16:30"
              value={form.hours[key]}
              onChange={e => setForm({ ...form, hours: { ...form.hours, [key]: e.target.value } })}
            />
          </div>
        ))}
        <button type="submit" disabled={saving} style={modeOn}>{saving ? 'Saving…' : 'Save'}</button>
      </form>
      <form onSubmit={addBlock} style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Block time (Eastern)</div>
        <input type="datetime-local" style={input} value={blockForm.start} onChange={e => setBlockForm({ ...blockForm, start: e.target.value })} />
        <input type="datetime-local" style={input} value={blockForm.end} onChange={e => setBlockForm({ ...blockForm, end: e.target.value })} />
        <input style={input} placeholder="Reason" value={blockForm.reason} onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })} />
        <button type="submit" style={navBtn}>Add block</button>
        {blocks.map(block => (
          <div key={block.id} style={{ fontSize: 11, color: 'var(--color-text-2)' }}>
            {formatCallWhen(block.starts_at)} — {block.reason || 'Blocked'}
          </div>
        ))}
      </form>
    </Drawer>
  )
}

function Field({ label, value, onChange }) {
  return (
    <label>
      <div style={lbl}>{label}</div>
      <input style={input} type="number" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function Drawer({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,36,68,0.35)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 380, maxWidth: '100%', background: 'var(--color-surface)', height: '100%', overflow: 'auto', padding: 20, boxShadow: '-8px 0 24px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 750 }}>{title}</div>
          <button type="button" onClick={onClose} style={navBtn}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function toLocalInput(iso) {
  const parts = zonedParts(new Date(iso), BUSINESS_TZ)
  const pad = n => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

function etInputToIso(value) {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return null
  return zonedTimeToUtc(+match[1], +match[2], +match[3], +match[4], +match[5]).toISOString()
}

const navBtn = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
  background: 'var(--color-surface)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--color-text)',
}
const modeOn = { ...navBtn, background: 'var(--color-navy)', color: '#fff', border: 'none' }
const chip = {
  display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderRadius: 99,
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 12,
}
const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.4px' }
const input = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
}
