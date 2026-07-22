'use client'
import { useEffect } from 'react'

export default function BackupTrigger() {
  useEffect(() => {
    const runAutoBackup = async () => {
      try {
        const data = {
          transactions: localStorage.getItem('fp_transactions'),
          accounts: localStorage.getItem('fp_accounts'),
          budgets: localStorage.getItem('fp_budgets'),
          debts: localStorage.getItem('fp_debts'),
          recurring: localStorage.getItem('fp_recurring'),
          settings: localStorage.getItem('fp_settings'),
          categories: localStorage.getItem('fp_categories'),
        }
        
        // Don't run backup if there's no transaction or account data loaded yet
        if (!data.transactions && !data.accounts) return

        await fetch('/api/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
      } catch (error) {
        console.error('Failed to run automatic backup:', error)
      }
    }
    
    // Trigger backup in the background 2 seconds after the page loads
    const timer = setTimeout(runAutoBackup, 2000)
    return () => clearTimeout(timer)
  }, [])

  return null
}
