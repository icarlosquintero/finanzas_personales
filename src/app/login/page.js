'use client'
import { useState, useEffect } from 'react'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.get('expired') === '1') {
        setIsExpired(true)
      }
    }
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    
    // Validar credenciales hardcodeadas
    if (username.trim().toLowerCase() === 'carlos' && password === 'Pisco2025++') {
      const authData = {
        loggedIn: true,
        user: 'Carlos',
        lastActivity: Date.now()
      }
      localStorage.setItem('fp_auth', JSON.stringify(authData))
      window.location.href = '/'
    } else {
      setError('Usuario o contraseña incorrectos')
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
            🔒 Tu sesión ha caducado por inactividad. Por favor ingresa tus credenciales nuevamente.
          </div>
        )}

        {error && (
          <div className="alert alert-danger mb-4" style={{ fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
          <div className="form-field">
            <label className="form-label">Usuario</label>
            <input 
              type="text" 
              className="input" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              placeholder="Ingresa tu usuario"
              required 
            />
          </div>
          <div className="form-field">
            <label className="form-label">Contraseña</label>
            <input 
              type="password" 
              className="input" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Ingresa tu contraseña"
              required 
            />
          </div>
          
          <button type="submit" className="btn btn-primary w-full justify-center" style={{ padding: '12px', fontSize: '16px', marginTop: '8px' }}>
            <span>Acceder</span>
          </button>
        </form>
      </div>
    </div>
  )
}
