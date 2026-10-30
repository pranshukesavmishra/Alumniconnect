import { useEffect, useState } from 'react'
import { useReducedMotion } from '../../components/ui/Motion'

/** true while the reader scrolls down past the top (bars tuck away); false on any scroll up. Never hides with reduced motion. */
export function useHideOnScroll(enabled = true, threshold = 72) {
  const reduced = useReducedMotion()
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!enabled || reduced) {
      setHidden(false)
      return
    }
    let last = window.scrollY
    let raf = 0
    const on = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY
        const d = y - last
        if (y < threshold) setHidden(false)
        else if (d > 6) setHidden(true)
        else if (d < -6) setHidden(false)
        if (Math.abs(d) > 6 || y < threshold) last = y
      })
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      window.removeEventListener('scroll', on)
      cancelAnimationFrame(raf)
    }
  }, [enabled, reduced, threshold])
  return hidden
}
