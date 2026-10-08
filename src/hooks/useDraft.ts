import { useEffect, useRef, useState } from 'react'

/**
 * Like useState, but keeps the value in localStorage so a half-filled form survives
 * switching to a payment app, a reload or a dropped connection.
 */
export function useDraft<T>(key: string | null, initial: () => T): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    if (!key) return initial()
    try {
      const raw = localStorage.getItem(key)
      if (raw) return { ...initial(), ...(JSON.parse(raw) as T) }
    } catch {
      /* storage unavailable or corrupt: start fresh */
    }
    return initial()
  })
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    if (!key) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* ignore quota / private mode */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [key, value])

  const clear = () => {
    if (keyRef.current) {
      try {
        localStorage.removeItem(keyRef.current)
      } catch {
        /* ignore */
      }
    }
  }
  return [value, setValue, clear]
}
