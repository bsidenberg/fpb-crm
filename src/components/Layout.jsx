import { NavLink, Outlet, useLocation } from 'react-router-dom'

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
]

export default function Layout() {
  const location = useLocation()

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
          fontSize: 9,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.25)',
          letterSpacing: '0.3px',
          lineHeight: 1.7,
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
