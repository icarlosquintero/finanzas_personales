'use client'
import { usePrivacyMode } from '@/lib/privacy'

export default function PrivacyToggle() {
  const [isPrivate, togglePrivacy] = usePrivacyMode()

  return (
    <button 
      onClick={togglePrivacy}
      className="btn btn-secondary privacy-toggle"
      aria-label="Alternar privacidad"
      style={{ padding: '8px', borderRadius: '50%', cursor: 'pointer' }}
      title={isPrivate ? 'Mostrar montos' : 'Ocultar montos'}
    >
      {isPrivate ? '🙈' : '👁️'}
    </button>
  )
}
