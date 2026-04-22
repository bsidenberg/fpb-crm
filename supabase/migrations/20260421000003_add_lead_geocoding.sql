-- Migration: add_lead_geocoding
-- Adds latitude, longitude, and geocoded_at columns to leads table.
-- All columns nullable — existing leads have no coords yet.
-- No PostGIS; plain double precision lat/lng for client-side Haversine math.

ALTER TABLE leads ADD COLUMN latitude   double precision;
ALTER TABLE leads ADD COLUMN longitude  double precision;
ALTER TABLE leads ADD COLUMN geocoded_at timestamptz;

-- Partial index: only indexes geocoded rows (latitude/longitude non-null)
CREATE INDEX IF NOT EXISTS leads_lat_lng_idx
  ON leads (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
