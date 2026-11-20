'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function BottomNav() {
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
      {requireLogin && (
        <button 
          onClick={handleLogout}
          className="bottom-nav-item"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}
        >
          <span className="nav-icon" style={{ fontSize: '20px' }}>🚪</span>
          <span>Salir</span>
        </button>
      )}
    </nav>
  )
}
