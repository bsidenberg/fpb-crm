import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { STAGES, STAGE_MAP, LEAD_SOURCES, BARN_SIZES, TEMPERATURE, TAGS, ACTIVITY_TYPES } from '../lib/stages'

const TEMP_MAP = Object.fromEntries(TEMPERATURE.map(t => [t.id, t]))

const inputStyle = {
  width: '100%', padding: '7px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s',
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', width: 120, flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{children}</div>
    </div>
  )
}

function ActivityIcon({ type }) {
  const aType = ACTIVITY_TYPES.find(t => t.id === type) || ACTIVITY_TYPES[0]
  const stroke = aType.color
  const s = { width: 12, height: 12, flexShrink: 0 }
  if (type === 'call') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.07-8.67A2 2 0 015.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L9.91 9.91a16 16 0 005.18 5.18l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
  if (type === 'email') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
  if (type === 'follow_up') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
  // note (default)
  return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState('note')
  const [noteAuthor, setNoteAuthor] = useState('Brian')
  const [activities, setActivities] = useState([])
  const [addingNote, setAddingNote] = useState(false)

  useEffect(() => {
    fetchLead()
    fetchActivities()
  }, [id])

  const fetchLead = async () => {
    const { data, error } = await supabase.from('leads').select('*').eq('id', id).single()
    if (error || !data) { navigate('/'); return }
    setLead(data)
    setForm(data)
    setLoading(false)
  }

  const fetchActivities = async () => {
    const { data } = await supabase
      .from('activities')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
    setActivities(data || [])
  }

  const set = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase.from('leads').update({ ...form }).eq('id', id)
    setSaving(false)
    if (error) { toast('Save failed: ' + error.message, 'error'); return }
    toast('Lead updated')
    setLead(form)
    setEditing(false)
  }

  const handleStageChange = async (newStage) => {
    const prevStage = lead.stage
    setLead(l => ({ ...l, stage: newStage }))
    const { error } = await supabase.from('leads').update({ stage: newStage }).eq('id', id)
    if (error) {
      setLead(l => ({ ...l, stage: prevStage }))
      toast('Stage update failed', 'error')
    } else {
      toast(`Stage → ${STAGE_MAP[newStage]?.label}`)
    }
  }

  const handleAddNote = async () => {
    if (!note.trim()) return
    setAddingNote(true)
    const author = noteAuthor.trim() || 'Brian'
    const body = note.trim()

    // Optimistic: add immediately at top
    const optimistic = {
      id: `tmp_${Date.now()}`,
      lead_id: String(id),
      type: noteType,
      body,
      author,
      created_at: new Date().toISOString(),
    }
    setActivities(prev => [optimistic, ...prev])
    setNote('')

    const { error } = await supabase.from('activities').insert([{
      lead_id: String(id),
      type: noteType,
      body,
      author,
    }])
    if (error) console.error('Activity insert error:', JSON.stringify(error, null, 2))
    setAddingNote(false)
    if (error) {
      setActivities(prev => prev.filter(a => a.id !== optimistic.id))
      setNote(body)
      toast('Failed to save entry', 'error')
      return
    }
    toast('Entry logged')
    fetchActivities()
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${lead.first_name} ${lead.last_name}? This cannot be undone.`)) return
    await supabase.from('activities').delete().eq('lead_id', id)
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) { toast('Delete failed', 'error'); return }
    toast(`${lead.first_name} deleted`)
    navigate('/')
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  const stage = STAGE_MAP[lead.stage]
  const temp = TEMP_MAP[lead.priority] || TEMP_MAP.warm

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, padding: '0 4px', lineHeight: 1 }}
          >
            ←
          </button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>
              {lead.first_name} {lead.last_name}
            </div>
            {lead.company && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.company}</div>
            )}
          </div>
          {stage && (
            <div style={{
              fontSize: 11, fontWeight: 700,
              color: stage.color, background: stage.bg,
              padding: '3px 8px', borderRadius: 5, letterSpacing: '0.3px',
            }}>
              {stage.label}
            </div>
          )}
          <div style={{
            fontSize: 10, fontWeight: 700,
            color: temp.textColor, background: temp.bgColor,
            padding: '2px 7px', borderRadius: 5,
            letterSpacing: '0.5px', textTransform: 'uppercase',
          }}>
            {temp.label}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button
                onClick={() => { setEditing(false); setForm(lead) }}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '7px 16px', borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                style={{ padding: '7px 14px', borderRadius: 6, background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left — lead info */}
        <div style={{ flex: 1, padding: 24, borderRight: '1px solid var(--border)', overflowY: 'auto', minWidth: 0 }}>
          {editing ? (
            <EditForm form={form} set={set} />
          ) : (
            <ViewInfo lead={lead} onStageChange={handleStageChange} />
          )}
        </div>

        {/* Right — activity feed */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-surface-2)' }}>
          {/* Log entry form */}
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 10 }}>
              Log Activity
            </div>

            {/* Type tabs */}
            <div style={{ display: 'flex', marginBottom: 8, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {ACTIVITY_TYPES.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setNoteType(t.id)}
                  style={{
                    flex: 1, padding: '6px 4px', fontSize: 10, fontWeight: 700,
                    cursor: 'pointer', border: 'none',
                    borderRight: i < ACTIVITY_TYPES.length - 1 ? '1px solid var(--border)' : 'none',
                    background: noteType === t.id ? `${t.color}20` : 'var(--surface-2)',
                    color: noteType === t.id ? t.color : 'var(--text-muted)',
                    transition: 'all 0.15s', letterSpacing: '0.3px', textTransform: 'uppercase',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={`Log a ${ACTIVITY_TYPES.find(t => t.id === noteType)?.label.toLowerCase()}...`}
              rows={4}
              style={{
                ...inputStyle, resize: 'none', lineHeight: 1.5, marginBottom: 8,
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />

            {/* Author */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, width: 44 }}>Author</div>
              <input
                type="text"
                value={noteAuthor}
                onChange={e => setNoteAuthor(e.target.value)}
                placeholder="Brian"
                style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <button
              onClick={handleAddNote}
              disabled={!note.trim() || addingNote}
              style={{
                width: '100%', padding: '8px',
                background: note.trim() ? 'var(--color-accent)' : 'var(--color-surface)',
                border: 'none', borderRadius: 6,
                color: note.trim() ? '#fff' : 'var(--color-text-2)',
                fontSize: 12, fontWeight: 700,
                cursor: note.trim() ? 'pointer' : 'default',
                transition: 'all 0.15s', letterSpacing: '0.3px',
              }}
            >
              {addingNote ? 'Saving...' : 'Log Entry'}
            </button>
          </div>

          {/* Timeline */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              {activities.length} {activities.length === 1 ? 'Entry' : 'Entries'}
            </div>

            {activities.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 24 }}>
                No activity logged yet
              </div>
            ) : (
              activities.map(a => {
                const aType = ACTIVITY_TYPES.find(t => t.id === a.type) || ACTIVITY_TYPES[0]
                return (
                  <div key={a.id} style={{
                    borderLeft: `3px solid ${aType.color}`,
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderLeftWidth: 3,
                    borderRadius: '0 6px 6px 0',
                    padding: '10px 12px',
                    marginBottom: 10,
                    animation: 'fadeIn 0.2s ease',
                  }}>
                    {/* Header: icon + badge + author */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ActivityIcon type={a.type} />
                        <span style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: '0.5px',
                          textTransform: 'uppercase', color: aType.color,
                          background: `${aType.color}18`, padding: '1px 5px', borderRadius: 3,
                        }}>
                          {aType.label}
                        </span>
                        {a.author && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                            {a.author}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Body */}
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {a.body}
                    </div>
                    {/* Timestamp */}
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                      {a.created_at ? format(parseISO(a.created_at), "MMM d, yyyy '·' h:mm a") : ''}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const dash = <span style={{ color: 'var(--text-muted)' }}>—</span>

function ViewInfo({ lead, onStageChange }) {
  const stage = STAGE_MAP[lead.stage]
  const temp = TEMP_MAP[lead.priority] || TEMP_MAP.warm
  const tags = Array.isArray(lead.tags) ? lead.tags : []

  return (
    <>
      <Section title="Contact">
        <InfoRow label="Email">
          {lead.email
            ? <a href={`mailto:${lead.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >{lead.email}</a>
            : dash}
        </InfoRow>
        <InfoRow label="Phone">
          {lead.phone
            ? <a href={`tel:${lead.phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >{lead.phone}</a>
            : dash}
        </InfoRow>
        <InfoRow label="Company">{lead.company || dash}</InfoRow>
        <InfoRow label="Address">{lead.address || dash}</InfoRow>
        <InfoRow label="City / Zip">
          {(lead.city || lead.zip) ? [lead.city, lead.zip].filter(Boolean).join(', ') : dash}
        </InfoRow>
      </Section>

      <Section title="Deal">
        <InfoRow label="Stage">
          <select
            value={lead.stage || ''}
            onChange={e => onStageChange(e.target.value)}
            style={{
              padding: '4px 10px',
              background: stage?.bg || 'var(--surface-2)',
              border: `1px solid ${stage?.color || 'var(--border)'}`,
              borderRadius: 6,
              color: stage?.color || 'var(--text)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none',
            }}
          >
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </InfoRow>
        <InfoRow label="Temperature">
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: temp.textColor, background: temp.bgColor,
            padding: '2px 9px', borderRadius: 20, display: 'inline-block',
            letterSpacing: '0.4px',
          }}>
            {temp.label}
          </span>
        </InfoRow>
        <InfoRow label="Est. Value">
          {lead.value
            ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>${Number(lead.value).toLocaleString()}</span>
            : dash}
        </InfoRow>
        <InfoRow label="Barn Size">{lead.barn_size || dash}</InfoRow>
        <InfoRow label="Lead Source">{lead.source || dash}</InfoRow>
        <InfoRow label="Follow-Up">
          {lead.follow_up_date ? format(parseISO(lead.follow_up_date), 'MMM d, yyyy') : dash}
        </InfoRow>
      </Section>

      <Section title="Tags">
        {tags.length > 0
          ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--color-accent)',
                  background: 'var(--color-accent-light)',
                  border: '1px solid rgba(192,57,43,0.3)',
                  padding: '3px 9px', borderRadius: 20,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )
          : dash}
      </Section>

      {lead.notes && (
        <Section title="Notes">
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {lead.notes}
          </div>
        </Section>
      )}

      <Section title="Meta">
        <InfoRow label="Created">
          {lead.created_at ? format(parseISO(lead.created_at), 'MMM d, yyyy') : dash}
        </InfoRow>
      </Section>
    </>
  )
}

function EditForm({ form, set }) {
  const fi = { ...inputStyle, marginBottom: 0 }

  const lbl = {
    display: 'block', fontSize: 10, fontWeight: 500,
    color: 'var(--color-text-2)', marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  }

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }
  const col = { display: 'flex', flexDirection: 'column', gap: 4 }

  const inp = (key, type = 'text', placeholder) => (
    <input
      type={type}
      value={form[key] || ''}
      onChange={e => set(key)(e.target.value)}
      placeholder={placeholder}
      style={fi}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    />
  )

  const sel = (key, options, placeholder) => (
    <select
      value={form[key] || ''}
      onChange={e => set(key)(e.target.value)}
      style={{ ...fi, appearance: 'none', cursor: 'pointer' }}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  )

  return (
    <div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>First Name</label>{inp('first_name', 'text', 'John')}</div>
        <div style={col}><label style={lbl}>Last Name</label>{inp('last_name', 'text', 'Smith')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Email</label>{inp('email', 'email')}</div>
        <div style={col}><label style={lbl}>Phone</label>{inp('phone', 'tel')}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}><label style={lbl}>Company</label>{inp('company')}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}><label style={lbl}>Address</label>{inp('address')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>City</label>{inp('city')}</div>
        <div style={col}><label style={lbl}>Zip</label>{inp('zip')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Lead Source</label>{sel('source', LEAD_SOURCES, 'Select source')}</div>
        <div style={col}><label style={lbl}>Stage</label>{sel('stage', STAGES.map(s => ({ value: s.id, label: s.label })), 'Select stage')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Est. Value ($)</label>{inp('value', 'number')}</div>
        <div style={col}><label style={lbl}>Barn Size</label>{sel('barn_size', BARN_SIZES, 'Select size')}</div>
      </div>
      <div style={grid2}>
        <div style={col}><label style={lbl}>Follow-Up Date</label>{inp('follow_up_date', 'date')}</div>
        <div style={col}>
          <label style={lbl}>Priority</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {TEMPERATURE.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => set('priority')(t.id)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${form.priority === t.id ? t.color : 'var(--color-border)'}`,
                  background: form.priority === t.id ? t.bgColor : 'var(--input-bg)',
                  color: form.priority === t.id ? t.textColor : 'var(--color-text-2)',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}>
          <label style={lbl}>Tags</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
            {TAGS.map(tag => {
              const currentTags = Array.isArray(form.tags) ? form.tags : []
              const active = currentTags.includes(tag)
              return (
                <button
                  key={tag} type="button"
                  onClick={() => set('tags')(
                    active ? currentTags.filter(t => t !== tag) : [...currentTags, tag]
                  )}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11,
                    fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-accent-light)' : 'var(--input-bg)',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-2)',
                    transition: 'all 0.15s',
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={col}>
          <label style={lbl}>Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={e => set('notes')(e.target.value)}
            rows={4}
            style={{ ...fi, resize: 'vertical', lineHeight: 1.5 }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>
      </div>
    </div>
  )
}
