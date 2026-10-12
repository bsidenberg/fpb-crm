import { supabase } from './supabase'
import { orderCandidates } from './bookingSlots'

function functionUrl(path) {
  const base = import.meta.env.VITE_SUPABASE_URL
  return `${base}/functions/v1/booking${path}`
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || ''}`,
    'Content-Type': 'application/json',
  }
}

export async function bookingRequest(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(functionUrl(path), {
      method,
      headers: await authHeaders(),
      body: body == null ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : 'network' }, unreachable: true }
  }
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { error: text.slice(0, 240) } }
  const unreachable = res.status === 404 && !parsed?.error
  return { ok: res.ok, status: res.status, body: parsed, unreachable }
}

async function orderedMemberIds() {
  const { data, error } = await supabase.from('team_members').select('*').eq('active', true)
  if (error) throw new Error(error.message)
  return orderCandidates(data || []).map(member => member.id)
}

/** Staff actions. Uses the edge function so Outlook stays in sync, and falls
 * back to the SQL functions only when that function is not deployed yet. */
export async function rescheduleBooking(id, start, end) {
  const viaFunction = await bookingRequest(`/bookings/${id}`, {
    method: 'PATCH',
    body: { start, end },
  })
  if (viaFunction.ok || !viaFunction.unreachable) return viaFunction
  const { data, error } = await supabase.rpc('reschedule_consultation', {
    p_id: id,
    p_starts: start,
    p_ends: end,
    p_candidate_ids: await orderedMemberIds(),
  })
  if (error) return { ok: false, status: 500, body: { error: error.message }, fallback: true }
  return { ok: true, status: 200, body: data, fallback: true }
}

export async function cancelBooking(id) {
  const viaFunction = await bookingRequest(`/bookings/${id}`, { method: 'DELETE' })
  if (viaFunction.ok || !viaFunction.unreachable) return viaFunction
  const { data, error } = await supabase.rpc('cancel_consultation', { p_id: id })
  if (error) return { ok: false, status: 500, body: { error: error.message }, fallback: true }
  return { ok: true, status: 200, body: data, fallback: true }
}

export async function setBookingOutcome(id, status) {
  const viaFunction = await bookingRequest(`/bookings/${id}/outcome`, {
    method: 'POST',
    body: { status },
  })
  if (viaFunction.ok || !viaFunction.unreachable) return viaFunction
  const { data, error } = await supabase.rpc('set_consultation_outcome', { p_id: id, p_status: status })
  if (error) return { ok: false, status: 500, body: { error: error.message }, fallback: true }
  return { ok: true, status: 200, body: data, fallback: true }
}

export async function syncBookingOutlook(id) {
  return bookingRequest(`/bookings/${id}/sync`, { method: 'POST' })
}
