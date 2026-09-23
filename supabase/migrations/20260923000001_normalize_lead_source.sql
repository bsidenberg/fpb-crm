-- Normalize historical lead channels to the canonical set used by the CRM
-- and by floridapolebarn1 (lib/utm.ts resolveLeadSource).
--
-- Canonical channels:
--   Google Ads, Organic Search, Meta Ads, Organic Social, Referral,
--   Direct, AI Search, Email, Cold Call, Other
--
-- Organic Search (not "Google Organic") matches the website resolver.
-- Website Form / Website Chat are capture methods, not channels.
--
-- HOW TO RUN
--   Brian: open Supabase → SQL Editor → New query → paste this file → Run.
--   Safe to run more than once. No service-role key is required.
--   The update disables user triggers so updated_at is not bumped, then
--   re-enables them. On failure the trigger is turned back on before the
--   error is raised.
--
-- Preview the mapping first (optional). Run this SELECT by itself:
--
--   SELECT source AS before_source,
--          lead_source AS before_lead_source,
--          public.normalize_lead_channel(
--            source, lead_source, utm_source, utm_medium, referrer_url, gclid, fbclid
--          ) AS after_channel,
--          count(*)
--   FROM public.leads
--   GROUP BY 1, 2, 3
--   ORDER BY count(*) DESC;
--
-- Priority for rows whose source is NOT already a canonical label:
--   1. gclid            → Google Ads
--   2. fbclid           → Meta Ads
--   3. utm cpc/paid + google → Google Ads
--   4. utm facebook/instagram/fb/ig/meta → Meta Ads
--   5. other utm_source / utm_medium maps
--   6. alias of source, then lead_source
--      (a recognized label such as Facebook or Google Organic beats the
--      referrer, so "fb" stays Meta Ads instead of splitting into Organic
--      Social just because referrer_url is facebook.com. Website Form has
--      no alias, so it still falls through to the referrer.)
--   7. referrer_url host
--   8. blank / Unknown  → Direct
--   9. anything else (including Website Form / Website Chat with no signal) → Other
--
-- A source that is already canonical is left alone so a sales rep's manual
-- pick is not overwritten on a second run. Click ids still reclassify
-- Website Form, Unknown, Google Organic, Facebook, fb, and blanks.
--
-- The website quote API does not yet write gclid/fbclid onto leads (it sends
-- them to the marketing bot only). Those columns are added here so a future
-- site insert and a later re-run of this backfill can use them.
--
-- Keep in sync with src/lib/leadSource.js.

-- 1. Columns. IF NOT EXISTS so this is safe if production already has them.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source        text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_source   text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_source    text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_medium    text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_campaign  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_term      text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_content   text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS referrer_url  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS landing_page  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS gclid         text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS fbclid        text;

-- 2. Label alias. NULL means "not a channel" (blank, unknown, capture method).
CREATE OR REPLACE FUNCTION public.canonicalize_lead_source_label(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH k AS (
    SELECT btrim(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '[_./-]+', ' ', 'g'),
        '\s+',
        ' ',
        'g'
      )
    ) AS key
  )
  SELECT CASE
    WHEN key = '' THEN NULL
    WHEN key IN (
      'website', 'website form', 'website chat', 'web form', 'quote form',
      'website quote form', 'chat', 'joseph'
    ) THEN NULL
    WHEN key IN ('unknown', 'n a', 'na', 'null', 'undefined', 'not set', '—') THEN NULL
    WHEN key IN ('google ads', 'google adwords', 'adwords', 'googleads', 'ppc') THEN 'Google Ads'
    WHEN key IN ('google organic', 'organic search', 'google search', 'organic', 'seo', 'google') THEN 'Organic Search'
    WHEN key IN ('meta ads', 'meta', 'facebook', 'facebook ads', 'fb', 'instagram', 'ig') THEN 'Meta Ads'
    WHEN key IN ('organic social', 'social') THEN 'Organic Social'
    WHEN key IN ('referral', 'referred', 'word of mouth') THEN 'Referral'
    WHEN key IN ('direct', '(direct)') THEN 'Direct'
    WHEN key IN ('ai search', 'chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot') THEN 'AI Search'
    WHEN key IN ('email', 'newsletter') THEN 'Email'
    WHEN key IN ('cold call', 'coldcall') THEN 'Cold Call'
    WHEN key = 'other' THEN 'Other'
    ELSE NULL
  END
  FROM k;
$$;

-- 3. Full classifier. Mirrors normalizeSource() in src/lib/leadSource.js.
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
    'Google Ads', 'Organic Search', 'Meta Ads', 'Organic Social',
    'Referral', 'Direct', 'AI Search', 'Email', 'Cold Call', 'Other'
  ) THEN
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
    ELSIF utm_src IN ('google', 'bing', 'yahoo', 'duckduckgo', 'ecosia', 'brave') THEN
      RETURN 'Organic Search';
    ELSIF utm_src IN ('chatgpt', 'openai', 'perplexity', 'claude', 'anthropic', 'gemini', 'bard', 'copilot', 'phind', 'grok') THEN
      RETURN 'AI Search';
    ELSIF utm_src IN ('twitter', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'nextdoor', 'reddit', 'threads') THEN
      RETURN 'Organic Social';
    ELSIF utm_src = 'referral' OR utm_med = 'referral' THEN
      RETURN 'Referral';
    ELSIF utm_src IN ('direct', '(direct)', '(none)', 'none') OR utm_med = 'direct' THEN
      RETURN 'Direct';
    ELSIF utm_med IN ('organic', 'seo') THEN
      RETURN 'Organic Search';
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
    ELSIF ref_host = 'google.com' OR ref_host LIKE '%.google.com' OR ref_host LIKE 'google.%'
       OR ref_host = 'bing.com' OR ref_host LIKE '%.bing.com'
       OR ref_host = 'yahoo.com' OR ref_host LIKE '%.yahoo.com'
       OR ref_host = 'duckduckgo.com' OR ref_host LIKE '%.duckduckgo.com'
       OR ref_host = 'ecosia.org' OR ref_host LIKE '%.ecosia.org'
       OR ref_host = 'search.brave.com'
    THEN
      RETURN 'Organic Search';
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

-- 4. Backfill source and lead_source together. Idempotent.
DO $$
DECLARE
  updated_count integer;
BEGIN
  ALTER TABLE public.leads DISABLE TRIGGER USER;

  UPDATE public.leads AS l
  SET source = n.channel,
      lead_source = n.channel
  FROM (
    SELECT
      id,
      public.normalize_lead_channel(
        source, lead_source, utm_source, utm_medium, referrer_url, gclid, fbclid
      ) AS channel
    FROM public.leads
  ) AS n
  WHERE l.id = n.id
    AND (
      l.source IS DISTINCT FROM n.channel
      OR l.lead_source IS DISTINCT FROM n.channel
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'normalize_lead_source: updated % lead rows', updated_count;

  ALTER TABLE public.leads ENABLE TRIGGER USER;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      ALTER TABLE public.leads ENABLE TRIGGER USER;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    RAISE;
END $$;
