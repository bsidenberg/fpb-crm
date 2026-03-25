import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import LeadCard from './LeadCard'

function formatValue(v) {
  if (!v) return null
  return '$' + Number(v).toLocaleString()
}

export default function KanbanColumn({ stage, leads, onAddLead }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  const totalValue = leads.reduce((sum, l) => sum + (Number(l.value) || 0), 0)

  return (
    <div style={{
      width: 248,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'border-color 0.15s, box-shadow 0.15s',
      borderColor: isOver ? stage.color : 'var(--border)',
      boxShadow: isOver
        ? `0 0 0 2px ${stage.color}40, 0 4px 12px rgba(0,0,0,0.08)`
        : '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
    }}>
      {/* Column header */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--border)',
        background: isOver ? stage.bg : 'transparent',
        transition: 'background 0.15s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: stage.color, flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--color-text-2)',
              textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>
              {stage.label}
            </span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: stage.color,
            background: stage.bg,
            padding: '1px 7px',
            borderRadius: 10,
          }}>
            {leads.length}
          </span>
        </div>
        {totalValue > 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-green)', marginTop: 4, fontWeight: 600 }}>
            {formatValue(totalValue)}
          </div>
        )}
      </div>

      {/* Cards area */}
      <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          style={{
            flex: 1,
            padding: '8px 8px 4px',
            minHeight: 120,
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 220px)',
          }}
        >
          {leads.map(lead => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
          {leads.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '20px 8px',
              fontSize: 12,
              color: 'var(--text-muted)',
              borderRadius: 6,
              border: `2px dashed ${isOver ? stage.color : 'var(--border)'}`,
              transition: 'border-color 0.15s',
            }}>
              Drop here
            </div>
          )}
        </div>
      </SortableContext>

      {/* Add lead button */}
      <button
        onClick={() => onAddLead(stage.id)}
        style={{
          margin: '6px 8px 8px',
          padding: '6px',
          background: 'transparent',
          border: '1px dashed var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = stage.color
          e.currentTarget.style.color = stage.color
          e.currentTarget.style.background = stage.bg
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = 'var(--text-muted)'
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add lead
      </button>
    </div>
  )
}
