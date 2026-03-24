import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { TEMPERATURE } from '../lib/stages'
import { getFollowUpStatus } from '../lib/followup'

const TEMP_MAP = Object.fromEntries(TEMPERATURE.map(t => [t.id, t]))

function formatValue(v) {
  if (!v) return null
  return '$' + Number(v).toLocaleString()
}

function FollowUpBadge({ date, status }) {
  if (!date || !status) return null
  try {
    const label = formatDistanceToNow(parseISO(date), { addSuffix: true })
    const color = status === 'overdue' ? '#EF4444' : status === 'today' ? '#D4872A' : 'var(--color-text-3)'
    return (
      <div style={{
        fontSize: 10, color,
        display: 'flex', alignItems: 'center', gap: 3, marginTop: 7,
        fontWeight: status === 'overdue' || status === 'today' ? 600 : 400,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
        {label}
      </div>
    )
  } catch {
    return null
  }
}

export default function LeadCard({ lead, overlay = false }) {
  const navigate = useNavigate()
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: lead.id })

  const temp = TEMP_MAP[lead.priority] || TEMP_MAP.warm
  const tags = Array.isArray(lead.tags) ? lead.tags : []
  const followStatus = getFollowUpStatus(lead.follow_up_date)
  const isOverdue = followStatus === 'overdue'
  const isDueToday = followStatus === 'today'

  const borderColor = isOverdue ? '#C0392B' : temp.color
  const baseBoxShadow = isOverdue
    ? '0 0 0 1px rgba(192,57,43,0.25), -2px 0 8px rgba(192,57,43,0.2)'
    : 'none'

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        onClick={() => !isDragging && navigate(`/leads/${lead.id}`)}
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 7,
          padding: '10px 11px 10px 10px',
          marginBottom: 6,
          cursor: 'grab',
          transition: 'box-shadow 0.15s, background 0.15s',
          animation: overlay ? 'none' : 'fadeIn 0.15s ease',
          boxShadow: overlay ? '0 10px 30px rgba(0,0,0,0.6)' : baseBoxShadow,
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = isOverdue
            ? '0 2px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(192,57,43,0.35)'
            : '0 2px 12px rgba(0,0,0,0.4)'
          e.currentTarget.style.background = 'var(--color-border)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = baseBoxShadow
          e.currentTarget.style.background = 'var(--color-surface-2)'
        }}
      >
        {/* Name + priority badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.3, minWidth: 0 }}>
            {lead.first_name} {lead.last_name}
          </div>
          <div style={{
            fontSize: 9, fontWeight: 700,
            color: temp.textColor,
            background: temp.bgColor,
            padding: '2px 6px',
            borderRadius: 3,
            flexShrink: 0,
            letterSpacing: '0.7px',
            textTransform: 'uppercase',
          }}>
            {temp.label}
          </div>
        </div>

        {/* Follow-up status badge */}
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

        {/* Company / city */}
        {(lead.company || lead.city) && (
          <div style={{ fontSize: 11, color: 'var(--color-text-2)', marginTop: 2, lineHeight: 1.3 }}>
            {[lead.company, lead.city].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Barn size + source pills */}
        {(lead.barn_size || lead.source) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {lead.barn_size && (
              <span style={{
                fontSize: 10, color: 'var(--color-text-3)',
                background: 'rgba(107,99,96,0.2)',
                padding: '1px 6px', borderRadius: 3, fontWeight: 500,
              }}>
                {lead.barn_size}
              </span>
            )}
            {lead.source && (
              <span style={{
                fontSize: 10, color: 'var(--color-text-3)',
                background: 'rgba(107,99,96,0.2)',
                padding: '1px 6px', borderRadius: 3, fontWeight: 500,
              }}>
                {lead.source}
              </span>
            )}
          </div>
        )}

        {/* Notes preview */}
        {lead.notes && (
          <div style={{
            fontSize: 11,
            color: 'var(--color-text-3)',
            marginTop: 7,
            lineHeight: 1.5,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            fontStyle: 'italic',
            borderLeft: '2px solid var(--color-border)',
            paddingLeft: 7,
          }}>
            {lead.notes}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
            {tags.map(tag => (
              <span key={tag} style={{
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-accent)',
                background: 'var(--color-accent-light)',
                border: '1px solid rgba(192,57,43,0.3)',
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

        {/* Value */}
        {lead.value && (
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-green)',
            marginTop: 7, letterSpacing: '-0.3px',
          }}>
            {formatValue(lead.value)}
          </div>
        )}

        <FollowUpBadge date={lead.follow_up_date} status={followStatus} />
      </div>
    </div>
  )
}
