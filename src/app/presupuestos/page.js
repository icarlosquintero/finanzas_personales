'use client'
import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/Header'
import MonthSelector from '@/components/MonthSelector'
import { getBudgets, getTransactions, getSettings, saveBudget, getCategories } from '@/lib/db'
import { getCurrentMonth, formatCurrency } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Presupuestos() {
  const [isPrivate] = usePrivacyMode()
  const [currentMonth, setCurrentMonth] = useState('')
  const [budget, setBudget]       = useState({ items: [] })
  const [transactions, setTransactions] = useState([])
  const [usdRate, setUsdRate]     = useState(950)
  const [allCategories, setAllCategories] = useState([])
  const [isEditing, setIsEditing] = useState(false)
  const [editLimits, setEditLimits] = useState({})
  const [saving, setSaving]       = useState(false)

  useEffect(() => { setCurrentMonth(getCurrentMonth()) }, [])

  const load = useCallback(async (month) => {
    const [allBudgets, txs, settings, cats] = await Promise.all([
      getBudgets(), getTransactions(month), getSettings(), getCategories()
    ])
    let b = allBudgets.find(b => b.month === month)

    // If no budget for this month, inherit from most recent previous month
    if (!b || b.items.length === 0) {
      const previousBudgets = allBudgets
        .filter(pb => pb.month < month && pb.items && pb.items.length > 0)
        .sort((a, b) => b.month.localeCompare(a.month))
      if (previousBudgets.length > 0) {
        const inherited = previousBudgets[0].items
        // Auto-save inherited limits for this month
        await saveBudget(month, inherited)
        b = { month, items: inherited }
      }
    }

    setBudget(b || { items: [] })
    setTransactions(txs.filter(t => t.type === 'expense'))
    setUsdRate(settings.usdCardExchangeRate ?? 950)
    setAllCategories(cats)
  }, [])

  useEffect(() => { if (currentMonth) load(currentMonth) }, [currentMonth, load])

  if (!currentMonth) return null

  // ── Compute spending per category ─────────────────────────────────────────
  const spentByCategory = {}
  transactions.forEach(tx => {
    const cat = tx.category || 'Sin categoría'
    spentByCategory[cat] = (spentByCategory[cat] || 0) +
      (tx.currency === 'USD' ? tx.amount * usdRate : tx.amount)
  })

  const budgetMap = {}
  budget.items.forEach(i => { budgetMap[i.category] = Number(i.limit) || 0 })

  const budgetedCats = budget.items.map(i => i.category)
  const unbudgetedWithSpend = Object.keys(spentByCategory)
    .filter(c => !budgetedCats.includes(c))
    .sort((a, b) => (spentByCategory[b] || 0) - (spentByCategory[a] || 0))

  const allRows = [
    ...budgetedCats.map(c => ({ category: c, limit: budgetMap[c] || 0, budgeted: true })),
    ...unbudgetedWithSpend.map(c => ({ category: c, limit: 0, budgeted: false })),
  ]

  const totalBudgeted = allRows.reduce((s, r) => s + r.limit, 0)
  const totalSpent    = Object.values(spentByCategory).reduce((s, v) => s + v, 0)
  const totalDiff     = totalBudgeted - totalSpent

  // ── Edit helpers ──────────────────────────────────────────────────────────
  const startEdit = () => {
    const init = {}
    // Only show categories that have a budget limit OR spending in this month
    const relevantCats = new Set([...budgetedCats, ...Object.keys(spentByCategory)])
    relevantCats.forEach(c => { init[c] = budgetMap[c] > 0 ? String(budgetMap[c]) : '' })
    setEditLimits(init)
    setIsEditing(true)
  }

  const cancelEdit = () => setIsEditing(false)

  const saveEdit = async () => {
    setSaving(true)
    const newItems = Object.entries(editLimits)
      .map(([category, val]) => ({
        category,
        limit: Number(String(val).replace(/\./g, '').replace(',', '.')) || 0
      }))
      .filter(i => i.limit > 0)
    await saveBudget(currentMonth, newItems)
    await load(currentMonth)
    setIsEditing(false)
    setSaving(false)
  }

  const vColor = (spent, limit) => {
    if (!limit) return 'var(--color-text-secondary)'
    const pct = (spent / limit) * 100
    if (pct >= 100) return 'var(--color-danger)'
    if (pct >= 80)  return '#f59e0b'
    return 'var(--color-success)'
  }

  const cell  = { padding: '12px 16px', verticalAlign: 'middle', borderBottom: '1px solid var(--color-border)', fontSize: '0.9rem' }
  const hcell = { ...cell, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '8px 16px', borderBottom: '2px solid var(--color-border)' }

  const displayRows = isEditing
    ? [...new Set([...budgetedCats, ...Object.keys(spentByCategory)])]
    : allRows.map(r => r.category)

  return (
    <div className="animate-fadeIn">
      <Header title="Presupuestos">
        <MonthSelector currentMonth={currentMonth} onMonthChange={setCurrentMonth} />
      </Header>

      <div className="container">
        {/* Summary cards */}
        <div className="summary-grid mb-6">
          <div className="card">
            <div className="summary-label">Total Presupuestado</div>
            <div className="summary-value">{formatCurrency(totalBudgeted)}</div>
          </div>
          <div className="card">
            <div className="summary-label">Total Gastado</div>
            <div className="summary-value" style={{ color: totalSpent > totalBudgeted && totalBudgeted > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
              {formatCurrency(totalSpent)}
            </div>
          </div>
          <div className="card">
            <div className="summary-label">Disponible</div>
            <div className="summary-value" style={{ color: totalDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {formatCurrency(totalDiff)}
            </div>
          </div>
        </div>

        {/* Table card */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
            <h2 style={{ margin: 0 }}>Categorías</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              {isEditing ? (
                <>
                  <button onClick={cancelEdit} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
                    Cancelar
                  </button>
                  <button onClick={saveEdit} disabled={saving} className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
                    {saving ? 'Guardando…' : '💾 Guardar'}
                  </button>
                </>
              ) : (
                <button onClick={startEdit} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
                  ✏️ Editar límites
                </button>
              )}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...hcell, textAlign: 'left', width: '32%' }}>Categoría</th>
                  <th style={{ ...hcell, textAlign: 'right', width: '22%' }}>Presupuestado</th>
                  <th style={{ ...hcell, textAlign: 'right', width: '22%' }}>Gastado</th>
                  <th style={{ ...hcell, textAlign: 'center', width: '12%' }}>Uso</th>
                  <th style={{ ...hcell, textAlign: 'center', width: '12%' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map(cat => {
                  const row     = allRows.find(r => r.category === cat) || { category: cat, limit: 0, budgeted: false }
                  const spent   = spentByCategory[cat] || 0
                  const editVal = editLimits[cat] ?? ''
                  const limit   = isEditing
                    ? (Number(String(editVal).replace(/\./g, '').replace(',', '.')) || 0)
                    : row.limit
                  const pct     = limit > 0 ? Math.round((spent / limit) * 100) : null
                  const over    = limit > 0 && spent > limit
                  const isBudgeted = isEditing ? limit > 0 : row.budgeted

                  return (
                    <tr
                      key={cat}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Category */}
                      <td style={cell}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600 }}>{cat}</span>
                          {over && !isEditing && <span style={{ fontSize: '0.8rem' }}>⚠️</span>}
                        </div>
                      </td>

                      {/* Budget limit (editable) */}
                      <td style={{ ...cell, textAlign: 'right' }}>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="1000"
                            placeholder="Sin límite"
                            value={editVal}
                            onChange={e => setEditLimits(prev => ({ ...prev, [cat]: e.target.value }))}
                            style={{
                              width: '140px', textAlign: 'right', padding: '5px 8px',
                              border: '1px solid var(--color-primary)', borderRadius: '6px',
                              background: 'var(--bg-primary)', color: 'var(--color-text)',
                              fontSize: '0.88rem', outline: 'none',
                            }}
                          />
                        ) : (
                          <span style={{
                            color: row.budgeted ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                            fontStyle: row.budgeted ? 'normal' : 'italic'
                          }}>
                            {row.budgeted && row.limit > 0 ? formatCurrency(row.limit) : '—'}
                          </span>
                        )}
                      </td>

                      {/* Spent */}
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 600, color: spent > 0 ? (over ? 'var(--color-danger)' : 'var(--color-text)') : 'var(--color-text-tertiary)' }}>
                        {spent > 0
                          ? formatCurrency(spent)
                          : <span style={{ fontWeight: 400, fontStyle: 'italic' }}>—</span>}
                      </td>

                      {/* Usage % */}
                      <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: vColor(spent, limit), fontSize: '0.88rem' }}>
                        {pct !== null ? (
                          <>
                            <div>{pct}%</div>
                            {over && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-danger)', fontWeight: 600 }}>
                                +{formatCurrency(spent - limit)}
                              </div>
                            )}
                          </>
                        ) : '—'}
                      </td>

                      {/* Status badge */}
                      <td style={{ ...cell, textAlign: 'center' }}>
                        {isBudgeted ? (
                          over ? (
                            <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Excedido
                            </span>
                          ) : pct !== null && pct >= 80 ? (
                            <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Por llegar
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              OK
                            </span>
                          )
                        ) : (
                          <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'var(--bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                            Sin límite
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}

                {/* Totals row */}
                {allRows.length > 0 && !isEditing && (
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <td style={{ ...cell, fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>TOTAL</td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                      {formatCurrency(totalBudgeted)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)', color: totalSpent > totalBudgeted && totalBudgeted > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                      {formatCurrency(totalSpent)}
                    </td>
                    <td style={{ ...cell, textAlign: 'center', fontWeight: 700, borderTop: '2px solid var(--color-border)', color: totalDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {totalBudgeted > 0 ? `${Math.round((totalSpent / totalBudgeted) * 100)}%` : '—'}
                    </td>
                    <td style={{ ...cell, borderTop: '2px solid var(--color-border)' }}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
