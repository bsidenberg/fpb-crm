import { useState, useEffect, useRef, useCallback } from 'react'
import {
  DndContext, DragOverlay,
  PointerSensor, KeyboardSensor,
  useSensor, useSensors,
  closestCorners,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { STAGES } from '../lib/stages'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'

// Each column is sorted by stage_changed_at ASC (oldest at top).
// For leads with null stage_changed_at, created_at is used as fallback.
// To backfill existing leads in Supabase:
//   UPDATE leads SET stage_changed_at = created_at WHERE stage_changed_at IS NULL;
function columnSortKey(lead) {
  return new Date(lead.stage_changed_at || lead.created_at || 0).getTime()
}

function buildItems(leads) {
  const items = {}
  for (const stage of STAGES) {
    items[stage.id] = leads
      .filter(l => l.stage === stage.id)
      .sort((a, b) => columnSortKey(a) - columnSortKey(b))
  }
  return items
}

function findContainer(items, id) {
  if (id in items) return id
  return Object.keys(items).find(key => items[key].some(item => item.id === id))
}

export default function KanbanBoard({ leads, onLeadsChange, onAddLead, onDragStateChange, filterRadius }) {
  const toast = useToast()
  const [items, setItems] = useState(() => buildItems(leads))
  const [activeId, setActiveId] = useState(null)

  // itemsRef holds the latest items synchronously — updated in handlers, not just on render.
  // This ensures handleDragEnd always reads post-drag-over state.
  const itemsRef = useRef(items)

  // originalContainerRef captures where the card lived when the drag started,
  // before handleDragOver mutates itemsRef.
  const originalContainerRef = useRef(null)

  // Sync when leads prop changes (filter change or refetch)
  useEffect(() => {
    const next = buildItems(leads)
    itemsRef.current = next
    setItems(next)
  }, [leads])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback(({ active }) => {
    setActiveId(active.id)
    originalContainerRef.current = findContainer(itemsRef.current, active.id)
    console.log('[Drag] start —', active.id, '| column:', originalContainerRef.current)
    onDragStateChange?.(true)
  }, [onDragStateChange])

  const handleDragEnd = useCallback(async ({ active, over }) => {
    setActiveId(null)
    onDragStateChange?.(false)

    if (!over) {
      console.log('[Drag] no drop target — cancelled')
      return
    }

    // Cards use useDraggable (not useSortable), so over.id is always a column stage ID
    const leadId      = active.id
    const targetStage = over.id
    const sourceStage = originalContainerRef.current

    console.log('[Drag] dropped on:', targetStage)

    if (!sourceStage || !targetStage || sourceStage === targetStage) return
    if (!(targetStage in itemsRef.current)) return // not a valid column

    const movedLead = itemsRef.current[sourceStage]?.find(l => l.id === leadId)
    if (!movedLead) return

    // Optimistic update — move card to target column and re-sort
    const now     = new Date().toISOString()
    const updates = { stage: targetStage, stage_changed_at: now }
    if (targetStage === 'quote_sent') updates.quote_sent_at = now

    const updatedLead = { ...movedLead, ...updates }
    const newItems = {
      ...itemsRef.current,
      [sourceStage]: itemsRef.current[sourceStage].filter(l => l.id !== leadId),
      [targetStage]: [...itemsRef.current[targetStage], updatedLead]
        .sort((a, b) => columnSortKey(a) - columnSortKey(b)),
    }
    itemsRef.current = newItems
    setItems(newItems)

    console.log('[Drag] leadId:', leadId, typeof leadId)
    console.log('[Drag] updating stage to:', targetStage)

    // Step 1: update stage only — always safe regardless of schema state
    const { error } = await supabase
      .from('leads')
      .update({ stage: targetStage })
      .eq('id', leadId)

    if (error) {
      console.error('[Drag] stage save FAILED:', JSON.stringify(error, null, 2))
      toast(`Failed to move lead: ${error.message}`, 'error')
      const reverted = buildItems(leads)
      itemsRef.current = reverted
      setItems(reverted)
      return
    }

    console.log('[Drag] stage saved successfully', leadId, '→', targetStage)

    // Step 2: try stage_changed_at separately — silently skipped if column missing
    const { error: tsError } = await supabase
      .from('leads')
      .update({ stage_changed_at: now })
      .eq('id', leadId)

    if (tsError) {
      console.warn('[Drag] stage_changed_at update skipped (column may not exist):', tsError.message)
    }

    const stageName = STAGES.find(s => s.id === targetStage)?.label
    toast(`Moved to ${stageName}`, 'success')
    onLeadsChange?.()
  }, [leads, onLeadsChange, toast, onDragStateChange])

  const activeCard = activeId
    ? Object.values(items).flat().find(l => l.id === activeId)
    : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={{
        display: 'flex',
        gap: 12,
        padding: '16px 20px 20px',
        overflowX: 'auto',
        flex: 1,
        alignItems: 'stretch',
        minHeight: 0,
      }}>
        {STAGES.map(stage => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            leads={items[stage.id] || []}
            onAddLead={onAddLead}
            filterRadius={filterRadius}
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? <LeadCard lead={activeCard} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
