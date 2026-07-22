'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import BulkTransactionModal from '@/components/BulkTransactionModal'
import { getAllTransactions, updateTransaction, deleteTransaction, getCategories, getAccounts } from '@/lib/db'
import { formatCurrency, calculateTotal } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Gastos() {
  const [isPrivate] = usePrivacyMode()
  const [transactions, setTransactions] = useState([])
  
  // Date filter states
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Advanced filter states
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedMethod, setSelectedMethod] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedRecurring, setSelectedRecurring] = useState('')

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)

  // Date helpers
  const getFirstDayOfMonth = () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}-01`
  }

  const getLastDayOfMonth = () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const lastDay = new Date(y, m, 0).getDate()
    const mStr = String(m).padStart(2, '0')
    return `${y}-${mStr}-${String(lastDay).padStart(2, '0')}`
  }

  useEffect(() => {
    setStartDate(getFirstDayOfMonth())
    setEndDate(getLastDayOfMonth())

    const load = async () => {
      const [allTxs, accs, cats] = await Promise.all([
        getAllTransactions(),
        getAccounts(),
        getCategories()
      ])
      setTransactions(allTxs)
      const allKnownCats = new Set(cats)
      allTxs.forEach(t => { if (t.category) allKnownCats.add(t.category) })
      setCategories(Array.from(allKnownCats).sort((a, b) => a.localeCompare(b, 'es')))
      setAccounts(accs)
    }
    load()
  }, [])

  const handleSelectMonth = (monthIndex) => {
    const y = new Date().getFullYear()
    const firstDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-01`
    const lastDayDate = new Date(y, monthIndex + 1, 0)
    const lastDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`
    setStartDate(firstDay)
    setEndDate(lastDay)
  }

  const isMonthActive = (monthIndex) => {
    const y = new Date().getFullYear()
    const firstDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-01`
    const lastDayDate = new Date(y, monthIndex + 1, 0)
    const lastDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`
    return startDate === firstDay && endDate === lastDay
  }

  const handleTogglePaid = async (id, currentStatus) => {
    const updated = await updateTransaction(id, { isPaid: !currentStatus })
    if (updated) {
      setTransactions(prev => prev.map(t => t.id === id ? updated : t))
    }
  }

  const handleDelete = async (id) => {
    if (confirm('¿Eliminar este gasto?')) {
      await deleteTransaction(id)
      setTransactions(prev => prev.filter(t => t.id !== id))
    }
  }

  const handleEdit = (tx) => {
    setEditingItem(tx)
    setIsModalOpen(true)
  }

  const handleAddNew = () => {
    setEditingItem(null)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setEditingItem(null)
  }

  const handleItemChanged = async () => {
    setTransactions(await getAllTransactions())
  }

  const getPaymentMethodLabel = (method) => {
    switch(method) {
      case 'credit_card_clp': return 'Tarjeta CLP'
      case 'credit_card_usd': return 'Tarjeta USD'
      case 'cash': return 'Efectivo'
      case 'transfer': return 'Transferencia'
      default: 
        const acc = accounts.find(a => a.id === method)
        return acc ? acc.name : method
    }
  }

  const handleClearFilters = () => {
    setStartDate(getFirstDayOfMonth())
    setEndDate(getLastDayOfMonth())
    setSearchQuery('')
    setSelectedCategory('')
    setSelectedMethod('')
    setSelectedStatus('')
    setSelectedRecurring('')
  }

  // Filter expenses locally based on ALL filters and sort chronologically (newest first)
  const filteredTxs = [...transactions]
    .filter(t => t.type === 'expense')
    .filter(t => {
      // Date range filter
      if (startDate && t.date < startDate) return false
      if (endDate && t.date > endDate) return false
      
      // Text search filter (Concepto)
      if (searchQuery.trim() && !t.description.toLowerCase().includes(searchQuery.toLowerCase())) return false
      
      // Category filter
      if (selectedCategory && t.category !== selectedCategory) return false
      
      // Method filter
      if (selectedMethod && t.paymentMethod !== selectedMethod) return false
      
      // Status filter
      if (selectedStatus) {
        const isPaidFilter = selectedStatus === 'paid'
        if (t.isPaid !== isPaidFilter) return false
      }
      
      // Recurring filter
      if (selectedRecurring) {
        const isRecFilter = selectedRecurring === 'recurring'
        if (!!t.isRecurring !== isRecFilter) return false
      }

      return true
    })
    .sort((a, b) => {
      const dateA = a.createdAt || a.date || ''
      const dateB = b.createdAt || b.date || ''
      return dateB.localeCompare(dateA)
    })

  // Grouped totals for CLP and USD based on active filters
  const clpExpenses = filteredTxs.filter(t => t.currency === 'CLP')
  const usdExpenses = filteredTxs.filter(t => t.currency === 'USD')

  // CLP Math
  const totalCLP = calculateTotal(clpExpenses)
  const totalPaidCLP = calculateTotal(clpExpenses.filter(t => t.isPaid))
  const totalPendingCLP = totalCLP - totalPaidCLP

  // USD Math
  const totalUSD = calculateTotal(usdExpenses)
  const totalPaidUSD = calculateTotal(usdExpenses.filter(t => t.isPaid))
  const totalPendingUSD = totalUSD - totalPaidUSD

  return (
    <>
      <div className="animate-fadeIn">
      <Header title="Gastos" />

      <div className="container">
        
        {/* Multi-Currency Totals Summary (Top) */}
        <div className="summary-grid mb-6">
          <div className="card">
            <div className="summary-label">TOTAL</div>
            <div className="summary-value" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '1.25rem' }}>{formatCurrency(totalCLP, 'CLP')}</div>
              {totalUSD > 0 && <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{formatCurrency(totalUSD, 'USD')}</div>}
            </div>
          </div>
          <div className="card">
            <div className="summary-label">PAGADO</div>
            <div className="summary-value text-success" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '1.25rem' }}>{formatCurrency(totalPaidCLP, 'CLP')}</div>
              {totalUSD > 0 && <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{formatCurrency(totalPaidUSD, 'USD')}</div>}
            </div>
          </div>
          <div className="card">
            <div className="summary-label">PENDIENTE</div>
            <div className="summary-value text-warning" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '1.25rem' }}>{formatCurrency(totalPendingCLP, 'CLP')}</div>
              {totalUSD > 0 && <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{formatCurrency(totalPendingUSD, 'USD')}</div>}
            </div>
          </div>
        </div>

        {/* Advanced Filters Panel */}
        <div className="card mb-4" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Row 1: Period Filter Row (Consistente con Dashboard) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                Filtro de Período ({new Date().getFullYear()})
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((monthName, index) => {
                  const active = isMonthActive(index)
                  const isHistoryAvailable = index >= 5 // Desde Junio (5) en adelante
                  return (
                    <button
                      key={monthName}
                      onClick={() => isHistoryAvailable && handleSelectMonth(index)}
                      disabled={!isHistoryAvailable}
                      className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        padding: '8px 16px',
                        fontSize: '0.85rem',
                        cursor: isHistoryAvailable ? 'pointer' : 'not-allowed',
                        borderRadius: '8px',
                        flex: '1 1 auto',
                        textAlign: 'center',
                        fontWeight: active ? 'bold' : 'normal',
                        backgroundColor: active 
                          ? 'var(--color-accent)' 
                          : (isHistoryAvailable ? 'var(--bg-tertiary)' : 'var(--bg-primary)'),
                        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                        color: active 
                          ? 'white' 
                          : (isHistoryAvailable ? 'var(--color-text)' : 'var(--color-text-tertiary)'),
                        opacity: isHistoryAvailable ? 1 : 0.4
                      }}
                    >
                      {monthName}
                    </button>
                  )
                })}
                <button 
                  onClick={handleClearFilters} 
                  className="btn btn-secondary" 
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    flex: '1 1 auto',
                    textAlign: 'center',
                    height: 'auto',
                    whiteSpace: 'nowrap'
                  }}
                  title="Limpiar todos los filtros avanzados y volver al mes en curso"
                >
                  Limpiar Filtros
                </button>
              </div>
            </div>

            {/* Row 2: Search, Category, Method, Status, Recurring */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
              <div className="form-field" style={{ margin: 0, flex: 2, minWidth: '180px' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Buscar por nombre (Concepto)</label>
                <input 
                  type="text" 
                  placeholder="Ej. Súper, Rappi, Salida..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input"
                  style={{ padding: '8px' }}
                />
              </div>
              <div className="form-field" style={{ margin: 0, flex: 1, minWidth: '120px' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Categoría</label>
                <select 
                  value={selectedCategory} 
                  onChange={(e) => setSelectedCategory(e.target.value)} 
                  className="select"
                  style={{ padding: '8px' }}
                >
                  <option value="">Todas</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, flex: 1, minWidth: '120px' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Método</label>
                <select 
                  value={selectedMethod} 
                  onChange={(e) => setSelectedMethod(e.target.value)} 
                  className="select"
                  style={{ padding: '8px' }}
                >
                  <option value="">Todos</option>
                  <optgroup label="Cuentas Bancarias / Efectivo">
                    {accounts.map(acc => (
                      <option key={`filter-${acc.id}`} value={acc.id}>{acc.name}</option>
                    ))}
                    {accounts.length === 0 && <option value="cash">Efectivo</option>}
                  </optgroup>
                  <optgroup label="Tarjetas de Crédito">
                    <option value="credit_card_clp">Tarjeta CLP</option>
                    <option value="credit_card_usd">Tarjeta USD</option>
                  </optgroup>
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, flex: 1, minWidth: '120px' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Estado</label>
                <select 
                  value={selectedStatus} 
                  onChange={(e) => setSelectedStatus(e.target.value)} 
                  className="select"
                  style={{ padding: '8px' }}
                >
                  <option value="">Todos</option>
                  <option value="paid">Pagado</option>
                  <option value="pending">Pendiente</option>
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, flex: 1, minWidth: '120px' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Tipo</label>
                <select 
                  value={selectedRecurring} 
                  onChange={(e) => setSelectedRecurring(e.target.value)} 
                  className="select"
                  style={{ padding: '8px' }}
                >
                  <option value="">Todos</option>
                  <option value="recurring">Recurrente</option>
                  <option value="non_recurring">Único</option>
                </select>
              </div>
            </div>

          </div>
        </div>

        {/* Expenses Table */}
        <div className="card mb-6" style={{ overflowX: 'auto', padding: '16px' }}>
          <table className="excel-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Categoría</th>
                <th style={{ textAlign: 'center', width: '95px' }}>Recurrente</th>
                <th className="excel-amount">Monto</th>
                <th>Método</th>
                <th>Fecha y Hora</th>
                <th style={{ textAlign: 'center', width: '100px' }}>Estado</th>
                <th style={{ textAlign: 'center', width: '80px' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredTxs.map(tx => {
                const datePart = tx.date || (tx.createdAt ? tx.createdAt.split('T')[0] : '')
                const timePart = tx.createdAt 
                  ? new Date(tx.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : '12:00'
                const formattedDateTime = `${datePart} ${timePart}`

                return (
                  <tr key={tx.id}>
                    <td style={{ fontWeight: 600 }}>{tx.description}</td>
                    <td>
                      <span className="badge badge-secondary" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-text)', fontSize: '0.8rem' }}>
                        {tx.category}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {tx.isRecurring ? (
                        <span className="badge" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)', fontSize: '0.75rem', padding: '4px 8px', borderRadius: '8px', fontWeight: 'bold' }}>
                          🔁 Sí
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>No</span>
                      )}
                    </td>
                    <td className="excel-amount" style={{ color: tx.isPaid ? 'inherit' : 'var(--color-danger)' }}>
                      {formatCurrency(tx.amount, tx.currency)}
                    </td>
                    <td>
                      <span className="badge badge-secondary" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
                        {getPaymentMethodLabel(tx.paymentMethod)}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {formattedDateTime}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        onClick={() => handleTogglePaid(tx.id, tx.isPaid)}
                        className={`badge badge-${tx.isPaid ? 'success' : 'warning'}`}
                        style={{ cursor: 'pointer', border: 'none', width: '85px', textAlign: 'center', display: 'inline-block' }}
                        title="Haz clic para alternar estado de pago"
                      >
                        {tx.isPaid ? 'Pagado' : 'Pendiente'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        <button 
                          onClick={() => handleEdit(tx)} 
                          className="text-secondary hover:text-primary transition-colors" 
                          style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                          title="Editar"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleDelete(tx.id)} 
                          className="text-danger hover:text-red-700 transition-colors" 
                          style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
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
                    </td>
                  </tr>
                )
              })}
              {filteredTxs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-secondary text-center py-4">No hay gastos registrados que coincidan con los filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      
      {/* Floating Action Button */}
      <button 
        onClick={handleAddNew} 
        className="btn-fab" 
        aria-label="Agregar Gasto"
        style={{ cursor: 'pointer' }}
      >
        +
      </button>

      {/* Transaction Modal Dialog */}
      <BulkTransactionModal 
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onAdd={handleItemChanged}
        initialItem={editingItem}
      />
    </>
  )
}
