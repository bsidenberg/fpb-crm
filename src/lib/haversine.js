/**
 * haversine.js — great-circle distance utilities
 * No external dependencies.
 */

/**
 * haversineMiles(lat1, lng1, lat2, lng2)
 * Returns the great-circle distance in miles between two lat/lng points.
 * Returns null if any input is null, undefined, or NaN.
 */
export function haversineMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return null

  const R = 3958.8 // Earth radius in miles
  const toRad = deg => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * filterLeadsByRadius(leads, centerLat, centerLng, radiusMiles)
 * Annotates each lead with:
 *   _distance  — miles from center, or null if lead has no coords
 *   _inRadius  — true/false if lead has coords, null if not
 * Does NOT remove leads — returns all leads annotated.
 * Does NOT mutate the input array.
 */
export function filterLeadsByRadius(leads, centerLat, centerLng, radiusMiles) {
  return leads.map(lead => {
    const _distance = haversineMiles(centerLat, centerLng, lead.latitude, lead.longitude)
    return {
      ...lead,
      _distance,
      _inRadius: _distance != null ? _distance <= radiusMiles : null,
    }
  })
}
