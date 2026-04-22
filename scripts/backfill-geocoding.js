/**
 * backfill-geocoding.js
 * One-time script: geocodes all leads that have address data but no lat/lng yet.
 * Idempotent — safe to re-run; skips already-geocoded leads via .is('latitude', null).
 *
 * Usage:
 *   npm run backfill-geocoding
 *
 * Reads from .env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   VITE_GOOGLE_MAPS_API_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY
const GOOGLE_KEY    = process.env.GOOGLE_MAPS_SERVER_KEY
const DELAY_MS      = 100   // 10 req/sec — well under Google's 50/sec limit
const GEOCODE_BASE  = 'https://maps.googleapis.com/maps/api/geocode/json'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

if (!GOOGLE_KEY) {
  console.error('Missing GOOGLE_MAPS_SERVER_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Geocoding (inline — cannot import src/lib/geocode.js: uses import.meta.env) ──

async function geocodeAddress(addressString) {
  if (!addressString || !addressString.trim()) return null

  const url =
    `${GEOCODE_BASE}?address=${encodeURIComponent(addressString.trim())}` +
    `&key=${GOOGLE_KEY}&region=us&components=country:US`

  try {
    const res  = await fetch(url)
    const data = await res.json()

    if (data.status === 'OK' && data.results.length > 0) {
      const result = data.results[0]
      return {
        latitude:          result.geometry.location.lat,
        longitude:         result.geometry.location.lng,
        formatted_address: result.formatted_address,
      }
    }

    if (data.status === 'ZERO_RESULTS') {
      return { error: 'zero_results' }
    }

    console.error(`  [geocode] API error — status: ${data.status}${data.error_message ? ': ' + data.error_message : ''}`)
    return { error: 'api_error' }

  } catch (err) {
    console.error('  [geocode] Network error:', err.message)
    return { error: 'api_error' }
  }
}

function buildAddressString(lead) {
  const parts = [
    lead.address?.trim() || '',
    lead.city?.trim()    || '',
  ].filter(Boolean)

  if (parts.length === 0) return null

  const cityState = parts[1]
    ? `${parts[1]}, FL${lead.zip ? ' ' + lead.zip.trim() : ''}`
    : `FL${lead.zip ? ' ' + lead.zip.trim() : ''}`

  return parts[0] ? `${parts[0]}, ${cityState}` : cityState
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching leads needing geocoding…')

  const { data: leads, error: fetchError } = await supabase
    .from('leads')
    .select('id, address, city, zip')
    .is('latitude', null)
    .or('address.not.is.null,city.not.is.null')

  if (fetchError) {
    console.error('Failed to fetch leads:', fetchError.message)
    process.exit(1)
  }

  console.log(`Found ${leads.length} lead(s) to process.\n`)

  const counters = {
    total_processed:    0,
    geocoded_success:   0,
    failed_zero:        0,
    failed_api:         0,
    skipped_no_address: 0,
  }

  for (const lead of leads) {
    counters.total_processed++

    const addressString = buildAddressString(lead)

    if (!addressString) {
      console.log(`  [${counters.total_processed}/${leads.length}] SKIP  ${lead.id} — no address data`)
      counters.skipped_no_address++
      continue
    }

    process.stdout.write(`  [${counters.total_processed}/${leads.length}] "${addressString}" … `)

    const result = await geocodeAddress(addressString)

    if (!result) {
      // geocodeAddress returned null (shouldn't happen — we return error objects, but guard anyway)
      console.log('SKIP (null result)')
      counters.failed_api++
    } else if (result.error === 'zero_results') {
      console.log('ZERO RESULTS')
      counters.failed_zero++
    } else if (result.error === 'api_error') {
      console.log('API ERROR (see above)')
      counters.failed_api++
    } else {
      // Success — update the lead row
      const { error: updateError } = await supabase
        .from('leads')
        .update({
          latitude:    result.latitude,
          longitude:   result.longitude,
          geocoded_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      if (updateError) {
        console.log(`DB ERROR: ${updateError.message}`)
        counters.failed_api++
      } else {
        console.log(`OK  (${result.latitude.toFixed(5)}, ${result.longitude.toFixed(5)})`)
        counters.geocoded_success++
      }
    }

    // Rate limit: 100ms between requests
    if (counters.total_processed < leads.length) {
      await sleep(DELAY_MS)
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  const pct = counters.total_processed > 0
    ? Math.round((counters.geocoded_success / counters.total_processed) * 100)
    : 0

  console.log('\n=== Backfill Summary ===')
  console.log(`Total leads processed:  ${counters.total_processed}`)
  console.log(`Successfully geocoded:  ${counters.geocoded_success} (${pct}%)`)
  console.log(`Failed (zero results):  ${counters.failed_zero}`)
  console.log(`Failed (API error):     ${counters.failed_api}`)
  console.log(`Skipped (no address):   ${counters.skipped_no_address}`)
  console.log('========================')
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
