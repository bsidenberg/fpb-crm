import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const EMPTY = {
  name: '',
  project_type: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  site_address: '',
  site_city: '',
  site_county: '',
  building_size: '',
  contract_amount: '',
  target_close_date: '',
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

const g2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }

function Field({ label, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={lbl}>
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, step }) {
  return (
    <input
      type={type} value={value} step={step}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={fi}
      onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
    />
  )
}

export default function NewProjectModal({ isOpen, onClose, onCreated, prefill = null }) {
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [insertErr, setInsertErr] = useState(null)
  const [validErr, setValidErr]   = useState(null)

  // Reset form when modal opens; populate from prefill if provided
  useEffect(() => {
    if (isOpen) {
      setForm(prefill ? {
        ...EMPTY,
        name:            prefill.name            ?? '',
        project_type:    prefill.project_type    ?? '',
        customer_name:   prefill.customer_name   ?? '',
        customer_email:  prefill.customer_email  ?? '',
        customer_phone:  prefill.customer_phone  ?? '',
        site_address:    prefill.site_address    ?? '',
        site_city:       prefill.site_city       ?? '',
        site_county:     prefill.site_county     ?? '',
        building_size:   prefill.building_size   ?? '',
        contract_amount: prefill.contract_amount != null ? String(prefill.contract_amount) : '',
        notes:           prefill.notes           ?? '',
      } : EMPTY)
      setSaving(false)
      setInsertErr(null)
      setValidErr(null)
    }
  }, [isOpen])

  // Escape key closes modal
  const handleKeyDown = useCallback(e => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  const set = key => val => setForm(prev => ({ ...prev, [key]: val }))

  const orNull = str => (str && str.trim() !== '') ? str.trim() : null

  const handleSubmit = async e => {
    e.preventDefault()
    setValidErr(null)
    setInsertErr(null)

    // Validation
    if (!form.name.trim() || !form.project_type) {
      setValidErr('Project name and type are required.')
      return
    }

    setSaving(true)

    const payload = {
      name:             form.name.trim(),
      project_type:     form.project_type,           // 'kit' | 'turnkey'
      customer_name:    orNull(form.customer_name),
      customer_email:   orNull(form.customer_email),
      customer_phone:   orNull(form.customer_phone),
      site_address:     orNull(form.site_address),
      site_city:        orNull(form.site_city),
      site_county:      orNull(form.site_county),
      building_size:    orNull(form.building_size),
      contract_amount:  form.contract_amount !== '' ? parseFloat(form.contract_amount) : null,
      target_close_date: orNull(form.target_close_date),
      notes:            orNull(form.notes),
    }
    if (prefill?.lead_id) payload.lead_id = prefill.lead_id

    const { data: newProject, error: insertError } = await supabase
      .from('projects')
      .insert(payload)
      .select()
      .single()

    if (insertError) {
      setSaving(false)
      setInsertErr(insertError.message)
      return
    }

    // Seed checklist — non-blocking; log errors but don't fail the flow
    const { error: seedError } = await supabase.rpc('seed_project_checklist', {
      p_project_id:   newProject.id,
      p_project_type: newProject.project_type,
    })
    if (seedError) {
      console.error('seed_project_checklist error:', seedError)
    }

    setSaving(false)
    onCreated(newProject)
    onClose()
  }

  if (!isOpen) return null

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
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            New Project
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-2)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 2px' }}
          >×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Insert error banner */}
            {insertErr && (
              <div style={{
                padding: '9px 12px',
                background: 'rgba(192,39,45,0.08)',
                border: '1px solid rgba(192,39,45,0.25)',
                borderRadius: 6,
                color: '#C0272D',
                fontSize: 12,
                fontWeight: 500,
              }}>
                {insertErr}
              </div>
            )}

            {/* Project name */}
            <Field label="Project Name" required>
              <Input
                value={form.name}
                onChange={set('name')}
                placeholder="e.g. Henderson 40×60 Turnkey"
              />
            </Field>

            {/* Project type — segmented control */}
            <Field label="Project Type" required>
              <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {[
                  { value: 'kit',     label: 'Kit Only' },
                  { value: 'turnkey', label: 'Turnkey'  },
                ].map((opt, i) => {
                  const active = form.project_type === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => set('project_type')(opt.value)}
                      style={{
                        flex: 1, padding: '8px 12px',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: 'none',
                        borderRight: i === 0 ? '1px solid var(--color-border)' : 'none',
                        background: active ? 'var(--color-accent)' : 'var(--input-bg)',
                        color: active ? '#fff' : 'var(--color-text-2)',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            {/* Customer info */}
            <Field label="Customer Name">
              <Input value={form.customer_name} onChange={set('customer_name')} placeholder="Jane Henderson" />
            </Field>

            <div style={g2}>
              <Field label="Customer Email">
                <Input type="email" value={form.customer_email} onChange={set('customer_email')} placeholder="jane@example.com" />
              </Field>
              <Field label="Customer Phone">
                <Input type="tel" value={form.customer_phone} onChange={set('customer_phone')} placeholder="(352) 555-0100" />
              </Field>
            </div>

            {/* Site info */}
            <Field label="Site Address">
              <Input value={form.site_address} onChange={set('site_address')} placeholder="123 Farm Rd" />
            </Field>

            <div style={g2}>
              <Field label="Site City">
                <Input value={form.site_city} onChange={set('site_city')} placeholder="Clermont" />
              </Field>
              <Field label="Site County">
                <Input value={form.site_county} onChange={set('site_county')} placeholder="e.g. Lake" />
              </Field>
            </div>

            {/* Deal info */}
            <div style={g2}>
              <Field label="Building Size">
                <Input value={form.building_size} onChange={set('building_size')} placeholder="e.g. 40×60" />
              </Field>
              <Field label="Contract Amount ($)">
                <Input type="number" step="0.01" value={form.contract_amount} onChange={set('contract_amount')} placeholder="48200" />
              </Field>
            </div>

            <Field label="Target Close Date">
              <Input type="date" value={form.target_close_date} onChange={set('target_close_date')} />
            </Field>

            {/* Notes */}
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={e => set('notes')(e.target.value)}
                placeholder="Any initial notes about this project…"
                rows={3}
                style={{ ...fi, resize: 'vertical', lineHeight: 1.5 }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
            </Field>

          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            background: 'var(--color-surface)', flexShrink: 0,
          }}>
            {validErr && (
              <span style={{ flex: 1, fontSize: 12, color: '#C0272D', fontWeight: 500 }}>
                {validErr}
              </span>
            )}
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
              {saving ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
