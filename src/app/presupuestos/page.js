'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import MonthSelector from '@/components/MonthSelector'
import { getBudgets, getTransactions, getSettings } from '@/lib/db'
import { getCurrentMonth, formatCurrency, getBudgetPercentage, getBudgetStatus } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Presupuestos() {
  const [isPrivate] = usePrivacyMode()
  const [currentMonth, setCurrentMonth] = useState('')
  const [budget, setBudget] = useState({ items: [] })
  const [transactions, setTransactions] = useState([])
  const [usdRate, setUsdRate] = useState(950)

  useEffect(() => {
    setCurrentMonth(getCurrentMonth())
  }, [])

  useEffect(() => {
    if (currentMonth) {
      const load = async () => {
        const [allBudgets, txs, settings] = await Promise.all([
          getBudgets(),
          getTransactions(currentMonth),
          getSettings(),
        ])
        const b = allBudgets.find(b => b.month === currentMonth)
        setBudget(b || { items: [] })
        setTransactions(txs.filter(t => t.type === 'expense'))
        setUsdRate(settings.usdCardExchangeRate ?? 950)
      }
      load()
    }
  }, [currentMonth])

  if (!currentMonth) return null

  // Calculate actual spent per category from real transactions
  const spentByCategory = {}
  transactions.forEach(tx => {
    const cat = tx.category || 'Sin categoría'
    const amountCLP = tx.currency === 'USD' ? tx.amount * usdRate : tx.amount
    spentByCategory[cat] = (spentByCategory[cat] || 0) + amountCLP
  })

  // Merge budget items + categories that have spending but no budget entry
  const budgetedCategories = new Set(budget.items.map(i => i.category))
  const unbudgetedCategories = Object.keys(spentByCategory)
    .filter(cat => !budgetedCategories.has(cat))
    .map(cat => ({ category: cat, limit: 0, budgeted: false }))

  const budgetItems = budget.items.map(i => ({ ...i, budgeted: true }))
  const allItems = [...budgetItems, ...unbudgetedCategories]

  const totalBudgeted = budget.items.reduce((sum, item) => sum + Number(item.limit), 0)
  const totalSpent = allItems.reduce((sum, item) => sum + (spentByCategory[item.category] || 0), 0)

  return (
    <div className="animate-fadeIn">
      <Header title="Presupuestos">
        <MonthSelector currentMonth={currentMonth} onMonthChange={setCurrentMonth} />
      </Header>
      
      <div className="container">
        <div className="summary-grid mb-6">
          <div className="card">
            <div className="summary-label">Total Presupuestado</div>
            <div className="summary-value">{formatCurrency(totalBudgeted)}</div>
          </div>
          <div className="card">
            <div className="summary-label">Total Gastado</div>
            <div className="summary-value" style={{ color: totalSpent > totalBudgeted && totalBudgeted > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {formatCurrency(totalSpent)}
            </div>
          </div>
          {totalBudgeted > 0 && (
            <div className="card">
              <div className="summary-label">Disponible</div>
              <div className="summary-value" style={{ color: totalBudgeted - totalSpent >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {formatCurrency(totalBudgeted - totalSpent)}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2>Categorías</h2>
            <a href="/config?tab=categories" className="btn btn-secondary text-sm">Editar</a>
          </div>
          
          {allItems.length === 0 ? (
            <p className="text-secondary text-center py-4">No hay presupuestos ni gastos registrados para este mes.</p>
          ) : (
            <div className="flex-col gap-4">
              {allItems.map(item => {
                const actualSpent = spentByCategory[item.category] || 0
                const limit = Number(item.limit) || 0
                const percentage = item.budgeted && limit > 0 ? getBudgetPercentage(actualSpent, limit) : 0
                const status = getBudgetStatus(percentage)

                return (
                  <div key={item.category} className="budget-item mb-4">
                    <div className="budget-header">
                      <span className="font-medium flex items-center gap-2" style={{ flexWrap: 'wrap', gap: '6px' }}>
                        {item.category}
                        {percentage >= 100 && <span title="Presupuesto excedido">⚠️</span>}
                        {item.budgeted ? (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px',
                            borderRadius: '20px', background: 'rgba(16,185,129,0.12)',
                            color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.3)',
                            whiteSpace: 'nowrap',
                          }}>✓ Presupuestado</span>
                        ) : (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px',
                            borderRadius: '20px', background: 'rgba(156,163,175,0.12)',
                            color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)',
                            whiteSpace: 'nowrap',
                          }}>Sin presupuesto</span>
                        )}
                      </span>
                      <span className="text-sm font-medium">
                        {item.budgeted && limit > 0 ? `${percentage}%` : '—'}
                      </span>
                    </div>

                    {item.budgeted && limit > 0 && (
                      <div className="budget-bar-bg mb-1">
                        <div
                          className={`budget-bar-fill budget-fill-${status}`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        ></div>
                      </div>
                    )}

                    <div className="flex justify-between text-xs text-secondary">
                      <span style={{ color: actualSpent > 0 ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                        <strong>{formatCurrency(actualSpent)}</strong> gastado
                      </span>
                      {item.budgeted && limit > 0 ? (
                        <span style={{ color: actualSpent > limit ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                          {formatCurrency(limit)} límite
                          {actualSpent > limit && (
                            <span style={{ marginLeft: '4px', color: 'var(--color-danger)', fontWeight: 700 }}>
                              (+{formatCurrency(actualSpent - limit)} excedido)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>sin límite definido</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <button className="btn-fab" aria-label="Agregar Categoría">+</button>
    </div>
  )
}

