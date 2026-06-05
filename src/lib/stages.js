export const STAGES = [
  { id: 'new',                  label: 'New Lead',                         color: '#C0272D', bg: '#FEF2F2' },
  { id: 'contacted_no_comm',    label: 'Contacted - No Communication Yet', color: '#D97706', bg: '#FEF3C7' },
  { id: 'contacted_waiting',    label: 'Contacted - Waiting on Them',      color: '#F59E0B', bg: '#FFFBEB' },
  { id: 'need_to_quote',        label: 'Need to Quote',                    color: '#0891B2', bg: '#ECFEFF' },
  { id: 'estimate_sent',        label: 'Estimate Sent',                    color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'revision_negotiation', label: 'Revision / Negotiation',           color: '#EA580C', bg: '#FFF7ED' },
  { id: 'won',                  label: 'Closed Won',                       color: '#16A34A', bg: '#DCFCE7' },
  { id: 'lost',                 label: 'Closed Lost',                      color: '#6B7280', bg: '#F3F4F6' },
]

export const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))

// textColor: badge text; bgColor: solid badge fill; color: border/dot accent
export const TEMPERATURE = [
  { id: 'cold', label: 'Cold', color: '#6B7280', textColor: '#374151', bgColor: '#F3F4F6'  },
  { id: 'warm', label: 'Warm', color: '#D97706', textColor: '#92400E', bgColor: '#FEF3C7'  },
  { id: 'hot',  label: 'Hot',  color: '#C0272D', textColor: '#FFFFFF', bgColor: '#C0272D'  },
]

export const LEAD_SOURCES = [
  'Google Organic', 'Google Ads', 'Facebook', 'Referral',
  'Cold Call', 'Direct', 'AI Search', 'Website', 'Other',
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
  { id: 'note',      label: 'Note',     color: '#6B7280' },
  { id: 'call',      label: 'Call Log', color: '#16A34A' },
  { id: 'email',     label: 'Email',    color: '#D97706' },
  { id: 'follow_up', label: 'Task',     color: '#C0272D' },
]
