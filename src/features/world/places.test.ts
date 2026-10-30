import { describe, expect, it } from 'vitest'
import type { MemberWorldPlace, PublicWorldPlace } from './geo'
import { groupByCountry, matchesPlace, toGlobePoints } from './places'

const city = (id: number, name: string, cc: string, country: string, n: number): MemberWorldPlace => ({
  city_id: id, city: name, country_code: cc, country, lat: 10, lng: 20, place_precision: 'city', alumni: n,
})

describe('places', () => {
  const rows: MemberWorldPlace[] = [
    city(1, 'Pune', 'IN', 'India', 40),
    city(2, 'Berlin', 'DE', 'Germany', 7),
    { city_id: null, city: null, country_code: 'IN', country: 'India', lat: 21, lng: 78, place_precision: 'country', alumni: 90 },
    city(3, 'Indore', 'IN', 'India', 12),
    city(4, 'Reykjavík', 'IS', 'Iceland', 3),
  ]

  it('groups by country, biggest first, cities before the unknown-city point', () => {
    const g = groupByCountry(rows)
    expect(g.map((x) => x.code)).toEqual(['IN', 'DE', 'IS'])
    expect(g[0]!.total).toBe(142)
    expect(g[0]!.places.map((p) => p.city)).toEqual(['Pune', 'Indore', null])
  })

  it('labels points with exact counts for members and "N+" for the public', () => {
    const pts = toGlobePoints(rows, (n, place) => `${n} in ${place}`)
    expect(pts[0]).toMatchObject({ key: 'c:1', count: 40, label: '40 in Pune' })
    const pub: PublicWorldPlace[] = [{ city: 'Delhi', country_code: 'IN', country: 'India', lat: 28.6, lng: 77.2, place_precision: 'city', alumni_at_least: 50 }]
    expect(toGlobePoints(pub, (n, place) => `${n} in ${place}`)[0]).toMatchObject({ count: 50, label: '50+ in Delhi' })
  })

  it('drops rows without coordinates', () => {
    expect(toGlobePoints([{ ...rows[0]!, lat: Number.NaN }], (n) => n)).toEqual([])
  })

  it('searches city and country, ignoring case and accents', () => {
    expect(matchesPlace(rows[4]!, 'reykjavik')).toBe(true)
    expect(matchesPlace(rows[1]!, 'GERM')).toBe(true)
    expect(matchesPlace(rows[1]!, 'pune')).toBe(false)
    expect(matchesPlace(rows[1]!, '  ')).toBe(true)
  })
})
