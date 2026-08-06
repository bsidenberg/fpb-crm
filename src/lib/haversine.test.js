import { describe, it, expect } from 'vitest'
import { haversineMiles, filterLeadsByRadius } from './haversine.js'

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMiles(35.2271, -80.8431, 35.2271, -80.8431)).toBe(0)
  })

  it('matches a known distance (Charlotte to Raleigh ≈ 130 mi)', () => {
    const d = haversineMiles(35.2271, -80.8431, 35.7796, -78.6382)
    expect(d).toBeGreaterThan(125)
    expect(d).toBeLessThan(135)
  })

  it('returns null when any coordinate is missing or NaN', () => {
    expect(haversineMiles(null, -80, 35, -78)).toBeNull()
    expect(haversineMiles(35, undefined, 35, -78)).toBeNull()
    expect(haversineMiles(35, -80, NaN, -78)).toBeNull()
  })
})

describe('filterLeadsByRadius', () => {
  const center = { lat: 35.2271, lng: -80.8431 } // Charlotte
  const leads = [
    { id: 1, latitude: 35.2271, longitude: -80.8431 }, // at center
    { id: 2, latitude: 35.7796, longitude: -78.6382 }, // ~130 mi away
    { id: 3, latitude: null, longitude: null },        // no coords
  ]

  it('annotates without removing or mutating', () => {
    const out = filterLeadsByRadius(leads, center.lat, center.lng, 50)
    expect(out).toHaveLength(3)
    expect(out[0]._inRadius).toBe(true)
    expect(out[1]._inRadius).toBe(false)
    expect(out[2]._inRadius).toBeNull()
    expect(out[2]._distance).toBeNull()
    expect(leads[0]._distance).toBeUndefined() // input untouched
  })
})
