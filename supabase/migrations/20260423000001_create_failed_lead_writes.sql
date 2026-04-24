-- Audit table for failed lead insert attempts
-- Captures payloads that couldn't be written to the leads table,
-- originating from the website quote form or any other lead ingestion source.

CREATE TABLE failed_lead_writes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  source        text        NOT NULL,          -- e.g. 'website_quote_form', 'csv_import'
  payload       jsonb       NOT NULL,          -- the attempted lead row data
  error_code    text,                          -- Supabase/Postgres error code if known
  error_message text,                         -- the error message
  resolved_at   timestamptz,                  -- set when manually resolved (lead added, marked junk, etc.)
  resolved_note text                          -- optional note from whoever resolved it
);

-- Index for querying unresolved items (the common case)
CREATE INDEX failed_lead_writes_unresolved_idx
  ON failed_lead_writes(created_at DESC)
  WHERE resolved_at IS NULL;

-- RLS: match existing pattern (Allow all — tightened at Day 11 auth)
ALTER TABLE failed_lead_writes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON failed_lead_writes FOR ALL USING (true) WITH CHECK (true);
