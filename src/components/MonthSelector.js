'use client'
import { formatMonthDisplay, getPreviousMonth, getNextMonth } from '@/lib/utils'

export default function MonthSelector({ currentMonth, onMonthChange }) {
  if (!currentMonth) return null

  return (
    <div className="month-selector">
      <button 
        className="month-selector-btn" 
        onClick={() => onMonthChange(getPreviousMonth(currentMonth))}
        aria-label="Mes anterior"
      >
        ◀
      </button>
      <span className="month-selector-label">
        {formatMonthDisplay(currentMonth)}
      </span>
      <button 
        className="month-selector-btn" 
        onClick={() => onMonthChange(getNextMonth(currentMonth))}
        aria-label="Mes siguiente"
      >
        ▶
      </button>
    </div>
  )
}
