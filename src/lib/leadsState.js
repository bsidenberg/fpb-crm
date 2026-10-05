// Pure helpers for the shared leads list held by LeadsProvider.
// Kept free of React/Supabase so they can be unit-tested with node --test.

// Merge `changes` into the lead with `id`. Other lead objects keep their
// identity so memoized columns/cards bail out. Returns the same array when
// the id is not present (nothing to update).
export function patchLead(leads, id, changes) {
  let found = false
  const next = leads.map(l => {
    if (l.id !== id) return l
    found = true
    return { ...l, ...changes }
  })
  return found ? next : leads
}

// Apply a batch of Supabase postgres_changes payloads in arrival order.
// `scoreFor(row)` supplies a score for newly inserted rows.
export function applyLeadChanges(leads, payloads, scoreFor = () => 0) {
  let next = leads
  for (const p of payloads) {
    if (p.eventType === 'INSERT') {
      if (next.some(l => l.id === p.new.id)) continue // dedup
      next = [...next, { ...p.new, score: scoreFor(p.new) }]
    } else if (p.eventType === 'UPDATE') {
      next = next.map(l =>
        l.id === p.new.id ? { ...p.new, score: p.new.score ?? l.score } : l
      )
    } else if (p.eventType === 'DELETE') {
      next = next.filter(l => l.id !== p.old.id)
    }
  }
  return next
}

// Fields written when a lead changes stage, from the board or the detail page.
// quote_sent_at (migration 20261005000001) drives quote-followup-check.
export function stageChangeFields(stage, now = new Date().toISOString()) {
  const fields = { stage, stage_changed_at: now }
  if (stage === 'estimate_sent') fields.quote_sent_at = now
  return fields
}

// Collects realtime payloads and hands them to `onFlush` as one batch, `delay`
// ms after the first arrival. Unlike a reset-on-every-event debounce, no
// payload is ever dropped. While `isPaused()` is true (a card drag is in
// progress) payloads stay queued until `flush()` is called.
export function createChangeBatcher({ delay = 100, isPaused = () => false, onFlush }) {
  let queue = []
  let timer = null

  function flush() {
    clearTimeout(timer)
    timer = null
    if (isPaused() || queue.length === 0) return
    const batch = queue
    queue = []
    onFlush(batch)
  }

  return {
    push(payload) {
      queue.push(payload)
      if (!timer) timer = setTimeout(flush, delay)
    },
    flush,
    cancel() {
      clearTimeout(timer)
      timer = null
      queue = []
    },
  }
}

// The subset of `lead` covered by `changes`, for rolling back an optimistic patch.
export function pickFields(lead, changes) {
  const out = {}
  for (const key of Object.keys(changes)) out[key] = lead?.[key] ?? null
  return out
}
