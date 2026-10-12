// Microsoft Graph application (client credentials) calendar access.
// When MICROSOFT_TENANT_ID / CLIENT_ID / CLIENT_SECRET are unset, callers
// treat the integration as not configured and still keep the CRM booking.

import { formatWallClock, parseGraphDate, BUSINESS_TZ } from '../_shared/bookingSlots.js'

const BUSY = new Set(['busy', 'oof', 'tentative', 'workingelsewhere'])
export const REMINDER_MINUTES = 60

export type GraphConfig = { tenant: string, clientId: string, clientSecret: string }

let tokenCache: { token: string, exp: number } | null = null

export function microsoftConfig(): GraphConfig | null {
  const tenant = Deno.env.get('MICROSOFT_TENANT_ID') || ''
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') || ''
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET') || ''
  if (!tenant || !clientId || !clientSecret) return null
  return { tenant, clientId, clientSecret }
}

async function token(cfg: GraphConfig): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`graph_token_${res.status}: ${text.slice(0, 240)}`)
  }
  const json = await res.json()
  tokenCache = { token: json.access_token, exp: Date.now() + Number(json.expires_in || 3600) * 1000 }
  return json.access_token
}

async function graph(cfg: GraphConfig, path: string, init: RequestInit = {}) {
  const access = await token(cfg)
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${access}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers })
  return res
}

export type BusyInterval = { start: Date, end: Date }

/** Free/busy for every mailbox. Throws if Graph rejects the call. */
export async function getSchedule(
  cfg: GraphConfig,
  emails: string[],
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Record<string, BusyInterval[]>> {
  if (emails.length === 0) return {}
  const anchor = emails[0]
  const res = await graph(cfg, `/users/${encodeURIComponent(anchor)}/calendar/getSchedule`, {
    method: 'POST',
    body: JSON.stringify({
      schedules: emails,
      startTime: { dateTime: formatWallClock(rangeStart), timeZone: BUSINESS_TZ },
      endTime: { dateTime: formatWallClock(rangeEnd), timeZone: BUSINESS_TZ },
      availabilityViewInterval: 30,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`getSchedule_${res.status}: ${text.slice(0, 240)}`)
  }
  const json = await res.json()
  const out: Record<string, BusyInterval[]> = {}
  for (const row of json.value || []) {
    const email = String(row.scheduleId || '').toLowerCase()
    const items = Array.isArray(row.scheduleItems) ? row.scheduleItems : []
    out[email] = []
    for (const item of items) {
      const status = String(item.status || '').toLowerCase()
      if (!BUSY.has(status)) continue
      const start = parseGraphDate(item.start?.dateTime, item.start?.timeZone || BUSINESS_TZ)
      const end = parseGraphDate(item.end?.dateTime, item.end?.timeZone || BUSINESS_TZ)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
      out[email].push({ start, end })
    }
  }
  return out
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function createEvent(cfg: GraphConfig, mailbox: string, event: Record<string, unknown>) {
  const res = await graph(cfg, `/users/${encodeURIComponent(mailbox)}/events`, {
    method: 'POST',
    body: JSON.stringify(event),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`create_event_${res.status}: ${text.slice(0, 300)}`)
  const json = text ? JSON.parse(text) : {}
  if (!json.id) throw new Error('create_event_missing_id')
  return String(json.id)
}

export async function updateEvent(cfg: GraphConfig, mailbox: string, eventId: string, patch: Record<string, unknown>) {
  const res = await graph(cfg, `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (res.status === 404) return false
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`update_event_${res.status}: ${text.slice(0, 300)}`)
  }
  return true
}

export async function deleteEvent(cfg: GraphConfig, mailbox: string, eventId: string) {
  const res = await graph(cfg, `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
  if (res.status === 404) return false
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`delete_event_${res.status}: ${text.slice(0, 300)}`)
  }
  return true
}

export function eventContent(input: {
  leadId: string
  name: string
  email?: string
  phone?: string
  intake?: Record<string, unknown> | null
  sourceAgent?: string | null
  verificationUrl?: string | null
  assignee?: string
}) {
  const crm = `https://fpbcrm-alpha.vercel.app/leads/${encodeURIComponent(input.leadId)}`
  const intake = input.intake || {}
  const rows = [
    ['Customer', input.name],
    ['Email', input.email || ''],
    ['Phone', input.phone || ''],
    ['With', input.assignee || ''],
    ['Building', intake.building_type],
    ['Size', intake.size],
    ['Location', intake.location],
    ['Timeline', intake.timeline],
    ['Source agent', input.sourceAgent || ''],
  ].filter(([, value]) => value)
  const list = rows.map(([label, value]) => `<div><strong>${esc(label)}:</strong> ${esc(value)}</div>`).join('')
  const verify = input.verificationUrl
    ? `<div><a href="${esc(input.verificationUrl)}">Signed record</a></div>`
    : ''
  return {
    subject: `FPB consultation — ${input.name || 'New lead'}`,
    html: `<div>${list}<div><a href="${esc(crm)}">Open in FPB CRM</a></div>${verify}<div>Reminder is ${REMINDER_MINUTES} minutes before the call. SEALD does not send a separate reminder.</div></div>`,
  }
}
