import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { EASE_OUT, useReducedMotion } from './Motion'

/*
 * Premium effect components (styles in src/styles/fx.css). Use them sparingly: one or two per screen.
 * See docs/DESIGN.md §"FX layer" for which effect goes where.
 */

/** Pointer-following light. Works with mouse and touch; static (no light) under reduced motion. */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--fx-x', `${e.clientX - r.left}px`)
      el.style.setProperty('--fx-y', `${e.clientY - r.top}px`)
      el.dataset.lit = 'true'
    }
    const leave = () => {
      el.dataset.lit = 'false'
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerup', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerup', leave)
    }
  }, [reduced])
  return ref
}

/** A card with a soft light that follows the finger/pointer. */
export function SpotlightCard({ className, tone = 'emerald', children, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: 'emerald' | 'gold' }) {
  const ref = useSpotlight<HTMLDivElement>()
  return (
    <div ref={ref} className={cn('fx-spotlight', tone === 'gold' && 'fx-spotlight-gold', className)} {...rest}>
      {children}
    </div>
  )
}

/** Wrap anything with a light travelling around its rounded edge (give the child/this a border-radius). */
export function BorderBeam({ className, speed = 6, children, ...rest }: HTMLAttributes<HTMLDivElement> & { speed?: number }) {
  return (
    <div className={cn('fx-beam', className)} style={{ '--fx-beam-speed': `${speed}s`, ...rest.style } as CSSProperties} {...rest}>
      {children}
    </div>
  )
}

/** 3D tilt that follows the pointer or the phone's motion; flat under reduced motion. */
export function TiltCard({ className, children, max = 10, glare = true, ...rest }: HTMLAttributes<HTMLDivElement> & { max?: number; glare?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()
  const set = useCallback(
    (rx: number, ry: number, gx: number, gy: number) => {
      const el = ref.current
      if (!el) return
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`
      el.style.setProperty('--fx-gx', `${gx}%`)
      el.style.setProperty('--fx-gy', `${gy}%`)
    },
    [],
  )
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      set((0.5 - py) * max * 2, (px - 0.5) * max * 2, px * 100, py * 100)
    }
    const reset = () => set(0, 0, 50, 30)
    const orient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      const rx = Math.max(-max, Math.min(max, (e.beta - 40) / 3))
      const ry = Math.max(-max, Math.min(max, e.gamma / 3))
      set(-rx, ry, 50 + ry * 4, 30 - rx * 4)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', reset)
    window.addEventListener('deviceorientation', orient)
    reset()
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', reset)
      window.removeEventListener('deviceorientation', orient)
    }
  }, [max, reduced, set])
  return (
    <div
      ref={ref}
      className={cn('relative will-change-transform [transform-style:preserve-3d] transition-transform duration-200 ease-out', className)}
      {...rest}
    >
      {children}
      {glare && !reduced && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light"
          style={{ background: 'radial-gradient(circle at var(--fx-gx, 50%) var(--fx-gy, 30%), rgb(255 255 255 / 0.55), transparent 55%)' }}
        />
      )}
    </div>
  )
}

/** Headline that blurs in word by word. Plain text for screen readers. */
export function TextReveal({ text, className, as: Tag = 'h1', delay = 0 }: { text: string; className?: string; as?: 'h1' | 'h2' | 'h3' | 'p' | 'span'; delay?: number }) {
  const reduced = useReducedMotion()
  const words = useMemo(() => text.split(/(\s+)/), [text])
  if (reduced) return <Tag className={className}>{text}</Tag>
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <m.span
            key={i}
            aria-hidden
            className="inline-block"
            initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: EASE_OUT, delay: delay + i * 0.035 }}
          >
            {w}
          </m.span>
        ),
      )}
    </Tag>
  )
}

/** Falling gold meteors for dark heroes (decorative; hidden under reduced motion). */
export function Meteors({ count = 10, className }: { count?: number; className?: string }) {
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 97) % 100}%`,
        delay: `${((i * 1.7) % 7).toFixed(2)}s`,
        dur: `${6 + ((i * 3) % 6)}s`,
      })),
    [count],
  )
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {items.map((s, i) => (
        <span key={i} className="fx-meteor" style={{ left: s.left, '--fx-delay': s.delay, '--fx-dur': s.dur } as CSSProperties} />
      ))}
    </div>
  )
}

/** Soft floating glow orbs behind hero content. */
export function GlowOrbs({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <span className="fx-orb left-[-15%] top-[-20%] size-[55%] bg-emerald-400/60" />
      <span className="fx-orb right-[-10%] top-[10%] size-[45%] bg-gold-400/50 [animation-delay:-5s]" />
      <span className="fx-orb bottom-[-25%] left-[25%] size-[50%] bg-emerald-600/50 [animation-delay:-9s]" />
    </div>
  )
}

/** Endless horizontal strip (company names, crests, photos). Duplicates children for a seamless loop. */
export function Marquee({ children, className, reverse, duration = 38, gap = '1rem', label }: { children: ReactNode; className?: string; reverse?: boolean; duration?: number; gap?: string; label?: string }) {
  return (
    <div
      className={cn('fx-marquee', className)}
      data-reverse={reverse ? 'true' : undefined}
      style={{ '--fx-marquee-dur': `${duration}s`, '--fx-gap': gap } as CSSProperties}
      role={label ? 'region' : undefined}
      aria-label={label}
    >
      <div className="fx-marquee-track">{children}</div>
      <div className="fx-marquee-track" aria-hidden>
        {children}
      </div>
    </div>
  )
}

/** Bento layout: 2 columns on phones, 4 on tablet+. Give tiles col/row spans. */
export function BentoGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('fx-bento', className)}>{children}</div>
}

const SPAN = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-2 md:col-span-3', 4: 'col-span-2 md:col-span-4' } as const
const RSPAN = { 1: '', 2: 'row-span-2' } as const

/** One bento tile: liquid-glass surface with spotlight; `tone="hero"` = deep emerald aurora tile. */
export function BentoCard({
  className,
  cols = 1,
  rows = 1,
  tone = 'surface',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { cols?: 1 | 2 | 3 | 4; rows?: 1 | 2; tone?: 'surface' | 'hero' | 'gold' }) {
  const ref = useSpotlight<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn(
        'fx-spotlight fx-hairline relative overflow-hidden rounded-[1.6rem] p-4',
        SPAN[cols],
        RSPAN[rows],
        tone === 'surface' && 'bg-surface shadow-card',
        tone === 'hero' && 'bg-[radial-gradient(120%_90%_at_0%_0%,#0f7a57_0%,#084434_45%,#062a20_100%)] text-white shadow-pop',
        tone === 'gold' && 'fx-spotlight-gold bg-[radial-gradient(120%_90%_at_100%_0%,#f4dc9e_0%,#e4ad45_40%,#b5741c_100%)] text-[#2b1a05] shadow-pop',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
