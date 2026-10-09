import { describe, expect, it } from 'vitest'
import { translate, type MsgKey } from '../../i18n/core'
import { en } from '../../i18n/en'
import { clusterByCity, codeFromPositionError, distanceText, getPosition, isStale, LocationError, locationErrorKey, roundCoord, splitBatchmates, type NearbyRow } from './geo'

const t = (k: MsgKey, p?: Record<string, string | number>) => translate('en', k, p)
const row = (o: Partial<NearbyRow>): NearbyRow => ({
  user_id: 'u', full_name: 'A', avatar_url: null, grad_year: 2005, branch: null, headline: null, current_title: null, current_company: null,
  city: 'Pune', country: 'India', cluster_id: 1, cluster_name: 'Pune', cluster_lat: 18.52, cluster_lng: 73.86, source: 'live', bucket: 'same_city',
  approx_km: null, same_batch: false, is_mentor: false, can_help: false, ...o,
})

describe('roundCoord', () => {
  it('snaps to the 0.05 degree grid', () => {
    expect(roundCoord(18.5234)).toBe(18.5)
    expect(roundCoord(73.8567)).toBe(73.85)
    expect(roundCoord(-33.8688)).toBe(-33.85)
    expect(roundCoord(0.024)).toBe(0)
  })
})

describe('isStale (12 hour rule)', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  it('is stale with no data or a bad date', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale('nonsense', now)).toBe(true)
  })
  it('is fresh under 12 hours and stale after', () => {
    expect(isStale('2026-10-09T01:00:01Z', now)).toBe(false)
    expect(isStale('2026-10-09T00:00:00Z', now)).toBe(true)
  })
})

describe('getPosition', () => {
  const geo = (impl: Geolocation['getCurrentPosition']) => ({ isSecureContext: true, navigator: { geolocation: { getCurrentPosition: impl } as Geolocation } })
  it('refuses on an insecure page and without the API', async () => {
    await expect(getPosition({ isSecureContext: false, navigator: {} })).rejects.toMatchObject({ code: 'insecure' })
    await expect(getPosition({ isSecureContext: true, navigator: {} })).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('returns a rounded point and asks for low accuracy', async () => {
    let opts: PositionOptions | undefined
    const p = await getPosition(
      geo((ok, _e, o) => {
        opts = o
        ok({ coords: { latitude: 18.5234, longitude: 73.8567 } } as GeolocationPosition)
      }),
    )
    expect(p).toEqual({ lat: 18.5, lng: 73.85 })
    expect(opts?.enableHighAccuracy).toBe(false)
    expect(opts?.timeout).toBeGreaterThan(0)
  })
  it('maps browser errors', async () => {
    const fail = (code: number) => geo((_ok, err) => err?.({ code } as GeolocationPositionError))
    await expect(getPosition(fail(1))).rejects.toBeInstanceOf(LocationError)
    await expect(getPosition(fail(1))).rejects.toMatchObject({ code: 'denied' })
    await expect(getPosition(fail(2))).rejects.toMatchObject({ code: 'unavailable' })
    await expect(getPosition(fail(3))).rejects.toMatchObject({ code: 'timeout' })
    expect(codeFromPositionError(99)).toBe('unavailable')
  })
  it('gives up when the browser never answers', async () => {
    await expect(getPosition(geo(() => undefined), -1_990)).rejects.toMatchObject({ code: 'timeout' })
  })
  it('every error code has a message', () => {
    for (const c of ['insecure', 'unsupported', 'denied', 'unavailable', 'timeout'] as const) expect(en[locationErrorKey(c) as keyof typeof en]).toBeTruthy()
  })
})

describe('distanceText', () => {
  it('never claims more precision than the grid', () => {
    expect(distanceText(row({ bucket: 'same_city' }), t)).toBe('In your city')
    expect(distanceText(row({ bucket: 'same_city' }), t, 'Pune')).toBe('In Pune')
    expect(distanceText(row({ bucket: 'within_5' }), t)).toBe('Within 5 km')
    expect(distanceText(row({ bucket: 'km', approx_km: 40 }), t)).toBe('About 40 km')
    expect(distanceText(row({ bucket: 'profile', city: 'Pune' }), t)).toBe('Lives in Pune (from profile)')
  })
})

describe('clusters and grouping', () => {
  it('one pin per city with a count, ignoring rows without a city centre', () => {
    const rows = [row({ user_id: '1' }), row({ user_id: '2' }), row({ user_id: '3', cluster_id: 2, cluster_name: 'Mumbai' }), row({ user_id: '4', cluster_id: null })]
    expect(clusterByCity(rows).map((x) => [x.name, x.people.length])).toEqual([['Pune', 2], ['Mumbai', 1]])
  })
  it('batchmates are split from the rest, keeping order', () => {
    const { batchmates, others } = splitBatchmates([row({ user_id: '1' }), row({ user_id: '2', same_batch: true }), row({ user_id: '3' })])
    expect(batchmates.map((r) => r.user_id)).toEqual(['2'])
    expect(others.map((r) => r.user_id)).toEqual(['1', '3'])
  })
})
