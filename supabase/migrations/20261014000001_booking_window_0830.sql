-- Mon–Fri 8:30 AM–4:30 PM America/New_York. 30-minute slots start on :00 or :30.
-- The last start is 4:00 PM. Rejects weekends, starts before 8:30, starts at
-- or after 4:30, and any other minute.
--
-- Replaces the time check used by book_consultation, reschedule_consultation,
-- and direct writes to booked calls (public.appointments). Does not edit
-- 20261012000002_booked_calls.sql or 20261012000005_return_booked_leads_to_new.sql.
--
-- book_consultation still calls apply_booking_lead_patch from
-- 20261012000005_return_booked_leads_to_new.sql: a matched lead returns to stage 'new', booked_call is set true,
-- lead_source is filled only when blank, and quote_sent_at is left alone.
--
-- DO NOT APPLY from CI. Run in the Supabase SQL editor after
-- 20261012000002_booked_calls.sql, 20261012000003_booking_agent_lead_source.sql,
-- and 20261012000005_return_booked_leads_to_new.sql.
-- See docs/BOOKING_SETUP.md.

create or replace function public.booking_slot_allowed(
  p_starts timestamptz,
  p_ends timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  select
    p_starts is not null
    and p_ends is not null
    and p_ends > p_starts
    and extract(isodow from (p_starts at time zone 'America/New_York')) between 1 and 5
    and (extract(minute from (p_starts at time zone 'America/New_York')))::integer in (0, 30)
    and date_trunc('minute', (p_starts at time zone 'America/New_York'))
        = (p_starts at time zone 'America/New_York')
    and (p_starts at time zone 'America/New_York')::time >= time '08:30'
    and (p_starts at time zone 'America/New_York')::time < time '16:30'
    and (p_ends at time zone 'America/New_York')::date
        = (p_starts at time zone 'America/New_York')::date
    and (p_ends at time zone 'America/New_York')::time <= time '16:30';
$$;

comment on function public.booking_slot_allowed(timestamptz, timestamptz) is
  'True when a booked call starts Mon–Fri 8:30–4:00 America/New_York on :00 or :30 and ends the same day by 4:30.';

-- Members still on the previous default move to 8:30 AM. Custom windows that
-- are not exactly Mon–Fri 09:30–16:30 are left alone; the trigger still
-- rejects anything outside the new window.
update public.team_members
set weekly_hours = jsonb_build_object(
  'mon', jsonb_build_array(jsonb_build_array('08:30', '16:30')),
  'tue', jsonb_build_array(jsonb_build_array('08:30', '16:30')),
  'wed', jsonb_build_array(jsonb_build_array('08:30', '16:30')),
  'thu', jsonb_build_array(jsonb_build_array('08:30', '16:30')),
  'fri', jsonb_build_array(jsonb_build_array('08:30', '16:30')),
  'sat', '[]'::jsonb,
  'sun', '[]'::jsonb
)
where weekly_hours -> 'mon' = '[["09:30","16:30"]]'::jsonb
  and weekly_hours -> 'tue' = '[["09:30","16:30"]]'::jsonb
  and weekly_hours -> 'wed' = '[["09:30","16:30"]]'::jsonb
  and weekly_hours -> 'thu' = '[["09:30","16:30"]]'::jsonb
  and weekly_hours -> 'fri' = '[["09:30","16:30"]]'::jsonb;

create or replace function public.enforce_booked_call_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at then
    return new;
  end if;

  if not public.booking_slot_allowed(new.starts_at, new.ends_at) then
    raise exception 'invalid_time' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists booked_calls_time_check on public.appointments;
create trigger booked_calls_time_check
  before insert or update on public.appointments
  for each row
  execute function public.enforce_booked_call_time();

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
  if not public.booking_slot_allowed(p_starts, p_ends) then
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

  if not public.booking_slot_allowed(v_starts, v_ends) then
    raise exception 'invalid_time' using errcode = 'P0001';
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
    perform public.apply_booking_lead_patch(v_lead, p_request, v_owner);
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

revoke all on function public.booking_slot_allowed(timestamptz, timestamptz) from public, anon;
revoke all on function public.enforce_booked_call_time() from public, anon;
grant execute on function public.booking_slot_allowed(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.enforce_booked_call_time() to authenticated, service_role;

notify pgrst, 'reload schema';
