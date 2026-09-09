'use client'
import { useState, useEffect } from 'react'
import { getSettings, saveSettings } from '@/lib/db'
import { notify } from '@/lib/workState'
export default function ThemeToggle() {
  const [theme, setTheme] = useState('light')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    getSettings().then(settings => {
      if (cancelled) return
      const value = settings.theme === 'dark' ? 'dark' : 'light'
      setTheme(value); document.documentElement.setAttribute('data-theme', value)
    }).catch(() => notify('No se pudo cargar el tema guardado.', true))
    return () => { cancelled = true }
  }, [])
  const toggleTheme = async () => {
    if (busy) return
    setBusy(true)
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next); document.documentElement.setAttribute('data-theme', next)
    try { const settings = await getSettings(); await saveSettings({ ...settings, theme: next }) }
    catch { setTheme(theme); document.documentElement.setAttribute('data-theme', theme); notify('No se pudo guardar el tema. Intenta nuevamente.', true) }
    finally { setBusy(false) }
  }
  return <button onClick={toggleTheme} disabled={busy} className="btn btn-secondary theme-toggle" aria-label="Alternar tema" style={{ padding: 8, borderRadius: '50%' }}>{theme === 'light' ? '🌙' : '☀️'}</button>
}
