// Pure maths for the cobe globe (src/features/world/Globe.tsx): the same projection cobe uses for its markers, so labels and
// taps line up with the dots it draws, plus the rotation that brings a city to the front. No DOM, no WebGL.

/** cobe's point on the unit sphere for [lat, lng] (its own convention, not three.js). */
export function cobeVector(lat: number, lng: number): [number, number, number] {
  const la = (lat * Math.PI) / 180
  const lo = (lng * Math.PI) / 180 - Math.PI
  const c = Math.cos(la)
  return [-c * Math.cos(lo), Math.sin(la), c * Math.sin(lo)]
}

/** Globe radius in cobe's clip space, and how far markers float above it. */
export const GLOBE_R = 0.8
export const MARKER_ELEVATION = 0.05

/**
 * Where [lat, lng] lands on the canvas for a given rotation: x/y in 0..1 of the canvas box (0,0 = top-left) and whether it
 * faces the viewer. Mirrors cobe 2's marker anchors (scale 1, no offset).
 */
export function projectGlobe(lat: number, lng: number, phi: number, theta: number, aspect = 1): { x: number; y: number; visible: boolean } {
  const r = GLOBE_R + MARKER_ELEVATION
  const [vx, vy, vz] = cobeVector(lat, lng)
  const x = vx * r
  const y = vy * r
  const z = vz * r
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  const c = cp * x + sp * z
  const s = sp * st * x + ct * y - cp * st * z
  const depth = -sp * ct * x + st * y + cp * ct * z
  return { x: (c / aspect + 1) / 2, y: (-s + 1) / 2, visible: depth >= 0 }
}

/** The rotation (phi, theta) that puts [lat, lng] in the middle of the globe, facing the viewer. Theta is softened so the globe never tips over. */
export function globeFocus(lat: number, lng: number, tilt = 0.75): { phi: number; theta: number } {
  const phi = (3 * Math.PI) / 2 - (lng * Math.PI) / 180
  const theta = ((Math.max(-60, Math.min(60, lat)) * Math.PI) / 180) * tilt
  return { phi: wrapAngle(phi), theta }
}

/** An angle wrapped into [0, 2π). */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2
  return ((a % t) + t) % t
}

/** The shortest signed turn from `from` to `to` (so an animation never spins the long way round). */
export function shortestTurn(from: number, to: number): number {
  const t = Math.PI * 2
  let d = (to - from) % t
  if (d > Math.PI) d -= t
  if (d < -Math.PI) d += t
  return d
}

/** cobe marker size (0.02 – 0.09) by area, from a place's alumni count. */
export function globeMarkerSize(count: number, maxCount: number): number {
  if (!(count > 0) || !(maxCount > 0)) return 0.02
  return 0.02 + 0.07 * Math.sqrt(Math.min(count, maxCount) / maxCount)
}

/** The index of the visible marker nearest to a tap (canvas fractions), within `radius` (fraction of the box), or -1. */
export function nearestMarker(
  points: readonly { x: number; y: number; visible: boolean }[],
  tap: { x: number; y: number },
  radius = 0.06,
): number {
  let best = -1
  let bestD = radius * radius
  points.forEach((p, i) => {
    if (!p.visible) return
    const d = (p.x - tap.x) ** 2 + (p.y - tap.y) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}
