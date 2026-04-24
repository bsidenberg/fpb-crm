// Map of email → display name for CRM users
export const USER_NAMES = {
  'brian@floridapolebarn.com': 'Brian Sidenberg',
  'jeff@floridapolebarn.com': 'Jeff Hicks',
}

export function getDisplayName(email) {
  return USER_NAMES[email] || email || 'Unknown'
}
