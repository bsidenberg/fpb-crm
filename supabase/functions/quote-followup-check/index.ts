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
  quote_sent_at: string
}

function formatValue(v: number | null): string {
  if (!v) return '—'
  return '$' + Number(v).toLocaleString()
}

function buildEmail(leads: Lead[]): string {
  const count = leads.length

  const rows = leads.map(lead => {
    const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unknown'
    const url  = `${CRM_BASE}/leads/${lead.id}`
    return `
    <tr>
      <td style="padding:10px 14px;border-left:3px solid #D97706;border-bottom:1px solid #F0EDEA;">
        <a href="${url}" style="font-weight:600;color:#1C1917;text-decoration:none;font-size:14px;">${name}</a>
        <div style="margin-top:3px;font-size:12px;color:#6B7280;">${lead.city ?? '—'}</div>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;color:#374151;white-space:nowrap;">
        ${lead.phone
          ? `<a href="tel:${lead.phone}" style="color:#374151;text-decoration:none;">${lead.phone}</a>`
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
        ${count} lead${count !== 1 ? 's' : ''} auto-moved to <strong style="color:#D97706;">Follow-Up</strong> — no response after 24 hours in Quote Sent
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

    // 1. Find all leads still in quote_sent for 24+ hours
    const { data: candidates, error: fetchErr } = await db
      .from('leads')
      .select('id, first_name, last_name, phone, city, value, quote_sent_at')
      .eq('stage', 'quote_sent')
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

    const { data: recentActivity } = await db
      .from('activities')
      .select('lead_id')
      .in('lead_id', candidateIds)
      .gt('created_at', cutoff)

    const activeLeadIds = new Set((recentActivity ?? []).map((a: { lead_id: string }) => a.lead_id))
    const stale = candidates.filter((l: Lead) => !activeLeadIds.has(l.id))

    if (stale.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, moved: 0, message: 'All quoted leads have recent activity' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 3. Move each stale lead to follow_up and log an activity
    const staleIds = stale.map((l: Lead) => l.id)

    const { error: updateErr } = await db
      .from('leads')
      .update({ stage: 'follow_up' })
      .in('id', staleIds)

    if (updateErr) throw updateErr

    const activityRows = staleIds.map((lead_id: string) => ({
      lead_id,
      type: 'note',
      body: 'Auto-moved to Follow-Up: no response after 24 hours in Quote Sent',
      author: 'FPB CRM Bot',
    }))

    await db.from('activities').insert(activityRows)

    // 4. Send summary email via Resend
    const subject = `FPB CRM: ${stale.length} lead${stale.length !== 1 ? 's' : ''} auto-moved to Follow-Up`
    const html = buildEmail(stale as Lead[])

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
      JSON.stringify({ ok: true, moved: stale.length, ids: staleIds }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('quote-followup-check error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
