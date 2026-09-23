/**
 * Canonical lead channels for Florida Pole Barn.
 *
 * Labels match floridapolebarn1 `LEAD_CHANNELS` / `resolveLeadSource`
 * (lib/utm.ts on main). Unpaid Google search is **Google Organic**.
 * "Organic Search" is a historical alias of that same channel. Meta
 * facebook/instagram utm sources are Meta Ads. Website Form / Website Chat
 * are capture methods, not channels.
 *
 * Cold Call stays as a manual sales source. It is not a website channel.
 *
 * Already-canonical `source` values are kept so a rep's dropdown pick is
 * stable. Click ids, UTMs, and referrers reclassify everything else.
 * Keep this in sync with supabase/migrations/20260923000001_normalize_lead_source.sql.
 */

export const LEAD_SOURCES = [
  'Google Ads',
  'Google Organic',
  'Meta Ads',
  'Organic Social',
  'Referral',
  'Direct',
  'AI Search',
  'Email',
  'Cold Call',
  'Other',
]

const CANONICAL = new Set(LEAD_SOURCES)

const CAPTURE_KEYS = new Set([
  'website',
  'website form',
  'website chat',
  'web form',
  'quote form',
  'website quote form',
  'chat',
  'joseph',
])

const UNKNOWN_KEYS = new Set([
  'unknown',
  'n a',
  'na',
  'null',
  'undefined',
  'not set',
  '—',
])

const PAID_MEDIUMS = new Set([
  'cpc',
  'ppc',
  'paid',
  'paid search',
  'cpm',
  'paid social',
  'paidsocial',
  'sem',
])

const META_SOURCES = new Set([
  'facebook',
  'fb',
  'instagram',
  'ig',
  'meta',
  'meta ads',
  'facebook ads',
])

const OTHER_SEARCH_SOURCES = new Set([
  'bing',
  'yahoo',
  'duckduckgo',
  'ecosia',
  'brave',
  'baidu',
  'yandex',
])

const AI_SOURCES = new Set([
  'chatgpt',
  'openai',
  'perplexity',
  'claude',
  'anthropic',
  'gemini',
  'bard',
  'copilot',
  'phind',
  'grok',
])

const SOCIAL_SOURCES = new Set([
  'twitter',
  'linkedin',
  'tiktok',
  'youtube',
  'pinterest',
  'nextdoor',
  'reddit',
  'threads',
])

/** Historical labels → canonical channel. Capture methods and unknowns are omitted. */
const ALIASES = {
  'google ads': 'Google Ads',
  'google adwords': 'Google Ads',
  adwords: 'Google Ads',
  googleads: 'Google Ads',
  ppc: 'Google Ads',

  'google organic': 'Google Organic',
  'organic search': 'Google Organic',
  'google search': 'Google Organic',
  organic: 'Google Organic',
  seo: 'Google Organic',
  google: 'Google Organic',

  'meta ads': 'Meta Ads',
  meta: 'Meta Ads',
  facebook: 'Meta Ads',
  'facebook ads': 'Meta Ads',
  fb: 'Meta Ads',
  instagram: 'Meta Ads',
  ig: 'Meta Ads',

  'organic social': 'Organic Social',
  social: 'Organic Social',

  referral: 'Referral',
  referred: 'Referral',
  'word of mouth': 'Referral',

  direct: 'Direct',
  '(direct)': 'Direct',

  'ai search': 'AI Search',
  chatgpt: 'AI Search',
  openai: 'AI Search',
  perplexity: 'AI Search',
  claude: 'AI Search',
  gemini: 'AI Search',
  copilot: 'AI Search',

  email: 'Email',
  newsletter: 'Email',

  'cold call': 'Cold Call',
  coldcall: 'Cold Call',

  other: 'Other',
}

function text(value) {
  if (value == null) return ''
  return String(value).trim()
}

export function normKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isExactCanonical(value) {
  return CANONICAL.has(text(value))
}

function isCapture(value) {
  return CAPTURE_KEYS.has(normKey(value))
}

function isUnknown(value) {
  const raw = text(value)
  if (!raw) return true
  return UNKNOWN_KEYS.has(normKey(value))
}

/** Map one stored label. Returns null for blanks, unknowns, and capture methods. */
export function aliasChannel(value) {
  const key = normKey(value)
  if (!key || CAPTURE_KEYS.has(key) || UNKNOWN_KEYS.has(key)) return null
  return ALIASES[key] ?? null
}

function classifyUtm(utmSource, utmMedium) {
  const src = normKey(utmSource)
  const med = normKey(utmMedium)
  if (!src && !med) return null

  const paid = PAID_MEDIUMS.has(med)
  const googleAdsSource = src === 'google ads' || src === 'adwords' || src === 'googleads' || src === 'google adwords'

  if ((src === 'google' || googleAdsSource) && paid) return 'Google Ads'
  if (googleAdsSource) return 'Google Ads'
  if (META_SOURCES.has(src)) return 'Meta Ads'
  if (med === 'email' || src === 'email' || src === 'newsletter' || src === 'klaviyo' || src === 'mailchimp') {
    return 'Email'
  }
  if (med === 'social' || med === 'organic social' || med === 'social organic') return 'Organic Social'
  if (src === 'google' || src === 'google com') return 'Google Organic'
  if (OTHER_SEARCH_SOURCES.has(src)) return 'Other'
  if (AI_SOURCES.has(src)) return 'AI Search'
  if (SOCIAL_SOURCES.has(src)) return 'Organic Social'
  if (src === 'referral' || med === 'referral') return 'Referral'
  if (src === 'direct' || med === 'direct' || src === '(direct)' || src === '(none)' || src === 'none') {
    return 'Direct'
  }
  if (med === 'organic' || med === 'seo') return 'Google Organic'
  return null
}

function hostIs(host, root) {
  return host === root || host.endsWith(`.${root}`)
}

function isInternalHost(host) {
  return host === 'localhost'
    || host === '127.0.0.1'
    || hostIs(host, 'floridapolebarn.com')
    || (host.endsWith('.vercel.app') && host.includes('floridapolebarn'))
}

function isAiHost(host) {
  return [
    'chatgpt.com',
    'openai.com',
    'perplexity.ai',
    'claude.ai',
    'anthropic.com',
    'gemini.google.com',
    'bard.google.com',
    'copilot.microsoft.com',
    'you.com',
    'phind.com',
    'x.ai',
    'grok.com',
    'poe.com',
  ].some(root => hostIs(host, root))
}

function isGoogleAdsHost(host) {
  return host === 'ads.google.com'
    || hostIs(host, 'googleadservices.com')
    || hostIs(host, 'doubleclick.net')
}

function isGoogleSearchHost(host) {
  return hostIs(host, 'google.com') || host.startsWith('google.')
}

function isOtherSearchHost(host) {
  return hostIs(host, 'bing.com')
    || hostIs(host, 'yahoo.com')
    || hostIs(host, 'duckduckgo.com')
    || hostIs(host, 'ecosia.org')
    || hostIs(host, 'baidu.com')
    || hostIs(host, 'yandex.com')
    || hostIs(host, 'yandex.ru')
    || host === 'search.brave.com'
}

function isSocialHost(host) {
  return [
    'facebook.com',
    'fb.com',
    'instagram.com',
    'twitter.com',
    't.co',
    'x.com',
    'linkedin.com',
    'tiktok.com',
    'youtube.com',
    'youtu.be',
    'pinterest.com',
    'reddit.com',
    'nextdoor.com',
    'threads.net',
  ].some(root => hostIs(host, root))
}

function classifyReferrer(referrerUrl) {
  const raw = text(referrerUrl)
  if (!raw) return null
  let host = ''
  let pathname = ''
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(withProto)
    host = url.hostname.toLowerCase().replace(/^www\./, '')
    pathname = url.pathname.toLowerCase()
  } catch {
    return null
  }
  if (!host || isInternalHost(host)) return null
  if (isAiHost(host)) return 'AI Search'
  if (isGoogleAdsHost(host)) return 'Google Ads'
  if (isGoogleSearchHost(host) && (pathname.includes('/aclk') || pathname.includes('/pagead'))) {
    return 'Google Ads'
  }
  if (isGoogleSearchHost(host)) return 'Google Organic'
  if (isOtherSearchHost(host)) return 'Other'
  if (isSocialHost(host)) return 'Organic Social'
  return 'Referral'
}

function fallbackChannel(source) {
  if (isUnknown(source) || isCapture(source)) {
    return isCapture(source) && text(source) ? 'Other' : 'Direct'
  }
  return 'Other'
}

/**
 * @param {object|string|null|undefined} input Lead row, or a raw source string.
 * @returns {string} One of LEAD_SOURCES.
 */
export function normalizeSource(input) {
  if (input != null && typeof input === 'object') return normalizeLead(input)

  const raw = text(input)
  if (isExactCanonical(raw)) return raw
  return aliasChannel(raw) || fallbackChannel(raw)
}

function normalizeLead(lead) {
  const raw = text(lead.source)
  if (isExactCanonical(raw)) return raw

  if (text(lead.gclid)) return 'Google Ads'
  if (text(lead.fbclid)) return 'Meta Ads'

  const fromUtm = classifyUtm(lead.utm_source, lead.utm_medium)
  if (fromUtm) return fromUtm

  const fromLabel = aliasChannel(raw) || aliasChannel(lead.lead_source)
  if (fromLabel) return fromLabel

  const fromReferrer = classifyReferrer(lead.referrer_url)
  if (fromReferrer) return fromReferrer

  if (isUnknown(raw) || isCapture(raw)) return fallbackChannel(raw)
  return 'Other'
}
