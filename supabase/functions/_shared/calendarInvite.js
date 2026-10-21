// Shop-facing Outlook invite body. The brand is Booqer; this text does not
// mention SEALD, the signed record, or a separate reminder.

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function filled(value) {
  return value != null && String(value).trim() !== ''
}

export function calendarInviteContent(input = {}) {
  const crm = `https://fpbcrm-alpha.vercel.app/leads/${encodeURIComponent(input.leadId || '')}`
  const intake = input.intake || {}
  const notes = intake.notes || intake.description || ''
  const rows = [
    ['Customer', input.name],
    ['Email', input.email || ''],
    ['Phone', input.phone || ''],
    ['With', input.assignee || ''],
    ['Size', intake.size],
    ['Location', intake.location],
    ['Notes', notes],
  ].filter(([, value]) => filled(value))
  const list = rows.map(([label, value]) => `<div><strong>${esc(label)}:</strong> ${esc(value)}</div>`).join('')
  return {
    subject: `FPB consultation — ${input.name || 'New lead'}`,
    html: `<div>${list}<div><a href="${esc(crm)}">Open in FPB CRM</a></div></div>`,
  }
}
