'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import MonthSelector from '@/components/MonthSelector'
import { getBudgets } from '@/lib/db'
import { getCurrentMonth, formatCurrency, getBudgetPercentage, getBudgetStatus } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Presupuestos() {
  const [isPrivate] = usePrivacyMode()
  const [currentMonth, setCurrentMonth] = useState('')
  const [budget, setBudget] = useState({ items: [] })

  useEffect(() => {
    setCurrentMonth(getCurrentMonth())
  }, [])

  useEffect(() => {
    if (currentMonth) {
      const load = async () => {
        const allBudgets = await getBudgets()
        const b = allBudgets.find(b => b.month === currentMonth)
        setBudget(b || { items: [] })
      }
      load()
    }
  }, [currentMonth])

  if (!currentMonth) return null

  const totalBudgeted = budget.items.reduce((sum, item) => sum + Number(item.limit), 0)
  const totalSpent = budget.items.reduce((sum, item) => sum + Number(item.spent || 0), 0)

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
            <div className="summary-value">{formatCurrency(totalSpent)}</div>
          </div>
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2>Categorías</h2>
            <button className="btn btn-secondary text-sm">Editar</button>
          </div>
          
          {budget.items.length === 0 ? (
            <p className="text-secondary text-center py-4">No hay presupuestos definidos para este mes.</p>
          ) : (
            <div className="flex-col gap-4">
              {budget.items.map(b => {
                const percentage = getBudgetPercentage(b.spent || 0, b.limit)
                const status = getBudgetStatus(percentage)
                return (
                  <div key={b.category} className="budget-item mb-4">
                    <div className="budget-header">
                      <span className="font-medium flex items-center gap-2">
                        {b.category} 
                        {percentage >= 100 && <span title="Presupuesto excedido">⚠️</span>}
                      </span>
                      <span className="text-sm font-medium">
                        {percentage}%
                      </span>
                    </div>
                    <div className="budget-bar-bg mb-1">
                      <div 
                        className={`budget-bar-fill budget-fill-${status}`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-secondary">
                      <span>{formatCurrency(b.spent || 0)} gastado</span>
                      <span>{formatCurrency(b.limit)} límite</span>
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
