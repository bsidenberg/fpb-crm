# CRM row-level security lockdown

This migration is **not applied** by merging the pull request. Production stays
open until someone runs the SQL in the Supabase dashboard. The SQL was
executed on a local Postgres 16 database loaded with the same open policies,
not on project `flabvhdgqddbfitbqjqk`.

Project: `flabvhdgqddbfitbqjqk`  
Migration: `supabase/migrations/20261012000001_lock_rls_to_authenticated.sql`

## Why the app can be locked

The CRM already requires a Supabase password session. `App.jsx` renders `Login`
until `supabase.auth.getSession()` returns a session, and `Login.jsx` calls
`signInWithPassword`. After sign-in, supabase-js sends that user's JWT on
table requests. The role on that JWT is `authenticated`.

The publishable key in the Vercel bundle is only the anonymous credential.
Table calls from a signed-in browser do not rely on anon being able to read
`leads`.

## What production allows today

Checked on 2026-10-12 with the publishable key from the live bundle
(`https://fpbcrm-alpha.vercel.app`). Counts and error codes only; customer
fields were not copied out.

| Object | Anon read | Anon write | Notes |
| --- | --- | --- | --- |
| `leads` | 1143 rows | yes | Empty insert failed on `first_name` NOT NULL, which means RLS did not reject it |
| `activities` | 5381 rows | yes | Empty insert returned 201. That probe row was deleted (`0c91cda4-75a9-4ea2-85c8-4888d2be09e4`) |
| `projects` | 21 rows | yes | Empty insert failed on `name` NOT NULL |
| `project_hit_list` | 1 row | yes | Empty insert failed on `project_id` NOT NULL |
| `project_updates` | 19 rows | yes | Empty insert failed on `project_id` NOT NULL |
| `project_checklist_items` | 643 rows | yes | Empty insert failed on `project_id` NOT NULL |
| `geocode_cache` | 90 rows | yes | Empty insert failed on `address_hash` NOT NULL |
| `failed_lead_writes` | 0 rows, table visible | yes | Empty insert failed on `source` NOT NULL |
| Other public tables (`profiles`, `users`, `notes`, `tasks`, …) | not in the API | | PostgREST `PGRST205` |
| Storage buckets | none | | `GET /storage/v1/bucket` is `[]`. Named buckets return `NoSuchBucket` |
| `hash_address`, `normalize_address`, `canonicalize_lead_source_label`, `normalize_lead_channel` | executable | read-only helpers | |
| `seed_project_checklist` | executable | attempts an insert | A nil project id failed the foreign key, after RLS allowed the write |
| `geocode` edge function | public | | No `Authorization` header still reached function code (`verify_jwt` is off). It then uses `service_role` to read and write `geocode_cache` |
| `daily-followup-digest`, `quote-followup-check` | not called | | Both use `SERVICE_ROLE_KEY` inside the function. Calling them sends mail and the quote check moves lead stages |

`schema.sql` leaves RLS commented out on `leads` and `activities`. The project
tables, `geocode_cache`, and `failed_lead_writes` were created with
`for all using (true) with check (true)`.

Every `activities.user_email` that is set (5179 rows) is `@floridapolebarn.com`.
Auth settings still have `disable_signup: false`, so a policy of "any
authenticated user" would let a stranger who confirms a signup read the CRM.
The new policy requires both `authenticated` and an `@floridapolebarn.com` email.

## Policies after the migration

Applied to **every** ordinary table and partitioned table in `public`, including
any table that exists only in production:

- RLS enabled and forced (table owners do not skip it; `service_role` still bypasses RLS because that role has `BYPASSRLS`).
- All previous policies dropped, including `"Allow all"`.
- One policy, `authenticated_crm_all`, `FOR ALL TO authenticated`, `USING` / `WITH CHECK`:

```sql
lower(btrim(coalesce(
  auth.jwt() ->> 'email',
  auth.jwt() -> 'user_metadata' ->> 'email',
  ''
))) ~ '@floridapolebarn\.com$'
```

- `anon` and `PUBLIC`: no schema usage, no table privileges, no policies.
- `authenticated`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- `service_role`: existing full access, grants reaffirmed. No policy is required.

There is no per-rep split. Every signed-in company user can still see and edit
every lead and project, which is how the app works today.

Views in `public` are set to `security_invoker` so they cannot bypass the table
policies. Materialized views, if any, have anon privileges revoked.

### Functions

| Function | Who can execute after | Why |
| --- | --- | --- |
| `seed_project_checklist(uuid, text)` | `authenticated`, `service_role` | New Project calls this as the signed-in user. `SECURITY INVOKER`, so the checklist insert has to pass the policy |
| `update_updated_at()`, `set_updated_at()` | `authenticated`, `service_role` | Trigger functions. The role that updates a row needs `EXECUTE` |
| `hash_address`, `normalize_address` | `authenticated`, `service_role` | Geocode edge function calls `hash_address` with `service_role` |
| `canonicalize_lead_source_label`, `normalize_lead_channel` | `authenticated`, `service_role` | SQL helpers. The app does not call them; the browser has its own copy |
| Any other `public` function | same | Anon execute is revoked. A function the migration role cannot change is reported as a warning and left as-is |

### Edge functions and stage sync

`quote-followup-check` selects and updates `leads`, reads `activities`, and
inserts a note. `daily-followup-digest` selects `leads`. Both construct their
client with the service-role secret, so RLS does not apply to them. This
migration does not change their code or their JWT check, because invoking them
to see the gateway would send email and can move stages.

`geocode` is different. The browser calls it, and today `src/lib/geocode.js`
sends the publishable key, not the user session. The function in this PR
rejects callers who are not a signed-in `@floridapolebarn.com` user, then
still uses `service_role` for `geocode_cache`. Deploy the **web app first**,
then the function. The SQL migration does not have to wait for that deploy:
table access already uses the user JWT.

`scripts/backfill-geocoding.js` is a manual script. It now requires
`SUPABASE_SERVICE_ROLE_KEY`. It is not part of the live app.

### Anon exceptions

None.

`https://floridapolebarn.com/quote` posts to `https://floridapolebarn.com/api/quote`.
The website JavaScript has no Supabase URL or key. An empty post is rejected
by that route's own validation (`Invalid form data`) and does not touch the
CRM. If that server uses the service-role key, lead capture keeps working.
If a test quote fails after the SQL is applied, the migration file has a
commented insert-only policy for `leads` (no select). Prefer pointing
`/api/quote` at the service role instead of opening that policy.

Storage has no buckets and the CRM never calls Storage. Policies on
`storage` that target `anon` or `public` are dropped.

## Apply

1. In Supabase → Authentication → Providers → Email, confirm every staff
   account already exists, then **disable signups** (`disable_signup`). This
   SQL cannot change that setting.
2. Deploy the web app (Vercel) so geocoding sends the user access token.
   The current production function still accepts that token.
3. Deploy only the geocode function, without `--no-verify-jwt`:

   ```bash
   supabase functions deploy geocode --project-ref flabvhdgqddbfitbqjqk
   ```

4. Supabase → SQL Editor → New query → paste
   `supabase/migrations/20261012000001_lock_rls_to_authenticated.sql` → Run.
   Read any `WARNING` lines before leaving the editor.
5. Run the checks below. Do not run the emergency rollback unless the
   signed-in app is broken.

`quote-followup-check` and `daily-followup-digest` do not need a redeploy
for this lockdown.

## Verification

Replace `PUBLISHABLE_KEY` with `VITE_SUPABASE_ANON_KEY` (the `sb_publishable_…`
value). Do not use the service-role key for the anon checks.

Anon read must not return rows. Expect HTTP 401 or 403 and
`permission denied for schema public` or `permission denied for table leads`
(code `42501`). An empty `[]` with HTTP 200 means the grant revoke did not
apply; stop and fix that before considering this done.

```bash
curl -sS -D - -o /tmp/leads-anon.json \
  -H "apikey: PUBLISHABLE_KEY" \
  -H "Authorization: Bearer PUBLISHABLE_KEY" \
  "https://flabvhdgqddbfitbqjqk.supabase.co/rest/v1/leads?select=id&limit=1"
```

Repeat for `activities`, `projects`, `project_hit_list`, `project_updates`,
`project_checklist_items`, `geocode_cache`, and `failed_lead_writes`.

Anon insert must fail the same way, not with a NOT NULL error:

```bash
curl -sS -D - \
  -X POST \
  -H "apikey: PUBLISHABLE_KEY" \
  -H "Authorization: Bearer PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://flabvhdgqddbfitbqjqk.supabase.co/rest/v1/leads"
```

Anon RPC must fail (not return a hash or `"Meta Ads"`):

```bash
curl -sS -D - \
  -X POST \
  -H "apikey: PUBLISHABLE_KEY" \
  -H "Authorization: Bearer PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"addr":"123 main st"}' \
  "https://flabvhdgqddbfitbqjqk.supabase.co/rest/v1/rpc/hash_address"
```

Geocode without a user JWT must be 401 after the function deploy:

```bash
curl -sS -D - \
  -X POST \
  -H "apikey: PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address":"1 Main St, Clermont, FL"}' \
  "https://flabvhdgqddbfitbqjqk.supabase.co/functions/v1/geocode"
```

Signed-in app, in a private window:

- Sign in as a `@floridapolebarn.com` user. The board loads leads.
- Open a lead, add a note, change a stage.
- Open a project, toggle a checklist item, add a hit-list row.
- Create a project (this calls `seed_project_checklist`).
- Add a lead with a city so background geocoding runs. The lead should get
  coordinates after the function deploy. Before that deploy, geocoding still
  works on the old function.
- Confirm the browser is sending the user access token, not only the
  publishable key, on `/rest/v1/leads`.

Website, after the SQL is applied:

- Submit one clearly marked test quote at `https://floridapolebarn.com/quote`.
- It should appear as a lead for the signed-in CRM. If it does not, check
  whether `/api/quote` uses the service role. Do not grant anon select on
  `leads`. The commented insert-only policy is the fallback.

Do not curl `quote-followup-check` or `daily-followup-digest`. Confirm the
next scheduled run in the function logs instead.

## If a real staff account is not on that domain

The signed-in board will be empty and writes will return a row-level security
error. Widen the policy only for that account. Do not restore anon access.

```sql
-- Example: also allow one external address. Repeat the USING and WITH CHECK
-- change on every public table, or replace the email test inside the migration
-- and re-run the policy section.
```

## Emergency rollback

The bottom of the migration file grants anon access back and recreates
`"Allow all"`. That returns the database to the current exposed state. Use it
only if signed-in staff cannot work, then re-apply a tighter policy.
