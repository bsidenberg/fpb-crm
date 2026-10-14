// Column order for the pipeline board.
// Booked calls float to the top (their created_at is often years old once a
// past customer books again). Everyone else stays oldest-in-column first.

function time(value) {
  const t = new Date(value || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

export function bookedRecency(lead) {
  return time(lead?.appointment?.starts_at || lead?.updated_at || lead?.stage_changed_at || lead?.created_at)
}

export function compareColumnLeads(a, b) {
  const booked = (b?.booked_call ? 1 : 0) - (a?.booked_call ? 1 : 0)
  if (booked) return booked
  if (a?.booked_call || b?.booked_call) return bookedRecency(b) - bookedRecency(a)
  return time(a?.stage_changed_at || a?.created_at) - time(b?.stage_changed_at || b?.created_at)
}
