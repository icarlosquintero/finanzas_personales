'use client'
import { useState, useEffect, useRef } from 'react'
import Header from '@/components/Header'
import { supabase } from '@/lib/supabase'
import BulkTransactionModal from '@/components/BulkTransactionModal'
import AccountModal from '@/components/AccountModal'
import { seedDemoData, getAllTransactions, getAccounts, getDebts, updateTransaction, deleteTransaction, deleteAccount, updateAccount, getSettings, saveSettings, getCategories, saveCategoriesOrder, generateRecurringForMonth, cleanCorruptedData } from '@/lib/db'
import { formatCurrency, calculateTotal } from '@/lib/utils'
import { usePrivacyMode } from '@/lib/privacy'

export default function Dashboard() {
  const [isPrivate] = usePrivacyMode()
  const [mounted, setMounted] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [settings, setSettings] = useState({ theme: 'light', defaultCurrency: 'CLP', currencies: ['CLP', 'USD'], savingsPercentage: 0 })
  const [data, setData] = useState({
    transactions: [],
    accounts: [],
    debts: [],
  })
  const [categories, setCategories] = useState([])
  
  // Modal states
  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [isAccModalOpen, setIsAccModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [modalType, setModalType] = useState('tx') // 'tx' or 'acc'
  const [selectedCategoryDetail, setSelectedCategoryDetail] = useState(null)
  const [categoryModalFilter, setCategoryModalFilter] = useState('all') // 'all', 'pending', 'paid'
  const [selectedIndicatorDetail, setSelectedIndicatorDetail] = useState(null) // { title, type, transactions, accounts }
  const [draggedCategory, setDraggedCategory] = useState(null)
  const [sectionOrder, setSectionOrder] = useState(['clp', 'usd', 'accounts'])
  const [draggedSection, setDraggedSection] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [payCardModal, setPayCardModal] = useState(null) // { paymentMethodKey, selectedMonth, total, currency }
  const [payTxModal, setPayTxModal] = useState(null)    // { ids, amounts, accountExpense: true, onConfirm }
  const [exchangeRate, setExchangeRate] = useState('950')
  const activeMonthRef = useRef(null)

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

  const loadData = async () => {
    const [txs, accs, debtsList, userSettings, userCategories] = await Promise.all([
      getAllTransactions(),
      getAccounts(),
      getDebts(),
      getSettings(),
      getCategories()
    ]);

    setData({
      transactions: txs,
      accounts: accs,
      debts: debtsList,
    })
    setSettings(userSettings)
    setCategories(userCategories)

    // Actualizar el detalle del indicador abierto si existe
    setSelectedIndicatorDetail(prev => {
      if (!prev) return null
      const indicatorName = prev.title
      const selectedMonth = startDate ? startDate.substring(0, 7) : null

      if (indicatorName === 'DISPONIBLE CUENTAS') {
        const activeAccounts = accs.filter(a => a.type !== 'cash' && a.currency === 'CLP')
        return { ...prev, accounts: activeAccounts }
      }

      let filteredTxs = []
      if (indicatorName === 'DISPONIBLE TARJETA (CLP)' || indicatorName === 'POR PAGAR TARJETA (CLP)') {
        filteredTxs = txs.filter(t => {
          const txMonth = t.month || t.date.substring(0, 7)
          return t.type === 'expense' &&
                 t.paymentMethod === 'credit_card_clp' &&
                 ( (!t.isPaid && selectedMonth && txMonth < selectedMonth) || (txMonth === selectedMonth) )
        })
      } else if (indicatorName === 'DISPONIBLE TARJETA (USD)' || indicatorName === 'POR PAGAR TARJETA (USD)') {
        filteredTxs = txs.filter(t => {
          const txMonth = t.month || t.date.substring(0, 7)
          return t.type === 'expense' &&
                 t.paymentMethod === 'credit_card_usd' &&
                 ( (!t.isPaid && selectedMonth && txMonth < selectedMonth) || (txMonth === selectedMonth) )
        })
      } else if (indicatorName === 'POR PAGAR CUENTAS') {
        filteredTxs = txs.filter(t => {
          const txMonth = t.month || t.date.substring(0, 7)
          return t.type === 'expense' &&
                 t.currency === 'CLP' &&
                 !t.isPaid &&
                 t.paymentMethod !== 'credit_card_clp' &&
                 t.paymentMethod !== 'credit_card_usd' &&
                 (!selectedMonth || txMonth <= selectedMonth)
        })
      }

      return { ...prev, transactions: filteredTxs }
    })
  }

  useEffect(() => {
    const init = async () => {
      await seedDemoData()
      const firstDay = getFirstDayOfMonth()
      setStartDate(firstDay)
      setEndDate(getLastDayOfMonth())
      
      await generateRecurringForMonth(firstDay.substring(0, 7))
      await loadData()
      setMounted(true)
    }
    init()
    
    const savedSectionOrder = localStorage.getItem('finanzas_section_order')
    if (savedSectionOrder) {
      try {
        setSectionOrder(JSON.parse(savedSectionOrder))
      } catch (e) {}
    }

    // Auto-scroll the month bar to center the active month button
    setTimeout(() => {
      if (activeMonthRef.current) {
        activeMonthRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }, 150)
  }, [])

  const handleSelectMonth = async (monthIndex) => {
    const y = new Date().getFullYear()
    const firstDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-01`
    const lastDayDate = new Date(y, monthIndex + 1, 0)
    const lastDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`
    
    const monthStr = `${y}-${String(monthIndex + 1).padStart(2, '0')}`
    await generateRecurringForMonth(monthStr)
    
    setStartDate(firstDay)
    setEndDate(lastDay)
    await loadData()
  }

  const isMonthActive = (monthIndex) => {
    const y = new Date().getFullYear()
    const firstDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-01`
    const lastDayDate = new Date(y, monthIndex + 1, 0)
    const lastDay = `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`
    return startDate === firstDay && endDate === lastDay
  }

  // Aggregate expenses by category and sort them based on the categories order
  const aggregateByCategory = (transactions) => {
    const grouped = {}
    transactions.forEach(tx => {
      // Agrupar categorías vacías como "Sin Categoría" para que no se pierdan del total
      let cat = tx.category || ''
      if (!cat.trim()) {
        cat = 'Sin Categoría'
      }
      if (!grouped[cat]) {
        grouped[cat] = {
          id: cat,
          category: cat,
          amount: 0,
          currency: tx.currency,
          transactions: []
        }
      }
      grouped[cat].amount += Number(tx.amount)
      grouped[cat].transactions.push(tx)
    })
    
    const categoriesOrder = categories || []
    
    // Convert to array and calculate aggregate paid status
    return Object.values(grouped).map(group => {
      // It's "paid" if ALL underlying transactions are paid
      group.isPaid = group.transactions.every(t => t.isPaid)
      return group
    }).sort((a, b) => {
      const indexA = categoriesOrder.indexOf(a.category)
      const indexB = categoriesOrder.indexOf(b.category)
      const posA = indexA === -1 ? 999 : indexA
      const posB = indexB === -1 ? 999 : indexB
      return posA - posB
    })
  }

  // Handle checking the aggregated category checkbox
  const handleToggleCategoryPaid = async (categoryGroup) => {
    const newPaidStatus = !categoryGroup.isPaid

    // If marking as PAID and it's an account/cash expense, ask which account
    const isAccountExpense = categoryGroup.transactions.length > 0 &&
      !categoryGroup.transactions[0].paymentMethod?.startsWith('credit_card_')

    if (newPaidStatus && isAccountExpense) {
      const total = categoryGroup.transactions.reduce((s, t) => s + Number(t.amount), 0)
      setPayTxModal({
        total,
        ids: categoryGroup.transactions.map(t => t.id),
        amounts: categoryGroup.transactions.map(t => ({ id: t.id, amount: Number(t.amount) })),
        reverse: false
      })
      return
    }

    if (!newPaidStatus && isAccountExpense) {
      // Reversing: updateTransaction automatically reverts the account balance of its paymentMethod!
      for (const tx of categoryGroup.transactions) {
        await updateTransaction(tx.id, { isPaid: false })
      }
      await loadData()
      return
    }

    // Default for credit card expenses: just toggle
    for (const tx of categoryGroup.transactions) {
      await updateTransaction(tx.id, { isPaid: newPaidStatus })
    }
    await loadData()
  }

  const handleToggleIncomePaid = async (id, currentStatus) => {
    const updated = await updateTransaction(id, { isPaid: !currentStatus })
    if (updated) {
      await loadData()
    }
  }

  // Confirmar pago de gasto individual desde una cuenta
  const handleConfirmTxPayment = async (accountId) => {
    if (!payTxModal) return
    const account = data.accounts.find(a => a.id === accountId)
    if (!account) return

    await Promise.all(payTxModal.amounts.map(({ id }) => 
      updateTransaction(id, { isPaid: true, paymentMethod: accountId })
    ))
    
    if (payTxModal.onDone) {
      payTxModal.onDone()
    }
    
    setPayTxModal(null)
    await loadData()
  }

  // Handle Edit/Delete
  const handleEdit = (item, type) => {
    setEditingItem(item)
    setModalType(type)
    if (type === 'tx') setIsTxModalOpen(true)
    if (type === 'acc') setIsAccModalOpen(true)
  }

  const handleDeleteTx = async (id) => {
    if (confirm('¿Eliminar este registro?')) {
      await deleteTransaction(id)
      await loadData()
    }
  }

  const handleDeleteAcc = async (id) => {
    if (confirm('¿Eliminar esta cuenta bancaria?')) {
      await deleteAccount(id)
      await loadData()
    }
  }

  const handleModalClose = () => {
    setIsTxModalOpen(false)
    setIsAccModalOpen(false)
    setEditingItem(null)
  }

  const handleDeleteTxFromDetail = async (id) => {
    if (confirm('¿Eliminar este gasto?')) {
      await await deleteTransaction(id)
      const updatedTxs = await getAllTransactions()
      await loadData()
      
      if (selectedCategoryDetail) {
        const catName = selectedCategoryDetail.category
        const filtered = updatedTxs.filter(t => {
          if (t.type !== 'expense' || t.category !== catName) return false
          if (startDate && t.date < startDate) return false
          if (endDate && t.date > endDate) return false
          return true
        })
        if (filtered.length === 0) {
          setSelectedCategoryDetail(null)
        } else {
          setSelectedCategoryDetail({
            ...selectedCategoryDetail,
            amount: filtered.reduce((sum, t) => sum + Number(t.amount), 0),
            transactions: filtered
          })
        }
      }
    }
  }

  const handleTogglePaidFromDetail = async (id, currentStatus) => {
    const tx = data.transactions.find(t => t.id === id)
    if (!tx) return

    const isAccountExpense = tx.type === 'expense' && !tx.paymentMethod?.startsWith('credit_card_')

    if (!currentStatus && isAccountExpense) {
      // Marking as PAID: ask which account
      setPayTxModal({
        total: Number(tx.amount),
        ids: [id],
        amounts: [{ id, amount: Number(tx.amount) }],
        reverse: false,
        onDone: async () => {
          const updatedTxs = await getAllTransactions()
          if (selectedCategoryDetail) {
            const catName = selectedCategoryDetail.category
            const filtered = updatedTxs.filter(t => {
              if (t.type !== 'expense' || t.category !== catName) return false
              if (startDate && t.date < startDate) return false
              if (endDate && t.date > endDate) return false
              return true
            })
            setSelectedCategoryDetail({ ...selectedCategoryDetail, transactions: filtered })
          }
        }
      })
      return
    }

    if (currentStatus && isAccountExpense) {
      // Reversing: updateTransaction automatically reverts the account balance of its paymentMethod!
      await updateTransaction(id, { isPaid: false })
      const updatedTxs = await getAllTransactions()
      await loadData()
      if (selectedCategoryDetail) {
        const catName = selectedCategoryDetail.category
        const filtered = updatedTxs.filter(t => {
          if (t.type !== 'expense' || t.category !== catName) return false
          if (startDate && t.date < startDate) return false
          if (endDate && t.date > endDate) return false
          return true
        })
        setSelectedCategoryDetail({ ...selectedCategoryDetail, transactions: filtered })
      }
      return
    }

    // Default (credit card): just toggle
    const updated = await updateTransaction(id, { isPaid: !currentStatus })
    if (updated) {
      const updatedTxs = getAllTransactions()
      loadData()
      if (selectedCategoryDetail) {
        const catName = selectedCategoryDetail.category
        const filtered = updatedTxs.filter(t => {
          if (t.type !== 'expense' || t.category !== catName) return false
          if (startDate && t.date < startDate) return false
          if (endDate && t.date > endDate) return false
          return true
        })
        setSelectedCategoryDetail({ ...selectedCategoryDetail, transactions: filtered })
      }
    }
  }

  const handleChangeTxCategoryFromDetail = async (txId, newCategory) => {
    const updated = await updateTransaction(txId, { category: newCategory })
    if (updated) {
      await loadData()
      if (selectedCategoryDetail) {
        const updatedTxs = await getAllTransactions()
        const catName = selectedCategoryDetail.category
        const filtered = updatedTxs.filter(t => {
          if (t.type !== 'expense' || t.category !== catName) return false
          if (startDate && t.date < startDate) return false
          if (endDate && t.date > endDate) return false
          return true
        })
        if (filtered.length === 0) {
          setSelectedCategoryDetail(null)
        } else {
          setSelectedCategoryDetail({ ...selectedCategoryDetail, transactions: filtered })
        }
      }
      if (selectedIndicatorDetail) {
        await handleShowIndicatorDetail(selectedIndicatorDetail.title)
      }
    }
  }

  const handleItemAdded = async () => {
    await loadData()
    if (selectedCategoryDetail) {
      const updatedTxs = await getAllTransactions()
      const catName = selectedCategoryDetail.category
      const filtered = updatedTxs.filter(t => {
        if (t.type !== 'expense' || t.category !== catName) return false
        if (startDate && t.date < startDate) return false
        if (endDate && t.date > endDate) return false
        return true
      })
      if (filtered.length === 0) {
        setSelectedCategoryDetail(null)
      } else {
        setSelectedCategoryDetail({
          ...selectedCategoryDetail,
          amount: filtered.reduce((sum, t) => sum + Number(t.amount), 0),
          transactions: filtered
        })
      }
    }
  }

  const handleShowIndicatorDetail = async (indicatorName) => {
    const selectedMonth = startDate ? startDate.substring(0, 7) : null
    const txs = await getAllTransactions()
    const accs = await getAccounts()

    if (indicatorName === 'DISPONIBLE CUENTAS') {
      const activeAccounts = accs.filter(a => a.type !== 'cash' && a.currency === 'CLP')
      setSelectedIndicatorDetail({
        title: 'DISPONIBLE CUENTAS',
        type: 'accounts',
        accounts: activeAccounts
      })
      return
    }

    let filteredTxs = []
    if (indicatorName === 'DISPONIBLE TARJETA (CLP)' || indicatorName === 'POR PAGAR TARJETA (CLP)') {
      filteredTxs = txs.filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        if (t.type !== 'expense' || t.paymentMethod !== 'credit_card_clp') return false
        if (indicatorName === 'POR PAGAR TARJETA (CLP)' && t.isPaid) return false
        return (!t.isPaid && selectedMonth && txMonth < selectedMonth) || (txMonth === selectedMonth)
      })
    } else if (indicatorName === 'DISPONIBLE TARJETA (USD)' || indicatorName === 'POR PAGAR TARJETA (USD)') {
      filteredTxs = txs.filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        if (t.type !== 'expense' || t.paymentMethod !== 'credit_card_usd') return false
        if (indicatorName === 'POR PAGAR TARJETA (USD)' && t.isPaid) return false
        return (!t.isPaid && selectedMonth && txMonth < selectedMonth) || (txMonth === selectedMonth)
      })
    } else if (indicatorName === 'POR PAGAR CUENTAS') {
      filteredTxs = txs.filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        return t.type === 'expense' &&
               t.currency === 'CLP' &&
               !t.isPaid &&
               t.paymentMethod !== 'credit_card_clp' &&
               t.paymentMethod !== 'credit_card_usd' &&
               (!selectedMonth || txMonth <= selectedMonth)
      })
    }

    setSelectedIndicatorDetail({
      title: indicatorName,
      type: 'transactions',
      transactions: filteredTxs
    })
  }

  const handleExportIndicatorToExcel = (detail) => {
    if (!detail || !detail.transactions) return

    const tc = settings.usdCardExchangeRate !== undefined ? settings.usdCardExchangeRate : 950
    const sortedTxs = [...detail.transactions].sort((a, b) => {
      const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tsB - tsA
    })

    const columnsConfig = [
      { name: 'Concepto', width: 180 },
      { name: 'Categoría', width: 140 },
      { name: 'Moneda', width: 75 },
      { name: 'Monto Original', width: 120 },
      { name: 'Monto en CLP', width: 120 },
      { name: 'Ingresado', width: 160 },
      { name: 'Estado', width: 100 }
    ]

    const headerCellsHtml = columnsConfig.map(col => 
      `<th width="${col.width}" style="background-color: #111827; color: #ffffff; font-weight: bold; font-size: 12px; font-family: 'Segoe UI', sans-serif; padding: 8px; border: 1px solid #374151; text-align: center; vertical-align: middle;">${col.name}</th>`
    ).join('')

    const tableRows = sortedTxs.map(tx => {
      const amountOriginal = tx.amount || 0
      const amountCLP = tx.currency === 'USD' ? amountOriginal * tc : amountOriginal
      
      let insertedLabel = '—'
      if (tx.createdAt) {
        const d = new Date(tx.createdAt)
        const pad = (n) => String(n).padStart(2, '0')
        insertedLabel = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      }
      
      const status = tx.isPaid ? 'Pagado' : 'Pendiente'
      const cleanDesc = (tx.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const cleanCat = (tx.category || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      return `
        <tr>
          <td>${cleanDesc}</td>
          <td>${cleanCat}</td>
          <td style="text-align:center;">${tx.currency || 'CLP'}</td>
          <td style="mso-number-format:'#,##0'; text-align:right;">${amountOriginal}</td>
          <td style="mso-number-format:'#,##0'; text-align:right;">${amountCLP}</td>
          <td style="text-align:center;">${insertedLabel}</td>
          <td style="text-align:center;">${status}</td>
        </tr>`
    }).join('')

    const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Detalle Indicador</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<meta http-equiv="content-type" content="text/html; charset=UTF-8"/>
<style>
  td { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; padding: 6px; border: 1px solid #E5E7EB; }
</style>
</head>
<body>
<table border="1" style="border-collapse: collapse;">
  <thead>
    <tr height="28">
      ${headerCellsHtml}
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>
</body>
</html>`

    const blob = new Blob(['\ufeff' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    
    const rawTitle = detail.title === 'POR PAGAR TARJETA (USD)' ? 'POR PAGAR TARJETA USD (CLP)' : detail.title
    const cleanTitle = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    const filename = `detalle_${cleanTitle}_${dateStr}_${timeStr}.xls`
    
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleAddNew = () => {
    setEditingItem(null)
    setModalType('tx')
    setIsTxModalOpen(true)
  }

  // Drag and Drop handlers (Desktop)
  const handleDragStart = (e, category) => {
    setDraggedCategory(category)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', category)
  }

  const handleDragOver = (e, targetCategory) => {
    e.preventDefault()
    if (!draggedCategory || draggedCategory === targetCategory) return
    reorderCategories(draggedCategory, targetCategory)
  }

  const handleDragEnd = () => {
    setDraggedCategory(null)
  }

  // Section Drag and Drop handlers
  const handleSectionDragStart = (e, sectionId) => {
    setDraggedSection(sectionId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', sectionId)
  }

  const handleSectionDragOver = (e, targetSectionId) => {
    e.preventDefault()
    if (!draggedSection || draggedSection === targetSectionId) return
    reorderSections(draggedSection, targetSectionId)
  }

  const handleSectionDragEnd = () => {
    setDraggedSection(null)
  }

  const handleSectionTouchStart = (e, sectionId) => {
    setDraggedSection(sectionId)
    const section = e.currentTarget.closest('.draggable-section')
    if (section) section.classList.add('dragging')
  }

  const handleSectionTouchMove = (e) => {
    if (!draggedSection) return
    const touch = e.touches[0]
    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    if (!element) return

    const targetSection = element.closest('.draggable-section')
    if (!targetSection) return

    const targetSectionId = targetSection.getAttribute('data-section-id')
    if (targetSectionId && targetSectionId !== draggedSection) {
      reorderSections(draggedSection, targetSectionId)
    }
  }

  const handleSectionTouchEnd = (e) => {
    setDraggedSection(null)
    const section = e.currentTarget.closest('.draggable-section')
    if (section) section.classList.remove('dragging')
  }

  const reorderSections = (source, target) => {
    setSectionOrder(prev => {
      const result = [...prev]
      const sourceIdx = result.indexOf(source)
      const targetIdx = result.indexOf(target)
      if (sourceIdx !== -1 && targetIdx !== -1) {
        result.splice(sourceIdx, 1)
        result.splice(targetIdx, 0, source)
        localStorage.setItem('finanzas_section_order', JSON.stringify(result))
        return result
      }
      return prev
    })
  }

  // Touch handlers (Mobile/Tablet)
  const handleTouchStart = (e, category) => {
    setDraggedCategory(category)
    const row = e.currentTarget.closest('tr')
    if (row) row.classList.add('dragging')
  }

  const handleTouchMove = (e) => {
    if (!draggedCategory) return
    const touch = e.touches[0]
    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    if (!element) return

    const targetRow = element.closest('tr')
    if (!targetRow) return

    const targetCategory = targetRow.getAttribute('data-category')
    if (targetCategory && targetCategory !== draggedCategory) {
      reorderCategories(draggedCategory, targetCategory)
    }
  }

  const handleTouchEnd = (e) => {
    setDraggedCategory(null)
    const row = e.currentTarget.closest('tr')
    if (row) row.classList.remove('dragging')
  }

  const reorderCategories = async (source, target) => {
    const currentCategories = [...(categories || [])]
    const sourceIdx = currentCategories.indexOf(source)
    const targetIdx = currentCategories.indexOf(target)

    if (sourceIdx !== -1 && targetIdx !== -1) {
      currentCategories.splice(sourceIdx, 1)
      currentCategories.splice(targetIdx, 0, source)
      await saveCategoriesOrder(currentCategories)
      await loadData()
    }
  }

  // Confirmar pago de tarjeta desde una cuenta bancaria
  const handleConfirmCardPayment = async (accountId, rate = null) => {
    if (!payCardModal) return
    const { paymentMethodKey, selectedMonth, total } = payCardModal
    const key = `${paymentMethodKey}_${selectedMonth}`

    // 1. Descontar de la cuenta seleccionada
    const account = data.accounts.find(a => a.id === accountId)
    if (!account) return

    let amountToDeduct = total
    let clpAmount = null
    if (paymentMethodKey === 'credit_card_usd') {
      const tc = Number(rate) || 950
      clpAmount = Math.round(total * tc)
      amountToDeduct = clpAmount
    }

    await updateAccount(accountId, { balance: Number(account.balance) - amountToDeduct })

    // 2. Marcar todas las transacciones del mes+tarjeta como pagadas
    data.transactions
      .filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        return t.paymentMethod === paymentMethodKey && txMonth === selectedMonth
      })
      .forEach(async t => await updateTransaction(t.id, { isPaid: true }))

    // 3. Guardar en settings.paidCards
    const paidCardInfo = { 
      accountId, 
      amount: total, 
      paidAt: new Date().toISOString() 
    }
    if (clpAmount !== null) {
      paidCardInfo.clpAmount = clpAmount
      paidCardInfo.exchangeRate = Number(rate) || 950
    }

    const newSettings = { ...settings, paidCards: { ...(settings.paidCards || {}), [key]: paidCardInfo } }
    await await saveSettings(newSettings)
    setSettings(newSettings)

    setPayCardModal(null)
    await loadData()
  }

  // Revertir pago de tarjeta (volver a pendiente)
  const handleReverseCardPayment = async (paymentMethodKey, selectedMonth) => {
    const key = `${paymentMethodKey}_${selectedMonth}`
    const paidInfo = settings.paidCards?.[key]
    if (!paidInfo) return

    // 1. Restaurar el saldo de la cuenta
    const account = data.accounts.find(a => a.id === paidInfo.accountId)
    if (account) {
      const amountToRestore = paidInfo.clpAmount !== undefined ? paidInfo.clpAmount : paidInfo.amount
      await updateAccount(paidInfo.accountId, { balance: Number(account.balance) + amountToRestore })
    }

    // 2. Desmarcar transacciones como pagadas
    data.transactions
      .filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        return t.paymentMethod === paymentMethodKey && txMonth === selectedMonth
      })
      .forEach(async t => await updateTransaction(t.id, { isPaid: false }))

    // 3. Eliminar de paidCards
    const newSettings = { ...settings, paidCards: { ...(settings.paidCards || {}) } }
    delete newSettings.paidCards[key]
    await await saveSettings(newSettings)
    setSettings(newSettings)

    await loadData()
  }

  if (!mounted) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid var(--color-border)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>Cargando tus finanzas...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Filter transactions by billing month
  const filteredTransactions = data.transactions.filter(t => {
    const txMonth = t.month || t.date.substring(0, 7)
    const selectedMonth = startDate ? startDate.substring(0, 7) : null
    
    return txMonth === selectedMonth
  })

  // 1. Incomes
  const incomes = filteredTransactions.filter(t => t.type === 'income')
  const totalIncome = calculateTotal(incomes.filter(t => t.isPaid))
  const totalIncomePending = calculateTotal(incomes.filter(t => !t.isPaid))

  // 2. Expenses filtered
  const expenses = filteredTransactions.filter(t => t.type === 'expense')
  const txsCLP = expenses.filter(t => t.paymentMethod === 'credit_card_clp')
  const txsUSD = expenses.filter(t => t.paymentMethod === 'credit_card_usd')
  const txsAccounts = expenses.filter(t => t.paymentMethod !== 'credit_card_clp' && t.paymentMethod !== 'credit_card_usd')

  // Aggregate
  const aggregatedCLP = aggregateByCategory(txsCLP)
  const aggregatedUSD = aggregateByCategory(txsUSD)
  const aggregatedAccounts = aggregateByCategory(txsAccounts)

  const totalCLP = calculateTotal(txsCLP)
  const paidCLP = calculateTotal(txsCLP.filter(t => t.isPaid))
  const pendingCLP = totalCLP - paidCLP

  const totalUSD = calculateTotal(txsUSD)
  const paidUSD = calculateTotal(txsUSD.filter(t => t.isPaid))
  const pendingUSD = totalUSD - paidUSD

  const totalAccountsExpenses = calculateTotal(txsAccounts)
  const paidAccountsExpenses = calculateTotal(txsAccounts.filter(t => t.isPaid))
  const pendingAccountsExpenses = totalAccountsExpenses - paidAccountsExpenses
  const cashAccount = data.accounts.find(a => a.type === 'cash' || a.name.toLowerCase() === 'efectivo')
  const cashBalance = cashAccount ? Number(cashAccount.balance) : 0

  // 3. Accounts
  const savingsAccounts = data.accounts.filter(a => a.type === 'savings')
  const totalSavings = savingsAccounts.reduce((sum, a) => sum + Number(a.balance), 0)
  const totalAccounts = data.accounts.reduce((sum, a) => sum + (a.currency === 'CLP' ? Number(a.balance) : 0), 0)
  const totalBankAccounts = data.accounts.filter(a => a.type !== 'cash').reduce((sum, a) => sum + (a.currency === 'CLP' ? Number(a.balance) : 0), 0)

  // 4. Summary Math
  const disponibleBruto = totalBankAccounts + cashBalance

  // POR PAGAR: suma ACUMULATIVA de todos los gastos CLP pendientes hasta la fecha fin del período
  // Incluye meses anteriores no pagados + el mes seleccionado
  const porPagar = calculateTotal(
    data.transactions.filter(t => {
      const txMonth = t.month || t.date.substring(0, 7)
      const selectedMonth = startDate ? startDate.substring(0, 7) : null
      
      return t.type === 'expense' &&
             t.currency === 'CLP' &&
             !t.isPaid &&
             (!selectedMonth || txMonth <= selectedMonth)
    })
  )
  
  const savingsPct = settings.savingsPercentage || 0
  const clpIncomeTotal = calculateTotal(incomes.filter(t => t.currency === 'CLP' && t.isPaid && t.applySavingsPct !== false))
  const monthlySavingsCLP = Math.round(clpIncomeTotal * (savingsPct / 100))
  
  // Por Pagar Tarjeta CLP: total del mes actual + saldo pendiente (no pagado) de meses anteriores
  const porPagarTarjeta = (() => {
    const selectedMonth = startDate ? startDate.substring(0, 7) : null
    // Deuda arrastrada: gastos tarjeta CLP no pagados de meses ANTERIORES al seleccionado
    const deudaArrastrada = calculateTotal(
      data.transactions.filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        return t.type === 'expense' &&
               t.paymentMethod === 'credit_card_clp' &&
               !t.isPaid &&
               selectedMonth && txMonth < selectedMonth
      })
    )
    // Solo el pendiente del mes actual (refleja lo que falta pagar dinámicamente)
    return deudaArrastrada + pendingCLP
  })()

  // Por Pagar Cuentas/Efectivo: solo los gastos de cuenta/efectivo que aún no estén pagados (acumulativo)
  const porPagarCuentas = calculateTotal(
    data.transactions.filter(t => {
      const txMonth = t.month || t.date.substring(0, 7)
      const selectedMonth = startDate ? startDate.substring(0, 7) : null
      return t.type === 'expense' &&
             t.currency === 'CLP' &&
             !t.isPaid &&
             t.paymentMethod !== 'credit_card_clp' &&
             t.paymentMethod !== 'credit_card_usd' &&
             (!selectedMonth || txMonth <= selectedMonth)
    })
  )

  // Por Pagar Tarjeta USD: pendiente del mes actual + no pagado de meses anteriores (acumulativo)
  const porPagarTarjetaUSD = (() => {
    const selectedMonth = startDate ? startDate.substring(0, 7) : null
    const deudaArrastradaUSD = calculateTotal(
      data.transactions.filter(t => {
        const txMonth = t.month || t.date.substring(0, 7)
        return t.type === 'expense' &&
               t.paymentMethod === 'credit_card_usd' &&
               !t.isPaid &&
               selectedMonth && txMonth < selectedMonth
      })
    )
    return deudaArrastradaUSD + pendingUSD
  })()

  const LIMITE_TARJETA = 8000000
  const LIMITE_TARJETA_USD = 8000
  const selectedMonthForCard = startDate ? startDate.substring(0, 7) : ''
  const isCLPCardClosed = settings.closedCards && settings.closedCards[`credit_card_clp_${selectedMonthForCard}`]
  const isUSDCardClosed = settings.closedCards && settings.closedCards[`credit_card_usd_${selectedMonthForCard}`]
  const disponibleTarjeta = isCLPCardClosed ? 0 : (LIMITE_TARJETA - porPagarTarjeta)
  const disponibleTarjetaUSD = isUSDCardClosed ? 0 : (LIMITE_TARJETA_USD - porPagarTarjetaUSD)
  const ahorros5 = totalSavings + monthlySavingsCLP
  const disponibleNeto = disponibleBruto + monthlySavingsCLP - (porPagarTarjeta + porPagarCuentas)
  const usdRate = settings.usdCardExchangeRate !== undefined ? settings.usdCardExchangeRate : 950
  const porPagarTarjetaUSD_CLP = porPagarTarjetaUSD * usdRate
  const disponibleReal = totalBankAccounts - porPagarTarjeta - porPagarTarjetaUSD_CLP - porPagarCuentas

  // 5. Debts
  const debtsUSD = data.debts.filter(d => d.currency === 'USD')
  const totalDebtsUSD = debtsUSD.reduce((sum, d) => sum + Number(d.amount), 0)

  const getAccountName = (idOrName) => {
    const account = data.accounts.find(a => a.id === idOrName || a.name === idOrName)
    return account ? account.name : idOrName === 'cash' ? 'Efectivo / Débito' : idOrName
  }

  // Helper for rendering aggregated expenses
  const renderAggregatedExpenseTable = (title, groupedList, total, paid, pending, currency, showPaidStatus, limit = null, sectionId = null) => {
    const isCard = title.includes('TARJETA')
    const paymentMethodKey = title.includes('CLP') ? 'credit_card_clp' : 'credit_card_usd'
    const cardCurrency = title.includes('USD') ? 'USD' : 'CLP'
    const selectedMonth = startDate ? startDate.substring(0, 7) : ''
    const isClosed = settings.closedCards && settings.closedCards[`${paymentMethodKey}_${selectedMonth}`]
    const isPaidCard = settings.paidCards && !!settings.paidCards[`${paymentMethodKey}_${selectedMonth}`]
    const paidInfo = settings.paidCards?.[`${paymentMethodKey}_${selectedMonth}`]

    const toggleClosure = async () => {
      if (!selectedMonth) return
      const newSettings = { ...settings }
      if (!newSettings.closedCards) newSettings.closedCards = {}
      
      if (isClosed) {
        delete newSettings.closedCards[`${paymentMethodKey}_${selectedMonth}`]
      } else {
        if (confirm(`¿Estás seguro de cerrar la facturación de esta tarjeta para el mes de ${selectedMonth}? Los nuevos gastos con fecha de este mes pasarán automáticamente al mes siguiente.`)) {
          newSettings.closedCards[`${paymentMethodKey}_${selectedMonth}`] = true
        } else {
          return
        }
      }
      
      await await saveSettings(newSettings)
      setSettings(newSettings)
    }

    return (
      <div 
        className={`excel-section card draggable-section ${draggedSection === sectionId ? 'dragging' : ''}`} 
        style={{ padding: '16px', marginBottom: '16px' }}
        data-section-id={sectionId}
        draggable={!!sectionId}
        onDragStart={sectionId ? (e) => handleSectionDragStart(e, sectionId) : undefined}
        onDragOver={sectionId ? (e) => handleSectionDragOver(e, sectionId) : undefined}
        onDragEnd={sectionId ? handleSectionDragEnd : undefined}
      >
        <div className="flex justify-between items-center mb-2" style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: '4px', overflow: 'visible', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {sectionId && (
              <div
                onDragStart={(e) => handleSectionDragStart(e, sectionId)}
                onTouchStart={(e) => handleSectionTouchStart(e, sectionId)}
                onTouchMove={handleSectionTouchMove}
                onTouchEnd={handleSectionTouchEnd}
                style={{ cursor: 'grab', color: 'var(--color-text-tertiary)', userSelect: 'none', padding: '4px' }}
                className="drag-handle"
                title="Arrastrar para ordenar bloque"
              >
                ☰
              </div>
            )}
            <h3 className="excel-section-title" style={{ borderBottom: 'none', margin: 0, padding: 0 }}>{title}</h3>
          </div>
          {isCard && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              <button 
                onClick={toggleClosure}
                className={`badge badge-${isClosed ? 'success' : 'warning'}`}
                style={{ cursor: 'pointer', border: 'none', fontSize: '0.72rem', padding: '5px 9px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                title={isClosed ? 'Reabrir facturación' : 'Cerrar facturación'}
              >
                {isClosed ? '🔒 Cerrada' : '✂️ Cerrar'}
              </button>
              <button 
                onClick={() => {
                  if (isPaidCard) {
                    if (confirm('¿Revertir el pago de esta tarjeta? Se restaurará el saldo de la cuenta y los gastos volverán a Pendiente.')) {
                      handleReverseCardPayment(paymentMethodKey, selectedMonth)
                    }
                  } else {
                    setPayCardModal({ paymentMethodKey, selectedMonth, total: pending, currency: cardCurrency })
                  }
                }}
                style={{ cursor: 'pointer', border: 'none', fontSize: '0.72rem', padding: '5px 9px', fontWeight: 'bold', background: isPaidCard ? 'var(--color-success)' : '#3b82f6', color: 'white', borderRadius: '6px', whiteSpace: 'nowrap' }}
                title={isPaidCard ? 'Pago registrado — click para revertir' : 'Registrar pago de tarjeta'}
              >
                {isPaidCard ? '✅ Pagada' : '💳 Pagar'}
              </button>
            </div>
          )}
        </div>
        <table className="excel-table">
          <thead>
            <tr>
              <th style={{ width: '30px' }}></th>
              <th>Categoría</th>
              <th className="excel-amount">Monto</th>
              {showPaidStatus && <th style={{ textAlign: 'center', width: '100px' }}>Estado</th>}
            </tr>
          </thead>
          <tbody>
            {groupedList.map((group, idx) => (
              <tr 
                key={group.category || `group-${idx}`}
                draggable
                onDragStart={(e) => handleDragStart(e, group.category)}
                onDragOver={(e) => handleDragOver(e, group.category)}
                onDragEnd={handleDragEnd}
                className={draggedCategory === group.category ? 'dragging' : ''}
                data-category={group.category}
              >
                <td 
                  onDragStart={(e) => handleDragStart(e, group.category)}
                  onTouchStart={(e) => handleTouchStart(e, group.category)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  style={{ width: '30px', cursor: 'grab', color: 'var(--color-text-tertiary)', textAlign: 'center', userSelect: 'none', padding: '10px 4px' }}
                  className="drag-handle"
                  title="Arrastrar para ordenar"
                >
                  ☰
                </td>
                <td 
                  onClick={() => setSelectedCategoryDetail(group)}
                  style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-accent)' }}
                  title="Haz clic para ver el desglose detallado de esta categoría"
                >
                  {group.category}
                </td>
                <td className="excel-amount" style={{ color: group.isPaid ? 'inherit' : 'var(--color-danger)' }}>
                  {formatCurrency(group.amount, currency)}
                </td>
                {showPaidStatus && (
                  <td style={{ textAlign: 'center' }}>
                    <button 
                      onClick={() => handleToggleCategoryPaid(group)}
                      className={`badge badge-${group.isPaid ? 'success' : 'warning'}`}
                      style={{ cursor: 'pointer', border: 'none', width: '85px', textAlign: 'center', display: 'inline-block' }}
                      title="Alternar estado de pago para todos los gastos de esta categoría"
                    >
                      {group.isPaid ? 'Pagado' : 'Pendiente'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {groupedList.length === 0 && (
              <tr>
                <td colSpan={showPaidStatus ? 4 : 3} className="text-secondary text-center py-2">Sin registros</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="excel-summary-box">
          <div className="excel-summary-row total">
            <span>TOTAL</span>
            <span>{formatCurrency(total, currency)}</span>
          </div>
          {showPaidStatus && (
            <>
              <div className="excel-summary-row">
                <span>PAGADO</span>
                <span className="text-success">{formatCurrency(paid, currency)}</span>
              </div>
              <div className="excel-summary-row">
                <span>POR PAGAR</span>
                <span className="text-danger">{formatCurrency(pending, currency)}</span>
              </div>
              {limit !== null && (
                <div className="excel-summary-row" style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--color-border)' }}>
                  <span className="text-success">CUPO DISPONIBLE</span>
                  <span className="text-success" style={{ fontWeight: 'bold' }}>{formatCurrency(limit - pending, currency)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="animate-fadeIn">
      <Header title="Dashboard Principal" />

      <div className="container" style={{ padding: '16px' }}>
        
        {/* Header Fijo (Filtro + Indicadores) */}
        <div style={{ 
          position: 'sticky', 
          top: 0, 
          zIndex: 100, 
          backgroundColor: 'var(--bg-primary)', 
          paddingTop: '8px', 
          paddingBottom: '8px', 
          marginBottom: '16px',
          borderBottom: '1px solid var(--color-border)',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          {/* Barra de Filtros */}
          <div className="card mb-2 animate-slideUp" style={{ padding: '8px 12px', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                Período ({new Date().getFullYear()}):
              </span>
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '4px', alignItems: 'center', overflowX: 'auto', paddingBottom: '2px', width: '100%', marginLeft: '8px' }}>
                {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((monthName, index) => {
                  const active = isMonthActive(index)
                  const isHistoryAvailable = index >= 5 // Desde Junio (5) en adelante
                  return (
                    <button
                      key={monthName}
                      ref={active ? activeMonthRef : null}
                      onClick={() => isHistoryAvailable && handleSelectMonth(index)}
                      disabled={!isHistoryAvailable}
                      className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        padding: '4px 6px',
                        fontSize: '0.75rem',
                        whiteSpace: 'nowrap',
                        cursor: isHistoryAvailable ? 'pointer' : 'not-allowed',
                        borderRadius: '6px',
                        flex: '1 1 0px',
                        width: '100%',
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
              </div>
            </div>
          </div>

          {/* Resumen de Indicadores Clave */}
          <div className="summary-grid animate-slideUp" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', alignItems: 'stretch' }}>
            {/* 1. Disponibles Cuentas */}
            <div 
              className="card" 
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: `4px solid ${totalBankAccounts >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}`, cursor: 'default' }}
            >
              <div className="summary-label" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>DISPONIBLE CUENTAS</div>
              <div className="summary-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: totalBankAccounts >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {formatCurrency(totalBankAccounts)}
              </div>
            </div>

            {/* 2. Disponible Tarjeta CLP */}
            <div 
              className="card" 
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: `4px solid ${disponibleTarjeta >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}`, cursor: 'default' }}
            >
              <div className="summary-label" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>DISPONIBLE TARJETA (CLP)</div>
              <div className="summary-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: disponibleTarjeta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {formatCurrency(disponibleTarjeta)}
              </div>
            </div>

            {/* 3. Disponible Tarjeta USD */}
            <div 
              className="card" 
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: `4px solid ${disponibleTarjetaUSD >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}`, cursor: 'default' }}
            >
              <div className="summary-label" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>DISPONIBLE TARJETA (USD)</div>
              <div className="summary-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: disponibleTarjetaUSD >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {formatCurrency(disponibleTarjetaUSD, 'USD')}
              </div>
            </div>

            {/* 4. Por Pagar Tarjeta CLP */}
            <div 
              className="card" 
              onClick={() => handleShowIndicatorDetail('POR PAGAR TARJETA (CLP)')}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: '4px solid var(--color-danger)', cursor: 'pointer' }}
              title="Haz clic para ver los gastos de tarjeta en pesos"
            >
              <div className="summary-label text-danger" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>POR PAGAR TARJETA (CLP)</div>
              <div className="summary-value text-danger" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                {formatCurrency(porPagarTarjeta)}
              </div>
            </div>

            {/* 5. Por Pagar Tarjeta USD */}
            <div 
              className="card" 
              onClick={() => handleShowIndicatorDetail('POR PAGAR TARJETA (USD)')}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: '4px solid var(--color-danger)', cursor: 'pointer' }}
              title="Haz clic para ver los gastos de tarjeta en dólares"
            >
              <div className="summary-label text-danger" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>POR PAGAR TARJETA USD (CLP)</div>
              <div>
                <div className="summary-value text-danger" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {formatCurrency(porPagarTarjetaUSD * (settings.usdCardExchangeRate !== undefined ? settings.usdCardExchangeRate : 950))}
                </div>
                <div className="text-secondary text-xs" style={{ fontSize: '0.62rem', fontWeight: '500', lineHeight: 1, marginTop: '2px' }}>
                  {formatCurrency(porPagarTarjetaUSD, 'USD')} (TC: ${settings.usdCardExchangeRate !== undefined ? settings.usdCardExchangeRate : 950})
                </div>
              </div>
            </div>

            {/* 6. Por Pagar Cuentas */}
            <div 
              className="card" 
              onClick={() => handleShowIndicatorDetail('POR PAGAR CUENTAS')}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: '4px solid var(--color-danger)', cursor: 'pointer' }}
              title="Haz clic para ver los gastos pendientes de cuentas y efectivo"
            >
              <div className="summary-label text-danger" style={{ fontSize: '0.65rem', fontWeight: 700, height: '24px', display: 'flex', alignItems: 'center' }}>POR PAGAR CUENTAS</div>
              <div className="summary-value text-danger" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                {formatCurrency(porPagarCuentas)}
              </div>
            </div>

            {/* 7. Disponible Real */}
            <div 
              className="card" 
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px', minHeight: '76px', boxSizing: 'border-box', borderLeft: '4px solid #FF6B35', cursor: 'default' }}
              title="Disponible en cuentas menos todas las deudas por pagar (Tarjeta CLP + Tarjeta USD + Cuentas)"
            >
              <div className="summary-label" style={{ color: '#FF6B35', fontWeight: 700, fontSize: '0.65rem', height: '24px', display: 'flex', alignItems: 'center' }}>DISPONIBLE REAL</div>
              <div className="summary-value" style={{ color: '#FF6B35', fontSize: '1.1rem', fontWeight: 700 }}>
                {formatCurrency(disponibleReal)}
              </div>
            </div>
          </div>
        </div>

        <div className="excel-grid">
          
          {/* COLUMNA IZQUIERDA: GASTOS AGRUPADOS */}
          <div className="flex-col">
            {sectionOrder.map(sectionId => {
              if (sectionId === 'clp') {
                return <div key={sectionId}>{renderAggregatedExpenseTable('GASTOS TARJETA (CLP)', aggregatedCLP, totalCLP, paidCLP, pendingCLP, 'CLP', true, 8000000, 'clp')}</div>
              }
              if (sectionId === 'usd') {
                return <div key={sectionId}>{renderAggregatedExpenseTable('GASTOS TARJETA (USD)', aggregatedUSD, totalUSD, paidUSD, pendingUSD, 'USD', true, null, 'usd')}</div>
              }
              if (sectionId === 'accounts') {
                return <div key={sectionId}>{renderAggregatedExpenseTable('GASTOS CUENTAS Y EFECTIVO', aggregatedAccounts, totalAccountsExpenses, paidAccountsExpenses, pendingAccountsExpenses, 'CLP', true, null, 'accounts')}</div>
              }
              return null
            })}
          </div>

          {/* COLUMNA DERECHA: INGRESOS, CUENTAS, RESUMEN, DEUDAS */}
          <div className="flex-col">
            
            {/* Ingresos */}
            <div className="excel-section card" style={{ padding: '16px' }}>
              <div className="flex justify-between items-center mb-2" style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: '4px' }}>
                <h3 className="excel-section-title" style={{ borderBottom: 'none', margin: 0, padding: 0 }}>INGRESOS</h3>
              </div>
              <table className="excel-table">
                <thead>
                  <tr>
                    <th>Detalle</th>
                    <th className="excel-amount">Monto</th>
                    <th style={{ textAlign: 'center', width: '90px' }}>Estado</th>
                    <th style={{ width: '70px', textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {incomes.map(tx => (
                    <tr key={tx.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{tx.description}</div>
                      </td>
                      <td className={`excel-amount ${tx.isPaid ? 'text-success' : 'text-warning'}`}>{formatCurrency(tx.amount, tx.currency)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button 
                          onClick={() => handleToggleIncomePaid(tx.id, tx.isPaid)}
                          className={`badge badge-${tx.isPaid ? 'success' : 'warning'}`}
                          style={{ cursor: 'pointer', border: 'none', width: '80px', textAlign: 'center', display: 'inline-block' }}
                          title="Alternar estado de pago del ingreso"
                        >
                          {tx.isPaid ? 'Pagado' : 'Pendiente'}
                        </button>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={() => handleEdit(tx, 'tx')} className="text-secondary hover:text-primary transition-colors" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                          <button onClick={() => handleDeleteTx(tx.id)} className="text-danger hover:text-red-700 transition-colors" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
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
                  ))}
                  {incomes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-secondary text-center py-2">Sin ingresos</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="excel-summary-box" style={{ marginTop: '8px' }}>
                <div className="excel-summary-row">
                  <span>INGRESOS BRUTOS PAGADOS</span>
                  <span className="text-success">{formatCurrency(totalIncome)}</span>
                </div>
                {totalIncomePending > 0 && (
                  <div className="excel-summary-row text-secondary" style={{ fontSize: '0.85rem' }}>
                    <span>INGRESOS PENDIENTES</span>
                    <span className="text-warning" style={{ fontWeight: '600' }}>{formatCurrency(totalIncomePending)}</span>
                  </div>
                )}
                {monthlySavingsCLP > 0 ? (
                  <>
                    <div className="excel-summary-row text-secondary" style={{ fontSize: '0.85rem', borderTop: '1px solid var(--color-border)', paddingTop: '4px', marginTop: '4px' }}>
                      <span>AHORRO MENSUAL ({savingsPct}%)</span>
                      <span className="text-danger">-{formatCurrency(monthlySavingsCLP)}</span>
                    </div>
                    <div className="excel-summary-row total" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '4px', marginTop: '4px' }}>
                      <span>TOTAL INGRESOS NETOS</span>
                      <span className="text-success">{formatCurrency(totalIncome - monthlySavingsCLP)}</span>
                    </div>
                  </>
                ) : (
                  <div className="excel-summary-row total" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '4px', marginTop: '4px' }}>
                    <span>TOTAL INGRESOS</span>
                    <span className="text-success">{formatCurrency(totalIncome)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cuentas Bancarias */}
            <div className="excel-section card" style={{ padding: '16px' }}>
              <div className="flex justify-between items-center mb-2" style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: '4px' }}>
                <h3 className="excel-section-title" style={{ borderBottom: 'none', margin: 0, padding: 0 }}>CUENTAS BANCARIAS</h3>
                <button onClick={() => { setEditingItem(null); setIsAccModalOpen(true); }} className="text-accent text-sm font-bold">+ Añadir</button>
              </div>
              <table className="excel-table">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th className="excel-amount">Saldo</th>
                    <th style={{ width: '70px', textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map(acc => (
                    <tr key={acc.id}>
                      <td>
                        <button
                          onClick={() => setSelectedAccount(acc)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, color: 'var(--color-accent)', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                          title="Ver movimientos de esta cuenta"
                        >
                          {acc.name}
                        </button>
                      </td>
                      <td className="excel-amount">{formatCurrency(acc.balance, acc.currency)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={() => handleEdit(acc, 'acc')} className="text-secondary hover:text-primary transition-colors" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                          <button onClick={() => handleDeleteAcc(acc.id)} className="text-danger hover:text-red-700 transition-colors" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
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
                  ))}
                </tbody>
              </table>
              <div className="excel-summary-box" style={{ marginTop: '8px' }}>
                <div className="excel-summary-row total">
                  <span>TOTAL CUENTAS</span>
                  <span>{formatCurrency(totalAccounts)}</span>
                </div>
              </div>
            </div>

            {/* Resumen Final */}
            <div className="excel-section card" style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="excel-summary-row">
                <span>TOTAL CUENTAS</span>
                <span className="excel-amount">{formatCurrency(totalBankAccounts)}</span>
              </div>
              <div className="excel-summary-row">
                <span>EFECTIVO</span>
                <span className="excel-amount">{formatCurrency(cashBalance)}</span>
              </div>
              <div className="excel-summary-row total">
                <span>DISPONIBLE BRUTO</span>
                <span className="excel-amount">{formatCurrency(disponibleBruto)}</span>
              </div>
              <div className="excel-summary-row text-danger mt-2">
                <span>POR PAGAR</span>
                <span className="excel-amount">-{formatCurrency(porPagar)}</span>
              </div>
              {monthlySavingsCLP > 0 && (
                <div className="excel-summary-row text-secondary">
                  <span>Ahorro del Mes ({savingsPct}%)</span>
                  <span className="excel-amount">+{formatCurrency(monthlySavingsCLP)}</span>
                </div>
              )}
              <div className="excel-summary-row total highlight mt-4" style={{ padding: '12px', backgroundColor: 'rgba(255, 107, 53, 0.1)', borderRadius: '8px' }}>
                <span>DISPONIBLE NETO</span>
                <span className="excel-amount">{formatCurrency(disponibleNeto)}</span>
              </div>
            </div>

            {/* Deudas */}
            <div className="excel-section card" style={{ padding: '16px' }}>
              <h3 className="excel-section-title">DEUDAS Y PENDIENTES</h3>
              <table className="excel-table">
                <tbody>
                  {data.debts.map(d => (
                    <tr key={d.id}>
                      <td>{d.description}</td>
                      <td className="excel-amount">{formatCurrency(d.amount, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="excel-summary-box" style={{ marginTop: '8px' }}>
                <div className="excel-summary-row total text-danger">
                  <span>TOTAL USD</span>
                  <span>{formatCurrency(totalDebtsUSD, 'USD')}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
      </div>

      <button 
        className="btn-fab" 
        aria-label="Agregar" 
        onClick={handleAddNew}
      >
        +
      </button>

      {/* Category Detail Modal (Registro de Escaneos style) */}
      {selectedCategoryDetail && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="modal" style={{ maxWidth: '650px', padding: '24px', borderRadius: '16px' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>Desglose de Categoría</h3>
                <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {selectedCategoryDetail.category} • {selectedCategoryDetail.transactions.length} movimientos
                </span>
              </div>
              <button 
                onClick={() => setSelectedCategoryDetail(null)} 
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
            
            {/* Pestañas de Filtro: Pendientes / Pagados / Todos */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button 
                onClick={() => setCategoryModalFilter('pending')}
                style={{
                  fontSize: '0.78rem',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: categoryModalFilter === 'pending' ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: categoryModalFilter === 'pending' ? '#ffffff' : 'var(--color-text)',
                  fontWeight: categoryModalFilter === 'pending' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                Pendientes ({selectedCategoryDetail.transactions.filter(t => !t.isPaid).length})
              </button>
              <button 
                onClick={() => setCategoryModalFilter('paid')}
                style={{
                  fontSize: '0.78rem',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: categoryModalFilter === 'paid' ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: categoryModalFilter === 'paid' ? '#ffffff' : 'var(--color-text)',
                  fontWeight: categoryModalFilter === 'paid' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                Pagados ({selectedCategoryDetail.transactions.filter(t => t.isPaid).length})
              </button>
              <button 
                onClick={() => setCategoryModalFilter('all')}
                style={{
                  fontSize: '0.78rem',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: categoryModalFilter === 'all' ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: categoryModalFilter === 'all' ? '#ffffff' : 'var(--color-text)',
                  fontWeight: categoryModalFilter === 'all' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                Todos ({selectedCategoryDetail.transactions.length})
              </button>
            </div>

            <div className="modal-body" style={{ overflowX: 'auto', maxHeight: '380px' }}>
              <table className="excel-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40px', color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>#</th>
                    <th style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Concepto</th>
                    <th className="excel-amount" style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Monto</th>
                    <th style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Fecha y Hora</th>
                    <th style={{ textAlign: 'center', width: '95px', color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Estado</th>
                    <th style={{ textAlign: 'center', width: '75px', color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {[...selectedCategoryDetail.transactions]
                    .filter(tx => {
                      if (categoryModalFilter === 'pending') return !tx.isPaid
                      if (categoryModalFilter === 'paid') return tx.isPaid
                      return true
                    })
                    .sort((a, b) => {
                      const dateA = a.createdAt || a.date || ''
                      const dateB = b.createdAt || b.date || ''
                      return dateB.localeCompare(dateA)
                    })
                    .map((tx, index) => {
                    const datePart = tx.date || (tx.createdAt ? tx.createdAt.split('T')[0] : '')
                    const timePart = tx.createdAt 
                      ? new Date(tx.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
                      : '12:00'
                    const formattedDateTime = `${datePart} ${timePart}`

                    return (
                      <tr key={tx.id}>
                        <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{index + 1}</td>
                        <td style={{ fontWeight: 600 }}>{tx.description}</td>
                        <td className="excel-amount" style={{ color: tx.isPaid ? 'inherit' : 'var(--color-danger)' }}>
                          {formatCurrency(tx.amount, tx.currency)}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          {formattedDateTime}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            onClick={() => handleTogglePaidFromDetail(tx.id, tx.isPaid)}
                            className={`badge badge-${tx.isPaid ? 'success' : 'warning'}`}
                            style={{ cursor: 'pointer', border: 'none', width: '80px', textAlign: 'center', display: 'inline-block' }}
                            title="Alternar estado de pago"
                          >
                            {tx.isPaid ? 'Pagado' : 'Pendiente'}
                          </button>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              onClick={() => handleEdit(tx, 'tx')} 
                              className="text-secondary hover:text-primary transition-colors" 
                              style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                              title="Editar gasto"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            </button>
                            <button 
                              onClick={() => handleDeleteTxFromDetail(tx.id)} 
                              className="text-danger hover:text-red-700 transition-colors" 
                              style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                              title="Eliminar gasto"
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
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '16px' }}>
              <button 
                onClick={() => setSelectedCategoryDetail(null)} 
                className="btn btn-primary w-full"
                style={{
                  backgroundColor: '#111827',
                  borderColor: '#111827',
                  color: 'white',
                  padding: '12px',
                  borderRadius: '10px',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                  cursor: 'pointer'
                }}
              >
                Cerrar lista
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Indicator Detail Modal (Bank Accounts list) */}
      {selectedIndicatorDetail && selectedIndicatorDetail.type === 'accounts' && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="modal" style={{ maxWidth: '550px', padding: '24px', borderRadius: '16px' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>Desglose de Cuentas</h3>
                <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {selectedIndicatorDetail.title} • {selectedIndicatorDetail.accounts.length} cuentas
                </span>
              </div>
              <button 
                onClick={() => setSelectedIndicatorDetail(null)} 
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
            
            <div className="modal-body" style={{ overflowX: 'auto', maxHeight: '380px' }}>
              <table className="excel-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Cuenta</th>
                    <th style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Tipo</th>
                    <th className="excel-amount" style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedIndicatorDetail.accounts.map(acc => (
                    <tr key={acc.id}>
                      <td style={{ fontWeight: 600 }}>{acc.name}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                        {acc.type === 'checking' ? 'Corriente' : acc.type === 'savings' ? 'Ahorros' : 'Otro'}
                      </td>
                      <td className="excel-amount" style={{ fontWeight: 'bold', color: Number(acc.balance) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {formatCurrency(acc.balance, acc.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '16px' }}>
              <button 
                onClick={() => setSelectedIndicatorDetail(null)} 
                className="btn btn-primary w-full"
                style={{
                  backgroundColor: '#111827',
                  borderColor: '#111827',
                  color: 'white',
                  padding: '12px',
                  borderRadius: '10px',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                  cursor: 'pointer'
                }}
              >
                Cerrar lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Indicator Detail Modal (Transactions list) */}
      {selectedIndicatorDetail && selectedIndicatorDetail.type === 'transactions' && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="modal" style={{ maxWidth: '680px', width: '96vw', padding: '24px', borderRadius: '16px' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)' }}>Desglose de Indicador</h3>
                <span className="text-secondary" style={{ fontSize: '0.82rem' }}>
                  {selectedIndicatorDetail.title === 'POR PAGAR TARJETA (USD)' ? 'POR PAGAR TARJETA USD (CLP)' : selectedIndicatorDetail.title} • {selectedIndicatorDetail.transactions.length} movimientos • ordenado por fecha de ingreso
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  onClick={() => handleExportIndicatorToExcel(selectedIndicatorDetail)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: 'var(--shadow-sm)',
                    height: '32px'
                  }}
                  title="Descargar detalle en Excel"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="8" y1="13" x2="16" y2="13"></line>
                    <line x1="8" y1="17" x2="16" y2="17"></line>
                  </svg>
                  <span>Exportar Excel</span>
                </button>
                <button 
                  onClick={() => setSelectedIndicatorDetail(null)} 
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    backgroundColor: 'var(--bg-tertiary)', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '1rem', color: 'var(--color-text-secondary)', lineHeight: 1
                  }}
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', overflowX: 'hidden', maxHeight: '430px', padding: '0' }}>
              {/* MOBILE: card list layout */}
              <div className="indicator-detail-list">
                {[...selectedIndicatorDetail.transactions]
                  .sort((a, b) => {
                    const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0
                    const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0
                    return tsB - tsA
                  })
                  .map((tx, index) => {
                    let insertedLabel = '—'
                    if (tx.createdAt) {
                      const d = new Date(tx.createdAt)
                      const pad = (n) => String(n).padStart(2, '0')
                      insertedLabel = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                    }
                    const isFirst = index === 0
                    return (
                      <div
                        key={tx.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--color-border)',
                          backgroundColor: isFirst ? 'rgba(99,102,241,0.04)' : 'transparent',
                          gap: '10px'
                        }}
                      >
                        {/* Left: description + meta */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                            {isFirst && (
                              <span style={{ fontSize: '0.6rem', background: 'var(--color-accent)', color: 'white', borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>ÚLTIMO</span>
                            )}
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>
                              {tx.description}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <span>{tx.category || '—'}</span>
                            <span>·</span>
                            <span>{insertedLabel}</span>
                          </div>
                        </div>
                        {/* Right: amount + status button */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: tx.isPaid ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {formatCurrency(tx.amount, tx.currency)}
                            {tx.currency === 'USD' && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', fontWeight: 'normal' }}>
                                {formatCurrency(tx.amount * (settings.usdCardExchangeRate ?? 950), 'CLP')}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleTogglePaidFromDetail(tx.id, tx.isPaid)}
                            className={`badge badge-${tx.isPaid ? 'success' : 'warning'}`}
                            style={{ cursor: 'pointer', border: 'none', fontSize: '0.7rem', padding: '4px 10px', borderRadius: '12px', whiteSpace: 'nowrap' }}
                          >
                            {tx.isPaid ? 'Pagado' : 'Pendiente'}
                          </button>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '14px', marginTop: '14px' }}>
              <button 
                onClick={() => setSelectedIndicatorDetail(null)} 
                className="btn btn-primary w-full"
                style={{
                  backgroundColor: '#111827', borderColor: '#111827', color: 'white',
                  padding: '11px', borderRadius: '10px', fontWeight: '600',
                  fontSize: '0.95rem', cursor: 'pointer'
                }}
              >
                Cerrar lista
              </button>
            </div>
          </div>
        </div>
      )}




      <BulkTransactionModal 
        isOpen={isTxModalOpen} 
        onClose={handleModalClose} 
        onAdd={handleItemAdded} 
        initialItem={modalType === 'tx' ? editingItem : null}
      />
      <AccountModal
        isOpen={isAccModalOpen} 
        onClose={handleModalClose} 
        onAdd={handleItemAdded} 
        initialItem={modalType === 'acc' ? editingItem : null}
      />

      {/* ACCOUNT DETAIL MODAL */}
      {selectedAccount && (() => {
        const accTxs = data.transactions
          .filter(t => (t.paymentMethod === selectedAccount.id || t.paymentMethod === selectedAccount.name) && t.isAppliedToAccount === true)
          .sort((a, b) => a.date.localeCompare(b.date))
        const totalIn = accTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
        const totalOut = accTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
        return (
          <div className="modal-overlay" onClick={() => setSelectedAccount(null)}>
            <div className="modal" style={{ maxWidth: '640px', width: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0 }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>🏦 {selectedAccount.name}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                    Saldo actual: <strong style={{ color: Number(selectedAccount.balance) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatCurrency(selectedAccount.balance, selectedAccount.currency)}</strong>
                  </p>
                </div>
                <button onClick={() => setSelectedAccount(null)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', cursor: 'pointer', color: 'var(--color-text-secondary)', lineHeight: 1, padding: '4px 8px' }}>×</button>
              </div>
              {/* Stats bar */}
              <div style={{ display: 'flex', gap: '0', flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--bg-tertiary)' }}>
                {[
                  { label: 'INGRESOS', value: `+${formatCurrency(totalIn, selectedAccount.currency)}`, color: 'var(--color-success)' },
                  { label: 'EGRESOS', value: `-${formatCurrency(totalOut, selectedAccount.currency)}`, color: 'var(--color-danger)' },
                  { label: 'MOVIMIENTOS', value: accTxs.length, color: 'var(--color-text)' },
                ].map((stat, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', padding: '10px 8px', borderRight: i < 2 ? '1px solid var(--color-border)' : 'none' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>{stat.label}</div>
                    <div style={{ fontWeight: 700, color: stat.color, fontSize: '0.95rem' }}>{stat.value}</div>
                  </div>
                ))}
              </div>
              {/* Transaction list */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {accTxs.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px 24px' }}>No hay movimientos aplicados a esta cuenta aún.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
                      <tr style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                        <th style={{ padding: '8px 20px', textAlign: 'left' }}>Fecha</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>Descripción</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>Categoría</th>
                        <th style={{ padding: '8px 20px', textAlign: 'right' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accTxs.map((t, idx) => {
                        const isIncome = t.type === 'income'
                        return (
                          <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-tertiary)' }}>
                            <td style={{ padding: '10px 20px', fontSize: '0.8rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{t.date}</td>
                            <td style={{ padding: '10px 12px', fontSize: '0.87rem', fontWeight: 500, maxWidth: '160px' }}>{t.description}</td>
                            <td style={{ padding: '10px 12px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{t.category}</td>
                            <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem', color: isIncome ? 'var(--color-success)' : 'var(--color-danger)', whiteSpace: 'nowrap' }}>
                              {isIncome ? '+' : '−'}{formatCurrency(Number(t.amount), t.currency)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {/* Footer */}
              <div style={{ padding: '10px 20px', borderTop: '1px solid var(--color-border)', fontSize: '0.72rem', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                ℹ️ Solo se muestran movimientos <strong>pagados</strong> que ya fueron aplicados al saldo de la cuenta.
              </div>
            </div>
          </div>
        )
      })()}
      {/* Mini-modal: selección de cuenta para pagar gasto de cuenta/efectivo */}
      {payTxModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ padding: '28px', minWidth: '340px', maxWidth: '420px', width: '100%', borderRadius: '16px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 700 }}>
              💰 Registrar Pago
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              Monto: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(payTxModal.total)}</strong>
              <br />¿Desde qué cuenta o efectivo realizas el pago?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {data.accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => handleConfirmTxPayment(acc.id)}
                  className="btn btn-secondary"
                  style={{ textAlign: 'left', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span style={{ fontWeight: 600 }}>{acc.name}</span>
                  <span style={{ color: Number(acc.balance) >= payTxModal.total ? 'var(--color-success)' : 'var(--color-danger)', fontSize: '0.875rem' }}>
                    {formatCurrency(acc.balance)} disponible
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setPayTxModal(null)}
              className="btn btn-secondary"
              style={{ width: '100%' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {/* Mini-modal: selección de cuenta para pagar tarjeta */}
      {payCardModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ padding: "28px", minWidth: "340px", maxWidth: "420px", width: "100%", borderRadius: "16px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 700 }}>
              💳 Pagar Tarjeta {payCardModal.currency}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
              Total por pagar: <strong style={{ color: "var(--color-danger)" }}>{formatCurrency(payCardModal.total, payCardModal.currency)}</strong>
              <br />¿Desde qué cuenta realizas el pago?
            </p>
            {payCardModal.currency === 'USD' && (
              <div style={{ marginBottom: '20px' }}>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Tipo de Cambio (CLP por USD):
                </label>
                <input
                  type="number"
                  className="form-control"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  placeholder="Ej. 950"
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
                  Monto Estimado a Descontar: <strong>{formatCurrency(Math.round(payCardModal.total * (Number(exchangeRate) || 0)))} CLP</strong>
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
              {data.accounts.filter(a => a.currency === "CLP" && a.type !== "cash").map(acc => {
                const totalInCLP = payCardModal.currency === 'USD' 
                  ? Math.round(payCardModal.total * (Number(exchangeRate) || 0))
                  : payCardModal.total;
                return (
                  <button
                    key={acc.id}
                    onClick={() => handleConfirmCardPayment(acc.id, exchangeRate)}
                    className="btn btn-secondary"
                    style={{ textAlign: "left", padding: "10px 14px", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span style={{ fontWeight: 600 }}>{acc.name}</span>
                    <span style={{ color: Number(acc.balance) >= totalInCLP ? "var(--color-success)" : "var(--color-danger)", fontSize: "0.875rem" }}>
                      {formatCurrency(acc.balance)} disponible
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setPayCardModal(null)}
              className="btn btn-secondary"
              style={{ width: "100%" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
