'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import BottomNav from '@/components/BottomNav'

export default function AuthProvider({ children }) {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [mounted, setMounted] = useState(false)

  const isLoginPage = pathname === '/login'

  useEffect(() => {
    setMounted(true)

    // Get current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setIsAuthenticated(true)
        if (isLoginPage) window.location.href = '/'
      } else {
        setIsAuthenticated(false)
        if (!isLoginPage) window.location.href = '/login'
      }
    })

    // Listen for auth state changes (login / logout / token refresh)
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
    </div>
  )
}
