-- Normalize legacy service_type values and add CHECK constraint
-- Legacy slugs (kit-install, kit-only, turnkey, empty string) were written
-- before the canonical display strings were standardized in the UI.

-- 1. Normalize legacy values
UPDATE leads SET service_type = 'Kit + Installation' WHERE service_type = 'kit-install';
UPDATE leads SET service_type = 'Kit Delivery Only'  WHERE service_type = 'kit-only';
UPDATE leads SET service_type = 'Kit + Installation' WHERE service_type = 'turnkey';
UPDATE leads SET service_type = NULL                 WHERE service_type = '';

-- 2. Verify normalization succeeded before adding constraint
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM leads
  WHERE service_type IS NOT NULL
    AND service_type NOT IN ('Kit Delivery Only', 'Kit + Installation');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Cannot add CHECK constraint: % rows still have invalid service_type values', bad_count;
  END IF;
END $$;

-- 3. Add CHECK constraint (NULL allowed — represents "service type not specified")
ALTER TABLE leads
  ADD CONSTRAINT leads_service_type_check
  CHECK (service_type IS NULL OR service_type IN ('Kit Delivery Only', 'Kit + Installation'));
