'use client'
import { useState, useEffect } from 'react'
import LoadState from '@/components/LoadState'
import useResource from '@/hooks/useResource'
import AccountModal from '@/components/AccountModal'
import Header from '@/components/Header'
import { getAccounts } from '@/lib/db'
import { formatCurrency } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Cuentas() {
  const [isPrivate] = usePrivacyMode()
  const { data: accounts, setData: setAccounts, loading, error, load } = useResource(getAccounts)


  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const total = accounts.reduce((sum, a) => sum + (a.currency === 'CLP' ? Number(a.balance) : 0), 0)
  const cash = accounts.filter(a => a.type === 'cash').reduce((sum, a) => sum + Number(a.balance), 0)
  const savings = accounts.filter(a => a.type === 'savings').reduce((sum, a) => sum + Number(a.balance), 0)
  const net = total - savings

  return (
    <div className="animate-fadeIn">
      <Header title="Cuentas Bancarias" />
      <div className="container" aria-busy={loading}>
        <LoadState loading={loading} error={error} retry={load} />
        <div className="summary-grid">
          <div className="card">
            <div className="summary-label">Total Cuentas (CLP)</div>
            <div className="summary-value">{formatCurrency(total)}</div>
          </div>
          <div className="card">
            <div className="summary-label">Ahorros</div>
            <div className="summary-value text-success">{formatCurrency(savings)}</div>
          </div>
          <div className="card">
            <div className="summary-label">Disponible Neto</div>
            <div className="summary-value text-warning">{formatCurrency(net)}</div>
          </div>
        </div>

        <h2 className="mb-4 mt-6">Tus Cuentas</h2>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {accounts.map(acc => (
            <div key={acc.id} className="card">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">{acc.name}</h3>
                <span className="badge badge-info bg-tertiary px-2 py-1 rounded text-xs">{acc.type}</span>
              </div>
              <div className="summary-value mb-4">
                {formatCurrency(acc.balance, acc.currency)}
              </div>
              <button onClick={() => { setEditing(acc); setOpen(true) }} className="text-accent text-sm font-medium">Actualizar Saldo</button>
            </div>
          ))}
        </div>
      </div>
      <AccountModal isOpen={open} initialItem={editing} onClose={() => setOpen(false)} onAdd={saved => setAccounts(prev => [...prev.filter(a => a.id !== saved.id), saved])} />
      <button onClick={() => { setEditing(null); setOpen(true) }} className="btn-fab" aria-label="Agregar Cuenta">+</button>
    </div>
  )
}
