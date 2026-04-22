-- Migration: add_lead_score
-- Adds a computed score column to leads.
-- Score is calculated client-side by Board.jsx and persisted here.
-- Nullable — null means "not yet scored"; Board.jsx backfills on next load.

ALTER TABLE leads ADD COLUMN score integer;

CREATE INDEX leads_score_idx ON leads (score) WHERE score IS NOT NULL;
