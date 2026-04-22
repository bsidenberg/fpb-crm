import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const fi = {
  width: '100%', padding: '7px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10,
      border: '1.5px solid var(--color-border)',
      borderTopColor: 'var(--color-accent)',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

/**
 * LeadAutocomplete
 *
 * Props:
 *   onSelect(lead)   — called when user picks a lead
 *   onClear()        — called when user clears the selection
 *   selectedLead     — full lead object | lead id string | null
 *   placeholder      — input placeholder string
 */
export default function LeadAutocomplete({
  onSelect,
  onClear,
  selectedLead = null,
  placeholder = 'Search leads by name, city, or phone',
}) {
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState([])
  const [loading,     setLoading]     = useState(false)
  const [open,        setOpen]        = useState(false)
  // resolved lead object — may be fetched if selectedLead is a bare id string
  const [resolved,    setResolved]    = useState(null)

  const containerRef = useRef(null)
  const debounceRef  = useRef(null)

  // Resolve selectedLead to a full object
  useEffect(() => {
    if (!selectedLead) {
      setResolved(null)
      return
    }
    if (typeof selectedLead === 'object' && selectedLead.id) {
      setResolved(selectedLead)
      return
    }
    // It's a bare id string — fetch once
    if (typeof selectedLead === 'string') {
      supabase
        .from('leads')
        .select('id, first_name, last_name, city, phone, email, stage')
        .eq('id', selectedLead)
        .single()
        .then(({ data }) => setResolved(data || null))
    }
  }, [selectedLead])

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) {
      setResults([])
      setLoading(false)
      setOpen(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const q = query.trim()
      const { data } = await supabase
        .from('leads')
        .select('id, first_name, last_name, city, phone, email, stage, barn_size, address, value')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,city.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8)
      setResults(data || [])
      setLoading(false)
      setOpen(true)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = useCallback((lead) => {
    setQuery('')
    setResults([])
    setOpen(false)
    onSelect(lead)
  }, [onSelect])

  const handleClear = useCallback(() => {
    setQuery('')
    setResults([])
    setOpen(false)
    setResolved(null)
    onClear()
  }, [onClear])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }, [])

  // --- Selected state: show chip, not input ---
  if (resolved) {
    const label = [resolved.first_name, resolved.last_name].filter(Boolean).join(' ')
    const sub   = resolved.city || ''
    return (
      <div ref={containerRef} style={{ position: 'relative' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'var(--color-accent-light)',
          border: '1px solid rgba(192,39,45,0.3)',
          borderRadius: 6,
          fontSize: 13,
        }}>
          <span style={{ flex: 1, color: 'var(--color-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
            {sub && (
              <span style={{ fontWeight: 400, color: 'var(--color-text-2)', marginLeft: 6 }}>
                {sub}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleClear}
            title="Clear selection"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-2)', fontSize: 16, lineHeight: 1,
              padding: '0 2px', flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#C0272D'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-2)'}
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  // --- Input + dropdown state ---
  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={fi}
          onFocus={e => {
            e.target.style.borderColor = 'var(--color-accent)'
            if (query.length >= 2) setOpen(true)
          }}
          onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center',
          }}>
            <Spinner />
          </span>
        )}
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
          overflow: 'hidden',
        }}>
          {results.length === 0 && !loading ? (
            <div style={{
              padding: '10px 12px', fontSize: 12,
              color: 'var(--color-text-3)', fontStyle: 'italic',
            }}>
              No leads found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((lead, i) => {
              const name  = [lead.first_name, lead.last_name].filter(Boolean).join(' ')
              const sub   = [lead.city, lead.stage].filter(Boolean).join(' · ')
              return (
                <button
                  key={lead.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); handleSelect(lead) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '9px 12px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                    textAlign: 'left', gap: 8,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </div>
                    {sub && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginTop: 1 }}>
                        {sub}
                      </div>
                    )}
                  </div>
                  {lead.phone && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {lead.phone}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
