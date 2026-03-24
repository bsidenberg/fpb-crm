import { createClient } from 'supabase'

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!

const CRM_BASE = 'https://fpbcrm-alpha.vercel.app'

interface Lead {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  city: string | null
  stage: string | null
  barn_size: string | null
  value: number | null
  follow_up_date: string
}

function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatValue(v: number | null): string {
  if (!v) return '—'
  return '$' + Number(v).toLocaleString()
}

function formatDate(s: string): string {
  try {
    const [y, m, d] = s.split('-')
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return s
  }
}

function leadRow(lead: Lead, borderColor: string): string {
  const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unknown'
  const url  = `${CRM_BASE}/leads/${lead.id}`
  return `
    <tr>
      <td style="padding:10px 14px;border-left:3px solid ${borderColor};border-bottom:1px solid #F0EDEA;">
        <a href="${url}" style="font-weight:600;color:#1C1917;text-decoration:none;font-size:14px;">${name}</a>
        <div style="margin-top:3px;font-size:12px;color:#6B7280;">
          ${[lead.city, lead.stage, lead.barn_size].filter(Boolean).join(' · ') || '—'}
        </div>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;color:#374151;white-space:nowrap;">
        ${lead.phone
          ? `<a href="tel:${lead.phone}" style="color:#374151;text-decoration:none;">${lead.phone}</a>`
          : '—'}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;color:#374151;white-space:nowrap;">
        ${formatDate(lead.follow_up_date)}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #F0EDEA;font-size:13px;font-weight:600;color:#1C1917;white-space:nowrap;">
        ${formatValue(lead.value)}
      </td>
    </tr>`
}

function section(title: string, color: string, leads: Lead[]): string {
  if (leads.length === 0) return ''
  return `
    <tr>
      <td colspan="4" style="padding:18px 14px 8px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${color};">
          ${title} (${leads.length})
        </div>
      </td>
    </tr>
    ${leads.map(l => leadRow(l, color)).join('')}`
}

function buildEmail(overdue: Lead[], dueToday: Lead[], today: string): string {
  const total = overdue.length + dueToday.length

  if (total === 0) {
    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F9F6F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#C0392B;padding:18px 24px;">
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Florida Pole Barn</span>
      <span style="color:rgba(255,255,255,0.6);font-size:12px;margin-left:10px;text-transform:uppercase;letter-spacing:1px;">Sales CRM</span>
    </div>
    <div style="padding:32px 24px;text-align:center;">
      <div style="font-size:32px;margin-bottom:12px;">✅</div>
      <div style="font-size:18px;font-weight:600;color:#1C1917;margin-bottom:8px;">All Clear for ${today}</div>
      <div style="font-size:14px;color:#6B7280;">No overdue or due-today follow-ups. Great work!</div>
    </div>
    <div style="background:#F9F6F3;padding:14px 24px;text-align:center;font-size:11px;color:#9CA3AF;">
      140+ MPH Wind Rated · Made in USA · Florida Code Compliant
    </div>
  </div>
</body></html>`
  }

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
        Follow-Up Digest — ${today}
      </div>
      <div style="font-size:13px;color:#6B7280;padding-bottom:14px;">
        ${total} lead${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} attention today
        ${overdue.length > 0 ? `<span style="color:#EF4444;font-weight:600;margin-left:6px;">· ${overdue.length} overdue</span>` : ''}
      </div>
    </div>

    <!-- Table -->
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#F9F6F3;">
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Lead</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Phone</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Due Date</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9CA3AF;border-bottom:1px solid #F0EDEA;">Est. Value</th>
        </tr>
      </thead>
      <tbody>
        ${section('Overdue', '#EF4444', overdue)}
        ${section('Due Today', '#D4872A', dueToday)}
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
    const today = todayStr()

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, city, stage, barn_size, value, follow_up_date')
      .lte('follow_up_date', today)
      .not('stage', 'in', '(won,lost)')
      .order('follow_up_date', { ascending: true })

    if (error) throw error

    const all     = (leads ?? []) as Lead[]
    const overdue  = all.filter(l => l.follow_up_date < today)
    const dueToday = all.filter(l => l.follow_up_date === today)
    const total    = overdue.length + dueToday.length

    const subject = total === 0
      ? `FPB Follow-Ups for ${today} — All clear!`
      : `FPB Follow-Ups for ${today} — ${total} lead${total !== 1 ? 's' : ''} need attention`

    const html = buildEmail(overdue, dueToday, today)

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
      throw new Error(`Resend error ${res.status}: ${body}`)
    }

    return new Response(
      JSON.stringify({ ok: true, sent: total, overdue: overdue.length, today: dueToday.length }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('daily-followup-digest error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
