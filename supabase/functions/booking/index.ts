// SEALD booking API and webhook. service_role talks to Postgres.
// Auth for /availability and /bookings is the SEALD API key (or a CRM user
// JWT for staff actions). The webhook is HMAC, not the API key.
// Anon has no table access. verify_jwt is off because SEALD has no user JWT.
//
// Base URL:
//   https://flabvhdgqddbfitbqjqk.supabase.co/functions/v1/booking

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  BUSINESS_TZ,
  consultationMinutes,
  formatOffsetIso,
  formatWallClock,
  openSlots,
  orderCandidates,
  outlookAttendees,
} from '../_shared/bookingSlots.js'
import { formatCallWhen } from '../_shared/bookedCall.js'
import {
  DEFAULT_API_KEY_HEADER,
  DEFAULT_IDEMPOTENCY_HEADER,
  DEFAULT_SIGNATURE_HEADER,
  DEFAULT_SIGNED_TEMPLATE,
  DEFAULT_TIMESTAMP_HEADER,
  headerLookup,
  hmacSha256Hex,
  intakeNote,
  normalizeBookingBody,
  noteMarker,
  parseSignatureHeader,
  safeEqual,
  signedPayload,
  statusFromEvent,
  timestampSkewError,
  SEALD_IDEMPOTENCY_HEADER,
  SEALD_PAYLOAD_VERSION,
  SEALD_SIGNATURE_HEADER,
  verifySealdSignature,
} from '../_shared/sealdContract.js'
import {
  createEvent,
  deleteEvent,
  eventContent,
  getSchedule,
  microsoftConfig,
  REMINDER_MINUTES,
  updateEvent,
} from './graph.ts'

const CRM_EMAIL = /@floridapolebarn\.com$/i
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const MAX_BODY = 65_536

const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-api-key, x-client-info, idempotency-key, seald-signature, seald-idempotency-key',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
  if (!url || !key) throw new Error('missing_supabase_env')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** true, false, or 'unconfigured' when no key secret is set. */
async function agentAuthorized(req: Request): Promise<boolean | 'unconfigured'> {
  const headerName = Deno.env.get('BOOKING_API_KEY_HEADER') || DEFAULT_API_KEY_HEADER
  const presented = headerLookup(req.headers, headerName)
  const raw = Deno.env.get('SEALD_API_KEY') || ''
  const hashed = (Deno.env.get('SEALD_API_KEY_SHA256') || '').trim().toLowerCase()
  if (!raw && !hashed) return 'unconfigured'
  if (!presented) return false
  if (raw && safeEqual(presented, raw)) return true
  if (hashed && safeEqual(await sha256Hex(presented), hashed)) return true
  return false
}

async function staffAuthorized(req: Request, db: SupabaseClient) {
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === service) return false
  const { data, error } = await db.auth.getUser(token)
  const email = data?.user?.email || ''
  return !error && !!data?.user && CRM_EMAIL.test(email)
}

function subpath(req: Request) {
  const url = new URL(req.url)
  const path = url.pathname
  const marker = '/booking'
  const idx = path.lastIndexOf(marker)
  let rest = idx >= 0 ? path.slice(idx + marker.length) : path
  if (!rest.startsWith('/')) rest = `/${rest}`
  rest = rest.replace(/\/$/, '') || '/'
  return { rest, url }
}

function rpcFailure(error: { message?: string, code?: string } | null) {
  const message = error?.message || 'booking_failed'
  if (message.includes('slot_taken')) {
    return json({ error: 'slot_taken', message: 'That time is no longer available.' }, 409)
  }
  if (message.includes('booking_not_found') || error?.code === 'P0002') {
    return json({ error: 'booking_not_found', message: 'No booking with that id.' }, 404)
  }
  if (message.includes('not_scheduled')) {
    return json({ error: 'not_scheduled', message: 'That booking can no longer be changed.' }, 409)
  }
  if (message.includes('invalid_time')) {
    return json({
      error: 'invalid_time',
      message: 'Bookings are Monday–Friday, 8:30 AM–4:30 PM Eastern, starting on :00 or :30. The last start is 4:00 PM.',
    }, 400)
  }
  if (message.includes('invalid_status')) {
    return json({ error: 'invalid_status', message: 'Status must be completed or no_show.' }, 400)
  }
  console.error('booking rpc failed', message)
  return json({ error: 'booking_failed', message }, 500)
}

function publicBooking(row: Record<string, unknown>, outlook?: { status: string, error: string | null }) {
  const start = new Date(String(row.starts_at))
  const end = new Date(String(row.ends_at))
  return {
    id: row.id,
    status: row.status,
    start: formatOffsetIso(start),
    end: formatOffsetIso(end),
    timezone: BUSINESS_TZ,
    lead_id: row.lead_id,
    service_type: row.service_type,
    idempotent: row.idempotent === true,
    reschedule_count: row.reschedule_count ?? 0,
    team_member: {
      id: row.team_member_id,
      email: row.team_member_email,
      name: row.team_member_name,
    },
    outlook: outlook || {
      status: row.outlook_sync_status || 'pending',
      error: null,
    },
  }
}

async function loadMembers(db: SupabaseClient) {
  const { data, error } = await db.from('team_members').select('*').order('email')
  if (error) throw new Error(error.message)
  return data || []
}

async function loadWindow(db: SupabaseClient, rangeStart: Date, rangeEnd: Date) {
  const from = new Date(rangeStart.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const to = rangeEnd.toISOString()
  const [appointments, blocks] = await Promise.all([
    db.from('appointments').select('id, team_member_id, starts_at, ends_at, status')
      .eq('status', 'scheduled')
      .gte('ends_at', from)
      .lte('starts_at', to),
    db.from('team_blocks').select('id, team_member_id, starts_at, ends_at')
      .gte('ends_at', from)
      .lte('starts_at', to),
  ])
  if (appointments.error) throw new Error(appointments.error.message)
  if (blocks.error) throw new Error(blocks.error.message)
  return { appointments: appointments.data || [], blocks: blocks.data || [] }
}

async function outlookBusy(members: { id: string, email: string }[], rangeStart: Date, rangeEnd: Date) {
  const cfg = microsoftConfig()
  if (!cfg) return { state: 'not_configured' as const, busyByMember: {} as Record<string, { start: Date, end: Date }[]> }
  try {
    const byEmail = await getSchedule(cfg, members.map(m => m.email), rangeStart, rangeEnd)
    const busyByMember: Record<string, { start: Date, end: Date }[]> = {}
    for (const member of members) {
      busyByMember[member.id] = byEmail[member.email.toLowerCase()] || []
    }
    return { state: 'ok' as const, busyByMember }
  } catch (err) {
    console.error('outlook free/busy unavailable', err instanceof Error ? err.message : err)
    return { state: 'unavailable' as const, busyByMember: {} as Record<string, { start: Date, end: Date }[]> }
  }
}

async function candidateIdsFor(
  db: SupabaseClient,
  start: Date,
  end: Date,
  excludeAppointmentId: string | null,
) {
  const members = (await loadMembers(db)).filter(m => m.active !== false)
  const minutes = consultationMinutes(members)
  const window = await loadWindow(db, start, end)
  const outlook = await outlookBusy(members, start, end)
  const { slots } = openSlots({
    members,
    blocks: window.blocks,
    appointments: window.appointments,
    busyByMember: outlook.busyByMember,
    rangeStart: start,
    rangeEnd: end,
    now: new Date(),
    slotMinutes: minutes,
    excludeAppointmentId,
  })
  const slot = slots.find(item => item.start.getTime() === start.getTime())
  const free = slot
    ? members.filter(member => slot.free_member_ids.includes(member.id))
    : []
  return {
    members,
    minutes,
    outlook: outlook.state,
    candidateIds: orderCandidates(free).map(member => member.id),
  }
}

function resolveRange(startRaw: string, endRaw: string, minutes: number) {
  const start = new Date(startRaw)
  if (Number.isNaN(start.getTime())) return { error: json({ error: 'invalid_start', message: 'start must be ISO 8601.' }, 400) }
  const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + minutes * 60 * 1000)
  if (Number.isNaN(end.getTime()) || end <= start) {
    return { error: json({ error: 'invalid_end', message: 'end must be after start.' }, 400) }
  }
  const diff = (end.getTime() - start.getTime()) / 60000
  if (Math.abs(diff - minutes) > 1) {
    return {
      error: json({
        error: 'duration_mismatch',
        message: `Consultations are ${minutes} minutes.`,
        slot_minutes: minutes,
      }, 400),
    }
  }
  return { start, end }
}

async function markOutlook(db: SupabaseClient, id: string, status: string, error: string | null, eventId?: string | null) {
  const patch: Record<string, unknown> = {
    outlook_sync_status: status,
    outlook_sync_error: error,
    outlook_synced_at: new Date().toISOString(),
  }
  if (eventId !== undefined) patch.outlook_event_id = eventId
  const { error: updateError } = await db.from('appointments').update(patch).eq('id', id)
  if (updateError) console.error('outlook status update failed', updateError.message)
}

async function syncOutlook(
  db: SupabaseClient,
  row: Record<string, unknown>,
  members: { id: string, email: string, display_name?: string, active?: boolean, notify_all?: boolean }[],
  previous?: { email?: string, eventId?: string | null, memberId?: string } | null,
) {
  const cfg = microsoftConfig()
  const id = String(row.id)
  if (!cfg) {
    await markOutlook(db, id, 'skipped', 'microsoft_not_configured')
    return { status: 'skipped', error: 'microsoft_not_configured' }
  }
  const mailbox = String(row.team_member_email || '')
  const status = String(row.status || '')
  try {
    if (status === 'cancelled') {
      const eventId = previous?.eventId || (row.outlook_event_id as string | null)
      const owner = previous?.email || mailbox
      if (eventId && owner) await deleteEvent(cfg, owner, eventId)
      await markOutlook(db, id, 'synced', null)
      return { status: 'synced', error: null }
    }

    const content = eventContent({
      leadId: String(row.lead_id || ''),
      name: String(row.customer_name || 'New lead'),
      email: String(row.customer_email || ''),
      phone: String(row.customer_phone || ''),
      intake: (row.intake as Record<string, unknown> | null) || null,
      sourceAgent: (row.source_agent as string | null) || null,
      verificationUrl: (row.verification_url as string | null) || null,
      assignee: String(row.team_member_name || mailbox),
    })
    const attendees = outlookAttendees({
      members,
      assignee: { email: mailbox, display_name: String(row.team_member_name || '') },
      customer: { email: String(row.customer_email || ''), name: String(row.customer_name || '') },
      customerInvite: row.customer_invite !== false,
    })
    const start = new Date(String(row.starts_at))
    const end = new Date(String(row.ends_at))
    const body = {
      subject: content.subject,
      body: { contentType: 'HTML', content: content.html },
      start: { dateTime: formatWallClock(start), timeZone: BUSINESS_TZ },
      end: { dateTime: formatWallClock(end), timeZone: BUSINESS_TZ },
      attendees,
      isReminderOn: true,
      reminderMinutesBeforeStart: REMINDER_MINUTES,
      showAs: 'busy',
      allowNewTimeProposals: false,
      transactionId: `${id}:${row.reschedule_count ?? 0}`,
    }
    const { transactionId: _transactionId, ...patchBody } = body
    const moved = previous?.eventId && previous.memberId && previous.memberId !== row.team_member_id
    let eventId = (row.outlook_event_id as string | null) || previous?.eventId || null
    if (moved && previous?.eventId && previous.email) {
      await deleteEvent(cfg, previous.email, previous.eventId)
      eventId = null
    }
    if (eventId && !moved) {
      const updated = await updateEvent(cfg, mailbox, eventId, patchBody)
      if (!updated) eventId = await createEvent(cfg, mailbox, body)
    } else {
      eventId = await createEvent(cfg, mailbox, body)
    }
    await markOutlook(db, id, 'synced', null, eventId)
    return { status: 'synced', error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'outlook_sync_failed'
    console.error('outlook sync failed', message)
    await markOutlook(db, id, 'failed', message.slice(0, 500))
    return { status: 'failed', error: message.slice(0, 240) }
  }
}

function bookingRequest(parsed: ReturnType<typeof normalizeBookingBody>, candidateIds: string[], idempotencyKey: string, start: Date, end: Date) {
  return {
    idempotency_key: idempotencyKey,
    signed_record_id: parsed.signedRecordId || null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    candidate_ids: candidateIds,
    customer: {
      name: parsed.customer.name,
      first_name: parsed.customer.first_name,
      last_name: parsed.customer.last_name,
      email: parsed.customer.email,
      phone: parsed.customer.phone,
    },
    intake: parsed.intake,
    source_agent: parsed.sourceAgent || null,
    business: parsed.business || null,
    brand: parsed.brand || null,
    verification_url: parsed.verificationUrl || null,
    service_type: parsed.serviceType || 'consultation_call',
    customer_invite: parsed.customerInvite !== false,
    source: 'seald',
    timezone: BUSINESS_TZ,
    note: intakeNote(parsed, formatCallWhen(start)),
    note_marker: noteMarker(parsed),
  }
}

async function readJson(req: Request) {
  const raw = await req.text()
  if (raw.length > MAX_BODY) return { error: json({ error: 'payload_too_large' }, 413) }
  if (!raw) return { raw, body: {} }
  try {
    return { raw, body: JSON.parse(raw) }
  } catch {
    return { error: json({ error: 'invalid_json' }, 400) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const { rest, url } = subpath(req)
  let db: SupabaseClient
  try {
    db = serviceClient()
  } catch {
    return json({ error: 'missing_supabase_env' }, 500)
  }

  try {
    if (req.method === 'POST' && rest === '/webhooks/seald') {
      return await handleWebhook(req, db)
    }

    const agent = await agentAuthorized(req)
    if (agent === 'unconfigured') {
      return json({ error: 'api_key_not_configured', message: 'Set SEALD_API_KEY or SEALD_API_KEY_SHA256.' }, 503)
    }
    const staff = agent === true ? false : await staffAuthorized(req, db)
    if (agent !== true && !staff) return json({ error: 'unauthorized' }, 401)

    if (req.method === 'GET' && rest === '/availability') {
      return await handleAvailability(db, url)
    }
    if (req.method === 'POST' && rest === '/bookings') {
      return await handleCreate(req, db, staff)
    }

    const outcome = rest.match(/^\/bookings\/([^/]+)\/outcome$/)
    if (req.method === 'POST' && outcome) return await handleOutcome(req, db, outcome[1])

    const sync = rest.match(/^\/bookings\/([^/]+)\/sync$/)
    if (req.method === 'POST' && sync) return await handleSync(db, sync[1])

    const one = rest.match(/^\/bookings\/([^/]+)$/)
    if (one && req.method === 'PATCH') return await handleReschedule(req, db, one[1])
    if (one && req.method === 'DELETE') return await handleCancel(db, one[1])

    return json({ error: 'not_found', message: 'See docs/BOOKING_SETUP.md for the SEALD contract.' }, 404)
  } catch (err) {
    console.error('booking function error', err instanceof Error ? err.message : err)
    return json({ error: 'internal_error' }, 500)
  }
})

async function handleAvailability(db: SupabaseClient, url: URL) {
  const startRaw = url.searchParams.get('start') || ''
  const endRaw = url.searchParams.get('end') || ''
  const rangeStart = new Date(startRaw)
  const rangeEnd = new Date(endRaw)
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd <= rangeStart) {
    return json({ error: 'invalid_range', message: 'Query start and end must be ISO 8601, with end after start.' }, 400)
  }
  if (rangeEnd.getTime() - rangeStart.getTime() > MAX_RANGE_MS) {
    return json({ error: 'range_too_large', message: 'Ask for at most 62 days at a time.' }, 400)
  }
  const members = (await loadMembers(db)).filter(m => m.active !== false)
  const minutes = consultationMinutes(members)
  const window = await loadWindow(db, rangeStart, rangeEnd)
  const outlook = await outlookBusy(members, rangeStart, rangeEnd)
  const { slots } = openSlots({
    members,
    blocks: window.blocks,
    appointments: window.appointments,
    busyByMember: outlook.busyByMember,
    rangeStart,
    rangeEnd,
    now: new Date(),
    slotMinutes: minutes,
  })
  return json({
    timezone: BUSINESS_TZ,
    slot_minutes: minutes,
    assignment: 'primary_then_backup',
    outlook: outlook.state,
    start: formatOffsetIso(rangeStart),
    end: formatOffsetIso(rangeEnd),
    slots: slots.map(slot => ({
      start: formatOffsetIso(slot.start),
      end: formatOffsetIso(slot.end),
      available_count: slot.available_count,
    })),
  })
}

async function handleCreate(req: Request, db: SupabaseClient, staff: boolean) {
  const read = await readJson(req)
  if (read.error) return read.error
  const parsed = normalizeBookingBody(read.body)
  if (!parsed.customer.name && parsed.customer.email) {
    const local = parsed.customer.email.split('@')[0] || 'Caller'
    parsed.customer.name = local
    parsed.customer.first_name = local
    parsed.customer.last_name = '—'
  }
  if (!parsed.customer.email && !parsed.customer.phone) {
    return json({ error: 'customer_required', message: 'customer email or phone is required.' }, 400)
  }
  const headerName = Deno.env.get('BOOKING_IDEMPOTENCY_HEADER') || DEFAULT_IDEMPOTENCY_HEADER
  let idem = headerLookup(req.headers, headerName) || parsed.idempotencyKey
  if (!idem) {
    if (!staff) return json({ error: 'idempotency_key_required', message: 'Send an Idempotency-Key header.' }, 400)
    idem = `staff-${crypto.randomUUID()}`
  }
  const members = (await loadMembers(db)).filter(m => m.active !== false)
  const minutes = consultationMinutes(members)
  const range = resolveRange(parsed.start, parsed.end, minutes)
  if (range.error) return range.error
  const picked = await candidateIdsFor(db, range.start, range.end, null)
  if (picked.outlook === 'unavailable') {
    return json({
      error: 'outlook_unavailable',
      message: 'Outlook free/busy could not be read, so the slot was not booked.',
    }, 503)
  }
  if (picked.candidateIds.length === 0) {
    return json({ error: 'slot_taken', message: 'That time is no longer available.' }, 409)
  }
  const { data, error } = await db.rpc('book_consultation', {
    p_request: bookingRequest(parsed, picked.candidateIds, idem, range.start, range.end),
  })
  if (error) return rpcFailure(error)
  const row = data as Record<string, unknown>
  let outlook = { status: String(row.outlook_sync_status || 'pending'), error: null as string | null }
  if (row.idempotent !== true || row.outlook_sync_status !== 'synced') {
    outlook = await syncOutlook(db, row, picked.members)
  }
  return json(publicBooking(row, outlook), row.idempotent === true ? 200 : 201)
}

async function handleReschedule(req: Request, db: SupabaseClient, id: string) {
  const read = await readJson(req)
  if (read.error) return read.error
  const parsed = normalizeBookingBody(read.body)
  const before = await db.from('appointments').select('id, team_member_id, outlook_event_id').eq('id', id).maybeSingle()
  if (before.error) return json({ error: 'booking_failed', message: before.error.message }, 500)
  if (!before.data) return json({ error: 'booking_not_found', message: 'No booking with that id.' }, 404)
  const everyone = await loadMembers(db)
  const members = everyone.filter(m => m.active !== false)
  const minutes = consultationMinutes(members)
  const range = resolveRange(parsed.start, parsed.end, minutes)
  if (range.error) return range.error
  const picked = await candidateIdsFor(db, range.start, range.end, id)
  if (picked.outlook === 'unavailable') {
    return json({
      error: 'outlook_unavailable',
      message: 'Outlook free/busy could not be read, so the call was not moved.',
    }, 503)
  }
  if (picked.candidateIds.length === 0) {
    return json({ error: 'slot_taken', message: 'That time is no longer available.' }, 409)
  }
  const { data, error } = await db.rpc('reschedule_consultation', {
    p_id: id,
    p_starts: range.start.toISOString(),
    p_ends: range.end.toISOString(),
    p_candidate_ids: picked.candidateIds,
  })
  if (error) return rpcFailure(error)
  const row = data as Record<string, unknown>
  const previousMember = everyone.find(member => member.id === before.data.team_member_id)
  const outlook = await syncOutlook(db, row, picked.members, {
    email: previousMember?.email,
    eventId: before.data.outlook_event_id,
    memberId: before.data.team_member_id,
  })
  return json(publicBooking(row, outlook))
}

async function handleCancel(db: SupabaseClient, id: string) {
  const before = await db.from('appointments').select('id, team_member_id, outlook_event_id').eq('id', id).maybeSingle()
  if (before.error) return json({ error: 'booking_failed', message: before.error.message }, 500)
  if (!before.data) return json({ error: 'booking_not_found', message: 'No booking with that id.' }, 404)
  const { data, error } = await db.rpc('cancel_consultation', { p_id: id })
  if (error) return rpcFailure(error)
  const row = data as Record<string, unknown>
  const members = await loadMembers(db)
  const previousMember = members.find(member => member.id === before.data.team_member_id)
  const outlook = await syncOutlook(db, row, members, {
    email: previousMember?.email,
    eventId: before.data.outlook_event_id,
    memberId: before.data.team_member_id,
  })
  return json(publicBooking(row, outlook))
}

async function handleOutcome(req: Request, db: SupabaseClient, id: string) {
  const read = await readJson(req)
  if (read.error) return read.error
  const status = String((read.body as { status?: string })?.status || '')
  const { data, error } = await db.rpc('set_consultation_outcome', { p_id: id, p_status: status })
  if (error) return rpcFailure(error)
  return json(publicBooking(data as Record<string, unknown>))
}

async function handleSync(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('appointments').select('*').eq('id', id).maybeSingle()
  if (error) return json({ error: 'booking_failed', message: error.message }, 500)
  if (!data) return json({ error: 'booking_not_found', message: 'No booking with that id.' }, 404)
  const membersForRow = await loadMembers(db)
  const member = membersForRow.find(item => item.id === data.team_member_id)
  const row = {
    ...data,
    team_member_email: member?.email,
    team_member_name: member?.display_name,
  }
  const outlook = await syncOutlook(db, row, membersForRow)
  return json(publicBooking(row, outlook))
}

async function findForChange(db: SupabaseClient, parsed: ReturnType<typeof normalizeBookingBody>) {
  if (parsed.bookingId) {
    const { data } = await db.from('appointments').select('id').eq('id', parsed.bookingId).maybeSingle()
    if (data) return data.id as string
  }
  if (parsed.idempotencyKey) {
    const { data } = await db.from('appointments').select('id').eq('idempotency_key', parsed.idempotencyKey).maybeSingle()
    if (data) return data.id as string
  }
  if (parsed.signedRecordId) {
    const { data } = await db.from('appointments').select('id').eq('signed_record_id', parsed.signedRecordId).order('created_at', { ascending: false }).limit(1)
    if (data && data.length === 1) return data[0].id as string
  }
  if (parsed.customer.email) {
    const { data } = await db.from('appointments').select('id').eq('status', 'scheduled').eq('customer_email', parsed.customer.email)
    if (data && data.length === 1) return data[0].id as string
  }
  return null
}

async function recordEvent(
  db: SupabaseClient,
  parsed: ReturnType<typeof normalizeBookingBody>,
  raw: unknown,
  appointmentId: string | null,
  status = 200,
  body: unknown = null,
) {
  const row = {
    event_id: parsed.eventId,
    event_type: parsed.eventType || 'booking.created',
    appointment_id: appointmentId,
    payload: raw,
  }
  let { error } = await db.from('booking_webhook_events').insert({ ...row, response_status: status, response_body: body })
  // Until migration 20261012000004 is applied, the response columns do not exist.
  if (error && error.code === 'PGRST204') ({ error } = await db.from('booking_webhook_events').insert(row))
  if (error && error.code !== '23505') console.error('webhook event log failed', error.message)
}

async function handleWebhook(req: Request, db: SupabaseClient) {
  const secret = Deno.env.get('SEALD_WEBHOOK_SECRET') || ''
  if (!secret) return json({ error: 'webhook_secret_not_configured' }, 503)
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json({ error: 'payload_too_large' }, 413)
  // Seald-Signature: t=<unix>,v1=<hex hmac-sha256 of `${t}.${rawBody}`>; 300 s tolerance.
  const sigError = await verifySealdSignature(raw, headerLookup(req.headers, SEALD_SIGNATURE_HEADER), secret, Date.now())
  if (sigError) return json({ error: sigError }, 401)

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const parsed = normalizeBookingBody(payload)
  if (parsed.version !== SEALD_PAYLOAD_VERSION) return json({ error: 'unsupported_version', v: parsed.version }, 400)
  // Seald-Idempotency-Key is the event id and is stable across retries.
  const key = headerLookup(req.headers, SEALD_IDEMPOTENCY_HEADER) || parsed.eventId
  if (!key) return json({ error: 'event_id_required' }, 400)
  parsed.eventId = key
  if (!parsed.eventType) parsed.eventType = 'booking.created'
  if (!['booking.created', 'booking.updated', 'booking.cancelled', 'booking.canceled'].includes(parsed.eventType)) {
    return json({ ok: true, ignored: true, reason: 'unknown_event_type', type: parsed.eventType })
  }
  // Test-sends are verified but never create a lead, appointment, or log row.
  if (parsed.test) return json({ ok: true, test: true, ignored: true, event_id: key })

  let seen = await db.from('booking_webhook_events')
    .select('event_id, appointment_id, response_status, response_body')
    .eq('event_id', key).maybeSingle()
  if (seen.error) {
    seen = await db.from('booking_webhook_events').select('event_id, appointment_id').eq('event_id', key).maybeSingle()
  }
  if (seen.data) {
    const prior = seen.data.response_body as Record<string, unknown> | null
    if (prior && typeof prior === 'object') {
      return json({ ...prior, duplicate: true }, Number(seen.data.response_status) || 200)
    }
    return json({ ok: true, duplicate: true, appointment_id: seen.data.appointment_id })
  }

  const kind = statusFromEvent(parsed)
  let appointmentId: string | null = null
  let resultBody: unknown = { ok: true }

  if (kind === 'cancelled') {
    const found = await findForChange(db, parsed)
    if (!found) {
      await recordEvent(db, parsed, payload, null, 200, { ok: true, matched: false })
      return json({ ok: true, matched: false })
    }
    const cancelled = await handleCancel(db, found)
    if (cancelled.status >= 300) return cancelled
    appointmentId = found
    resultBody = { ok: true, booking: await cancelled.json() }
  } else if (kind === 'completed' || kind === 'no_show') {
    const found = await findForChange(db, parsed)
    if (!found) {
      await recordEvent(db, parsed, payload, null, 200, { ok: true, matched: false })
      return json({ ok: true, matched: false })
    }
    const { data, error } = await db.rpc('set_consultation_outcome', { p_id: found, p_status: kind })
    if (error) return rpcFailure(error)
    appointmentId = found
    resultBody = { ok: true, booking: publicBooking(data as Record<string, unknown>) }
  } else if (kind === 'rescheduled') {
    const found = await findForChange(db, parsed)
    if (found) {
      const moved = await handleReschedule(new Request(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start: parsed.start, end: parsed.end }),
      }), db, found)
      if (moved.status >= 300) return moved
      appointmentId = found
      resultBody = { ok: true, booking: await moved.json() }
    } else {
      const created = await handleCreate(new Request(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': parsed.eventId },
        body: raw,
      }), db, true)
      if (created.status >= 300) return created
      const booking = await created.json()
      appointmentId = booking.id || null
      resultBody = { ok: true, booking }
    }
  } else {
    const idem = parsed.idempotencyKey || parsed.signedRecordId || parsed.eventId
    const created = await handleCreate(new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idem },
      body: raw,
    }), db, true)
    if (created.status >= 300) return created
    const booking = await created.json()
    appointmentId = booking.id || null
    resultBody = { ok: true, booking }
  }

  await recordEvent(db, parsed, payload, appointmentId, 200, resultBody)
  return json(resultBody)
}
