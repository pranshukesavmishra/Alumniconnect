// Browser location for "Share my city": foreground only, low accuracy, rounded before it leaves the phone
// (the server rounds again and never trusts this). Pure helpers are unit-tested in geo.test.ts.
import { en } from '../../i18n/en'
import { tr, type MsgKey } from '../../i18n/core'
import { friendlyError } from '../../lib/errors'

/** The grid the server stores: 0.05 degrees, about 5 km. */
export const GRID = 0.05
/** Refresh the shared city at most this often when the app opens. */
export const REFRESH_HOURS = 12

export function roundCoord(x: number): number {
  return Math.round(Math.round(x / GRID) * GRID * 100) / 100
}

/** True when a shared location is missing or older than REFRESH_HOURS. */
export function isStale(updatedAt: string | null | undefined, now: number = Date.now(), hours = REFRESH_HOURS): boolean {
  if (!updatedAt) return true
  const t = Date.parse(updatedAt)
  if (Number.isNaN(t)) return true
  return now - t >= hours * 3600_000
}

export type LocationErrorCode = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout'

export class LocationError extends Error {
  code: LocationErrorCode
  constructor(code: LocationErrorCode) {
    super(code)
    this.code = code
  }
}

const ERROR_KEYS: Record<LocationErrorCode, MsgKey> = {
  insecure: 'loc.errInsecure',
  unsupported: 'loc.errUnsupported',
  denied: 'loc.errDenied',
  unavailable: 'loc.errUnavailable',
  timeout: 'loc.errTimeout',
}

export function locationErrorKey(code: LocationErrorCode): MsgKey {
  return ERROR_KEYS[code]
}

/** GeolocationPositionError.code -> our code (1 denied, 2 unavailable, 3 timeout). */
export function codeFromPositionError(code: number): LocationErrorCode {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable'
}

interface GeoEnv {
  isSecureContext?: boolean
  navigator?: { geolocation?: Geolocation }
}

/** One low-accuracy position fix, in the foreground. Rejects with a LocationError. */
export function getPosition(env: GeoEnv = globalThis as GeoEnv, timeoutMs = 20_000): Promise<{ lat: number; lng: number }> {
  if (env.isSecureContext === false) return Promise.reject(new LocationError('insecure'))
  const geo = env.navigator?.geolocation
  if (!geo) return Promise.reject(new LocationError('unsupported'))
  return new Promise((resolve, reject) => {
    let done = false
    // some browsers never answer when the prompt is ignored: give up ourselves too
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        reject(new LocationError('timeout'))
      }
    }, timeoutMs + 2_000)
    geo.getCurrentPosition(
      (p) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ lat: roundCoord(p.coords.latitude), lng: roundCoord(p.coords.longitude) })
      },
      (e) => {
        if (done) return
        done = true
        clearTimeout(timer)
        reject(new LocationError(codeFromPositionError(e.code)))
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

/** Is location already allowed for this site? ('prompt' when unknown.) Never shows a prompt itself. */
export async function permissionState(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return (p?.state as 'granted' | 'denied' | 'prompt' | undefined) ?? 'prompt'
  } catch {
    return 'prompt'
  }
}

/** Server errors carry a message key in `hint` (loc.err...) so they read in the member's language. */
export function locationErrorMessage(e: unknown): string {
  if (e instanceof LocationError) return tr(locationErrorKey(e.code))
  const hint = (e as { hint?: string } | null)?.hint
  if (hint && hint in en) return tr(hint as MsgKey)
  return friendlyError(e)
}

export type Bucket = 'same_city' | 'within_5' | 'km' | 'profile'

export interface NearbyRow {
  user_id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  headline: string | null
  current_title: string | null
  current_company: string | null
  city: string | null
  country: string | null
  cluster_id: number | null
  cluster_name: string | null
  cluster_lat: number | null
  cluster_lng: number | null
  source: 'live' | 'profile'
  bucket: Bucket
  approx_km: number | null
  same_batch: boolean
  is_mentor: boolean
  can_help: boolean
}

type T = (key: MsgKey, params?: Record<string, string | number>) => string

/** "in your city" / "in Pune" / "within 5 km" / "about 40 km" / "lives in Pune (from profile)" */
export function distanceText(r: Pick<NearbyRow, 'bucket' | 'approx_km' | 'city'>, t: T, originCity?: string | null): string {
  switch (r.bucket) {
    case 'same_city':
      return originCity ? t('nearby.inCity', { city: originCity }) : t('nearby.inYourCity')
    case 'within_5':
      return t('nearby.within5')
    case 'km':
      return t('nearby.aboutKm', { km: r.approx_km ?? 0 })
    case 'profile':
      return t('nearby.fromProfile', { city: r.city ?? '' })
  }
}

export interface Cluster {
  id: number
  name: string
  lat: number
  lng: number
  people: NearbyRow[]
}

/** City clusters for the map: one pin per city centre with a count, never a pin per person. */
export function clusterByCity(rows: NearbyRow[]): Cluster[] {
  const map = new Map<number, Cluster>()
  for (const r of rows) {
    if (r.cluster_id == null || r.cluster_lat == null || r.cluster_lng == null) continue
    const c = map.get(r.cluster_id) ?? { id: r.cluster_id, name: r.cluster_name ?? '', lat: r.cluster_lat, lng: r.cluster_lng, people: [] }
    c.people.push(r)
    map.set(r.cluster_id, c)
  }
  return [...map.values()].sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name))
}

/** Batchmates first, then everyone else; the server's distance order is kept inside each group. */
export function splitBatchmates(rows: NearbyRow[]): { batchmates: NearbyRow[]; others: NearbyRow[] } {
  return { batchmates: rows.filter((r) => r.same_batch), others: rows.filter((r) => !r.same_batch) }
}
