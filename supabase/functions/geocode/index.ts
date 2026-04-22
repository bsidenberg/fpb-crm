import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_MAPS_SERVER_KEY = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')!
const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (!GOOGLE_MAPS_SERVER_KEY) return json({ error: 'Missing GOOGLE_MAPS_SERVER_KEY secret' }, 500)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Missing Supabase env' }, 500)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const address: unknown = body?.address
  if (typeof address !== 'string' || !address.trim()) {
    return json({ error: 'address (non-empty string) is required' }, 400)
  }

  // 1. Cache lookup
  const { data: hashData, error: hashErr } = await supabase.rpc('hash_address', { addr: address })
  if (hashErr) return json({ error: 'hash_address RPC failed: ' + hashErr.message }, 500)
  const address_hash = hashData as string

  const { data: cached } = await supabase
    .from('geocode_cache')
    .select('latitude, longitude, formatted_address, expires_at')
    .eq('address_hash', address_hash)
    .maybeSingle()

  if (cached && new Date(cached.expires_at) > new Date()) {
    return json({
      latitude: cached.latitude,
      longitude: cached.longitude,
      formatted_address: cached.formatted_address,
      cache_hit: true,
    })
  }

  // 2. Cache miss — call Google
  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(address.trim())}&key=${GOOGLE_MAPS_SERVER_KEY}&region=us&components=country:US`
  let googleData
  try {
    const res = await fetch(url)
    googleData = await res.json()
  } catch (err) {
    return json({ error: 'Google fetch failed: ' + (err as Error).message }, 502)
  }

  if (googleData.status === 'ZERO_RESULTS') {
    return json({ error: 'No results for address', google_status: 'ZERO_RESULTS' }, 404)
  }
  if (googleData.status !== 'OK' || !googleData.results?.length) {
    return json({
      error: 'Google API error',
      google_status: googleData.status,
      google_message: googleData.error_message,
    }, 502)
  }

  const result = googleData.results[0]
  const latitude = result.geometry.location.lat
  const longitude = result.geometry.location.lng
  const formatted_address = result.formatted_address

  // 3. Write to cache (upsert)
  const { error: insertErr } = await supabase
    .from('geocode_cache')
    .upsert({
      address_hash,
      input_address: address,
      latitude,
      longitude,
      formatted_address,
    }, { onConflict: 'address_hash' })

  if (insertErr) {
    console.error('[geocode] cache write failed:', insertErr.message)
  }

  return json({
    latitude,
    longitude,
    formatted_address,
    cache_hit: false,
  })
})

function json(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
