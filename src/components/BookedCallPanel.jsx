import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { bookedCallPresentation, pickDisplayAppointment } from '../lib/bookedCall'
import { cancelBooking, setBookingOutcome } from '../lib/bookingClient'

export default function BookedCallPanel({ leadId, onChanged }) {
  const toast = useToast()
  const [appointment, setAppointment] = useState(undefined)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, lead_id, starts_at, ends_at, status, reschedule_count, customer_name, team_member_id, team_members(display_name, email)')
      .eq('lead_id', leadId)
      .order('starts_at', { ascending: false })
    if (error) return null
    const rows = (data || []).map(row => {
      const member = Array.isArray(row.team_members) ? row.team_members[0] : row.team_members
      return { ...row, team_member_name: member?.display_name || '' }
    })
    return pickDisplayAppointment(rows)
  }, [leadId])

  useEffect(() => {
    let cancelled = false
    load().then(next => {
      if (!cancelled) setAppointment(next)
    })
    return () => { cancelled = true }
  }, [load])

  if (!appointment) return null
  const view = bookedCallPresentation(appointment)
  if (!view) return null

  async function act(work, message) {
    const result = await work()
    if (!result.ok) {
      toast(result.body?.message || result.body?.error || 'Update failed', 'error')
      return
    }
    toast(result.fallback ? `${message}. Outlook sync waits on the booking function.` : message)
    const next = await load()
    setAppointment(next)
    onChanged?.(next)
  }

  return (
    <div style={{
      marginTop: 12,
      border: `1px solid ${view.color}`,
      background: view.wash,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: view.color }}>
        {view.label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{view.when}</div>
      {appointment.team_member_name && (
        <div style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 2 }}>With {appointment.team_member_name}</div>
      )}
      {appointment.status === 'scheduled' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Mini onClick={() => act(() => setBookingOutcome(appointment.id, 'completed'), 'Marked completed')}>Completed</Mini>
          <Mini onClick={() => act(() => setBookingOutcome(appointment.id, 'no_show'), 'Marked no-show')}>No-show</Mini>
          <Mini onClick={() => act(() => cancelBooking(appointment.id), 'Call cancelled')}>Cancel</Mini>
        </div>
      )}
    </div>
  )
}

function Mini({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '4px 8px', borderRadius: 5, border: '1px solid var(--color-border)',
      background: '#fff', fontSize: 11, fontWeight: 650, cursor: 'pointer',
    }}>
      {children}
    </button>
  )
}
