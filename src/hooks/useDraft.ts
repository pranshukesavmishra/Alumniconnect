import { useCallback, useEffect, useRef, useState } from 'react'

function read<T>(key: string, initial: () => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...initial(), ...(JSON.parse(raw) as T) }
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return initial()
}

/**
 * Like useState, but keeps the value in localStorage so a half-filled form survives
 * switching to a payment app, a reload or the phone evicting the tab.
 * The key may start as null (data still loading); the draft is loaded as soon as it is known,
 * and nothing is written until then, so a saved draft is never overwritten by an empty form.
 */
export function useDraft<T>(key: string | null, initial: () => T): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<{ key: string | null; value: T }>(() => ({ key, value: key ? read(key, initial) : initial() }))
  const initialRef = useRef(initial)

  // key became known (or changed): load that draft
  if (state.key !== key) {
    const next = { key, value: key ? read(key, initialRef.current) : initialRef.current() }
    setState(next) // render-phase update for a derived reset (React supports this pattern)
  }

  useEffect(() => {
    if (!key || state.key !== key) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state.value))
      } catch {
        /* ignore quota / private mode */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [key, state])

  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    setState((s) => ({ key: s.key, value: typeof v === 'function' ? (v as (p: T) => T)(s.value) : v }))
  }, [])

  const clear = useCallback(() => {
    if (!key) return
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }, [key])

  return [state.key === key ? state.value : (key ? read(key, initialRef.current) : initialRef.current()), setValue, clear]
}

/** Removes every saved form draft (on sign-out, so the next person on a shared phone sees nothing). */
export function clearAllDrafts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('reg-draft:')) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
