-- Lock CRM data to signed-in Florida Pole Barn staff.
--
-- DO NOT APPLY from CI. Run by hand in the Supabase SQL editor for project
-- flabvhdgqddbfitbqjqk, then follow supabase/RLS_LOCKDOWN.md.
--
-- Verified against production on 2026-10-12, before this migration:
--   The publishable key in the public CRM bundle can read and write every
--   public table below. Writes were probed with empty bodies so no customer
--   row was stored, except one blank activities insert that was deleted in
--   the same session (id 0c91cda4-75a9-4ea2-85c8-4888d2be09e4).
--
--   leads                      1143 rows   read + write
--   activities                 5381 rows   read + write
--   projects                     21 rows   read + write
--   project_hit_list              1 row    read + write
--   project_updates              19 rows   read + write
--   project_checklist_items     643 rows   read + write
--   geocode_cache                90 rows   read + write
--   failed_lead_writes            0 rows   read + write
--   No other public table responded to a REST probe (no profiles, users,
--   notes, or tasks table).
--   storage.buckets is empty. No bucket ids exist.
--   Anon can execute hash_address, normalize_address,
--   canonicalize_lead_source_label, normalize_lead_channel, and
--   seed_project_checklist (the last one attempts an insert).
--
-- After this migration:
--   anon / PUBLIC have no schema usage, no table privileges, no policies,
--   and no execute on public functions.
--   authenticated users whose JWT email is @floridapolebarn.com keep full
--   read/write on every public table (the CRM has no per-rep row split).
--   service_role is unchanged: it bypasses RLS and keeps its grants, so
--   edge functions, the website server (if it uses the secret key), cron,
--   and webhooks keep working.
--
-- No anon exception. floridapolebarn.com/quote posts to that site's
-- /api/quote server route. The site bundle does not contain a Supabase key.
-- A server using service_role bypasses these policies. A commented
-- insert-only policy is at the bottom if that route is later found to use
-- the publishable key.
--
-- Auth setting this SQL cannot change: disable_signup is false on the
-- project. Turn off public signups in the dashboard when applying this,
-- or anyone who confirms an @floridapolebarn.com signup becomes a CRM user.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema usage. Postgres grants USAGE on schema public to PUBLIC by default.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on schema public from public;
revoke all on schema public from anon;
grant usage on schema public to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables: enable and force RLS, drop every existing public policy, then
-- grant only authenticated CRM users and service_role.
-- Covers tables that exist in production but are not in git.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('alter table public.%I force row level security', r.relname);
    -- Drop leftover GRANT ALL (truncate, references, trigger) so authenticated
    -- keeps only the DML the CRM uses. Firing an existing trigger does not
    -- require the TRIGGER privilege.
    execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      r.relname
    );
    execute format('grant all on table public.%I to service_role', r.relname);
  end loop;

  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      $policy$
        create policy authenticated_crm_all
        on public.%I
        for all
        to authenticated
        using (
          lower(btrim(coalesce(
            auth.jwt() ->> 'email',
            auth.jwt() -> 'user_metadata' ->> 'email',
            ''
          ))) ~ '@floridapolebarn\.com$'
        )
        with check (
          lower(btrim(coalesce(
            auth.jwt() ->> 'email',
            auth.jwt() -> 'user_metadata' ->> 'email',
            ''
          ))) ~ '@floridapolebarn\.com$'
        )
      $policy$,
      r.relname
    );
  end loop;
end $$;

-- Views run as the owner unless security_invoker is on, which would bypass
-- the table policies above. Materialized views have no RLS; revoke anon.
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
  loop
    if r.relkind = 'v' then
      execute format('alter view public.%I set (security_invoker = true)', r.relname);
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated', r.relname);
    execute format('grant select on public.%I to authenticated, service_role', r.relname);
  end loop;
end $$;

-- Sequences (identity / serial). UUID tables do not need these.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from public, anon', r.relname);
    execute format(
      'grant usage, select on sequence public.%I to authenticated, service_role',
      r.relname
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions. anon can currently call seed_project_checklist (writes checklist
-- rows) and the lead-source / geocode helpers. Trigger functions stay
-- executable by authenticated and service_role so updates still stamp
-- updated_at. service_role keeps execute for the geocode edge function.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p', 'a', 'w')
  loop
    begin
      execute format(
        'revoke all on function public.%I(%s) from public, anon',
        r.proname,
        r.args
      );
      execute format(
        'grant execute on function public.%I(%s) to authenticated, service_role',
        r.proname,
        r.args
      );
    exception
      when others then
        raise warning 'skipped function lock %.%(%) : %',
          'public', r.proname, r.args, sqlerrm;
    end;
  end loop;
end $$;

-- Known writers stay invoker so they cannot bypass the policies above.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.seed_project_checklist(uuid, text)',
    'public.hash_address(text)',
    'public.normalize_address(text)',
    'public.canonicalize_lead_source_label(text)',
    'public.normalize_lead_channel(text, text, text, text, text, text, text)',
    'public.update_updated_at()',
    'public.set_updated_at()'
  ]
  loop
    begin
      execute format('alter function %s security invoker', fn);
    exception
      when undefined_function then
        raise warning 'function % not present, left unchanged', fn;
    end;
  end loop;
end $$;

-- Future objects created by the migration role (postgres / SQL editor).
alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;

alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage. Production has zero buckets. Drop policies that still grant
-- anon or public access, so a bucket added later is not world-readable
-- by an old "allow all" policy. The CRM app does not use Storage.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  if to_regnamespace('storage') is null then
    return;
  end if;

  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'storage'
      and roles && array['anon', 'public']::name[]
  loop
    execute format('drop policy %I on storage.%I', r.policyname, r.tablename);
    raise notice 'dropped storage policy % on %', r.policyname, r.tablename;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT APPLIED. Optional anon insert for the public website.
--
-- Run this block only if, after the lockdown, a real quote submitted on
-- https://floridapolebarn.com/quote fails AND the /api/quote server is
-- confirmed to call Supabase with the publishable/anon key (not service_role).
-- Insert-only: anon still cannot select, update, or delete leads.
-- Prefer fixing /api/quote to use the service role instead of running this.
--
--   grant insert on table public.leads to anon;
--   create policy anon_insert_leads
--     on public.leads
--     for insert
--     to anon
--     with check (true);
--
-- Emergency rollback (restores the open anon access this migration removes):
--
--   grant usage on schema public to anon;
--   grant select, insert, update, delete on all tables in schema public to anon;
--   grant execute on all functions in schema public to anon;
--   do $$
--   declare r record;
--   begin
--     for r in
--       select c.relname
--       from pg_class c
--       join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind in ('r', 'p')
--     loop
--       execute format('drop policy if exists authenticated_crm_all on public.%I', r.relname);
--       execute format(
--         'create policy "Allow all" on public.%I for all using (true) with check (true)',
--         r.relname
--       );
--     end loop;
--   end $$;
