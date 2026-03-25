import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { STAGES, TEMPERATURE, TAGS } from '../lib/stages'

// ─── Brand colors ────────────────────────────────────────────────
const RED    = '#C0272D'
const NAVY   = '#2B3A6B'
const GREEN  = '#16A34A'
const AMBER  = '#D97706'
const GRAY   = '#6B7280'
const PURPLE = '#7C3AED'

const STAGE_COLOR = Object.fromEntries(STAGES.map(s => [s.id, s.color]))

const TEMP_COLOR = { hot: RED, warm: AMBER, cold: GRAY }
const TEMP_LABEL = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }

// ─── Date range helpers ───────────────────────────────────────────
const RANGES = [
  { id: '30d',  label: 'Last 30 days' },
  { id: '90d',  label: 'Last 90 days' },
  { id: 'ytd',  label: 'This Year'    },
  { id: 'all',  label: 'All Time'     },
]

function getRangeStart(rangeId) {
  const now = new Date()
  if (rangeId === '30d') return new Date(now - 30 * 86400000).toISOString()
  if (rangeId === '90d') return new Date(now - 90 * 86400000).toISOString()
  if (rangeId === 'ytd') return new Date(now.getFullYear(), 0, 1).toISOString()
  return null // all time
}

// ─── Tooltip component ────────────────────────────────────────────
function BrandTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '1px solid #D1D5DB',
      borderRadius: 8, padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      fontSize: 13,
    }}>
      {label && <div style={{ fontWeight: 600, color: '#3A3A3A', marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#374151', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0, display: 'inline-block' }} />
          <span>{p.name ? `${p.name}: ` : ''}{prefix}{Number(p.value).toLocaleString()}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────
function Skeleton({ h = 200 }) {
  return (
    <div style={{
      height: h, borderRadius: 8,
      background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  )
}

// ─── Chart card wrapper ───────────────────────────────────────────
function ChartCard({ title, children, loading, empty }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #D1D5DB', borderRadius: 10,
      padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: '#6B7280', marginBottom: 16,
      }}>
        {title}
      </div>
      {loading ? <Skeleton /> : empty ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 13 }}>
          No data yet
        </div>
      ) : children}
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8,
      padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#6B7280', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: color || '#3A3A3A', letterSpacing: '-0.5px', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

// ─── Leads over time bucketing ────────────────────────────────────
function bucketByTime(leads, rangeId) {
  if (!leads.length) return []

  const sorted = [...leads].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const useWeeks = rangeId === '30d' || rangeId === '90d'

  const buckets = {}
  for (const lead of sorted) {
    const d = new Date(lead.created_at)
    let key
    if (useWeeks) {
      // ISO week label: "Mar 3"
      const monday = new Date(d)
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      key = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } else {
      key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }
    buckets[key] = (buckets[key] || 0) + 1
  }

  return Object.entries(buckets).map(([label, count]) => ({ label, count }))
}

// ─── Main component ───────────────────────────────────────────────
export default function Analytics() {
  const [range, setRange]   = useState('90d')
  const [leads, setLeads]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const start = getRangeStart(range)
      let query = supabase.from('leads').select('*')
      if (start) query = query.gte('created_at', start)
      const { data } = await query.order('created_at', { ascending: true })
      setLeads(data || [])
      setLoading(false)
    }
    load()
  }, [range])

  // ── Derived stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost')
    const won    = leads.filter(l => l.stage === 'won')
    const lost   = leads.filter(l => l.stage === 'lost')
    const closed = won.length + lost.length
    const pipelineValue = active.reduce((s, l) => s + (Number(l.value) || 0), 0)
    const wonValue      = won.reduce((s, l) => s + (Number(l.value) || 0), 0)
    const winRate       = closed > 0 ? Math.round((won.length / closed) * 100) : 0
    return { total: leads.length, pipelineValue, wonValue, winRate, won, lost, active }
  }, [leads])

  // ── Leads by source ────────────────────────────────────────────
  const bySource = useMemo(() => {
    const counts = {}
    for (const l of leads) {
      const src = l.source || 'Unknown'
      counts[src] = (counts[src] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count }))
  }, [leads])

  // ── Pipeline by stage ──────────────────────────────────────────
  const byStage = useMemo(() => {
    return STAGES.map(s => ({
      stage: s.label,
      count: leads.filter(l => l.stage === s.id).length,
      value: leads.filter(l => l.stage === s.id).reduce((sum, l) => sum + (Number(l.value) || 0), 0),
      color: s.color,
    })).filter(s => s.count > 0)
  }, [leads])

  // ── Leads over time ────────────────────────────────────────────
  const overTime = useMemo(() => bucketByTime(leads, range), [leads, range])

  // ── Deal outcomes (pie) ────────────────────────────────────────
  const outcomes = useMemo(() => {
    const data = [
      { name: 'Active',      value: stats.active.length, color: NAVY  },
      { name: 'Closed Won',  value: stats.won.length,    color: GREEN  },
      { name: 'Closed Lost', value: stats.lost.length,   color: RED    },
    ].filter(d => d.value > 0)
    return data
  }, [stats])

  // ── Temperature breakdown ──────────────────────────────────────
  const byTemp = useMemo(() => {
    return TEMPERATURE.map(t => ({
      label: t.label,
      count: leads.filter(l => l.priority === t.id).length,
      color: TEMP_COLOR[t.id],
    })).filter(t => t.count > 0)
  }, [leads])

  // ── Top tags ───────────────────────────────────────────────────
  const byTag = useMemo(() => {
    const counts = {}
    for (const l of leads) {
      const tags = Array.isArray(l.tags) ? l.tags : []
      for (const tag of tags) counts[tag] = (counts[tag] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }))
  }, [leads])

  // ── Custom pie label ───────────────────────────────────────────
  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
        {`${Math.round(percent * 100)}%`}
      </text>
    )
  }

  const chartAxisStyle = { fontSize: 11, fill: '#9CA3AF', fontFamily: 'Inter, sans-serif' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid #D1D5DB',
        background: '#fff',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#3A3A3A', letterSpacing: '-0.4px' }}>
            Analytics
          </h1>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
            {loading ? 'Loading...' : `${leads.length} leads in range`}
          </div>
        </div>

        {/* Date range selector */}
        <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', padding: 4, borderRadius: 8 }}>
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 500,
                borderRadius: 6, border: 'none', cursor: 'pointer',
                transition: 'all 0.15s',
                background: range === r.id ? '#fff' : 'transparent',
                color: range === r.id ? '#3A3A3A' : '#6B7280',
                boxShadow: range === r.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

        {/* ── Top stats row ──────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatCard
            label="Total Leads"
            value={loading ? '—' : stats.total.toLocaleString()}
          />
          <StatCard
            label="Pipeline Value"
            value={loading ? '—' : '$' + stats.pipelineValue.toLocaleString()}
            sub="active stages only"
            color={NAVY}
          />
          <StatCard
            label="Closed Won Value"
            value={loading ? '—' : '$' + stats.wonValue.toLocaleString()}
            sub={`${stats.won.length} deals`}
            color={GREEN}
          />
          <StatCard
            label="Win Rate"
            value={loading ? '—' : `${stats.winRate}%`}
            sub={stats.won.length + stats.lost.length > 0
              ? `${stats.won.length} won · ${stats.lost.length} lost`
              : 'no closed deals yet'}
            color={stats.winRate >= 50 ? GREEN : stats.winRate > 0 ? AMBER : '#9CA3AF'}
          />
        </div>

        {/* ── Charts grid ────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
          gap: 16,
        }}>

          {/* 1. Leads by Source */}
          <ChartCard title="Leads by Source" loading={loading} empty={!loading && bySource.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bySource} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="source" tick={chartAxisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={chartAxisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<BrandTooltip />} cursor={{ fill: '#F9FAFB' }} />
                <Bar dataKey="count" name="Leads" fill={RED} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 2. Pipeline by Stage */}
          <ChartCard title="Pipeline by Stage" loading={loading} empty={!loading && byStage.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byStage} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis type="number" tick={chartAxisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="stage" type="category" tick={chartAxisStyle} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const item = byStage.find(s => s.stage === label)
                    return (
                      <div style={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 13 }}>
                        <div style={{ fontWeight: 700, color: '#3A3A3A', marginBottom: 4 }}>{label}</div>
                        <div style={{ color: '#374151' }}>{payload[0].value} leads</div>
                        {item?.value > 0 && <div style={{ color: GREEN, fontWeight: 600 }}>${item.value.toLocaleString()}</div>}
                      </div>
                    )
                  }}
                  cursor={{ fill: '#F9FAFB' }}
                />
                <Bar dataKey="count" name="Leads" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {byStage.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 3. Leads Over Time */}
          <ChartCard title="New Leads Over Time" loading={loading} empty={!loading && overTime.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={overTime} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" tick={chartAxisStyle} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={chartAxisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<BrandTooltip />} cursor={{ stroke: '#D1D5DB' }} />
                <Line
                  type="monotone" dataKey="count" name="New Leads"
                  stroke={NAVY} strokeWidth={2.5}
                  dot={{ fill: NAVY, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: NAVY }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 4. Deal Outcomes (Donut) */}
          <ChartCard title="Deal Outcomes" loading={loading} empty={!loading && outcomes.length === 0}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 220 }}>
              <ResponsiveContainer width="55%" height={220}>
                <PieChart>
                  <Pie
                    data={outcomes} cx="50%" cy="50%"
                    innerRadius={60} outerRadius={90}
                    paddingAngle={2} dataKey="value"
                    labelLine={false} label={renderPieLabel}
                  >
                    {outcomes.map((o, i) => <Cell key={i} fill={o.color} />)}
                  </Pie>
                  <Tooltip content={<BrandTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {/* Center total */}
                <div style={{ marginBottom: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#3A3A3A', letterSpacing: '-0.5px', lineHeight: 1 }}>
                    {stats.total}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
                    Total Leads
                  </div>
                </div>
                {outcomes.map((o, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: o.color, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontSize: 12, color: '#374151' }}>{o.name}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: o.color }}>{o.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </ChartCard>

          {/* 5. Lead Temperature */}
          <ChartCard title="Lead Temperature" loading={loading} empty={!loading && byTemp.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byTemp} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" tick={chartAxisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={chartAxisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<BrandTooltip />} cursor={{ fill: '#F9FAFB' }} />
                <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  {byTemp.map((t, i) => <Cell key={i} fill={t.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 6. Top Tags */}
          <ChartCard title="Leads by Type" loading={loading} empty={!loading && byTag.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byTag} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis type="number" tick={chartAxisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="tag" type="category" tick={chartAxisStyle} axisLine={false} tickLine={false} width={80} />
                <Tooltip content={<BrandTooltip />} cursor={{ fill: '#F9FAFB' }} />
                <Bar dataKey="count" name="Leads" fill={PURPLE} radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>

        {/* Bottom padding */}
        <div style={{ height: 24 }} />
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}
