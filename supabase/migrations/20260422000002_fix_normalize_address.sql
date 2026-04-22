-- Migration: fix_normalize_address
-- Fixes normalize_address so punctuation attached to word boundaries
-- (e.g. "St." vs "St", "Ave," vs "Ave") produces the same hash.
-- hash_address consumes normalize_address and picks up the fix automatically.

CREATE OR REPLACE FUNCTION normalize_address(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH ' ' FROM
    regexp_replace(
      regexp_replace(
        lower(trim(addr)),
        '\s+', ' ', 'g'
      ),
      '[.,;]+(\s|$)', '\1', 'g'
    )
  )
$$;
