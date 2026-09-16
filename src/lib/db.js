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

export async function getAllTransactions(executedMap = null, outOfBudgetMap = null) {
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
  const oobMap = outOfBudgetMap !== null ? outOfBudgetMap : (settingsResult?.outOfBudgetTxs || {})
  return (data || []).map(row => {
    const tx = rowToTx(row)
    if (tx) {
      tx.isExecuted = !!map[tx.id]
      tx.isOutOfBudget = !!oobMap[tx.id]
    }
    return tx
  })
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

export async function addTransactions(transactionsList, bypassAccountUpdate = false) {
  if (!transactionsList || transactionsList.length === 0) return []
  const userId = await getUserId()
  const rows = transactionsList.map(tx => txToRow(tx, userId))

  const { data, error } = await supabase
    .from('transactions')
    .insert(rows)
    .select()

  if (error) {
    console.error('addTransactions error:', error)
    return []
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

// Bulk-mark credit card transactions as paid in a single DB call.
// Safe for credit card txs because they don't affect account balances individually
// (the card payment itself handles the account deduction separately).
export async function bulkMarkCardTransactionsPaid(ids) {
  if (!ids || ids.length === 0) return
  const userId = await getUserId()
  const { error } = await supabase
    .from('transactions')
    .update({ is_paid: true })
    .in('id', ids)
    .eq('user_id', userId)
  if (error) console.error('bulkMarkCardTransactionsPaid:', error)
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

export async function toggleTransactionStatus(tx) {
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

  // Fetch current state before updating (to match existing transactions by old description)
  const { data: current } = await supabase
    .from('recurring')
    .select('description')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

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

  // Propagate changes to existing unpaid recurring transactions (current + future months)
  if (current?.description) {
    const oldDescKey = current.description.toLowerCase().trim()
    const txUpdateData = {}
    if (updates.category !== undefined) txUpdateData.category = updates.category
    if (updates.amount !== undefined) txUpdateData.amount = Number(updates.amount)
    if (updates.currency !== undefined) txUpdateData.currency = updates.currency
    if (updates.paymentMethod !== undefined) txUpdateData.payment_method = updates.paymentMethod
    if (updates.description !== undefined) txUpdateData.description = updates.description

    if (Object.keys(txUpdateData).length > 0) {
      // Fetch unpaid recurring transactions with the old description
      const { data: existingTxs } = await supabase
        .from('transactions')
        .select('id, description, is_paid')
        .eq('user_id', userId)
        .eq('is_recurring', true)
        .eq('is_paid', false)

      const matchingIds = (existingTxs || [])
        .filter(t => t.description?.toLowerCase().trim() === oldDescKey)
        .map(t => t.id)

      if (matchingIds.length > 0) {
        await supabase
          .from('transactions')
          .update(txUpdateData)
          .in('id', matchingIds)
          .eq('user_id', userId)
      }
    }
  }

  return rowToRecurring(data)
}

export async function deleteRecurring(id) {
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

export async function generateRecurringForMonth(monthStr) {
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

    // Only apply from the month of creation onwards (a recurring added in Sep starts in Sep)
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

  // Insert all new recurring transactions in batch
  if (inserts.length > 0) {
    await addTransactions(inserts, true)
  }

  return updated
}

// Delete a recurring item and remove its generated transactions from `fromMonth` onwards (inclusive)
export async function deleteRecurringFrom(id, fromMonth) {
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
export async function deleteFutureRecurringTxsAfter(description, afterMonth) {
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

export async function saveBudgetAndPropagate(fromMonth, items, forwardCount = 12) {
  const userId = await getUserId()
  const rows = [{ user_id: userId, month: fromMonth, items }]

  let [year, monthNum] = fromMonth.split('-').map(Number)
  for (let i = 1; i <= forwardCount; i++) {
    monthNum++
    if (monthNum > 12) {
      monthNum = 1
      year++
    }
    const nextMonth = `${year}-${String(monthNum).padStart(2, '0')}`
    rows.push({ user_id: userId, month: nextMonth, items })
  }

  const { error } = await supabase
    .from('budgets')
    .upsert(rows, { onConflict: 'user_id,month' })

  if (error) console.error('saveBudgetAndPropagate:', error)
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
  inactivityTimeout: 5,
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

export async function saveSettings(settings) {
  const userId = await getUserId()
  const current = await getSettings()
  const merged = {
    ...current,
    ...settings,
    paidCards: settings.paidCards !== undefined ? settings.paidCards : (current.paidCards || {}),
    closedCards: settings.closedCards !== undefined ? settings.closedCards : (current.closedCards || {}),
    executedTxs: settings.executedTxs !== undefined ? settings.executedTxs : (current.executedTxs || {}),
    outOfBudgetTxs: settings.outOfBudgetTxs !== undefined ? settings.outOfBudgetTxs : (current.outOfBudgetTxs || {}),
  }
  await supabase
    .from('settings')
    .upsert({ user_id: userId, data: merged }, { onConflict: 'user_id' })
}

// ─── LEGACY stubs (no-ops for compatibility) ─────────────────────────────────

export async function cleanCorruptedData() { return 0 }
export async function seedDemoData() { return }


export async function getUsedCategories() {
  const userId = await getUserId()
  const { data: txs } = await supabase.from('transactions').select('category').eq('user_id', userId)
  const { data: recs } = await supabase.from('recurring').select('category').eq('user_id', userId)
  const { data: budgets } = await supabase.from('budgets').select('items').eq('user_id', userId)
  
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
