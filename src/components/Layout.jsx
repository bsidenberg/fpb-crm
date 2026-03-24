import { NavLink, Outlet, useLocation } from 'react-router-dom'

const BarnIcon = () => (
  <svg width="28" height="24" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 1L27 9H1L14 1Z" fill="#C0392B" />
    <rect x="3" y="9" width="22" height="14" fill="#A93226" />
    <rect x="11" y="15" width="6" height="8" rx="3" fill="#141210" />
    <rect x="5" y="12" width="4" height="4" rx="1" fill="#C0392B" opacity="0.6" />
    <rect x="19" y="12" width="4" height="4" rx="1" fill="#C0392B" opacity="0.6" />
  </svg>
)

const NAV = [
  {
    to: '/',
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
]

export default function Layout() {
  const location = useLocation()

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{
          padding: '18px 16px 16px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarnIcon />
            <div>
              <div style={{
                fontFamily: "'DM Serif Display', serif",
                fontWeight: 400,
                fontSize: 18,
                color: 'var(--color-text)',
                lineHeight: 1.1,
              }}>
                Florida
              </div>
              <div style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: 9,
                color: 'var(--color-gold)',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}>
                Pole Barn
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 10,
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--color-text-3)',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}>
            Sales CRM
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px' }}>
          {NAV.map(item => {
            const active = location.pathname === item.to
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
                  color: active ? '#fff' : 'var(--color-text-2)',
                  background: active ? 'var(--color-accent)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                  marginBottom: 2,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-surface)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                {item.icon}
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer tagline */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--color-border)',
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--color-text-3)',
          letterSpacing: '0.3px',
          lineHeight: 1.6,
        }}>
          140+ MPH Wind Rated · Made in USA
          <br />Florida Code Compliant
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
