'use client'
import { useEffect, useState } from 'react'
import { viewMemory } from '@/lib/workState'
export default function useViewState(key, initial) {
  const [value, setValue] = useState(initial)
  const [ready, setReady] = useState(false)
  useEffect(() => { if (viewMemory.has(key)) setValue(viewMemory.get(key)); setReady(true) }, [key])
  useEffect(() => { if (ready) viewMemory.set(key, value) }, [key, value, ready])
  return [value, setValue]
}
