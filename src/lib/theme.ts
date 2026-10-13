// Theme preference: System / Light / Dark. Stored per device in localStorage; applied as data-theme on <html>.
// index.html runs the same logic inline before first paint (no flash) — keep THEME_KEY in sync with it.
import { useCallback, useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export const THEME_KEY = 'jec-theme'
const META = { light: '#0b4a37', dark: '#06110d' }

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function resolveTheme(pref: ThemePref, sysDark = systemDark()): ResolvedTheme {
  return pref === 'system' ? (sysDark ? 'dark' : 'light') : pref
}

export function applyTheme(pref: ThemePref = readThemePref()) {
  if (typeof document === 'undefined') return
  const t = resolveTheme(pref)
  const root = document.documentElement
  root.dataset.theme = t
  root.style.colorScheme = t
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = META[t]
  })
}

const listeners = new Set<() => void>()
let current: ThemePref = typeof window === 'undefined' ? 'system' : readThemePref()

export function setThemePref(pref: ThemePref) {
  current = pref
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* private mode: still applies for this visit */
  }
  applyTheme(pref)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (current === 'system') {
      applyTheme('system')
      listeners.forEach((l) => l())
    }
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Current preference + resolved theme; re-renders when either changes. */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => current, () => 'system' as ThemePref)
  const resolved = useSyncExternalStore(
    subscribe,
    () => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light' as ResolvedTheme,
  )
  const set = useCallback((p: ThemePref) => setThemePref(p), [])
  return { pref, resolved, setTheme: set }
}
