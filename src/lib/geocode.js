/**
 * geocode.js — client-side Google Geocoding API wrapper
 *
 * Requires: VITE_GOOGLE_MAPS_API_KEY in .env
 * All functions return null on failure — never throw.
 */

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

/**
 * geocodeAddress(addressString)
 * Geocodes a free-form address string.
 * Returns { latitude, longitude, formatted_address } or null.
 */
export async function geocodeAddress(addressString) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    console.error('[geocode] VITE_GOOGLE_MAPS_API_KEY is not set.')
    return null
  }

  if (!addressString || !addressString.trim()) {
    return null
  }

  const url =
    `${GEOCODE_BASE}?address=${encodeURIComponent(addressString.trim())}` +
    `&key=${apiKey}&region=us&components=country:US`

  try {
    const res  = await fetch(url)
    const data = await res.json()

    if (data.status === 'OK' && data.results.length > 0) {
      const result   = data.results[0]
      const { lat, lng } = result.geometry.location
      return {
        latitude:          lat,
        longitude:         lng,
        formatted_address: result.formatted_address,
      }
    }

    if (data.status === 'ZERO_RESULTS') {
      console.warn(`[geocode] No results for: "${addressString}"`)
      return null
    }

    // All other error statuses
    console.error(
      `[geocode] API error — status: ${data.status}`,
      data.error_message ? `— ${data.error_message}` : ''
    )
    return null

  } catch (err) {
    console.error('[geocode] Network error:', err)
    return null
  }
}

/**
 * geocodeLead(lead)
 * Convenience wrapper: builds an address string from a lead object and geocodes it.
 * Lead fields used: address, city, zip (all optional).
 * State is hardcoded to FL (Florida-only business).
 * Returns { latitude, longitude, formatted_address } or null.
 */
export async function geocodeLead(lead) {
  const parts = [
    lead.address?.trim() || '',
    lead.city?.trim()    || '',
  ].filter(Boolean)

  // Nothing useful to geocode
  if (parts.length === 0) return null

  // Build "123 Main St, Clermont, FL" or "123 Main St, Clermont, FL 34711"
  const cityState = parts[1]
    ? `${parts[1]}, FL${lead.zip ? ' ' + lead.zip.trim() : ''}`
    : `FL${lead.zip ? ' ' + lead.zip.trim() : ''}`

  const addressString = parts[0]
    ? `${parts[0]}, ${cityState}`
    : cityState

  return geocodeAddress(addressString)
}

/**
 * isGeocodingConfigured()
 * Returns true if a plausible Google API key is present in env.
 */
export function isGeocodingConfigured() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  return typeof key === 'string' && key.startsWith('AIzaSy') && key.length >= 30
}
