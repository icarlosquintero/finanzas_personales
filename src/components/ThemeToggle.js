'use client'
import { useState, useEffect } from 'react'
import { getSettings, saveSettings } from '@/lib/db'

export default function ThemeToggle() {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    // Check initial
    const settings = getSettings()
    const initialTheme = settings.theme || 'light'
    setTheme(initialTheme)
    document.documentElement.setAttribute('data-theme', initialTheme)
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    
    // Save to settings
    const settings = getSettings()
    saveSettings({ ...settings, theme: newTheme })
  }

  return (
    <button 
      onClick={toggleTheme}
      className="btn btn-secondary theme-toggle"
      aria-label="Alternar tema"
      style={{ padding: '8px', borderRadius: '50%' }}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
}
