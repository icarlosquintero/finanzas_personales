'use client'
import { useState, useEffect } from 'react'
import { addTransaction, addTransactions, updateTransaction, getCategories, addRecurring, getAccounts, getSettings, saveSettings, getRecurring, getAllTransactions } from '@/lib/db'

export default function BulkTransactionModal({ isOpen, onClose, onAdd, initialItem }) {
  const [categories, setCategories] = useState([])
  const [categoryGroups, setCategoryGroups] = useState({ tarjeta: [], cuenta: [], otras: [] })
  const [recurringCategories, setRecurringCategories] = useState(new Set())
  const [accounts, setAccounts] = useState([])
  const [savingsPct, setSavingsPct] = useState(0)
  const [keywordRules, setKeywordRules] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [closedCards, setClosedCards] = useState({})

  // Compute default date for new rows, bumping to next month if card is closed
  const getDefaultDate = (paymentMethod = 'credit_card_clp') => {
    const today = new Date().toLocaleDateString('sv').substring(0, 10) // YYYY-MM-DD
    const txMonth = today.substring(0, 7)
    if (closedCards[`${paymentMethod}_${txMonth}`]) {
      const [y, m] = txMonth.split('-')
      let nextM = parseInt(m) + 1
      let nextY = parseInt(y)
      if (nextM > 12) { nextM = 1; nextY++ }
      return `${nextY}-${String(nextM).padStart(2, '0')}-01`
    }
    return today
  }
  
  const createEmptyRow = (previousRow = null) => {
    if (previousRow) {
      return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        type: previousRow.type,
        date: previousRow.date,
        description: '',
        amount: '',
        currency: previousRow.currency,
        category: previousRow.category,
        paymentMethod: previousRow.paymentMethod,
        isPaid: previousRow.isPaid,
        isOutOfBudget: previousRow.isOutOfBudget || false,
        applySavingsPct: previousRow.applySavingsPct,
        isRecurring: previousRow.isRecurring,
      }
    }
    
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: 'expense',
      date: getDefaultDate('credit_card_clp'),
      description: '',
      amount: '',
      currency: 'CLP',
      category: 'Generales',
      paymentMethod: 'credit_card_clp',
      isPaid: false,
      isOutOfBudget: false,
      applySavingsPct: true,
      isRecurring: false,
    }
  }

  const [rows, setRows] = useState([createEmptyRow()])

  // Fetch categories, accounts, and settings on mount
  useEffect(() => {
    const load = async () => {
      const [cats, accs, recurring, settings] = await Promise.all([
        getCategories(),
        getAccounts(),
        getRecurring(),
        getSettings()
      ])
      const recCats = new Set(recurring.map(r => r.category || r.description).filter(Boolean))
      setRecurringCategories(recCats)

      const tarjetaSet = new Set()
      const cuentaSet = new Set()

      recurring.forEach(r => {
        const c = r.category || r.description
        if (!c) return
        if (r.paymentMethod && r.paymentMethod.startsWith('credit_card')) {
          tarjetaSet.add(c)
        } else {
          cuentaSet.add(c)
        }
      })

      const allTxs = (await getAllTransactions()).sort((a, b) => b.date.localeCompare(a.date))
      allTxs.forEach(t => {
        const c = t.category
        if (!c) return
        if (tarjetaSet.has(c) || cuentaSet.has(c)) return
        if (t.paymentMethod && t.paymentMethod.startsWith('credit_card')) {
          tarjetaSet.add(c)
        } else {
          cuentaSet.add(c)
        }
      })

      const allKnownCats = new Set(cats)
      tarjetaSet.forEach(c => allKnownCats.add(c))
      cuentaSet.forEach(c => allKnownCats.add(c))

      const sortedCats = Array.from(allKnownCats).sort((a, b) => a.localeCompare(b, 'es'))
      setCategories(sortedCats)
      setAccounts(accs)

      if (settings && settings.savingsPercentage) {
        setSavingsPct(Number(settings.savingsPercentage))
      }
      if (settings && Array.isArray(settings.keywordRules)) {
        setKeywordRules(settings.keywordRules)
      }
      if (settings && settings.closedCards) {
        setClosedCards(settings.closedCards)
      }
    }
    load()
  }, [])

  // Initialize rows when modal opens — fetch settings fresh to always get latest closedCards
  useEffect(() => {
    if (!isOpen) return
    if (initialItem) {
      setRows([{
        id: initialItem.id,
        type: initialItem.type || 'expense',
        date: (initialItem.date || '').substring(0, 10),
        description: initialItem.description || '',
        amount: String(initialItem.amount || ''),
        currency: initialItem.currency || 'CLP',
        category: initialItem.category || 'Generales',
        paymentMethod: initialItem.paymentMethod || 'credit_card_clp',
        isPaid: initialItem.isPaid || false,
        isOutOfBudget: initialItem.isOutOfBudget || false,
        applySavingsPct: initialItem.applySavingsPct !== false,
        isRecurring: initialItem.isRecurring || false,
        isEdit: true
      }])
      return
    }

    // New transaction: fetch settings to compute correct date
    const initDate = async () => {
      const settings = await getSettings()
      const cc = settings?.closedCards || {}
      setClosedCards(cc)
      const today = new Date().toLocaleDateString('sv').substring(0, 10)
      const txMonth = today.substring(0, 7)
      let date = today
      if (cc[`credit_card_clp_${txMonth}`]) {
        const [y, m] = txMonth.split('-')
        let nextM = parseInt(m) + 1
        let nextY = parseInt(y)
        if (nextM > 12) { nextM = 1; nextY++ }
        date = `${nextY}-${String(nextM).padStart(2, '0')}-01`
      }
      setRows([{
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        type: 'expense',
        date,
        description: '',
        amount: '',
        currency: 'CLP',
        category: 'Generales',
        paymentMethod: 'credit_card_clp',
        isPaid: false,
        isOutOfBudget: false,
        applySavingsPct: true,
        isRecurring: false,
      }])
    }
    initDate()
  }, [isOpen, initialItem])

  if (!isOpen) return null

  const handleAddRow = () => {
    const lastRow = rows[rows.length - 1]
    setRows(prev => [...prev, createEmptyRow(lastRow)])
  }

  const handleDeleteRow = (id) => {
    if (rows.length === 1 && !initialItem) return
    setRows(prev => prev.filter(row => row.id !== id))
  }

  const handleRowChange = (id, field, value) => {
    setRows(prev => prev.map(row => {
      if (row.id !== id) return row
      
      let updatedRow = { ...row, [field]: value }
      
      // Auto-categorize by keyword rules when description changes
      if (field === 'description' && value && keywordRules.length > 0 && row.type !== 'income') {
        const descLower = value.toLowerCase()
        const match = keywordRules.find(r => descLower.includes(r.keyword.toLowerCase()))
        if (match) {
          updatedRow.category = match.category
        }
      }

      // Handle dynamic logic when changing type
      if (field === 'type') {
        if (value === 'income') {
          const firstAccount = accounts[0]
          updatedRow.category = 'Ingresos'
          updatedRow.paymentMethod = firstAccount ? firstAccount.id : 'cash'
          updatedRow.currency = firstAccount ? firstAccount.currency : 'CLP'
          updatedRow.isPaid = true
          updatedRow.isOutOfBudget = false
          updatedRow.isRecurring = false
          updatedRow.applySavingsPct = true
        } else {
          updatedRow.category = categories[0] || 'Generales'
          updatedRow.paymentMethod = 'credit_card_clp'
          updatedRow.currency = 'CLP'
          updatedRow.isPaid = false
          updatedRow.isRecurring = false
        }
      }
      
      // Update currency and isPaid dynamically when account changes
      if (field === 'paymentMethod') {
        const selectedAcc = accounts.find(a => a.id === value)
        if (selectedAcc) {
          updatedRow.currency = selectedAcc.currency
          if (row.type === 'expense') {
            updatedRow.isPaid = true
          }
        }
      }

      // Auto-toggle card type if currency changes to match expectations
      if (field === 'currency') {
        if (value === 'USD' && updatedRow.paymentMethod === 'credit_card_clp') {
          updatedRow.paymentMethod = 'credit_card_usd'
        } else if (value === 'CLP' && updatedRow.paymentMethod === 'credit_card_usd') {
          updatedRow.paymentMethod = 'credit_card_clp'
        }
      }

      // Automatic date bumping for closed credit card billing cycles (only for NEW transactions)
      if (!updatedRow.isEdit && (field === 'date' || field === 'paymentMethod')) {
        if (updatedRow.type === 'expense' && updatedRow.paymentMethod.startsWith('credit_card_')) {
          const settings = getSettings()
          const closedCards = settings?.closedCards || {}
          const txMonth = updatedRow.date.substring(0, 7)
          
          if (closedCards[`${updatedRow.paymentMethod}_${txMonth}`]) {
            const [y, m] = txMonth.split('-')
            let nextM = parseInt(m) + 1
            let nextY = parseInt(y)
            if (nextM > 12) {
              nextM = 1
              nextY++
            }
            updatedRow.date = `${nextY}-${String(nextM).padStart(2, '0')}-01`
          }
        } else if (field === 'paymentMethod' && !updatedRow.paymentMethod.startsWith('credit_card_')) {
          // Si cambia a una cuenta/efectivo, devolver la fecha al día de hoy (solo para registros nuevos)
          updatedRow.date = new Date().toLocaleDateString('sv').substring(0, 10)
        }
      }
      
      return updatedRow
    }))
  }

  // Handle keyboard navigation Tab and Enter
  const handleKeyDown = (e, rowIndex, fieldName) => {
    if (e.key === 'Tab' && rowIndex === rows.length - 1 && fieldName === 'optionExtra' && !e.shiftKey) {
      e.preventDefault()
      handleAddRow()
      setTimeout(() => {
        const inputs = document.querySelectorAll('input[name="description"]')
        const lastInput = inputs[inputs.length - 1]
        if (lastInput) lastInput.focus()
      }, 50)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSubmitting) return

    let activeRows = rows
    if (!initialItem) {
      activeRows = rows.filter(row => row.description.trim() !== '' || row.amount !== '')
    }

    if (activeRows.length === 0) {
      onClose()
      return
    }

    const invalidRow = activeRows.find(row => !row.description.trim() || !row.amount || Number(row.amount) <= 0)
    if (invalidRow) {
      alert('Por favor complete la descripción y el monto (mayor a 0) para todas las filas.')
      return
    }

    setIsSubmitting(true)
    try {
      // 1. Fetch settings ONCE
      const settings = await getSettings()
      const closedCards = settings.closedCards || {}
      let executedMap = { ...(settings.executedTxs || {}) }
      let settingsChanged = false

      const AUTO_EJECUTADO_CATEGORIES = ['Generales', 'Salidas', 'Auto', 'Adicionales']
      const recurringToAdd = []

      // If it's a single item edit:
      if (initialItem && initialItem.id) {
        const row = activeRows[0]
        const originalDate = (initialItem.date || '').substring(0, 10)
        const newDate = (row.date || '').substring(0, 10)
        const txMonth = (newDate === originalDate || !newDate)
          ? (initialItem.month || row.date.substring(0, 7))
          : newDate.substring(0, 7)

        const isOutOfBudget = row.type === 'expense' && !!row.isOutOfBudget
        const currentOOB = { ...(settings.outOfBudgetTxs || {}) }
        if (isOutOfBudget) {
          currentOOB[initialItem.id] = true
        } else {
          delete currentOOB[initialItem.id]
        }
        const updatedSettings = { ...settings, outOfBudgetTxs: currentOOB }

        const txData = {
          ...initialItem,
          description: row.description,
          amount: Number(row.amount),
          currency: row.currency,
          date: row.date,
          category: row.category,
          paymentMethod: row.paymentMethod,
          isPaid: row.isPaid,
          isOutOfBudget: isOutOfBudget,
          type: row.type,
          month: txMonth,
          createdAt: row.createdAt || new Date().toISOString(),
          isRecurring: row.type === 'expense' ? row.isRecurring : undefined,
          applySavingsPct: row.type === 'income' ? row.applySavingsPct : undefined,
        }

        // Optimistic UI close and update instantly
        onAdd(txData)
        onClose()

        // Background update to Supabase (tx update + settings save)
        await Promise.all([
          updateTransaction(initialItem.id, txData),
          saveSettings(updatedSettings)
        ])
        return
      }

      // Bulk additions (NEW transactions):
      const txsToInsert = []
      for (const row of activeRows) {
        let txMonth = row.date.substring(0, 7)
        if (!row.isEdit && row.type === 'expense' && row.paymentMethod.startsWith('credit_card_')) {
          if (closedCards[`${row.paymentMethod}_${txMonth}`]) {
            const [y, m] = txMonth.split('-')
            let nextM = parseInt(m) + 1
            let nextY = parseInt(y)
            if (nextM > 12) { nextM = 1; nextY++ }
            txMonth = `${nextY}-${String(nextM).padStart(2, '0')}`
          }
        }

        const isSpecialCategory = row.type === 'expense' && AUTO_EJECUTADO_CATEGORIES.includes(row.category)
        const isCard = row.paymentMethod === 'credit_card_clp' || row.paymentMethod === 'credit_card_usd'
        
        // If cash/account and special category, mark isPaid: true directly
        let isPaid = row.isPaid
        if (isSpecialCategory && !isCard) {
          isPaid = true
        }

        txsToInsert.push({
          description: row.description,
          amount: Number(row.amount),
          currency: row.currency,
          date: row.date,
          category: row.category,
          paymentMethod: row.paymentMethod,
          isPaid,
          type: row.type,
          month: txMonth,
          createdAt: row.createdAt || new Date().toISOString(),
          isRecurring: row.type === 'expense' ? row.isRecurring : false,
          applySavingsPct: row.type === 'income' ? row.applySavingsPct : true,
          _isSpecialCard: isSpecialCategory && isCard
        })

        if (row.type === 'expense' && row.isRecurring) {
          recurringToAdd.push({
            description: row.description,
            amount: Number(row.amount),
            currency: row.currency,
            paymentMethod: row.paymentMethod,
            category: row.category,
            dayOfMonth: Number(row.date.split('-')[2] || 1)
          })
        }
      }

      // Batch insert transactions in a single query
      const savedTxs = await addTransactions(txsToInsert)

      // Collect executed IDs for cards with special categories
      for (let i = 0; i < savedTxs.length; i++) {
        if (txsToInsert[i]._isSpecialCard && savedTxs[i]?.id) {
          executedMap[savedTxs[i].id] = true
          settingsChanged = true
        }
      }

      // Collect out-of-budget IDs
      const oobMap = { ...(settings.outOfBudgetTxs || {}) }
      for (let i = 0; i < savedTxs.length; i++) {
        if (activeRows[i]?.type === 'expense' && activeRows[i]?.isOutOfBudget && savedTxs[i]?.id) {
          oobMap[savedTxs[i].id] = true
          settingsChanged = true
        }
      }

      // Parallelize recurring additions & settings save
      const postPromises = []
      if (settingsChanged) {
        postPromises.push(saveSettings({ ...settings, executedTxs: executedMap, outOfBudgetTxs: oobMap }))
      }
      for (const rec of recurringToAdd) {
        postPromises.push(addRecurring(rec))
      }
      if (postPromises.length > 0) {
        await Promise.all(postPromises)
      }

      onAdd(savedTxs[savedTxs.length - 1])
      onClose()
    } catch (err) {
      console.error('Error saving transactions:', err)
      alert('Error al guardar: ' + (err.message || 'Intente nuevamente'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease', zIndex: 100 }}>
      <div className="modal" style={{ maxWidth: '1150px', width: '95vw', borderRadius: '16px' }}>
        <div className="modal-header" style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
            {initialItem ? 'Editar Movimiento' : 'Registrar Movimientos'}
          </h3>
          <button 
            onClick={onClose} 
            disabled={isSubmitting}
            className="text-secondary" 
            style={{ 
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-tertiary)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              color: 'var(--color-text-secondary)',
              lineHeight: 1,
              opacity: isSubmitting ? 0.5 : 1
            }}
          >
            &times;
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: '0 16px 8px' }}>

            {/* ── DESKTOP: wide table ────────────────────────────────── */}
            <div className="bulk-table-desktop" style={{ width: '100%', overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '950px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '105px' }}>Tipo</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '135px' }}>Fecha</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Descripción</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '110px' }}>Monto</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '75px' }}>Moneda</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '135px' }}>Categoría</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '145px' }}>Cuenta / Pago</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '70px' }}>¿Pagado?</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-warning, #f59e0b)', width: '85px' }} title="Gasto fuera de presupuesto (no contemplado)">¿No Ppto?</th>
                    {!initialItem && (
                      <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '75px' }}>Opción</th>
                    )}
                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '60px' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)', animation: 'slideUp 0.2s ease-out' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.type} onChange={(e) => handleRowChange(row.id, 'type', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} disabled={initialItem || isSubmitting}>
                          <option value="expense">Gasto</option>
                          <option value="income">Ingreso</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="date" value={row.date} onChange={(e) => handleRowChange(row.id, 'date', e.target.value)} className="input" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required disabled={isSubmitting} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="text" name="description" value={row.description} onChange={(e) => handleRowChange(row.id, 'description', e.target.value)} className="input" placeholder={row.type === 'income' ? 'Ej. Sueldo' : 'Ej. Rappi, Uber'} style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required={row.amount !== '' || !!initialItem} disabled={isSubmitting} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input 
                          type="text" 
                          inputMode="decimal"
                          value={row.amount} 
                          onChange={(e) => handleRowChange(row.id, 'amount', e.target.value.replace(/,/g, '.'))} 
                          className="input" 
                          placeholder="0" 
                          style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px', textAlign: 'right' }} 
                          required={row.description !== '' || !!initialItem} 
                          disabled={isSubmitting}
                        />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.currency} onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)} className="select" style={{ padding: '6px 4px', fontSize: '0.85rem', width: '100%', height: '34px' }} disabled={isSubmitting}>
                          <option value="CLP">CLP</option>
                          <option value="USD">USD</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.category} onChange={(e) => handleRowChange(row.id, 'category', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} disabled={isSubmitting}>
                          {row.type === 'income' ? (
                            <option value="Ingresos">Ingresos</option>
                          ) : (
                            [...categories].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))
                          )}
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.paymentMethod} onChange={(e) => handleRowChange(row.id, 'paymentMethod', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required disabled={isSubmitting}>
                          {row.type === 'income' ? (
                            <>{accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}{(!accounts.some(acc => acc.id === 'cash')) && <option value="cash">Efectivo</option>}</>
                          ) : (
                            <>
                              <optgroup label="Cuentas">
                                {accounts.map(acc => <option key={`exp-${acc.id}`} value={acc.id}>{acc.name}</option>)}
                                {(!accounts.some(acc => acc.id === 'cash')) && <option value="cash">Efectivo</option>}
                              </optgroup>
                              <optgroup label="Tarjetas">
                                <option value="credit_card_clp">Tarjeta CLP</option>
                                <option value="credit_card_usd">Tarjeta USD</option>
                              </optgroup>
                            </>
                          )}
                        </select>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <input type="checkbox" checked={row.isPaid} onChange={(e) => handleRowChange(row.id, 'isPaid', e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} disabled={isSubmitting} />
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        {row.type === 'expense' ? (
                          <input 
                            type="checkbox" 
                            checked={row.isOutOfBudget || false} 
                            onChange={(e) => handleRowChange(row.id, 'isOutOfBudget', e.target.checked)} 
                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--color-warning, #f59e0b)' }} 
                            title="Marcar como gasto fuera de presupuesto" 
                            disabled={isSubmitting} 
                          />
                        ) : (
                          <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      {!initialItem && (
                        <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                          {row.type === 'expense' ? (
                            <input type="checkbox" checked={row.isRecurring} onChange={(e) => handleRowChange(row.id, 'isRecurring', e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} title="Crear como recurrente mensual" onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} disabled={isSubmitting} />
                          ) : (
                            <input type="checkbox" checked={row.applySavingsPct} onChange={(e) => handleRowChange(row.id, 'applySavingsPct', e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} title={`Descontar porcentaje de ahorro configurado (${savingsPct}%)`} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} disabled={isSubmitting} />
                          )}
                        </td>
                      )}
                      <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                        <button type="button" onClick={() => handleDeleteRow(row.id)} disabled={isSubmitting || (rows.length === 1 && !initialItem)} className="text-danger" style={{ background: 'none', border: 'none', cursor: isSubmitting || (rows.length === 1 && !initialItem) ? 'not-allowed' : 'pointer', opacity: isSubmitting || (rows.length === 1 && !initialItem) ? 0.3 : 1, padding: '4px' }} title="Eliminar fila">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── MOBILE: cards layout ────────────────────────────────── */}
            <div className="bulk-cards-mobile" style={{ display: 'none', flexDirection: 'column', gap: '12px' }}>
              {rows.map((row, index) => (
                <div key={row.id} className="card" style={{ padding: '14px', margin: 0, border: '1px solid var(--color-border)', borderRadius: '12px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', minWidth: '22px' }}>#{index + 1}</span>
                      <select value={row.type} onChange={(e) => handleRowChange(row.id, 'type', e.target.value)} className="select" style={{ fontSize: '15px', padding: '6px 8px', height: '36px' }} disabled={initialItem || isSubmitting}>
                        <option value="expense">Gasto</option>
                        <option value="income">Ingreso</option>
                      </select>
                    </div>
                    {(!initialItem && rows.length > 1) && (
                      <button type="button" onClick={() => handleDeleteRow(row.id)} disabled={isSubmitting} className="text-danger" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    )}
                  </div>

                  <div>
                    <input type="text" name="description" value={row.description} onChange={(e) => handleRowChange(row.id, 'description', e.target.value)} className="input" placeholder={row.type === 'income' ? 'Descripción (ej. Sueldo)' : 'Descripción (ej. Rappi, Uber)'} style={{ width: '100%', fontSize: '15px', padding: '10px 12px' }} required={row.amount !== '' || !!initialItem} disabled={isSubmitting} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
                    <input 
                      type="text" 
                      inputMode="decimal"
                      value={row.amount} 
                      onChange={(e) => handleRowChange(row.id, 'amount', e.target.value.replace(/,/g, '.'))} 
                      className="input" 
                      placeholder="Monto (ej. 25000)" 
                      style={{ fontSize: '15px', padding: '10px 12px' }} 
                      required={row.description !== '' || !!initialItem} 
                      disabled={isSubmitting}
                    />
                    <select value={row.currency} onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)} className="select" style={{ fontSize: '15px', padding: '10px 8px', width: '75px' }} disabled={isSubmitting}>
                      <option value="CLP">CLP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Fecha</label>
                    <input type="date" value={row.date} onChange={(e) => handleRowChange(row.id, 'date', e.target.value)} className="input" style={{ width: '100%', fontSize: '15px', padding: '10px 12px' }} required disabled={isSubmitting} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Categoría</label>
                      <select value={row.category} onChange={(e) => handleRowChange(row.id, 'category', e.target.value)} className="select" style={{ width: '100%', fontSize: '15px', padding: '10px 8px' }} disabled={isSubmitting}>
                        {row.type === 'income' ? (
                          <option value="Ingresos">Ingresos</option>
                        ) : (
                          [...categories].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map(cat => <option key={cat} value={cat}>{cat}</option>)
                        )}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Pago</label>
                      <select value={row.paymentMethod} onChange={(e) => handleRowChange(row.id, 'paymentMethod', e.target.value)} className="select" style={{ width: '100%', fontSize: '15px', padding: '10px 8px' }} required disabled={isSubmitting}>
                        {row.type === 'income' ? (
                          <>{accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}{(!accounts.some(acc => acc.id === 'cash')) && <option value="cash">Efectivo</option>}</>
                        ) : (
                          <>
                            <optgroup label="Cuentas">
                              {accounts.map(acc => <option key={`exp-${acc.id}`} value={acc.id}>{acc.name}</option>)}
                              {(!accounts.some(acc => acc.id === 'cash')) && <option value="cash">Efectivo</option>}
                            </optgroup>
                            <optgroup label="Tarjetas">
                              <option value="credit_card_clp">Tarjeta CLP</option>
                              <option value="credit_card_usd">Tarjeta USD</option>
                            </optgroup>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Opciones al pie: Pagado + Fuera Ppto + opción extra */}
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                      <input type="checkbox" checked={row.isPaid} onChange={(e) => handleRowChange(row.id, 'isPaid', e.target.checked)} style={{ width: '18px', height: '18px' }} disabled={isSubmitting} />
                      Pagado
                    </label>
                    {row.type === 'expense' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-warning, #f59e0b)', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                        <input type="checkbox" checked={row.isOutOfBudget || false} onChange={(e) => handleRowChange(row.id, 'isOutOfBudget', e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--color-warning, #f59e0b)' }} disabled={isSubmitting} />
                        Fuera Ppto
                      </label>
                    )}
                    {!initialItem && (
                      row.type === 'expense' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                          <input type="checkbox" checked={row.isRecurring} onChange={(e) => handleRowChange(row.id, 'isRecurring', e.target.checked)} style={{ width: '18px', height: '18px' }} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} disabled={isSubmitting} />
                          Recurrente
                        </label>
                      ) : (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                          <input type="checkbox" checked={row.applySavingsPct} onChange={(e) => handleRowChange(row.id, 'applySavingsPct', e.target.checked)} style={{ width: '18px', height: '18px' }} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} disabled={isSubmitting} />
                          Aplica Ahorro
                        </label>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!initialItem && (
              <div style={{ marginTop: '8px' }}>
                <button type="button" onClick={handleAddRow} disabled={isSubmitting} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', padding: '8px 16px', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', backgroundColor: 'transparent', opacity: isSubmitting ? 0.5 : 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Añadir Fila
                </button>
              </div>
            )}
          </div>
          
          <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary" style={{ opacity: isSubmitting ? 0.5 : 1 }}>Cancelar</button>
            <button 
              type="submit" 
              disabled={isSubmitting} 
              className="btn btn-primary" 
              style={{ minWidth: '120px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25"></circle>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"></path>
                  </svg>
                  <span>Guardando...</span>
                </>
              ) : (
                'Guardar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
