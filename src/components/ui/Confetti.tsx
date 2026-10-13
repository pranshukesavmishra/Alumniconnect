import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from './Motion'

const COLORS = ['#1f916a', '#4fd1a1', '#e4ad45', '#f6d98c', '#b9434f', '#ffffff']

/**
 * A one-shot confetti burst on a full-screen canvas (no library). Fires each time `trigger` changes to a truthy value
 * (pass a counter, or `true` once). Draws nothing when the person prefers reduced motion. ~1.6 s, then removes itself.
 */
export function Confetti({ trigger, origin = { x: 0.5, y: 0.35 }, count = 90 }: { trigger: unknown; origin?: { x: number; y: number }; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!trigger || reduced) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    const ox = origin.x * w
    const oy = origin.y * h
    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2
      const v = 5 + Math.random() * 9
      return {
        x: ox,
        y: oy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 6,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        s: 5 + Math.random() * 6,
        c: COLORS[(Math.random() * COLORS.length) | 0]!,
        round: Math.random() < 0.3,
      }
    })
    const start = performance.now()
    let raf = 0
    const frame = (t: number) => {
      const el = t - start
      ctx.clearRect(0, 0, w, h)
      const fade = Math.max(0, 1 - el / 1600)
      for (const p of parts) {
        p.vy += 0.32
        p.vx *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        ctx.save()
        ctx.globalAlpha = fade
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.c
        if (p.round) {
          ctx.beginPath()
          ctx.arc(0, 0, p.s / 2.4, 0, Math.PI * 2)
          ctx.fill()
        } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2)
        ctx.restore()
      }
      if (el < 1600) raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, w, h)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [trigger, reduced, origin.x, origin.y, count])
  if (reduced || typeof document === 'undefined') return null
  return createPortal(<canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[100] size-full" />, document.body)
}
