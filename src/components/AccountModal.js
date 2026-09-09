'use client'
import { useState, useEffect } from 'react'
import useFormGuard from '@/hooks/useFormGuard'
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

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const guard = useFormGuard(isOpen, isSubmitting, onClose)
  if (!isOpen) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSubmitting) return
    
    setError('')
    setIsSubmitting(true)
    try {
      const newAcc = {
        ...formData,
        balance: Number(formData.balance)
      }

      let savedAcc
      if (initialItem && initialItem.id) {
        savedAcc = await updateAccount(initialItem.id, newAcc)
      } else {
        savedAcc = await addAccount(newAcc)
      }
      
      if (!savedAcc) throw new Error('No se pudo confirmar el guardado.')
      guard.clean()
      onAdd(savedAcc)
      onClose()
    } catch (err) {
      console.error('Error saving account:', err)
      setError('No se pudo guardar la cuenta. Tus cambios siguen aquí.')
    } finally {
      setIsSubmitting(false)
    }
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
          <button onClick={guard.close} disabled={isSubmitting} className="text-secondary" style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} onChange={guard.change} aria-busy={isSubmitting}>
          {error && <p role="alert" className="card text-danger">{error}</p>}
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
                disabled={isSubmitting}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Tipo</label>
              <select name="type" value={formData.type} onChange={handleChange} className="select" disabled={isSubmitting}>
                <option value="checking">Cuenta Corriente</option>
                <option value="savings">Ahorro</option>
                <option value="cash">Efectivo</option>
              </select>
            </div>

            <div className="flex gap-4">
              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label">Moneda</label>
                <select name="currency" value={formData.currency} onChange={handleChange} className="select" disabled={isSubmitting}>
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
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={guard.close} disabled={isSubmitting} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ minWidth: '100px' }}>
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
