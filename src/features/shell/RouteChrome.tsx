import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { routeLoading, subscribeRouteLoading } from './lazyRoute'

/** A thin brand-gradient bar at the very top while a screen's code is on its way (only if it takes > 120 ms). */
export function RouteProgress() {
  const loading = useSyncExternalStore(subscribeRouteLoading, routeLoading, () => false)
  const [phase, setPhase] = useState<'idle' | 'run' | 'done'>('idle')
  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => setPhase('run'), 120)
      return () => clearTimeout(t)
    }
    setPhase((p) => (p === 'run' ? 'done' : 'idle'))
  }, [loading])
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase('idle'), 420)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'idle') return null
  return (
    <div aria-hidden data-testid="route-progress" className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px]">
      <div
        className={phase === 'run' ? 'route-progress-run' : 'route-progress-done'}
        style={{ height: '100%', background: 'linear-gradient(90deg,#3fae85,#e4ad45 60%,#f4dc9e)', boxShadow: '0 0 12px rgb(228 173 69 / 0.7)' }}
      />
    </div>
  )
}

const STORE = 'jec-scroll'

/**
 * Scroll memory: going Back (or reloading) returns to where you were on that screen; going somewhere new starts at the
 * top. Positions are kept per history entry for this tab only.
 */
export function ScrollMemory() {
  const loc = useLocation()
  const type = useNavigationType()
  const pos = useRef<Record<string, number>>({})
  const key = useRef(loc.key)
  useEffect(() => {
    try {
      pos.current = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, number>
    } catch {
      /* none */
    }
    const prev = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    let raf = 0
    const on = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        pos.current[key.current] = window.scrollY
      })
    }
    const save = () => {
      try {
        const keys = Object.keys(pos.current).slice(-60)
        sessionStorage.setItem(STORE, JSON.stringify(Object.fromEntries(keys.map((k) => [k, pos.current[k]]))))
      } catch {
        /* full or private */
      }
    }
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('pagehide', save)
      window.history.scrollRestoration = prev
      save()
    }
  }, [])
  useLayoutEffect(() => {
    if (key.current === loc.key) {
      // first render (a reload): restore if we know the place
      const y = pos.current[loc.key]
      if (type === 'POP' && y) restore(y)
      return
    }
    key.current = loc.key
    if (type === 'POP') {
      const y = pos.current[loc.key]
      if (y) restore(y)
      else window.scrollTo(0, 0)
    } else if (type === 'PUSH' && !loc.hash) {
      window.scrollTo(0, 0)
    }
  }, [loc.key, loc.hash, type])
  return null
}

/** Content may still be loading: try for a moment until the page is tall enough, stop if the reader scrolls. */
function restore(y: number) {
  const start = performance.now()
  let user = false
  const stop = () => {
    user = true
  }
  window.addEventListener('wheel', stop, { once: true, passive: true })
  window.addEventListener('touchstart', stop, { once: true, passive: true })
  const tick = () => {
    if (user) return
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.min(y, max))
    if (max < y && performance.now() - start < 1500) requestAnimationFrame(tick)
    else {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
    }
  }
  tick()
}
