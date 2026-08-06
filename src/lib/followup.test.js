import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toLocalDateStr, todayStr, in7DaysStr, getFollowUpStatus } from './followup.js'

describe('followup date helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Local-time noon avoids timezone edge flakiness in CI
    vi.setSystemTime(new Date(2026, 7, 6, 12, 0, 0)) // Aug 6 2026 local
  })
  afterEach(() => vi.useRealTimers())

  it('toLocalDateStr formats with zero padding', () => {
    expect(toLocalDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('todayStr and in7DaysStr agree with the mocked clock', () => {
    expect(todayStr()).toBe('2026-08-06')
    expect(in7DaysStr()).toBe('2026-08-13')
  })

  it('getFollowUpStatus classifies each band', () => {
    expect(getFollowUpStatus(null)).toBeNull()
    expect(getFollowUpStatus('')).toBeNull()
    expect(getFollowUpStatus('2026-08-05')).toBe('overdue')
    expect(getFollowUpStatus('2026-08-06')).toBe('today')
    expect(getFollowUpStatus('2026-08-07')).toBe('upcoming')
    expect(getFollowUpStatus('2026-08-13')).toBe('upcoming') // 7th day inclusive
    expect(getFollowUpStatus('2026-08-14')).toBe('future')
  })
})
