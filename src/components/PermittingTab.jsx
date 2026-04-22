import { supabase } from '../lib/supabase'

const STATUSES = [
  { id: 'pending',        label: 'Pending',  activeBg: '#2B3A6B',            activeColor: '#fff' },
  { id: 'complete',       label: 'Complete', activeBg: 'var(--color-green)',  activeColor: '#fff' },
  { id: 'not_applicable', label: 'N/A',      activeBg: '#6b7280',            activeColor: '#fff' },
]

const sectionLabel = (text) => (
  <div style={{
    fontSize: 11, fontWeight: 600, color: 'var(--color-text-3)',
    textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10,
  }}>
    {text}
  </div>
)

const cardWrap = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  marginBottom: 24,
}

const fi = {
  flex: 1, padding: '5px 8px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
}

export default function PermittingTab({ items, onItemsChange }) {
  const permitting = [...items]
    .filter(i => i.category === 'permitting')
    .sort((a, b) => a.position - b.position)

  const dataItems  = permitting.filter(i => i.field_type === 'data')
  const checkItems = permitting.filter(i => i.field_type === 'checkbox')

  const isDate = label => label.toLowerCase().includes('date')

  // Section A: save data field value on blur (unchanged)
  const saveValue = async (item, rawVal) => {
    const value = rawVal.trim() || null
    if (value === (item.value ?? null)) return
    const { error } = await supabase
      .from('project_checklist_items')
      .update({ value })
      .eq('id', item.id)
    if (!error) onItemsChange()
  }

  // Section B: three-state status update for inspection items
  const updateInspection = async (item, newStatus) => {
    const cur = item.status || 'pending'
    if (cur === newStatus) return
    const updates = {
      status:       newStatus,
      completed_at: newStatus === 'complete' ? new Date().toISOString() : null,
    }
    // Capture today's date on first completion; preserve value on de-complete
    if (newStatus === 'complete' && !item.value) {
      updates.value = new Date().toISOString().split('T')[0]
    }
    const { error } = await supabase
      .from('project_checklist_items')
      .update(updates)
      .eq('id', item.id)
    if (!error) onItemsChange()
  }

  return (
    <div>
      {/* Section A — permit details (data fields) — UNCHANGED */}
      {sectionLabel('Permit details')}
      <div style={cardWrap}>
        {dataItems.map((item, idx) => (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px',
              borderBottom: idx < dataItems.length - 1 ? '1px solid var(--color-border-light)' : 'none',
            }}
          >
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--color-text-3)',
              width: 160, flexShrink: 0,
            }}>
              {item.label}
            </div>
            <input
              key={`${item.id}-${item.value ?? ''}`}
              type={isDate(item.label) ? 'date' : 'text'}
              defaultValue={item.value || ''}
              style={fi}
              onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
              onBlur={e => {
                e.target.style.borderColor = 'var(--color-border)'
                saveValue(item, e.target.value)
              }}
            />
          </div>
        ))}
      </div>

      {/* Section B — inspections (three-state segmented control) */}
      {sectionLabel('Inspections')}
      <div style={cardWrap}>
        {checkItems.map((item, idx) => {
          const status = item.status || 'pending'
          return (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderBottom: idx < checkItems.length - 1 ? '1px solid var(--color-border-light)' : 'none',
              }}
            >
              {/* Label + captured date */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{
                  fontSize: 13,
                  color: status === 'pending' ? 'var(--color-text)' : '#6b7280',
                  textDecoration: status === 'not_applicable' ? 'line-through' : status === 'complete' ? 'line-through' : 'none',
                  fontStyle: status === 'not_applicable' ? 'italic' : 'normal',
                }}>
                  {item.label}
                </span>
                {item.value && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-3)', fontStyle: 'italic', flexShrink: 0 }}>
                    {item.value}
                  </span>
                )}
              </div>

              {/* Three-state segmented control */}
              <div style={{
                display: 'inline-flex',
                border: '0.5px solid #e5e7eb',
                borderRadius: 6, overflow: 'hidden', flexShrink: 0,
              }}>
                {STATUSES.map((s, i) => {
                  const active = status === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => updateInspection(item, s.id)}
                      style={{
                        width: 70, height: 28,
                        fontSize: 12, fontWeight: active ? 700 : 500,
                        border: 'none',
                        borderRight: i < STATUSES.length - 1 ? '0.5px solid #e5e7eb' : 'none',
                        background: active ? s.activeBg : 'transparent',
                        color: active ? s.activeColor : '#6b7280',
                        cursor: 'pointer',
                        transition: 'background 0.1s, color 0.1s',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f3f4f6' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
