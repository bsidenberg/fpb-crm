import { supabase } from '../lib/supabase'

const STATUSES = [
  { id: 'pending',        label: 'Pending',  activeBg: '#2B3A6B',            activeColor: '#fff' },
  { id: 'complete',       label: 'Complete', activeBg: 'var(--color-green)',  activeColor: '#fff' },
  { id: 'not_applicable', label: 'N/A',      activeBg: '#6b7280',            activeColor: '#fff' },
]

function labelStyle(status) {
  if (status === 'complete')       return { fontSize: 13, flex: 1, color: '#6b7280', textDecoration: 'line-through' }
  if (status === 'not_applicable') return { fontSize: 13, flex: 1, color: '#9ca3af', textDecoration: 'line-through', fontStyle: 'italic' }
  return { fontSize: 13, flex: 1, color: 'var(--color-text)' }
}

export default function ChecklistTab({ items, onItemsChange }) {
  const sorted = [...items]
    .filter(i => i.category === 'checklist')
    .sort((a, b) => a.position - b.position)

  // Build child map: parent_id → [children]
  const childMap = {}
  for (const item of sorted) {
    if (item.parent_id) {
      if (!childMap[item.parent_id]) childMap[item.parent_id] = []
      childMap[item.parent_id].push(item)
    }
  }

  // Flat render order: each top-level item followed immediately by its children
  const renderOrder = []
  for (const item of sorted.filter(i => !i.parent_id)) {
    renderOrder.push({ item, depth: 0 })
    for (const child of (childMap[item.id] || [])) {
      renderOrder.push({ item: child, depth: 1 })
    }
  }

  const updateStatus = async (item, newStatus) => {
    const cur = item.status || 'pending'
    if (cur === newStatus) return
    const updates = {
      status:       newStatus,
      completed_at: newStatus === 'complete' ? new Date().toISOString() : null,
    }
    // For date-type items transitioning to complete with no value yet, default to today
    if (item.field_type === 'date' && newStatus === 'complete' && !item.value) {
      updates.value = new Date().toISOString().split('T')[0]
    }
    await supabase.from('project_checklist_items').update(updates).eq('id', item.id)
    onItemsChange()
  }

  const saveDate = async (item, dateVal) => {
    const value = dateVal || null
    if (value === (item.value ?? null)) return
    await supabase.from('project_checklist_items').update({ value }).eq('id', item.id)
    onItemsChange()
  }

  if (renderOrder.length === 0) {
    return <div style={{ color: 'var(--color-text-3)', fontSize: 13 }}>No checklist items found.</div>
  }

  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--color-text-3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12,
      }}>
        Project checklist
      </div>

      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {renderOrder.map(({ item, depth }, idx) => {
          const status = item.status || 'pending'
          const isLast = idx === renderOrder.length - 1

          return (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: `10px 16px 10px ${16 + depth * 24}px`,
                borderBottom: isLast ? 'none' : '1px solid var(--color-border-light)',
                background: depth > 0 ? 'var(--color-surface-2)' : 'transparent',
              }}
            >
              {/* Label */}
              <span style={labelStyle(status)}>{item.label}</span>

              {/* Right side */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

                {/* Date input — visible only for date-type items when complete */}
                {item.field_type === 'date' && status === 'complete' && (
                  <input
                    key={`${item.id}-${item.value ?? ''}`}
                    type="date"
                    defaultValue={item.value || ''}
                    style={{
                      padding: '3px 7px', fontSize: 12,
                      background: 'var(--input-bg)', border: '1px solid var(--color-border)',
                      borderRadius: 5, color: 'var(--color-text)', outline: 'none',
                      transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                    onBlur={e => {
                      e.target.style.borderColor = 'var(--color-border)'
                      saveDate(item, e.target.value)
                    }}
                  />
                )}

                {/* Three-state segmented control */}
                <div style={{
                  display: 'inline-flex',
                  border: '0.5px solid #e5e7eb',
                  borderRadius: 6, overflow: 'hidden',
                }}>
                  {STATUSES.map((s, i) => {
                    const active = status === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => updateStatus(item, s.id)}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
