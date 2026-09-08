'use client'
import { useEffect, useState } from 'react'

// Explicit opt-in; timings remain in this tab. Never collect URLs, queries,
// headers, request/response bodies, field values, or button text.
const routes = new Set(['/', '/login', '/gastos', '/cuentas', '/deudas', '/presupuestos', '/config'])
const routeName = path => routes.has(path) ? (path === '/' ? 'resumen' : path.slice(1)) : 'otra'
const tables = new Set(['transactions', 'accounts', 'settings', 'categories', 'recurring', 'debts', 'budgets'])
function targetName(url) {
  if (url.pathname.startsWith('/auth/')) return 'autenticación'
  const table = url.pathname.split('/')[3]
  if (url.pathname.startsWith('/rest/v1/')) return tables.has(table) ? table : 'datos'
  return url.origin === location.origin ? 'aplicación' : 'externo'
}

export default function PerformancePanel() {
  const [enabled, setEnabled] = useState(false)
  const [samples, setSamples] = useState([])
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    let active = false
    try {
      const flag = new URLSearchParams(location.search).get('medir')
      if (flag === '0') sessionStorage.removeItem('finance-measure')
      if (flag === '1') sessionStorage.setItem('finance-measure', '1')
      active = sessionStorage.getItem('finance-measure') === '1'
    } catch { active = new URLSearchParams(location.search).get('medir') === '1' }
    if (!active) return
    setEnabled(true)
    let alive = true
    const add = (kind, label, ms, status = '') => {
      if (!alive || !Number.isFinite(ms) || ms < 0) return
      setSamples(prev => [...prev.slice(-149), { kind, label, ms: Math.round(ms), status }])
    }
    const onOperation = event => {
      const d = event.detail
      if (d && /^[A-Za-z]+$/.test(d.name)) add('Operación completa', d.name, d.ms, d.outcome)
    }
    window.addEventListener('finance-operation-timing', onOperation)
    const originalFetch = window.fetch
    const measuredFetch = async function (...args) {
      const started = performance.now()
      let label = 'solicitud'
      let method = 'GET'
      try {
        const input = args[0]
        label = targetName(new URL(input instanceof Request ? input.url : String(input), location.origin))
        method = String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
        if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) method = 'OTRO'
      } catch { /* No inspection error should affect application requests. */ }
      try {
        const response = await originalFetch.apply(this, args)
        add('Respuesta HTTP', `${method} ${label}`, performance.now() - started, String(response.status))
        return response
      } catch (error) {
        add('Respuesta HTTP', `${method} ${label}`, performance.now() - started, 'Error de red')
        throw error
      }
    }
    window.fetch = measuredFetch
    const observers = []
    const observe = (type, callback) => {
      try {
        const observer = new PerformanceObserver(list => list.getEntries().forEach(callback))
        observer.observe({ type, buffered: true })
        observers.push(observer)
      } catch { /* Some browsers do not expose every entry type. */ }
    }
    observe('navigation', e => {
      add('Carga inicial', 'Primer byte del documento', e.responseStart - e.requestStart)
      if (e.domContentLoadedEventEnd) add('Carga inicial', 'DOM listo (no datos)', e.domContentLoadedEventEnd)
    })
    observe('paint', e => { if (e.name === 'first-contentful-paint') add('Carga inicial', 'Primer contenido visible', e.startTime) })
    observe('resource', e => {
      if (!['fetch', 'xmlhttprequest'].includes(e.initiatorType)) return
      try { add('Transferencia completa', targetName(new URL(e.name)), e.duration) } catch {}
    })
    observe('longtask', e => add('Bloqueo de interfaz', 'Tarea mayor de 50 ms', e.duration))
    const frameIds = new Set()
    const onClick = event => {
      if (!(event.target instanceof Element) || event.target.closest('[data-performance-panel]')) return
      const control = event.target.closest('button,a')
      if (!control) return
      const label = control.tagName === 'A' ? 'Navegación iniciada' : 'Botón pulsado'
      const route = routeName(location.pathname)
      const start = performance.now()
      const first = requestAnimationFrame(() => {
        frameIds.delete(first)
        const second = requestAnimationFrame(() => {
          frameIds.delete(second)
          add('Siguiente frame', `${route}: ${label}`, performance.now() - start)
        })
        frameIds.add(second)
      })
      frameIds.add(first)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      alive = false
      window.removeEventListener('finance-operation-timing', onOperation)
      if (window.fetch === measuredFetch) window.fetch = originalFetch
      observers.forEach(o => o.disconnect())
      frameIds.forEach(id => cancelAnimationFrame(id))
      document.removeEventListener('click', onClick, true)
    }
  }, [])
  if (!enabled) return null
  return <aside data-performance-panel style={{ position: 'fixed', bottom: 90, right: 12, zIndex: 10000, width: expanded ? 'min(560px, calc(100vw - 24px))' : 'auto', maxHeight: '55vh', overflow: 'auto', background: 'var(--bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 12, boxShadow: 'var(--shadow-lg)', fontSize: 14 }} aria-label="Medición de rendimiento">
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <strong>Medición · {samples.length} muestras</strong>
      <button type="button" onClick={() => setExpanded(v => !v)}>{expanded ? 'Minimizar medición' : 'Ver medición'}</button>
      <button type="button" onClick={() => setSamples([])}>Limpiar medición</button>
    </div>
    {expanded && <>
      <p style={{ margin: '8px 0' }}>Tiempos locales en ms. HTTP mide hasta las cabeceras; transferencia incluye el cuerpo. El siguiente frame no confirma que los datos estén listos ni guardados. «Finalizó» indica que la función terminó; consulta HTTP para detectar fallos.</p>
      <table style={{ width: '100%', fontVariantNumeric: 'tabular-nums', textAlign: 'left' }}><thead><tr><th>Medida</th><th>Operación</th><th>ms</th><th>HTTP</th></tr></thead>
        <tbody>{samples.map((s, i) => <tr key={i}><td>{s.kind}</td><td>{s.label}</td><td>{s.ms}</td><td>{s.status}</td></tr>)}</tbody></table>
    </>}
  </aside>
}
