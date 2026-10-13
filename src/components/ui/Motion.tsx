import { LazyMotion, MotionConfig } from 'motion/react'
import { Children, cloneElement, isValidElement, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/*
 * Motion primitives. Heavy animation code (motion's domMax: springs, layout, drag) is fetched on demand —
 * components using `m.*` render statically until it arrives, then animate. Everything respects reduced motion.
 */

const loadFeatures = () => import('./motionFeatures').then((r) => r.default)

/** Wrap the app once (main.tsx). Gives every `m.*` component springs + shared layout, honouring reduced motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures}>
      <MotionConfig reducedMotion="user" transition={SPRING}>
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

/** House springs and easings (mirror the CSS --ease-* / --dur-* tokens). */
export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 220, damping: 26 } as const
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

const rmQuery = '(prefers-reduced-motion: reduce)'
function subscribeRM(cb: () => void) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(rmQuery) : undefined
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}

/** true when the person asked the OS for less motion. Use it to skip any JS-driven animation. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRM,
    () => (typeof window !== 'undefined' ? !!window.matchMedia?.(rmQuery).matches : false),
    () => false,
  )
}

/** Fires once when the element first scrolls into view. */
export function useInViewOnce<T extends Element>(rootMargin = '0px 0px -8% 0px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])
  return [ref, seen] as const
}

/** Fade + rise into view on first scroll-in. No-op with reduced motion. Pure CSS (no motion bundle). */
export function Reveal({ children, delay = 0, className, as: Tag = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>()
  return (
    <Tag ref={ref as never} className={cn('reveal', className)} data-shown={seen} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  )
}

/** Staggers its direct children into view (each child is wrapped in a Reveal). */
export function Stagger({ children, step = 60, className }: { children: ReactNode; step?: number; className?: string }) {
  return (
    <div className={className}>
      {Children.toArray(children).map((c, i) => (
        <Reveal key={isValidElement(c) && c.key != null ? c.key : i} delay={Math.min(i, 8) * step}>
          {c}
        </Reveal>
      ))}
    </div>
  )
}

/** Animated count-up for numbers (stats, totals). Locale formatted, tabular figures, reduced-motion safe. */
export function NumberTicker({
  value,
  duration = 1100,
  format,
  className,
  startOnView = true,
}: {
  value: number
  duration?: number
  format?: (n: number) => string
  className?: string
  startOnView?: boolean
}) {
  const reduced = useReducedMotion()
  const [ref, seen] = useInViewOnce<HTMLSpanElement>()
  const [shown, setShown] = useState(reduced ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reduced || (startOnView && !seen)) {
      if (reduced) setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 4)
      setShown(a + (value - a) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduced, seen, startOnView])
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('en-IN'))
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {/* screen readers get the final value straight away */}
      <span aria-hidden>{fmt(shown)}</span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  )
}

/** Adds tap feedback (scale .97) to any single child element via the `tap` utility. */
export function Pressable({ children }: { children: ReactElement<{ className?: string }> }) {
  return cloneElement(children, { className: cn('tap', children.props.className) })
}
