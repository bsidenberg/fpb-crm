export const STAGES = [
  { id: 'new',        label: 'New Lead',    color: '#C0392B', bg: 'rgba(192,57,43,0.12)'   },
  { id: 'contacted',  label: 'Contacted',   color: '#D4872A', bg: 'rgba(212,135,42,0.12)'  },
  { id: 'quote_sent', label: 'Quote Sent',  color: '#7C3AED', bg: 'rgba(124,58,237,0.12)'  },
  { id: 'follow_up',  label: 'Follow-Up',   color: '#D97706', bg: 'rgba(217,119,6,0.12)'   },
  { id: 'won',        label: 'Closed Won',  color: '#27AE60', bg: 'rgba(39,174,96,0.12)'   },
  { id: 'lost',       label: 'Closed Lost', color: '#6B6360', bg: 'rgba(107,99,96,0.12)'   },
]

export const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))

// textColor: what to render badge text in; bgColor: solid badge fill
export const TEMPERATURE = [
  { id: 'cold', label: 'Cold', color: '#4A4340', textColor: '#A8A09A', bgColor: 'rgba(74,67,64,0.5)'  },
  { id: 'warm', label: 'Warm', color: '#D4872A', textColor: '#1C1917', bgColor: '#D4872A'               },
  { id: 'hot',  label: 'Hot',  color: '#C0392B', textColor: '#F5F0ED', bgColor: '#C0392B'               },
]

export const LEAD_SOURCES = [
  'Website', 'Google Ads', 'Facebook', 'Referral',
  'Cold Call', 'Trade Show', 'Walk-In', 'Other',
]

export const BARN_SIZES = [
  '20x30', '24x30', '24x40', '30x40',
  '30x50', '40x60', '40x80', '50x100', 'Custom',
]

export const TAGS = [
  'Residential', 'Commercial', 'Agricultural',
  'Horse Barn', 'Storage', 'Workshop', 'Financing',
]

export const ACTIVITY_TYPES = [
  { id: 'note',      label: 'Note',     color: '#6B6360' },
  { id: 'call',      label: 'Call Log', color: '#27AE60' },
  { id: 'email',     label: 'Email',    color: '#D4872A' },
  { id: 'follow_up', label: 'Task',     color: '#C0392B' },
]
