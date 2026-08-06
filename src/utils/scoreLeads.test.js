import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateScore, getScoreGrade } from './scoreLeads.js'

describe('calculateScore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns 0 with empty breakdown for an empty lead', () => {
    const { score, breakdown } = calculateScore({})
    expect(score).toBe(0)
    expect(breakdown).toEqual([])
  })

  it('scores a fully-qualified hot lead and caps at 100', () => {
    const lead = {
      land_owned: true,          // 20
      timeline: 'ASAP',          // 15
      service_type: 'Kit + Installation', // 12
      budget_range: '$50k+',     // 10
      phone: '555-1234',         // 10
      email: 'a@b.com',          // 3
      source: 'Referral',        // 8
      follow_up_date: '2026-08-10', // 5, not overdue
      hoa: false,                // 5
      barn_size: '40x60',        // 5
      value: 30000,              // 7
    }
    const { score } = calculateScore(lead, 3) // +10 activities
    expect(score).toBe(100) // raw 110 capped
  })

  it('tiers timeline: short-term 15, 3-6 months 8, long-term 0', () => {
    expect(calculateScore({ timeline: '1-3 months' }).score).toBe(15)
    expect(calculateScore({ timeline: '3-6 months' }).score).toBe(8)
    expect(calculateScore({ timeline: '12+ months' }).score).toBe(0)
  })

  it('tiers engagement: 1-2 activities = 5, 3+ = 10', () => {
    expect(calculateScore({}, 1).score).toBe(5)
    expect(calculateScore({}, 2).score).toBe(5)
    expect(calculateScore({}, 3).score).toBe(10)
  })

  it('penalizes follow-ups overdue by more than 7 days', () => {
    const recent = calculateScore({ follow_up_date: '2026-08-01' }) // 5 days ago
    expect(recent.score).toBe(5)
    const stale = calculateScore({ follow_up_date: '2026-07-20' }) // 17 days ago
    expect(stale.score).toBe(0) // +5 for date set, -10 overdue, floored at 0
    expect(stale.breakdown).toContainEqual({ label: 'Follow-up overdue 7+ days', pts: -10 })
  })

  it('never returns below 0', () => {
    expect(calculateScore({ follow_up_date: '2020-01-01' }).score).toBe(0)
  })

  it('accepts Referral via either source or lead_source column', () => {
    expect(calculateScore({ source: 'Referral' }).score).toBe(8)
    expect(calculateScore({ lead_source: 'Referral' }).score).toBe(8)
  })

  it('ignores blank/whitespace budget, phone, and barn size', () => {
    expect(calculateScore({ budget_range: '  ', phone: ' ', barn_size: '' }).score).toBe(0)
  })
})

describe('getScoreGrade', () => {
  it('maps score bands to grades at their boundaries', () => {
    expect(getScoreGrade(100).grade).toBe('A')
    expect(getScoreGrade(70).grade).toBe('A')
    expect(getScoreGrade(69).grade).toBe('B')
    expect(getScoreGrade(50).grade).toBe('B')
    expect(getScoreGrade(49).grade).toBe('C')
    expect(getScoreGrade(30).grade).toBe('C')
    expect(getScoreGrade(29).grade).toBe('D')
    expect(getScoreGrade(0).grade).toBe('D')
  })
})
