import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NewProjectModal from '../components/NewProjectModal'

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  planning:   { label: 'Planning',    color: '#2B3A6B', bg: 'rgba(43,58,107,0.08)'    },
  permitting: { label: 'Permitting',  color: '#D97706', bg: 'rgba(217,119,6,0.1)'     },
  materials:  { label: 'Materials',   color: '#2B3A6B', bg: 'rgba(43,58,107,0.08)'    },
  build:      { label: 'Build',       color: '#D97706', bg: 'rgba(217,119,6,0.1)'     },
  punch_list: { label: 'Punch list',  color: '#D97706', bg: 'rgba(217,119,6,0.1)'     },
  closed_won: { label: 'Closed won',  color: '#16A34A', bg: 'rgba(22,163,74,0.1)'     },
  on_hold:    { label: 'On hold',     color: '#6B7280', bg: 'rgba(107,114,128,0.1)'   },
  cancelled:  { label: 'Cancelled',   color: '#6B7280', bg: 'rgba(107,114,128,0.1)'   },
}

const TYPE = {
  kit:     { label: 'Kit',     color: '#C0272D', bg: 'rgba(192,39,45,0.08)'   },
  turnkey: { label: 'Turnkey', color: '#2B3A6B', bg: 'rgba(43,58,107,0.08)'  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(val) {
  if (val == null) return '—'
  return '$' + Math.round(Number(val)).toLocaleString('en-US')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00') // treat as local date
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ color, bg, children }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.1px',
      color,
      background: bg,
    }}>
      {children}
    </span>
  )
}

// ─── Table header cell ────────────────────────────────────────────────────────
const TH = ({ children, align = 'left', width }) => (
  <th style={{
    padding: '10px 14px',
    textAlign: align,
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--color-text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    whiteSpace: 'nowrap',
    width: width || undefined,
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface-2)',
  }}>
    {children}
  </th>
)

// ─── Table body cell ──────────────────────────────────────────────────────────
const TD = ({ children, align = 'left', muted }) => (
  <td style={{
    padding: '12px 14px',
    textAlign: align,
    fontSize: 13,
    color: muted ? 'var(--color-text-3)' : 'var(--color-text)',
    verticalAlign: 'middle',
    borderBottom: '1px solid var(--color-border-light)',
  }}>
    {children}
  </td>
)

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Projects() {
  const [projects, setProjects]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setProjects(data || [])
        setLoading(false)
      })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.4px' }}>
            Projects
          </h1>
          <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 2 }}>
            {loading ? 'Loading…' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px',
            background: 'var(--color-accent)',
            border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-accent-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--color-accent)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Project
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Error banner */}
        {error && (
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'rgba(192,39,45,0.08)',
            border: '1px solid rgba(192,39,45,0.25)',
            borderRadius: 6,
            color: '#C0272D',
            fontSize: 13,
            fontWeight: 500,
          }}>
            Failed to load projects: {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: 'var(--color-text-3)', fontSize: 14 }}>Loading…</div>
        )}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '80px 20px',
            color: 'var(--color-text-3)',
            textAlign: 'center',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.5} style={{ marginBottom: 16, opacity: 0.4 }}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 6 }}>
              No projects yet
            </div>
            <div style={{ fontSize: 13 }}>
              Create your first project or convert a closed-won lead.
            </div>
          </div>
        )}

        {/* Table */}
        {!loading && !error && projects.length > 0 && (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH width="90">Type</TH>
                  <TH width="110">Status</TH>
                  <TH>Customer</TH>
                  <TH>County</TH>
                  <TH align="right" width="110">Contract</TH>
                  <TH align="right" width="100">Target Close</TH>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => {
                  const status = STATUS[p.status] || { label: p.status, color: '#6B7280', bg: 'rgba(107,114,128,0.1)' }
                  const type   = TYPE[p.project_type] || { label: p.project_type, color: '#6B7280', bg: 'rgba(107,114,128,0.1)' }
                  return (
                    <tr key={p.id}
                      style={{ transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <TD>
                        <Link
                          to={`/projects/${p.id}`}
                          style={{ color: 'var(--color-navy)', fontWeight: 700, textDecoration: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {p.name}
                        </Link>
                      </TD>
                      <TD>
                        <Badge color={type.color} bg={type.bg}>{type.label}</Badge>
                      </TD>
                      <TD>
                        <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                      </TD>
                      <TD muted={!p.customer_name}>
                        {p.customer_name || '—'}
                        {p.lead_id && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-3)', marginTop: 2 }}>
                            ↳ from lead
                          </div>
                        )}
                      </TD>
                      <TD muted={!p.site_county}>{p.site_county || '—'}</TD>
                      <TD align="right" muted={p.contract_amount == null}>{fmtCurrency(p.contract_amount)}</TD>
                      <TD align="right" muted={!p.target_close_date}>{fmtDate(p.target_close_date)}</TD>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={newProject => setProjects(prev => [newProject, ...prev])}
      />
    </div>
  )
}
