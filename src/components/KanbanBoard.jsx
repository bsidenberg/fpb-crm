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

function buildItems(leads) {
  const items = {}
  for (const stage of STAGES) {
    items[stage.id] = leads.filter(l => l.stage === stage.id)
  }
  return items
}

function findContainer(items, id) {
  if (id in items) return id
  return Object.keys(items).find(key => items[key].some(item => item.id === id))
}

export default function KanbanBoard({ leads, onLeadsChange, onAddLead }) {
  const toast = useToast()
  const [items, setItems] = useState(() => buildItems(leads))
  const [activeId, setActiveId] = useState(null)

  // Always-current ref so async handlers never read stale closure state
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Sync when leads prop changes (e.g. after search/filter or refetch)
  useEffect(() => { setItems(buildItems(leads)) }, [leads])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback(({ active }) => {
    setActiveId(active.id)
  }, [])

  const handleDragOver = useCallback(({ active, over }) => {
    if (!over) return
    const activeContainer = findContainer(itemsRef.current, active.id)
    const overContainer = findContainer(itemsRef.current, over.id) ?? over.id

    if (!activeContainer || !overContainer || activeContainer === overContainer) return

    setItems(prev => {
      const activeItems = prev[activeContainer]
      const overItems = prev[overContainer]
      const activeIndex = activeItems.findIndex(i => i.id === active.id)
      const overIndex = overItems.findIndex(i => i.id === over.id)

      const insertAt = overIndex >= 0 ? overIndex : overItems.length

      return {
        ...prev,
        [activeContainer]: activeItems.filter(i => i.id !== active.id),
        [overContainer]: [
          ...overItems.slice(0, insertAt),
          { ...activeItems[activeIndex], stage: overContainer },
          ...overItems.slice(insertAt),
        ],
      }
    })
  }, [])

  const handleDragEnd = useCallback(async ({ active, over }) => {
    setActiveId(null)
    if (!over) return

    // Read from ref — always reflects state after handleDragOver mutations
    const activeContainer = findContainer(itemsRef.current, active.id)
    const overContainer = findContainer(itemsRef.current, over.id) ?? over.id

    if (!activeContainer || !overContainer) return

    if (activeContainer === overContainer) {
      // Reorder within same column
      setItems(prev => {
        const col = prev[activeContainer]
        const oldIdx = col.findIndex(i => i.id === active.id)
        const newIdx = col.findIndex(i => i.id === over.id)
        if (oldIdx === newIdx) return prev
        return { ...prev, [activeContainer]: arrayMove(col, oldIdx, newIdx) }
      })
    } else {
      // Optimistic update already applied by handleDragOver — now persist
      const { error } = await supabase
        .from('leads')
        .update({ stage: overContainer })
        .eq('id', active.id)

      if (error) {
        toast('Failed to move lead', 'error')
        // Revert to last known good state from server
        setItems(buildItems(leads))
      } else {
        const stageName = STAGES.find(s => s.id === overContainer)?.label
        toast(`Moved to ${stageName}`, 'success')
        onLeadsChange?.()
      }
    }
  }, [leads, onLeadsChange, toast])

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
        padding: '0 20px 20px',
        overflowX: 'auto',
        flex: 1,
        alignItems: 'flex-start',
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
