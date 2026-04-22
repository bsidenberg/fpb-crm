import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import HitListTab    from '../components/HitListTab'
import UpdatesTab    from '../components/UpdatesTab'
import ChecklistTab  from '../components/ChecklistTab'
import PermittingTab from '../components/PermittingTab'

// ─── Status config (mirrors Projects.jsx) ─────────────────────────────────────
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

const TABS = [
  { id: 'hit_list',   label: 'Hit List'   },
  { id: 'updates',    label: 'Updates'    },
  { id: 'checklist',  label: 'Checklist'  },
  { id: 'permitting', label: 'Permitting' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(val) {
  if (val == null) return '—'
  return '$' + Math.round(Number(val)).toLocaleString('en-US')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getPermitStatus(checklistItems) {
  const perm      = checklistItems.filter(i => i.category === 'permitting')
  const approved  = perm.find(i => i.label === 'Permit approved date')
  const submitted = perm.find(i => i.label === 'Permit submitted date')
  if (approved?.value)  return { label: 'Approved',    color: '#16A34A', bg: 'rgba(22,163,74,0.1)'   }
  if (submitted?.value) return { label: 'Submitted',   color: '#D97706', bg: 'rgba(217,119,6,0.1)'   }
  return                       { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,0.1)' }
}

// ─── Small reusable bits ──────────────────────────────────────────────────────
function Badge({ color, bg, children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.1px', color, background: bg,
      flexShrink: 0,
    }}>
      {children}
    </span>
  )
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: 'var(--color-text-3)', textTransform: 'uppercase',
        letterSpacing: '0.8px', fontWeight: 600, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || 'var(--color-text)' }}>
        {value || '—'}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const { id } = useParams()

  const [project,        setProject]        = useState(null)
  const [hitList,        setHitList]        = useState([])
  const [updates,        setUpdates]        = useState([])
  const [checklistItems, setChecklistItems] = useState([])
  const [loading,        setLoading]        = useState(true)
  const [notFound,       setNotFound]       = useState(false)
  const [activeTab,      setActiveTab]      = useState('hit_list')

  // ── Initial fetch ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [projRes, hitRes, updRes, chkRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_hit_list').select('*').eq('project_id', id).order('position'),
      supabase.from('project_updates').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('project_checklist_items').select('*').eq('project_id', id).order('category').order('position'),
    ])
    if (!projRes.data) { setNotFound(true); setLoading(false); return }
    setProject(projRes.data)
    setHitList(hitRes.data || [])
    setUpdates(updRes.data || [])
    setChecklistItems(chkRes.data || [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Per-slice refetch callbacks ────────────────────────────────────────────
  const refetchHitList = useCallback(async () => {
    const { data } = await supabase
      .from('project_hit_list').select('*').eq('project_id', id).order('position')
    if (data) setHitList(data)
  }, [id])

  const refetchUpdates = useCallback(async () => {
    const { data } = await supabase
      .from('project_updates').select('*').eq('project_id', id)
      .order('created_at', { ascending: false })
    if (data) setUpdates(data)
  }, [id])

  const refetchChecklist = useCallback(async () => {
    const { data } = await supabase
      .from('project_checklist_items').select('*').eq('project_id', id)
      .order('category').order('position')
    if (data) setChecklistItems(data)
  }, [id])

  // ── Loading / not found ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--color-text-3)', fontSize: 14 }}>Loading…</div>
    )
  }

  if (notFound) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>Project not found</div>
        <Link to="/projects" style={{ color: 'var(--color-accent)', fontSize: 13, textDecoration: 'none' }}>
          ← Back to projects
        </Link>
      </div>
    )
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const status      = STATUS[project.status] || { label: project.status, color: '#6B7280', bg: 'rgba(107,114,128,0.1)' }
  const permitSt    = getPermitStatus(checklistItems)
  const typeLabel   = project.project_type === 'kit' ? 'Kit Only' : project.project_type === 'turnkey' ? 'Turnkey' : project.project_type
  const addrParts   = [project.site_address, project.site_city, project.site_county ? project.site_county + ' County' : null].filter(Boolean)
  const addressLine = addrParts.join(', ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Breadcrumb strip */}
      <div style={{
        padding: '10px 24px', flexShrink: 0,
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}>
        <Link
          to="/projects"
          style={{ fontSize: 13, color: 'var(--color-text-3)', textDecoration: 'none', fontWeight: 500 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
        >
          ← All projects
        </Link>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Header card */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 10, padding: '20px 24px', marginBottom: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            marginBottom: addressLine ? 4 : 18,
          }}>
            <h1 style={{
              margin: 0, fontSize: 20, fontWeight: 800,
              color: 'var(--color-text)', letterSpacing: '-0.3px', lineHeight: 1.2,
            }}>
              {project.name}
            </h1>
            <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
          </div>
          {addressLine && (
            <div style={{ fontSize: 13, color: 'var(--color-text-3)', marginBottom: 18 }}>
              {addressLine}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            <Metric label="Type"          value={typeLabel} />
            <Metric label="Contract"      value={fmtCurrency(project.contract_amount)} />
            <Metric label="Permit status" value={permitSt.label} color={permitSt.color} />
            <Metric label="Target close"  value={fmtDate(project.target_close_date)} />
          </div>
        </div>

        {/* Tab strip */}
        <div style={{
          display: 'flex', gap: 0,
          borderBottom: '2px solid var(--color-border)',
          marginBottom: 20,
        }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 18px',
                  background: 'none', border: 'none',
                  borderBottom: active ? '2px solid var(--red)' : '2px solid transparent',
                  marginBottom: '-2px',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--red)' : 'var(--color-text-3)',
                  cursor: 'pointer', transition: 'color 0.15s',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'hit_list'   && (
          <HitListTab
            projectId={id}
            items={hitList}
            onItemsChange={refetchHitList}
          />
        )}
        {activeTab === 'updates' && (
          <UpdatesTab
            projectId={id}
            updates={updates}
            onUpdatesChange={refetchUpdates}
          />
        )}
        {activeTab === 'checklist' && (
          <ChecklistTab
            items={checklistItems}
            onItemsChange={refetchChecklist}
          />
        )}
        {activeTab === 'permitting' && (
          <PermittingTab
            items={checklistItems}
            onItemsChange={refetchChecklist}
          />
        )}

      </div>
    </div>
  )
}
