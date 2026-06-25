import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { TEMPERATURE } from '../lib/stages'
import { getFollowUpStatus } from '../lib/followup'
import { getScoreGrade } from '../utils/scoreLeads'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

const TEMP_MAP = Object.fromEntries(TEMPERATURE.map(t => [t.id, t]))

const TEMP_ICONS = { hot: '🔥', warm: '~', cold: '❄' }

function formatValue(v) {
  if (!v) return null
  return '$' + Number(v).toLocaleString()
}

const pillStyle = {
  fontSize: 10,
  color: 'var(--color-text-3)',
  background: 'rgba(107,99,96,0.2)',
  padding: '1px 6px',
  borderRadius: 3,
  fontWeight: 500,
}

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
    <div
      ref={ref}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 7,
        boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
        overflow: 'hidden',
        minWidth: 110,
      }}
    >
      {TEMPERATURE.map(t => (
        <button
          key={t.id}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onSelect(t.id) }}
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

function ProbabilityBadge({ value }) {
  if (value == null) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 500,
        color: 'var(--color-text-3)',
        background: 'rgba(107,114,128,0.1)',
        padding: '2px 6px', borderRadius: 3,
      }}>—%</span>
    )
  }
  const color = value >= 67 ? '#16A34A' : value >= 34 ? '#D97706' : '#6B7280'
  const bg    = value >= 67 ? '#DCFCE7'  : value >= 34 ? '#FEF3C7'  : '#F3F4F6'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700,
      color, background: bg,
      padding: '2px 6px', borderRadius: 3,
    }}>
      {value}%
    </span>
  )
}

function LeadCard({ lead, overlay = false }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })

  const [localPriority, setLocalPriority] = useState(lead.priority || 'warm')
  const [tempOpen, setTempOpen] = useState(false)

  useEffect(() => {
    setLocalPriority(lead.priority || 'warm')
  }, [lead.priority])

  const temp = TEMP_MAP[localPriority] || TEMP_MAP.warm
  const tags = Array.isArray(lead.tags) ? lead.tags : []
  const followStatus = getFollowUpStatus(lead.follow_up_date)
  const isOverdue = followStatus === 'overdue'
  const isDueToday = followStatus === 'today'

  const borderColor = isOverdue ? '#C0392B' : temp.color
  const baseBoxShadow = isOverdue
    ? '0 0 0 1px rgba(192,39,45,0.2), 0 2px 8px rgba(192,39,45,0.1)'
    : '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)'

  const isOutOfRadius = lead._distance != null && lead._inRadius === false
  const style = {
    opacity: isDragging ? 0 : (isOutOfRadius ? 0.35 : 1),
    pointerEvents: isOutOfRadius ? 'none' : undefined,
  }

  const handleTempSelect = useCallback(async (newPriority) => {
    setTempOpen(false)
    const prev = localPriority
    setLocalPriority(newPriority)
    const { error } = await supabase
      .from('leads')
      .update({ priority: newPriority })
      .eq('id', lead.id)
    if (error) {
      setLocalPriority(prev)
      toast('Failed to update temperature', 'error')
    } else {
      toast('Temperature updated')
    }
  }, [lead.id, localPriority, toast])

  // Format last_contact_date safely
  let lastContactDisplay = '—'
  if (lead.last_contact_date) {
    try { lastContactDisplay = format(parseISO(lead.last_contact_date), 'MMM d') } catch { /* keep — */ }
  }

  // Format follow_up_date for the "—" fallback row
  let followUpDisplay = null
  if (lead.follow_up_date) {
    try { followUpDisplay = formatDistanceToNow(parseISO(lead.follow_up_date), { addSuffix: true }) } catch { /* skip */ }
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        onClick={() => !isDragging && navigate(`/leads/${lead.id}`)}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 7,
          padding: '10px 11px 10px 10px',
          marginBottom: 6,
          cursor: 'grab',
          transition: 'box-shadow 0.15s, background 0.15s',
          animation: overlay ? 'none' : 'fadeIn 0.15s ease',
          boxShadow: overlay ? '0 8px 24px rgba(0,0,0,0.18)' : baseBoxShadow,
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = isOverdue
            ? '0 4px 12px rgba(0,0,0,0.1), 0 0 0 1px rgba(192,39,45,0.3)'
            : '0 4px 12px rgba(0,0,0,0.1)'
          e.currentTarget.style.background = '#F9FAFB'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = baseBoxShadow
          e.currentTarget.style.background = 'var(--color-surface)'
        }}
      >
        {/* Row 1: Name + score badge + temp badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.3, minWidth: 0 }}>
            {lead.first_name} {lead.last_name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {lead.score != null && (() => {
              const g = getScoreGrade(lead.score)
              return (
                <span title={`Score: ${lead.score} — ${g.label}`} style={{
                  fontSize: 9, fontWeight: 800,
                  color: g.color, background: g.bg,
                  padding: '2px 5px', borderRadius: 3,
                  letterSpacing: '0.3px',
                  border: `1px solid ${g.color}30`,
                }}>
                  {g.grade}
                </span>
              )
            })()}
            {/* Temperature badge — clickable */}
            <div
              style={{ position: 'relative' }}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setTempOpen(o => !o) }}
            >
              <div
                title="Click to change temperature"
                style={{
                  fontSize: 9, fontWeight: 700,
                  color: temp.textColor,
                  background: temp.bgColor,
                  padding: '2px 6px',
                  borderRadius: 3,
                  letterSpacing: '0.7px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 3,
                  border: tempOpen ? `1px solid ${temp.color}` : '1px solid transparent',
                  transition: 'border-color 0.1s',
                }}
              >
                <span style={{ fontSize: 10 }}>{TEMP_ICONS[localPriority]}</span>
                {temp.label}
              </div>
              {tempOpen && (
                <TempPopover
                  current={localPriority}
                  onSelect={handleTempSelect}
                  onClose={() => setTempOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Overdue / due-today alert */}
        {(isOverdue || isDueToday) && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            marginTop: 5,
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.5px', textTransform: 'uppercase',
            color: isOverdue ? '#EF4444' : '#D4872A',
            background: isOverdue ? 'rgba(239,68,68,0.1)' : 'rgba(212,135,42,0.12)',
            border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.3)' : 'rgba(212,135,42,0.35)'}`,
            padding: '2px 6px', borderRadius: 3,
          }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            {isOverdue ? 'Overdue' : 'Due Today'}
          </div>
        )}

        {/* Row 3: City (always shown) + optional company + distance */}
        <div style={{ fontSize: 11, color: 'var(--color-text-2)', marginTop: 4, lineHeight: 1.3 }}>
          {[lead.company, lead.city || '—'].filter(Boolean).join(' · ')}
          {lead._distance != null && (
            <span style={{ color: 'var(--color-text-3)' }}>
              {' · '}{Math.round(lead._distance)}mi
            </span>
          )}
        </div>

        {/* Row 4: Structure size + Lead source pills (always shown) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          <span style={pillStyle}>{lead.barn_size || '—'}</span>
          <span style={pillStyle}>{lead.source || '—'}</span>
        </div>

        {/* Row 5: Estimated value + Probability badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px',
            color: lead.value ? 'var(--color-green)' : 'var(--color-text-3)',
          }}>
            {lead.value ? formatValue(lead.value) : '—'}
          </div>
          <ProbabilityBadge value={lead.probability} />
        </div>

        {/* Row 6: Owner + Last contact date */}
        <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10, color: 'var(--color-text-3)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            {lead.owner || '—'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Last: {lastContactDisplay}
          </span>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
            {tags.map(tag => (
              <span key={tag} style={{
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-accent)',
                background: 'var(--color-accent-light)',
                border: '1px solid rgba(192,39,45,0.25)',
                padding: '1px 5px',
                borderRadius: 3,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Row 7: Next follow-up date */}
        {followUpDisplay ? (
          <div style={{
            fontSize: 10,
            color: isOverdue ? '#EF4444' : isDueToday ? '#D4872A' : 'var(--color-text-3)',
            display: 'flex', alignItems: 'center', gap: 3, marginTop: 7,
            fontWeight: isOverdue || isDueToday ? 600 : 400,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            {followUpDisplay}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--color-text-3)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 7 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            Follow-up: —
          </div>
        )}
      </div>
    </div>
  )
}

// Custom comparator: lead objects are re-spread on every pipeline run (sorted.map creates new
// references), so default shallow compare would always fail. Check each rendered field by value.
function areLeadCardPropsEqual(prev, next) {
  if (prev.overlay !== next.overlay) return false
  const a = prev.lead
  const b = next.lead
  return (
    a.id                === b.id                &&
    a.first_name        === b.first_name        &&
    a.last_name         === b.last_name         &&
    a.stage             === b.stage             &&
    a.priority          === b.priority          &&
    a.score             === b.score             &&
    a.value             === b.value             &&
    a.probability       === b.probability       &&
    a.owner             === b.owner             &&
    a.company           === b.company           &&
    a.city              === b.city              &&
    a.barn_size         === b.barn_size         &&
    a.source            === b.source            &&
    a.follow_up_date    === b.follow_up_date    &&
    a.last_contact_date === b.last_contact_date &&
    a._distance         === b._distance         &&
    a._inRadius         === b._inRadius         &&
    (a.tags === b.tags || (a.tags || []).join('\0') === (b.tags || []).join('\0'))
  )
}

export default memo(LeadCard, areLeadCardPropsEqual)
