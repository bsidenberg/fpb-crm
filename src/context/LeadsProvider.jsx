import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllLeads } from '../lib/fetchAllLeads'
import { calculateScore } from '../utils/scoreLeads'
import { patchLead, applyLeadChanges, createChangeBatcher } from '../lib/leadsState'

const LeadsContext = createContext(null)

export function useLeads() {
  const ctx = useContext(LeadsContext)
  if (!ctx) throw new Error('useLeads must be used within LeadsProvider')
  return ctx
}

export function LeadsProvider({ children }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Tracks current lead count outside the render cycle so triggerFetch can
  // decide loading vs. refreshing without capturing a stale closure value.
  const leadsRef = useRef([])
  useEffect(() => { leadsRef.current = leads }, [leads])

  // ── Drag-gate refs ────────────────────────────────────────────────────────
  // isDraggingRef: set true while a card drag is in progress so we don't
  // apply realtime changes mid-drag. Changes stay queued and flush on drop.
  const isDraggingRef = useRef(false)
  const pollingRef    = useRef(null)
  const batcherRef    = useRef(null)

  // Optimistic local patch of one lead. Callers that save a lead (board drag,
  // detail page) call this so the board reflects the change immediately
  // without depending on the realtime echo.
  const updateLead = useCallback((id, changes) => {
    setLeads(prev => patchLead(prev, id, changes))
  }, [])

  const fetchLeads = useCallback(async () => {
    // Fetch leads and activity counts in parallel. Leads are paged so the
    // board is not capped at PostgREST's default 1000-row response.
    let leadRows
    let actResult
    try {
      const fetched = await Promise.all([
        fetchAllLeads(supabase, {
          modify: (query) => query.order('created_at', { ascending: false }),
        }),
        supabase.from('activities').select('lead_id'),
      ])
      leadRows = fetched[0]
      actResult = fetched[1]
    } catch {
      setLoading(false)
      setRefreshing(false)
      return
    }

    // Count activities per lead
    const actCounts = {}
    for (const a of (actResult.data || [])) {
      actCounts[a.lead_id] = (actCounts[a.lead_id] || 0) + 1
    }

    // Calculate fresh scores and collect leads where score changed
    const updates = []
    const leadsWithScores = leadRows.map(lead => {
      const { score } = calculateScore(lead, actCounts[lead.id] || 0)
      if (score !== (lead.score ?? 0)) updates.push({ id: lead.id, score })
      return { ...lead, score }
    })

    setLeads(leadsWithScores)
    setLoading(false)
    setRefreshing(false)

    // Fire-and-forget: save changed scores back to Supabase
    if (updates.length > 0) {
      Promise.all(
        updates.map(({ id, score }) =>
          supabase.from('leads').update({ score }).eq('id', id)
        )
      ).catch(() => {})
    }
  }, [])

  // Stale-while-revalidate wrapper: show the refreshing indicator when data
  // is already populated (background revalidation), not on initial load.
  const triggerFetch = useCallback(async () => {
    if (leadsRef.current.length > 0) setRefreshing(true)
    await fetchLeads()
  }, [fetchLeads])

  // Fetch once on provider mount (runs for the app's lifetime, not per-Board-mount)
  useEffect(() => { triggerFetch() }, [triggerFetch])

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Mounted here so it survives navigation — never torn down and re-established
  // on Board mount/unmount.
  //
  // NOTE: Enable replication for the `leads` table in the Supabase Dashboard:
  // Database → Replication → supabase_realtime → toggle ON for "leads"
  useEffect(() => {
    // Realtime payloads are batched (never dropped) and applied in one setLeads.
    const batcher = createChangeBatcher({
      delay: 100,
      isPaused: () => isDraggingRef.current,
      onFlush: (batch) => setLeads(prev =>
        applyLeadChanges(prev, batch, row => calculateScore(row, 0).score)
      ),
    })
    batcherRef.current = batcher

    const channel = supabase
      .channel('board-leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        batcher.push(payload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Realtime healthy — stop polling fallback if running
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !pollingRef.current) {
          // Realtime unavailable — fall back to polling every 30s
          pollingRef.current = setInterval(() => triggerFetch(), 30_000)
        }
      })

    return () => {
      batcher.cancel()
      batcherRef.current = null
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      supabase.removeChannel(channel)
    }
  }, [triggerFetch])

  const handleDragStateChange = useCallback((dragging) => {
    isDraggingRef.current = dragging
    if (!dragging) batcherRef.current?.flush()
  }, [])

  return (
    <LeadsContext.Provider value={{ leads, loading, refreshing, fetchLeads: triggerFetch, updateLead, handleDragStateChange }}>
      {children}
    </LeadsContext.Provider>
  )
}
