import { useState, useEffect } from 'react'

function formatDuration(joinedAt) {
  const ms = Date.now() - joinedAt
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 min'
  return `${minutes} min`
}

function formatViewerList(viewers) {
  if (viewers.length === 0) return ''
  if (viewers.length === 1) return viewers[0].displayName
  if (viewers.length === 2) return `${viewers[0].displayName} and ${viewers[1].displayName}`
  // 3+
  const first = viewers.slice(0, -1).map(v => v.displayName).join(', ')
  const last = viewers[viewers.length - 1].displayName
  return `${first}, and ${last}`
}

export default function PresenceBanner({ viewers }) {
  const [dismissed, setDismissed] = useState(false)
  const [, setTick] = useState(0)

  // Re-render every 30 seconds so "viewing for X min" updates
  useEffect(() => {
    if (viewers.length === 0) return
    const interval = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(interval)
  }, [viewers.length])

  // Reset dismissed state when viewers list changes (new person joins)
  useEffect(() => {
    if (viewers.length > 0) setDismissed(false)
  }, [viewers.length])

  if (viewers.length === 0 || dismissed) return null

  // Use the EARLIEST joiner of the others (the one who's been here longest)
  const earliestJoin = Math.min(...viewers.map(v => v.joinedAt))

  const namesLabel = formatViewerList(viewers)
  const isAre = viewers.length === 1 ? 'is' : 'are'
  const durationLabel = formatDuration(earliestJoin)

  return (
    <div style={{
      background: '#FEF3C7',
      border: '1px solid #FCD34D',
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      color: '#78350F',
    }}>
      <span style={{ fontSize: 16 }}>👀</span>
      <div style={{ flex: 1 }}>
        <strong>{namesLabel}</strong> {isAre} also viewing this — {durationLabel}
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#92400E',
          fontSize: 14,
          padding: '2px 6px',
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
