'use client'
import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/Header'
import MonthSelector from '@/components/MonthSelector'
import {
  getBudgets, getTransactions, getSettings, saveBudget, saveBudgetAndPropagate, getCategories,
  getRecurring, addRecurring, updateRecurring, deleteRecurringFrom,
  deleteFutureRecurringTxsAfter, generateRecurringForMonth, saveSettings,
  getAccounts
} from '@/lib/db'
import { getCurrentMonth, formatCurrency, getPreviousMonth, formatMonthDisplay } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

function parseInputNumber(val) {
  if (!val && val !== 0) return 0
  let str = String(val).trim()
  if (!str) return 0
  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.')
    const num = Number(str)
    return isNaN(num) ? 0 : num
  }
  if (/\.\d{1,2}$/.test(str)) {
    const lastDotIdx = str.lastIndexOf('.')
    const intPart = str.substring(0, lastDotIdx).replace(/\./g, '')
    const decPart = str.substring(lastDotIdx + 1)
    str = `${intPart}.${decPart}`
    const num = Number(str)
    return isNaN(num) ? 0 : num
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
    str = str.replace(/\./g, '')
  }
  const num = Number(str)
  return isNaN(num) ? 0 : num
}

const nextMonthStr = (monthStr) => {
  const [year, month] = monthStr.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

export default function Presupuestos() {
  const [isPrivate] = usePrivacyMode()
  const [currentMonth, setCurrentMonth] = useState('')
  const [budget, setBudget]       = useState({ items: [] })
  const [transactions, setTransactions] = useState([])
  const [incomes, setIncomes]           = useState([])
  const [usdRate, setUsdRate]           = useState(950)
  const [allCategories, setAllCategories] = useState([])
  const [isEditing, setIsEditing]       = useState(false)
  const [editLimits, setEditLimits]     = useState({})
  const [removedCats, setRemovedCats]   = useState(new Set())
  const [saving, setSaving]             = useState(false)

  // Recurring state
  const [recurringItems, setRecurringItems] = useState([])
  const [accounts, setAccounts]         = useState([])
  const [settings, setSettings]         = useState({})
  const [showRecForm, setShowRecForm]   = useState(false)
  const [recSaving, setRecSaving]       = useState(false)
  const [newRec, setNewRec] = useState({
    type: 'expense', description: '', category: '', amount: '', currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1
  })
  const [editRecItem, setEditRecItem] = useState(null)
  const [editRecData, setEditRecData] = useState({
    type: 'expense', description: '', category: '', amount: '', currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1
  })

  useEffect(() => { setCurrentMonth(getCurrentMonth()) }, [])

  const load = useCallback(async (month) => {
    await generateRecurringForMonth(month)
    let [allBudgets, txs, s, cats, rec, accs] = await Promise.all([
      getBudgets(), getTransactions(month), getSettings(), getCategories(), getRecurring(), getAccounts()
    ])

    // Auto-migration: If September 2026 budget exists and forward propagation has not yet occurred,
    // propagate September's 3-channel budget forward to clean legacy single-channel items in Oct/Nov.
    if (!s.budgetPropagatedSept2026) {
      const septBudget = allBudgets.find(b => b.month === '2026-09')
      if (septBudget && septBudget.items && septBudget.items.length > 0) {
        await saveBudgetAndPropagate('2026-09', septBudget.items, 12)
        const updatedSettings = { ...s, budgetPropagatedSept2026: true }
        await saveSettings(updatedSettings)
        s = updatedSettings
        allBudgets = await getBudgets()
      }
    }

    let b = allBudgets.find(b => b.month === month)

    if (!b || b.items.length === 0) {
      const previousBudgets = allBudgets
        .filter(pb => pb.month < month && pb.items && pb.items.length > 0)
        .sort((a, b) => b.month.localeCompare(a.month))
      const futureBudgets = allBudgets
        .filter(pb => pb.month > month && pb.items && pb.items.length > 0)
        .sort((a, b) => a.month.localeCompare(b.month))
      const nearest = previousBudgets[0] || futureBudgets[0]
      if (nearest) {
        const inherited = nearest.items
        await saveBudgetAndPropagate(month, inherited, 12)
        b = { month, items: inherited }
      }
    }

    setBudget(b || { items: [] })
    setTransactions(txs.filter(t => t.type === 'expense'))
    setIncomes(txs.filter(t => t.type === 'income'))
    setUsdRate(s.usdCardExchangeRate ?? 950)
    setAllCategories(cats)
    setRecurringItems(rec)
    setAccounts(accs)
    setSettings(s)
  }, [])

  useEffect(() => { if (currentMonth) load(currentMonth) }, [currentMonth, load])

  if (!currentMonth) return null

  const isCardPayment = (method) =>
    method === 'credit_card_clp' || method === 'credit_card_usd'

  const spentCardCLP = {}
  const spentCashCLP = {}
  const spentUSD     = {}

  transactions.forEach(tx => {
    const countsTowardBudget = (!tx.isRecurring && isCardPayment(tx.paymentMethod)) ||
      tx.isExecuted ||
      tx.isPaid === true
    if (!countsTowardBudget) return
    const cat = tx.category || 'Sin categoría'
    if (tx.currency === 'USD' || tx.paymentMethod === 'credit_card_usd') {
      spentUSD[cat] = (spentUSD[cat] || 0) + tx.amount
    } else if (tx.paymentMethod === 'credit_card_clp') {
      spentCardCLP[cat] = (spentCardCLP[cat] || 0) + tx.amount
    } else {
      spentCashCLP[cat] = (spentCashCLP[cat] || 0) + tx.amount
    }
  })

  const budgetMapCard = {}
  const budgetMapCash = {}
  const budgetMapUSD  = {}

  budget.items.forEach(i => {
    const cardVal = i.limitCard !== undefined && i.limitCard !== null && i.limitCard !== ''
      ? Number(i.limitCard) || 0
      : (i.limit ? Number(i.limit) || 0 : 0)
    const cashVal = i.limitCash !== undefined && i.limitCash !== null && i.limitCash !== ''
      ? Number(i.limitCash) || 0
      : 0
    const usdVal  = i.limitUSD !== undefined && i.limitUSD !== null && i.limitUSD !== ''
      ? Number(i.limitUSD) || 0
      : 0
    if (cardVal) budgetMapCard[i.category] = cardVal
    if (cashVal) budgetMapCash[i.category] = cashVal
    if (usdVal)  budgetMapUSD[i.category]  = usdVal
  })

  const budgetedCats = budget.items.map(i => i.category)
  const spentCats = new Set([
    ...Object.keys(spentCardCLP),
    ...Object.keys(spentCashCLP),
    ...Object.keys(spentUSD)
  ])
  const unbudgetedWithSpend = Array.from(spentCats).filter(c => !budgetedCats.includes(c))

  const allRows = [
    ...budgetedCats.map(c => ({
      category: c,
      limitCard: budgetMapCard[c] || 0,
      limitCash: budgetMapCash[c] || 0,
      limitUSD:  budgetMapUSD[c] || 0,
      budgeted: true
    })),
    ...unbudgetedWithSpend.map(c => ({
      category: c, limitCard: 0, limitCash: 0, limitUSD: 0, budgeted: false
    })),
  ].sort((a, b) => {
    const totalA = a.limitCard + a.limitCash + (a.limitUSD * usdRate)
    const totalB = b.limitCard + b.limitCash + (b.limitUSD * usdRate)
    if (totalB !== totalA) return totalB - totalA
    return a.category.localeCompare(b.category, 'es')
  })

  const totalCardBudget = Object.values(budgetMapCard).reduce((s, v) => s + v, 0)
  const totalCashBudget = Object.values(budgetMapCash).reduce((s, v) => s + v, 0)
  const totalUSDBudget  = Object.values(budgetMapUSD).reduce((s, v) => s + v, 0)
  const totalCardSpent = Object.values(spentCardCLP).reduce((s, v) => s + v, 0)
  const totalCashSpent = Object.values(spentCashCLP).reduce((s, v) => s + v, 0)
  const totalUSDSpent  = Object.values(spentUSD).reduce((s, v) => s + v, 0)
  const totalBudgetedCLP = totalCardBudget + totalCashBudget + (totalUSDBudget * usdRate)
  const totalSpentCLP    = totalCardSpent + totalCashSpent + (totalUSDSpent * usdRate)
  const totalDiff        = totalBudgetedCLP - totalSpentCLP

  const startEdit = () => {
    const init = {}
    const relevantCats = new Set([...budgetedCats, ...spentCats])
    relevantCats.forEach(c => {
      const item = budget.items.find(i => i.category === c)
      const cardVal = item && item.limitCard !== undefined ? item.limitCard : (item ? item.limit : '')
      const cashVal = item && item.limitCash !== undefined ? item.limitCash : ''
      const usdVal  = item && item.limitUSD !== undefined ? item.limitUSD : ''
      init[c] = {
        card: cardVal ? String(cardVal).replace('.', ',') : '',
        cash: cashVal ? String(cashVal).replace('.', ',') : '',
        usd:  usdVal ? String(usdVal).replace('.', ',') : ''
      }
    })
    setEditLimits(init)
    setRemovedCats(new Set())
    setIsEditing(true)
  }

  const cancelEdit = () => { setIsEditing(false); setRemovedCats(new Set()) }

  const removeFromBudget = (cat) => {
    setRemovedCats(prev => new Set([...prev, cat]))
    setEditLimits(prev => { const n = { ...prev }; delete n[cat]; return n })
  }

  const saveEdit = async () => {
    setSaving(true)
    const newItems = Object.entries(editLimits)
      .map(([category, vals]) => {
        const limitCard = parseInputNumber(vals?.card)
        const limitCash = parseInputNumber(vals?.cash)
        const limitUSD  = parseInputNumber(vals?.usd)
        const item = { category }
        if (limitCard > 0) item.limitCard = limitCard
        if (limitCash > 0) item.limitCash = limitCash
        if (limitUSD > 0)  item.limitUSD  = limitUSD
        return item
      })
      .filter(i => i.limitCard > 0 || i.limitCash > 0 || i.limitUSD > 0)
    setBudget(prev => ({ ...prev, items: newItems }))
    setIsEditing(false)
    setSaving(false)
    // Save current month AND propagate forward to subsequent 12 months so changes persist across months
    await saveBudgetAndPropagate(currentMonth, newItems, 12)
    await load(currentMonth)
  }

  const handleCopyFromPreviousMonth = async () => {
    const prevMonthStr = getPreviousMonth(currentMonth)
    const allBudgets = await getBudgets()
    const prevBudget = allBudgets.find(b => b.month === prevMonthStr)
    if (!prevBudget || !prevBudget.items?.length) {
      alert(`No se encontró un presupuesto configurado en ${formatMonthDisplay(prevMonthStr)}.`)
      return
    }
    if (confirm(`¿Copiar el presupuesto de ${formatMonthDisplay(prevMonthStr)} a ${formatMonthDisplay(currentMonth)} y los meses siguientes?`)) {
      setSaving(true)
      await saveBudgetAndPropagate(currentMonth, prevBudget.items, 12)
      await load(currentMonth)
      setSaving(false)
    }
  }

  // Recurring handlers
  const handleAddRecurring = async (e) => {
    e.preventDefault()
    if (!newRec.description.trim() || !newRec.amount) return
    setRecSaving(true)
    await addRecurring({
      type: newRec.type || 'expense',
      description: newRec.description,
      category: newRec.category || newRec.description,
      amount: Number(newRec.amount),
      currency: newRec.currency,
      paymentMethod: newRec.paymentMethod,
      dayOfMonth: Number(newRec.dayOfMonth)
    })
    setRecurringItems(await getRecurring())
    setNewRec({ type: 'expense', description: '', category: '', amount: '', currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1 })
    setShowRecForm(false)
    setRecSaving(false)
  }

  const handleToggleRecurring = async (item) => {
    const paused = settings.pausedRecurrents || {}
    const pausedFrom = paused[item.id]
    const isActive = !pausedFrom || pausedFrom > currentMonth
    if (isActive) {
      const newPaused = { ...paused, [item.id]: currentMonth }
      const updatedSettings = { ...settings, pausedRecurrents: newPaused }
      setSettings(updatedSettings)
      await saveSettings(updatedSettings)
      await deleteFutureRecurringTxsAfter(item.description, currentMonth)
    } else {
      const newPaused = { ...paused }
      delete newPaused[item.id]
      const updatedSettings = { ...settings, pausedRecurrents: newPaused }
      setSettings(updatedSettings)
      await saveSettings(updatedSettings)
      const realNow = new Date().toISOString().substring(0, 7)
      if (currentMonth >= realNow) {
        await generateRecurringForMonth(currentMonth)
        await load(currentMonth)
      }
    }
  }

  const handleDeleteRecurring = async (item) => {
    if (!confirm(`¿Eliminar "${item.description}"? Se borrarán las transacciones de ${currentMonth} en adelante.`)) return
    const newPaused = { ...(settings.pausedRecurrents || {}) }
    delete newPaused[item.id]
    const updatedSettings = { ...settings, pausedRecurrents: newPaused }
    setSettings(updatedSettings)
    await saveSettings(updatedSettings)
    await deleteRecurringFrom(item.id, currentMonth)
    setRecurringItems(await getRecurring())
  }

  const handleStartEditRecurring = (item) => {
    setEditRecItem(item)
    setEditRecData({
      type: item.type || 'expense',
      description: item.description,
      category: item.category || item.description,
      amount: String(item.amount),
      currency: item.currency,
      paymentMethod: item.paymentMethod,
      dayOfMonth: String(item.dayOfMonth)
    })
  }

  const handleSaveRecurringEdit = async (e) => {
    e.preventDefault()
    if (!editRecData.description.trim() || !editRecData.amount) return
    await updateRecurring(editRecItem.id, {
      type: editRecData.type || 'expense',
      description: editRecData.description,
      category: editRecData.category || editRecData.description,
      amount: Number(editRecData.amount),
      currency: editRecData.currency,
      paymentMethod: editRecData.paymentMethod,
      dayOfMonth: Number(editRecData.dayOfMonth)
    })
    setEditRecItem(null)
    await load(currentMonth)
  }

  const vColor = (spent, limit) => {
    if (!limit) return 'var(--color-text-secondary)'
    const pct = Math.round((spent / limit) * 100)
    if (pct > 100)  return 'var(--color-danger)'
    if (pct === 100) return 'var(--color-success)'
    if (pct >= 90)  return '#f59e0b'
    return 'var(--color-success)'
  }

  const paymentLabel = (method) => {
    const acc = accounts.find(a => a.id === method)
    if (acc) return acc.name
    if (method === 'cash') return 'Efectivo'
    if (method === 'transfer') return 'Transferencia'
    if (method === 'credit_card_clp') return 'Tarjeta CLP'
    if (method === 'credit_card_usd') return 'Tarjeta USD'
    return method
  }

  const cell  = { padding: '10px 12px', verticalAlign: 'middle', borderBottom: '1px solid var(--color-border)', fontSize: '0.88rem' }
  const hcell = { ...cell, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '8px 12px', borderBottom: '2px solid var(--color-border)' }

  const displayRows = isEditing
    ? [...new Set([...budgetedCats, ...spentCats])].filter(c => !removedCats.has(c))
    : allRows.map(r => r.category)

  const sortedRecurring = [...recurringItems].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '', 'es', { sensitivity: 'base' })
  )

  const paused = settings.pausedRecurrents || {}
  const isRecActive = (item) => !paused[item.id] || paused[item.id] > currentMonth

  // Recurring amounts per category (CLP equivalent, expenses only, active items)
  const recurringByCatCLP = {}
  recurringItems.forEach(item => {
    if (item.type === 'income') return
    if (!isRecActive(item)) return
    const cat = item.category || item.description
    const amtCLP = item.currency === 'USD' ? (item.amount * usdRate) : item.amount
    recurringByCatCLP[cat] = (recurringByCatCLP[cat] || 0) + amtCLP
  })
  const totalRecurringCLP = Object.values(recurringByCatCLP).reduce((s, v) => s + v, 0)

  // Ingresos del mes: transacciones reales de ingreso vs recurrentes activos de ingreso
  const txIncomeCLP = incomes.reduce((sum, t) => {
    const amtCLP = t.currency === 'USD' ? (Number(t.amount) * usdRate) : Number(t.amount)
    return sum + amtCLP
  }, 0)

  const activeRecurringIncomes = recurringItems.filter(item => item.type === 'income' && isRecActive(item))
  const recIncomeCLP = activeRecurringIncomes.reduce((sum, item) => {
    const amtCLP = item.currency === 'USD' ? (Number(item.amount) * usdRate) : Number(item.amount)
    return sum + amtCLP
  }, 0)

  // Si hay transacciones de ingreso del mes (incluyendo las generadas por recurrentes), usamos su suma;
  // si el mes seleccionado aún no tiene transacciones pero sí recurrentes activos, usamos la proyección de recurrentes
  const totalIncomeCLP = txIncomeCLP > 0 ? txIncomeCLP : recIncomeCLP

  const incomeList = incomes.length > 0 
    ? incomes.map(t => `${t.description}: ${formatCurrency(t.amount, t.currency)}${t.isPaid ? ' (Pagado)' : ' (Pendiente)'}`)
    : activeRecurringIncomes.map(r => `${r.description}: ${formatCurrency(r.amount, r.currency)} (Fijo mensual)`)

  // Margen disponible para ahorro (Ingresos - Total Presupuestado)
  const disponibleAhorro = totalIncomeCLP > 0 ? (totalIncomeCLP - totalBudgetedCLP) : 0
  const pctAhorro = totalIncomeCLP > 0 ? Math.round((disponibleAhorro / totalIncomeCLP) * 100) : 0
  const pctPresupuestado = totalIncomeCLP > 0 ? Math.round((totalBudgetedCLP / totalIncomeCLP) * 100) : 0
  const pctGastado = totalBudgetedCLP > 0 ? Math.round((totalSpentCLP / totalBudgetedCLP) * 100) : 0

  return (
    <>
      <div className="animate-fadeIn">
        <Header title="Presupuestos">
          <MonthSelector currentMonth={currentMonth} onMonthChange={setCurrentMonth} />
        </Header>

        <div className="container">
          {/* Summary cards */}
          <div className="summary-grid mb-6">
            {/* 1. Total Ingresos */}
            <div 
              className="card" 
              style={{ borderLeft: '4px solid var(--color-success)', cursor: 'default' }}
              title={incomeList.length > 0 ? `Ingresos del período:\n${incomeList.join('\n')}` : 'Sin ingresos registrados'}
            >
              <div className="summary-label text-success" style={{ fontWeight: 700 }}>Total Ingresos</div>
              <div className="summary-value text-success">{formatCurrency(totalIncomeCLP)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {totalIncomeCLP > 0 
                  ? (incomes.length > 0 ? `${incomes.length} ingreso${incomes.length === 1 ? '' : 's'} en el mes` : 'Proyección recurrente')
                  : 'Sin ingresos registrados'}
              </div>
            </div>

            {/* 2. Total Presupuestado */}
            <div className="card" style={{ borderLeft: '4px solid var(--color-primary)', cursor: 'default' }}>
              <div className="summary-label" style={{ fontWeight: 700 }}>Total Presupuestado</div>
              <div className="summary-value">{formatCurrency(totalBudgetedCLP)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {totalIncomeCLP > 0 ? `${pctPresupuestado}% de los ingresos` : 'Límite de gastos'}
              </div>
            </div>

            {/* 3. Disponible para Ahorro */}
            <div 
              className="card" 
              style={{ 
                borderLeft: `4px solid ${disponibleAhorro >= 0 ? '#10B981' : 'var(--color-danger)'}`,
                cursor: 'default'
              }}
              title="Margen de ahorro: Ingresos menos Total Presupuestado"
            >
              <div 
                className="summary-label" 
                style={{ 
                  color: disponibleAhorro >= 0 ? 'var(--color-success)' : 'var(--color-danger)', 
                  fontWeight: 700 
                }}
              >
                Disponible para Ahorro
              </div>
              <div 
                className="summary-value" 
                style={{ color: disponibleAhorro >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
              >
                {formatCurrency(disponibleAhorro)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {totalIncomeCLP > 0 
                  ? (disponibleAhorro >= 0 ? `${pctAhorro}% margen para ahorrar` : 'Presupuesto supera ingresos')
                  : 'Ingresos − Presupuesto'}
              </div>
            </div>

            {/* 4. Total Gastado */}
            <div className="card" style={{ borderLeft: '4px solid var(--color-text-tertiary)', cursor: 'default' }}>
              <div className="summary-label" style={{ fontWeight: 700 }}>Total Gastado</div>
              <div 
                className="summary-value" 
                style={{ color: totalSpentCLP > totalBudgetedCLP && totalBudgetedCLP > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}
              >
                {formatCurrency(totalSpentCLP)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {totalBudgetedCLP > 0 ? `${pctGastado}% del presupuesto gastado` : 'Gasto acumulado'}
              </div>
            </div>

            {/* 5. Disponible Presupuesto */}
            <div className="card" style={{ borderLeft: `4px solid ${totalDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}`, cursor: 'default' }}>
              <div className="summary-label" style={{ fontWeight: 700 }}>Disponible Presupuesto</div>
              <div 
                className="summary-value" 
                style={{ color: totalDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
              >
                {formatCurrency(totalDiff)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Restante por gastar
              </div>
            </div>
          </div>

          {/* Categorías table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ margin: 0 }}>Categorías</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                {isEditing ? (
                  <>
                    <button onClick={cancelEdit} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>Cancelar</button>
                    <button onClick={saveEdit} disabled={saving} className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
                      {saving ? 'Guardando…' : '💾 Guardar'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleCopyFromPreviousMonth}
                      disabled={saving}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem', padding: '6px 14px' }}
                      title="Copiar el presupuesto del mes anterior a este mes y meses siguientes"
                    >
                      🔄 Copiar mes anterior
                    </button>
                    <button onClick={startEdit} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>✏️ Editar límites</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...hcell, textAlign: 'left', width: '17%' }}>Categoría</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '11%' }}>Pres. Tarjeta</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '10%' }}>Gastado Tarj.</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '11%' }}>Pres. Cuentas</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '10%' }}>Gastado Cuentas</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '8%' }}>Pres. USD</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '8%' }}>Gastado USD</th>
                    <th style={{ ...hcell, textAlign: 'right', width: '11%', color: 'var(--color-accent)', borderBottom: '2px solid var(--color-accent)' }}>Recurrente</th>
                    <th style={{ ...hcell, textAlign: 'center', width: '7%' }}>Uso</th>
                    <th style={{ ...hcell, textAlign: 'center', width: '7%' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(cat => {
                    const row = allRows.find(r => r.category === cat) || { category: cat, limitCard: 0, limitCash: 0, limitUSD: 0, budgeted: false }
                    const editVal = editLimits[cat] || { card: '', cash: '', usd: '' }
                    const limitCard = isEditing ? parseInputNumber(editVal.card) : row.limitCard
                    const limitCash = isEditing ? parseInputNumber(editVal.cash) : row.limitCash
                    const limitUSD  = isEditing ? parseInputNumber(editVal.usd)  : row.limitUSD
                    const sCard = spentCardCLP[cat] || 0
                    const sCash = spentCashCLP[cat] || 0
                    const sUSD  = spentUSD[cat] || 0
                    const spentTotalCLP = sCard + sCash + (sUSD * usdRate)
                    const limitTotalCLP = limitCard + limitCash + (limitUSD * usdRate)
                    const pct = limitTotalCLP > 0 ? Math.round((spentTotalCLP / limitTotalCLP) * 100) : null
                    const over = pct !== null && pct > 100
                    const isBudgeted = isEditing ? (limitCard > 0 || limitCash > 0 || limitUSD > 0) : row.budgeted

                    return (
                      <tr key={cat}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={cell}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 600 }}>{cat}</span>
                            {over && !isEditing && <span style={{ fontSize: '0.8rem' }}>⚠️</span>}
                            {isEditing && (
                              <button onClick={() => removeFromBudget(cat)} title="Quitar del presupuesto"
                                style={{ marginLeft: '4px', border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 2px', opacity: 0.7 }}>×</button>
                            )}
                          </div>
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {isEditing ? (
                            <input type="text" inputMode="decimal" placeholder="Tarj CLP" value={editVal.card ?? ''}
                              onChange={e => setEditLimits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), card: e.target.value } }))}
                              style={{ width: '95px', textAlign: 'right', padding: '4px 6px', border: '1px solid var(--color-primary)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--color-text)', fontSize: '0.85rem', outline: 'none' }} />
                          ) : (
                            <span style={{ color: limitCard > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)', fontStyle: limitCard > 0 ? 'normal' : 'italic' }}>
                              {limitCard > 0 ? formatCurrency(limitCard) : '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: sCard > 0 ? 600 : 400, color: sCard > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
                          {sCard > 0 ? formatCurrency(sCard) : <span style={{ fontStyle: 'italic' }}>—</span>}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {isEditing ? (
                            <input type="text" inputMode="decimal" placeholder="Cuentas CLP" value={editVal.cash ?? ''}
                              onChange={e => setEditLimits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), cash: e.target.value } }))}
                              style={{ width: '95px', textAlign: 'right', padding: '4px 6px', border: '1px solid var(--color-primary)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--color-text)', fontSize: '0.85rem', outline: 'none' }} />
                          ) : (
                            <span style={{ color: limitCash > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)', fontStyle: limitCash > 0 ? 'normal' : 'italic' }}>
                              {limitCash > 0 ? formatCurrency(limitCash) : '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: sCash > 0 ? 600 : 400, color: sCash > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
                          {sCash > 0 ? formatCurrency(sCash) : <span style={{ fontStyle: 'italic' }}>—</span>}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {isEditing ? (
                            <input type="text" inputMode="decimal" placeholder="USD" value={editVal.usd ?? ''}
                              onChange={e => setEditLimits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), usd: e.target.value } }))}
                              style={{ width: '75px', textAlign: 'right', padding: '4px 6px', border: '1px solid var(--color-primary)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--color-text)', fontSize: '0.85rem', outline: 'none' }} />
                          ) : (
                            <span style={{ color: limitUSD > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)', fontStyle: limitUSD > 0 ? 'normal' : 'italic' }}>
                              {limitUSD > 0 ? formatCurrency(limitUSD, 'USD') : '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: sUSD > 0 ? 600 : 400, color: sUSD > 0 ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
                          {sUSD > 0 ? formatCurrency(sUSD, 'USD') : <span style={{ fontStyle: 'italic' }}>—</span>}
                        </td>
                        {/* Recurrente */}
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {recurringByCatCLP[cat] > 0 ? (
                            <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
                              {formatCurrency(recurringByCatCLP[cat])}
                            </span>
                          ) : (
                            <span style={{ fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: vColor(spentTotalCLP, limitTotalCLP), fontSize: '0.85rem' }}>
                          {pct !== null ? (
                            <>
                              <div>{pct}%</div>
                              {over && <div style={{ fontSize: '0.68rem', color: 'var(--color-danger)', fontWeight: 600 }}>+{formatCurrency(spentTotalCLP - limitTotalCLP)}</div>}
                            </>
                          ) : '—'}
                        </td>
                        <td style={{ ...cell, textAlign: 'center' }}>
                          {isBudgeted ? (
                            over ? (
                              <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>Excedido</span>
                            ) : pct !== null && pct >= 90 && pct < 100 ? (
                              <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>Por llegar</span>
                            ) : (
                              <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>OK</span>
                            )
                          ) : (
                            <span style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '20px', background: 'var(--bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>Sin límite</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {allRows.length > 0 && !isEditing && (
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <td style={{ ...cell, fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>TOTAL</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalCardBudget)}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalCardSpent)}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalCashBudget)}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalCashSpent)}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalUSDBudget, 'USD')}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>{formatCurrency(totalUSDSpent, 'USD')}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--color-border)', color: 'var(--color-accent)' }}>
                        {totalRecurringCLP > 0 ? formatCurrency(totalRecurringCLP) : '—'}
                      </td>
                      <td style={{ ...cell, textAlign: 'center', fontWeight: 700, borderTop: '2px solid var(--color-border)', color: totalDiff >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {totalBudgetedCLP > 0 ? `${Math.round((totalSpentCLP / totalBudgetedCLP) * 100)}%` : '—'}
                      </td>
                      <td style={{ ...cell, borderTop: '2px solid var(--color-border)' }}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RECURRENTES SECTION */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <div>
                <h2 style={{ margin: 0 }}>Recurrentes</h2>
                <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                  Gastos e ingresos fijos que se generan automáticamente cada mes
                </p>
              </div>
              <button onClick={() => setShowRecForm(v => !v)} className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
                {showRecForm ? '✕ Cancelar' : '+ Agregar'}
              </button>
            </div>

            {showRecForm && (
              <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)' }}>
                <form onSubmit={handleAddRecurring}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '12px' }}>Nuevo Recurrente</h3>
                  <div className="flex-col gap-4">
                    <div className="flex gap-4">
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="form-label">Tipo</label>
                        <select value={newRec.type || 'expense'} onChange={(e) => { const type = e.target.value; const defaultPM = type === 'income' ? (accounts[0]?.id || 'cash') : 'cash'; setNewRec({ ...newRec, type, paymentMethod: defaultPM }) }} className="select">
                          <option value="expense">Gasto Recurrente</option>
                          <option value="income">Ingreso Recurrente</option>
                        </select>
                      </div>
                      <div className="form-field" style={{ flex: 2 }}>
                        <label className="form-label">Concepto</label>
                        <input type="text" value={newRec.description} onChange={(e) => setNewRec({ ...newRec, description: e.target.value })} className="input" placeholder={newRec.type === 'income' ? 'Ej. Sueldo, Arriendo recibido...' : 'Ej. Netflix, Gimnasio...'} required />
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="form-field" style={{ flex: 2 }}>
                        <label className="form-label">Categoría</label>
                        <select value={newRec.category} onChange={(e) => setNewRec({ ...newRec, category: e.target.value })} className="select">
                          <option value="">— Usar concepto como categoría —</option>
                          {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="form-field" style={{ flex: 2 }}>
                        <label className="form-label">Monto</label>
                        <input type="number" value={newRec.amount} onChange={(e) => setNewRec({ ...newRec, amount: e.target.value })} className="input" required />
                      </div>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="form-label">Moneda</label>
                        <select value={newRec.currency} onChange={(e) => setNewRec({ ...newRec, currency: e.target.value })} className="select">
                          <option value="CLP">CLP</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="form-field" style={{ flex: 2 }}>
                        <label className="form-label">{newRec.type === 'income' ? 'Cuenta / Destino' : 'Método Pago'}</label>
                        <select value={newRec.paymentMethod} onChange={(e) => setNewRec({ ...newRec, paymentMethod: e.target.value })} className="select">
                          {newRec.type === 'income' ? (
                            <>
                              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>)}
                              <option value="cash">Efectivo</option>
                              <option value="transfer">Transferencia (Genérico)</option>
                            </>
                          ) : (
                            <>
                              <optgroup label="Cuentas">
                                {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                {accounts.length === 0 && <option value="cash">Efectivo</option>}
                              </optgroup>
                              <optgroup label="Tarjetas">
                                <option value="credit_card_clp">Tarjeta CLP</option>
                                <option value="credit_card_usd">Tarjeta USD</option>
                              </optgroup>
                            </>
                          )}
                        </select>
                      </div>
                      <div className="form-field" style={{ flex: 1 }}>
                        <label className="form-label">Día del Mes</label>
                        <input type="number" value={newRec.dayOfMonth} onChange={(e) => setNewRec({ ...newRec, dayOfMonth: e.target.value })} className="input" min="1" max="31" required />
                      </div>
                    </div>
                    <button type="submit" disabled={recSaving} className="btn btn-primary w-full">
                      {recSaving ? 'Guardando…' : 'Guardar Recurrente'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              {sortedRecurring.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                  No hay elementos recurrentes. Usa el botón "+ Agregar" para crear uno.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...hcell, textAlign: 'center', width: '6%' }}>Activo</th>
                      <th style={{ ...hcell, textAlign: 'left', width: '18%' }}>Concepto</th>
                      <th style={{ ...hcell, textAlign: 'left', width: '14%' }}>Categoría</th>
                      <th style={{ ...hcell, textAlign: 'center', width: '8%' }}>Tipo</th>
                      <th style={{ ...hcell, textAlign: 'right', width: '14%' }}>Monto</th>
                      <th style={{ ...hcell, textAlign: 'left', width: '18%' }}>Método Pago</th>
                      <th style={{ ...hcell, textAlign: 'center', width: '6%' }}>Día</th>
                      <th style={{ ...hcell, textAlign: 'right', width: '8%' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecurring.map(item => {
                      const active = isRecActive(item)
                      const isIncome = item.type === 'income'
                      return (
                        <tr key={item.id} style={{ opacity: active ? 1 : 0.55 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ ...cell, textAlign: 'center' }}>
                            <input type="checkbox" checked={active} onChange={() => handleToggleRecurring(item)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                              title={active ? `Pausar desde ${currentMonth}` : `Reactivar desde ${currentMonth}`} />
                          </td>
                          <td style={{ ...cell, fontWeight: 600 }}>{item.description}</td>
                          <td style={{ ...cell, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                            {item.category && item.category !== item.description
                              ? item.category
                              : <span style={{ fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}>—</span>}
                          </td>
                          <td style={{ ...cell, textAlign: 'center' }}>
                            <span className={`badge badge-${isIncome ? 'success' : 'warning'}`} style={{ fontSize: '0.63rem', padding: '2px 6px' }}>
                              {isIncome ? 'INGRESO' : 'GASTO'}
                            </span>
                          </td>
                          <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: isIncome ? 'var(--color-success)' : 'var(--color-text)' }}>
                            {isIncome ? '+' : ''}{formatCurrency(item.amount, item.currency)}
                          </td>
                          <td style={{ ...cell, fontSize: '0.83rem', color: 'var(--color-text-secondary)' }}>
                            {paymentLabel(item.paymentMethod)}
                          </td>
                          <td style={{ ...cell, textAlign: 'center', color: 'var(--color-text-secondary)' }}>{item.dayOfMonth}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
                              <button onClick={() => handleStartEditRecurring(item)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px', transition: 'color 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                title="Editar">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                              </button>
                              <button onClick={() => handleDeleteRecurring(item)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px', transition: 'color 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                title="Eliminar desde este mes">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"></polyline>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                  <line x1="10" y1="11" x2="10" y2="17"></line>
                                  <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* EDIT RECURRING MODAL */}
      {editRecItem && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="modal" style={{ maxWidth: '500px', padding: '24px', borderRadius: '16px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Editar Recurrente</h3>
              <button onClick={() => setEditRecItem(null)}
                style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)', lineHeight: 1 }}>
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveRecurringEdit}>
              <div className="modal-body flex-col gap-4" style={{ padding: '16px 0' }}>
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Tipo</label>
                    <select value={editRecData.type || 'expense'} onChange={(e) => { const type = e.target.value; const defaultPM = type === 'income' ? (accounts[0]?.id || 'cash') : 'cash'; setEditRecData({ ...editRecData, type, paymentMethod: defaultPM }) }} className="select">
                      <option value="expense">Gasto Recurrente</option>
                      <option value="income">Ingreso Recurrente</option>
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Concepto</label>
                    <input type="text" value={editRecData.description} onChange={(e) => setEditRecData({ ...editRecData, description: e.target.value })} className="input" required />
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Categoría</label>
                    <select value={editRecData.category} onChange={(e) => setEditRecData({ ...editRecData, category: e.target.value })} className="select">
                      <option value="">— Usar concepto como categoría —</option>
                      {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Monto</label>
                    <input type="number" value={editRecData.amount} onChange={(e) => setEditRecData({ ...editRecData, amount: e.target.value })} className="input" required />
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Moneda</label>
                    <select value={editRecData.currency} onChange={(e) => setEditRecData({ ...editRecData, currency: e.target.value })} className="select">
                      <option value="CLP">CLP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">{editRecData.type === 'income' ? 'Cuenta / Destino' : 'Método Pago'}</label>
                    <select value={editRecData.paymentMethod} onChange={(e) => setEditRecData({ ...editRecData, paymentMethod: e.target.value })} className="select">
                      {editRecData.type === 'income' ? (
                        <>
                          {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>)}
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia (Genérico)</option>
                        </>
                      ) : (
                        <>
                          <optgroup label="Cuentas">
                            {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                            {accounts.length === 0 && <option value="cash">Efectivo</option>}
                          </optgroup>
                          <optgroup label="Tarjetas">
                            <option value="credit_card_clp">Tarjeta CLP</option>
                            <option value="credit_card_usd">Tarjeta USD</option>
                          </optgroup>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Día del Mes</label>
                    <input type="number" value={editRecData.dayOfMonth} onChange={(e) => setEditRecData({ ...editRecData, dayOfMonth: e.target.value })} className="input" min="1" max="31" required />
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '8px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditRecItem(null)} className="btn btn-secondary">Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
