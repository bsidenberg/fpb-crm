import { useState } from 'react'
import { supabase } from '../lib/supabase'

const EMPTY_NEW = { title: '', note: '', assignee: '', priority: 'normal', due_date: '' }

const fi = {
  padding: '6px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
}

const CHECK_SVG = (
  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
    <path d="M1 4.5l3 3 6-6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function positionBadgeStyle(item) {
  const done = !!item.completed_at
  if (done || item.priority === 'waiting') {
    return { background: 'var(--color-surface-2)', color: 'var(--color-text-3)', border: '1px solid var(--color-border-light)' }
  }
  if (item.priority === 'blocking') {
    return { background: '#C0272D', color: '#fff', border: 'none' }
  }
  return { background: 'var(--color-surface)', color: 'var(--color-text-2)', border: '1px solid var(--color-border)' }
}

function IconBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '2px 5px', borderRadius: 4,
        color: 'var(--color-text-3)', fontSize: 13, lineHeight: 1,
        transition: 'all 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; e.currentTarget.style.color = 'var(--color-text)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--color-text-3)' }}
    >
      {children}
    </button>
  )
}

export default function HitListTab({ projectId, items, onItemsChange }) {
  const [adding,  setAdding]  = useState(false)
  const [newItem, setNewItem] = useState(EMPTY_NEW)
  const [saving,  setSaving]  = useState(false)
  const [addErr,  setAddErr]  = useState(null)

  const sorted = [...items].sort((a, b) => a.position - b.position)
  const setN   = key => val => setNewItem(prev => ({ ...prev, [key]: val }))

  const addItem = async () => {
    if (!newItem.title.trim()) { setAddErr('Title is required'); return }
    setAddErr(null)
    setSaving(true)
    const maxPos = sorted.length > 0 ? Math.max(...sorted.map(i => i.position)) : 0
    const { error } = await supabase.from('project_hit_list').insert({
      project_id: projectId,
      title:      newItem.title.trim(),
      note:       newItem.note.trim()     || null,
      assignee:   newItem.assignee.trim() || null,
      priority:   newItem.priority,
      due_date:   newItem.due_date        || null,
      position:   maxPos + 1,
    })
    setSaving(false)
    if (error) { setAddErr(error.message); return }
    setAdding(false)
    setNewItem(EMPTY_NEW)
    onItemsChange()
  }

  const toggleComplete = async (item) => {
    const completed_at = item.completed_at ? null : new Date().toISOString()
    await supabase.from('project_hit_list').update({ completed_at }).eq('id', item.id)
    onItemsChange()
  }

  const moveUp = async (item) => {
    const idx = sorted.findIndex(i => i.id === item.id)
    if (idx <= 0) return
    const above = sorted[idx - 1]
    await Promise.all([
      supabase.from('project_hit_list').update({ position: above.position }).eq('id', item.id),
      supabase.from('project_hit_list').update({ position: item.position  }).eq('id', above.id),
    ])
    onItemsChange()
  }

  const moveDown = async (item) => {
    const idx = sorted.findIndex(i => i.id === item.id)
    if (idx >= sorted.length - 1) return
    const below = sorted[idx + 1]
    await Promise.all([
      supabase.from('project_hit_list').update({ position: below.position }).eq('id', item.id),
      supabase.from('project_hit_list').update({ position: item.position  }).eq('id', below.id),
    ])
    onItemsChange()
  }

  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.title}"?`)) return
    await supabase.from('project_hit_list').delete().eq('id', item.id)
    onItemsChange()
  }

  const PRIORITIES = [
    { id: 'blocking', label: 'Blocking', color: '#C0272D', activeBg: 'rgba(192,39,45,0.08)' },
    { id: 'normal',   label: 'Normal',   color: '#2B3A6B', activeBg: 'rgba(43,58,107,0.08)' },
    { id: 'waiting',  label: 'Waiting',  color: '#6B7280', activeBg: 'rgba(107,114,128,0.08)' },
  ]

  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--color-text-3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12,
      }}>
        Next actions, top to bottom
      </div>

      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        marginBottom: 12,
      }}>
        {sorted.length === 0 && !adding && (
          <div style={{ padding: '20px 16px', color: 'var(--color-text-3)', fontSize: 13 }}>
            No hit list items yet. Add the first action below.
          </div>
        )}

        {sorted.map((item, idx) => {
          const done       = !!item.completed_at
          const badgeStyle = positionBadgeStyle(item)
          return (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px',
                borderBottom: (idx < sorted.length - 1 || adding)
                  ? '1px solid var(--color-border-light)' : 'none',
                background: done ? 'var(--color-surface-2)' : 'transparent',
              }}
            >
              {/* Position badge */}
              <div style={{
                width: 22, height: 22, borderRadius: 5, flexShrink: 0, marginTop: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, ...badgeStyle,
              }}>
                {idx + 1}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, lineHeight: 1.4,
                  color: done ? 'var(--color-text-3)' : 'var(--color-text)',
                  textDecoration: done ? 'line-through' : 'none',
                }}>
                  {item.title}
                  {item.priority === 'blocking' && !done && (
                    <span style={{
                      marginLeft: 7, fontSize: 9, fontWeight: 800, color: '#C0272D',
                      letterSpacing: '0.5px', textDecoration: 'none', verticalAlign: 'middle',
                    }}>
                      BLOCKING
                    </span>
                  )}
                </div>
                {item.note && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 3, lineHeight: 1.4 }}>
                    {item.note}
                  </div>
                )}
                {(item.assignee || item.due_date) && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginTop: 4, display: 'flex', gap: 12 }}>
                    {item.assignee && <span>👤 {item.assignee}</span>}
                    {item.due_date  && <span>📅 {item.due_date}</span>}
                  </div>
                )}
              </div>

              {/* Row actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, marginTop: 1 }}>
                <IconBtn onClick={() => moveUp(item)}   title="Move up">↑</IconBtn>
                <IconBtn onClick={() => moveDown(item)} title="Move down">↓</IconBtn>
                {/* Complete toggle */}
                <button
                  onClick={() => toggleComplete(item)}
                  title={done ? 'Mark incomplete' : 'Mark complete'}
                  style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: done ? 'none' : '2px solid var(--color-border)',
                    background: done ? 'var(--color-green)' : 'transparent',
                    cursor: 'pointer', padding: 0, marginLeft: 3,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  {done && CHECK_SVG}
                </button>
                <IconBtn onClick={() => deleteItem(item)} title="Delete">×</IconBtn>
              </div>
            </div>
          )
        })}

        {/* Inline add form */}
        {adding && (
          <div style={{
            padding: '14px 14px',
            background: 'var(--color-surface-2)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text"
                placeholder="Action title (required)"
                value={newItem.title}
                onChange={e => setN('title')(e.target.value)}
                autoFocus
                style={{ ...fi, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={newItem.note}
                onChange={e => setN('note')(e.target.value)}
                style={{ ...fi, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Assignee (optional)"
                  value={newItem.assignee}
                  onChange={e => setN('assignee')(e.target.value)}
                  style={fi}
                  onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                />
                <input
                  type="date"
                  value={newItem.due_date}
                  onChange={e => setN('due_date')(e.target.value)}
                  style={fi}
                  onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                />
              </div>
              {/* Priority segmented */}
              <div style={{
                display: 'flex', borderRadius: 6, overflow: 'hidden',
                border: '1px solid var(--color-border)', width: 'fit-content',
              }}>
                {PRIORITIES.map((p, i) => {
                  const active = newItem.priority === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setN('priority')(p.id)}
                      style={{
                        padding: '5px 14px', fontSize: 12, fontWeight: 600,
                        border: 'none',
                        borderRight: i < PRIORITIES.length - 1 ? '1px solid var(--color-border)' : 'none',
                        background: active ? p.activeBg : 'var(--input-bg)',
                        color: active ? p.color : 'var(--color-text-3)',
                        cursor: 'pointer', transition: 'all 0.1s',
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              {addErr && (
                <div style={{ fontSize: 12, color: '#C0272D', fontWeight: 500 }}>{addErr}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={addItem}
                  disabled={saving}
                  style={{
                    padding: '6px 16px', borderRadius: 6,
                    background: saving ? 'var(--color-border)' : 'var(--color-accent)',
                    border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Adding…' : 'Add item'}
                </button>
                <button
                  onClick={() => { setAdding(false); setNewItem(EMPTY_NEW); setAddErr(null) }}
                  style={{
                    padding: '6px 14px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-2)', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add button — hidden when form is open */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 6,
            background: 'transparent', border: '1px dashed var(--color-border)',
            color: 'var(--color-text-3)', fontSize: 13, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-3)' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add hit list item
        </button>
      )}
    </div>
  )
}
