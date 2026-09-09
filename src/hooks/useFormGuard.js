'use client'
import { useEffect, useRef, useState } from 'react'
import { markForm } from '@/lib/workState'
export default function useFormGuard(open, busy, onClose) {
  const [dirty, setDirty] = useState(false)
  const token = useRef(Symbol('form'))
  useEffect(() => { if (!open) setDirty(false) }, [open])
  useEffect(() => {
    const id = token.current
    markForm(id, open && (dirty || busy))
    return () => markForm(id, false)
  }, [open, dirty, busy])
  const close = () => {
    if (busy) return
    if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?')) return
    setDirty(false)
    onClose()
  }
  useEffect(() => {
    if (!open) return
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  return { dirty, change: () => setDirty(true), clean: () => setDirty(false), close }
}
