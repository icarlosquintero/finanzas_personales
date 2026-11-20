'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('icarlosquintero@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.get('expired') === '1') setIsExpired(true)

      // Si el usuario tiene deshabilitado el inicio de sesión manual y hay credenciales guardadas, ingresar automáticamente
      const reqLogin = localStorage.getItem('fp_require_login') === 'true'
      try {
        const saved = JSON.parse(localStorage.getItem('fp_saved_auth') || 'null')
        if (saved?.email) setEmail(saved.email)
        if (!reqLogin && urlParams.get('manual') !== '1' && saved?.email && saved?.password) {
          setLoading(true)
          supabase.auth.signInWithPassword({
            email: saved.email,
            password: saved.password,
          }).then(({ error: autoErr }) => {
            if (!autoErr) {
              window.location.href = '/'
            } else {
              setLoading(false)
            }
          })
        }
      } catch (_) {}
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const cleanEmail = email.trim()
    // Save credentials BEFORE signInWithPassword so any immediate onAuthStateChange redirect never loses them
    try {
      localStorage.setItem('fp_saved_auth', JSON.stringify({ email: cleanEmail, password }))
      if (localStorage.getItem('fp_require_login') === null) {
        localStorage.setItem('fp_require_login', 'false')
      }
    } catch (_) {}

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    })

    setLoading(false)

    if (authError) {
      try { localStorage.removeItem('fp_saved_auth') } catch (_) {}
      setError('Email o contraseña incorrectos')
    } else {
      window.location.href = '/'
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
      <div className="card text-center animate-slideUp" style={{ maxWidth: '400px', width: '90%', padding: '40px 24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>💰</div>
        <h1 className="mb-2">Finanzas Personales</h1>
        <p className="text-secondary mb-6">Control inteligente de tus gastos</p>

        {isExpired && (
          <div className="alert alert-warning mb-4" style={{ fontSize: '0.85rem' }}>
            🔒 Tu sesión ha caducado. Por favor ingresa nuevamente.
          </div>
        )}

        {error && (
          <div className="alert alert-danger mb-4" style={{ fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-field">
            <label className="form-label">Contraseña</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full justify-center"
            style={{ padding: '12px', fontSize: '16px', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? 'Ingresando...' : 'Acceder'}
          </button>
        </form>
      </div>
    </div>
  )
}
