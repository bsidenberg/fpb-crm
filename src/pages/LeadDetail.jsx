import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../hooks/useAuth'
import { STAGES, STAGE_MAP, LEAD_SOURCES, BARN_SIZES, TEMPERATURE, TAGS, ACTIVITY_TYPES } from '../lib/stages'
import { calculateScore, getScoreGrade } from '../utils/scoreLeads'
import NewProjectModal from '../components/NewProjectModal'
import { geocodeLead } from '../lib/geocode'
import { usePresence } from '../hooks/usePresence'
import PresenceBanner from '../components/PresenceBanner'

const TEMP_MAP   = Object.fromEntries(TEMPERATURE.map(t => [t.id, t]))
const TEMP_ICONS = { hot: '🔥', warm: '~', cold: '❄' }

function normalizeEmptyStrings(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    out[key] = (typeof value === 'string' && value.trim() === '') ? null : value
  }
  return out
}

// ─── Type colors (matches spec) ────────────────────────────────────────────
const TYPE_COLORS = {
  note:      { border: '#6B7280', badge: '#6B7280', bg: 'rgba(107,114,128,0.10)' },
  call:      { border: '#16A34A', badge: '#16A34A', bg: 'rgba(22,163,74,0.10)'  },
  email:     { border: '#2B3A6B', badge: '#2B3A6B', bg: 'rgba(43,58,107,0.10)'  },
  follow_up: { border: '#D97706', badge: '#D97706', bg: 'rgba(217,119,6,0.10)'  },
}

const inputStyle = {
  width: '100%', padding: '7px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
}

const divider = (
  <div style={{ height: 1, background: 'var(--color-border)', margin: '14px 0' }} />
)

const dash = <span style={{ color: 'var(--color-text-3)' }}>—</span>

// ─── TempPopover ────────────────────────────────────────────────────────────
function TempPopover({ current, onSelect, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 7,
      boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
      overflow: 'hidden',
      minWidth: 110,
    }}>
      {TEMPERATURE.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            width: '100%', padding: '8px 12px',
            background: current === t.id ? t.bgColor : 'transparent',
            border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: current === t.id ? 700 : 400,
            color: current === t.id ? t.textColor : 'var(--color-text)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (current !== t.id) e.currentTarget.style.background = 'var(--color-surface-2)' }}
          onMouseLeave={e => { if (current !== t.id) e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontSize: 13 }}>{TEMP_ICONS[t.id]}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── ActivityIcon ────────────────────────────────────────────────────────────
function ActivityIcon({ type, size = 13 }) {
  const aType = ACTIVITY_TYPES.find(t => t.id === type) || ACTIVITY_TYPES[0]
  const s = { width: size, height: size, style: { flexShrink: 0 } }
  const c = TYPE_COLORS[type] || TYPE_COLORS.note
  const stroke = c.badge
  if (type === 'call') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.07-8.67A2 2 0 015.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L9.91 9.91a16 16 0 005.18 5.18l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
  if (type === 'email') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
  if (type === 'follow_up') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
  return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

// ─── DenseRow (compact 2-col info grid) ──────────────────────────────────────
function DenseRow({ label, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '80px 1fr',
      gap: 6, marginBottom: 5, alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-3)', paddingTop: 1, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.4, wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}

// ─── Compact left-panel info ──────────────────────────────────────────────────
function CompactInfo({ lead, scoreData, onStageChange, tempOpen, setTempOpen, onTempSelect }) {
  const stage = STAGE_MAP[lead.stage]
  const temp  = TEMP_MAP[lead.priority] || TEMP_MAP.warm
  const tags  = Array.isArray(lead.tags) ? lead.tags : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Name */}
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: 12 }}>
        {lead.first_name} {lead.last_name}
      </div>

      {/* Stage + temp + score row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
        {/* Stage dropdown */}
        <select
          value={lead.stage || ''}
          onChange={e => onStageChange(e.target.value)}
          style={{
            padding: '3px 8px',
            background: stage?.bg || 'var(--color-surface-2)',
            border: `1px solid ${stage?.color || 'var(--color-border)'}`,
            borderRadius: 5,
            color: stage?.color || 'var(--color-text)',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', outline: 'none',
          }}
        >
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        {/* Temperature badge — clickable */}
        <div style={{ position: 'relative' }}>
          <div
            title="Click to change temperature"
            onClick={() => setTempOpen(o => !o)}
            style={{
              fontSize: 10, fontWeight: 700,
              color: temp.textColor, background: temp.bgColor,
              padding: '3px 8px', borderRadius: 5,
              letterSpacing: '0.5px', textTransform: 'uppercase',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 3,
              border: tempOpen ? `1px solid ${temp.color}` : '1px solid transparent',
              transition: 'border-color 0.1s',
            }}
          >
            <span style={{ fontSize: 11 }}>{TEMP_ICONS[lead.priority] || TEMP_ICONS.warm}</span>
            {temp.label}
          </div>
          {tempOpen && (
            <TempPopover
              current={lead.priority || 'warm'}
              onSelect={onTempSelect}
              onClose={() => setTempOpen(false)}
            />
          )}
        </div>

        {/* Score grade */}
        {scoreData && (() => {
          const g = getScoreGrade(scoreData.score)
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 7px', borderRadius: 5,
              background: g.bg, border: `1px solid ${g.color}30`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: g.color }}>{g.grade}</span>
              <span style={{ fontSize: 10, color: g.color, fontWeight: 600 }}>{scoreData.score}</span>
            </div>
          )
        })()}
      </div>

      {divider}

      {/* Contact info */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
        Contact
      </div>
      <DenseRow label="Email">
        {lead.email
          ? <a href={`mailto:${lead.email}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >{lead.email}</a>
          : dash}
      </DenseRow>
      <DenseRow label="Phone">
        {lead.phone
          ? <a href={`tel:${lead.phone}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >{lead.phone}</a>
          : dash}
      </DenseRow>
      <DenseRow label="Company">{lead.company || dash}</DenseRow>
      <DenseRow label="City / ZIP">
        {(lead.city || lead.zip) ? [lead.city, lead.zip].filter(Boolean).join(', ') : dash}
      </DenseRow>
      <DenseRow label="Address">{lead.address || dash}</DenseRow>

      {divider}

      {/* Deal info */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
        Deal
      </div>
      <DenseRow label="Est. Value">
        {lead.value
          ? <span style={{ color: 'var(--color-green)', fontWeight: 700 }}>${Number(lead.value).toLocaleString()}</span>
          : dash}
      </DenseRow>
      <DenseRow label="Barn Size">{lead.barn_size || dash}</DenseRow>
      <DenseRow label="Service Type">{lead.service_type || dash}</DenseRow>
      <DenseRow label="Building Type">{lead.building_type || dash}</DenseRow>
      <DenseRow label="Timeline">{lead.timeline || dash}</DenseRow>
      <DenseRow label="Budget Range">{lead.budget_range || dash}</DenseRow>
      <DenseRow label="Land Owned">
        {lead.land_owned === true ? 'Yes' : lead.land_owned === false ? 'No' : dash}
      </DenseRow>
      <DenseRow label="HOA">
        {lead.hoa === true ? 'Yes' : lead.hoa === false ? 'No' : dash}
      </DenseRow>
      <DenseRow label="Source">{lead.source || dash}</DenseRow>
      <DenseRow label="Follow-Up">
        {lead.follow_up_date ? format(parseISO(lead.follow_up_date), 'MMM d, yyyy') : dash}
      </DenseRow>
      <DenseRow label="Created">
        {lead.created_at ? format(parseISO(lead.created_at), 'MMM d, yyyy') : dash}
      </DenseRow>

      {divider}

      {/* Tags */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
        Tags
      </div>
      {tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 600,
              color: 'var(--color-accent)',
              background: 'var(--color-accent-light)',
              border: '1px solid rgba(192,39,45,0.22)',
              padding: '2px 8px', borderRadius: 12,
            }}>
              {tag}
            </span>
          ))}
        </div>
      ) : <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>No tags</span>}

      {divider}

      {/* Compact score bar */}
      {scoreData && (() => {
        const g = getScoreGrade(scoreData.score)
        return (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              Lead Score
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, height: 5, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${scoreData.score}%`,
                  background: g.color, borderRadius: 3,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, color: g.color,
                background: g.bg, padding: '1px 6px', borderRadius: 3,
                letterSpacing: '0.3px',
              }}>
                {g.grade} · {scoreData.score}/100
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-3)', fontWeight: 500 }}>{g.label}</div>
          </>
        )
      })()}

      {/* Notes */}
      {lead.notes && (
        <>
          {divider}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            Notes
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {lead.notes}
          </div>
        </>
      )}
    </div>
  )
}

// ─── ActivityEntry ────────────────────────────────────────────────────────────
function ActivityEntry({ activity: a, onUpdate, onDelete }) {
  const toast = useToast()
  const aType  = ACTIVITY_TYPES.find(t => t.id === a.type) || ACTIVITY_TYPES[0]
  const colors = TYPE_COLORS[a.type] || TYPE_COLORS.note
  const isTemp = String(a.id).startsWith('tmp_')

  const [hovered,    setHovered]    = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [editBody,   setEditBody]   = useState(a.body   || '')
  const [editAuthor, setEditAuthor] = useState(a.author || '')
  const [saving,     setSaving]     = useState(false)

  const handleSave = async () => {
    if (!editBody.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('activities')
      .update({ body: editBody.trim(), author: editAuthor.trim() || null })
      .eq('id', a.id)
    setSaving(false)
    if (error) { toast('Failed to update entry', 'error'); return }
    onUpdate({ ...a, body: editBody.trim(), author: editAuthor.trim() || a.author })
    setEditing(false)
  }

  const handleCancelEdit = () => {
    setEditBody(a.body || '')
    setEditAuthor(a.author || '')
    setEditing(false)
  }

  const handleDelete = async () => {
    const { error } = await supabase.from('activities').delete().eq('id', a.id)
    if (error) { toast('Failed to delete entry', 'error'); return }
    onDelete(a.id)
  }

  const iconBtn = (onClick, title, path) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '3px 5px', borderRadius: 4,
        color: 'var(--color-text-3)', display: 'flex', alignItems: 'center',
        transition: 'color 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        {path}
      </svg>
    </button>
  )

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderLeft: `3px solid ${colors.border}`,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeftWidth: 3,
        borderRadius: '0 8px 8px 0',
        padding: '12px 14px',
        marginBottom: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editing ? 10 : 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <ActivityIcon type={a.type} size={14} />
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: colors.badge,
            background: colors.bg,
            padding: '2px 7px', borderRadius: 4,
          }}>
            {aType.label}
          </span>
          {!editing && a.author && (
            <span style={{ fontSize: 12, color: 'var(--color-text-2)', fontWeight: 600 }}>
              {a.author}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {a.created_at && !editing && (
            <span style={{ fontSize: 10, color: 'var(--color-text-3)' }}>
              {format(parseISO(a.created_at), "MMM d · h:mm a")}
            </span>
          )}
          {hovered && !editing && !confirming && !isTemp && (
            <div style={{ display: 'flex', gap: 1 }}>
              {iconBtn(
                () => { setEditing(true); setConfirming(false) },
                'Edit',
                <>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </>
              )}
              {iconBtn(
                () => { setConfirming(true); setEditing(false) },
                'Delete',
                <>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-2)', flex: 1 }}>Delete this entry?</span>
          <button
            onClick={handleDelete}
            style={{ padding: '3px 12px', fontSize: 11, fontWeight: 700, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Yes
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{ padding: '3px 12px', fontSize: 11, fontWeight: 600, background: 'transparent', color: 'var(--color-text-2)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            No
          </button>
        </div>
      )}

      {/* Edit mode */}
      {editing ? (
        <>
          <textarea
            value={editBody}
            onChange={e => setEditBody(e.target.value)}
            rows={3}
            autoFocus
            style={{
              width: '100%', padding: '8px 10px', boxSizing: 'border-box',
              background: 'var(--input-bg)', border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
              outline: 'none', resize: 'vertical', lineHeight: 1.5, marginBottom: 8,
            }}
            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-3)', flexShrink: 0 }}>Author</span>
            <input
              type="text"
              value={editAuthor}
              onChange={e => setEditAuthor(e.target.value)}
              style={{ flex: 1, padding: '5px 8px', background: 'var(--input-bg)', border: '1px solid var(--color-border)', borderRadius: 5, color: 'var(--color-text)', fontSize: 12, outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={saving || !editBody.trim()}
              style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, background: editBody.trim() ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', border: 'none', borderRadius: 5, cursor: editBody.trim() ? 'pointer' : 'not-allowed' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleCancelEdit}
              style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, background: 'transparent', color: 'var(--color-text-2)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {a.body}
        </div>
      )}
    </div>
  )
}

// ─── EditForm ─────────────────────────────────────────────────────────────────
function EditForm({ form, set }) {
  const fi  = { ...inputStyle, marginBottom: 0 }
  const lbl = {
    display: 'block', fontSize: 10, fontWeight: 500,
    color: 'var(--color-text-2)', marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }
  const col   = { display: 'flex', flexDirection: 'column', gap: 4 }

  const inp = (key, type = 'text', placeholder) => (
    <input
      type={type}
      value={form[key] || ''}
      onChange={e => set(key)(e.target.value)}
      placeholder={placeholder}
      style={fi}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    />
  )

  const sel = (key, options, placeholder) => (
    <select
      value={form[key] || ''}
      onChange={e => set(key)(e.target.value)}
      style={{ ...fi, appearance: 'none', cursor: 'pointer' }}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  )

  return (
    <div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>First Name</label>{inp('first_name', 'text', 'John')}</div>
        <div style={col}><label style={lbl}>Last Name</label>{inp('last_name', 'text', 'Smith')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Email</label>{inp('email', 'email')}</div>
        <div style={col}><label style={lbl}>Phone</label>{inp('phone', 'tel')}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}><label style={lbl}>Company</label>{inp('company')}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}><label style={lbl}>Address</label>{inp('address')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>City</label>{inp('city')}</div>
        <div style={col}><label style={lbl}>Zip</label>{inp('zip')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Lead Source</label>{sel('source', LEAD_SOURCES, 'Select source')}</div>
        <div style={col}><label style={lbl}>Stage</label>{sel('stage', STAGES.map(s => ({ value: s.id, label: s.label })), 'Select stage')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Est. Value ($)</label>{inp('value', 'number')}</div>
        <div style={col}><label style={lbl}>Barn Size</label>{sel('barn_size', BARN_SIZES, 'Select size')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Service Type</label>{sel('service_type', ['Kit Delivery Only', 'Kit + Installation'], 'Select type')}</div>
        <div style={col}><label style={lbl}>Timeline</label>{sel('timeline', ['As Soon As Possible', '1-3 Months', '3-6 Months', '6-12 Months', 'Just Looking'], 'Select timeline')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Building Type</label>{sel('building_type', ['Open Pole Barn', 'Enclosed Pole Barn', 'Not Sure Yet'], 'Select type')}</div>
        <div style={col} />
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Budget Range</label>{inp('budget_range', 'text', '$15,000 - $25,000')}</div>
        <div style={col}>
          <label style={lbl}>Land Owned</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ val: true, label: 'Yes' }, { val: false, label: 'No' }].map(o => (
              <button
                key={String(o.val)}
                type="button"
                onClick={() => set('land_owned')(o.val)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${form.land_owned === o.val ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: form.land_owned === o.val ? 'var(--color-accent)' : 'var(--input-bg)',
                  color: form.land_owned === o.val ? '#fff' : 'var(--color-text-2)',
                  transition: 'all 0.15s',
                }}
              >{o.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={grid2}>
        <div style={col}>
          <label style={lbl}>HOA</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ val: true, label: 'Yes' }, { val: false, label: 'No' }].map(o => (
              <button
                key={String(o.val)}
                type="button"
                onClick={() => set('hoa')(o.val)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${form.hoa === o.val ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: form.hoa === o.val ? 'var(--color-accent)' : 'var(--input-bg)',
                  color: form.hoa === o.val ? '#fff' : 'var(--color-text-2)',
                  transition: 'all 0.15s',
                }}
              >{o.label}</button>
            ))}
          </div>
        </div>
        <div style={col} />
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Follow-Up Date</label>{inp('follow_up_date', 'date')}</div>
        <div style={col}>
          <label style={lbl}>Priority</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {TEMPERATURE.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => set('priority')(t.id)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${form.priority === t.id ? t.color : 'var(--color-border)'}`,
                  background: form.priority === t.id ? t.bgColor : 'var(--input-bg)',
                  color: form.priority === t.id ? t.textColor : 'var(--color-text-2)',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}>
          <label style={lbl}>Tags</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
            {TAGS.map(tag => {
              const currentTags = Array.isArray(form.tags) ? form.tags : []
              const active = currentTags.includes(tag)
              return (
                <button
                  key={tag} type="button"
                  onClick={() => set('tags')(
                    active ? currentTags.filter(t => t !== tag) : [...currentTags, tag]
                  )}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11,
                    fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-accent-light)' : 'var(--input-bg)',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-2)',
                    transition: 'all 0.15s',
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}>
          <label style={lbl}>Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={e => set('notes')(e.target.value)}
            rows={4}
            style={{ ...fi, resize: 'vertical', lineHeight: 1.5 }}
            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Main LeadDetail ──────────────────────────────────────────────────────────
export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { displayName, email: userEmail } = useAuth()
  const { otherViewers } = usePresence({
    channelKey: id ? `lead:${id}` : null,
    userEmail,
    userDisplayName: displayName,
  })

  const [lead,            setLead]            = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [editing,         setEditing]         = useState(false)
  const [form,            setForm]            = useState({})
  const [saving,          setSaving]          = useState(false)
  const [note,            setNote]            = useState('')
  const [noteType,        setNoteType]        = useState('note')
  const [noteAuthor,      setNoteAuthor]      = useState('')
  const [activities,      setActivities]      = useState([])
  const [addingNote,      setAddingNote]      = useState(false)
  const [scoreData,       setScoreData]       = useState(null)
  const [tempOpen,        setTempOpen]        = useState(false)
  const [convertModalOpen, setConvertModalOpen] = useState(false)

  // Pre-fill author from logged-in user (only if field hasn't been manually edited)
  useEffect(() => {
    if (displayName) setNoteAuthor(displayName)
  }, [displayName])

  useEffect(() => {
    fetchLead()
    fetchActivities()
  }, [id])

  // Realtime: lead
  useEffect(() => {
    const channel = supabase
      .channel(`lead-detail-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `id=eq.${id}` }, (payload) => {
        setLead(payload.new)
        setForm(payload.new)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  // Realtime: activities
  useEffect(() => {
    let debounceTimer = null
    const channel = supabase
      .channel(`activities-realtime-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `lead_id=eq.${id}` }, (payload) => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          if (payload.eventType === 'INSERT') {
            setActivities(prev => {
              if (prev.some(a => a.id === payload.new.id)) return prev
              const withoutOptimistic = prev.filter(a => !String(a.id).startsWith('tmp_'))
              return [payload.new, ...withoutOptimistic.filter(a => a.id !== payload.new.id)]
            })
          }
          if (payload.eventType === 'UPDATE') {
            setActivities(prev => prev.map(a => a.id === payload.new.id ? payload.new : a))
          }
          if (payload.eventType === 'DELETE') {
            setActivities(prev => prev.filter(a => a.id !== payload.old.id))
          }
        }, 100)
      })
      .subscribe()
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel) }
  }, [id])

  useEffect(() => {
    if (lead) setScoreData(calculateScore(lead, activities.length))
  }, [lead, activities])

  const fetchLead = async () => {
    const { data, error } = await supabase.from('leads').select('*').eq('id', id).single()
    if (error || !data) { navigate('/'); return }
    setLead(data)
    setForm(data)
    setLoading(false)
  }

  const fetchActivities = async () => {
    const { data } = await supabase
      .from('activities')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
    setActivities(data || [])
  }

  const set = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    // Coerce numeric fields; strip read-only DB columns from the update payload
    const { id: _id, created_at, updated_at, score, user_email, ...editable } = form
    const payload = normalizeEmptyStrings({
      ...editable,
      value: form.value !== '' && form.value != null ? Number(form.value) || null : null,
    })
    const addrChanged = (form.address !== lead.address) || (form.city !== lead.city) || (form.zip !== lead.zip)
    const { error } = await supabase.from('leads').update(payload).eq('id', id)
    setSaving(false)
    if (error) { toast('Save failed: ' + error.message, 'error'); return }
    toast('Lead updated')
    setLead(prev => ({ ...prev, ...payload }))
    setEditing(false)
    // Fire-and-forget re-geocode if address fields changed
    if (addrChanged && (form.address || form.city || form.zip)) {
      geocodeLead({ address: form.address, city: form.city, zip: form.zip })
        .then(result => {
          if (result) {
            supabase.from('leads').update({
              latitude:    result.latitude,
              longitude:   result.longitude,
              geocoded_at: new Date().toISOString(),
            }).eq('id', id).then(() => { /* silent */ })
          }
        })
        .catch(err => console.warn('[geocode] background re-geocode failed:', err))
    }
  }

  const handleStageChange = async (newStage) => {
    const prevStage = lead.stage
    const now = new Date().toISOString()
    setLead(l => ({ ...l, stage: newStage, stage_changed_at: now }))
    const updates = { stage: newStage, stage_changed_at: now }
    if (newStage === 'quote_sent') updates.quote_sent_at = now
    const { error } = await supabase.from('leads').update(updates).eq('id', id)
    if (error) {
      setLead(l => ({ ...l, stage: prevStage }))
      toast('Stage update failed', 'error')
    } else {
      toast(`Stage → ${STAGE_MAP[newStage]?.label}`)
    }
  }

  const handleTempSelect = useCallback(async (newPriority) => {
    setTempOpen(false)
    const prev = lead.priority
    setLead(l => ({ ...l, priority: newPriority }))
    const { error } = await supabase.from('leads').update({ priority: newPriority }).eq('id', id)
    if (error) {
      setLead(l => ({ ...l, priority: prev }))
      toast('Failed to update temperature', 'error')
    } else {
      toast('Temperature updated')
    }
  }, [lead?.priority, id, toast])

  const handleAddNote = async () => {
    if (!note.trim()) return
    setAddingNote(true)
    const author = noteAuthor.trim() || displayName || 'Brian'
    const body   = note.trim()

    const optimistic = {
      id: `tmp_${Date.now()}`,
      lead_id: String(id),
      type: noteType,
      body,
      author,
      created_at: new Date().toISOString(),
    }
    setActivities(prev => [optimistic, ...prev])
    setNote('')

    const { error } = await supabase.from('activities').insert([{ lead_id: String(id), type: noteType, body, author, user_email: userEmail || null }])
    if (error) console.error('Activity insert error:', JSON.stringify(error, null, 2))
    setAddingNote(false)
    if (error) {
      setActivities(prev => prev.filter(a => a.id !== optimistic.id))
      setNote(body)
      toast('Failed to save entry', 'error')
      return
    }
    toast('Entry logged')
    fetchActivities()
  }

  const handleUpdateActivity = (updated) => {
    setActivities(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  const handleDeleteActivity = (actId) => {
    setActivities(prev => prev.filter(a => a.id !== actId))
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${lead.first_name} ${lead.last_name}? This cannot be undone.`)) return
    await supabase.from('activities').delete().eq('lead_id', id)
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) { toast('Delete failed', 'error'); return }
    toast(`${lead.first_name} deleted`)
    navigate('/')
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-3)' }}>
        Loading…
      </div>
    )
  }

  const stage  = STAGE_MAP[lead.stage]
  const temp   = TEMP_MAP[lead.priority] || TEMP_MAP.warm
  const noteTypeDef = ACTIVITY_TYPES.find(t => t.id === noteType) || ACTIVITY_TYPES[0]
  const noteColors  = TYPE_COLORS[noteType] || TYPE_COLORS.note

  const placeholders = {
    note:      'Write a note about this lead…',
    call:      'What happened on the call?',
    email:     'Summarize the email sent or received…',
    follow_up: 'Describe the task or follow-up action…',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-3)', cursor: 'pointer', fontSize: 20, padding: '0 4px', lineHeight: 1 }}
          >
            ←
          </button>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.3px' }}>
            {lead.first_name} {lead.last_name}
          </div>
          {stage && (
            <div style={{
              fontSize: 10, fontWeight: 700,
              color: stage.color, background: stage.bg,
              padding: '3px 8px', borderRadius: 5, letterSpacing: '0.3px',
            }}>
              {stage.label}
            </div>
          )}
          {/* Temp badge in header */}
          <div style={{ position: 'relative' }}>
            <div
              title="Click to change temperature"
              onClick={() => setTempOpen(o => !o)}
              style={{
                fontSize: 9, fontWeight: 700,
                color: temp.textColor, background: temp.bgColor,
                padding: '2px 7px', borderRadius: 5,
                letterSpacing: '0.5px', textTransform: 'uppercase',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
                border: tempOpen ? `1px solid ${temp.color}` : '1px solid transparent',
                transition: 'border-color 0.1s',
              }}
            >
              <span style={{ fontSize: 10 }}>{TEMP_ICONS[lead.priority] || TEMP_ICONS.warm}</span>
              {temp.label}
            </div>
            {tempOpen && (
              <TempPopover
                current={lead.priority || 'warm'}
                onSelect={handleTempSelect}
                onClose={() => setTempOpen(false)}
              />
            )}
          </div>
          {/* Score in header */}
          {scoreData && (() => {
            const g = getScoreGrade(scoreData.score)
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 5,
                background: g.bg, border: `1px solid ${g.color}30`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: g.color }}>{g.grade}</span>
                <span style={{ fontSize: 10, color: g.color, fontWeight: 600 }}>{scoreData.score}</span>
              </div>
            )
          })()}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button
                onClick={() => { setEditing(false); setForm(lead) }}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-3)', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '7px 16px', borderRadius: 6, background: '#C0272D', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              {lead.stage === 'won' && (
                <button
                  onClick={() => setConvertModalOpen(true)}
                  style={{ padding: '7px 14px', borderRadius: 6, background: 'var(--red)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Convert to project
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'transparent', border: '1px solid #C0272D', color: '#C0272D', fontSize: 12, cursor: 'pointer' }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* LEFT — compact info (30%) */}
        <div style={{
          width: '30%',
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          overflowY: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <PresenceBanner viewers={otherViewers} />
          {editing ? (
            <>
              <EditForm form={form} set={set} />
              {/* Save/Cancel at bottom when in edit mode */}
              <div style={{ display: 'flex', gap: 8, paddingTop: 12 }}>
                <button
                  onClick={() => { setEditing(false); setForm(lead) }}
                  style={{ flex: 1, padding: '8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-3)', fontSize: 12, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ flex: 2, padding: '8px', borderRadius: 6, background: '#C0272D', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </>
          ) : (
            <>
              <CompactInfo
                lead={lead}
                scoreData={scoreData}
                onStageChange={handleStageChange}
                tempOpen={tempOpen}
                setTempOpen={setTempOpen}
                onTempSelect={handleTempSelect}
              />
              {divider}
              <button
                onClick={() => setEditing(true)}
                style={{
                  marginTop: 4,
                  padding: '9px 0',
                  width: '100%',
                  borderRadius: 6,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Edit Lead
              </button>
            </>
          )}
        </div>

        {/* Convert to project modal */}
        <NewProjectModal
          isOpen={convertModalOpen}
          onClose={() => setConvertModalOpen(false)}
          prefill={lead ? {
            name:           lead.barn_size ? `${lead.last_name} — ${lead.barn_size}` : lead.last_name,
            project_type:   null,
            customer_name:  `${lead.first_name} ${lead.last_name}`.trim(),
            customer_email: lead.email    || null,
            customer_phone: lead.phone    || null,
            site_address:   lead.address  || null,
            site_city:      lead.city     || null,
            site_county:    null,
            building_size:  lead.barn_size || null,
            contract_amount: lead.value   || null,
            notes:          `Converted from lead ${lead.id}`,
            lead_id:        lead.id,
          } : null}
          onCreated={newProject => {
            setConvertModalOpen(false)
            navigate(`/projects/${newProject.id}`)
          }}
        />

        {/* RIGHT — activity timeline (70%) */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          background: '#F3F4F6',
          padding: 24,
          minWidth: 0,
        }}>

          {/* ── Log Entry Card ─────────────────────────────────────────────── */}
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 8,
            padding: 20,
            marginBottom: 20,
            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          }}>
            {/* Type pill tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {ACTIVITY_TYPES.map(t => {
                const tc = TYPE_COLORS[t.id] || TYPE_COLORS.note
                const active = noteType === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setNoteType(t.id)}
                    style={{
                      padding: '5px 14px',
                      borderRadius: 20,
                      fontSize: 11, fontWeight: 700,
                      border: `1.5px solid ${active ? tc.badge : 'var(--color-border)'}`,
                      background: active ? tc.bg : 'transparent',
                      color: active ? tc.badge : 'var(--color-text-3)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      letterSpacing: '0.4px',
                      textTransform: 'uppercase',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <ActivityIcon type={t.id} size={11} />
                    {t.label}
                  </button>
                )
              })}
            </div>

            {/* Textarea */}
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={placeholders[noteType] || 'Write something…'}
              rows={6}
              style={{
                ...inputStyle,
                resize: 'vertical',
                lineHeight: 1.6,
                marginBottom: 12,
                fontSize: 13,
                borderLeft: `3px solid ${noteColors.border}`,
                borderRadius: '0 6px 6px 0',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = noteColors.border; e.target.style.borderLeftColor = noteColors.border }}
              onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.borderLeftColor = noteColors.border }}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAddNote()
              }}
            />

            {/* Author + Log Entry button row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-3)', flexShrink: 0 }}>By</span>
              <input
                type="text"
                value={noteAuthor}
                onChange={e => setNoteAuthor(e.target.value)}
                placeholder="Brian"
                style={{ ...inputStyle, width: 120, flexShrink: 0, padding: '7px 10px', fontSize: 12 }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
              <button
                onClick={handleAddNote}
                disabled={!note.trim() || addingNote}
                style={{
                  flex: 1,
                  padding: '8px 16px',
                  background: note.trim() ? '#C0272D' : '#E5E7EB',
                  border: 'none', borderRadius: 6,
                  color: note.trim() ? '#fff' : '#9CA3AF',
                  fontSize: 12, fontWeight: 700,
                  cursor: note.trim() ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                  letterSpacing: '0.3px',
                }}
                title="Cmd+Enter to submit"
              >
                {addingNote ? 'Saving…' : 'Log Entry'}
              </button>
            </div>
          </div>

          {/* ── Timeline ───────────────────────────────────────────────────── */}
          <div>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-2)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Activity Timeline
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-3)',
                padding: '1px 7px', borderRadius: 10,
              }}>
                {activities.length}
              </span>
            </div>

            {/* Empty state */}
            {activities.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: 'var(--color-surface)',
                borderRadius: 8,
                border: '1px dashed var(--color-border)',
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 4 }}>
                  No activity yet
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                  Log the first note above.
                </div>
              </div>
            ) : (
              activities.map(a => (
                <ActivityEntry
                  key={a.id}
                  activity={a}
                  onUpdate={handleUpdateActivity}
                  onDelete={handleDeleteActivity}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
