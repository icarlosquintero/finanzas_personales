'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { getDebts, deleteDebt } from '@/lib/db'
import { formatCurrency } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Deudas() {
  const [isPrivate] = usePrivacyMode()
  const [debts, setDebts] = useState([])

  useEffect(() => {
    setDebts(getDebts())
  }, [])

  const handleDelete = (id) => {
    if (confirm('¿Eliminar esta deuda?')) {
      deleteDebt(id)
      setDebts(debts.filter(d => d.id !== id))
    }
  }

  const totalUSD = debts.filter(d => d.currency === 'USD').reduce((sum, d) => sum + Number(d.amount), 0)
  const totalCLP = debts.filter(d => d.currency === 'CLP').reduce((sum, d) => sum + Number(d.amount), 0)

  return (
    <div className="animate-fadeIn">
      <Header title="Deudas" />
      <div className="container">
        <div className="summary-grid mb-6">
          <div className="card">
            <div className="summary-label">Total Deudas (USD)</div>
            <div className="summary-value text-danger">{formatCurrency(totalUSD, 'USD')}</div>
          </div>
          {totalCLP > 0 && (
            <div className="card">
              <div className="summary-label">Total Deudas (CLP)</div>
              <div className="summary-value text-danger">{formatCurrency(totalCLP)}</div>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4">Lista de Deudas</h2>
          {debts.length === 0 ? (
            <p className="text-secondary text-center py-4">No tienes deudas registradas.</p>
          ) : (
            <div className="transaction-list">
              {debts.map(debt => (
                <div key={debt.id} className="transaction-item">
                  <div className="transaction-info">
                    <span className="transaction-title">{debt.description}</span>
                    <span className="transaction-meta text-secondary">{debt.creditor ? `Acreedor: ${debt.creditor}` : 'Sin acreedor'}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="transaction-amount text-danger">{formatCurrency(debt.amount, debt.currency)}</span>
                    <button 
                      onClick={() => handleDelete(debt.id)} 
                      className="text-danger hover:text-red-700 transition-colors" 
                      style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-danger)' }}
                      title="Eliminar"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <button className="btn-fab" aria-label="Agregar Deuda">+</button>
    </div>
  )
}
