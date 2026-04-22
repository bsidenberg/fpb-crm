import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { geocodeLead } from '../lib/geocode'
import { STAGES, LEAD_SOURCES, BARN_SIZES, TEMPERATURE, TAGS, ACTIVITY_TYPES } from '../lib/stages'

const EMPTY = {
  first_name: '', last_name: '', email: '', phone: '',
  company: '', address: '', city: '', zip: '',
  source: '', stage: 'new',
  value: '', barn_size: '', service_type: '',
  follow_up_date: '', priority: 'warm',
  tags: [],
  notes: '',
}

const fi = {
  width: '100%', padding: '7px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
}

const lbl = {
  display: 'block', fontSize: 10, fontWeight: 500,
  color: 'var(--color-text-2)', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.5px',
}

function Field({ label, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={lbl}>
        {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder }) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={fi}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    />
  )
}

function Sel({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{ ...fi, appearance: 'none', cursor: 'pointer' }}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    >
      <option value="">{placeholder || 'Select...'}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  )
}

const g2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }

export default function AddLeadModal({ open, onClose, onSaved, defaultStage }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [noteType, setNoteType] = useState('note')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, stage: defaultStage || 'new' })
      setNoteType('note')
    }
  }, [open, defaultStage])

  const set = key => val => setForm(prev => ({ ...prev, [key]: val }))

  const toggleTag = tag => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }))
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast('First and last name are required', 'error')
      return
    }
    setSaving(true)
    const { notes, ...rest } = form
    const payload = {
      ...rest,
      value: form.value ? Number(form.value) : null,
      follow_up_date: form.follow_up_date || null,
    }
    const { data, error } = await supabase.from('leads').insert([payload]).select().single()
    if (error) {
      setSaving(false)
      toast('Failed to save lead: ' + error.message, 'error')
      return
    }
    if (notes.trim() && data?.id) {
      await supabase.from('activities').insert([{
        lead_id: data.id,
        type: noteType,
        body: notes.trim(),
        author: 'Brian',
      }])
    }
    // Fire-and-forget background geocode (only if there's address data to geocode)
    if ((form.address || form.city || form.zip) && data?.id) {
      geocodeLead({ address: form.address, city: form.city, zip: form.zip })
        .then(result => {
          if (result) {
            supabase.from('leads').update({
              latitude:    result.latitude,
              longitude:   result.longitude,
              geocoded_at: new Date().toISOString(),
            }).eq('id', data.id).then(() => { /* silent */ })
          }
        })
        .catch(err => console.warn('[geocode] background geocode failed:', err))
    }
    setSaving(false)
    toast(`${form.first_name} ${form.last_name} added!`)
    onSaved?.()
    onClose()
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(26,36,68,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        width: '100%', maxWidth: 600,
        maxHeight: '92vh',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp 0.2s ease',
        boxShadow: '0 20px 48px rgba(26,36,68,0.18), 0 4px 16px rgba(0,0,0,0.08)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 20px', borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>Add New Lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-2)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={g2}>
              <Field label="First Name" required><Input value={form.first_name} onChange={set('first_name')} placeholder="John" /></Field>
              <Field label="Last Name" required><Input value={form.last_name} onChange={set('last_name')} placeholder="Smith" /></Field>
            </div>

            <div style={g2}>
              <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} placeholder="john@example.com" /></Field>
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} placeholder="(352) 555-0100" /></Field>
            </div>

            <Field label="Company"><Input value={form.company} onChange={set('company')} placeholder="Smith Farms LLC" /></Field>

            <Field label="Address"><Input value={form.address} onChange={set('address')} placeholder="123 County Rd" /></Field>

            <div style={g2}>
              <Field label="City"><Input value={form.city} onChange={set('city')} placeholder="Clermont" /></Field>
              <Field label="Zip"><Input value={form.zip} onChange={set('zip')} placeholder="34711" /></Field>
            </div>

            <div style={g2}>
              <Field label="Lead Source"><Sel value={form.source} onChange={set('source')} options={LEAD_SOURCES} /></Field>
              <Field label="Pipeline Stage">
                <Sel value={form.stage} onChange={set('stage')} options={STAGES.map(s => ({ value: s.id, label: s.label }))} />
              </Field>
            </div>

            <div style={g2}>
              <Field label="Est. Value ($)"><Input type="number" value={form.value} onChange={set('value')} placeholder="18500" /></Field>
              <Field label="Barn Size"><Sel value={form.barn_size} onChange={set('barn_size')} options={BARN_SIZES} /></Field>
            </div>

            <div style={g2}>
              <Field label="Service Type">
                <Sel value={form.service_type} onChange={set('service_type')} options={['Kit Delivery Only', 'Kit + Installation']} placeholder="Select type" />
              </Field>
              <div />
            </div>

            <div style={g2}>
              <Field label="Follow-Up Date"><Input type="date" value={form.follow_up_date} onChange={set('follow_up_date')} /></Field>
              <Field label="Priority">
                <div style={{ display: 'flex', gap: 6 }}>
                  {TEMPERATURE.map(t => (
                    <button
                      key={t.id} type="button" onClick={() => set('priority')(t.id)}
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
              </Field>
            </div>

            <Field label="Tags">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
                {TAGS.map(tag => {
                  const active = form.tags.includes(tag)
                  return (
                    <button
                      key={tag} type="button" onClick={() => toggleTag(tag)}
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
            </Field>

            <div>
              <label style={lbl}>Initial Note</label>
              <div style={{ display: 'flex', marginBottom: 8, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {ACTIVITY_TYPES.map((t, i) => (
                  <button
                    key={t.id} type="button" onClick={() => setNoteType(t.id)}
                    style={{
                      flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', border: 'none',
                      borderRight: i < ACTIVITY_TYPES.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: noteType === t.id ? `${t.color}20` : 'var(--input-bg)',
                      color: noteType === t.id ? t.color : 'var(--color-text-2)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={form.notes}
                onChange={e => set('notes')(e.target.value)}
                placeholder={`Log a ${ACTIVITY_TYPES.find(t => t.id === noteType)?.label.toLowerCase()}...`}
                rows={3}
                style={{ ...fi, resize: 'vertical', lineHeight: 1.5 }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
            </div>

          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            background: 'var(--color-surface)',
          }}>
            <button
              type="button" onClick={onClose}
              style={{
                padding: '8px 16px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--color-border)',
                color: 'var(--color-text-2)', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              style={{
                padding: '8px 22px', borderRadius: 6,
                background: saving ? 'var(--color-border)' : 'var(--color-accent)',
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--color-accent-hover)' }}
              onMouseLeave={e => { if (!saving) e.currentTarget.style.background = 'var(--color-accent)' }}
            >
              {saving ? 'Saving...' : 'Add Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
