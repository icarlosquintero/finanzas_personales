// src/lib/db.js

const STORAGE_KEYS = {
  TRANSACTIONS: 'fp_transactions',
  ACCOUNTS: 'fp_accounts',
  BUDGETS: 'fp_budgets',
  DEBTS: 'fp_debts',
  RECURRING: 'fp_recurring',
  SETTINGS: 'fp_settings',
  CATEGORIES: 'fp_categories',
  SKIPPED_RECURRING: 'fp_skipped_recurring', // fingerprints de recurrentes eliminados manualmente
};

function getStorage(key) {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

let backupTimeout = null;

function triggerBackup() {
  if (typeof window === 'undefined') return;
  if (backupTimeout) {
    clearTimeout(backupTimeout);
  }
  backupTimeout = setTimeout(async () => {
    try {
      const data = {
        transactions: localStorage.getItem('fp_transactions'),
        accounts: localStorage.getItem('fp_accounts'),
        budgets: localStorage.getItem('fp_budgets'),
        debts: localStorage.getItem('fp_debts'),
        recurring: localStorage.getItem('fp_recurring'),
        settings: localStorage.getItem('fp_settings'),
        categories: localStorage.getItem('fp_categories'),
      };
      
      if (!data.transactions && !data.accounts) return;

      await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.error('Auto backup error:', e);
    }
  }, 2000);
}

function setStorage(key, data) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(data));
  triggerBackup();
}

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
}

function adjustAccountBalance(paymentMethod, amountChange) {
  const accounts = getAccounts();
  const account = accounts.find(a => a.id === paymentMethod || a.name === paymentMethod);
  if (account) {
    const newBalance = Number(account.balance) + amountChange;
    const index = accounts.findIndex(a => a.id === account.id);
    if (index !== -1) {
      accounts[index] = { ...accounts[index], balance: newBalance };
      setStorage(STORAGE_KEYS.ACCOUNTS, accounts);
    }
  }
}

// === TRANSACTIONS ===
export function getTransactions(month) {
  const all = getAllTransactions();
  if (!month) return all;
  return all.filter(t => t.month === month);
}

export function getAllTransactions() {
  let all = getStorage(STORAGE_KEYS.TRANSACTIONS) || [];
  
  if (typeof window === 'undefined') return all;

  let updated = false;
  const accounts = getAccounts();
  const santander = accounts.find(a => a.name === 'Carlos Santander');
  const cashAcc = accounts.find(a => a.name === 'Efectivo');

  // 1. Migración de datos históricos (paymentMethod 'cash' o nombres de cuenta a sus IDs correspondientes)
  all = all.map(t => {
    if (t.paymentMethod === 'fixed') {
      t.paymentMethod = 'transfer';
      updated = true;
    }
    
    if (t.type === 'income') {
      if (t.paymentMethod === 'cash') {
        if (t.description.toLowerCase().includes('carlos') || t.description.toLowerCase().includes('junio') || t.description.toLowerCase().includes('julio')) {
          if (santander) { t.paymentMethod = santander.id; updated = true; }
        } else {
          if (cashAcc) { t.paymentMethod = cashAcc.id; updated = true; }
        }
      } else if (t.paymentMethod === 'Carlos Santander' && santander) {
        t.paymentMethod = santander.id;
        updated = true;
      } else if (t.paymentMethod === 'Carlos Ahorro' && accounts.find(a => a.name === 'Carlos Ahorro')) {
        t.paymentMethod = accounts.find(a => a.name === 'Carlos Ahorro').id;
        updated = true;
      }
    } else if (t.type === 'expense') {
      if (t.paymentMethod === 'cash') {
        if (cashAcc) { t.paymentMethod = cashAcc.id; updated = true; }
      } else if (t.paymentMethod === 'transfer') {
        if (santander) { t.paymentMethod = santander.id; updated = true; }
      }
    }
    return t;
  });

  // 2. Proceso de auto-recuperación (self-healing): aplicar ingresos/gastos que aún no hayan sido aplicados
  const updatedTxs = all.map(t => {
    if (t.isPaid && t.isAppliedToAccount !== true) {
      if (t.paymentMethod !== 'credit_card_clp' && t.paymentMethod !== 'credit_card_usd') {
        const account = accounts.find(a => a.id === t.paymentMethod || a.name === t.paymentMethod);
        if (account) {
          const index = accounts.findIndex(a => a.id === account.id);
          if (index !== -1) {
            if (t.type === 'income') {
              accounts[index].balance = Number(accounts[index].balance) + Number(t.amount);
            } else if (t.type === 'expense') {
              accounts[index].balance = Number(accounts[index].balance) - Number(t.amount);
            }
            t.isAppliedToAccount = true;
            updated = true;
          }
        } else {
          // Si no se encuentra la cuenta, se marca como aplicado para evitar reprocesar
          t.isAppliedToAccount = true;
          updated = true;
        }
      }
    }
    return t;
  });

  if (updated) {
    setStorage(STORAGE_KEYS.ACCOUNTS, accounts);
    setStorage(STORAGE_KEYS.TRANSACTIONS, updatedTxs);
    return updatedTxs;
  }
  
  return all;
}

export function addTransaction(transaction, bypassAccountUpdate = false) {
  const all = getAllTransactions();
  const newTx = {
    ...transaction,
    id: generateId(),
    createdAt: transaction.createdAt || new Date().toISOString()
  };

  if (newTx.isPaid && newTx.paymentMethod !== 'credit_card_clp' && newTx.paymentMethod !== 'credit_card_usd') {
    if (!bypassAccountUpdate) {
      const amountChange = newTx.type === 'income' ? Number(newTx.amount) : -Number(newTx.amount);
      adjustAccountBalance(newTx.paymentMethod, amountChange);
      newTx.isAppliedToAccount = true;
    } else {
      newTx.isAppliedToAccount = true;
    }
  }

  all.push(newTx);
  setStorage(STORAGE_KEYS.TRANSACTIONS, all);
  return newTx;
}

export function updateTransaction(id, updates) {
  const all = getAllTransactions();
  const index = all.findIndex(t => t.id === id);
  if (index !== -1) {
    const oldTx = all[index];
    const newTx = { ...oldTx, ...updates };

    // Revertir impacto de la transacción vieja si estaba aplicada
    if (oldTx.isPaid && oldTx.isAppliedToAccount === true && oldTx.paymentMethod !== 'credit_card_clp' && oldTx.paymentMethod !== 'credit_card_usd') {
      const amountChange = oldTx.type === 'income' ? -Number(oldTx.amount) : Number(oldTx.amount);
      adjustAccountBalance(oldTx.paymentMethod, amountChange);
      newTx.isAppliedToAccount = false;
    }

    // Aplicar impacto de la transacción nueva si está pagada
    if (newTx.isPaid && newTx.paymentMethod !== 'credit_card_clp' && newTx.paymentMethod !== 'credit_card_usd') {
      const amountChange = newTx.type === 'income' ? Number(newTx.amount) : -Number(newTx.amount);
      adjustAccountBalance(newTx.paymentMethod, amountChange);
      newTx.isAppliedToAccount = true;
    } else {
      newTx.isAppliedToAccount = false;
    }

    all[index] = newTx;
    setStorage(STORAGE_KEYS.TRANSACTIONS, all);
    return newTx;
  }
  return null;
}

export function deleteTransaction(id) {
  const allTx = getAllTransactions();
  const txToDelete = allTx.find(t => t.id === id);
  if (txToDelete) {
    if (txToDelete.isPaid && txToDelete.isAppliedToAccount === true && txToDelete.paymentMethod !== 'credit_card_clp' && txToDelete.paymentMethod !== 'credit_card_usd') {
      const amountChange = txToDelete.type === 'income' ? -Number(txToDelete.amount) : Number(txToDelete.amount);
      adjustAccountBalance(txToDelete.paymentMethod, amountChange);
    }
    
    // Si era una transacción auto-generada por recurrentes, guardar huella para no volver a crearla
    if (txToDelete.isRecurring && txToDelete.month && txToDelete.description) {
      const fingerprint = `${txToDelete.month}::${txToDelete.description.toLowerCase().trim()}`;
      const skipped = getStorage(STORAGE_KEYS.SKIPPED_RECURRING) || [];
      if (!skipped.includes(fingerprint)) {
        skipped.push(fingerprint);
        setStorage(STORAGE_KEYS.SKIPPED_RECURRING, skipped);
      }
    }
    
    const filtered = allTx.filter(t => t.id !== id);
    setStorage(STORAGE_KEYS.TRANSACTIONS, filtered);
  }
}

export function getTransactionsByPaymentMethod(month, method) {
  const txs = getTransactions(month);
  return txs.filter(t => t.paymentMethod === method);
}

// === ACCOUNTS ===
export function getAccounts() {
  return getStorage(STORAGE_KEYS.ACCOUNTS) || [];
}

export function addAccount(account) {
  const all = getAccounts();
  const newAcc = { ...account, id: generateId(), createdAt: new Date().toISOString() };
  all.push(newAcc);
  setStorage(STORAGE_KEYS.ACCOUNTS, all);
  return newAcc;
}

export function updateAccount(id, updates) {
  const all = getAccounts();
  const index = all.findIndex(a => a.id === id);
  if (index !== -1) {
    all[index] = { ...all[index], ...updates };
    setStorage(STORAGE_KEYS.ACCOUNTS, all);
    return all[index];
  }
  return null;
}

export function deleteAccount(id) {
  let all = getAccounts();
  all = all.filter(a => a.id !== id);
  setStorage(STORAGE_KEYS.ACCOUNTS, all);
}

// === BUDGETS ===
export function getBudgets() {
  return getStorage(STORAGE_KEYS.BUDGETS) || [];
}

export function getBudget(month) {
  const all = getBudgets();
  return all.find(b => b.month === month) || { month, items: [] };
}

export function saveBudget(month, items) {
  const all = getBudgets();
  const index = all.findIndex(b => b.month === month);
  if (index !== -1) {
    all[index].items = items;
  } else {
    all.push({ month, items, createdAt: new Date().toISOString() });
  }
  setStorage(STORAGE_KEYS.BUDGETS, all);
}

// === DEBTS ===
export function getDebts() {
  return getStorage(STORAGE_KEYS.DEBTS) || [];
}

export function addDebt(debt) {
  const all = getDebts();
  const newDebt = { ...debt, id: generateId(), createdAt: new Date().toISOString() };
  all.push(newDebt);
  setStorage(STORAGE_KEYS.DEBTS, all);
  return newDebt;
}

export function updateDebt(id, updates) {
  const all = getDebts();
  const index = all.findIndex(d => d.id === id);
  if (index !== -1) {
    all[index] = { ...all[index], ...updates };
    setStorage(STORAGE_KEYS.DEBTS, all);
    return all[index];
  }
  return null;
}

export function deleteDebt(id) {
  let all = getDebts();
  all = all.filter(d => d.id !== id);
  setStorage(STORAGE_KEYS.DEBTS, all);
}

// === RECURRING ===
export function getRecurring() {
  let all = getStorage(STORAGE_KEYS.RECURRING) || [];
  if (typeof window === 'undefined') return all;
  let updated = false;
  all = all.map(r => {
    if (r.paymentMethod === 'fixed') {
      r.paymentMethod = 'transfer';
      updated = true;
    }
    return r;
  });
  if (updated) {
    setStorage(STORAGE_KEYS.RECURRING, all);
  }
  return all;
}

export function addRecurring(item) {
  const all = getRecurring();
  const newRec = { ...item, id: generateId(), createdAt: new Date().toISOString() };
  all.push(newRec);
  setStorage(STORAGE_KEYS.RECURRING, all);
  return newRec;
}

export function updateRecurring(id, updates) {
  const all = getRecurring();
  const index = all.findIndex(r => r.id === id);
  if (index !== -1) {
    all[index] = { ...all[index], ...updates };
    setStorage(STORAGE_KEYS.RECURRING, all);
    return all[index];
  }
  return null;
}

export function deleteRecurring(id) {
  let all = getRecurring();
  all = all.filter(r => r.id !== id);
  setStorage(STORAGE_KEYS.RECURRING, all);
}

export function generateRecurringForMonth(monthStr) {
  // monthStr format: "YYYY-MM"
  const currentMonth = new Date().toISOString().substring(0, 7);
  // Solo generar para el mes en curso y los futuros
  if (monthStr < currentMonth) return false;

  let allTxs = getAllTransactions();
  const recurring = getRecurring();
  const skipped = getStorage(STORAGE_KEYS.SKIPPED_RECURRING) || [];
  let updated = false;

  recurring.forEach(r => {
    // 1. Evitar generar en meses anteriores a la fecha de creación del recurrente
    const createdMonth = r.createdAt ? r.createdAt.substring(0, 7) : '2000-01';
    if (monthStr < createdMonth) return;

    const type = r.type || 'expense';
    const category = type === 'income' ? 'Ingresos' : (r.category || r.description);
    const descKey = r.description.toLowerCase().trim();
    const fingerprint = `${monthStr}::${descKey}`;
    
    // Si el usuario lo eliminó manualmente este mes, no volver a crear
    if (skipped.includes(fingerprint)) return;
    
    // Verificar si ya existe la transacción para ese mes
    const exists = allTxs.some(t => 
      t.month === monthStr && 
      t.description.toLowerCase().trim() === descKey
    );

    if (!exists) {
      const newTx = {
        id: generateId(),
        type: type,
        date: `${monthStr}-${String(r.dayOfMonth || 1).padStart(2, '0')}`,
        description: r.description,
        amount: Number(r.amount),
        currency: r.currency || 'CLP',
        category: category,
        paymentMethod: r.paymentMethod || (type === 'income' ? 'cash' : 'credit_card_clp'),
        isPaid: false, // Siempre pendiente por defecto para futuros e ingresos nuevos
        applySavingsPct: true,
        isRecurring: true,
        month: monthStr,
        createdAt: new Date().toISOString()
      };
      allTxs.push(newTx);
      updated = true;
    }
  });

  if (updated) {
    setStorage(STORAGE_KEYS.TRANSACTIONS, allTxs);
  }
  return updated;
}

/**
 * Limpia transacciones corruptas (sin categoría) que fueron auto-generadas
 * por el generador de recurrentes. NO elimina ningún dato ingresado por el usuario.
 * Retorna la cantidad de registros eliminados.
 */
export function cleanCorruptedData() {
  if (typeof window === 'undefined') return 0;
  let allTxs = getStorage(STORAGE_KEYS.TRANSACTIONS) || [];
  const before = allTxs.length;

  // 1. Eliminar transacciones sin categoría
  allTxs = allTxs.filter(t => t.category && t.category.toString().trim());

  // 2. Desduplicar recurrentes: si el usuario ya registró manualmente un gasto, eliminar el autogenerado (recurrente)
  const manualSeen = new Set();
  const deduped = [];
  
  // Primera pasada: registrar y guardar todos los manuales
  allTxs.forEach(t => {
    if (!t.isRecurring) {
      deduped.push(t);
      if (t.month && t.description) {
        manualSeen.add(`${t.month}::${t.description.toLowerCase().trim()}`);
      }
    }
  });

  // Segunda pasada: guardar los recurrentes solo si no duplican uno manual
  const recurringSeen = new Set();
  allTxs.forEach(t => {
    if (t.isRecurring) {
      if (t.month && t.description) {
        const key = `${t.month}::${t.description.toLowerCase().trim()}`;
        if (!manualSeen.has(key) && !recurringSeen.has(key)) {
          deduped.push(t);
          recurringSeen.add(key);
        }
      } else {
        deduped.push(t);
      }
    }
  });

  setStorage(STORAGE_KEYS.TRANSACTIONS, deduped);
  
  return before - deduped.length;
}

// === SETTINGS ===
export function getSettings() {
  const defaults = { theme: 'light', defaultCurrency: 'CLP', currencies: ['CLP', 'USD'], savingsPercentage: 0, inactivityTimeout: 15, closedCards: {}, paidCards: {}, usdCardExchangeRate: 950 };
  const settings = getStorage(STORAGE_KEYS.SETTINGS);
  return settings ? { ...defaults, ...settings } : defaults;
}

export function saveSettings(settings) {
  setStorage(STORAGE_KEYS.SETTINGS, settings);
}

// === SEED DATA ===
export function seedDemoData() {
  if (typeof window === 'undefined') return;
  const accounts = getAccounts();
  if (accounts.length > 0) return; // Already seeded

  console.log("Seeding demo data...");

  getCategories(); // Initialize default categories list
  const savingsAcc = addAccount({ name: 'Carlos Ahorro', type: 'savings', currency: 'CLP', balance: 8000000 });
  const santanderAcc = addAccount({ name: 'Carlos Santander', type: 'checking', currency: 'CLP', balance: 5688687 });
  const cashAcc = addAccount({ name: 'Efectivo', type: 'cash', currency: 'CLP', balance: 0 });

  const txsJunCLP = [
    { description: 'Generales', amount: 1600222, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Generales', month: '2026-06', date: '2026-06-01', isPaid: true },
    { description: 'Rappi', amount: 383361, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Rappi', month: '2026-06', date: '2026-06-02', isPaid: true },
    { description: 'Salidas', amount: 175965, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Salidas', month: '2026-06', date: '2026-06-03', isPaid: true },
    { description: 'Adicionales', amount: 1193786, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Adicionales', month: '2026-06', date: '2026-06-04', isPaid: true },
    { description: 'Auto + Peajes + Uber', amount: 654676, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Auto', month: '2026-06', date: '2026-06-05', isPaid: true },
    { description: 'Expensas Abril', amount: 134949, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Expensas', month: '2026-06', date: '2026-06-06', isPaid: true },
    { description: 'Depilación (1/3)', amount: 76667, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Salud', month: '2026-06', date: '2026-06-07', isPaid: true },
    { description: 'Mes anterior', amount: 20659, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Otros', month: '2026-06', date: '2026-06-08', isPaid: true },
    { description: 'Michelle', amount: 1061916, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Michelle', month: '2026-06', date: '2026-06-09', isPaid: true },
    { description: 'Internet', amount: 8372, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Servicios', month: '2026-06', date: '2026-06-10', isPaid: true },
    { description: 'Agua', amount: 56240, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Servicios', month: '2026-06', date: '2026-06-11', isPaid: true },
  ];
  
  const txsJunUSD = [
    { description: 'Smarfit', amount: 32.52, currency: 'USD', type: 'expense', paymentMethod: 'credit_card_usd', category: 'Salud', month: '2026-06', date: '2026-06-12', isPaid: true },
    { description: 'Google', amount: 5.24, currency: 'USD', type: 'expense', paymentMethod: 'credit_card_usd', category: 'Suscripciones', month: '2026-06', date: '2026-06-13', isPaid: true },
    { description: 'Apple', amount: 15.08, currency: 'USD', type: 'expense', paymentMethod: 'credit_card_usd', category: 'Suscripciones', month: '2026-06', date: '2026-06-14', isPaid: true },
    { description: 'Disney', amount: 17.94, currency: 'USD', type: 'expense', paymentMethod: 'credit_card_usd', category: 'Suscripciones', month: '2026-06', date: '2026-06-15', isPaid: true },
  ];

  const txsJunCash = [
    { description: 'Departamento (03)', amount: 700000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Vivienda', month: '2026-06', date: '2026-06-03', isPaid: true },
    { description: 'Papá', amount: 330000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Familia', month: '2026-06', date: '2026-06-01', isPaid: true },
    { description: 'Baile', amount: 30000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Educación', month: '2026-06', date: '2026-06-02', isPaid: true },
    { description: 'Limpieza', amount: 219000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Vivienda', month: '2026-06', date: '2026-06-15', isPaid: true },
    { description: 'Michelle', amount: 40000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Michelle', month: '2026-06', date: '2026-06-10', isPaid: true },
    { description: 'Pisco', amount: 100000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Mascotas', month: '2026-06', date: '2026-06-05', isPaid: true },
  ];

  const txsJunIncome = [
    { description: 'Carlos Junio', amount: 5995000, currency: 'CLP', type: 'income', paymentMethod: santanderAcc.id, category: 'Ingresos', month: '2026-06', date: '2026-06-01', isPaid: true }
  ];

  const txsJulCLP = [
    { description: 'Generales', amount: 644986, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Generales', month: '2026-06', date: '2026-06-15', isPaid: false },
    { description: 'Rappi', amount: 92783, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Rappi', month: '2026-06', date: '2026-06-16', isPaid: false },
    { description: 'Salidas', amount: 411122, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Salidas', month: '2026-06', date: '2026-06-17', isPaid: false },
    { description: 'Adicionales', amount: 1163632, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Adicionales', month: '2026-06', date: '2026-06-18', isPaid: false },
    { description: 'Auto + Peajes + Uber', amount: 301733, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Auto', month: '2026-06', date: '2026-06-19', isPaid: false },
    { description: 'Mantenimiento 60.000', amount: 996840, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Vivienda', month: '2026-06', date: '2026-06-20', isPaid: false },
    { description: 'Mes anterior', amount: 303849, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Otros', month: '2026-06', date: '2026-06-21', isPaid: false },
    { description: 'Michelle', amount: 261374, currency: 'CLP', type: 'expense', paymentMethod: 'credit_card_clp', category: 'Michelle', month: '2026-06', date: '2026-06-22', isPaid: false },
  ];

  const txsJulCash = [
    { description: 'Departamento (03)', amount: 700000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Vivienda', month: '2026-07', date: '2026-07-03', isPaid: false },
    { description: 'Papá', amount: 330000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Familia', month: '2026-07', date: '2026-07-01', isPaid: false },
    { description: 'Baile', amount: 30000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Educación', month: '2026-07', date: '2026-07-02', isPaid: false },
    { description: 'Limpieza', amount: 220000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Vivienda', month: '2026-07', date: '2026-07-15', isPaid: false },
    { description: 'Michelle', amount: 40000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Michelle', month: '2026-07', date: '2026-07-10', isPaid: false },
    { description: 'Pisco', amount: 100000, currency: 'CLP', type: 'expense', paymentMethod: 'cash', category: 'Mascotas', month: '2026-07', date: '2026-07-05', isPaid: false },
  ];

  const txsJulIncome = [
    { description: 'Carlos Junio', amount: 5995000, currency: 'CLP', type: 'income', paymentMethod: santanderAcc.id, category: 'Ingresos', month: '2026-07', date: '2026-07-01', isPaid: true }
  ];

  const allTxs = [...txsJunCLP, ...txsJunUSD, ...txsJunCash, ...txsJunIncome, ...txsJulCLP, ...txsJulCash, ...txsJulIncome];
  allTxs.forEach(t => addTransaction(t, true));

  const budgetItems = [
    { category: 'Generales', limit: 1000000, spent: 644986 },
    { category: 'Rappi', limit: 200000, spent: 92783 },
    { category: 'Salidas', limit: 250000, spent: 411122 },
    { category: 'Adicionales', limit: 500000, spent: 1163632 },
    { category: 'Auto', limit: 350000, spent: 301733 },
    { category: 'Vivienda', limit: 1000000, spent: 996840 },
  ];
  saveBudget('2026-06', budgetItems);

  const budgetItemsJul = budgetItems.map(item => ({ ...item, spent: 0 }));
  saveBudget('2026-07', budgetItemsJul);

  addDebt({ description: 'Depa USD', amount: 5600, currency: 'USD', creditor: 'Sr. Erwin' });
  addDebt({ description: 'Por pagar febrero', amount: 1000, currency: 'USD', creditor: '' });
  addDebt({ description: 'Pendiente', amount: 4600, currency: 'USD', creditor: '' });

  addRecurring({ description: 'Departamento (03)', category: 'Vivienda', amount: 700000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 3 });
  addRecurring({ description: 'Papá', category: 'Familia', amount: 330000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1 });
  addRecurring({ description: 'Baile', category: 'Educación', amount: 30000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1 });
  addRecurring({ description: 'Limpieza', category: 'Vivienda', amount: 220000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 15 });
  addRecurring({ description: 'Michelle', category: 'Michelle', amount: 40000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1 });
  addRecurring({ description: 'Pisco', category: 'Mascotas', amount: 100000, currency: 'CLP', paymentMethod: 'cash', dayOfMonth: 1 });
}

// === CATEGORIES ===
export function getCategories() {
  const categories = getStorage(STORAGE_KEYS.CATEGORIES);
  const defaultCategories = [
    'Generales', 'Rappi', 'Salidas', 'Adicionales', 'Auto',
    'Expensas', 'Salud', 'Otros', 'Michelle', 'Servicios',
    'Suscripciones', 'Vivienda', 'Familia', 'Educación', 'Mascotas'
  ];
  let list = categories && categories.length > 0 ? [...categories] : [...defaultCategories];
  
  // Registrar de forma dinámica cualquier categoría presente en transacciones existentes
  const txs = getAllTransactions();
  const txCategories = [...new Set(txs.map(t => t.category).filter(Boolean))];
  let changed = false;
  txCategories.forEach(c => {
    const clean = c.trim();
    if (clean && !list.includes(clean)) {
      list.push(clean);
      changed = true;
    }
  });

  if (changed || !categories || categories.length === 0) {
    setStorage(STORAGE_KEYS.CATEGORIES, list);
  }
  return list;
}

export function saveCategoriesOrder(orderedCategories) {
  if (!orderedCategories) return;
  setStorage(STORAGE_KEYS.CATEGORIES, orderedCategories);
  return orderedCategories;
}

export function addCategory(name) {
  if (!name) return;
  const categories = getCategories();
  const cleanName = name.trim();
  if (cleanName && !categories.includes(cleanName)) {
    categories.push(cleanName);
    setStorage(STORAGE_KEYS.CATEGORIES, categories);
  }
  return categories;
}

export function updateCategory(oldName, newName) {
  if (!oldName || !newName) return;
  const cleanOld = oldName.trim();
  const cleanNew = newName.trim();
  if (cleanOld === cleanNew) return;

  // 1. Update categories list
  let categories = getCategories();
  categories = categories.map(c => c === cleanOld ? cleanNew : c);
  const uniqueCategories = [...new Set(categories)];
  setStorage(STORAGE_KEYS.CATEGORIES, uniqueCategories);

  // 2. Update transactions
  const txs = getAllTransactions();
  let updatedTx = false;
  const updatedTxs = txs.map(t => {
    if (t.category === cleanOld) {
      updatedTx = true;
      return { ...t, category: cleanNew };
    }
    return t;
  });
  if (updatedTx) {
    setStorage(STORAGE_KEYS.TRANSACTIONS, updatedTxs);
  }

  // 3. Update budgets
  const budgets = getBudgets();
  let updatedBudget = false;
  const updatedBudgets = budgets.map(b => {
    const items = b.items.map(item => {
      if (item.category === cleanOld) {
        updatedBudget = true;
        return { ...item, category: cleanNew };
      }
      return item;
    });
    return { ...b, items };
  });
  if (updatedBudget) {
    setStorage(STORAGE_KEYS.BUDGETS, updatedBudgets);
  }

  // 4. Update recurring items
  const recurring = getRecurring();
  let updatedRec = false;
  const updatedRecurring = recurring.map(r => {
    if (r.category === cleanOld) {
      updatedRec = true;
      return { ...r, category: cleanNew };
    }
    return r;
  });
  if (updatedRec) {
    setStorage(STORAGE_KEYS.RECURRING, updatedRecurring);
  }
}

export function deleteCategory(name, mergeIntoName = null) {
  if (!name) return;
  const cleanName = name.trim();

  // 1. Remove from categories list
  let categories = getCategories();
  categories = categories.filter(c => c !== cleanName);
  setStorage(STORAGE_KEYS.CATEGORIES, categories);

  if (mergeIntoName) {
    const cleanMerge = mergeIntoName.trim();
    
    // Update transactions
    const txs = getAllTransactions();
    let updatedTx = false;
    const updatedTxs = txs.map(t => {
      if (t.category === cleanName) {
        updatedTx = true;
        return { ...t, category: cleanMerge };
      }
      return t;
    });
    if (updatedTx) {
      setStorage(STORAGE_KEYS.TRANSACTIONS, updatedTxs);
    }

    // Update budgets
    const budgets = getBudgets();
    let updatedBudget = false;
    const updatedBudgets = budgets.map(b => {
      const hasMergeTarget = b.items.some(item => item.category === cleanMerge);
      const hasSource = b.items.some(item => item.category === cleanName);
      if (hasSource) {
        updatedBudget = true;
        let items = b.items;
        if (hasMergeTarget) {
          // If both exist, remove the old one (combine limit is not combined automatically, we just drop the old category limit)
          items = b.items.filter(item => item.category !== cleanName);
        } else {
          items = b.items.map(item => item.category === cleanName ? { ...item, category: cleanMerge } : item);
        }
        return { ...b, items };
      }
      return b;
    });
    if (updatedBudget) {
      setStorage(STORAGE_KEYS.BUDGETS, updatedBudgets);
    }

    // Update recurring items
    const recurring = getRecurring();
    let updatedRec = false;
    const updatedRecurring = recurring.map(r => {
      if (r.category === cleanName) {
        updatedRec = true;
        return { ...r, category: cleanMerge };
      }
      return r;
    });
    if (updatedRec) {
      setStorage(STORAGE_KEYS.RECURRING, updatedRecurring);
    }
  }
}

export function isCategoryInUse(name) {
  if (!name) return false;
  const cleanName = name.trim();
  
  // Check transactions
  const txs = getAllTransactions();
  if (txs.some(t => t.category === cleanName)) return true;

  // Check recurring items
  const recurring = getRecurring();
  if (recurring.some(r => r.category === cleanName)) return true;

  // Check budgets
  const budgets = getBudgets();
  if (budgets.some(b => b.items.some(item => item.category === cleanName))) return true;

  return false;
}
