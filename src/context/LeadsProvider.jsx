import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { calculateScore } from '../utils/scoreLeads'

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
  // apply realtime changes mid-drag. Changes are queued and flushed on drop.
  const isDraggingRef     = useRef(false)
  const pendingUpdatesRef = useRef([])
  const pollingRef        = useRef(null)

  const applyLeadChange = useCallback((payload) => {
    if (payload.eventType === 'INSERT') {
      const { score } = calculateScore(payload.new, 0)
      setLeads(prev => {
        if (prev.some(l => l.id === payload.new.id)) return prev // dedup
        return [...prev, { ...payload.new, score }]
      })
    }
    if (payload.eventType === 'UPDATE') {
      setLeads(prev => prev.map(l =>
        l.id === payload.new.id ? { ...payload.new, score: payload.new.score ?? l.score } : l
      ))
    }
    if (payload.eventType === 'DELETE') {
      setLeads(prev => prev.filter(l => l.id !== payload.old.id))
    }
  }, [])

  const fetchLeads = useCallback(async () => {
    // Fetch leads and activity counts in parallel
    const [leadsResult, actResult] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('activities').select('lead_id'),
    ])

    if (leadsResult.error || !leadsResult.data) { setLoading(false); setRefreshing(false); return }

    // Count activities per lead
    const actCounts = {}
    for (const a of (actResult.data || [])) {
      actCounts[a.lead_id] = (actCounts[a.lead_id] || 0) + 1
    }

    // Calculate fresh scores and collect leads where score changed
    const updates = []
    const leadsWithScores = leadsResult.data.map(lead => {
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
    let debounceTimer = null

    const channel = supabase
      .channel('board-leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          if (isDraggingRef.current) {
            // Queue updates that arrive during a drag — flush when drag ends
            pendingUpdatesRef.current.push(payload)
          } else {
            applyLeadChange(payload)
          }
        }, 100)
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
      clearTimeout(debounceTimer)
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      supabase.removeChannel(channel)
    }
  }, [applyLeadChange, triggerFetch])

  const flushPending = useCallback(() => {
    for (const payload of pendingUpdatesRef.current) applyLeadChange(payload)
    pendingUpdatesRef.current = []
  }, [applyLeadChange])

  const handleDragStateChange = useCallback((dragging) => {
    isDraggingRef.current = dragging
    if (!dragging) flushPending()
  }, [flushPending])

  return (
    <LeadsContext.Provider value={{ leads, loading, refreshing, fetchLeads: triggerFetch, handleDragStateChange }}>
      {children}
    </LeadsContext.Provider>
  )
}
