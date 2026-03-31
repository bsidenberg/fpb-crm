import { useState, useEffect, useRef, useCallback } from 'react'
import {
  DndContext, DragOverlay,
  PointerSensor, KeyboardSensor,
  useSensor, useSensors,
  closestCorners,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { STAGES } from '../lib/stages'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import KanbanColumn from './KanbanColumn'
import LeadCard from './LeadCard'

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

export default function KanbanBoard({ leads, onLeadsChange, onAddLead, onDragStateChange }) {
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
    // Record where this card lives NOW, before any drag-over mutations
    originalContainerRef.current = findContainer(itemsRef.current, active.id)
    console.log('[Drag] start — card:', active.id, '| column:', originalContainerRef.current)
    onDragStateChange?.(true)
  }, [onDragStateChange])

  const handleDragOver = useCallback(({ active, over }) => {
    if (!over) return
    const activeContainer = findContainer(itemsRef.current, active.id)
    const overContainer   = findContainer(itemsRef.current, over.id) ?? over.id

    if (!activeContainer || !overContainer || activeContainer === overContainer) return

    const activeItems = itemsRef.current[activeContainer]
    const overItems   = itemsRef.current[overContainer]
    const activeIndex = activeItems.findIndex(i => i.id === active.id)
    const overIndex   = overItems.findIndex(i => i.id === over.id)
    const insertAt    = overIndex >= 0 ? overIndex : overItems.length

    const newItems = {
      ...itemsRef.current,
      [activeContainer]: activeItems.filter(i => i.id !== active.id),
      [overContainer]: [
        ...overItems.slice(0, insertAt),
        { ...activeItems[activeIndex], stage: overContainer },
        ...overItems.slice(insertAt),
      ],
    }

    // Synchronously update the ref so handleDragEnd reads the correct post-over state
    itemsRef.current = newItems
    setItems(newItems)
  }, [])

  const handleDragEnd = useCallback(async ({ active, over }) => {
    setActiveId(null)
    if (!over) return

    const originalContainer = originalContainerRef.current
    // finalContainer = where the card actually landed after all drag-over moves
    const finalContainer = findContainer(itemsRef.current, active.id)

    console.log('[Drag] end — card:', active.id, '| from:', originalContainer, '→ to:', finalContainer)

    if (!originalContainer || !finalContainer) return

    if (originalContainer === finalContainer) {
      // Same column — reorder within column
      const col    = itemsRef.current[finalContainer]
      const oldIdx = col.findIndex(i => i.id === active.id)
      const newIdx = col.findIndex(i => i.id === over.id)
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return
      const newItems = { ...itemsRef.current, [finalContainer]: arrayMove(col, oldIdx, newIdx) }
      itemsRef.current = newItems
      setItems(newItems)
    } else {
      // Cross-column drop — persist stage change to Supabase
      console.log('[Drag] saving stage to Supabase:', active.id, '→', finalContainer)

      const updates = { stage: finalContainer }
      if (finalContainer === 'quote_sent') updates.quote_sent_at = new Date().toISOString()

      const { error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', active.id)

      if (error) {
        console.error('[Drag] stage save FAILED:', error.message, error)
        toast('Failed to move lead', 'error')
        // Revert to last server state
        const reverted = buildItems(leads)
        itemsRef.current = reverted
        setItems(reverted)
      } else {
        console.log('[Drag] stage saved ✓', active.id, '→', finalContainer)
        const stageName = STAGES.find(s => s.id === finalContainer)?.label
        toast(`Moved to ${stageName}`, 'success')
        onLeadsChange?.()
      }
    }
    onDragStateChange?.(false)
  }, [leads, onLeadsChange, toast, onDragStateChange])

  const activeCard = activeId
    ? Object.values(items).flat().find(l => l.id === activeId)
    : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
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
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? <LeadCard lead={activeCard} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
