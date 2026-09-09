'use client'
import { hasUnsavedWork } from '@/lib/workState'
import { supabase } from '@/lib/supabase'
import ThemeToggle from './ThemeToggle'
import PrivacyToggle from './PrivacyToggle'

export default function Header({ title, children }) {
  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {children}
        <PrivacyToggle />
        <ThemeToggle />
        <button className="mobile-logout" onClick={async () => { if (hasUnsavedWork() && !confirm('Hay cambios sin guardar. ¿Cerrar sesión de todas formas?')) return; await supabase.auth.signOut() }} aria-label="Cerrar sesión" title="Cerrar sesión">Salir</button>
      </div>
    </header>
  )
}
