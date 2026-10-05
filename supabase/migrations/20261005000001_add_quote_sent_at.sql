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

-- If stage saves still fail with PGRST204 right after applying:
--   NOTIFY pgrst, 'reload schema';

-- ── MANUAL ROLLBACK (in this order) ─────────────────────────────────────────
-- 1. Revert the frontend PR first — it writes quote_sent_at on moves to
--    Estimate Sent, and those saves fail once the column is gone.
-- 2. Undeploy or redeploy the previous quote-followup-check.
-- 3. ALTER TABLE leads DROP COLUMN IF EXISTS quote_sent_at;
--    NOTIFY pgrst, 'reload schema';
--    WARNING: dropping the column permanently loses every recorded stamp.
