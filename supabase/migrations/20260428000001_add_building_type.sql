-- Add building_type column to leads
ALTER TABLE leads ADD COLUMN building_type text;

-- Backfill from website form notes
UPDATE leads SET building_type = 'Open Pole Barn'
  WHERE notes ~ 'Building:\s+Open Pole Barn' AND building_type IS NULL;

UPDATE leads SET building_type = 'Enclosed Pole Barn'
  WHERE notes ~ 'Building:\s+Enclosed Pole Barn' AND building_type IS NULL;

UPDATE leads SET building_type = 'Not Sure Yet'
  WHERE notes ~ 'Building:\s+Not Sure Yet' AND building_type IS NULL;

-- Verify no out-of-range values before adding constraint
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM leads
  WHERE building_type IS NOT NULL
    AND building_type NOT IN ('Open Pole Barn', 'Enclosed Pole Barn', 'Not Sure Yet');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Cannot add CHECK constraint: % rows have invalid building_type values', bad_count;
  END IF;
END $$;

-- Add CHECK constraint
ALTER TABLE leads
  ADD CONSTRAINT leads_building_type_check
  CHECK (building_type IS NULL OR building_type IN ('Open Pole Barn', 'Enclosed Pole Barn', 'Not Sure Yet'));
