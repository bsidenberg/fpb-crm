// Geometry for the viewport-pinned horizontal desk bar.
// The bar is a second overflow element whose scroll range must match the
// content scroller, including when a vertical scrollbar narrows the content.

export function clampScroll(left, max) {
  const cap = Math.max(0, Number.isFinite(max) ? max : 0)
  if (!Number.isFinite(left)) return 0
  return Math.min(Math.max(0, left), cap)
}

export function pinnedBarMetrics({ scrollWidth = 0, clientWidth = 0, offsetWidth = 0, scrollLeft = 0 } = {}) {
  const width = Number.isFinite(clientWidth) ? Math.max(0, clientWidth) : 0
  const contentWidth = Number.isFinite(scrollWidth) ? Math.max(0, scrollWidth) : 0
  const outerWidth = Number.isFinite(offsetWidth) ? Math.max(0, offsetWidth) : width
  const spacer = Math.max(contentWidth, width)
  const yGutter = Math.max(0, outerWidth - width)
  const max = Math.max(0, spacer - width)
  return {
    spacer,
    yGutter,
    max,
    scrollLeft: clampScroll(scrollLeft, max),
  }
}
