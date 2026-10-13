import { describe, expect, it } from 'vitest'
import { countLabel, focusRotation, markerRadius, normaliseLatLng, placeKey, toFlat, toVector3, worldTotals, type MemberWorldPlace, type PublicWorldPlace } from './geo'

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

describe('coordinate normalisation', () => {
  it('wraps longitude and clamps latitude', () => {
    expect(normaliseLatLng(23.17, 79.95)).toEqual({ lat: 23.17, lng: 79.95 })
    expect(normaliseLatLng(10, 190)).toEqual({ lat: 10, lng: -170 })
    expect(normaliseLatLng(10, -190)).toEqual({ lat: 10, lng: 170 })
    expect(normaliseLatLng(10, 180)).toEqual({ lat: 10, lng: -180 })
    expect(normaliseLatLng(10, 540)).toEqual({ lat: 10, lng: -180 })
    expect(normaliseLatLng(10, -360)).toEqual({ lat: 10, lng: 0 })
    expect(normaliseLatLng(95, 0)).toEqual({ lat: 90, lng: 0 })
    expect(normaliseLatLng(-100, 0)).toEqual({ lat: -90, lng: 0 })
    expect(normaliseLatLng(Number.NaN, 0)).toBeNull()
    expect(normaliseLatLng(0, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('places points on a unit sphere', () => {
    const north = toVector3(90, 0)
    close(north.y, 1); close(north.x, 0); close(north.z, 0)
    const zero = toVector3(0, 0)
    close(zero.x, 1); close(zero.y, 0); close(zero.z, 0)
    const east = toVector3(0, 90)
    close(east.z, -1); close(east.x, 0)
    for (const [lat, lng] of [[23.17, 79.95], [-33.9, 151.2], [40.7, -74]] as const) {
      const v = toVector3(lat, lng, 2)
      close(Math.hypot(v.x, v.y, v.z), 2)
      // same point after wrapping the longitude
      const w = toVector3(lat, lng + 360, 2)
      close(w.x, v.x); close(w.y, v.y); close(w.z, v.z)
    }
  })

  it('focus rotation brings a point to face +z', () => {
    for (const [lat, lng] of [[23.17, 79.95], [-33.9, 151.2], [51.5, -0.12], [0, 0]] as const) {
      const v = toVector3(lat, lng)
      const r = focusRotation(lat, lng)
      // three.js Euler XYZ: rotate about y, then about x
      const x1 = v.x * Math.cos(r.y) + v.z * Math.sin(r.y)
      const z1 = -v.x * Math.sin(r.y) + v.z * Math.cos(r.y)
      const y2 = v.y * Math.cos(r.x) - z1 * Math.sin(r.x)
      const z2 = v.y * Math.sin(r.x) + z1 * Math.cos(r.x)
      close(x1, 0); close(y2, 0); close(z2, 1)
    }
  })

  it('maps to a flat map', () => {
    expect(toFlat(90, -180)).toEqual({ x: 0, y: 0 })
    expect(toFlat(0, 0)).toEqual({ x: 0.5, y: 0.5 })
    expect(toFlat(-90, 179.999).y).toBe(1)
  })
})

describe('markers and totals', () => {
  it('scales marker area with the count', () => {
    expect(markerRadius(0, 100)).toBe(3)
    expect(markerRadius(100, 100)).toBe(18)
    expect(markerRadius(500, 100)).toBe(18)
    expect(markerRadius(25, 100)).toBeCloseTo(3 + 15 * 0.5)
  })

  const blr: MemberWorldPlace = { city_id: 1277333, city: 'Bengaluru', country_code: 'IN', country: 'India', lat: 12.97, lng: 77.59, place_precision: 'city', alumni: 12 }
  const us: MemberWorldPlace = { city_id: null, city: null, country_code: 'US', country: 'United States', lat: 40.7, lng: -74, place_precision: 'country', alumni: 2 }
  const pub: PublicWorldPlace = { city: 'Pune', country_code: 'IN', country: 'India', lat: 18.52, lng: 73.86, place_precision: 'city', alumni_at_least: 10 }

  it('keys and labels', () => {
    expect(placeKey(blr)).toBe('c:1277333')
    expect(placeKey(us)).toBe('n:US')
    expect(placeKey(pub)).toBe('p:pune|IN')
    expect(countLabel(blr)).toBe('12')
    expect(countLabel(pub)).toBe('10+')
  })

  it('totals', () => {
    expect(worldTotals([blr, us, pub])).toEqual({ alumni: 24, cities: 2, countries: 2 })
    expect(worldTotals([])).toEqual({ alumni: 0, cities: 0, countries: 0 })
  })
})
