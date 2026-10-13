// JEC World: pure helpers for drawing alumni-by-city on a globe or a flat map. Coordinates are city centres from the
// bundled city table (never anyone's own position).

export interface WorldPlace {
  /** null for a country-level point (members whose city is unknown) and always null on the public map */
  city_id?: number | null
  city: string | null
  country_code: string | null
  country: string
  lat: number
  lng: number
  place_precision: 'city' | 'country'
}
/** alumni_world(): verified members see exact counts */
export interface MemberWorldPlace extends WorldPlace {
  city_id: number | null
  alumni: number
}
/** public_alumni_world(): only places with 3+ alumni, counts rounded down ("at least") */
export interface PublicWorldPlace extends WorldPlace {
  alumni_at_least: number
}

/** Latitude clamped to [-90, 90], longitude wrapped into [-180, 180). Non-finite input gives null. */
export function normaliseLatLng(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const la = Math.max(-90, Math.min(90, lat))
  let lo = ((((lng + 180) % 360) + 360) % 360) - 180
  if (Object.is(lo, -0)) lo = 0
  return { lat: la, lng: lo }
}

/**
 * A point on a sphere, y up (the usual three.js globe convention): north pole = +y, lat 0 / lng 0 = +x, lng 90°E = -z.
 * phi = polar angle from the north pole, theta = lng + 180.
 */
export function toVector3(lat: number, lng: number, radius = 1): { x: number; y: number; z: number } {
  const n = normaliseLatLng(lat, lng) ?? { lat: 0, lng: 0 }
  const phi = ((90 - n.lat) * Math.PI) / 180
  const theta = ((n.lng + 180) * Math.PI) / 180
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v)
  return {
    x: clean(-radius * Math.sin(phi) * Math.cos(theta)),
    y: clean(radius * Math.cos(phi)),
    z: clean(radius * Math.sin(phi) * Math.sin(theta)),
  }
}

/** Equirectangular position in [0, 1] x [0, 1] (0,0 = top-left = 180°W, 90°N) for a flat SVG / canvas map. */
export function toFlat(lat: number, lng: number): { x: number; y: number } {
  const n = normaliseLatLng(lat, lng) ?? { lat: 0, lng: 0 }
  return { x: (n.lng + 180) / 360, y: (90 - n.lat) / 180 }
}

/** Marker radius by area (square root), between min and max. */
export function markerRadius(count: number, maxCount: number, min = 3, max = 18): number {
  if (!(count > 0) || !(maxCount > 0)) return min
  return min + (max - min) * Math.sqrt(Math.min(count, maxCount) / maxCount)
}

/** A stable key for a place (cities by id, country points by code, public rows by name + country). */
export function placeKey(p: Pick<WorldPlace, 'city_id' | 'city' | 'country_code' | 'country' | 'place_precision'>): string {
  if (p.place_precision === 'country') return `n:${p.country_code ?? p.country}`
  if (p.city_id) return `c:${p.city_id}`
  return `p:${(p.city ?? '').toLowerCase()}|${p.country_code ?? p.country}`
}

/** "12" for members; "10+" for the public map, whose counts are lower bounds. */
export function countLabel(p: MemberWorldPlace | PublicWorldPlace): string {
  return 'alumni' in p ? String(p.alumni) : `${p.alumni_at_least}+`
}

export function placeCount(p: MemberWorldPlace | PublicWorldPlace): number {
  return 'alumni' in p ? p.alumni : p.alumni_at_least
}

/** Totals for a header: alumni, cities and countries on the map. */
export function worldTotals(places: readonly (MemberWorldPlace | PublicWorldPlace)[]): { alumni: number; cities: number; countries: number } {
  const countries = new Set(places.map((p) => p.country_code ?? p.country))
  return {
    alumni: places.reduce((s, p) => s + placeCount(p), 0),
    cities: places.filter((p) => p.place_precision === 'city').length,
    countries: countries.size,
  }
}

/** Globe rotation in radians (three.js Euler order 'XYZ') that turns a point of toVector3() to face a camera on +z. */
export function focusRotation(lat: number, lng: number): { x: number; y: number } {
  const n = normaliseLatLng(lat, lng) ?? { lat: 0, lng: 0 }
  return { x: (n.lat * Math.PI) / 180, y: (-(n.lng + 90) * Math.PI) / 180 }
}
