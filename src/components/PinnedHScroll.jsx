import { useLayoutEffect, useRef, useState } from 'react'
import { pinnedBarMetrics } from '../lib/pinnedScrollbar'

// Horizontal scroller with a thick desk bar pinned to the bottom of this
// pane (the app shell is viewport-height, so the bar sits on the viewport
// bottom). The native horizontal bar is hidden in WebKit/Blink — overlay
// scrollbars in Chrome, Edge, and Safari otherwise vanish, and on a tall
// board they sit at the bottom of the content instead of the screen.
export default function PinnedHScroll({ children, style, contentStyle, scrollY = false }) {
  const contentRef = useRef(null)
  const barRef = useRef(null)
  const syncing = useRef(false)
  const [metrics, setMetrics] = useState(() => pinnedBarMetrics())

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    const measure = () => {
      const next = pinnedBarMetrics({
        scrollWidth: content.scrollWidth,
        clientWidth: content.clientWidth,
        offsetWidth: content.offsetWidth,
        scrollLeft: content.scrollLeft,
      })
      setMetrics(prev => (
        prev.spacer === next.spacer && prev.yGutter === next.yGutter
          ? prev
          : { spacer: next.spacer, yGutter: next.yGutter, max: next.max, scrollLeft: prev.scrollLeft }
      ))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    const watchChildren = () => {
      for (const child of content.children) observer.observe(child)
    }
    watchChildren()
    const mutations = new MutationObserver(() => {
      watchChildren()
      measure()
    })
    mutations.observe(content, { childList: true })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useLayoutEffect(() => {
    const content = contentRef.current
    const bar = barRef.current
    if (!content || !bar) return
    // Width changes can drop scrollLeft. Put the bar back on the content position.
    if (Math.abs(bar.scrollLeft - content.scrollLeft) > 1) {
      syncing.current = true
      bar.scrollLeft = content.scrollLeft
      syncing.current = false
    }
  }, [metrics.spacer, metrics.yGutter])

  function sync(from, to) {
    if (!from || !to || syncing.current) return
    if (Math.abs(from.scrollLeft - to.scrollLeft) < 1) return
    syncing.current = true
    to.scrollLeft = from.scrollLeft
    syncing.current = false
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      ...style,
    }}>
      <div
        ref={contentRef}
        className={scrollY ? 'pinned-h-scroll app-scroll' : 'pinned-h-scroll'}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowX: 'scroll',
          overflowY: scrollY ? 'auto' : 'hidden',
          ...contentStyle,
        }}
        onScroll={() => sync(contentRef.current, barRef.current)}
      >
        {children}
      </div>
      <div
        ref={barRef}
        className="desk-bar"
        aria-hidden="true"
        style={{ marginRight: metrics.yGutter }}
        onScroll={() => sync(barRef.current, contentRef.current)}
      >
        <div style={{ width: metrics.spacer, height: 1 }} />
      </div>
    </div>
  )
}
