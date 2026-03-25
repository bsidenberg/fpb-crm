import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { STAGES, TEMPERATURE } from '../lib/stages'
import { getFollowUpStatus } from '../lib/followup'
import KanbanBoard from '../components/KanbanBoard'
import AddLeadModal from '../components/AddLeadModal'
import ImportModal from '../components/ImportModal'

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '12px 16px',
      minWidth: 140,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--color-text-3)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '1px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 28, fontWeight: 700,
        color: color || 'var(--color-text)',
        marginTop: 4, lineHeight: 1,
        letterSpacing: '-0.5px',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function Board() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterTemp, setFilterTemp] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalStage, setModalStage] = useState('new')
  const [importOpen, setImportOpen] = useState(false)
  const [filterFollowUp, setFilterFollowUp] = useState('')

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error) setLeads(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const filtered = leads.filter(l => {
    if (filterStage && l.stage !== filterStage) return false
    if (filterTemp && l.priority !== filterTemp) return false
    if (filterFollowUp) {
      if (getFollowUpStatus(l.follow_up_date) !== filterFollowUp) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const match = [l.first_name, l.last_name, l.email, l.phone, l.company, l.city]
        .filter(Boolean).some(v => v.toLowerCase().includes(q))
      if (!match) return false
    }
    return true
  })

  const activeLeadsForFollowUp = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost')
  const followUpCounts = {
    overdue:  activeLeadsForFollowUp.filter(l => getFollowUpStatus(l.follow_up_date) === 'overdue').length,
    today:    activeLeadsForFollowUp.filter(l => getFollowUpStatus(l.follow_up_date) === 'today').length,
    upcoming: activeLeadsForFollowUp.filter(l => getFollowUpStatus(l.follow_up_date) === 'upcoming').length,
  }

  const handleAddLead = (stageId) => {
    setModalStage(stageId)
    setModalOpen(true)
  }

  // Stats — all derived from `leads` so they update whenever fetchLeads resolves
  const activeLeads  = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost')
  const wonLeads     = leads.filter(l => l.stage === 'won')
  const lostLeads    = leads.filter(l => l.stage === 'lost')
  const closedCount  = wonLeads.length + lostLeads.length

  // Pipeline value: only active (non-closed) leads
  const pipelineValue = activeLeads.reduce((s, l) => s + (Number(l.value) || 0), 0)

  // Closed Won value: separate from pipeline
  const wonValue = wonLeads.reduce((s, l) => s + (Number(l.value) || 0), 0)

  // Win rate: won / (won + lost) * 100 — 0% when no closed leads
  const winRate = closedCount > 0 ? Math.round((wonLeads.length / closedCount) * 100) : 0

  const overdueCount = leads.filter(l => {
    if (!l.follow_up_date || l.stage === 'won' || l.stage === 'lost') return false
    return new Date(l.follow_up_date) < new Date()
  }).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 0',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px' }}>
              Sales Pipeline
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {loading ? 'Loading...' : `${leads.length} total leads`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setImportOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                color: 'var(--color-text-2)', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-light)'; e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-2)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import CSV
            </button>
            <button
              onClick={() => handleAddLead('new')}
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
              Add Lead
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 14 }}>
          <StatCard label="Active Leads" value={activeLeads.length} />
          <StatCard
            label="Pipeline Value"
            value={'$' + pipelineValue.toLocaleString()}
            sub="active stages only"
            color="var(--color-navy)"
          />
          <StatCard
            label="Closed Won"
            value={wonLeads.length}
            sub={wonValue > 0 ? '$' + wonValue.toLocaleString() : undefined}
            color="var(--color-green)"
          />
          <StatCard
            label="Win Rate"
            value={`${winRate}%`}
            sub={closedCount > 0 ? `${wonLeads.length} won · ${lostLeads.length} lost` : 'no closed leads yet'}
          />
          {overdueCount > 0 && (
            <StatCard label="Overdue Follow-ups" value={overdueCount} color="#ef4444" />
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px 6px 28px',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text)', fontSize: 12,
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <select
            value={filterStage}
            onChange={e => setFilterStage(e.target.value)}
            style={{
              padding: '6px 10px', background: 'var(--surface-2)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: filterStage ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 12, cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">All stages</option>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <select
            value={filterTemp}
            onChange={e => setFilterTemp(e.target.value)}
            style={{
              padding: '6px 10px', background: 'var(--surface-2)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: filterTemp ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 12, cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">All temps</option>
            {TEMPERATURE.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>

          <select
            value={filterFollowUp}
            onChange={e => setFilterFollowUp(e.target.value)}
            style={{
              padding: '6px 10px', background: 'var(--surface-2)',
              border: `1px solid ${filterFollowUp ? (filterFollowUp === 'overdue' ? '#EF4444' : filterFollowUp === 'today' ? '#D4872A' : 'var(--border)') : 'var(--border)'}`,
              borderRadius: 6,
              color: filterFollowUp ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 12, cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">Follow-Ups</option>
            <option value="overdue">Overdue{followUpCounts.overdue > 0 ? ` (${followUpCounts.overdue})` : ''}</option>
            <option value="today">Due Today{followUpCounts.today > 0 ? ` (${followUpCounts.today})` : ''}</option>
            <option value="upcoming">Upcoming (7d){followUpCounts.upcoming > 0 ? ` (${followUpCounts.upcoming})` : ''}</option>
          </select>

          {(search || filterStage || filterTemp || filterFollowUp) && (
            <button
              onClick={() => { setSearch(''); setFilterStage(''); setFilterTemp(''); setFilterFollowUp('') }}
              style={{
                padding: '6px 10px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
          Loading pipeline...
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', paddingTop: 16 }}>
          <KanbanBoard
            leads={filtered}
            onLeadsChange={fetchLeads}
            onAddLead={handleAddLead}
          />
        </div>
      )}

      <AddLeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchLeads}
        defaultStage={modalStage}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={fetchLeads}
      />
    </div>
  )
}
