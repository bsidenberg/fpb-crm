-- Booked consultation calls for the SEALD booking agent.
--
-- DO NOT APPLY from CI or by merging the pull request. Run by hand in the
-- Supabase SQL editor for project flabvhdgqddbfitbqjqk, then deploy the
-- `booking` edge function. Steps are in docs/BOOKING_SETUP.md.
--
-- Does not change lead stages or quote_sent_at. New leads are inserted at
-- stage 'new'. Linking an existing lead only fills blank intake fields and
-- sets booked_call = true.
--
-- Assignment (enforced again in the edge function before candidate_ids are
-- passed in): mathew@floridapolebarn.com is primary and takes the call when
-- he is free. brian@floridapolebarn.com is backup. notify_all members are
-- optional attendees on the assignee's Outlook event (Brian, by default).
--
-- RLS matches migration 20261012000001: authenticated @floridapolebarn.com
-- staff, no anon. The booking edge function uses service_role.

create extension if not exists btree_gist;

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Team
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.team_members (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  display_name         text not null,
  timezone             text not null default 'America/New_York',
  call_minutes         integer not null default 30
                         check (call_minutes between 15 and 180),
  buffer_minutes       integer not null default 0
                         check (buffer_minutes between 0 and 120),
  min_notice_minutes   integer not null default 60
                         check (min_notice_minutes between 0 and 10080),
  weekly_hours         jsonb not null,
  role                 text not null default 'backup'
                         check (role in ('primary', 'backup', 'member')),
  notify_all           boolean not null default false,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists team_members_email_uidx
  on public.team_members (email);

create table if not exists public.team_blocks (
  id              uuid primary key default gen_random_uuid(),
  team_member_id  uuid not null references public.team_members(id) on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint team_blocks_time_order check (ends_at > starts_at)
);

drop trigger if exists team_members_updated_at on public.team_members;
create trigger team_members_updated_at
  before update on public.team_members
  for each row execute function public.update_updated_at();

-- Mon–Fri 9:30 AM–4:30 PM Eastern. 30-minute consultations. No buffer, so the
-- window divides into 9:30, 10:00, … 4:00 starts. 60-minute minimum notice.
insert into public.team_members (
  email, display_name, timezone, call_minutes, buffer_minutes, min_notice_minutes,
  weekly_hours, role, notify_all, active
)
select
  v.email, v.display_name, 'America/New_York', 30, 0, 60,
  '{
    "mon":[["09:30","16:30"]],
    "tue":[["09:30","16:30"]],
    "wed":[["09:30","16:30"]],
    "thu":[["09:30","16:30"]],
    "fri":[["09:30","16:30"]],
    "sat":[],
    "sun":[]
  }'::jsonb,
  v.role, v.notify_all, true
from (
  values
    ('mathew@floridapolebarn.com', 'Mathew', 'primary', false),
    ('brian@floridapolebarn.com', 'Brian Sidenberg', 'backup', true)
) as v(email, display_name, role, notify_all)
where not exists (
  select 1 from public.team_members t where t.email = v.email
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Appointments
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists booked_call boolean not null default false;

create table if not exists public.appointments (
  id                   uuid primary key default gen_random_uuid(),
  team_member_id       uuid not null references public.team_members(id),
  lead_id              uuid not null references public.leads(id) on delete cascade,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  status               text not null default 'scheduled'
                         check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),
  reschedule_count     integer not null default 0,
  service_type         text not null default 'consultation_call',
  source               text not null default 'seald',
  source_agent         text,
  business             text,
  brand                text,
  notes                text,
  intake               jsonb,
  idempotency_key      text,
  signed_record_id     text,
  verification_url     text,
  customer_name        text,
  customer_email       text,
  customer_phone       text,
  customer_invite      boolean not null default true,
  timezone             text not null default 'America/New_York',
  outlook_event_id     text,
  outlook_sync_status  text not null default 'pending'
                         check (outlook_sync_status in ('pending', 'synced', 'failed', 'skipped')),
  outlook_sync_error   text,
  outlook_synced_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at)
);

create unique index if not exists appointments_idempotency_uidx
  on public.appointments (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists appointments_signed_record_uidx
  on public.appointments (signed_record_id)
  where signed_record_id is not null;

create index if not exists appointments_member_start_idx
  on public.appointments (team_member_id, starts_at);

create index if not exists appointments_lead_idx
  on public.appointments (lead_id);

-- One scheduled call per member per instant. Cancelled / completed rows no
-- longer occupy the slot. Buffer is applied by the overlap check in
-- member_is_free, which extends the stored end by that member's buffer.
alter table public.appointments
  drop constraint if exists appointments_no_double_book;

alter table public.appointments
  add constraint appointments_no_double_book
  exclude using gist (
    team_member_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status = 'scheduled');

drop trigger if exists appointments_updated_at on public.appointments;
create trigger appointments_updated_at
  before update on public.appointments
  for each row execute function public.update_updated_at();

create table if not exists public.booking_webhook_events (
  event_id        text primary key,
  event_type      text not null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  payload         jsonb not null,
  received_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS. Same policy as 20261012000001_lock_rls_to_authenticated.sql.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'team_members', 'team_blocks', 'appointments', 'booking_webhook_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      t
    );
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists authenticated_crm_all on public.%I', t);
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
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Booking writes. SECURITY INVOKER. service_role (the edge function) bypasses
-- RLS. Authenticated staff can call the same functions; anon cannot.
-- Keep the lead-field rules aligned with planLeadWrite in
-- supabase/functions/_shared/sealdContract.js.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.member_is_free(
  p_member uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_exclude uuid
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.team_members m
    where m.id = p_member and m.active
  )
  and not exists (
    select 1
    from public.appointments a
    join public.team_members m on m.id = a.team_member_id
    where a.team_member_id = p_member
      and a.status = 'scheduled'
      and (p_exclude is null or a.id is distinct from p_exclude)
      and tstzrange(
            a.starts_at,
            a.ends_at + make_interval(mins => m.buffer_minutes),
            '[)'
          ) && tstzrange(p_starts, p_ends, '[)')
  )
  and not exists (
    select 1 from public.team_blocks b
    where b.team_member_id = p_member
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts, p_ends, '[)')
  );
$$;

create or replace function public.appointment_json(p_id uuid, p_idempotent boolean)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id,
    'lead_id', a.lead_id,
    'team_member_id', a.team_member_id,
    'team_member_email', m.email,
    'team_member_name', m.display_name,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'status', a.status,
    'reschedule_count', a.reschedule_count,
    'idempotency_key', a.idempotency_key,
    'signed_record_id', a.signed_record_id,
    'outlook_event_id', a.outlook_event_id,
    'outlook_sync_status', a.outlook_sync_status,
    'customer_invite', a.customer_invite,
    'customer_email', a.customer_email,
    'customer_name', a.customer_name,
    'customer_phone', a.customer_phone,
    'service_type', a.service_type,
    'verification_url', a.verification_url,
    'source_agent', a.source_agent,
    'intake', a.intake,
    'idempotent', coalesce(p_idempotent, false)
  )
  from public.appointments a
  join public.team_members m on m.id = a.team_member_id
  where a.id = p_id;
$$;

-- Second arrival (API or webhook) fills keys and blank lead fields without
-- moving stage or quote_sent_at, and without a second appointment.
create or replace function public.attach_booking_identity(p_id uuid, p_request jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_idem text := nullif(btrim(coalesce(p_request->>'idempotency_key', '')), '');
  v_signed text := nullif(btrim(coalesce(p_request->>'signed_record_id', '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_request#>>'{customer,email}', ''))), '');
  v_phone text := nullif(btrim(coalesce(p_request#>>'{customer,phone}', '')), '');
  v_building text := nullif(btrim(coalesce(p_request#>>'{intake,building_type}', '')), '');
  v_size text := nullif(btrim(coalesce(p_request#>>'{intake,size}', '')), '');
  v_city text := nullif(btrim(coalesce(p_request#>>'{intake,city}', '')), '');
  v_timeline text := nullif(btrim(coalesce(p_request#>>'{intake,timeline}', '')), '');
  v_note text := coalesce(p_request->>'note', '');
  v_marker text := coalesce(p_request->>'note_marker', '');
  v_lead uuid;
  v_owner text;
begin
  update public.appointments a set
    idempotency_key = coalesce(a.idempotency_key, v_idem),
    signed_record_id = coalesce(a.signed_record_id, v_signed),
    verification_url = coalesce(a.verification_url, nullif(p_request->>'verification_url', '')),
    source_agent = coalesce(a.source_agent, nullif(p_request->>'source_agent', '')),
    business = coalesce(a.business, nullif(p_request->>'business', '')),
    brand = coalesce(a.brand, nullif(p_request->>'brand', '')),
    customer_email = coalesce(a.customer_email, v_email),
    customer_phone = coalesce(a.customer_phone, nullif(v_phone, '')),
    customer_name = coalesce(a.customer_name, nullif(p_request#>>'{customer,name}', '')),
    intake = case
      when a.intake is null or a.intake = '{}'::jsonb then coalesce(p_request->'intake', a.intake)
      else a.intake
    end
  where a.id = p_id;

  select a.lead_id, m.display_name
    into v_lead, v_owner
  from public.appointments a
  join public.team_members m on m.id = a.team_member_id
  where a.id = p_id;

  if v_lead is null then
    return;
  end if;

  update public.leads set
    booked_call = true,
    building_type = case when nullif(btrim(coalesce(building_type, '')), '') is null then coalesce(v_building, building_type) else building_type end,
    barn_size = case when nullif(btrim(coalesce(barn_size, '')), '') is null then coalesce(v_size, barn_size) else barn_size end,
    timeline = case when nullif(btrim(coalesce(timeline, '')), '') is null then coalesce(v_timeline, timeline) else timeline end,
    city = case when nullif(btrim(coalesce(city, '')), '') is null then coalesce(v_city, city) else city end,
    email = case when nullif(btrim(coalesce(email, '')), '') is null then coalesce(v_email, email) else email end,
    phone = case when nullif(btrim(coalesce(phone, '')), '') is null then coalesce(nullif(v_phone, ''), phone) else phone end,
    owner = case when nullif(btrim(coalesce(owner, '')), '') is null then coalesce(v_owner, owner) else owner end,
    source = case when nullif(btrim(coalesce(source, '')), '') is null then 'Booking Agent' else source end,
    lead_source = case when nullif(btrim(coalesce(lead_source, '')), '') is null then 'Booking Agent' else lead_source end,
    notes = case
      when v_marker <> '' and position(v_marker in coalesce(notes, '')) > 0 then notes
      when v_note = '' then notes
      when nullif(notes, '') is null then v_note
      else notes || E'\n\n' || v_note
    end
  where id = v_lead;
end;
$$;

create or replace function public.reschedule_consultation(
  p_id uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_candidate_ids uuid[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_cand uuid;
  v_chosen uuid;
begin
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'invalid_time' using errcode = 'P0001';
  end if;

  perform 1 from public.team_members where active order by id for update;

  select status into v_status
  from public.appointments
  where id = p_id
  for update;

  if v_status is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'scheduled' then
    raise exception 'not_scheduled' using errcode = 'P0001';
  end if;

  foreach v_cand in array coalesce(p_candidate_ids, '{}'::uuid[]) loop
    if public.member_is_free(v_cand, p_starts, p_ends, p_id) then
      v_chosen := v_cand;
      exit;
    end if;
  end loop;

  if v_chosen is null then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  update public.appointments set
    team_member_id = v_chosen,
    starts_at = p_starts,
    ends_at = p_ends,
    reschedule_count = reschedule_count + case
      when team_member_id is distinct from v_chosen or starts_at is distinct from p_starts then 1
      else 0
    end
  where id = p_id;

  return public.appointment_json(p_id, false);
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
end;
$$;

create or replace function public.book_consultation(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_idem text := nullif(btrim(coalesce(p_request->>'idempotency_key', '')), '');
  v_signed text := nullif(btrim(coalesce(p_request->>'signed_record_id', '')), '');
  v_starts timestamptz := nullif(p_request->>'starts_at', '')::timestamptz;
  v_ends timestamptz := nullif(p_request->>'ends_at', '')::timestamptz;
  v_candidates uuid[];
  v_email text := nullif(lower(btrim(coalesce(p_request#>>'{customer,email}', ''))), '');
  v_phone text := nullif(btrim(coalesce(p_request#>>'{customer,phone}', '')), '');
  v_phone_digits text;
  v_first text := nullif(btrim(coalesce(p_request#>>'{customer,first_name}', '')), '');
  v_last text := nullif(btrim(coalesce(p_request#>>'{customer,last_name}', '')), '');
  v_existing uuid;
  v_existing_status text;
  v_existing_start timestamptz;
  v_lead uuid;
  v_chosen uuid;
  v_cand uuid;
  v_appt uuid;
  v_note text := coalesce(p_request->>'note', '');
  v_owner text;
  v_building text := nullif(btrim(coalesce(p_request#>>'{intake,building_type}', '')), '');
  v_size text := nullif(btrim(coalesce(p_request#>>'{intake,size}', '')), '');
  v_city text := nullif(btrim(coalesce(p_request#>>'{intake,city}', '')), '');
  v_timeline text := nullif(btrim(coalesce(p_request#>>'{intake,timeline}', '')), '');
  v_invite boolean := case
    when p_request ? 'customer_invite' then (p_request->>'customer_invite')::boolean
    else true
  end;
begin
  if v_starts is null or v_ends is null or v_ends <= v_starts then
    raise exception 'invalid_time' using errcode = 'P0001';
  end if;

  -- ordinality keeps primary-then-backup order from the edge function.
  select coalesce(array_agg(elem.value::uuid order by elem.ordinality), '{}'::uuid[])
    into v_candidates
  from jsonb_array_elements_text(coalesce(p_request->'candidate_ids', '[]'::jsonb))
    with ordinality as elem(value, ordinality);

  perform 1 from public.team_members where active order by id for update;

  if v_idem is not null then
    select id into v_existing from public.appointments where idempotency_key = v_idem;
    if v_existing is not null then
      perform public.attach_booking_identity(v_existing, p_request);
      return public.appointment_json(v_existing, true);
    end if;
  end if;

  if v_signed is not null then
    select id, status, starts_at
      into v_existing, v_existing_status, v_existing_start
    from public.appointments
    where signed_record_id = v_signed
    order by created_at desc
    limit 1;
    if v_existing is not null then
      perform public.attach_booking_identity(v_existing, p_request);
      if v_existing_status = 'scheduled' and v_existing_start is distinct from v_starts then
        return public.reschedule_consultation(v_existing, v_starts, v_ends, v_candidates);
      end if;
      return public.appointment_json(v_existing, true);
    end if;
  end if;

  if v_email is not null then
    select a.id into v_existing
    from public.appointments a
    left join public.leads l on l.id = a.lead_id
    where a.status = 'scheduled'
      and a.starts_at = v_starts
      and (
        lower(btrim(coalesce(a.customer_email, ''))) = v_email
        or lower(btrim(coalesce(l.email, ''))) = v_email
      )
    order by a.created_at desc
    limit 1;
    if v_existing is not null then
      perform public.attach_booking_identity(v_existing, p_request);
      return public.appointment_json(v_existing, true);
    end if;
  end if;

  foreach v_cand in array v_candidates loop
    if public.member_is_free(v_cand, v_starts, v_ends, null) then
      v_chosen := v_cand;
      exit;
    end if;
  end loop;

  if v_chosen is null then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  select display_name into v_owner from public.team_members where id = v_chosen;

  if v_email is not null then
    select id into v_lead
    from public.leads
    where lower(btrim(coalesce(email, ''))) = v_email
    order by created_at desc
    limit 1;
  end if;

  v_phone_digits := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
  if v_lead is null and length(coalesce(v_phone_digits, '')) >= 10 then
    select id into v_lead
    from public.leads
    where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone_digits
    order by created_at desc
    limit 1;
  end if;

  if v_first is null then
    v_first := 'Unknown';
  end if;
  if v_last is null then
    v_last := '—';
  end if;

  if v_lead is null then
    insert into public.leads (
      first_name, last_name, email, phone, city,
      barn_size, building_type, timeline,
      source, lead_source, stage, priority,
      notes, owner, booked_call
    ) values (
      v_first, v_last, v_email, nullif(v_phone, ''), v_city,
      v_size, v_building, v_timeline,
      'Booking Agent', 'Booking Agent', 'new', 'warm',
      nullif(v_note, ''), v_owner, true
    )
    returning id into v_lead;
  else
    update public.leads set
      booked_call = true,
      building_type = case when nullif(btrim(coalesce(building_type, '')), '') is null then coalesce(v_building, building_type) else building_type end,
      barn_size = case when nullif(btrim(coalesce(barn_size, '')), '') is null then coalesce(v_size, barn_size) else barn_size end,
      timeline = case when nullif(btrim(coalesce(timeline, '')), '') is null then coalesce(v_timeline, timeline) else timeline end,
      city = case when nullif(btrim(coalesce(city, '')), '') is null then coalesce(v_city, city) else city end,
      email = case when nullif(btrim(coalesce(email, '')), '') is null then coalesce(v_email, email) else email end,
      phone = case when nullif(btrim(coalesce(phone, '')), '') is null then coalesce(nullif(v_phone, ''), phone) else phone end,
      owner = case when nullif(btrim(coalesce(owner, '')), '') is null then coalesce(v_owner, owner) else owner end,
      source = case when nullif(btrim(coalesce(source, '')), '') is null then 'Booking Agent' else source end,
      lead_source = case when nullif(btrim(coalesce(lead_source, '')), '') is null then 'Booking Agent' else lead_source end,
      notes = case
        when coalesce(p_request->>'note_marker', '') <> ''
          and position(p_request->>'note_marker' in coalesce(notes, '')) > 0 then notes
        when v_note = '' then notes
        when nullif(notes, '') is null then v_note
        else notes || E'\n\n' || v_note
      end
    where id = v_lead;
  end if;

  insert into public.appointments (
    team_member_id, lead_id, starts_at, ends_at, status,
    service_type, source, source_agent, business, brand,
    notes, intake, idempotency_key, signed_record_id, verification_url,
    customer_name, customer_email, customer_phone, customer_invite, timezone
  ) values (
    v_chosen,
    v_lead,
    v_starts,
    v_ends,
    'scheduled',
    coalesce(nullif(p_request->>'service_type', ''), 'consultation_call'),
    coalesce(nullif(p_request->>'source', ''), 'seald'),
    nullif(p_request->>'source_agent', ''),
    nullif(p_request->>'business', ''),
    nullif(p_request->>'brand', ''),
    nullif(v_note, ''),
    coalesce(p_request->'intake', '{}'::jsonb),
    v_idem,
    v_signed,
    nullif(p_request->>'verification_url', ''),
    nullif(p_request#>>'{customer,name}', ''),
    v_email,
    nullif(v_phone, ''),
    coalesce(v_invite, true),
    coalesce(nullif(p_request->>'timezone', ''), 'America/New_York')
  )
  returning id into v_appt;

  begin
    insert into public.activities (lead_id, type, body, author, scheduled_at)
    values (
      v_lead,
      'call',
      coalesce(nullif(v_note, ''), 'Consultation booked'),
      'Booking agent',
      v_starts
    );
  exception
    when undefined_column then
      begin
        insert into public.activities (lead_id, type, body, author)
        values (v_lead, 'call', coalesce(nullif(v_note, ''), 'Consultation booked'), 'Booking agent');
      exception
        when undefined_column then
          begin
            insert into public.activities (lead_id, type, notes)
            values (v_lead, 'call', coalesce(nullif(v_note, ''), 'Consultation booked'));
          exception
            when others then
              raise warning 'booked call activity not logged: %', sqlerrm;
          end;
        when others then
          raise warning 'booked call activity not logged: %', sqlerrm;
      end;
    when others then
      raise warning 'booked call activity not logged: %', sqlerrm;
  end;

  return public.appointment_json(v_appt, false);
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  when unique_violation then
    if v_idem is not null then
      select id into v_existing from public.appointments where idempotency_key = v_idem;
      if v_existing is not null then
        perform public.attach_booking_identity(v_existing, p_request);
        return public.appointment_json(v_existing, true);
      end if;
    end if;
    if v_signed is not null then
      select id into v_existing
      from public.appointments
      where signed_record_id = v_signed
      order by created_at desc
      limit 1;
      if v_existing is not null then
        perform public.attach_booking_identity(v_existing, p_request);
        return public.appointment_json(v_existing, true);
      end if;
    end if;
    raise exception 'slot_taken' using errcode = 'P0001';
end;
$$;

create or replace function public.cancel_consultation(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.appointments
  where id = p_id
  for update;

  if v_status is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'cancelled' then
    return public.appointment_json(p_id, true);
  end if;

  if v_status <> 'scheduled' then
    raise exception 'not_scheduled' using errcode = 'P0001';
  end if;

  update public.appointments set status = 'cancelled' where id = p_id;
  return public.appointment_json(p_id, false);
end;
$$;

create or replace function public.set_consultation_outcome(p_id uuid, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  if p_status not in ('completed', 'no_show') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select status into v_status
  from public.appointments
  where id = p_id
  for update;

  if v_status is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if v_status = p_status then
    return public.appointment_json(p_id, true);
  end if;

  if v_status <> 'scheduled' then
    raise exception 'not_scheduled' using errcode = 'P0001';
  end if;

  update public.appointments set status = p_status where id = p_id;
  return public.appointment_json(p_id, false);
end;
$$;

revoke all on function public.member_is_free(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.appointment_json(uuid, boolean) from public, anon;
revoke all on function public.attach_booking_identity(uuid, jsonb) from public, anon;
revoke all on function public.reschedule_consultation(uuid, timestamptz, timestamptz, uuid[]) from public, anon;
revoke all on function public.book_consultation(jsonb) from public, anon;
revoke all on function public.cancel_consultation(uuid) from public, anon;
revoke all on function public.set_consultation_outcome(uuid, text) from public, anon;

grant execute on function public.member_is_free(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.appointment_json(uuid, boolean) to authenticated, service_role;
grant execute on function public.attach_booking_identity(uuid, jsonb) to authenticated, service_role;
grant execute on function public.reschedule_consultation(uuid, timestamptz, timestamptz, uuid[]) to authenticated, service_role;
grant execute on function public.book_consultation(jsonb) to authenticated, service_role;
grant execute on function public.cancel_consultation(uuid) to authenticated, service_role;
grant execute on function public.set_consultation_outcome(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
