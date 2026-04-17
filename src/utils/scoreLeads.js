/**
 * Calculates a lead quality score (0–100) and a detailed breakdown.
 * @param {object} lead          - Lead row from Supabase
 * @param {number} activityCount - Number of logged activities for this lead
 * @returns {{ score: number, breakdown: Array<{label: string, pts: number}> }}
 */
export function calculateScore(lead, activityCount = 0) {
  const breakdown = []
  let raw = 0

  // ── Land & readiness ─────────────────────────────────────────
  if (lead.land_owned === true) {
    raw += 20; breakdown.push({ label: 'Owns land', pts: 20 })
  }

  // ── Timeline ─────────────────────────────────────────────────
  const tl = lead.timeline?.toLowerCase() ?? ''
  if (['as soon as possible', 'asap', 'immediately', '1-3 months'].includes(tl)) {
    raw += 15; breakdown.push({ label: 'Timeline: short-term', pts: 15 })
  } else if (tl === '3-6 months') {
    raw += 8; breakdown.push({ label: 'Timeline: 3–6 months', pts: 8 })
  }

  // ── Service type ──────────────────────────────────────────────
  if (lead.service_type === 'Kit + Installation') {
    raw += 12; breakdown.push({ label: 'Service: Kit + Installation', pts: 12 })
  } else if (lead.service_type === 'Kit Delivery Only') {
    raw += 6; breakdown.push({ label: 'Service: Kit Delivery Only', pts: 6 })
  }

  // ── Budget ───────────────────────────────────────────────────
  if (lead.budget_range && lead.budget_range.trim() !== '') {
    raw += 10; breakdown.push({ label: 'Budget range specified', pts: 10 })
  }

  // ── Contact completeness ─────────────────────────────────────
  if (lead.phone && lead.phone.trim() !== '') {
    raw += 10; breakdown.push({ label: 'Has phone', pts: 10 })
  }
  if (lead.email && lead.email.trim() !== '') {
    raw += 3; breakdown.push({ label: 'Has email', pts: 3 })
  }

  // ── Source ───────────────────────────────────────────────────
  if (lead.source === 'Referral' || lead.lead_source === 'Referral') {
    raw += 8; breakdown.push({ label: 'Referral source', pts: 8 })
  }

  // ── Engagement — tiered by activity count ────────────────────
  if (activityCount >= 3) {
    raw += 10; breakdown.push({ label: `${activityCount} activities logged`, pts: 10 })
  } else if (activityCount >= 1) {
    raw += 5; breakdown.push({ label: `${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} logged`, pts: 5 })
  }

  // ── Follow-up ────────────────────────────────────────────────
  if (lead.follow_up_date) {
    raw += 5; breakdown.push({ label: 'Follow-up date set', pts: 5 })
    const overdue = new Date(lead.follow_up_date) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    if (overdue) {
      raw -= 10; breakdown.push({ label: 'Follow-up overdue 7+ days', pts: -10 })
    }
  }

  // ── HOA ──────────────────────────────────────────────────────
  if (lead.hoa === false) {
    raw += 5; breakdown.push({ label: 'No HOA', pts: 5 })
  }

  // ── Barn size ────────────────────────────────────────────────
  if (lead.barn_size && lead.barn_size.trim() !== '') {
    raw += 5; breakdown.push({ label: 'Barn size specified', pts: 5 })
  }

  // ── Deal value ───────────────────────────────────────────────
  if (Number(lead.value) >= 25000) {
    raw += 7; breakdown.push({ label: 'Value ≥ $25K', pts: 7 })
  }

  const score = Math.min(100, Math.max(0, raw))
  return { score, breakdown }
}

/**
 * Returns grade metadata for a 0–100 score.
 */
export function getScoreGrade(score) {
  if (score >= 70) return { grade: 'A', color: '#16A34A', bg: '#DCFCE7', label: 'Hot'    }
  if (score >= 50) return { grade: 'B', color: '#2B3A6B', bg: '#EEF1F9', label: 'Warm'   }
  if (score >= 30) return { grade: 'C', color: '#D97706', bg: '#FEF3C7', label: 'Nurture' }
  return               { grade: 'D', color: '#6B7280', bg: '#F3F4F6',  label: 'Cold'    }
}
