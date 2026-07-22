'use client'
import { useState, useEffect } from 'react'
import { addTransaction, updateTransaction, getCategories, addRecurring, getAccounts, getSettings, getRecurring, getAllTransactions } from '@/lib/db'

export default function BulkTransactionModal({ isOpen, onClose, onAdd, initialItem }) {
  const [categories, setCategories] = useState([])
  const [categoryGroups, setCategoryGroups] = useState({ tarjeta: [], cuenta: [], otras: [] })
  const [recurringCategories, setRecurringCategories] = useState(new Set())
  const [accounts, setAccounts] = useState([])
  const [savingsPct, setSavingsPct] = useState(0)
  
  const createEmptyRow = (previousRow = null) => {
    let baseDate = new Date().toLocaleDateString('sv').substring(0, 10) // Swedish format YYYY-MM-DD
    
    // Check if default credit card CLP is closed for today's month, only for the initial empty row
    if (!previousRow) {
      const settings = getSettings()
      const closedCards = settings?.closedCards || {}
      const txMonth = baseDate.substring(0, 7)
      if (closedCards[`credit_card_clp_${txMonth}`]) {
        const [y, m] = txMonth.split('-')
        let nextM = parseInt(m) + 1
        let nextY = parseInt(y)
        if (nextM > 12) {
          nextM = 1
          nextY++
        }
        baseDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`
      }
    }
    
    if (previousRow) {
      return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(), // timestamp exacto de creación de esta fila
        type: previousRow.type,
        date: previousRow.date,
        description: '',
        amount: '',
        currency: previousRow.currency,
        category: previousRow.category,
        paymentMethod: previousRow.paymentMethod,
        isPaid: previousRow.isPaid,
        applySavingsPct: previousRow.applySavingsPct,
        isRecurring: previousRow.isRecurring,
      }
    }
    
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(), // timestamp exacto de creación de esta fila
      type: 'expense',
      date: baseDate,
      description: '',
      amount: '',
      currency: 'CLP',
      category: 'Generales',
      paymentMethod: 'credit_card_clp',
      isPaid: false,
      applySavingsPct: true,
      isRecurring: false,
    }
  }

  const [rows, setRows] = useState([createEmptyRow()])

  // Fetch categories, accounts, and settings on mount
  useEffect(() => {
    const load = async () => {
      const [cats, accs, recurring, s] = await Promise.all([
        getCategories(),
        getAccounts(),
        getRecurring(),
        Promise.resolve(null)
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

      const settings = await getSettings()
      if (settings && settings.savingsPercentage) {
        setSavingsPct(Number(settings.savingsPercentage))
      }
    }
    load()
  }, [])

  // Initialize rows if editing
  useEffect(() => {
    if (isOpen) {
      if (initialItem) {
        setRows([{
          id: initialItem.id,
          type: initialItem.type || 'expense',
          date: initialItem.date || '',
          description: initialItem.description || '',
          amount: String(initialItem.amount || ''),
          currency: initialItem.currency || 'CLP',
          category: initialItem.category || 'Generales',
          paymentMethod: initialItem.paymentMethod || 'credit_card_clp',
          isPaid: initialItem.isPaid || false,
          applySavingsPct: initialItem.applySavingsPct !== false,
          isRecurring: initialItem.isRecurring || false,
          isEdit: true
        }])
      } else {
        setRows([createEmptyRow()])
      }
    }
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
      
      // Handle dynamic logic when changing type
      if (field === 'type') {
        if (value === 'income') {
          const firstAccount = accounts[0]
          updatedRow.category = 'Ingresos'
          updatedRow.paymentMethod = firstAccount ? firstAccount.id : 'cash'
          updatedRow.currency = firstAccount ? firstAccount.currency : 'CLP'
          updatedRow.isPaid = true
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

      // Automatic date bumping for closed credit card billing cycles
      if (field === 'date' || field === 'paymentMethod') {
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
          if (!updatedRow.isEdit) {
            updatedRow.date = new Date().toLocaleDateString('sv').substring(0, 10)
          }
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

    const settings = await getSettings()
    const closedCards = settings.closedCards || {}

    const savedTxs = []
    for (const row of activeRows) {
      let txMonth = row.date.substring(0, 7)

      if (row.type === 'expense' && row.paymentMethod.startsWith('credit_card_')) {
        if (closedCards[`${row.paymentMethod}_${txMonth}`]) {
          const [y, m] = txMonth.split('-')
          let nextM = parseInt(m) + 1
          let nextY = parseInt(y)
          if (nextM > 12) { nextM = 1; nextY++ }
          txMonth = `${nextY}-${String(nextM).padStart(2, '0')}`
        }
      }

      const newTx = {
        description: row.description,
        amount: Number(row.amount),
        currency: row.currency,
        date: row.date,
        category: row.category,
        paymentMethod: row.paymentMethod,
        isPaid: row.isPaid,
        type: row.type,
        month: txMonth,
        createdAt: row.createdAt || new Date().toISOString()
      }

      if (row.type === 'expense') {
        newTx.isRecurring = row.isRecurring
      } else {
        newTx.applySavingsPct = row.applySavingsPct
      }

      let savedTx
      if (initialItem && initialItem.id) {
        savedTx = await updateTransaction(initialItem.id, newTx)
      } else {
        savedTx = await addTransaction(newTx)
        if (row.type === 'expense' && row.isRecurring) {
          await addRecurring({
            description: newTx.description,
            amount: Number(newTx.amount),
            currency: newTx.currency,
            paymentMethod: newTx.paymentMethod,
            category: newTx.category,
            dayOfMonth: Number(newTx.date.split('-')[2] || 1)
          })
        }
      }
      savedTxs.push(savedTx)
    }

    onAdd(savedTxs[savedTxs.length - 1])
    onClose()
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
              cursor: 'pointer',
              fontSize: '1rem',
              color: 'var(--color-text-secondary)',
              lineHeight: 1
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
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '145px' }}>Cuenta / Pago</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '75px' }}>¿Pagado?</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '75px' }}>Opción</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', width: '60px' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)', animation: 'slideUp 0.2s ease-out' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.type} onChange={(e) => handleRowChange(row.id, 'type', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} disabled={initialItem}>
                          <option value="expense">Gasto</option>
                          <option value="income">Ingreso</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="date" value={row.date} onChange={(e) => handleRowChange(row.id, 'date', e.target.value)} className="input" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="text" name="description" value={row.description} onChange={(e) => handleRowChange(row.id, 'description', e.target.value)} className="input" placeholder={row.type === 'income' ? 'Ej. Sueldo' : 'Ej. Rappi, Uber'} style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required={row.amount !== '' || !!initialItem} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="number" value={row.amount} onChange={(e) => handleRowChange(row.id, 'amount', e.target.value)} className="input" placeholder="0" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required={row.description.trim() !== '' || !!initialItem} min="0" step="0.01" />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.currency} onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} disabled={row.type === 'income'}>
                          <option value="CLP">CLP</option>
                          <option value="USD">USD</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {row.type === 'income' ? (
                          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', height: '34px', display: 'flex', alignItems: 'center', paddingLeft: '8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '6px' }}>Ingresos</div>
                        ) : (
                          <select value={row.category} onChange={(e) => handleRowChange(row.id, 'category', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required>
                            {categories.map(cat => <option key={`cat-${cat}`} value={cat}>{recurringCategories.has(cat) ? `⚡ ${cat}` : cat}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <select value={row.paymentMethod} onChange={(e) => handleRowChange(row.id, 'paymentMethod', e.target.value)} className="select" style={{ padding: '6px 8px', fontSize: '0.85rem', width: '100%', height: '34px' }} required>
                          {row.type === 'income' ? (
                            <>{accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>)}{accounts.length === 0 && <option value="cash">Efectivo</option>}</>
                          ) : (
                            <>
                              <optgroup label="Cuentas Bancarias / Efectivo">
                                {accounts.map(acc => <option key={`exp-${acc.id}`} value={acc.id}>{acc.name} ({acc.currency})</option>)}
                                {accounts.length === 0 && <option value="cash">Efectivo</option>}
                              </optgroup>
                              <optgroup label="Tarjetas de Crédito">
                                <option value="credit_card_clp">Tarjeta CLP</option>
                                <option value="credit_card_usd">Tarjeta USD</option>
                              </optgroup>
                            </>
                          )}
                        </select>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <input type="checkbox" checked={row.isPaid} onChange={(e) => handleRowChange(row.id, 'isPaid', e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', verticalAlign: 'middle' }} />
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {row.type === 'expense' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <input type="checkbox" checked={row.isRecurring} onChange={(e) => handleRowChange(row.id, 'isRecurring', e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} id={`isRec-${row.id}`} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} />
                            <label htmlFor={`isRec-${row.id}`} style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Rec.</label>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <input type="checkbox" checked={row.applySavingsPct} onChange={(e) => handleRowChange(row.id, 'applySavingsPct', e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} id={`applySav-${row.id}`} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} />
                            <label htmlFor={`applySav-${row.id}`} style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Ahorro</label>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <button type="button" onClick={() => handleDeleteRow(row.id)} disabled={rows.length === 1 && !initialItem} style={{ display: 'inline-flex', padding: '6px', background: 'none', border: 'none', cursor: (rows.length === 1 && !initialItem) ? 'not-allowed' : 'pointer', opacity: (rows.length === 1 && !initialItem) ? 0.3 : 1, color: 'var(--color-danger)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── MOBILE: card-per-row layout ────────────────────────── */}
            <div className="bulk-cards-mobile">
              {rows.map((row, index) => (
                <div key={row.id} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', padding: '14px', marginBottom: '12px', backgroundColor: 'var(--bg-secondary)', animation: 'slideUp 0.2s ease-out' }}>
                  {/* Row header: type + delete */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <select value={row.type} onChange={(e) => handleRowChange(row.id, 'type', e.target.value)} className="select" style={{ fontSize: '0.9rem', padding: '8px 10px', borderRadius: '8px', fontWeight: 600, flex: 1, marginRight: '10px' }} disabled={initialItem}>
                      <option value="expense">💸 Gasto</option>
                      <option value="income">💰 Ingreso</option>
                    </select>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => handleDeleteRow(row.id)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    )}
                  </div>

                  {/* Descripción */}
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Descripción</label>
                    <input type="text" name="description" value={row.description} onChange={(e) => handleRowChange(row.id, 'description', e.target.value)} className="input" placeholder={row.type === 'income' ? 'Ej. Sueldo' : 'Ej. Rappi, Uber, Netflix...'} style={{ width: '100%', fontSize: '16px', padding: '10px 12px' }} required={row.amount !== '' || !!initialItem} />
                  </div>

                  {/* Monto + Moneda en fila */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Monto</label>
                      <input type="number" value={row.amount} onChange={(e) => handleRowChange(row.id, 'amount', e.target.value)} className="input" placeholder="0" style={{ width: '100%', fontSize: '16px', padding: '10px 12px' }} required={row.description.trim() !== '' || !!initialItem} min="0" step="0.01" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Moneda</label>
                      <select value={row.currency} onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)} className="select" style={{ fontSize: '16px', padding: '10px 12px', minWidth: '80px' }} disabled={row.type === 'income'}>
                        <option value="CLP">CLP</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>

                  {/* Fecha */}
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Fecha</label>
                    <input type="date" value={row.date} onChange={(e) => handleRowChange(row.id, 'date', e.target.value)} className="input" style={{ width: '100%', fontSize: '16px', padding: '10px 12px' }} required />
                  </div>

                  {/* Categoría + Cuenta en fila */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Categoría</label>
                      {row.type === 'income' ? (
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px' }}>Ingresos</div>
                      ) : (
                        <select value={row.category} onChange={(e) => handleRowChange(row.id, 'category', e.target.value)} className="select" style={{ width: '100%', fontSize: '15px', padding: '10px 8px' }} required>
                          {categories.map(cat => <option key={`cat-${cat}`} value={cat}>{recurringCategories.has(cat) ? `⚡ ${cat}` : cat}</option>)}
                        </select>
                      )}
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Pago</label>
                      <select value={row.paymentMethod} onChange={(e) => handleRowChange(row.id, 'paymentMethod', e.target.value)} className="select" style={{ width: '100%', fontSize: '15px', padding: '10px 8px' }} required>
                        {row.type === 'income' ? (
                          <>{accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}{accounts.length === 0 && <option value="cash">Efectivo</option>}</>
                        ) : (
                          <>
                            <optgroup label="Cuentas">
                              {accounts.map(acc => <option key={`exp-${acc.id}`} value={acc.id}>{acc.name}</option>)}
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
                  </div>

                  {/* Opciones al pie: Pagado + opción extra */}
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                      <input type="checkbox" checked={row.isPaid} onChange={(e) => handleRowChange(row.id, 'isPaid', e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      Pagado
                    </label>
                    {row.type === 'expense' ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                        <input type="checkbox" checked={row.isRecurring} onChange={(e) => handleRowChange(row.id, 'isRecurring', e.target.checked)} style={{ width: '18px', height: '18px' }} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} />
                        Recurrente
                      </label>
                    ) : (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                        <input type="checkbox" checked={row.applySavingsPct} onChange={(e) => handleRowChange(row.id, 'applySavingsPct', e.target.checked)} style={{ width: '18px', height: '18px' }} onKeyDown={(e) => handleKeyDown(e, index, 'optionExtra')} />
                        Aplica Ahorro
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!initialItem && (
              <div style={{ marginTop: '8px' }}>
                <button type="button" onClick={handleAddRow} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', padding: '8px 16px', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', backgroundColor: 'transparent' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Añadir Fila
                </button>
              </div>
            )}
          </div>
          
          <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
            <button type="submit" className="btn btn-primary" style={{ minWidth: '100px' }}>Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
