-- SEALD final webhook contract: Seald-Idempotency-Key retries must get the
-- original result back. Store the response with each processed event.
alter table public.booking_webhook_events
  add column if not exists response_status integer,
  add column if not exists response_body jsonb;
