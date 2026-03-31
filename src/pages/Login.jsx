import { useState } from 'react'
import { supabase } from '../lib/supabase'

const BarnIcon = () => (
  <svg width="32" height="28" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 1L27 9H1L14 1Z" fill="#C0272D" />
    <rect x="3" y="9" width="22" height="14" fill="#8B1A1E" />
    <rect x="11" y="15" width="6" height="8" rx="3" fill="#1A2444" />
    <rect x="5" y="12" width="4" height="4" rx="1" fill="#C0272D" opacity="0.7" />
    <rect x="19" y="12" width="4" height="4" rx="1" fill="#C0272D" opacity="0.7" />
  </svg>
)

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, App.jsx auth state change will redirect automatically
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
    }}>
      <div style={{
        width: 360,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: '#1A2444',
          padding: '28px 32px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}>
          <BarnIcon />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              Florida Pole Barn
            </div>
            <div style={{ fontSize: 11, color: '#C0272D', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginTop: 2 }}>
              Sales CRM
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '28px 32px 32px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@floridapolebarn.com"
              style={{
                width: '100%',
                padding: '9px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 7,
                fontSize: 13,
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-2)', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '9px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 7,
                fontSize: 13,
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16,
              padding: '8px 12px',
              background: 'rgba(192,39,45,0.08)',
              border: '1px solid rgba(192,39,45,0.3)',
              borderRadius: 6,
              fontSize: 12,
              color: '#C0272D',
              fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px',
              background: loading ? 'rgba(192,39,45,0.5)' : '#C0272D',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
