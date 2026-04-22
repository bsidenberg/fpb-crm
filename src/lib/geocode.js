/**
 * geocode.js — geocoding via Supabase edge function proxy
 *
 * Calls /functions/v1/geocode instead of Google directly.
 * No Google API key in browser code — the edge function holds the server key.
 *
 * Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 * All functions return null on failure — never throw.
 */

/**
 * geocodeAddress(addressString)
 * Geocodes a free-form address string via the edge function.
 * Returns { latitude, longitude, formatted_address } or null.
 */
export async function geocodeAddress(addressString) {
  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnon) {
    console.error('[geocode] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.')
    return null
  }

  if (!addressString || !addressString.trim()) return null

  const url = `${supabaseUrl}/functions/v1/geocode`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${supabaseAnon}`,
        'apikey':        supabaseAnon,
      },
      body: JSON.stringify({ address: addressString }),
    })

    if (res.status === 404) {
      console.warn(`[geocode] No results for: "${addressString}"`)
      return null
    }

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch { /* ignore */ }
      console.error(`[geocode] Edge function error — status: ${res.status}`, detail)
      return null
    }

    const data = await res.json()
    return {
      latitude:          data.latitude,
      longitude:         data.longitude,
      formatted_address: data.formatted_address,
    }

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
 * Returns true if Supabase env vars are present (edge function will handle the Google key).
 */
export function isGeocodingConfigured() {
  const url  = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  return typeof url === 'string' && url.length > 0 &&
         typeof anon === 'string' && anon.length > 0
}
