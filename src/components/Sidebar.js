'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Gastos', path: '/gastos', icon: '💳' },
    { name: 'Presupuestos', path: '/presupuestos', icon: '📋' },
    { name: 'Deudas', path: '/deudas', icon: '📝' },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="nav-icon">💰</span>
        <span>Finanzas</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = pathname === item.path
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.name}</span>
            </Link>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <Link 
          href="/config"
          className={`nav-item ${pathname === '/config' ? 'nav-item-active' : ''}`}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Configuración</span>
        </Link>
        <button 
          onClick={handleLogout}
          className="nav-item text-danger mt-2 w-full"
          style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span className="nav-icon">🚪</span>
          <span className="nav-label">Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  )
}
