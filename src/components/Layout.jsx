import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

function LiveIndicator() {
  const [status, setStatus] = useState('connecting') // 'live' | 'reconnecting' | 'connecting'

  useEffect(() => {
    const channel = supabase
      .channel('presence-heartbeat')
      .subscribe((s) => {
        if (s === 'SUBSCRIBED')    setStatus('live')
        else if (s === 'CLOSED')   setStatus('connecting')
        else                        setStatus('reconnecting')
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  const isLive = status === 'live'
  const color  = isLive ? '#16A34A' : '#9CA3AF'
  const label  = isLive ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: 9, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
      color, marginTop: 6,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
        animation: isLive ? 'livePulse 2s ease-in-out infinite' : 'none',
      }} />
      {label}
    </div>
  )
}

const BarnIcon = () => (
  <svg width="26" height="22" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 1L27 9H1L14 1Z" fill="#C0272D" />
    <rect x="3" y="9" width="22" height="14" fill="#8B1A1E" />
    <rect x="11" y="15" width="6" height="8" rx="3" fill="#1A2444" />
    <rect x="5" y="12" width="4" height="4" rx="1" fill="#C0272D" opacity="0.7" />
    <rect x="19" y="12" width="4" height="4" rx="1" fill="#C0272D" opacity="0.7" />
  </svg>
)

const NAV = [
  {
    to: '/',
    exact: true,
    label: 'Pipeline',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    to: '/followups',
    exact: false,
    label: 'Follow-Ups',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    to: '/analytics',
    exact: false,
    label: 'Analytics',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
]

export default function Layout() {
  const location = useLocation()
  const { displayName, email, signOut } = useAuth()

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: 'var(--sidebar-bg)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <BarnIcon />
            <div>
              <div style={{
                fontWeight: 700,
                fontSize: 17,
                color: '#FFFFFF',
                lineHeight: 1.1,
                letterSpacing: '-0.3px',
              }}>
                Florida
              </div>
              <div style={{
                fontWeight: 700,
                fontSize: 9,
                color: '#C0272D',
                letterSpacing: '2.5px',
                textTransform: 'uppercase',
                lineHeight: 1.3,
              }}>
                Pole Barn
              </div>
            </div>
          </div>
          <div style={{
            fontSize: 10,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
          }}>
            Sales CRM
          </div>
          <LiveIndicator />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px' }}>
          {NAV.map(item => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  color: active ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                  background: active ? 'var(--color-accent)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                  marginBottom: 2,
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
                    e.currentTarget.style.color = '#FFFFFF'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
                  }
                }}
              >
                {item.icon}
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
        }}>
          {/* User indicator */}
          {displayName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              {/* Initials avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#C0272D',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                fontSize: 11, fontWeight: 800, color: '#FFFFFF', letterSpacing: '0.3px',
              }}>
                {displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </div>
                <button
                  onClick={signOut}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontSize: 10, color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', fontWeight: 500, letterSpacing: '0.3px',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
          <div style={{
            fontSize: 9, fontWeight: 500,
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.3px', lineHeight: 1.7,
          }}>
            140+ MPH Wind Rated · Made in USA
            <br />Florida Code Compliant
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
