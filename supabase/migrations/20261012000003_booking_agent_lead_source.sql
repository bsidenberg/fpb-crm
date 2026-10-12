-- Keep "Booking Agent" as its own channel, matching src/lib/leadSource.js.
-- Does not backfill existing leads. Do not re-run 20260923000001 after this:
-- that older file would replace these functions and drop Booking Agent again.
--
-- DO NOT APPLY from CI. Run in the Supabase SQL editor after
-- 20261012000002_booked_calls.sql. See docs/BOOKING_SETUP.md.

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
    WHEN key IN ('google organic', 'organic search', 'google search', 'organic', 'seo', 'google') THEN 'Google Organic'
    WHEN key IN ('meta ads', 'meta', 'facebook', 'facebook ads', 'fb', 'instagram', 'ig') THEN 'Meta Ads'
    WHEN key IN ('organic social', 'social') THEN 'Organic Social'
    WHEN key IN ('referral', 'referred', 'word of mouth') THEN 'Referral'
    WHEN key IN ('direct', '(direct)') THEN 'Direct'
    WHEN key IN ('ai search', 'chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot') THEN 'AI Search'
    WHEN key IN ('email', 'newsletter') THEN 'Email'
    WHEN key IN ('cold call', 'coldcall') THEN 'Cold Call'
    WHEN key IN ('booking agent', 'seald') THEN 'Booking Agent'
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
    'Google Ads', 'Google Organic', 'Meta Ads', 'Organic Social',
    'Referral', 'Direct', 'AI Search', 'Email', 'Cold Call', 'Booking Agent', 'Other'
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

