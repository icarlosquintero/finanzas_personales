// src/lib/db.js — Supabase-backed version
// All functions are now async. Same exported signatures as the localStorage version.

import { supabase } from './supabase'
import { createRequestCache } from './requestCache'

const reads = createRequestCache(10000)
let userRequest = null
let authVersion = 0
supabase.auth.onAuthStateChange(() => { authVersion++; userRequest = null; reads.clear() })
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => reads.clear())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reads.clear() })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUserId() {
  if (!userRequest) {
    const version = authVersion
    const request = supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) throw error
      if (!user || version !== authVersion) throw new Error('La sesión cambió. Intenta nuevamente.')
      return user.id
    })
    userRequest = request
    request.finally(() => { if (userRequest === request) userRequest = null }).catch(() => {})
  }
  return userRequest
}

// Convert snake_case DB row → camelCase app object for transactions
function rowToTx(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    date: row.date,
    month: row.month,
    category: row.category,
    paymentMethod: row.payment_method,
    isPaid: row.is_paid,
    isAppliedToAccount: row.is_applied_to_account,
    isRecurring: row.is_recurring,
    applySavingsPct: row.apply_savings_pct,
    createdAt: row.created_at,
  }
}

function txToRow(tx, userId) {
  return {
    user_id: userId,
    type: tx.type,
    description: tx.description,
    amount: Number(tx.amount),
    currency: tx.currency || 'CLP',
    date: tx.date,
    month: tx.month,
    category: tx.category || null,
    payment_method: tx.paymentMethod || null,
    is_paid: tx.isPaid ?? false,
    is_applied_to_account: tx.isAppliedToAccount ?? false,
    is_recurring: tx.isRecurring ?? false,
    apply_savings_pct: tx.applySavingsPct ?? true,
    created_at: tx.createdAt || new Date().toISOString(),
  }
}

function rowToAccount(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    balance: Number(row.balance),
    createdAt: row.created_at,
  }
}

function rowToRecurring(row) {
  if (!row) return null
  return {
    id: row.id,
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    paymentMethod: row.payment_method,
    dayOfMonth: row.day_of_month,
    type: row.type || 'expense',
    createdAt: row.created_at,
  }
}

// ─── Account balance helper ─────────────────────────────────────────────────

async function adjustAccountBalance(userId, paymentMethod, amountChange) {
  // Find the account by ID
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, balance')
    .eq('user_id', userId)
    .eq('id', paymentMethod)
    .single()

  if (!accounts) return

  const newBalance = Number(accounts.balance) + amountChange
  await supabase
    .from('accounts')
    .update({ balance: newBalance })
    .eq('id', accounts.id)
    .eq('user_id', userId)
}

// ─── TRANSACTIONS ────────────────────────────────────────────────────────────

async function getAllTransactionsImpl(executedMap = null) {
  const userId = await getUserId()

  // If no executedMap provided, fetch settings ourselves
  const fetchSettings = executedMap === null ? getSettings() : Promise.resolve(null)

  const [{ data, error }, settingsResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }),
    fetchSettings
  ])

  if (error) { console.error('getAllTransactions:', error); return [] }
  const map = executedMap !== null ? executedMap : (settingsResult?.executedTxs || {})
  return (data || []).map(row => {
    const tx = rowToTx(row)
    if (tx) tx.isExecuted = !!map[tx.id]
    return tx
  })
}

async function getTransactionsImpl(month) {
  const all = await getAllTransactions()
  if (!month) return all
  return all.filter(t => t.month === month)
}

async function getTransactionsByPaymentMethodImpl(month, method) {
  const txs = await getTransactions(month)
  return txs.filter(t => t.paymentMethod === method)
}

async function addTransactionImpl(transaction, bypassAccountUpdate = false) {
  const userId = await getUserId()
  const row = txToRow(transaction, userId)

  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select()
    .single()

  if (error) throw error

  // Apply to account balance if paid and not a credit card
  if (row.is_paid && row.payment_method !== 'credit_card_clp' && row.payment_method !== 'credit_card_usd' && !bypassAccountUpdate) {
    const amountChange = row.type === 'income' ? Number(row.amount) : -Number(row.amount)
    await adjustAccountBalance(userId, row.payment_method, amountChange)
    // Mark as applied
    await supabase.from('transactions').update({ is_applied_to_account: true }).eq('id', data.id)
    data.is_applied_to_account = true
  } else if (row.is_paid && row.payment_method !== 'credit_card_clp' && row.payment_method !== 'credit_card_usd') {
    await supabase.from('transactions').update({ is_applied_to_account: true }).eq('id', data.id)
    data.is_applied_to_account = true
  }

  return rowToTx(data)
}

async function addTransactionsImpl(transactionsList, bypassAccountUpdate = false) {
  if (!transactionsList || transactionsList.length === 0) return []
  const userId = await getUserId()
  const rows = transactionsList.map(tx => txToRow(tx, userId))

  const { data, error } = await supabase
    .from('transactions')
    .insert(rows)
    .select()

  if (error) {
    throw error
  }

  const result = (data || []).map(rowToTx)

  // Handle balance updates for non-card paid transactions
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const insertedTx = result[i]
    if (row.is_paid && row.payment_method !== 'credit_card_clp' && row.payment_method !== 'credit_card_usd' && insertedTx && !bypassAccountUpdate) {
      const amountChange = row.type === 'income' ? Number(row.amount) : -Number(row.amount)
      await adjustAccountBalance(userId, row.payment_method, amountChange)
      await supabase.from('transactions').update({ is_applied_to_account: true }).eq('id', insertedTx.id)
      insertedTx.isAppliedToAccount = true
    } else if (row.is_paid && row.payment_method !== 'credit_card_clp' && row.payment_method !== 'credit_card_usd' && insertedTx) {
      await supabase.from('transactions').update({ is_applied_to_account: true }).eq('id', insertedTx.id)
      insertedTx.isAppliedToAccount = true
    }
  }

  return result
}

async function updateTransactionImpl(id, updates) {
  const userId = await getUserId()

  // Get old version
  const { data: oldData } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (!oldData) return null
  const oldTx = rowToTx(oldData)

  // Revert old balance impact
  if (oldTx.isPaid && oldTx.isAppliedToAccount && oldTx.paymentMethod !== 'credit_card_clp' && oldTx.paymentMethod !== 'credit_card_usd') {
    const revert = oldTx.type === 'income' ? -Number(oldTx.amount) : Number(oldTx.amount)
    await adjustAccountBalance(userId, oldTx.paymentMethod, revert)
  }

  // Merge updates
  const merged = { ...oldTx, ...updates }
  const newRow = txToRow(merged, userId)
  newRow.is_applied_to_account = false

  // Apply new balance impact
  if (merged.isPaid && merged.paymentMethod !== 'credit_card_clp' && merged.paymentMethod !== 'credit_card_usd') {
    const amountChange = merged.type === 'income' ? Number(merged.amount) : -Number(merged.amount)
    await adjustAccountBalance(userId, merged.paymentMethod, amountChange)
    newRow.is_applied_to_account = true
  }

  const { data, error } = await supabase
    .from('transactions')
    .update(newRow)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return rowToTx(data)
}

async function deleteTransactionImpl(id) {
  const userId = await getUserId()

  const { data: oldData } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (oldData) {
    const oldTx = rowToTx(oldData)
    if (oldTx.isPaid && oldTx.isAppliedToAccount && oldTx.paymentMethod !== 'credit_card_clp' && oldTx.paymentMethod !== 'credit_card_usd') {
      const revert = oldTx.type === 'income' ? -Number(oldTx.amount) : Number(oldTx.amount)
      await adjustAccountBalance(userId, oldTx.paymentMethod, revert)
    }
  }

  const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
}

async function toggleTransactionStatusImpl(tx) {
  const settings = await getSettings()
  const executedMap = { ...(settings.executedTxs || {}) }

  if (!tx.isExecuted && !tx.isPaid) {
    // Pendiente -> Ejecutado
    executedMap[tx.id] = true
    await saveSettings({ ...settings, executedTxs: executedMap })
    if (tx.isPaid) {
      await updateTransaction(tx.id, { isPaid: false })
    }
    return { ...tx, isExecuted: true, isPaid: false }
  } else if (tx.isExecuted && !tx.isPaid) {
    // Ejecutado -> Pagado
    delete executedMap[tx.id]
    await saveSettings({ ...settings, executedTxs: executedMap })
    const updated = await updateTransaction(tx.id, { isPaid: true })
    return { ...(updated || tx), isExecuted: false, isPaid: true }
  } else {
    // Pagado -> Pendiente
    delete executedMap[tx.id]
    await saveSettings({ ...settings, executedTxs: executedMap })
    const updated = await updateTransaction(tx.id, { isPaid: false })
    return { ...(updated || tx), isExecuted: false, isPaid: false }
  }
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

async function getAccountsImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) { console.error('getAccounts:', error); return [] }
  return (data || []).map(rowToAccount)
}

async function addAccountImpl(account) {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      user_id: userId,
      name: account.name,
      type: account.type || 'checking',
      currency: account.currency || 'CLP',
      balance: Number(account.balance) || 0,
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return rowToAccount(data)
}

async function updateAccountImpl(id, updates) {
  const userId = await getUserId()
  const updateData = {}
  if (updates.name !== undefined) updateData.name = updates.name
  if (updates.type !== undefined) updateData.type = updates.type
  if (updates.currency !== undefined) updateData.currency = updates.currency
  if (updates.balance !== undefined) updateData.balance = Number(updates.balance)

  const { data, error } = await supabase
    .from('accounts')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return rowToAccount(data)
}

async function deleteAccountImpl(id) {
  const userId = await getUserId()
  await supabase.from('accounts').delete().eq('id', id).eq('user_id', userId)
}

// ─── DEBTS ───────────────────────────────────────────────────────────────────

async function getDebtsImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('debts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) { console.error('getDebts:', error); return [] }
  return (data || []).map(row => ({
    id: row.id,
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    creditor: row.creditor,
    createdAt: row.created_at,
  }))
}

async function addDebtImpl(debt) {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('debts')
    .insert({
      user_id: userId,
      description: debt.description,
      amount: Number(debt.amount),
      currency: debt.currency || 'USD',
      creditor: debt.creditor || '',
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) { console.error('addDebt:', error); return null }
  return { id: data.id, description: data.description, amount: Number(data.amount), currency: data.currency, creditor: data.creditor, createdAt: data.created_at }
}

async function updateDebtImpl(id, updates) {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('debts')
    .update({
      description: updates.description,
      amount: Number(updates.amount),
      currency: updates.currency,
      creditor: updates.creditor,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) { console.error('updateDebt:', error); return null }
  return { id: data.id, description: data.description, amount: Number(data.amount), currency: data.currency, creditor: data.creditor, createdAt: data.created_at }
}

async function deleteDebtImpl(id) {
  const userId = await getUserId()
  await supabase.from('debts').delete().eq('id', id).eq('user_id', userId)
}

// ─── RECURRING ───────────────────────────────────────────────────────────────

async function getRecurringImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('recurring')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) { console.error('getRecurring:', error); return [] }
  return (data || []).map(rowToRecurring)
}

async function addRecurringImpl(item) {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('recurring')
    .insert({
      user_id: userId,
      description: item.description,
      amount: Number(item.amount),
      currency: item.currency || 'CLP',
      category: item.category || null,
      payment_method: item.paymentMethod || 'credit_card_clp',
      day_of_month: item.dayOfMonth || 1,
      type: item.type || 'expense',
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) { console.error('addRecurring:', error); return null }
  return rowToRecurring(data)
}

async function updateRecurringImpl(id, updates) {
  const userId = await getUserId()
  const updateData = {}
  if (updates.description !== undefined) updateData.description = updates.description
  if (updates.amount !== undefined) updateData.amount = Number(updates.amount)
  if (updates.currency !== undefined) updateData.currency = updates.currency
  if (updates.category !== undefined) updateData.category = updates.category
  if (updates.paymentMethod !== undefined) updateData.payment_method = updates.paymentMethod
  if (updates.dayOfMonth !== undefined) updateData.day_of_month = updates.dayOfMonth
  if (updates.type !== undefined) updateData.type = updates.type

  const { data, error } = await supabase
    .from('recurring')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) { console.error('updateRecurring:', error); return null }
  return rowToRecurring(data)
}

async function deleteRecurringImpl(id) {
  const userId = await getUserId()
  // 1. Fetch item description before deleting
  const { data: recItem } = await supabase
    .from('recurring')
    .select('description')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  await supabase.from('recurring').delete().eq('id', id).eq('user_id', userId)

  // 2. Clean up auto-generated unpaid recurring transactions in FUTURE months (month > currentMonth)
  if (recItem && recItem.description) {
    const currentMonth = new Date().toISOString().substring(0, 7)
    const descKey = recItem.description.toLowerCase().trim()

    const { data: futureTxs } = await supabase
      .from('transactions')
      .select('id, month, description, is_recurring, is_paid')
      .eq('user_id', userId)
      .gt('month', currentMonth)

    if (futureTxs && futureTxs.length > 0) {
      const idsToDelete = futureTxs
        .filter(t => t.description && t.description.toLowerCase().trim() === descKey && t.is_recurring && !t.is_paid)
        .map(t => t.id)

      if (idsToDelete.length > 0) {
        await supabase.from('transactions').delete().in('id', idsToDelete)
      }
    }
  }
}

async function generateRecurringForMonthImpl(monthStr) {
  const currentMonth = new Date().toISOString().substring(0, 7)
  if (monthStr < currentMonth) return false

  const userId = await getUserId()
  const [allTxs, recurring, settings] = await Promise.all([getAllTransactions({}), getRecurring(), getSettings()])
  const pausedRecurrents = settings.pausedRecurrents || {}
  let updated = false

  // 1. Purge orphan recurring transactions in future months (monthStr > currentMonth)
  // whose template was deleted from the recurring table
  if (monthStr > currentMonth) {
    const activeRecDescs = new Set(recurring.map(r => r.description.toLowerCase().trim()))
    const orphanTxs = allTxs.filter(t =>
      t.month === monthStr &&
      t.isRecurring &&
      !t.isPaid &&
      !t.isExecuted &&
      !activeRecDescs.has(t.description.toLowerCase().trim())
    )
    if (orphanTxs.length > 0) {
      const orphanIds = orphanTxs.map(t => t.id)
      await supabase.from('transactions').delete().in('id', orphanIds)
      updated = true
    }
  }

  // 2. Insert missing recurring items for this month
  const inserts = []

  for (const r of recurring) {
    // Skip if paused for this month
    if (pausedRecurrents[r.id] && pausedRecurrents[r.id] <= monthStr) continue

    // Only apply from the month AFTER creation (a recurring added in July starts in August)
    const createdMonth = r.createdAt ? r.createdAt.substring(0, 7) : '2000-01'
    if (monthStr <= createdMonth) continue

    const type = r.type || 'expense'
    const category = type === 'income' ? 'Ingresos' : (r.category || r.description)
    const descKey = r.description.toLowerCase().trim()

    const exists = allTxs.some(t => t.month === monthStr && t.description.toLowerCase().trim() === descKey)
    if (!exists) {
      inserts.push({
        type,
        date: `${monthStr}-${String(r.dayOfMonth || 1).padStart(2, '0')}`,
        description: r.description,
        amount: Number(r.amount),
        currency: r.currency || 'CLP',
        category,
        paymentMethod: r.paymentMethod || (type === 'income' ? 'cash' : 'credit_card_clp'),
        isPaid: false,
        applySavingsPct: true,
        isRecurring: true,
        month: monthStr,
        createdAt: new Date().toISOString(),
      })
      updated = true
    }
  }

  // Insert all new recurring transactions in batch
  if (inserts.length > 0) {
    await addTransactions(inserts, true)
  }

  return updated
}

// Delete a recurring item and remove its generated transactions from `fromMonth` onwards (inclusive)
async function deleteRecurringFromImpl(id, fromMonth) {
  const userId = await getUserId()

  // 1. Get description before deleting
  const { data: recItem } = await supabase
    .from('recurring')
    .select('description')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  // 2. Delete from recurring table
  await supabase.from('recurring').delete().eq('id', id).eq('user_id', userId)

  // 3. Delete matching isRecurring transactions from fromMonth onwards
  if (recItem?.description) {
    const descKey = recItem.description.toLowerCase().trim()
    const { data: txsToDelete } = await supabase
      .from('transactions')
      .select('id, month, description, is_recurring, is_paid')
      .eq('user_id', userId)
      .gte('month', fromMonth)

    if (txsToDelete?.length > 0) {
      const idsToDelete = txsToDelete
        .filter(t => t.description?.toLowerCase().trim() === descKey && t.is_recurring && !t.is_paid)
        .map(t => t.id)
      if (idsToDelete.length > 0) {
        await supabase.from('transactions').delete().in('id', idsToDelete)
      }
    }
  }
}


// Delete isRecurring, unpaid transactions for `description` strictly AFTER `afterMonth`
// Used when pausing a recurring item: current month's transaction is preserved
async function deleteFutureRecurringTxsAfterImpl(description, afterMonth) {
  const userId = await getUserId()
  const descKey = description.toLowerCase().trim()
  const { data: txsToDelete } = await supabase
    .from('transactions')
    .select('id, month, description, is_recurring, is_paid')
    .eq('user_id', userId)
    .gt('month', afterMonth)

  if (txsToDelete?.length > 0) {
    const idsToDelete = txsToDelete
      .filter(t => t.description?.toLowerCase().trim() === descKey && t.is_recurring && !t.is_paid)
      .map(t => t.id)
    if (idsToDelete.length > 0) {
      await supabase.from('transactions').delete().in('id', idsToDelete)
    }
  }
}


// ─── BUDGETS ─────────────────────────────────────────────────────────────────

async function getBudgetsImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)

  if (error) { console.error('getBudgets:', error); return [] }
  return (data || []).map(row => ({ id: row.id, month: row.month, items: row.items || [], createdAt: row.created_at }))
}

async function getBudgetImpl(month) {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .single()

  if (error || !data) return { month, items: [] }
  return { id: data.id, month: data.month, items: data.items || [], createdAt: data.created_at }
}

async function saveBudgetImpl(month, items) {
  const userId = await getUserId()
  const { error } = await supabase
    .from('budgets')
    .upsert({ user_id: userId, month, items }, { onConflict: 'user_id,month' })

  if (error) throw error
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  'Generales', 'Rappi', 'Salidas', 'Adicionales', 'Auto',
  'Expensas', 'Salud', 'Otros', 'Michelle', 'Servicios',
  'Suscripciones', 'Vivienda', 'Familia', 'Educación', 'Mascotas', 'Ingresos'
]

async function getCategoriesImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('categories')
    .select('list')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    // Initialize with defaults
    await supabase.from('categories').upsert({ user_id: userId, list: DEFAULT_CATEGORIES }, { onConflict: 'user_id' })
    return DEFAULT_CATEGORIES
  }

  const list = data.list && data.list.length > 0 ? data.list : DEFAULT_CATEGORIES

  // Ensure all transactions' categories are present
  const { data: txs, error: categoryError } = await supabase.from('transactions').select('category').eq('user_id', userId)
  if (categoryError) throw categoryError
  const txCategories = [...new Set((txs || []).map(t => t.category).filter(Boolean))]
  let changed = false
  txCategories.forEach(c => {
    const clean = c.trim()
    if (clean && !list.includes(clean)) {
      list.push(clean)
      changed = true
    }
  })
  if (changed) {
    await supabase.from('categories').upsert({ user_id: userId, list }, { onConflict: 'user_id' })
  }
  return list
}

async function saveCategoriesOrderImpl(orderedCategories) {
  if (!orderedCategories) return
  const userId = await getUserId()
  await supabase.from('categories').upsert({ user_id: userId, list: orderedCategories }, { onConflict: 'user_id' })
  return orderedCategories
}

async function addCategoryImpl(name) {
  if (!name) return
  const userId = await getUserId()
  const categories = await getCategories()
  const cleanName = name.trim()
  if (cleanName && !categories.includes(cleanName)) {
    categories.push(cleanName)
    await supabase.from('categories').upsert({ user_id: userId, list: categories }, { onConflict: 'user_id' })
  }
  return categories
}

async function updateCategoryImpl(oldName, newName) {
  if (!oldName || !newName) return
  const userId = await getUserId()
  const cleanOld = oldName.trim()
  const cleanNew = newName.trim()
  if (cleanOld === cleanNew) return

  // Update categories list
  let categories = await getCategories()
  categories = categories.map(c => c === cleanOld ? cleanNew : c)
  const uniqueCategories = [...new Set(categories)]
  await supabase.from('categories').upsert({ user_id: userId, list: uniqueCategories }, { onConflict: 'user_id' })

  // Update transactions
  const { data: txsToUpdate } = await supabase
    .from('transactions').select('id').eq('user_id', userId).eq('category', cleanOld)
  if (txsToUpdate && txsToUpdate.length > 0) {
    await supabase.from('transactions').update({ category: cleanNew }).eq('user_id', userId).eq('category', cleanOld)
  }

  // Update recurring
  await supabase.from('recurring').update({ category: cleanNew }).eq('user_id', userId).eq('category', cleanOld)

  // Update budgets: need to load and rewrite items JSONB
  const { data: budgetsToUpdate } = await supabase.from('budgets').select('*').eq('user_id', userId)
  if (budgetsToUpdate) {
    for (const b of budgetsToUpdate) {
      const items = (b.items || []).map(item => item.category === cleanOld ? { ...item, category: cleanNew } : item)
      await supabase.from('budgets').update({ items }).eq('id', b.id).eq('user_id', userId)
    }
  }
}

async function deleteCategoryImpl(name, mergeIntoName = null) {
  if (!name) return
  const userId = await getUserId()
  const cleanName = name.trim()

  let categories = await getCategories()
  categories = categories.filter(c => c !== cleanName)
  await supabase.from('categories').upsert({ user_id: userId, list: categories }, { onConflict: 'user_id' })

  if (mergeIntoName) {
    const cleanMerge = mergeIntoName.trim()
    await supabase.from('transactions').update({ category: cleanMerge }).eq('user_id', userId).eq('category', cleanName)
    await supabase.from('recurring').update({ category: cleanMerge }).eq('user_id', userId).eq('category', cleanName)

    const { data: budgetsToUpdate } = await supabase.from('budgets').select('*').eq('user_id', userId)
    if (budgetsToUpdate) {
      for (const b of budgetsToUpdate) {
        const hasMergeTarget = (b.items || []).some(item => item.category === cleanMerge)
        let items = b.items || []
        if (hasMergeTarget) {
          items = items.filter(item => item.category !== cleanName)
        } else {
          items = items.map(item => item.category === cleanName ? { ...item, category: cleanMerge } : item)
        }
        await supabase.from('budgets').update({ items }).eq('id', b.id).eq('user_id', userId)
      }
    }
  }
}

async function isCategoryInUseImpl(name) {
  if (!name) return false
  const userId = await getUserId()
  const cleanName = name.trim()

  const { count: txCount } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('category', cleanName)
  if (txCount > 0) return true

  const { count: recCount } = await supabase.from('recurring').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('category', cleanName)
  if (recCount > 0) return true

  const { data: budgets } = await supabase.from('budgets').select('items').eq('user_id', userId)
  if (budgets && budgets.some(b => (b.items || []).some(item => item.category === cleanName))) return true

  return false
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  theme: 'light',
  defaultCurrency: 'CLP',
  currencies: ['CLP', 'USD'],
  savingsPercentage: 0,
  inactivityTimeout: 5,
  closedCards: {},
  paidCards: {},
  usdCardExchangeRate: 950,
}

async function getSettingsImpl() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', userId)
    .limit(1)

  if (error) {
    console.error('⚠️ getSettings error:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      status: error.status,
    })
    return { ...DEFAULT_SETTINGS }
  }
  if (!data || data.length === 0) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(data[0].data || {}) }
}

async function saveSettingsImpl(settings) {
  const userId = await getUserId()
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, data: settings }, { onConflict: 'user_id' })
  if (error) throw error
}

// ─── LEGACY stubs (no-ops for compatibility) ─────────────────────────────────

async function cleanCorruptedDataImpl() { return 0 }
async function seedDemoDataImpl() { return }


async function getUsedCategoriesImpl() {
  const userId = await getUserId()
  const results = await Promise.all([
    supabase.from('transactions').select('category').eq('user_id', userId),
    supabase.from('recurring').select('category').eq('user_id', userId),
    supabase.from('budgets').select('items').eq('user_id', userId)
  ])
  const failed = results.find(r => r.error)
  if (failed) throw failed.error
  const [{ data: txs }, { data: recs }, { data: budgets }] = results
  
  const used = new Set()
  if (txs) txs.forEach(t => t.category && used.add(t.category))
  if (recs) recs.forEach(r => r.category && used.add(r.category))
  if (budgets) {
    budgets.forEach(b => {
      if (b.items) b.items.forEach(i => i.category && used.add(i.category))
    })
  }
  return Array.from(used)
}

const reusableReads = new Set(['getSettings', 'getAccounts', 'getDebts', 'getRecurring', 'getBudgets', 'getCategories', 'getAllTransactions', 'getUsedCategories'])
async function runOperation(name, operation, args) {
  if (typeof window === 'undefined') return operation(...args)
  if (reusableReads.has(name)) return reads.read(name + JSON.stringify(args), () => operation(...args))
  if (name.startsWith('get') || name.startsWith('is')) return operation(...args)
  reads.clear()
  try { return await operation(...args) } finally { reads.clear() }
}

// Opt-in diagnostics: function duration, never arguments or returned data.
async function measureOperation(name, operation, args) {
  let enabled = false
  try { enabled = typeof window !== 'undefined' && sessionStorage.getItem('finance-measure') === '1' } catch {}
  if (!enabled) return runOperation(name, operation, args)
  const started = performance.now()
  let outcome = 'Finalizó'
  try { return await runOperation(name, operation, args) }
  catch (error) { outcome = 'Error'; throw error }
  finally {
    window.dispatchEvent(new CustomEvent('finance-operation-timing', { detail: { name, ms: performance.now() - started, outcome } }))
  }
}

export async function getAllTransactions(...args) { return measureOperation('getAllTransactions', getAllTransactionsImpl, args) }

export async function getTransactions(...args) { return measureOperation('getTransactions', getTransactionsImpl, args) }

export async function getTransactionsByPaymentMethod(...args) { return measureOperation('getTransactionsByPaymentMethod', getTransactionsByPaymentMethodImpl, args) }

export async function addTransaction(...args) { return measureOperation('addTransaction', addTransactionImpl, args) }

export async function addTransactions(...args) { return measureOperation('addTransactions', addTransactionsImpl, args) }

export async function updateTransaction(...args) { return measureOperation('updateTransaction', updateTransactionImpl, args) }

export async function deleteTransaction(...args) { return measureOperation('deleteTransaction', deleteTransactionImpl, args) }

export async function toggleTransactionStatus(...args) { return measureOperation('toggleTransactionStatus', toggleTransactionStatusImpl, args) }

export async function getAccounts(...args) { return measureOperation('getAccounts', getAccountsImpl, args) }

export async function addAccount(...args) { return measureOperation('addAccount', addAccountImpl, args) }

export async function updateAccount(...args) { return measureOperation('updateAccount', updateAccountImpl, args) }

export async function deleteAccount(...args) { return measureOperation('deleteAccount', deleteAccountImpl, args) }

export async function getDebts(...args) { return measureOperation('getDebts', getDebtsImpl, args) }

export async function addDebt(...args) { return measureOperation('addDebt', addDebtImpl, args) }

export async function updateDebt(...args) { return measureOperation('updateDebt', updateDebtImpl, args) }

export async function deleteDebt(...args) { return measureOperation('deleteDebt', deleteDebtImpl, args) }

export async function getRecurring(...args) { return measureOperation('getRecurring', getRecurringImpl, args) }

export async function addRecurring(...args) { return measureOperation('addRecurring', addRecurringImpl, args) }

export async function updateRecurring(...args) { return measureOperation('updateRecurring', updateRecurringImpl, args) }

export async function deleteRecurring(...args) { return measureOperation('deleteRecurring', deleteRecurringImpl, args) }

export async function generateRecurringForMonth(...args) { return measureOperation('generateRecurringForMonth', generateRecurringForMonthImpl, args) }

export async function deleteRecurringFrom(...args) { return measureOperation('deleteRecurringFrom', deleteRecurringFromImpl, args) }

export async function deleteFutureRecurringTxsAfter(...args) { return measureOperation('deleteFutureRecurringTxsAfter', deleteFutureRecurringTxsAfterImpl, args) }

export async function getBudgets(...args) { return measureOperation('getBudgets', getBudgetsImpl, args) }

export async function getBudget(...args) { return measureOperation('getBudget', getBudgetImpl, args) }

export async function saveBudget(...args) { return measureOperation('saveBudget', saveBudgetImpl, args) }

export async function getCategories(...args) { return measureOperation('getCategories', getCategoriesImpl, args) }

export async function saveCategoriesOrder(...args) { return measureOperation('saveCategoriesOrder', saveCategoriesOrderImpl, args) }

export async function addCategory(...args) { return measureOperation('addCategory', addCategoryImpl, args) }

export async function updateCategory(...args) { return measureOperation('updateCategory', updateCategoryImpl, args) }

export async function deleteCategory(...args) { return measureOperation('deleteCategory', deleteCategoryImpl, args) }

export async function isCategoryInUse(...args) { return measureOperation('isCategoryInUse', isCategoryInUseImpl, args) }

export async function getSettings(...args) { return measureOperation('getSettings', getSettingsImpl, args) }

export async function saveSettings(...args) { return measureOperation('saveSettings', saveSettingsImpl, args) }

export async function cleanCorruptedData(...args) { return measureOperation('cleanCorruptedData', cleanCorruptedDataImpl, args) }

export async function seedDemoData(...args) { return measureOperation('seedDemoData', seedDemoDataImpl, args) }

export async function getUsedCategories(...args) { return measureOperation('getUsedCategories', getUsedCategoriesImpl, args) }
