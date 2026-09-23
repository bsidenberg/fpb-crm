import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSource, LEAD_SOURCES } from './leadSource.js'

test('canonical list has one label per channel and no capture methods', () => {
  assert.deepEqual(LEAD_SOURCES, [
    'Google Ads',
    'Organic Search',
    'Meta Ads',
    'Organic Social',
    'Referral',
    'Direct',
    'AI Search',
    'Email',
    'Cold Call',
    'Other',
  ])
  for (const blocked of ['Website Form', 'Website Chat', 'Website', 'Google Organic', 'Facebook']) {
    assert.equal(LEAD_SOURCES.includes(blocked), false)
  }
})

test('keeps an already canonical source, including a manual pick', () => {
  assert.equal(normalizeSource({ source: 'Referral', gclid: 'abc' }), 'Referral')
  assert.equal(normalizeSource({ source: 'Organic Search', gclid: 'abc' }), 'Organic Search')
  assert.equal(normalizeSource({ source: 'Cold Call' }), 'Cold Call')
  assert.equal(normalizeSource({ source: 'Direct', referrer_url: 'https://google.com' }), 'Direct')
})

test('maps historical aliases', () => {
  assert.equal(normalizeSource({ source: 'Google Organic' }), 'Organic Search')
  assert.equal(normalizeSource({ source: 'organic' }), 'Organic Search')
  assert.equal(normalizeSource({ source: 'Facebook' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'fb' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'IG' }), 'Meta Ads')
  assert.equal(normalizeSource('Facebook'), 'Meta Ads')
})

test('reclassifies capture methods and unknowns from signals', () => {
  assert.equal(normalizeSource({ source: 'Website Form', gclid: 'abc' }), 'Google Ads')
  assert.equal(normalizeSource({ source: 'Website Chat', fbclid: 'x' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'Unknown', gclid: 'abc' }), 'Google Ads')
  assert.equal(normalizeSource({
    source: 'Website Form',
    utm_source: 'google',
    utm_medium: 'cpc',
  }), 'Google Ads')
  assert.equal(normalizeSource({
    source: 'Website',
    utm_source: 'google',
    utm_medium: 'paid',
  }), 'Google Ads')
  assert.equal(normalizeSource({ source: 'Website Chat', utm_source: 'facebook' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'Website Form', utm_source: 'instagram' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'Website Form', utm_source: 'fb', utm_medium: 'social' }), 'Meta Ads')
  assert.equal(normalizeSource({ source: 'Website Form', utm_medium: 'social' }), 'Organic Social')
  assert.equal(normalizeSource({ source: 'Website Form', utm_medium: 'email' }), 'Email')
  assert.equal(normalizeSource({ source: 'Google Organic', gclid: 'abc' }), 'Google Ads')
})

test('uses referrer only after labels and utm fail', () => {
  assert.equal(normalizeSource({
    source: 'Unknown',
    referrer_url: 'https://www.google.com/search?q=pole+barn',
  }), 'Organic Search')
  assert.equal(normalizeSource({
    source: 'Website Form',
    referrer_url: 'https://www.facebook.com/floridapolebarn',
  }), 'Organic Social')
  assert.equal(normalizeSource({
    source: 'Website Form',
    referrer_url: 'https://partner.example.com/out',
  }), 'Referral')
  assert.equal(normalizeSource({
    source: 'Website Chat',
    referrer_url: 'https://chatgpt.com/',
  }), 'AI Search')
  assert.equal(normalizeSource({
    source: 'Website Form',
    referrer_url: 'https://gemini.google.com/app',
  }), 'AI Search')
  assert.equal(normalizeSource({
    source: 'Website Form',
    referrer_url: 'https://www.googleadservices.com/pagead',
  }), 'Google Ads')
  assert.equal(normalizeSource({
    source: 'Website Form',
    referrer_url: 'https://floridapolebarn.com/quote',
  }), 'Other')
  assert.equal(normalizeSource({
    source: 'Facebook',
    referrer_url: 'https://www.facebook.com/',
  }), 'Meta Ads')
})

test('blank or unknown with no signals is Direct; capture method with no signals is Other', () => {
  assert.equal(normalizeSource({ source: '' }), 'Direct')
  assert.equal(normalizeSource({ source: null }), 'Direct')
  assert.equal(normalizeSource({ source: 'Unknown' }), 'Direct')
  assert.equal(normalizeSource(''), 'Direct')
  assert.equal(normalizeSource({ source: 'Website Form' }), 'Other')
  assert.equal(normalizeSource({ source: 'Website Chat' }), 'Other')
  assert.equal(normalizeSource({ source: 'Website' }), 'Other')
  assert.equal(normalizeSource({ source: 'not a real channel' }), 'Other')
})

test('lead_source fills in when source is a capture method', () => {
  assert.equal(normalizeSource({
    source: 'Website Form',
    lead_source: 'Google Organic',
  }), 'Organic Search')
})
