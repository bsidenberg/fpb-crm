import { useState, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

// CRM fields we support importing
const CRM_FIELDS = [
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name',  label: 'Last Name',  required: true },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone' },
  { key: 'company',    label: 'Company' },
  { key: 'address',    label: 'Address' },
  { key: 'city',       label: 'City' },
  { key: 'zip',        label: 'Zip' },
  { key: 'source',     label: 'Lead Source' },
  { key: 'value',      label: 'Est. Value ($)' },
  { key: 'barn_size',  label: 'Barn Size' },
  { key: 'notes',      label: 'Notes' },
]

const CHUNK_SIZE = 50

// Normalize header strings for fuzzy matching
const norm = s => s.toLowerCase().replace(/[\s_\-]/g, '')

const ALIASES = {
  first_name: ['firstname', 'first', 'fname', 'givenname'],
  last_name:  ['lastname', 'last', 'lname', 'surname', 'familyname'],
  email:      ['email', 'emailaddress', 'email_address', 'mail'],
  phone:      ['phone', 'phonenumber', 'telephone', 'tel', 'mobile', 'cell', 'cellphone'],
  company:    ['company', 'business', 'org', 'organization', 'companyname', 'businessname'],
  address:    ['address', 'streetaddress', 'street', 'addr'],
  city:       ['city', 'town', 'municipality'],
  zip:        ['zip', 'zipcode', 'postalcode', 'postal'],
  source:     ['source', 'leadsource', 'channel', 'referral', 'origin'],
  value:      ['value', 'estimatedvalue', 'estvalue', 'amount', 'price', 'budget'],
  barn_size:  ['barnsize', 'size', 'buildingsize', 'dimensions'],
  notes:      ['notes', 'note', 'comments', 'comment', 'description', 'memo'],
}

function autoMap(headers) {
  const mapping = {}
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const match = headers.find(h => aliases.includes(norm(h)))
    if (match) mapping[field] = match
  }
  return mapping
}

function parseNumericValue(str) {
  if (!str) return null
  const n = Number(String(str).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

const sectionLabel = {
  fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)',
  textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8,
}

export default function ImportModal({ open, onClose, onSaved }) {
  const toast = useToast()
  const fileInputRef = useRef(null)

  const [step, setStep] = useState('upload')    // upload | mapping | importing | done
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)    // { headers, rows }
  const [mapping, setMapping] = useState({})
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [summary, setSummary] = useState(null)

  const reset = () => {
    setStep('upload')
    setDragging(false)
    setFileName('')
    setParsed(null)
    setMapping({})
    setProgress({ current: 0, total: 0 })
    setSummary(null)
  }

  const handleClose = () => { reset(); onClose() }

  const handleFile = useCallback((file) => {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) {
      toast('Please select a CSV file', 'error')
      return
    }
    setFileName(file.name)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || []
        const rows = result.data
        setParsed({ headers, rows })
        setMapping(autoMap(headers))
        setStep('mapping')
      },
      error: () => toast('Failed to parse CSV', 'error'),
    })
  }, [toast])

  // Drag & drop handlers
  const onDragOver  = e => { e.preventDefault(); setDragging(true) }
  const onDragLeave = e => { e.preventDefault(); setDragging(false) }
  const onDrop      = e => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const handleImport = async () => {
    setStep('importing')

    // Fetch all existing emails for duplicate detection
    const { data: existing } = await supabase.from('leads').select('email')
    const existingEmails = new Set(
      (existing || []).map(l => l.email?.toLowerCase()).filter(Boolean)
    )

    const getValue = (row, field) => {
      const col = mapping[field]
      return col ? String(row[col] ?? '').trim() : ''
    }

    // Build valid lead objects
    const toInsert = []
    let skippedNoName = 0
    let skippedDupe = 0

    for (const row of parsed.rows) {
      const firstName = getValue(row, 'first_name')
      if (!firstName) { skippedNoName++; continue }

      const email = getValue(row, 'email')
      if (email && existingEmails.has(email.toLowerCase())) { skippedDupe++; continue }

      toInsert.push({
        first_name: firstName,
        last_name:  getValue(row, 'last_name')  || null,
        email:      email                        || null,
        phone:      getValue(row, 'phone')       || null,
        company:    getValue(row, 'company')     || null,
        address:    getValue(row, 'address')     || null,
        city:       getValue(row, 'city')        || null,
        zip:        getValue(row, 'zip')         || null,
        source:     getValue(row, 'source')      || null,
        value:      parseNumericValue(getValue(row, 'value')),
        barn_size:  getValue(row, 'barn_size')   || null,
        notes:      getValue(row, 'notes')       || null,
        stage:    'new',
        priority: 'cold',
      })
    }

    // Batch insert in chunks of 50
    setProgress({ current: 0, total: toInsert.length })
    let imported = 0
    let errors = 0

    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE)
      const { error } = await supabase.from('leads').insert(chunk)
      if (error) {
        errors += chunk.length
        console.error('Batch insert error:', error)
      } else {
        imported += chunk.length
      }
      setProgress({ current: Math.min(i + CHUNK_SIZE, toInsert.length), total: toInsert.length })
    }

    const finalSummary = { imported, skippedDupe, skippedNoName, errors }
    setSummary(finalSummary)
    setStep('done')
    if (imported > 0) {
      toast(`${imported} lead${imported !== 1 ? 's' : ''} imported`)
      onSaved?.()
    }
  }

  if (!open) return null

  const progressPct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && step !== 'importing' && handleClose()}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        width: '100%', maxWidth: 680,
        maxHeight: '92vh',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp 0.2s ease',
        boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 20px', borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
              Import CSV
            </div>
            {parsed && step !== 'upload' && (
              <div style={{ fontSize: 11, color: 'var(--color-text-3)', marginTop: 1 }}>
                {fileName} · {parsed.rows.length} rows detected
              </div>
            )}
          </div>
          {step !== 'importing' && (
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-2)', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── STEP: UPLOAD ── */}
          {step === 'upload' && (
            <div style={{ padding: 32 }}>
              <div
                onDragOver={onDragOver}
                onDragEnter={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  borderRadius: 10,
                  padding: '48px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragging ? 'var(--color-accent-light)' : 'var(--color-surface-2)',
                  transition: 'all 0.15s',
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                  stroke={dragging ? 'var(--color-accent)' : 'var(--color-text-3)'}
                  strokeWidth={1.5} style={{ marginBottom: 12 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 600, color: dragging ? 'var(--color-accent)' : 'var(--color-text)', marginBottom: 6 }}>
                  {dragging ? 'Drop to import' : 'Drop your CSV here'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                  or click to browse
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
              <div style={{ fontSize: 11, color: 'var(--color-text-3)', textAlign: 'center', marginTop: 16 }}>
                Accepted: CSV files. Required columns: first_name, last_name.
              </div>
            </div>
          )}

          {/* ── STEP: MAPPING ── */}
          {step === 'mapping' && parsed && (
            <div style={{ padding: '20px 20px 0' }}>
              {/* Preview table */}
              <div style={{ marginBottom: 20 }}>
                <div style={sectionLabel}>Preview — first {Math.min(5, parsed.rows.length)} of {parsed.rows.length} rows</div>
                <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        {parsed.headers.map(h => (
                          <th key={h} style={{
                            padding: '6px 10px', textAlign: 'left',
                            color: 'var(--color-text-3)', fontWeight: 600,
                            borderBottom: '1px solid var(--color-border)',
                            whiteSpace: 'nowrap',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          {parsed.headers.map(h => (
                            <td key={h} style={{
                              padding: '5px 10px', color: 'var(--color-text-2)',
                              maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Column mapping */}
              <div style={{ marginBottom: 20 }}>
                <div style={sectionLabel}>Map CSV columns to CRM fields</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                  {CRM_FIELDS.map(field => (
                    <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 500,
                        color: field.required ? 'var(--color-text)' : 'var(--color-text-2)',
                        width: 100, flexShrink: 0,
                      }}>
                        {field.label}
                        {field.required && <span style={{ color: 'var(--color-accent)', marginLeft: 2 }}>*</span>}
                      </div>
                      <select
                        value={mapping[field.key] || ''}
                        onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}
                        style={{
                          flex: 1, padding: '5px 8px',
                          background: 'var(--input-bg)',
                          border: `1px solid ${mapping[field.key] ? 'var(--color-border-light)' : 'var(--color-border)'}`,
                          borderRadius: 5, color: mapping[field.key] ? 'var(--color-text)' : 'var(--color-text-3)',
                          fontSize: 11, outline: 'none', cursor: 'pointer',
                        }}
                      >
                        <option value="">— skip —</option>
                        {parsed.headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP: IMPORTING ── */}
          {step === 'importing' && (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 24 }}>
                Importing leads...
              </div>
              {/* Progress bar */}
              <div style={{
                background: 'var(--color-surface-2)',
                borderRadius: 99, height: 8, overflow: 'hidden',
                marginBottom: 12,
              }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  background: 'var(--color-accent)',
                  width: `${progressPct}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                {progress.current} / {progress.total} leads processed ({progressPct}%)
              </div>
            </div>
          )}

          {/* ── STEP: DONE ── */}
          {step === 'done' && summary && (
            <div style={{ padding: 32 }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: summary.imported > 0 ? 'var(--color-green-dim)' : 'var(--color-accent-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                    stroke={summary.imported > 0 ? 'var(--color-green)' : 'var(--color-accent)'}
                    strokeWidth={2.5}>
                    {summary.imported > 0
                      ? <polyline points="20 6 9 17 4 12" />
                      : <><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>}
                  </svg>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
                  {summary.imported > 0 ? 'Import complete' : 'Nothing imported'}
                </div>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
                {[
                  { label: 'Imported',   value: summary.imported,      color: 'var(--color-green)' },
                  { label: 'Duplicates', value: summary.skippedDupe,   color: 'var(--color-gold)'  },
                  { label: 'No Name',    value: summary.skippedNoName, color: 'var(--color-text-3)' },
                  { label: 'Errors',     value: summary.errors,        color: summary.errors > 0 ? '#EF4444' : 'var(--color-text-3)' },
                ].map(s => (
                  <div key={s.label} style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8, padding: '12px 10px', textAlign: 'center',
                  }}>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: s.color, lineHeight: 1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-3)', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {(summary.skippedDupe > 0 || summary.skippedNoName > 0) && (
                <div style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6, padding: '10px 14px',
                  fontSize: 12, color: 'var(--color-text-2)', lineHeight: 1.7,
                }}>
                  {summary.skippedDupe > 0 && (
                    <div>· {summary.skippedDupe} row{summary.skippedDupe !== 1 ? 's' : ''} skipped — email already exists in CRM</div>
                  )}
                  {summary.skippedNoName > 0 && (
                    <div>· {summary.skippedNoName} row{summary.skippedNoName !== 1 ? 's' : ''} skipped — missing first name</div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        {(step === 'mapping' || step === 'done') && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--color-surface)',
            flexShrink: 0,
          }}>
            {step === 'mapping' ? (
              <>
                <button
                  onClick={() => setStep('upload')}
                  style={{
                    padding: '7px 14px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-2)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={!mapping.first_name}
                  style={{
                    padding: '8px 20px', borderRadius: 6,
                    background: mapping.first_name ? 'var(--color-accent)' : 'var(--color-border)',
                    border: 'none', color: mapping.first_name ? '#fff' : 'var(--color-text-3)',
                    fontSize: 13, fontWeight: 600,
                    cursor: mapping.first_name ? 'pointer' : 'not-allowed',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (mapping.first_name) e.currentTarget.style.background = 'var(--color-accent-hover)' }}
                  onMouseLeave={e => { if (mapping.first_name) e.currentTarget.style.background = 'var(--color-accent)' }}
                >
                  Import {parsed?.rows.length} Lead{parsed?.rows.length !== 1 ? 's' : ''}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={reset}
                  style={{
                    padding: '7px 14px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-2)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Import Another
                </button>
                <button
                  onClick={handleClose}
                  style={{
                    padding: '8px 20px', borderRadius: 6,
                    background: 'var(--color-accent)', border: 'none',
                    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-accent-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--color-accent)'}
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
