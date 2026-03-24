/** Returns 'YYYY-MM-DD' for a given Date in local time */
export function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayStr() {
  return toLocalDateStr()
}

export function in7DaysStr() {
  return toLocalDateStr(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
}

/**
 * Returns 'overdue' | 'today' | 'upcoming' | 'future' | null
 * 'upcoming' = within the next 7 days
 * 'future'   = beyond 7 days
 * null       = no follow_up_date set
 */
export function getFollowUpStatus(dateStr) {
  if (!dateStr) return null
  const today = todayStr()
  if (dateStr < today) return 'overdue'
  if (dateStr === today) return 'today'
  if (dateStr <= in7DaysStr()) return 'upcoming'
  return 'future'
}
