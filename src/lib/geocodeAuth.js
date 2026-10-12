/**
 * Headers for the geocode edge function.
 * The publishable key stays in `apikey` (the gateway requires it) but must
 * not be the Authorization bearer. Only a signed-in user's access token is
 * accepted by the function.
 * Returns null when either value is missing so callers fail closed.
 */
export function geocodeRequestHeaders({ accessToken, anonKey }) {
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null
  if (typeof anonKey !== 'string' || anonKey.length === 0) return null
  if (accessToken === anonKey) return null
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  }
}
