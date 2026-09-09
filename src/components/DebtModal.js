'use client'
import { useState } from 'react'
import { addDebt } from '@/lib/db'
import useFormGuard from '@/hooks/useFormGuard'
export default function DebtModal({ onClose, onSave }) {
  const [form, setForm] = useState({ description: '', creditor: '', amount: '', currency: 'CLP' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const guard = useFormGuard(true, busy, onClose)
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const saved = await addDebt({ ...form, amount: Number(form.amount) })
      if (!saved) throw new Error('save')
      guard.clean(); onSave(saved); onClose()
    } catch { setError('No se pudo guardar. Tus datos siguen aquí.') }
    finally { setBusy(false) }
  }
  return <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="debt-title"><form onSubmit={submit} onChange={guard.change}>
    <div className="modal-header"><h2 id="debt-title">Agregar deuda</h2></div>
    <div className="modal-body">
      {error && <p role="alert">{error}</p>}
      {['description', 'creditor', 'amount'].map((key, i) => <div className="form-field" key={key}><label htmlFor={'debt-' + key}>{['Descripción', 'Acreedor (opcional)', 'Monto'][i]}</label><input id={'debt-' + key} className="input" type={key === 'amount' ? 'number' : 'text'} min={key === 'amount' ? '0.01' : undefined} step={key === 'amount' ? '0.01' : undefined} required={key !== 'creditor'} disabled={busy} value={form[key]} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} /></div>)}
      <label htmlFor="debt-currency">Moneda</label><select id="debt-currency" className="select" disabled={busy} value={form.currency} onChange={e => setForm(v => ({ ...v, currency: e.target.value }))}><option>CLP</option><option>USD</option></select>
    </div><div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={guard.close}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
  </form></section></div>
}
