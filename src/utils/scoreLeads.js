/**
 * Calculates a lead quality score (0–100) and a detailed breakdown.
 * @param {object} lead       - Lead row from Supabase
 * @param {number} activityCount - Number of logged activities for this lead
 * @returns {{ score: number, breakdown: Array<{label: string, pts: number}> }}
 */
export function calculateScore(lead, activityCount = 0) {
  const breakdown = []
  let raw = 0

  // ── Contact completeness ─────────────────────────────────────
  if (lead.email)   { raw += 10; breakdown.push({ label: 'Has email',         pts: 10 }) }
  if (lead.phone)   { raw += 10; breakdown.push({ label: 'Has phone',         pts: 10 }) }
  if (lead.company) { raw +=  5; breakdown.push({ label: 'Has company',       pts:  5 }) }
  if (lead.address) { raw +=  5; breakdown.push({ label: 'Has address',       pts:  5 }) }

  // ── Deal signals ─────────────────────────────────────────────
  const value = Number(lead.value) || 0
  if (value >= 50000)      { raw += 20; breakdown.push({ label: 'Value ≥ $50K',          pts: 20 }) }
  else if (value >= 25000) { raw += 15; breakdown.push({ label: 'Value $25K – $50K',     pts: 15 }) }
  else if (value >= 10000) { raw += 10; breakdown.push({ label: 'Value $10K – $25K',     pts: 10 }) }

  if (lead.barn_size)             { raw += 15; breakdown.push({ label: 'Barn size specified', pts: 15 }) }
  if (lead.source === 'Referral') { raw += 10; breakdown.push({ label: 'Referral source',     pts: 10 }) }
  if (lead.source === 'Website')  { raw +=  5; breakdown.push({ label: 'Website source',      pts:  5 }) }

  // ── Engagement signals ───────────────────────────────────────
  if (activityCount > 0) { raw += 15; breakdown.push({ label: `${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} logged`, pts: 15 }) }

  if (lead.follow_up_date) {
    raw += 10
    breakdown.push({ label: 'Follow-up date set', pts: 10 })

    const daysPast = (Date.now() - new Date(lead.follow_up_date).getTime()) / 86_400_000
    if (daysPast > 7) {
      raw -= 10
      breakdown.push({ label: 'Follow-up overdue 7+ days', pts: -10 })
    }
  }

  // ── Temperature override ─────────────────────────────────────
  if (lead.priority === 'hot')  { raw += 10; breakdown.push({ label: 'Hot lead',  pts: 10 }) }
  if (lead.priority === 'warm') { raw +=  5; breakdown.push({ label: 'Warm lead', pts:  5 }) }

  const score = Math.min(100, Math.max(0, raw))
  return { score, breakdown }
}

/**
 * Returns grade metadata for a 0–100 score.
 */
export function getScoreGrade(score) {
  if (score >= 80) return { grade: 'A', color: '#16A34A', bg: '#DCFCE7', label: 'High Priority' }
  if (score >= 60) return { grade: 'B', color: '#2B3A6B', bg: '#EEF1F9', label: 'Qualified'     }
  if (score >= 40) return { grade: 'C', color: '#D97706', bg: '#FEF3C7', label: 'Nurture'        }
  return               { grade: 'D', color: '#6B7280', bg: '#F3F4F6', label: 'Cold'              }
}
