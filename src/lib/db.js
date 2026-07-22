// src/lib/db.js — Supabase-backed version
// All functions are now async. Same exported signatures as the localStorage version.

import { supabase } from './supabase'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
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

export async function getAllTransactions() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) { console.error('getAllTransactions:', error); return [] }
  return (data || []).map(rowToTx)
}

export async function getTransactions(month) {
  const all = await getAllTransactions()
  if (!month) return all
  return all.filter(t => t.month === month)
}

export async function getTransactionsByPaymentMethod(month, method) {
  const txs = await getTransactions(month)
  return txs.filter(t => t.paymentMethod === method)
}

export async function addTransaction(transaction, bypassAccountUpdate = false) {
  const userId = await getUserId()
  const row = txToRow(transaction, userId)

  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select()
    .single()

  if (error) { console.error('addTransaction:', error); return null }

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

export async function updateTransaction(id, updates) {
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

  if (error) { console.error('updateTransaction:', error); return null }
  return rowToTx(data)
}

export async function deleteTransaction(id) {
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

  await supabase.from('transactions').delete().eq('id', id).eq('user_id', userId)
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

export async function getAccounts() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) { console.error('getAccounts:', error); return [] }
  return (data || []).map(rowToAccount)
}

export async function addAccount(account) {
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

  if (error) { console.error('addAccount:', error); return null }
  return rowToAccount(data)
}

export async function updateAccount(id, updates) {
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

  if (error) { console.error('updateAccount:', error); return null }
  return rowToAccount(data)
}

export async function deleteAccount(id) {
  const userId = await getUserId()
  await supabase.from('accounts').delete().eq('id', id).eq('user_id', userId)
}

// ─── DEBTS ───────────────────────────────────────────────────────────────────

export async function getDebts() {
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

export async function addDebt(debt) {
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

export async function updateDebt(id, updates) {
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

export async function deleteDebt(id) {
  const userId = await getUserId()
  await supabase.from('debts').delete().eq('id', id).eq('user_id', userId)
}

// ─── RECURRING ───────────────────────────────────────────────────────────────

export async function getRecurring() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('recurring')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) { console.error('getRecurring:', error); return [] }
  return (data || []).map(rowToRecurring)
}

export async function addRecurring(item) {
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

export async function updateRecurring(id, updates) {
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

export async function deleteRecurring(id) {
  const userId = await getUserId()
  await supabase.from('recurring').delete().eq('id', id).eq('user_id', userId)
}

export async function generateRecurringForMonth(monthStr) {
  const currentMonth = new Date().toISOString().substring(0, 7)
  if (monthStr < currentMonth) return false

  const [allTxs, recurring] = await Promise.all([getAllTransactions(), getRecurring()])
  let updated = false
  const inserts = []

  for (const r of recurring) {
    const createdMonth = r.createdAt ? r.createdAt.substring(0, 7) : '2000-01'
    if (monthStr < createdMonth) continue

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

  // Insert all new recurring transactions
  for (const tx of inserts) {
    await addTransaction(tx, true)
  }

  return updated
}

// ─── BUDGETS ─────────────────────────────────────────────────────────────────

export async function getBudgets() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)

  if (error) { console.error('getBudgets:', error); return [] }
  return (data || []).map(row => ({ id: row.id, month: row.month, items: row.items || [], createdAt: row.created_at }))
}

export async function getBudget(month) {
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

export async function saveBudget(month, items) {
  const userId = await getUserId()
  const { error } = await supabase
    .from('budgets')
    .upsert({ user_id: userId, month, items }, { onConflict: 'user_id,month' })

  if (error) console.error('saveBudget:', error)
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  'Generales', 'Rappi', 'Salidas', 'Adicionales', 'Auto',
  'Expensas', 'Salud', 'Otros', 'Michelle', 'Servicios',
  'Suscripciones', 'Vivienda', 'Familia', 'Educación', 'Mascotas', 'Ingresos'
]

export async function getCategories() {
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
  const txs = await getAllTransactions()
  const txCategories = [...new Set(txs.map(t => t.category).filter(Boolean))]
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

export async function saveCategoriesOrder(orderedCategories) {
  if (!orderedCategories) return
  const userId = await getUserId()
  await supabase.from('categories').upsert({ user_id: userId, list: orderedCategories }, { onConflict: 'user_id' })
  return orderedCategories
}

export async function addCategory(name) {
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

export async function updateCategory(oldName, newName) {
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

export async function deleteCategory(name, mergeIntoName = null) {
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

export async function isCategoryInUse(name) {
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
  inactivityTimeout: 15,
  closedCards: {},
  paidCards: {},
  usdCardExchangeRate: 950,
}

export async function getSettings() {
  const userId = await getUserId()
  const { data, error } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', userId)
    .single()

  if (error || !data) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(data.data || {}) }
}

export async function saveSettings(settings) {
  const userId = await getUserId()
  await supabase
    .from('settings')
    .upsert({ user_id: userId, data: settings }, { onConflict: 'user_id' })
}

// ─── LEGACY stubs (no-ops for compatibility) ─────────────────────────────────

export async function cleanCorruptedData() { return 0 }
export async function seedDemoData() { return }
