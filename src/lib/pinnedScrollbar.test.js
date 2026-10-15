import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampScroll, pinnedBarMetrics } from './pinnedScrollbar.js'

test('desk bar scroll range matches the content scroller', () => {
  const metrics = pinnedBarMetrics({
    scrollWidth: 2400,
    clientWidth: 900,
    offsetWidth: 915,
    scrollLeft: 400,
  })
  assert.equal(metrics.spacer, 2400)
  assert.equal(metrics.yGutter, 15)
  assert.equal(metrics.max, 1500)
  assert.equal(metrics.scrollLeft, 400)
  assert.equal(metrics.max, 2400 - 900)
})

test('desk bar stays put when the content is not wider than the viewport', () => {
  const metrics = pinnedBarMetrics({
    scrollWidth: 800,
    clientWidth: 900,
    offsetWidth: 900,
    scrollLeft: 40,
  })
  assert.equal(metrics.spacer, 900)
  assert.equal(metrics.max, 0)
  assert.equal(metrics.scrollLeft, 0)
  assert.equal(metrics.yGutter, 0)
})

test('scroll position clamps to the shared range', () => {
  assert.equal(clampScroll(-20, 100), 0)
  assert.equal(clampScroll(250, 100), 100)
  assert.equal(clampScroll(Number.NaN, 100), 0)
  const metrics = pinnedBarMetrics({
    scrollWidth: 1200,
    clientWidth: 400,
    offsetWidth: 400,
    scrollLeft: 5000,
  })
  assert.equal(metrics.scrollLeft, 800)
})
