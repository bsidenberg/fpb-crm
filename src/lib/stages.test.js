import { describe, it, expect } from 'vitest'
import { STAGES, STAGE_MAP, TEMPERATURE, ACTIVITY_TYPES } from './stages.js'

// These constants drive the Kanban board and mirror values stored in the
// leads.stage column — a typo here silently orphans leads off the board.
describe('stage definitions', () => {
  it('has unique ids and a complete STAGE_MAP', () => {
    const ids = STAGES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of STAGES) expect(STAGE_MAP[s.id]).toBe(s)
  })

  it('keeps the pipeline endpoints won and lost', () => {
    const ids = STAGES.map(s => s.id)
    expect(ids).toContain('new')
    expect(ids.slice(-2)).toEqual(['won', 'lost'])
  })

  it('every stage, temperature, and activity type has label and color', () => {
    for (const item of [...STAGES, ...TEMPERATURE, ...ACTIVITY_TYPES]) {
      expect(item.id).toBeTruthy()
      expect(item.label).toBeTruthy()
      expect(item.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})
