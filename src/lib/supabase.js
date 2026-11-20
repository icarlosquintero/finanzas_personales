// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Use localStorage (with seamless migration from sessionStorage) so session persists across tab/app restarts
const customStorage = typeof window !== 'undefined' ? {
  getItem: (key) => {
    const localVal = localStorage.getItem(key)
    if (localVal !== null) return localVal
    const sessionVal = sessionStorage.getItem(key)
    if (sessionVal !== null) {
      localStorage.setItem(key, sessionVal)
      return sessionVal
    }
    return null
  },
  setItem: (key, value) => {
    localStorage.setItem(key, value)
    sessionStorage.setItem(key, value)
  },
  removeItem: (key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
} : undefined

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})
