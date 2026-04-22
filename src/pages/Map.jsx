import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { supabase } from '../lib/supabase'
import { STAGES } from '../lib/stages'
import DistanceFilterButton from '../components/DistanceFilterButton'
import { geocodeAddress } from '../lib/geocode'
import { haversineMiles } from '../lib/haversine'

const GOOGLE_MAPS_LIBRARIES = ['marker']
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

export default function Map() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [filterCenter, setFilterCenter] = useState(null)
  const [filterRadius, setFilterRadius] = useState(50)
  const [hiddenStages, setHiddenStages] = useState(new Set())

  const mapRef = useRef(null)
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
        .select('id, first_name, last_name, company, city, zip, address, latitude, longitude, stage, value, phone, email, follow_up_date, notes')
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

  const toggleStage = (stageId) => {
    setHiddenStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
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

    if (filterCenter && mapRef.current) {
      circleRef.current = new window.google.maps.Circle({
        map: mapRef.current,
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
  }, [filterCenter, filterRadius, isLoaded])

  // Rebuild markers when leads, filter, hidden stages, or map readiness changes
  useEffect(() => {
    if (!mapRef.current || leads.length === 0) return

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
      map: mapRef.current,
      markers,
    })

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers()
        clustererRef.current = null
      }
    }
  }, [leads, isLoaded, filterCenter, filterRadius, hiddenStages])

  // Fit map to filter circle or full lead bounds when filter changes
  useEffect(() => {
    if (!mapRef.current) return
    if (filterCenter) {
      const center = new window.google.maps.LatLng(filterCenter.lat, filterCenter.lng)
      const circleBounds = new window.google.maps.Circle({ center, radius: filterRadius * 1609.34 }).getBounds()
      mapRef.current.fitBounds(circleBounds, 60)
    } else if (bounds) {
      const googleBounds = new window.google.maps.LatLngBounds(
        { lat: bounds.minLat, lng: bounds.minLng },
        { lat: bounds.maxLat, lng: bounds.maxLng }
      )
      mapRef.current.fitBounds(googleBounds, 60)
    }
  }, [filterCenter, filterRadius, bounds])

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

  const panelVisible = (filterCenter && matchingLeads.length > 0) || !!selectedLead

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Error banners */}
      {error && (
        <div style={{
          background: 'rgba(192,39,45,0.1)',
          border: '1px solid rgba(192,39,45,0.3)',
          color: '#C0272D',
          fontSize: 13,
          padding: '10px 20px',
          flexShrink: 0,
        }}>
          Error loading leads: {error}
        </div>
      )}
      {loadError && (
        <div style={{
          background: 'rgba(192,39,45,0.1)',
          border: '1px solid rgba(192,39,45,0.3)',
          color: '#C0272D',
          fontSize: 13,
          padding: '10px 20px',
          flexShrink: 0,
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.3px',
          }}>
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

      {/* Map area */}
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {!isLoaded && !loadError ? (
          <div style={{
            background: 'var(--color-surface-2)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 8,
            height: 'calc(100vh - 200px)',
            minHeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-3)',
            fontSize: 14,
          }}>
            Loading map...
          </div>
        ) : !loadError ? (
          <>
            {/* Map container — position:relative so the panel can be absolute inside */}
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '0.5px solid var(--color-border)' }}>
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 500 }}
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

              {/* Side panel */}
              {panelVisible && (
                <aside style={{
                  position: 'absolute',
                  top: 0, right: 0, bottom: 0,
                  width: 360,
                  background: 'var(--color-surface)',
                  borderLeft: '0.5px solid var(--color-border)',
                  boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  zIndex: 10,
                }}>
                  {selectedLead ? (
                    /* ── VIEW B: Lead detail ── */
                    <>
                      {/* Detail header */}
                      <div style={{
                        padding: '16px 20px 12px',
                        borderBottom: '1px solid var(--color-border)',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}>
                        {filterCenter ? (
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
                        ) : (
                          <div />
                        )}
                        <button
                          onClick={() => { setSelectedLead(null); if (filterCenter) setFilterCenter(null) }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                            color: 'var(--color-text-3)', display: 'flex', alignItems: 'center',
                            borderRadius: 4,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* Detail body */}
                      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
                        {/* Name + company */}
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

                        {/* Stage badge */}
                        {selectedLead.stage && (
                          <span style={{
                            display: 'inline-block',
                            fontSize: 10, fontWeight: 700,
                            color: '#fff',
                            background: STAGE_COLORS[selectedLead.stage] || '#6B7280',
                            padding: '2px 8px',
                            borderRadius: 3,
                            letterSpacing: '0.5px',
                            textTransform: 'uppercase',
                            marginBottom: 16,
                          }}>
                            {STAGE_LABELS[selectedLead.stage] || selectedLead.stage}
                          </span>
                        )}

                        {/* Fields */}
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

                        {/* Link */}
                        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 16 }}>
                          <Link
                            to={`/leads/${selectedLead.id}`}
                            style={{
                              display: 'block', textAlign: 'center',
                              padding: '9px 0', borderRadius: 6,
                              background: 'var(--color-accent)',
                              color: '#fff', fontSize: 13, fontWeight: 600,
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
                    /* ── VIEW A: Lead list ── */
                    <>
                      {/* List header */}
                      <div style={{
                        padding: '16px 20px 12px',
                        borderBottom: '1px solid var(--color-border)',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Leads in radius</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginTop: 2, lineHeight: 1.4 }}>
                            {matchCount} within {filterRadius}mi of {filterCenter.address}
                          </div>
                        </div>
                        <button
                          onClick={() => { setFilterCenter(null); setSelectedLead(null) }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                            color: 'var(--color-text-3)', display: 'flex', alignItems: 'center',
                            borderRadius: 4, flexShrink: 0,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* List body */}
                      <div style={{ flex: 1, overflow: 'auto' }}>
                        {matchingLeads.map(lead => (
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
                                {[lead.city, `${Math.round(lead._distance)}mi`].filter(Boolean).join(' · ')}
                              </div>
                            </span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0, color: 'var(--color-border)' }}>
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </aside>
              )}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {STAGES.map(stage => {
                const hidden = hiddenStages.has(stage.id)
                return (
                  <button
                    key={stage.id}
                    onClick={() => toggleStage(stage.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '3px 6px', borderRadius: 4,
                      fontSize: 12, color: 'var(--color-text-3)',
                      opacity: hidden ? 0.4 : 1,
                      transition: 'opacity 0.15s',
                    }}
                    title={hidden ? `Show ${stage.label}` : `Hide ${stage.label}`}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color, flexShrink: 0, opacity: 1 }} />
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
          </>
        ) : null}
      </div>
    </div>
  )
}
