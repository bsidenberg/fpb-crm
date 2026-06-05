-- ============================================================
-- New pipeline stages + tile metadata columns
-- Run in Supabase SQL Editor or via supabase db push
-- ============================================================

-- 1. Drop existing CHECK constraint on stage if one exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'leads'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'leads_stage_check'
  ) THEN
    ALTER TABLE leads DROP CONSTRAINT leads_stage_check;
  END IF;
END $$;

-- 2. Migrate stage values to new IDs
--    contacted  → contacted_no_comm  (Contacted - No Communication Yet)
--    need_price → need_to_quote      (Need to Quote)
--    quote_sent → estimate_sent      (Estimate Sent)
--    follow_up  → contacted_waiting  (Contacted - Waiting on Them)
UPDATE leads SET stage = 'contacted_no_comm' WHERE stage = 'contacted';
UPDATE leads SET stage = 'need_to_quote'     WHERE stage = 'need_price';
UPDATE leads SET stage = 'estimate_sent'     WHERE stage = 'quote_sent';
UPDATE leads SET stage = 'contacted_waiting' WHERE stage = 'follow_up';

-- 3. Add new tile metadata columns (nullable — existing rows display as —)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_date date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner             text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS probability       integer;

-- 4. Verify no unrecognised stage values remain before adding constraint
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM leads
  WHERE stage NOT IN (
    'new', 'contacted_no_comm', 'contacted_waiting',
    'need_to_quote', 'estimate_sent', 'revision_negotiation',
    'won', 'lost'
  );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Cannot add stage CHECK: % rows have unrecognised stage values', bad_count;
  END IF;
END $$;

-- 5. Add updated CHECK constraint on stage
ALTER TABLE leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN (
    'new', 'contacted_no_comm', 'contacted_waiting',
    'need_to_quote', 'estimate_sent', 'revision_negotiation',
    'won', 'lost'
  ));

-- 6. Add CHECK constraint on probability (0–100 or NULL)
ALTER TABLE leads ADD CONSTRAINT leads_probability_check
  CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));
