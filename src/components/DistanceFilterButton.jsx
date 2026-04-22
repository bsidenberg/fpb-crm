import { useState, useRef, useEffect } from 'react'

function PinIcon({ size = 12 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      style={{ flexShrink: 0 }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

/**
 * DistanceFilterButton
 * Props:
 *   centerAddress  string | null   — active filter center label; null = inactive
 *   radiusMiles    number          — current radius (shown when active)
 *   matchCount     number          — leads within radius (shown when active)
 *   totalCount     number          — total leads (unused in label but available)
 *   onApply        ({ address, radius }) => void
 *   onClear        () => void
 */
export default function DistanceFilterButton({
  centerAddress, radiusMiles, matchCount, totalCount, onApply, onClear,
}) {
  const [open,    setOpen]    = useState(false)
  const [address, setAddress] = useState('')
  const [radius,  setRadius]  = useState(50)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const active = !!centerAddress

  const handleApply = () => {
    if (!address.trim()) return
    onApply({ address: address.trim(), radius })
    setOpen(false)
  }

  const handleClear = () => {
    onClear()
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '8px 14px',
          borderRadius: 6,
          border: active ? '1.5px solid #C0272D' : '1px solid var(--color-border)',
          background: active ? 'rgba(192,39,45,0.06)' : 'transparent',
          color: active ? '#C0272D' : 'var(--color-text-2)',
          fontSize: active ? 11 : 13,
          fontWeight: active ? 700 : 500,
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
          maxWidth: 260,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={e => {
          if (!active) {
            e.currentTarget.style.borderColor = 'var(--color-border-light)'
            e.currentTarget.style.color = 'var(--color-text)'
          }
        }}
        onMouseLeave={e => {
          if (!active) {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-2)'
          }
        }}
      >
        <PinIcon size={active ? 11 : 13} />
        {active
          ? `${radiusMiles}mi · ${centerAddress} (${matchCount})`
          : 'Distance filter'
        }
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
          width: 300,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
          padding: '14px 14px 12px',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--color-text-3)',
            textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8,
          }}>
            Filter by distance
          </div>

          <input
            autoFocus
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleApply() }}
            placeholder="Enter address or city, state"
            style={{
              width: '100%', padding: '7px 10px', boxSizing: 'border-box',
              background: 'var(--input-bg)', border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-text)', fontSize: 12,
              outline: 'none', marginBottom: 10,
            }}
            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
          />

          <input
            type="range"
            min={5} max={500} step={5}
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            style={{ width: '100%', marginBottom: 4, cursor: 'pointer' }}
          />
          <div style={{
            fontSize: 11, color: 'var(--color-text-2)', fontWeight: 600, marginBottom: 12,
          }}>
            {radius} miles
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleApply}
              disabled={!address.trim()}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                background: address.trim() ? '#C0272D' : 'var(--color-border)',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: address.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Apply
            </button>
            {active && (
              <button
                onClick={handleClear}
                style={{
                  padding: '7px 14px', borderRadius: 6,
                  background: 'transparent', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-2)', fontSize: 12, cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
