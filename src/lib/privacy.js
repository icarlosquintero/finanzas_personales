import { useState, useEffect } from 'react'

export function usePrivacyMode() {
  const [isPrivate, setIsPrivate] = useState(false)

  useEffect(() => {
    const val = localStorage.getItem('privacy_mode') === 'true'
    setIsPrivate(val)

    const handleStorageChange = () => {
      const newVal = localStorage.getItem('privacy_mode') === 'true'
      setIsPrivate(newVal)
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('privacy-toggle', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('privacy-toggle', handleStorageChange)
    }
  }, [])

  const togglePrivacy = () => {
    const nextVal = !isPrivate
    localStorage.setItem('privacy_mode', String(nextVal))
    setIsPrivate(nextVal)
    window.dispatchEvent(new Event('privacy-toggle'))
  }

  return [isPrivate, togglePrivacy]
}
