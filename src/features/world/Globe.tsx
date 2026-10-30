import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from '../../components/ui/Motion'
import { cn } from '../../lib/cn'
import { globeFocus, globeMarkerSize, nearestMarker, projectGlobe, shortestTurn, wrapAngle } from './globeMath'

/*
 * The JEC World globe: cobe (~5 KB WebGL, fetched on first use) with gold markers sized by alumni count, labels that ride
 * along with the rotation, drag to turn, tap a marker to choose a city. Auto-rotates gently unless the person prefers
 * reduced motion (then it only moves under their finger). Pauses when off screen. Without WebGL it renders `fallback`.
 */

export interface GlobePoint {
  key: string
  lat: number
  lng: number
  count: number
  /** "10+ in Bengaluru" */
  label: string
}

let webglOk: boolean | null = null
export function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk
  try {
    const c = document.createElement('canvas')
    webglOk = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    webglOk = false
  }
  return webglOk
}

const INDIA = globeFocus(22.5, 79, 1)
const START = { phi: INDIA.phi - 0.35, theta: 0.32 }

export function Globe({
  points,
  focus,
  onSelect,
  labels = 6,
  autoRotate = true,
  interactive = true,
  selectedKey,
  ariaLabel,
  fallback,
  className,
}: {
  points: readonly GlobePoint[]
  /** turn this place to the front (animated) */
  focus?: { lat: number; lng: number } | null
  onSelect?: (key: string) => void
  /** how many of the biggest places get a floating label */
  labels?: number
  autoRotate?: boolean
  interactive?: boolean
  selectedKey?: string | null
  ariaLabel: string
  fallback?: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()
  const [supported] = useState(() => (typeof document === 'undefined' ? true : hasWebGL()))
  const [ready, setReady] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const labelEls = useRef<(HTMLElement | null)[]>([])
  const view = useRef({ ...START, targetPhi: null as number | null, targetTheta: null as number | null })
  const drag = useRef<{ x: number; y: number; phi: number; theta: number; moved: boolean } | null>(null)
  const kickRef = useRef<() => void>(() => undefined)
  const updateMarkersRef = useRef<() => void>(() => undefined)
  const lastDrag = useRef(0)

  const max = useMemo(() => points.reduce((m, p) => Math.max(m, p.count), 0), [points])
  const labelled = useMemo(() => [...points].sort((a, b) => b.count - a.count).slice(0, labels), [points, labels])
  const latest = useRef({ points, labelled, autoRotate, reduced, selectedKey, onSelect, max })
  latest.current = { points, labelled, autoRotate, reduced, selectedKey, onSelect, max }

  // create the globe once (cobe is fetched on demand)
  useEffect(() => {
    if (!supported) return
    const el = canvas.current
    const wrap = box.current
    if (!el || !wrap) return
    let globe: { update: (s: Record<string, unknown>) => void; destroy: () => void } | null = null
    let raf = 0
    let visible = true
    let dead = false
    let size = wrap.clientWidth || 300

    const markers = () =>
      latest.current.points.map((p) => ({
        location: [p.lat, p.lng] as [number, number],
        size: globeMarkerSize(p.count, latest.current.max),
        ...(p.key === latest.current.selectedKey ? { color: [1, 0.95, 0.8] as [number, number, number] } : {}),
      }))

    const placeLabels = () => {
      const v = view.current
      // biggest places first; a label that would overlap one already shown is hidden (no pile-ups over dense regions)
      const shown: { x: number; y: number; w: number }[] = []
      latest.current.labelled.forEach((p, i) => {
        const node = labelEls.current[i]
        if (!node) return
        const pr = projectGlobe(p.lat, p.lng, v.phi, v.theta)
        const x = pr.x * size
        const y = pr.y * size
        const w = node.offsetWidth || 90
        const clash = shown.some((o) => Math.abs(o.y - y) < 26 && Math.abs(o.x - x) < (o.w + w) / 2 + 6)
        const on = pr.visible && !clash
        if (on) shown.push({ x, y, w })
        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, calc(-100% - 10px))`
        node.style.opacity = on ? '1' : '0'
        node.style.visibility = on ? 'visible' : 'hidden'
      })
    }

    const frame = () => {
      raf = 0
      if (!globe || dead) return
      const v = view.current
      const l = latest.current
      let moving = false
      if (v.targetPhi !== null && v.targetTheta !== null) {
        const dp = shortestTurn(v.phi, v.targetPhi)
        const dt = v.targetTheta - v.theta
        if (Math.abs(dp) < 0.002 && Math.abs(dt) < 0.002) {
          v.phi = v.targetPhi
          v.theta = v.targetTheta
          v.targetPhi = v.targetTheta = null
        } else {
          const k = l.reduced ? 1 : 0.09
          v.phi = wrapAngle(v.phi + dp * k)
          v.theta += dt * k
          moving = true
        }
      } else if (l.autoRotate && !l.reduced && !drag.current && performance.now() - lastDrag.current > 2500) {
        v.phi = wrapAngle(v.phi + 0.0028)
        moving = true
      }
      globe.update({ phi: v.phi, theta: v.theta })
      placeLabels()
      if ((moving || drag.current) && visible) raf = requestAnimationFrame(frame)
    }
    const kick = () => {
      if (!globe || dead || raf) return
      raf = requestAnimationFrame(frame)
    }
    kickRef.current = kick

    void import('cobe').then(({ default: createGlobe }) => {
      if (dead) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      globe = createGlobe(el, {
        devicePixelRatio: dpr,
        width: size,
        height: size,
        phi: view.current.phi,
        theta: view.current.theta,
        dark: 1,
        diffuse: 1.6,
        mapSamples: size < 260 ? 9000 : 16000,
        mapBrightness: 5.5,
        mapBaseBrightness: 0.02,
        baseColor: [0.16, 0.34, 0.28],
        markerColor: [0.98, 0.74, 0.3],
        glowColor: [0.14, 0.42, 0.32],
        markers: markers(),
        markerElevation: 0.05,
        opacity: 0.95,
      }) as unknown as typeof globe
      setReady(true)
      placeLabels()
      kick()
    })

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth
      if (!w || Math.abs(w - size) < 1) return
      size = w
      globe?.update({ width: w, height: w })
      placeLabels()
    })
    ro.observe(wrap)
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([e]) => {
            visible = !!e?.isIntersecting
            if (visible) kick()
          })
        : null
    io?.observe(wrap)
    const onVis = () => {
      visible = document.visibilityState !== 'hidden'
      if (visible) kick()
    }
    document.addEventListener('visibilitychange', onVis)

    // markers change (data arrives, a city is selected)
    const updateMarkers = () => {
      globe?.update({ markers: markers() })
      placeLabels()
    }
    updateMarkersRef.current = updateMarkers
    return () => {
      dead = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      globe?.destroy()
    }
  }, [supported])

  useEffect(() => {
    updateMarkersRef.current()
    kickRef.current()
  }, [points, selectedKey, labelled])

  useEffect(() => {
    kickRef.current()
  }, [autoRotate, reduced])

  // focus a place
  useEffect(() => {
    if (!focus) return
    const f = globeFocus(focus.lat, focus.lng)
    view.current.targetPhi = f.phi
    view.current.targetTheta = f.theta
    kickRef.current()
  }, [focus?.lat, focus?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return <>{fallback}</>

  const onDown = (e: React.PointerEvent) => {
    if (!interactive) return
    drag.current = { x: e.clientX, y: e.clientY, phi: view.current.phi, theta: view.current.theta, moved: false }
    view.current.targetPhi = view.current.targetTheta = null
    kickRef.current()
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const w = box.current?.clientWidth || 300
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 6) {
      if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      d.moved = true
    }
    view.current.phi = wrapAngle(d.phi + (dx / w) * Math.PI)
    view.current.theta = Math.max(-0.9, Math.min(0.9, d.theta + (dy / w) * Math.PI * 0.6))
    kickRef.current()
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    lastDrag.current = performance.now()
    if (!d || d.moved || !onSelect) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const tap = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
    const v = view.current
    const pts = latest.current.points.map((p) => projectGlobe(p.lat, p.lng, v.phi, v.theta))
    const i = nearestMarker(pts, tap, 0.07)
    if (i >= 0) onSelect(latest.current.points[i]!.key)
  }

  return (
    <div ref={box} className={cn('relative aspect-square w-full select-none', className)}>
      {/* soft halo behind the sphere */}
      <div aria-hidden className="pointer-events-none absolute inset-[8%] rounded-full bg-[radial-gradient(circle,rgb(63_174_133/0.28)_0%,rgb(63_174_133/0.08)_45%,transparent_70%)] blur-2xl" />
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        data-testid="world-globe"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null
        }}
        className={cn(
          'absolute inset-0 size-full transition-opacity duration-700 ease-[var(--ease-out)]',
          interactive && 'cursor-grab touch-pan-y active:cursor-grabbing',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {labelled.map((p, i) => (
          <span
            key={p.key}
            ref={(n) => {
              labelEls.current[i] = n
            }}
            className={cn(
              'absolute left-0 top-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-white opacity-0 transition-opacity duration-300',
              'border border-white/15 bg-black/45 shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7)] backdrop-blur-md',
              p.key === selectedKey && 'border-gold-300/60 bg-gold-700/70',
            )}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
