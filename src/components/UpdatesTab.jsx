import { useState } from 'react'
import { supabase } from '../lib/supabase'

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} day${d !== 1 ? 's' : ''} ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const fi = {
  width: '100%', padding: '7px 10px',
  background: 'var(--input-bg)', border: '1px solid var(--color-border)',
  borderRadius: 6, color: 'var(--color-text)', fontSize: 13,
  outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
}

export default function UpdatesTab({ projectId, updates, onUpdatesChange }) {
  const [body,    setBody]    = useState('')
  const [author,  setAuthor]  = useState('')
  const [posting, setPosting] = useState(false)
  const [err,     setErr]     = useState(null)

  const post = async () => {
    if (!body.trim()) { setErr('Update text is required'); return }
    setErr(null)
    setPosting(true)
    const { error } = await supabase.from('project_updates').insert({
      project_id:  projectId,
      author:      author.trim() || null,
      body:        body.trim(),
      update_type: 'note',
    })
    setPosting(false)
    if (error) { setErr(error.message); return }
    setBody('')
    onUpdatesChange()
  }

  const del = async (u) => {
    if (!window.confirm('Delete this update?')) return
    await supabase.from('project_updates').delete().eq('id', u.id)
    onUpdatesChange()
  }

  return (
    <div>
      {/* Compose */}
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 16, marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Post an update…"
          rows={3}
          style={{ ...fi, resize: 'vertical', lineHeight: 1.5, marginBottom: 8 }}
          onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Your name"
            style={{ ...fi, width: 180 }}
            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
          />
          {err && (
            <span style={{ flex: 1, fontSize: 12, color: '#C0272D', fontWeight: 500 }}>{err}</span>
          )}
          <button
            onClick={post}
            disabled={posting}
            style={{
              marginLeft: 'auto',
              padding: '7px 16px', borderRadius: 6,
              background: posting ? 'var(--color-border)' : 'var(--color-accent)',
              border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: posting ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            {posting ? 'Posting…' : 'Post update'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {updates.length === 0 && (
        <div style={{ color: 'var(--color-text-3)', fontSize: 13 }}>No updates yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {updates.map(u => (
          <div
            key={u.id}
            style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 10, padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
                {u.author || 'Anonymous'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
                {relativeTime(u.created_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {u.body}
            </div>
            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <button
                onClick={() => del(u)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: 'var(--color-text-3)', padding: 0,
                  textDecoration: 'underline',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#C0272D'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-3)'}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
