-- Return every booked consultation to the New Lead column.
--
-- DO NOT APPLY from CI or by merging the pull request. Run by hand in the
-- Supabase SQL editor for project flabvhdgqddbfitbqjqk, after
-- 20261012000002_booked_calls.sql and 20261012000003_booking_agent_lead_source.sql.
--
-- book_consultation keeps the same signature and return value
-- (jsonb book_consultation(jsonb)) so the deployed booking edge function
-- keeps working.
--
-- When a booking matches an existing lead (email, then phone), the lead is
-- moved to stage 'new' from any stage, including won and lost, and
-- booked_call is set true. lead_source becomes 'Booking Agent' only when it
-- is blank; an existing lead_source is kept. quote_sent_at is not changed.
-- A new lead is still inserted at stage 'new'. The consultation is still
-- logged in activities on the new-appointment path.
-- stage_changed_at is stamped only when the stage actually changes, so a
-- lead that was already in New Lead keeps its place among the other cards
-- once the call is marked done.

alter table public.leads
  add column if not exists stage_changed_at timestamptz;

-- Shared by book_consultation and attach_booking_identity (idempotent
-- replays). SECURITY INVOKER, same roles as book_consultation.
create or replace function public.apply_booking_lead_patch(
  p_lead uuid,
  p_request jsonb,
  p_owner text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_request#>>'{customer,email}', ''))), '');
  v_phone text := nullif(btrim(coalesce(p_request#>>'{customer,phone}', '')), '');
  v_building text := nullif(btrim(coalesce(p_request#>>'{intake,building_type}', '')), '');
  v_size text := nullif(btrim(coalesce(p_request#>>'{intake,size}', '')), '');
  v_city text := nullif(btrim(coalesce(p_request#>>'{intake,city}', '')), '');
  v_timeline text := nullif(btrim(coalesce(p_request#>>'{intake,timeline}', '')), '');
  v_note text := coalesce(p_request->>'note', '');
  v_marker text := coalesce(p_request->>'note_marker', '');
begin
  if p_lead is null then
    return;
  end if;

  update public.leads set
    stage = 'new',
    stage_changed_at = case
      when stage is distinct from 'new' then now()
      else stage_changed_at
    end,
    booked_call = true,
    building_type = case when nullif(btrim(coalesce(building_type, '')), '') is null then coalesce(v_building, building_type) else building_type end,
    barn_size = case when nullif(btrim(coalesce(barn_size, '')), '') is null then coalesce(v_size, barn_size) else barn_size end,
    timeline = case when nullif(btrim(coalesce(timeline, '')), '') is null then coalesce(v_timeline, timeline) else timeline end,
    city = case when nullif(btrim(coalesce(city, '')), '') is null then coalesce(v_city, city) else city end,
    email = case when nullif(btrim(coalesce(email, '')), '') is null then coalesce(v_email, email) else email end,
    phone = case when nullif(btrim(coalesce(phone, '')), '') is null then coalesce(nullif(v_phone, ''), phone) else phone end,
    owner = case when nullif(btrim(coalesce(owner, '')), '') is null then coalesce(nullif(btrim(coalesce(p_owner, '')), ''), owner) else owner end,
    source = case when nullif(btrim(coalesce(source, '')), '') is null then 'Booking Agent' else source end,
    lead_source = case when nullif(btrim(coalesce(lead_source, '')), '') is null then 'Booking Agent' else lead_source end,
    notes = case
      when v_marker <> '' and position(v_marker in coalesce(notes, '')) > 0 then notes
      when v_note = '' then notes
      when nullif(notes, '') is null then v_note
      else notes || E'\n\n' || v_note
    end
  where id = p_lead;
end;
$$;

-- Second arrival (API or webhook) fills keys and blank lead fields, returns
-- the lead to stage 'new', and does not create a second appointment.
-- quote_sent_at is left alone.
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

  perform public.apply_booking_lead_patch(v_lead, p_request, v_owner);
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


revoke all on function public.apply_booking_lead_patch(uuid, jsonb, text) from public, anon;
revoke all on function public.attach_booking_identity(uuid, jsonb) from public, anon;
revoke all on function public.book_consultation(jsonb) from public, anon;

grant execute on function public.apply_booking_lead_patch(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.attach_booking_identity(uuid, jsonb) to authenticated, service_role;
grant execute on function public.book_consultation(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
