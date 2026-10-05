import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  patchLead, applyLeadChanges, stageChangeFields, pickFields, createChangeBatcher,
} from './leadsState.js'

const lead = (id, extra = {}) => ({ id, stage: 'new', score: 10, ...extra })

test('patchLead merges changes into the matching lead only', () => {
  const a = lead('a'), b = lead('b')
  const next = patchLead([a, b], 'a', { stage: 'won' })
  assert.equal(next[0].stage, 'won')
  assert.equal(next[0].score, 10)
  assert.equal(next[1], b, 'untouched leads keep identity')
  assert.equal(a.stage, 'new', 'input is not mutated')
})

test('patchLead returns the same array when the id is missing', () => {
  const leads = [lead('a')]
  assert.equal(patchLead(leads, 'zzz', { stage: 'won' }), leads)
})

test('applyLeadChanges applies every payload in a batch, across leads', () => {
  const leads = [lead('a'), lead('b'), lead('c')]
  const next = applyLeadChanges(leads, [
    { eventType: 'UPDATE', new: lead('a', { stage: 'won', score: undefined }) },
    { eventType: 'UPDATE', new: lead('b', { stage: 'lost', score: 55 }) },
    { eventType: 'DELETE', old: { id: 'c' } },
    { eventType: 'INSERT', new: { id: 'd', stage: 'new' } },
  ], () => 42)
  assert.deepEqual(next.map(l => [l.id, l.stage, l.score]), [
    ['a', 'won', 10],  // score kept when the payload has none
    ['b', 'lost', 55],
    ['d', 'new', 42],
  ])
})

test('applyLeadChanges dedups INSERTs for leads already present', () => {
  const leads = [lead('a')]
  const next = applyLeadChanges(leads, [{ eventType: 'INSERT', new: lead('a', { stage: 'won' }) }])
  assert.equal(next, leads)
})

test('applyLeadChanges: later UPDATE for the same lead wins', () => {
  const next = applyLeadChanges([lead('a')], [
    { eventType: 'UPDATE', new: lead('a', { stage: 'won' }) },
    { eventType: 'UPDATE', new: lead('a', { stage: 'lost' }) },
  ])
  assert.equal(next[0].stage, 'lost')
})

test('stageChangeFields stamps quote_sent_at only for estimate_sent', () => {
  const now = '2026-10-05T12:00:00.000Z'
  assert.deepEqual(stageChangeFields('estimate_sent', now), { stage: 'estimate_sent', stage_changed_at: now, quote_sent_at: now })
  assert.deepEqual(stageChangeFields('won', now), { stage: 'won', stage_changed_at: now })
  assert.deepEqual(stageChangeFields('need_to_quote', now), { stage: 'need_to_quote', stage_changed_at: now })
})

test('rollback of an estimate_sent move restores the prior quote_sent_at', () => {
  const original = lead('a', { stage: 'need_to_quote', stage_changed_at: 't0', quote_sent_at: null })
  const changes = stageChangeFields('estimate_sent', 't1')
  const prior = pickFields(original, changes)
  assert.deepEqual(prior, { stage: 'need_to_quote', stage_changed_at: 't0', quote_sent_at: null })
  assert.deepEqual(patchLead(patchLead([original], 'a', changes), 'a', prior)[0], original)
})

test('pickFields captures prior values for rollback, null for missing', () => {
  const prior = pickFields(lead('a', { stage_changed_at: 't0' }), { stage: 'won', stage_changed_at: 't1', owner: 'x' })
  assert.deepEqual(prior, { stage: 'new', stage_changed_at: 't0', owner: null })
})

test('optimistic patch then rollback restores the original lead fields', () => {
  const original = lead('a', { stage_changed_at: 't0' })
  const changes = stageChangeFields('won', 't1')
  const prior = pickFields(original, changes)
  const moved = patchLead([original], 'a', changes)
  assert.equal(moved[0].stage, 'won')
  const reverted = patchLead(moved, 'a', prior)
  assert.deepEqual(reverted[0], original)
})

test('createChangeBatcher delivers all payloads in one batch (none dropped)', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const batches = []
    const b = createChangeBatcher({ delay: 100, onFlush: batch => batches.push(batch) })
    b.push(1); mock.timers.tick(50)
    b.push(2); mock.timers.tick(50) // timer is not reset by the second push
    assert.deepEqual(batches, [[1, 2]])
    b.push(3); mock.timers.tick(100)
    assert.deepEqual(batches, [[1, 2], [3]])
  } finally {
    mock.timers.reset()
  }
})

test('createChangeBatcher holds payloads while paused, releases on flush', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let paused = true
    const batches = []
    const b = createChangeBatcher({ delay: 100, isPaused: () => paused, onFlush: batch => batches.push(batch) })
    b.push('x'); b.push('y')
    mock.timers.tick(500)
    assert.deepEqual(batches, [], 'nothing applied mid-drag')
    paused = false
    b.flush()
    assert.deepEqual(batches, [['x', 'y']])
  } finally {
    mock.timers.reset()
  }
})

test('createChangeBatcher.cancel discards queued payloads', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const batches = []
    const b = createChangeBatcher({ delay: 100, onFlush: batch => batches.push(batch) })
    b.push(1); b.cancel(); mock.timers.tick(200)
    assert.deepEqual(batches, [])
  } finally {
    mock.timers.reset()
  }
})
