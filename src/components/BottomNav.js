'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

export default function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = () => {
    localStorage.removeItem('fp_auth')
    router.push('/login')
  }

  const navItems = [
    { name: 'Dash', path: '/', icon: '📊' },
    { name: 'Gastos', path: '/gastos', icon: '💳' },
    { name: 'Presup', path: '/presupuestos', icon: '📋' },
    { name: 'Config', path: '/config', icon: '⚙️' },
  ]

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => {
        const isActive = pathname === item.path
        return (
          <Link 
            key={item.name} 
            href={item.path}
            className={`bottom-nav-item ${isActive ? 'bottom-nav-item-active' : ''}`}
          >
            <span className="nav-icon" style={{ fontSize: '20px' }}>{item.icon}</span>
            <span>{item.name}</span>
          </Link>
        )
      })}
      <button 
        onClick={handleLogout}
        className="bottom-nav-item"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}
      >
        <span className="nav-icon" style={{ fontSize: '20px' }}>🚪</span>
        <span>Salir</span>
      </button>
    </nav>
  )
}
