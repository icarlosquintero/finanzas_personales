'use client'
import { useEffect, useState } from 'react'
import { hasUnsavedWork } from '@/lib/workState'
export default function WorkFeedback() {
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    let timer
    let failed = false
    const show = (message, error, persistent = false) => {
      clearTimeout(timer)
      setNotice({ message, error })
      if (!persistent) timer = setTimeout(() => setNotice(null), error ? 10000 : 3500)
    }
    const state = e => {
      if (e.detail.failed) failed = true
      if (e.detail.pending) show('Guardando…', false, true)
      else { show(failed ? 'No se pudo completar la operación. Comprueba el estado antes de reintentar.' : 'Guardado', failed); failed = false }
    }
    const message = e => show(e.detail.message, e.detail.error)
    const leave = e => { if (hasUnsavedWork()) { e.preventDefault(); e.returnValue = '' } }
    const navigate = e => {
      const link = e.target instanceof Element && e.target.closest('a[href]')
      if (!link || !hasUnsavedWork() || link.target === '_blank' || link.getAttribute('href')?.startsWith('#')) return
      if (!confirm('Hay cambios sin guardar o un guardado en curso. ¿Quieres salir de esta pantalla?')) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('finance-save-state', state)
    window.addEventListener('finance-notice', message)
    window.addEventListener('beforeunload', leave)
    document.addEventListener('click', navigate, true)
    return () => { clearTimeout(timer); window.removeEventListener('finance-save-state', state); window.removeEventListener('finance-notice', message); window.removeEventListener('beforeunload', leave); document.removeEventListener('click', navigate, true) }
  }, [])
  return notice && <div role={notice.error ? 'alert' : 'status'} className="work-feedback"><span>{notice.message}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</button></div>
}
