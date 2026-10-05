-- ============================================================
-- Add leads.quote_sent_at
-- Apply manually in the Supabase SQL Editor BEFORE merging the frontend
-- change that writes it (src/lib/leadsState.js stageChangeFields). Writing a
-- missing column makes PostgREST reject the whole stage update.
--
-- Read by supabase/functions/quote-followup-check. Intentionally no backfill:
-- existing leads keep NULL and are never picked up by the follow-up check.
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz;
