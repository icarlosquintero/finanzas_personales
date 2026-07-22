export function formatCLP(amount) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount);
}

export function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatCurrency(amount, currency = 'CLP') {
  if (typeof window !== 'undefined' && localStorage.getItem('privacy_mode') === 'true') {
    return currency === 'USD' ? 'US$ ****' : '$ ****';
  }
  if (currency === 'USD') return formatUSD(amount);
  return formatCLP(amount);
}

export function getCurrentMonth() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function formatMonthDisplay(monthStr) {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

export function getPreviousMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  let m = parseInt(month, 10) - 1;
  let y = parseInt(year, 10);
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function getNextMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  let m = parseInt(month, 10) + 1;
  let y = parseInt(year, 10);
  if (m === 13) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function calculateTotal(transactions) {
  return transactions.reduce((sum, t) => sum + Number(t.amount), 0);
}

export function getMonthName(monthIndex) {
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return monthNames[monthIndex];
}

export function getBudgetPercentage(spent, limit) {
  if (limit === 0) return 0;
  return Math.min(100, Math.round((spent / limit) * 100));
}

export function getBudgetStatus(percentage) {
  if (percentage >= 90) return 'danger';
  if (percentage >= 70) return 'warning';
  return 'success';
}

export function parseMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  return new Date(parseInt(year, 10), parseInt(month, 10) - 1);
}

export function getLastMonths(n, fromMonth) {
  const result = [];
  let current = fromMonth || getCurrentMonth();
  for (let i = 0; i < n; i++) {
    result.push(current);
    current = getPreviousMonth(current);
  }
  return result;
}
