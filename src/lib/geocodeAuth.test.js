import test from 'node:test'
import assert from 'node:assert/strict'
import { geocodeRequestHeaders } from './geocodeAuth.js'

test('uses the user access token as the bearer and the publishable key as apikey', () => {
  const headers = geocodeRequestHeaders({
    accessToken: 'user-access-token',
    anonKey: 'sb_publishable_example',
  })
  assert.deepEqual(headers, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer user-access-token',
    apikey: 'sb_publishable_example',
  })
})

test('refuses to call geocode with the publishable key as the bearer', () => {
  assert.equal(
    geocodeRequestHeaders({ accessToken: 'sb_publishable_example', anonKey: 'sb_publishable_example' }),
    null,
  )
  assert.equal(geocodeRequestHeaders({ accessToken: '', anonKey: 'sb_publishable_example' }), null)
  assert.equal(geocodeRequestHeaders({ accessToken: 'user-access-token', anonKey: '' }), null)
  assert.equal(geocodeRequestHeaders({}), null)
})
