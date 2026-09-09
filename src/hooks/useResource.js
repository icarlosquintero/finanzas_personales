'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
export default function useResource(loader) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const version = useRef(0)
  const load = useCallback(async () => {
    const id = ++version.current
    setLoading(true); setError(false)
    try { const result = await loader(); if (id === version.current) setData(result) }
    catch { if (id === version.current) setError(true) }
    finally { if (id === version.current) setLoading(false) }
  }, [loader])
  useEffect(() => { load(); return () => { version.current++ } }, [load])
  return { data, setData, loading, error, load }
}
