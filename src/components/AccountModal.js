'use client'
import { useState, useEffect } from 'react'
import { addAccount, updateAccount } from '@/lib/db'

export default function AccountModal({ isOpen, onClose, onAdd, initialItem = null }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'checking',
    currency: 'CLP',
    balance: ''
  })

  useEffect(() => {
    if (initialItem) {
      setFormData(initialItem)
    } else {
      setFormData({
        name: '',
        type: 'checking',
        currency: 'CLP',
        balance: ''
      })
    }
  }, [initialItem, isOpen])

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    
    const newAcc = {
      ...formData,
      balance: Number(formData.balance)
    }

    let savedAcc
    if (initialItem && initialItem.id) {
      savedAcc = updateAccount(initialItem.id, newAcc)
    } else {
      savedAcc = addAccount(newAcc)
    }
    
    onAdd(savedAcc)
    onClose()
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{initialItem ? 'Editar Cuenta' : 'Agregar Cuenta'}</h3>
          <button onClick={onClose} className="text-secondary" style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-field">
              <label className="form-label">Nombre de Cuenta</label>
              <input 
                type="text" 
                name="name" 
                value={formData.name} 
                onChange={handleChange} 
                className="input" 
                required 
              />
            </div>

            <div className="form-field">
              <label className="form-label">Tipo</label>
              <select name="type" value={formData.type} onChange={handleChange} className="select">
                <option value="checking">Cuenta Corriente</option>
                <option value="savings">Ahorro</option>
                <option value="cash">Efectivo</option>
              </select>
            </div>

            <div className="flex gap-4">
              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label">Moneda</label>
                <select name="currency" value={formData.currency} onChange={handleChange} className="select">
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="form-field" style={{ flex: 2 }}>
                <label className="form-label">Saldo Inicial</label>
                <input 
                  type="number" 
                  name="balance" 
                  value={formData.balance} 
                  onChange={handleChange} 
                  className="input" 
                  required 
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
            <button type="submit" className="btn btn-primary">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
