import { createClient } from 'supabase'

const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!

const CRM_BASE = 'https://fpbcrm-alpha.vercel.app'

interface Lead {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  city: string | null
  value: number | null
  quote_sent_at: string | null
}

// Lead fields come from web-form input — escape before putting them in HTML.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// .in() filters go in the GET URL; chunk so long id lists can't exceed it.
const ID_CHUNK = 100
// PostgREST's default max rows per response.
const ROW_CAP = 1000

function formatValue(v: number | null): string {
  if (!v) return '—'
  return '$' + Number(v).toLocaleString()
}

function buildEmail(leads: Lead[]): string {
  const count = leads.length

  const rows = leads.map(lead => {
    const name = esc(`${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unknown')
    const url  = `${CRM_BASE}/leads/${encodeURIComponent(lead.id)}`
    const tel  = (lead.phone ?? '').replace(/[^\d+]/g, '')
    return `
    <tr>
      <td style="padding:10px 14px;border-left:3px solid #D97706;border-bottom:1px solid #F0EDEA;">
        <a href="${url}" style="font-weight:600;color:#1C1917;text-decoration:none;font-size:14px;">${name}</a>
        <div style="margin-top:3px;font-size:12px;color:#6B7280;">${esc(lead.city ?? '—')}</div>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;color:#374151;white-space:nowrap;">
        ${lead.phone
          ? `<a href="tel:${tel}" style="color:#374151;text-decoration:none;">${esc(lead.phone)}</a>`
          : '—'}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;font-weight:600;color:#1C1917;white-space:nowrap;">
        ${formatValue(lead.value)}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;">
        <a href="${url}" style="font-size:12px;color:#C0392B;text-decoration:none;font-weight:600;">View →</a>
      </td>
    </tr>`
  }).join('')

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F9F6F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#C0392B;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Florida Pole Barn</span>
      <span style="color:rgba(255,255,255,0.75);font-size:12px;text-transform:uppercase;letter-spacing:1px;">Sales CRM</span>
    </div>

    <!-- Subheader -->
    <div style="padding:16px 24px 0;border-bottom:1px solid #F0EDEA;">
      <div style="font-size:16px;font-weight:700;color:#1C1917;margin-bottom:4px;">
        Auto Follow-Up Alert
      </div>
      <div style="font-size:13px;color:#6B7280;padding-bottom:14px;">
        ${count} lead${count !== 1 ? 's' : ''} auto-moved to <strong style="color:#D97706;">Contacted - Waiting on Them</strong> — no activity for 24 hours after the estimate was sent
      </div>
    </div>

    <!-- Table -->
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#F9F6F3;">
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Lead</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Phone</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Est. Value</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;"></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <!-- Footer -->
    <div style="background:#F9F6F3;padding:14px 24px;text-align:center;font-size:11px;color:#9CA3AF;border-top:1px solid #F0EDEA;">
      140+ MPH Wind Rated · Made in USA · Florida Code Compliant
    </div>
  </div>
</body></html>`
}

Deno.serve(async () => {
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // 1. Find leads in Estimate Sent whose estimate went out 24+ hours ago.
    //    Leads with NULL quote_sent_at (sent before the column existed) never
    //    match .lt() and are deliberately left alone.
    const { data: candidates, error: fetchErr } = await db
      .from('leads')
      .select('id, first_name, last_name, phone, city, value, quote_sent_at')
      .eq('stage', 'estimate_sent')
      .lt('quote_sent_at', cutoff)

    if (fetchErr) throw fetchErr

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, moved: 0, message: 'No stale quotes found' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 2. Filter out any lead that has had activity in the last 24 hours
    const candidateIds = candidates.map((l: Lead) => l.id)

    //    Fail CLOSED: if activity can't be read reliably, move nothing.
    const activeLeadIds = new Set<string>()
    for (let i = 0; i < candidateIds.length; i += ID_CHUNK) {
      const chunk = candidateIds.slice(i, i + ID_CHUNK)
      const { data: recentActivity, error: actFetchErr } = await db
        .from('activities')
        .select('lead_id')
        .in('lead_id', chunk)
        .gt('created_at', cutoff)
        .limit(ROW_CAP)
      if (actFetchErr) throw actFetchErr
      // A full page may be truncated — some active leads could be missing.
      if ((recentActivity ?? []).length >= ROW_CAP) {
        throw new Error('activities result hit row cap; refusing to move leads')
      }
      for (const a of recentActivity ?? []) activeLeadIds.add(a.lead_id)
    }
    const stale = candidates.filter((l: Lead) => !activeLeadIds.has(l.id))

    if (stale.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, moved: 0, message: 'All quoted leads have recent activity' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 3. Move each stale lead to Contacted - Waiting on Them and log an activity.
    //    Re-check the stage in the UPDATE so a lead someone moved in the
    //    meantime is not yanked back; only rows actually moved are reported.
    //    Also re-check quote_sent_at: a lead re-quoted mid-run has a fresh stamp.
    const staleAll = stale.map((l: Lead) => l.id)
    //    Each chunk commits on its own. If a later chunk fails, stop but still
    //    log notes + email for the rows already moved, so no write goes unreported.
    const movedIds = new Set<string>()
    let updateErr: unknown = null
    for (let i = 0; i < staleAll.length; i += ID_CHUNK) {
      const { data: movedRows, error } = await db
        .from('leads')
        .update({ stage: 'contacted_waiting', stage_changed_at: new Date().toISOString() })
        .in('id', staleAll.slice(i, i + ID_CHUNK))
        .eq('stage', 'estimate_sent')
        .lt('quote_sent_at', cutoff)
        .select('id')
      if (error) { updateErr = error; console.error('update chunk failed:', error); break }
      for (const r of movedRows ?? []) movedIds.add(r.id)
    }

    const moved = stale.filter((l: Lead) => movedIds.has(l.id))
    const staleIds = moved.map((l: Lead) => l.id)

    if (moved.length === 0) {
      if (updateErr) throw updateErr
      return new Response(
        JSON.stringify({ ok: true, moved: 0, message: 'Candidates changed stage before update' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    const activityRows = staleIds.map((lead_id: string) => ({
      lead_id,
      type: 'note',
      body: 'Auto-moved to Contacted - Waiting on Them: no activity for 24 hours after the estimate was sent',
      author: 'FPB CRM Bot',
    }))

    const { error: actErr } = await db.from('activities').insert(activityRows)
    if (actErr) console.error('activity insert failed (leads already moved):', actErr)

    // 4. Send ONE summary email (staff inbox only) via Resend
    const subject = `FPB CRM: ${moved.length} lead${moved.length !== 1 ? 's' : ''} auto-moved to Contacted - Waiting on Them`
    const html = buildEmail(moved as Lead[])

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@floridapolebarn.com',
        to:   'info@floridapolebarn.com',
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('Resend error:', res.status, body)
      // Don't throw — leads were already moved; email failure is non-fatal
    }

    return new Response(
      JSON.stringify({
        ok: !updateErr, moved: moved.length, ids: staleIds, activityLogged: !actErr,
        ...(updateErr ? { error: String((updateErr as { message?: string }).message ?? updateErr) } : {}),
      }),
      { status: updateErr ? 500 : 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('quote-followup-check error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
