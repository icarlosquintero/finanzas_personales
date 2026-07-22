'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { 
  getCategories, 
  addCategory, 
  updateCategory, 
  deleteCategory, 
  isCategoryInUse,
  getRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
  getSettings,
  saveSettings,
  cleanCorruptedData,
  generateRecurringForMonth,
  getAccounts,
  getUsedCategories
} from '@/lib/db'
import { formatCurrency } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Config() {
  const [isPrivate] = usePrivacyMode()
  const [activeTab, setActiveTab] = useState('categories')
  
  // Settings state
  const [settings, setSettings] = useState({ theme: 'light', defaultCurrency: 'CLP', currencies: ['CLP', 'USD'], savingsPercentage: 0 })
  
  // Categories states
  const [categories, setCategories] = useState([])
  const [usedCategories, setUsedCategories] = useState(new Set())
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCat, setEditingCat] = useState(null)
  const [editNameValue, setEditNameValue] = useState('')
  const [mergingCat, setMergingCat] = useState(null)
  const [mergeTarget, setMergeTarget] = useState('')

  // Accounts state
  const [accounts, setAccounts] = useState([])

  // Recurring states
  const [recurringItems, setRecurringItems] = useState([])
  const [editingRecItem, setEditingRecItem] = useState(null)
  const [editRecData, setEditRecData] = useState({
    type: 'expense',
    description: '',
    amount: '',
    currency: 'CLP',
    paymentMethod: 'cash',
    dayOfMonth: 1
  })
  const [newRec, setNewRec] = useState({
    type: 'expense',
    description: '',
    amount: '',
    currency: 'CLP',
    paymentMethod: 'cash',
    dayOfMonth: 1
  })

  // Load data on mount
  useEffect(() => {
    const load = async () => {
      setCategories(await getCategories())
      setUsedCategories(new Set(await getUsedCategories()))
      setRecurringItems(await getRecurring())
      setSettings(await getSettings())
      setAccounts(await getAccounts())
    }
    load()
  }, [])

  const handleSettingChange = async (name, value) => {
    const updated = { ...settings, [name]: value }
    setSettings(updated)
    await saveSettings(updated)
  }

  // Categories actions
  const handleAddCategory = async (e) => {
    e.preventDefault()
    if (!newCategoryName.trim()) return
    await addCategory(newCategoryName)
    setCategories(await getCategories())
    setNewCategoryName('')
  }

  const handleStartEdit = (cat) => {
    setEditingCat(cat)
    setEditNameValue(cat)
  }

  const handleSaveRename = async (oldName) => {
    if (!editNameValue.trim() || editNameValue.trim() === oldName) {
      setEditingCat(null)
      return
    }
    await updateCategory(oldName, editNameValue)
    setCategories(await getCategories())
    setEditingCat(null)
  }

  const handleDeleteClick = async (cat) => {
    const inUse = await isCategoryInUse(cat)
    if (inUse) {
      setMergingCat(cat)
      setMergeTarget('')
    } else {
      if (confirm(`¿Eliminar la categoría "${cat}"?`)) {
        await deleteCategory(cat)
        setCategories(await getCategories())
        setUsedCategories(new Set(await getUsedCategories()))
      }
    }
  }

  const handleMergeAndDelete = async () => {
    if (!mergeTarget) return
    if (confirm(`¿Seguro que deseas fusionar "${mergingCat}" en "${mergeTarget}" y eliminarla?`)) {
      await deleteCategory(mergingCat, mergeTarget)
      setCategories(await getCategories())
      setUsedCategories(new Set(await getUsedCategories()))
      setMergingCat(null)
      setMergeTarget('')
      // Refresh recurring lists since categories might have changed
      setRecurringItems(await getRecurring())
    }
  }

  // Recurring actions
  const handleAddRecurring = async (e) => {
    e.preventDefault()
    if (!newRec.description.trim() || !newRec.amount) return
    
    const recData = {
      type: newRec.type || 'expense',
      description: newRec.description,
      amount: Number(newRec.amount),
      currency: newRec.currency,
      paymentMethod: newRec.paymentMethod,
      dayOfMonth: Number(newRec.dayOfMonth)
    }

    await addRecurring(recData)
    
    setRecurringItems(await getRecurring())
    setNewRec({
      type: 'expense',
      description: '',
      amount: '',
      currency: 'CLP',
      paymentMethod: 'cash',
      dayOfMonth: 1
    })
  }

  const handleStartEditRecurring = (item) => {
    setEditingRecItem(item)
    setEditRecData({
      type: item.type || 'expense',
      description: item.description,
      amount: String(item.amount),
      currency: item.currency,
      paymentMethod: item.paymentMethod,
      dayOfMonth: String(item.dayOfMonth)
    })
  }

  const handleSaveRecurringEdit = async (e) => {
    e.preventDefault()
    if (!editRecData.description.trim() || !editRecData.amount) return
    
    await updateRecurring(editingRecItem.id, {
      type: editRecData.type || 'expense',
      description: editRecData.description,
      amount: Number(editRecData.amount),
      currency: editRecData.currency,
      paymentMethod: editRecData.paymentMethod,
      dayOfMonth: Number(editRecData.dayOfMonth)
    })
    
    setEditingRecItem(null)
    setRecurringItems(await getRecurring())
  }

  const handleDeleteRecurring = async (id) => {
    if (confirm('¿Eliminar este elemento recurrente?')) {
      await deleteRecurring(id)
      if (editingRecItem && editingRecItem.id === id) {
        setEditingRecItem(null)
      }
      setRecurringItems(await getRecurring())
    }
  }

  // --- Migration Logic ---
  const [isMigrating, setIsMigrating] = useState(false)

  const handleMigrateFileToSupabase = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!confirm('¿Estás seguro de querer subir este respaldo a Supabase? Esto sobrescribirá los datos actuales en la nube.')) {
      e.target.value = '' // Reset input
      return
    }
    
    setIsMigrating(true)
    try {
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const fileData = JSON.parse(event.target.result)
          
          const { supabase } = await import('@/lib/supabase')
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Usuario no autenticado')
          const userId = user.id

          // Helper to parse strings from JSON if they were stringified, or use directly if they are arrays
          const parseBackupField = (field) => {
            if (!field) return []
            if (typeof field === 'string') {
              try { return JSON.parse(field) } catch(e) { return [] }
            }
            return field
          }

          const txs = parseBackupField(fileData.transactions)
          const accs = parseBackupField(fileData.accounts)
          const recs = parseBackupField(fileData.recurring)
          const debts = parseBackupField(fileData.debts)
          const budgets = parseBackupField(fileData.budgets)
          const cats = parseBackupField(fileData.categories)
          
          let sets = {}
          if (fileData.settings) {
            if (typeof fileData.settings === 'string') {
              try { sets = JSON.parse(fileData.settings) } catch(e) {}
            } else {
              sets = fileData.settings
            }
          }

          const accountIdMap = {}

          // 1. Accounts
          if (accs.length > 0) {
            const { error: delErr } = await supabase.from('accounts').delete().eq('user_id', userId)
            if (delErr) throw new Error('Error al limpiar cuentas: ' + delErr.message)
            
            for (const a of accs) {
              const row = {
                user_id: userId,
                name: a.name,
                type: a.type || 'checking',
                currency: a.currency || 'CLP',
                balance: Number(a.balance) || 0,
                created_at: a.createdAt || new Date().toISOString()
              }
              const { data, error } = await supabase.from('accounts').insert(row).select().single()
              if (error) throw new Error('Error al insertar cuenta: ' + error.message)
              if (data) {
                accountIdMap[a.id] = data.id 
              }
            }
          }

          // 2. Transactions
          if (txs.length > 0) {
            const { error: delErr } = await supabase.from('transactions').delete().eq('user_id', userId)
            if (delErr) throw new Error('Error al limpiar transacciones: ' + delErr.message)
            
            const txRows = txs.map(t => {
              // Si el método de pago es un ID de cuenta antiguo, actualizarlo al nuevo UUID
              let pm = t.paymentMethod
              if (accountIdMap[pm]) pm = accountIdMap[pm]

              return {
                user_id: userId,
                type: t.type,
                date: t.date,
                description: t.description,
                amount: Number(t.amount),
                currency: t.currency || 'CLP',
                category: t.category,
                payment_method: pm,
                is_paid: t.isPaid || false,
                is_applied_to_account: t.isAppliedToAccount || false,
                apply_savings_pct: t.applySavingsPct !== false,
                is_recurring: t.isRecurring || false,
                month: t.month,
                created_at: t.createdAt || new Date().toISOString()
              }
            })
            
            // Insertar en lotes de 100 para evitar timeout
            for (let i = 0; i < txRows.length; i += 100) {
              const { error: insErr } = await supabase.from('transactions').insert(txRows.slice(i, i + 100))
              if (insErr) {
                console.error('ERROR DETALLADO EN TRANSACCIONES:', insErr)
                throw new Error('Error al insertar transacciones: ' + insErr.message)
              }
            }
          }

          // 3. Recurring
          if (recs.length > 0) {
            const { error: delErr } = await supabase.from('recurring').delete().eq('user_id', userId)
            if (delErr) throw new Error('Error al limpiar recurrentes: ' + delErr.message)
            
            const recRows = recs.map(r => {
              let pm = r.paymentMethod || 'credit_card_clp'
              if (accountIdMap[pm]) pm = accountIdMap[pm]

              return {
                user_id: userId,
                description: r.description,
                amount: Number(r.amount),
                currency: r.currency || 'CLP',
                category: r.category || null,
                payment_method: pm,
                day_of_month: r.dayOfMonth || 1,
                type: r.type || 'expense',
                created_at: r.createdAt || new Date().toISOString()
              }
            })
            for (const row of recRows) {
              const { error: insErr } = await supabase.from('recurring').insert(row)
              if (insErr) throw new Error('Error al insertar recurrente: ' + insErr.message)
            }
          }

          // 4. Debts
          if (debts.length > 0) {
            const { error: delErr } = await supabase.from('debts').delete().eq('user_id', userId)
            if (delErr) throw new Error('Error al limpiar deudas: ' + delErr.message)
            
            const debtRows = debts.map(d => ({
              user_id: userId,
              description: d.description,
              amount: Number(d.amount),
              currency: d.currency || 'USD',
              creditor: d.creditor || '',
              created_at: d.createdAt || new Date().toISOString()
            }))
            for (const row of debtRows) {
              const { error: insErr } = await supabase.from('debts').insert(row)
              if (insErr) throw new Error('Error al insertar deuda: ' + insErr.message)
            }
          }

          // 5. Categorías
          if (cats.length > 0) {
            const { error: catErr } = await supabase.from('categories').upsert({ user_id: userId, list: cats }, { onConflict: 'user_id' })
            if (catErr) throw new Error('Error al insertar categorías: ' + catErr.message)
          }

          // 6. Configuración
          if (Object.keys(sets).length > 0) {
            const { error: setErr } = await supabase.from('settings').upsert({ user_id: userId, data: sets }, { onConflict: 'user_id' })
            if (setErr) throw new Error('Error al insertar configuración: ' + setErr.message)
          }

          // 7. Presupuestos
          if (budgets.length > 0) {
            const { error: delErr } = await supabase.from('budgets').delete().eq('user_id', userId)
            if (delErr) throw new Error('Error al limpiar presupuestos: ' + delErr.message)
            
            const bRows = budgets.map(b => ({
              user_id: userId,
              month: b.month,
              items: b.items || [],
              created_at: b.createdAt || new Date().toISOString()
            }))
            for (const row of bRows) {
              const { error: insErr } = await supabase.from('budgets').insert(row)
              if (insErr) throw new Error('Error al insertar presupuesto: ' + insErr.message)
            }
          }

          alert('¡Migración exitosa! El archivo JSON se ha subido a Supabase de forma exitosa.')
          window.location.reload()
        } catch (e) {
          console.error('Migration inner error:', e)
          alert(`Error en la migración: ${e.message}`)
          setIsMigrating(false)
        }
      }
      reader.readAsText(file)
    } catch (e) {
      console.error('Migration file error:', e)
      alert(`Error al leer el archivo: ${e.message}`)
      setIsMigrating(false)
    }
  }

  const handleExport = () => {
    const data = {
      transactions: localStorage.getItem('fp_transactions'),
      accounts: localStorage.getItem('fp_accounts'),
      recurring: localStorage.getItem('fp_recurring'),
      debts: localStorage.getItem('fp_debts'),
      budgets: localStorage.getItem('fp_budgets'),
      categories: localStorage.getItem('fp_categories'),
      settings: localStorage.getItem('fp_settings')
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finanzas_backup_${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result)
        if (data.transactions) localStorage.setItem('fp_transactions', data.transactions)
        if (data.accounts) localStorage.setItem('fp_accounts', data.accounts)
        if (data.recurring) localStorage.setItem('fp_recurring', data.recurring)
        if (data.debts) localStorage.setItem('fp_debts', data.debts)
        if (data.budgets) localStorage.setItem('fp_budgets', data.budgets)
        if (data.categories) localStorage.setItem('fp_categories', data.categories)
        if (data.settings) localStorage.setItem('fp_settings', data.settings)
        
        alert('Datos importados correctamente. La aplicación se recargará.')
        window.location.reload()
      } catch (err) {
        alert('Error al leer el archivo. Asegúrate de que es un backup válido de la aplicación.')
      }
    }
    reader.readAsText(file)
  }

  const handleReset = () => {
    if (confirm('ADVERTENCIA: Esto borrará todos los datos locales de manera permanente. ¿Estás seguro?')) {
      localStorage.clear()
      window.location.href = '/'
    }
  }

  const handleCleanCorrupted = async () => {
    const removed = await cleanCorruptedData()
    if (removed === 0) {
      alert('✅ No se encontraron datos corruptos. Todo está limpio.')
      return
    }
    // Regenerar recurrentes para el mes actual
    const currentMonth = new Date().toISOString().substring(0, 7)
    await generateRecurringForMonth(currentMonth)
    // También el mes siguiente
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    const nextMonth = d.toISOString().substring(0, 7)
    generateRecurringForMonth(nextMonth)
    
    alert(`✅ Se eliminaron ${removed} registro(s) corruptos (sin categoría). Los gastos recurrentes fueron regenerados correctamente. Se recargará la app.`)
    window.location.reload()
  }

  return (
    <>
      <div className="animate-fadeIn">
      <Header title="Configuración" />
      <div className="container">
        
        {/* Migration & Backups (MOVED TO TOP FOR VISIBILITY) */}
        <div className="card mb-6 border-primary border-2" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)' }}>
          <h2 className="mb-4 text-primary" style={{ fontSize: '1.25rem' }}>☁️ Subir Backup a Supabase</h2>
          <p className="text-secondary mb-4" style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
            Selecciona tu archivo de respaldo (<b>.json</b>) para subirlo directamente a la nube.
          </p>
          <div style={{ position: 'relative' }}>
            <input 
              type="file" 
              accept=".json"
              onChange={handleMigrateFileToSupabase}
              disabled={isMigrating}
              style={{ position: 'absolute', top: 0, left: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
            />
            <button 
              className="btn btn-primary"
              disabled={isMigrating}
              style={{ padding: '12px 24px', fontWeight: 'bold', width: '100%', pointerEvents: 'none' }}
            >
              {isMigrating ? 'Subiendo y procesando datos...' : '📂 Elegir Archivo JSON y Subir a Supabase'}
            </button>
          </div>
        </div>

        {/* Starken-style Tabs Navigation */}
        <div className="tabs mb-6" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
          <button 
            className={`tab ${activeTab === 'categories' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('categories')}
            style={{ background: activeTab === 'categories' ? 'var(--bg-secondary)' : 'none', border: 'none', cursor: 'pointer' }}
          >
            Categorías
          </button>
          <button 
            className={`tab ${activeTab === 'recurring' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('recurring')}
            style={{ background: activeTab === 'recurring' ? 'var(--bg-secondary)' : 'none', border: 'none', cursor: 'pointer' }}
          >
            Gastos Recurrentes
          </button>
          <button 
            className={`tab ${activeTab === 'preferences' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('preferences')}
            style={{ background: activeTab === 'preferences' ? 'var(--bg-secondary)' : 'none', border: 'none', cursor: 'pointer' }}
          >
            Preferencias y Datos
          </button>
        </div>

        {/* TAB 1: CATEGORIES */}
        {activeTab === 'categories' && (
          <div className="card animate-fadeIn" style={{ padding: '24px' }}>
            <h2 className="mb-2" style={{ fontSize: '1.25rem' }}>Administración de Categorías</h2>
            <p className="text-secondary text-sm mb-4">Añade o modifica las categorías que utilizas para clasificar tus gastos.</p>
            
            {/* Add Category Form */}
            <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input 
                type="text" 
                placeholder="Nueva Categoría..." 
                value={newCategoryName} 
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                required
              />
              <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--color-success)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <span>+ Añadir</span>
              </button>
            </form>

            {/* Categories List (Starken-style UI) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...categories].sort((a, b) => a.localeCompare(b, 'es')).map(cat => (
                <div 
                  key={cat} 
                  className="card flex items-center justify-between" 
                  style={{ 
                    padding: '12px 16px', 
                    margin: 0, 
                    borderLeft: '4px solid var(--color-accent)', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    boxShadow: 'var(--shadow-sm)'
                  }}
                >
                  {editingCat === cat ? (
                    <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }}>
                      <input 
                        type="text" 
                        value={editNameValue} 
                        onChange={(e) => setEditNameValue(e.target.value)} 
                        className="input" 
                        style={{ padding: '6px 10px', fontSize: '0.9rem', flex: 1 }}
                        required
                        autoFocus
                      />
                      <button onClick={() => handleSaveRename(cat)} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Guardar
                      </button>
                      <button onClick={() => setEditingCat(null)} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{cat}</span>
                        {usedCategories.has(cat) ? (
                          <span style={{ fontSize: '0.7rem', background: 'var(--color-primary)', color: 'white', padding: '2px 6px', borderRadius: '4px', opacity: 0.8 }}>En uso</span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', background: 'var(--color-border)', color: 'var(--color-text-secondary)', padding: '2px 6px', borderRadius: '4px' }}>Sin uso</span>
                        )}
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                        <button 
                          onClick={() => handleStartEdit(cat)} 
                          className="text-secondary"
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', background: 'none', border: 'none' }}
                          title="Editar"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleDeleteClick(cat)} 
                          className="text-danger"
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', background: 'none', border: 'none' }}
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
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: RECURRING ITEMS */}
        {activeTab === 'recurring' && (
          <div className="card animate-fadeIn" style={{ padding: '24px' }}>
            <h2 className="mb-2" style={{ fontSize: '1.25rem' }}>Elementos Recurrentes</h2>
            <p className="text-secondary text-sm mb-4">Configura los gastos o ingresos fijos que ocurren automáticamente mes a mes.</p>
            
            {/* Add Recurring Form */}
            <form onSubmit={handleAddRecurring} className="mb-6" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '20px' }}>
              <h3 className="mb-3 text-sm font-bold">Agregar Elemento Recurrente</h3>
              <div className="flex-col gap-4">
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Tipo</label>
                    <select 
                      value={newRec.type || 'expense'} 
                      onChange={(e) => {
                        const type = e.target.value
                        const defaultPaymentMethod = type === 'income' ? (accounts[0]?.id || 'cash') : 'cash'
                        setNewRec({...newRec, type, paymentMethod: defaultPaymentMethod})
                      }} 
                      className="select"
                    >
                      <option value="expense">Gasto Recurrente</option>
                      <option value="income">Ingreso Recurrente</option>
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Descripción</label>
                    <input 
                      type="text" 
                      value={newRec.description} 
                      onChange={(e) => setNewRec({...newRec, description: e.target.value})} 
                      className="input" 
                      placeholder={newRec.type === 'income' ? "Ej. Sueldo, Arriendo recibido..." : "Ej. Netflix, Gimnasio..."}
                      required
                    />
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Monto</label>
                    <input 
                      type="number" 
                      value={newRec.amount} 
                      onChange={(e) => setNewRec({...newRec, amount: e.target.value})} 
                      className="input" 
                      required
                    />
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Moneda</label>
                    <select 
                      value={newRec.currency} 
                      onChange={(e) => setNewRec({...newRec, currency: e.target.value})} 
                      className="select"
                    >
                      <option value="CLP">CLP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">{newRec.type === 'income' ? 'Cuenta / Destino' : 'Método Pago'}</label>
                    <select 
                      value={newRec.paymentMethod} 
                      onChange={(e) => setNewRec({...newRec, paymentMethod: e.target.value})} 
                      className="select"
                    >
                      {newRec.type === 'income' ? (
                        <>
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>
                          ))}
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia (Genérico)</option>
                        </>
                      ) : (
                        <>
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia</option>
                          <option value="credit_card_clp">Tarjeta CLP</option>
                          <option value="credit_card_usd">Tarjeta USD</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Día del Mes</label>
                    <input 
                      type="number" 
                      value={newRec.dayOfMonth} 
                      onChange={(e) => setNewRec({...newRec, dayOfMonth: e.target.value})} 
                      className="input" 
                      min="1" 
                      max="31"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary w-full">Guardar Recurrente</button>
              </div>
            </form>

            {/* Recurring Items List */}
            <div>
              <h3 className="mb-3 text-sm font-bold">Listado Recurrentes Activos</h3>
              {recurringItems.length === 0 ? (
                <p className="text-secondary text-center py-4">No hay elementos recurrentes configurados.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[...recurringItems].sort((a, b) => (a.description || '').localeCompare(b.description || '', 'es')).map(item => {
                    const isIncome = item.type === 'income';
                    const matchedAcc = accounts.find(a => a.id === item.paymentMethod);
                    const paymentMethodLabel = matchedAcc 
                      ? matchedAcc.name 
                      : (item.paymentMethod === 'cash' ? 'Efectivo' : item.paymentMethod === 'transfer' ? 'Transferencia' : item.paymentMethod === 'credit_card_clp' ? 'Tarjeta CLP' : item.paymentMethod === 'credit_card_usd' ? 'Tarjeta USD' : item.paymentMethod);

                    return (
                      <div 
                        key={item.id} 
                        className="card" 
                        style={{ 
                          padding: '12px 16px', 
                          margin: 0, 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          boxShadow: 'var(--shadow-sm)',
                          borderLeft: isIncome ? '4px solid var(--color-success)' : '4px solid var(--color-warning)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 600 }}>{item.description}</span>
                            <span className={`badge badge-${isIncome ? 'success' : 'warning'}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                              {isIncome ? 'INGRESO' : 'GASTO'}
                            </span>
                          </div>
                          <div className="text-secondary text-xs" style={{ marginTop: '2px' }}>
                            Día {item.dayOfMonth} • {paymentMethodLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span style={{ fontWeight: 700, color: isIncome ? 'var(--color-success)' : 'inherit' }}>
                            {isIncome ? '+' : ''}{formatCurrency(item.amount, item.currency)}
                          </span>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                            <button 
                              onClick={() => handleStartEditRecurring(item)} 
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
                              onClick={() => handleDeleteRecurring(item.id)} 
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: PREFERENCES & DATA */}
        {activeTab === 'preferences' && (
          <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Preferences */}
            <div className="card" style={{ padding: '24px' }}>
              <h2 className="mb-4" style={{ fontSize: '1.25rem' }}>Preferencias</h2>
              
              <div className="form-field">
                <label className="form-label">Moneda Principal</label>
                <select 
                  className="select" 
                  value={settings?.defaultCurrency || 'CLP'} 
                  onChange={(e) => handleSettingChange('defaultCurrency', e.target.value)}
                >
                  <option value="CLP">CLP - Peso Chileno</option>
                  <option value="USD">USD - Dólar Estadounidense</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Porcentaje de Ahorro Mensual (%)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="number" 
                    value={settings?.savingsPercentage ?? 0} 
                    onChange={(e) => handleSettingChange('savingsPercentage', Number(e.target.value))} 
                    className="input" 
                    min="0" 
                    max="100"
                    style={{ width: '100px', padding: '8px' }}
                  />
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>%</span>
                </div>
                <p className="text-sm text-secondary mt-1">Este porcentaje se aplicará sobre el total de tus ingresos del mes para calcular el ahorro separado de forma automática.</p>
              </div>

              <div className="form-field">
                <label className="form-label">Tipo de Cambio Tarjeta USD (CLP)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>$</span>
                  <input 
                    type="number" 
                    value={settings?.usdCardExchangeRate ?? 950} 
                    onChange={(e) => handleSettingChange('usdCardExchangeRate', Number(e.target.value))} 
                    className="input" 
                    min="1"
                    style={{ width: '120px', padding: '8px' }}
                  />
                  <span className="text-secondary text-sm">Pesos por Dólar</span>
                </div>
                <p className="text-sm text-secondary mt-1">Este tipo de cambio se utilizará para expresar y calcular tu deuda por pagar de la tarjeta en USD en pesos chilenos (CLP).</p>
              </div>

              <div className="form-field">
                <label className="form-label">Tiempo de inactividad para cierre automático (minutos)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="number" 
                    value={settings?.inactivityTimeout ?? 15} 
                    onChange={(e) => handleSettingChange('inactivityTimeout', Number(e.target.value))} 
                    className="input" 
                    min="1" 
                    max="1440"
                    style={{ width: '100px', padding: '8px' }}
                  />
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>min</span>
                </div>
                <p className="text-sm text-secondary mt-1">Si no interactúas con la app durante este tiempo, tu sesión se cerrará automáticamente por seguridad.</p>
              </div>
              
              <div className="form-field">
                <label className="form-label">Tema Visual</label>
                <p className="text-sm text-secondary mb-2">Usa el ícono de la luna/sol ☀️ 🌙 en la esquina superior derecha para alternar los temas visuales de la aplicación.</p>
              </div>
            </div>

            {/* Backups */}
            <div className="card" style={{ padding: '24px' }}>
              <h2 className="mb-4 mt-2" style={{ fontSize: '1.25rem' }}>Respaldo Manual</h2>
              <div className="flex-col gap-4">
                <button className="btn btn-primary" onClick={handleExport} style={{ cursor: 'pointer' }}>
                  ⬇️ Exportar Datos (JSON)
                </button>
                
                <button className="btn btn-secondary text-danger mt-6 border-danger border" onClick={handleReset} style={{ border: '1px solid var(--color-danger)', cursor: 'pointer' }}>
                  ⚠️ Borrar todos los datos de la aplicación
                </button>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>

      {/* MERGE CATEGORIES MODAL (STARKEN LOGIC) */}
      {mergingCat && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '420px', padding: '24px' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>¿Fusionar Categoría Activa?</h3>
              <button onClick={() => setMergingCat(null)} className="text-secondary" style={{ fontSize: '1.5rem', lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}>&times;</button>
            </div>
            <div className="modal-body mb-6">
              <p className="text-secondary text-sm mb-4">
                La categoría <strong className="text-danger">{mergingCat}</strong> está en uso por transacciones o presupuestos históricos.
              </p>
              <p className="text-secondary text-sm mb-4">
                Para poder eliminarla, debes seleccionar otra categoría de destino a la cual se fusionarán todos estos registros:
              </p>
              <div className="form-field">
                <label className="form-label">Categoría de Destino</label>
                <select 
                  className="select" 
                  value={mergeTarget} 
                  onChange={(e) => setMergeTarget(e.target.value)}
                  required
                >
                  <option value="">-- Selecciona una categoría --</option>
                  {categories
                    .filter(c => c !== mergingCat)
                    .map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  }
                </select>
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
              <button onClick={() => setMergingCat(null)} className="btn btn-secondary">Cancelar</button>
              <button 
                onClick={handleMergeAndDelete} 
                className="btn btn-primary"
                disabled={!mergeTarget}
                style={{ backgroundColor: 'var(--color-danger)', borderColor: 'var(--color-danger)', color: 'white', cursor: mergeTarget ? 'pointer' : 'not-allowed' }}
              >
                Fusionar y Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT RECURRING MODAL */}
      {editingRecItem && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="modal" style={{ maxWidth: '500px', padding: '24px', borderRadius: '16px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Editar Elemento Recurrente</h3>
              <button 
                onClick={() => setEditingRecItem(null)} 
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
            <form onSubmit={handleSaveRecurringEdit}>
              <div className="modal-body flex-col gap-4" style={{ padding: '16px 0' }}>
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Tipo</label>
                    <select 
                      value={editRecData.type || 'expense'} 
                      onChange={(e) => {
                        const type = e.target.value
                        const defaultPaymentMethod = type === 'income' ? (accounts[0]?.id || 'cash') : 'cash'
                        setEditRecData({...editRecData, type, paymentMethod: defaultPaymentMethod})
                      }} 
                      className="select"
                    >
                      <option value="expense">Gasto Recurrente</option>
                      <option value="income">Ingreso Recurrente</option>
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Descripción</label>
                    <input 
                      type="text" 
                      value={editRecData.description} 
                      onChange={(e) => setEditRecData({...editRecData, description: e.target.value})} 
                      className="input" 
                      required
                    />
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 2 }}>
                    <label className="form-label">Monto</label>
                    <input 
                      type="number" 
                      value={editRecData.amount} 
                      onChange={(e) => setEditRecData({...editRecData, amount: e.target.value})} 
                      className="input" 
                      required
                    />
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Moneda</label>
                    <select 
                      value={editRecData.currency} 
                      onChange={(e) => setEditRecData({...editRecData, currency: e.target.value})} 
                      className="select"
                    >
                      <option value="CLP">CLP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">{editRecData.type === 'income' ? 'Cuenta / Destino' : 'Método Pago'}</label>
                    <select 
                      value={editRecData.paymentMethod} 
                      onChange={(e) => setEditRecData({...editRecData, paymentMethod: e.target.value})} 
                      className="select"
                    >
                      {editRecData.type === 'income' ? (
                        <>
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>
                          ))}
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia (Genérico)</option>
                        </>
                      ) : (
                        <>
                          <option value="cash">Efectivo</option>
                          <option value="transfer">Transferencia</option>
                          <option value="credit_card_clp">Tarjeta CLP</option>
                          <option value="credit_card_usd">Tarjeta USD</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="form-label">Día del Mes</label>
                    <input 
                      type="number" 
                      value={editRecData.dayOfMonth} 
                      onChange={(e) => setEditRecData({...editRecData, dayOfMonth: e.target.value})} 
                      className="input" 
                      min="1" 
                      max="31"
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '8px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  onClick={() => setEditingRecItem(null)} 
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </>
  )
}
