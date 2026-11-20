'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [requireLogin, setRequireLogin] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRequireLogin(localStorage.getItem('fp_require_login') === 'true')
      const onSettingChanged = (e) => {
        if (e?.detail?.requireLogin !== undefined) {
          setRequireLogin(!!e.detail.requireLogin)
        }
      }
      window.addEventListener('fp-auth-setting-changed', onSettingChanged)
      return () => window.removeEventListener('fp-auth-setting-changed', onSettingChanged)
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login?manual=1')
  }

  const navItems = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Gastos', path: '/gastos', icon: '💳' },
    { name: 'Presupuestos', path: '/presupuestos', icon: '📋' },
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
        {requireLogin && (
          <button 
            onClick={handleLogout}
            className="nav-item text-danger mt-2 w-full"
            style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span className="nav-icon">🚪</span>
            <span className="nav-label">Cerrar Sesión</span>
          </button>
        )}
      </div>
    </aside>
  )
}
