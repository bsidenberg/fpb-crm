import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { supabase } from '../lib/supabase'
import { STAGES } from '../lib/stages'
import DistanceFilterButton from '../components/DistanceFilterButton'
import { geocodeAddress } from '../lib/geocode'
import { haversineMiles } from '../lib/haversine'

const GOOGLE_MAPS_LIBRARIES = []
const STAGE_COLORS = Object.fromEntries(STAGES.map(s => [s.id, s.color]))
const STAGE_LABELS = Object.fromEntries(STAGES.map(s => [s.id, s.label]))

function formatValue(v) {
  if (!v) return null
  return '$' + Number(v).toLocaleString()
}

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

function EyeOpenIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeClosedIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

export default function Map() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [filterCenter, setFilterCenter] = useState(null)
  const [filterRadius, setFilterRadius] = useState(50)
  const [hiddenStages, setHiddenStages] = useState(new Set())

  const [mapInstance, setMapInstance] = useState(null)
  const clustererRef = useRef(null)
  const circleRef = useRef(null)

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  })

  useEffect(() => {
    async function fetchLeads() {
      const { data, error } = await supabase
        .from('leads')
        .select('id, first_name, last_name, company, city, zip, address, latitude, longitude, stage, value, phone, email, follow_up_date, notes, created_at')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)

      if (error) {
        setError(error.message)
      } else {
        setLeads(data || [])
      }
      setLoading(false)
    }
    fetchLeads()
  }, [])

  const bounds = useMemo(() => {
    if (leads.length === 0) return null
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const lead of leads) {
      if (lead.latitude < minLat) minLat = lead.latitude
      if (lead.latitude > maxLat) maxLat = lead.latitude
      if (lead.longitude < minLng) minLng = lead.longitude
      if (lead.longitude > maxLng) maxLng = lead.longitude
    }
    return { minLat, maxLat, minLng, maxLng }
  }, [leads])

  // Leads within the radius circle, sorted nearest-first, respecting hidden stages
  const matchingLeads = useMemo(() => {
    if (!filterCenter) return []
    return leads
      .filter(l => !hiddenStages.has(l.stage))
      .map(l => {
        const d = haversineMiles(filterCenter.lat, filterCenter.lng, l.latitude, l.longitude)
        return { ...l, _distance: d }
      })
      .filter(l => l._distance != null && l._distance <= filterRadius)
      .sort((a, b) => a._distance - b._distance)
  }, [leads, filterCenter, filterRadius, hiddenStages])

  const matchCount = matchingLeads.length

  // All geocoded leads respecting hidden stages, sorted newest first — used in default list panel
  const allVisibleLeads = useMemo(() => {
    return leads
      .filter(l => !hiddenStages.has(l.stage))
      .sort((a, b) => {
        const aT = a.created_at ? new Date(a.created_at).getTime() : 0
        const bT = b.created_at ? new Date(b.created_at).getTime() : 0
        return bT - aT
      })
  }, [leads, hiddenStages])

  const toggleStage = (stageId) => {
    setHiddenStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  const onMapLoad = useCallback((map) => {
    setMapInstance(map)
    if (bounds) {
      const googleBounds = new window.google.maps.LatLngBounds(
        { lat: bounds.minLat, lng: bounds.minLng },
        { lat: bounds.maxLat, lng: bounds.maxLng }
      )
      map.fitBounds(googleBounds, 60)
    }
  }, [bounds])

  // Imperative circle management — bypasses @react-google-maps/api Circle wrapper cleanup bug
  useEffect(() => {
    if (!isLoaded) return

    if (circleRef.current) {
      circleRef.current.setMap(null)
      circleRef.current = null
    }

    if (filterCenter && mapInstance) {
      circleRef.current = new window.google.maps.Circle({
        map: mapInstance,
        center: { lat: filterCenter.lat, lng: filterCenter.lng },
        radius: filterRadius * 1609.34,
        fillColor: '#C0272D',
        fillOpacity: 0.08,
        strokeColor: '#C0272D',
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
      })
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null)
        circleRef.current = null
      }
    }
  }, [mapInstance, filterCenter, filterRadius, isLoaded])

  // Rebuild markers when leads, filter, hidden stages, or map readiness changes
  useEffect(() => {
    if (!mapInstance || leads.length === 0) return

    if (clustererRef.current) {
      clustererRef.current.clearMarkers()
    }

    const markers = leads
      .filter(lead => !hiddenStages.has(lead.stage))
      .map(lead => {
        const inRadius = filterCenter
          ? (haversineMiles(filterCenter.lat, filterCenter.lng, lead.latitude, lead.longitude) ?? Infinity) <= filterRadius
          : true

        const marker = new window.google.maps.Marker({
          position: { lat: lead.latitude, lng: lead.longitude },
          title: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            fillColor: STAGE_COLORS[lead.stage] || '#6B7280',
            fillOpacity: inRadius ? 0.9 : 0.2,
            strokeColor: '#FFFFFF',
            strokeWeight: 2,
            scale: 10,
          },
        })
        marker.leadData = lead
        marker.addListener('click', () => {
          setSelectedLead(lead)
        })
        return marker
      })

    clustererRef.current = new MarkerClusterer({
      map: mapInstance,
      markers,
    })

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers()
        clustererRef.current = null
      }
    }
  }, [mapInstance, leads, isLoaded, filterCenter, filterRadius, hiddenStages])

  // Fit map to filter circle or full lead bounds when filter changes
  useEffect(() => {
    if (!mapInstance) return
    if (filterCenter) {
      const center = new window.google.maps.LatLng(filterCenter.lat, filterCenter.lng)
      const circleBounds = new window.google.maps.Circle({ center, radius: filterRadius * 1609.34 }).getBounds()
      mapInstance.fitBounds(circleBounds, 60)
    } else if (bounds) {
      const googleBounds = new window.google.maps.LatLngBounds(
        { lat: bounds.minLat, lng: bounds.minLng },
        { lat: bounds.maxLat, lng: bounds.maxLng }
      )
      mapInstance.fitBounds(googleBounds, 60)
    }
  }, [mapInstance, filterCenter, filterRadius, bounds])

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-3)',
        fontSize: 14,
      }}>
        Loading map...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Error banners */}
      {error && (
        <div style={{
          background: 'rgba(192,39,45,0.1)',
          border: '1px solid rgba(192,39,45,0.3)',
          color: '#C0272D', fontSize: 13,
          padding: '10px 20px', flexShrink: 0,
        }}>
          Error loading leads: {error}
        </div>
      )}
      {loadError && (
        <div style={{
          background: 'rgba(192,39,45,0.1)',
          border: '1px solid rgba(192,39,45,0.3)',
          color: '#C0272D', fontSize: 13,
          padding: '10px 20px', flexShrink: 0,
        }}>
          Failed to load Google Maps. Check API key and restrictions.
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.3px' }}>
            Map
          </h1>
          <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 2 }}>
            {leads.length} lead{leads.length !== 1 ? 's' : ''} plotted
          </div>
        </div>
        <DistanceFilterButton
          centerAddress={filterCenter?.address || null}
          radiusMiles={filterRadius}
          matchCount={matchCount}
          totalCount={leads.length}
          onApply={async ({ address, radius }) => {
            const result = await geocodeAddress(address)
            if (!result) { alert('Could not find that address'); return }
            setFilterCenter({ lat: result.latitude, lng: result.longitude, address })
            setFilterRadius(radius)
          }}
          onClear={() => { setFilterCenter(null); setSelectedLead(null) }}
        />
      </div>

      {/* Body — flex column holding the map+panel row and the legend */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!isLoaded && !loadError ? (
          <div style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-3)', fontSize: 14,
          }}>
            Loading map...
          </div>
        ) : !loadError ? (
          <>
            {/* Map + panel row */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

              {/* Map column */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 0 0 16px' }}>
                <div style={{ flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', border: '0.5px solid var(--color-border)' }}>
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={{ lat: 28.5, lng: -81.5 }}
                    zoom={8}
                    onLoad={onMapLoad}
                    options={{
                      mapTypeControl: false,
                      streetViewControl: false,
                      fullscreenControl: true,
                      zoomControl: true,
                    }}
                  />
                </div>

                {/* Legend — eye-icon toggle chips, below map in map column */}
                <div style={{ flexShrink: 0, padding: '10px 0 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  {STAGES.map(stage => {
                    const hidden = hiddenStages.has(stage.id)
                    return (
                      <button
                        key={stage.id}
                        onClick={() => toggleStage(stage.id)}
                        title={hidden ? `Show ${stage.label}` : `Hide ${stage.label}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8,
                          padding: '5px 12px', borderRadius: 16,
                          fontSize: 12, fontWeight: 500,
                          cursor: 'pointer', transition: 'all 0.15s',
                          background: 'var(--color-surface)',
                          border: hidden ? '1px solid var(--color-border)' : `1px solid ${stage.color}`,
                          color: hidden ? 'var(--color-text-3)' : stage.color,
                          opacity: hidden ? 0.7 : 1,
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = 'translateY(-1px)'
                          e.currentTarget.style.background = hidden ? 'var(--color-surface-2)' : `${stage.color}0D`
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = 'translateY(0)'
                          e.currentTarget.style.background = 'var(--color-surface)'
                        }}
                      >
                        {hidden
                          ? <EyeClosedIcon size={14} color="var(--color-text-3)" />
                          : <EyeOpenIcon size={14} color={stage.color} />
                        }
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
                        <span style={{ textDecoration: hidden ? 'line-through' : 'none' }}>{stage.label}</span>
                      </button>
                    )
                  })}
                  {hiddenStages.size > 0 && (
                    <button
                      onClick={() => setHiddenStages(new Set())}
                      style={{
                        background: 'none', border: 'none', padding: '3px 6px',
                        color: 'var(--color-text-3)', fontSize: 12,
                        textDecoration: 'underline', cursor: 'pointer', marginLeft: 2,
                      }}
                    >
                      Show all
                    </button>
                  )}
                </div>
              </div>

              {/* Side panel — always visible */}
              <aside style={{
                width: 360,
                flexShrink: 0,
                borderLeft: '0.5px solid var(--color-border)',
                background: 'var(--color-surface)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}>
                {selectedLead ? (
                  /* ── STATE A: Lead detail ── */
                  <>
                    <div style={{
                      padding: '14px 20px 10px',
                      borderBottom: '1px solid var(--color-border)',
                      flexShrink: 0,
                    }}>
                      <button
                        onClick={() => setSelectedLead(null)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 12, color: 'var(--color-text-3)', fontWeight: 500,
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M19 12H5M12 5l-7 7 7 7" />
                        </svg>
                        Back to list
                      </button>
                    </div>

                    <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.2 }}>
                          {selectedLead.first_name} {selectedLead.last_name}
                        </div>
                        {selectedLead.company && (
                          <div style={{ fontSize: 13, color: 'var(--color-text-3)', marginTop: 3 }}>
                            {selectedLead.company}
                          </div>
                        )}
                      </div>

                      {selectedLead.stage && (
                        <span style={{
                          display: 'inline-block', fontSize: 10, fontWeight: 700,
                          color: '#fff', background: STAGE_COLORS[selectedLead.stage] || '#6B7280',
                          padding: '2px 8px', borderRadius: 3,
                          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 16,
                        }}>
                          {STAGE_LABELS[selectedLead.stage] || selectedLead.stage}
                        </span>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                        {(selectedLead.address || selectedLead.city) && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Address</div>
                            <div style={{ color: 'var(--color-text)' }}>
                              {selectedLead.address && <div>{selectedLead.address}</div>}
                              {(selectedLead.city || selectedLead.zip) && (
                                <div>{[selectedLead.city, selectedLead.zip ? `FL ${selectedLead.zip}` : null].filter(Boolean).join(', ')}</div>
                              )}
                            </div>
                          </div>
                        )}
                        {selectedLead.value && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Value</div>
                            <div style={{ color: 'var(--color-green)', fontWeight: 600 }}>{formatValue(selectedLead.value)}</div>
                          </div>
                        )}
                        {selectedLead.phone && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Phone</div>
                            <a href={`tel:${selectedLead.phone}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>{selectedLead.phone}</a>
                          </div>
                        )}
                        {selectedLead.email && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Email</div>
                            <a href={`mailto:${selectedLead.email}`} style={{ color: 'var(--color-accent)', textDecoration: 'none', wordBreak: 'break-all' }}>{selectedLead.email}</a>
                          </div>
                        )}
                        {selectedLead.follow_up_date && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Follow-up</div>
                            <div style={{ color: 'var(--color-text)' }}>{formatDate(selectedLead.follow_up_date)}</div>
                          </div>
                        )}
                        {selectedLead.notes && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Notes</div>
                            <div style={{ color: 'var(--color-text-3)', fontSize: 12, lineHeight: 1.5, fontStyle: 'italic' }}>{selectedLead.notes}</div>
                          </div>
                        )}
                      </div>

                      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 16 }}>
                        <Link
                          to={`/leads/${selectedLead.id}`}
                          style={{
                            display: 'block', textAlign: 'center', padding: '9px 0', borderRadius: 6,
                            background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 600,
                            textDecoration: 'none', transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-accent-hover)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--color-accent)'}
                        >
                          Open full lead →
                        </Link>
                      </div>
                    </div>
                  </>
                ) : (
                  /* ── STATE B / C: Lead list ── */
                  <>
                    {/* List header */}
                    <div style={{
                      padding: '16px 20px 12px',
                      borderBottom: '1px solid var(--color-border)',
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.2 }}>
                        {filterCenter ? matchCount : allVisibleLeads.length} lead{(filterCenter ? matchCount : allVisibleLeads.length) !== 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>
                        {filterCenter
                          ? `Within ${filterRadius} miles of ${filterCenter.address}`
                          : 'All geocoded leads'
                        }
                      </div>
                      {/* Clear filter link — only in State B */}
                      {filterCenter && (
                        <button
                          onClick={() => { setFilterCenter(null); setSelectedLead(null) }}
                          style={{
                            background: 'none', border: 'none', padding: 0, marginTop: 6,
                            color: 'var(--color-text-3)', fontSize: 11,
                            textDecoration: 'underline', cursor: 'pointer',
                          }}
                        >
                          Clear filter
                        </button>
                      )}
                    </div>

                    {/* List body */}
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      {(() => {
                        const displayList = filterCenter ? matchingLeads : allVisibleLeads
                        if (hiddenStages.size === STAGES.length) {
                          return (
                            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-3)', fontSize: 13 }}>
                              All stages are hidden. Click a stage in the legend to show its leads.
                            </div>
                          )
                        }
                        if (displayList.length === 0) {
                          return (
                            <div style={{
                              display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              padding: '48px 20px', color: 'var(--color-text-3)', textAlign: 'center',
                            }}>
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth={1.5} style={{ marginBottom: 12, opacity: 0.4 }}>
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 4 }}>
                                {filterCenter ? 'No leads in this radius' : 'No geocoded leads yet'}
                              </div>
                              <div style={{ fontSize: 12 }}>
                                {filterCenter ? 'Try increasing the radius or clearing stage filters.' : 'Add address data to leads to see them here.'}
                              </div>
                            </div>
                          )
                        }
                        return displayList.map(lead => (
                          <button
                            key={lead.id}
                            onClick={() => setSelectedLead(lead)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 20px', background: 'transparent', border: 'none',
                              borderBottom: '1px solid var(--color-border)',
                              cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{
                              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                              background: STAGE_COLORS[lead.stage] || '#6B7280',
                            }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                                {lead.first_name} {lead.last_name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 1 }}>
                                {filterCenter
                                  ? [lead.city, lead._distance != null ? `${Math.round(lead._distance)}mi` : null].filter(Boolean).join(' · ')
                                  : lead.city || ''
                                }
                              </div>
                            </span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0, color: 'var(--color-border)' }}>
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </button>
                        ))
                      })()}
                    </div>
                  </>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
