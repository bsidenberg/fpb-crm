-- Booqer attribution on booked calls.
--
-- DO NOT APPLY from CI or by merging the pull request. Run by hand in the
-- Supabase SQL editor after 20261014000001_booking_window_0830.sql.
-- This replaces functions only. It does not update existing lead rows.
--
-- Blank source / lead_source become the request's lead_source (Booqer's
-- source_label, or the Booqer consent fallback the edge function sends).
-- If that field is missing, the label is Booqer. A value already on the
-- lead is left alone. referrer_url, landing_page, and utm_* fill the same
-- way. The dedupe marker in notes is unchanged: position(note_marker)
-- still matches notes that already contain [booked-call:…] in plain text
-- or inside an HTML comment.
--
-- normalize_lead_channel keeps a source that starts with Booqer, so a later
-- backfill does not collapse "Booqer: ChatGPT" into Other. This file does
-- not run that backfill.

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
  v_lead_source text := coalesce(nullif(btrim(coalesce(p_request->>'lead_source', '')), ''), 'Booqer');
  v_referrer text := nullif(btrim(coalesce(p_request->>'referrer_url', '')), '');
  v_landing text := nullif(btrim(coalesce(p_request->>'landing_page', '')), '');
  v_utm_source text := nullif(btrim(coalesce(p_request->>'utm_source', '')), '');
  v_utm_medium text := nullif(btrim(coalesce(p_request->>'utm_medium', '')), '');
  v_utm_campaign text := nullif(btrim(coalesce(p_request->>'utm_campaign', '')), '');
  v_utm_term text := nullif(btrim(coalesce(p_request->>'utm_term', '')), '');
  v_utm_content text := nullif(btrim(coalesce(p_request->>'utm_content', '')), '');
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
    source = case when nullif(btrim(coalesce(source, '')), '') is null then v_lead_source else source end,
    lead_source = case when nullif(btrim(coalesce(lead_source, '')), '') is null then v_lead_source else lead_source end,
    referrer_url = case when nullif(btrim(coalesce(referrer_url, '')), '') is null then coalesce(v_referrer, referrer_url) else referrer_url end,
    landing_page = case when nullif(btrim(coalesce(landing_page, '')), '') is null then coalesce(v_landing, landing_page) else landing_page end,
    utm_source = case when nullif(btrim(coalesce(utm_source, '')), '') is null then coalesce(v_utm_source, utm_source) else utm_source end,
    utm_medium = case when nullif(btrim(coalesce(utm_medium, '')), '') is null then coalesce(v_utm_medium, utm_medium) else utm_medium end,
    utm_campaign = case when nullif(btrim(coalesce(utm_campaign, '')), '') is null then coalesce(v_utm_campaign, utm_campaign) else utm_campaign end,
    utm_term = case when nullif(btrim(coalesce(utm_term, '')), '') is null then coalesce(v_utm_term, utm_term) else utm_term end,
    utm_content = case when nullif(btrim(coalesce(utm_content, '')), '') is null then coalesce(v_utm_content, utm_content) else utm_content end,
    notes = case
      when v_marker <> '' and position(v_marker in coalesce(notes, '')) > 0 then notes
      when v_note = '' then notes
      when nullif(notes, '') is null then v_note
      else notes || E'\n\n' || v_note
    end
  where id = p_lead;
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
  v_lead_source text := coalesce(nullif(btrim(coalesce(p_request->>'lead_source', '')), ''), 'Booqer');
  v_referrer text := nullif(btrim(coalesce(p_request->>'referrer_url', '')), '');
  v_landing text := nullif(btrim(coalesce(p_request->>'landing_page', '')), '');
  v_utm_source text := nullif(btrim(coalesce(p_request->>'utm_source', '')), '');
  v_utm_medium text := nullif(btrim(coalesce(p_request->>'utm_medium', '')), '');
  v_utm_campaign text := nullif(btrim(coalesce(p_request->>'utm_campaign', '')), '');
  v_utm_term text := nullif(btrim(coalesce(p_request->>'utm_term', '')), '');
  v_utm_content text := nullif(btrim(coalesce(p_request->>'utm_content', '')), '');
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
      notes, owner, booked_call,
      referrer_url, landing_page,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content
    ) values (
      v_first, v_last, v_email, nullif(v_phone, ''), v_city,
      v_size, v_building, v_timeline,
      v_lead_source, v_lead_source, 'new', 'warm',
      nullif(v_note, ''), v_owner, true,
      v_referrer, v_landing,
      v_utm_source, v_utm_medium, v_utm_campaign, v_utm_term, v_utm_content
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
      'Booqer',
      v_starts
    );
  exception
    when undefined_column then
      begin
        insert into public.activities (lead_id, type, body, author)
        values (v_lead, 'call', coalesce(nullif(v_note, ''), 'Consultation booked'), 'Booqer');
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

CREATE OR REPLACE FUNCTION public.normalize_lead_channel(
  p_source text,
  p_lead_source text,
  p_utm_source text,
  p_utm_medium text,
  p_referrer_url text,
  p_gclid text,
  p_fbclid text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  src text := btrim(coalesce(p_source, ''));
  utm_src text;
  utm_med text;
  ref_host text;
  from_label text;
  paid boolean;
BEGIN
  IF src IN (
    'Google Ads', 'Google Organic', 'Meta Ads', 'Organic Social',
    'Referral', 'Direct', 'AI Search', 'Email', 'Cold Call', 'Booking Agent', 'Other'
  ) THEN
    RETURN src;
  END IF;

  -- Keep Booqer attribution labels ("Booqer: ChatGPT") instead of reclassifying them.
  IF src ~* '^booqer(\s|:|$)' THEN
    RETURN src;
  END IF;

  IF btrim(coalesce(p_gclid, '')) <> '' THEN
    RETURN 'Google Ads';
  END IF;
  IF btrim(coalesce(p_fbclid, '')) <> '' THEN
    RETURN 'Meta Ads';
  END IF;

  utm_src := btrim(regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_utm_source, ''))), '[_./-]+', ' ', 'g'),
    '\s+', ' ', 'g'
  ));
  utm_med := btrim(regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_utm_medium, ''))), '[_./-]+', ' ', 'g'),
    '\s+', ' ', 'g'
  ));
  paid := utm_med IN ('cpc', 'ppc', 'paid', 'paid search', 'cpm', 'paid social', 'paidsocial', 'sem');

  IF utm_src <> '' OR utm_med <> '' THEN
    IF (utm_src IN ('google', 'google ads', 'adwords', 'googleads', 'google adwords')) AND paid THEN
      RETURN 'Google Ads';
    ELSIF utm_src IN ('google ads', 'adwords', 'googleads', 'google adwords') THEN
      RETURN 'Google Ads';
    ELSIF utm_src IN ('facebook', 'fb', 'instagram', 'ig', 'meta', 'meta ads', 'facebook ads') THEN
      RETURN 'Meta Ads';
    ELSIF utm_med = 'email' OR utm_src IN ('email', 'newsletter', 'klaviyo', 'mailchimp') THEN
      RETURN 'Email';
    ELSIF utm_med IN ('social', 'organic social', 'social organic') THEN
      RETURN 'Organic Social';
    ELSIF utm_src IN ('google', 'google com') THEN
      RETURN 'Google Organic';
    ELSIF utm_src IN ('bing', 'yahoo', 'duckduckgo', 'ecosia', 'brave', 'baidu', 'yandex') THEN
      RETURN 'Other';
    ELSIF utm_src IN ('chatgpt', 'openai', 'perplexity', 'claude', 'anthropic', 'gemini', 'bard', 'copilot', 'phind', 'grok') THEN
      RETURN 'AI Search';
    ELSIF utm_src IN ('twitter', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'nextdoor', 'reddit', 'threads') THEN
      RETURN 'Organic Social';
    ELSIF utm_src = 'referral' OR utm_med = 'referral' THEN
      RETURN 'Referral';
    ELSIF utm_src IN ('direct', '(direct)', '(none)', 'none') OR utm_med = 'direct' THEN
      RETURN 'Direct';
    ELSIF utm_med IN ('organic', 'seo') THEN
      RETURN 'Google Organic';
    END IF;
  END IF;

  from_label := public.canonicalize_lead_source_label(src);
  IF from_label IS NULL THEN
    from_label := public.canonicalize_lead_source_label(p_lead_source);
  END IF;
  IF from_label IS NOT NULL THEN
    RETURN from_label;
  END IF;

  ref_host := lower(btrim(coalesce(p_referrer_url, '')));
  ref_host := regexp_replace(ref_host, '^https?://', '');
  ref_host := split_part(ref_host, '/', 1);
  ref_host := split_part(ref_host, '?', 1);
  ref_host := split_part(ref_host, '#', 1);
  ref_host := regexp_replace(ref_host, '^www\.', '');
  ref_host := split_part(ref_host, ':', 1);

  IF ref_host <> ''
     AND ref_host <> 'localhost'
     AND ref_host <> '127.0.0.1'
     AND ref_host <> 'floridapolebarn.com'
     AND ref_host NOT LIKE '%.floridapolebarn.com'
     AND NOT (ref_host LIKE '%.vercel.app' AND ref_host LIKE '%floridapolebarn%')
  THEN
    IF ref_host = 'chatgpt.com' OR ref_host LIKE '%.chatgpt.com'
       OR ref_host = 'openai.com' OR ref_host LIKE '%.openai.com'
       OR ref_host = 'perplexity.ai' OR ref_host LIKE '%.perplexity.ai'
       OR ref_host = 'claude.ai' OR ref_host LIKE '%.claude.ai'
       OR ref_host = 'anthropic.com' OR ref_host LIKE '%.anthropic.com'
       OR ref_host = 'gemini.google.com' OR ref_host LIKE '%.gemini.google.com'
       OR ref_host = 'bard.google.com' OR ref_host LIKE '%.bard.google.com'
       OR ref_host = 'copilot.microsoft.com' OR ref_host LIKE '%.copilot.microsoft.com'
       OR ref_host = 'you.com' OR ref_host LIKE '%.you.com'
       OR ref_host = 'phind.com' OR ref_host LIKE '%.phind.com'
       OR ref_host = 'x.ai' OR ref_host LIKE '%.x.ai'
       OR ref_host = 'grok.com' OR ref_host LIKE '%.grok.com'
       OR ref_host = 'poe.com' OR ref_host LIKE '%.poe.com'
    THEN
      RETURN 'AI Search';
    ELSIF ref_host = 'ads.google.com'
       OR ref_host = 'googleadservices.com' OR ref_host LIKE '%.googleadservices.com'
       OR ref_host = 'doubleclick.net' OR ref_host LIKE '%.doubleclick.net'
    THEN
      RETURN 'Google Ads';
    ELSIF ref_host = 'google.com' OR ref_host LIKE '%.google.com' OR ref_host LIKE 'google.%' THEN
      IF position('/aclk' in lower(coalesce(p_referrer_url, ''))) > 0
         OR position('/pagead' in lower(coalesce(p_referrer_url, ''))) > 0
      THEN
        RETURN 'Google Ads';
      END IF;
      RETURN 'Google Organic';
    ELSIF ref_host = 'bing.com' OR ref_host LIKE '%.bing.com'
       OR ref_host = 'yahoo.com' OR ref_host LIKE '%.yahoo.com'
       OR ref_host = 'duckduckgo.com' OR ref_host LIKE '%.duckduckgo.com'
       OR ref_host = 'ecosia.org' OR ref_host LIKE '%.ecosia.org'
       OR ref_host = 'baidu.com' OR ref_host LIKE '%.baidu.com'
       OR ref_host = 'yandex.com' OR ref_host LIKE '%.yandex.com'
       OR ref_host = 'yandex.ru' OR ref_host LIKE '%.yandex.ru'
       OR ref_host = 'search.brave.com'
    THEN
      RETURN 'Other';
    ELSIF ref_host = 'facebook.com' OR ref_host LIKE '%.facebook.com'
       OR ref_host = 'fb.com' OR ref_host LIKE '%.fb.com'
       OR ref_host = 'instagram.com' OR ref_host LIKE '%.instagram.com'
       OR ref_host = 'twitter.com' OR ref_host LIKE '%.twitter.com'
       OR ref_host = 't.co' OR ref_host LIKE '%.t.co'
       OR ref_host = 'x.com' OR ref_host LIKE '%.x.com'
       OR ref_host = 'linkedin.com' OR ref_host LIKE '%.linkedin.com'
       OR ref_host = 'tiktok.com' OR ref_host LIKE '%.tiktok.com'
       OR ref_host = 'youtube.com' OR ref_host LIKE '%.youtube.com'
       OR ref_host = 'youtu.be' OR ref_host LIKE '%.youtu.be'
       OR ref_host = 'pinterest.com' OR ref_host LIKE '%.pinterest.com'
       OR ref_host = 'reddit.com' OR ref_host LIKE '%.reddit.com'
       OR ref_host = 'nextdoor.com' OR ref_host LIKE '%.nextdoor.com'
       OR ref_host = 'threads.net' OR ref_host LIKE '%.threads.net'
    THEN
      RETURN 'Organic Social';
    ELSE
      RETURN 'Referral';
    END IF;
  END IF;

  IF src = '' OR lower(src) IN ('unknown', 'n/a', 'na', 'null', 'undefined', 'not set', '—')
     OR btrim(regexp_replace(regexp_replace(lower(src), '[_./-]+', ' ', 'g'), '\s+', ' ', 'g')) IN (
       'unknown', 'n a', 'na', 'null', 'undefined', 'not set'
     )
  THEN
    RETURN 'Direct';
  END IF;

  RETURN 'Other';
END;
$$;


revoke all on function public.apply_booking_lead_patch(uuid, jsonb, text) from public, anon;
revoke all on function public.book_consultation(jsonb) from public, anon;
grant execute on function public.apply_booking_lead_patch(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.book_consultation(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
