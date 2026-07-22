'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getSettings } from '@/lib/db'
import Sidebar from '@/components/Sidebar'
import BottomNav from '@/components/BottomNav'
import BackupTrigger from '@/components/BackupTrigger'

export default function AuthProvider({ children }) {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [mounted, setMounted] = useState(false)

  const isLoginPage = pathname === '/login'

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const checkAuth = () => {
      try {
        const authData = localStorage.getItem('fp_auth')
        if (authData) {
          const parsed = JSON.parse(authData)
          if (parsed.loggedIn) {
            setIsAuthenticated(true)
            if (isLoginPage) {
              window.location.href = '/'
            }
            return
          }
        }
      } catch (e) {
        console.error('Error reading auth state', e)
      }
      
      setIsAuthenticated(false)
      if (!isLoginPage) {
        window.location.href = '/login'
      }
    }

    checkAuth()
  }, [mounted, pathname, isLoginPage])

  // Lógica de inactividad
  useEffect(() => {
    if (!mounted || !isAuthenticated) return

    let timeoutInterval
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']

    const updateActivity = () => {
      try {
        const authData = JSON.parse(localStorage.getItem('fp_auth') || '{}')
        if (authData.loggedIn) {
          authData.lastActivity = Date.now()
          localStorage.setItem('fp_auth', JSON.stringify(authData))
        }
      } catch (e) {}
    }

    const checkTimeout = () => {
      try {
        const authData = JSON.parse(localStorage.getItem('fp_auth') || '{}')
        if (!authData.loggedIn || !authData.lastActivity) return

        const settings = getSettings()
        const timeoutMinutes = settings.inactivityTimeout || 15
        const maxIdleTime = timeoutMinutes * 60 * 1000

        if (Date.now() - authData.lastActivity > maxIdleTime) {
          // Timeout alcanzado: limpiar e ir inmediatamente a la pantalla de login
          localStorage.removeItem('fp_auth')
          window.location.href = '/login?expired=1'
        }
      } catch (e) {}
    }

    events.forEach(event => {
      document.addEventListener(event, updateActivity, { passive: true })
    })

    updateActivity()

    // Chequear inactividad cada 10 segundos
    timeoutInterval = setInterval(checkTimeout, 10000)

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, updateActivity)
      })
      clearInterval(timeoutInterval)
    }
  }, [mounted, isAuthenticated])

  if (!mounted) return null

  if (isLoginPage) {
    return <>{children}</>
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
      <BottomNav />
      <BackupTrigger />
    </div>
  )
}
