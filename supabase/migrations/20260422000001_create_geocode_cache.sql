-- Migration: create_geocode_cache
-- Caches Google Geocoding API results to avoid redundant API calls.
-- Cache entries expire after 180 days; a cleanup job can DELETE WHERE expires_at < now().

-- 1. pgcrypto for SHA-256 digest
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Cache table
CREATE TABLE geocode_cache (
  address_hash      text        PRIMARY KEY,
  input_address     text        NOT NULL,
  latitude          double precision NOT NULL,
  longitude         double precision NOT NULL,
  formatted_address text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + INTERVAL '180 days')
);

-- 3. Index for expiry cleanup
CREATE INDEX geocode_cache_expires_at_idx ON geocode_cache(expires_at);

-- 4. RLS
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON geocode_cache FOR ALL USING (true) WITH CHECK (true);

-- 5. normalize_address: lowercase, trim, collapse whitespace, strip trailing punctuation
CREATE OR REPLACE FUNCTION normalize_address(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH ' .,;:' FROM regexp_replace(lower(trim(addr)), '\s+', ' ', 'g'))
$$;

-- 6. hash_address: SHA-256 hex digest of the normalized address
CREATE OR REPLACE FUNCTION hash_address(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest(normalize_address(addr), 'sha256'), 'hex')
$$;
