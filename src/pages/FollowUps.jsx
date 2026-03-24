import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { getFollowUpStatus } from '../lib/followup'
import { STAGES, TEMPERATURE, ACTIVITY_TYPES } from '../lib/stages'

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))
const TEMP_MAP  = Object.fromEntries(TEMPERATURE.map(t => [t.id, t]))
const ATYPE_MAP = Object.fromEntries((ACTIVITY_TYPES || []).map(a => [a.id, a]))

const STATUS_ORDER = { overdue: 0, today: 1, upcoming: 2, future: 3 }

const STATUS_STYLE = {
  overdue:  { label: 'Overdue',   color: '#EF4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)' },
  today:    { label: 'Due Today', color: '#D4872A', bg: 'rgba(212,135,42,0.12)', border: 'rgba(212,135,42,0.35)' },
  upcoming: { label: 'Upcoming',  color: '#27AE60', bg: 'rgba(39,174,96,0.1)',  border: 'rgba(39,174,96,0.3)' },
  future:   { label: 'Future',    color: 'var(--color-text-3)', bg: 'rgba(107,99,96,0.15)', border: 'rgba(107,99,96,0.3)' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status]
  if (!s) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function StageBadge({ stageId }) {
  const s = STAGE_MAP[stageId]
  if (!s) return <span style={{ color: 'var(--color-text-3)', fontSize: 11 }}>—</span>
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      color: '#fff', background: s.color,
      padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function TempBadge({ priority }) {
  const t = TEMP_MAP[priority]
  if (!t) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px',
      color: t.textColor, background: t.bgColor,
      padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
    }}>
      {t.label}
    </span>
  )
}

export default function FollowUps() {
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [lastActivity, setLastActivity] = useState({}) // lead_id -> activity
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('') // '' | 'overdue' | 'today' | 'upcoming'

  useEffect(() => {
    async function load() {
      const { data: leadsData } = await supabase
        .from('leads')
        .select('*')
        .not('follow_up_date', 'is', null)
        .not('stage', 'in', '(won,lost)')
        .order('follow_up_date', { ascending: true })

      if (!leadsData || leadsData.length === 0) {
        setLeads([])
        setLoading(false)
        return
      }

      const ids = leadsData.map(l => l.id)
      const { data: activities } = await supabase
        .from('activities')
        .select('id, lead_id, type, body, created_at')
        .in('lead_id', ids)
        .order('created_at', { ascending: false })

      // Keep only most recent activity per lead
      const latestMap = {}
      if (activities) {
        for (const a of activities) {
          if (!latestMap[a.lead_id]) latestMap[a.lead_id] = a
        }
      }

      setLeads(leadsData)
      setLastActivity(latestMap)
      setLoading(false)
    }
    load()
  }, [])

  const withStatus = leads.map(l => ({
    ...l,
    _status: getFollowUpStatus(l.follow_up_date),
  }))

  const counts = {
    overdue:  withStatus.filter(l => l._status === 'overdue').length,
    today:    withStatus.filter(l => l._status === 'today').length,
    upcoming: withStatus.filter(l => l._status === 'upcoming').length,
  }

  const filtered = withStatus
    .filter(l => !filterStatus || l._status === filterStatus)
    .sort((a, b) => (STATUS_ORDER[a._status] ?? 9) - (STATUS_ORDER[b._status] ?? 9))

  const thStyle = {
    padding: '8px 12px',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.8px', color: 'var(--color-text-3)',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left', whiteSpace: 'nowrap',
  }

  const tdStyle = {
    padding: '10px 12px',
    fontSize: 12, color: 'var(--color-text-2)',
    borderBottom: '1px solid var(--color-border)',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.4px' }}>
              Follow-Ups
            </h1>
            <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 2 }}>
              {loading ? 'Loading...' : `${filtered.length} lead${filtered.length !== 1 ? 's' : ''}`}
              {counts.overdue > 0 && (
                <span style={{ color: '#EF4444', fontWeight: 600, marginLeft: 8 }}>
                  · {counts.overdue} overdue
                </span>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: '', label: 'All' },
              { id: 'overdue', label: `Overdue${counts.overdue > 0 ? ` (${counts.overdue})` : ''}` },
              { id: 'today',   label: `Due Today${counts.today > 0 ? ` (${counts.today})` : ''}` },
              { id: 'upcoming', label: `Upcoming${counts.upcoming > 0 ? ` (${counts.upcoming})` : ''}` },
            ].map(tab => {
              const active = filterStatus === tab.id
              const accentColor = tab.id === 'overdue' ? '#EF4444' : tab.id === 'today' ? '#D4872A' : tab.id === 'upcoming' ? '#27AE60' : 'var(--color-accent)'
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterStatus(tab.id)}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: active ? 600 : 400,
                    borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${active ? accentColor : 'var(--color-border)'}`,
                    background: active ? (tab.id === 'overdue' ? 'rgba(239,68,68,0.1)' : tab.id === 'today' ? 'rgba(212,135,42,0.1)' : tab.id === 'upcoming' ? 'rgba(39,174,96,0.1)' : 'var(--color-accent-light)') : 'transparent',
                    color: active ? accentColor : 'var(--color-text-2)',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--color-text-3)', fontSize: 14 }}>
            Loading follow-ups...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8 }}>
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="var(--color-text-3)" strokeWidth={1.5}>
              <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <div style={{ color: 'var(--color-text-3)', fontSize: 13 }}>No follow-ups scheduled</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 1 }}>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Follow-Up Date</th>
                <th style={thStyle}>Stage</th>
                <th style={thStyle}>Temp</th>
                <th style={thStyle}>City</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const activity = lastActivity[lead.id]
                const aType = activity ? ATYPE_MAP[activity.type] : null
                const isOverdueRow = lead._status === 'overdue'
                return (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={tdStyle}>
                      <StatusBadge status={lead._status} />
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)', fontWeight: 500 }}>
                      {lead.first_name} {lead.last_name}
                      {lead.company && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-3)', fontWeight: 400, marginTop: 1 }}>
                          {lead.company}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: isOverdueRow ? '#EF4444' : 'var(--color-text-2)', fontWeight: isOverdueRow ? 600 : 400, whiteSpace: 'nowrap' }}>
                      {(() => { try { return format(parseISO(lead.follow_up_date), 'MMM d, yyyy') } catch { return lead.follow_up_date } })()}
                    </td>
                    <td style={tdStyle}><StageBadge stageId={lead.stage} /></td>
                    <td style={tdStyle}><TempBadge priority={lead.priority} /></td>
                    <td style={tdStyle}>{lead.city || '—'}</td>
                    <td style={tdStyle}>
                      {lead.phone
                        ? <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--color-text-2)', textDecoration: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-2)'}
                          >{lead.phone}</a>
                        : '—'
                      }
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 240 }}>
                      {activity ? (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                          {aType && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                              color: aType.color, opacity: 0.8,
                              paddingTop: 1, flexShrink: 0,
                            }}>
                              {aType.label}
                            </span>
                          )}
                          <span style={{
                            overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            fontSize: 11, color: 'var(--color-text-3)',
                          }}>
                            {activity.body}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-3)', fontStyle: 'italic', fontSize: 11 }}>No activity yet</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
