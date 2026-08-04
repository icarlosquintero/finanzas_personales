'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import BottomNav from '@/components/BottomNav'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
const WARNING_SECONDS = 60 // show warning this many seconds before logout

export default function AuthProvider({ children }) {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [countdown, setCountdown] = useState(WARNING_SECONDS)

  const timerRef = useRef(null)
  const warningTimerRef = useRef(null)
  const countdownRef = useRef(null)
  const timeoutMinutesRef = useRef(15) // default, will be overridden from settings

  const isLoginPage = pathname === '/login'

  // --- Logout ---
  const doLogout = async () => {
    clearAllTimers()
    await supabase.auth.signOut()
    // onAuthStateChange will redirect to /login
  }

  const clearAllTimers = () => {
    clearTimeout(timerRef.current)
    clearTimeout(warningTimerRef.current)
    clearInterval(countdownRef.current)
    timerRef.current = null
    warningTimerRef.current = null
    countdownRef.current = null
  }

  // --- Reset timer on activity ---
  const resetTimer = () => {
    if (!isAuthenticated || isLoginPage) return
    clearAllTimers()
    setShowWarning(false)

    const totalMs = timeoutMinutesRef.current * 60 * 1000
    const warningMs = totalMs - WARNING_SECONDS * 1000

    if (warningMs > 0) {
      warningTimerRef.current = setTimeout(() => {
        setShowWarning(true)
        setCountdown(WARNING_SECONDS)
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current)
              return 0
            }
            return prev - 1
          })
        }, 1000)
        timerRef.current = setTimeout(doLogout, WARNING_SECONDS * 1000)
      }, warningMs)
    } else {
      // Timeout too short for warning — just logout directly
      timerRef.current = setTimeout(doLogout, totalMs)
    }
  }

  // --- Load timeout setting from Supabase ---
  const loadTimeoutSetting = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'appSettings')
        .single()
      if (data?.value?.inactivityTimeout) {
        timeoutMinutesRef.current = Number(data.value.inactivityTimeout)
      }
    } catch (_) {
      // ignore — use default
    }
  }

  useEffect(() => {
    setMounted(true)

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setIsAuthenticated(true)
        if (isLoginPage) window.location.href = '/'
      } else {
        setIsAuthenticated(false)
        if (!isLoginPage) window.location.href = '/login'
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setIsAuthenticated(true)
        if (isLoginPage) window.location.href = '/'
      } else {
        setIsAuthenticated(false)
        if (!isLoginPage) window.location.href = '/login'
      }
    })

    return () => subscription.unsubscribe()
  }, [isLoginPage])

  // --- Set up / tear down inactivity timer ---
  useEffect(() => {
    if (!isAuthenticated || isLoginPage) {
      clearAllTimers()
      return
    }

    loadTimeoutSetting().then(() => resetTimer())

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, resetTimer))
      clearAllTimers()
    }
  }, [isAuthenticated, isLoginPage])

  if (!mounted) return null
  if (isLoginPage) return <>{children}</>
  if (!isAuthenticated) return null

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
      <BottomNav />

      {/* Inactivity warning modal */}
      {showWarning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{
            background: 'var(--bg-card, #fff)',
            borderRadius: '16px',
            padding: '32px 28px',
            maxWidth: '360px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⏰</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 700 }}>
              Sesión por expirar
            </h3>
            <p style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.9rem', margin: '0 0 20px' }}>
              Tu sesión cerrará por inactividad en
            </p>
            <div style={{
              fontSize: '3rem', fontWeight: 800,
              color: countdown <= 10 ? 'var(--color-danger, #ef4444)' : 'var(--color-accent, #3b82f6)',
              marginBottom: '24px',
              transition: 'color 0.3s'
            }}>
              {countdown}s
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={resetTimer}
                style={{
                  padding: '10px 24px', borderRadius: '8px', border: 'none',
                  background: 'var(--color-accent, #3b82f6)', color: 'white',
                  fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem'
                }}
              >
                Seguir activo
              </button>
              <button
                onClick={doLogout}
                style={{
                  padding: '10px 20px', borderRadius: '8px',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary, #666)',
                  cursor: 'pointer', fontSize: '0.95rem'
                }}
              >
                Salir ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
