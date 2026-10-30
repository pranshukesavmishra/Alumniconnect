// Turning alumni_world / public_alumni_world rows into globe points, labels and country groups (pure).
import type { GlobePoint } from './Globe'
import { countLabel, placeCount, placeKey, type MemberWorldPlace, type PublicWorldPlace } from './geo'

export type AnyPlace = MemberWorldPlace | PublicWorldPlace

/** "Bengaluru" for a city, "Somewhere in Germany" style names come from the UI for country points. */
export function placeName(p: AnyPlace): string {
  return p.city ?? p.country
}

export function toGlobePoints(places: readonly AnyPlace[], label: (n: string, place: string) => string): GlobePoint[] {
  return places
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ key: placeKey(p), lat: p.lat, lng: p.lng, count: placeCount(p), label: label(countLabel(p), placeName(p)) }))
}

export interface CountryGroup<P extends AnyPlace> {
  code: string
  country: string
  total: number
  places: P[]
}

/** Places grouped by country, biggest country first; cities biggest first inside, the "city unknown" point last. */
export function groupByCountry<P extends AnyPlace>(places: readonly P[]): CountryGroup<P>[] {
  const map = new Map<string, CountryGroup<P>>()
  for (const p of places) {
    const code = p.country_code ?? p.country
    const g = map.get(code) ?? { code, country: p.country, total: 0, places: [] }
    g.total += placeCount(p)
    g.places.push(p)
    map.set(code, g)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.places.sort((a, b) => {
      if (a.place_precision !== b.place_precision) return a.place_precision === 'city' ? -1 : 1
      return placeCount(b) - placeCount(a) || placeName(a).localeCompare(placeName(b))
    })
  }
  return groups.sort((a, b) => b.total - a.total || a.country.localeCompare(b.country))
}

/** Case- and accent-insensitive match on city or country ("bengal" finds Bengaluru, "reykjavik" finds Reykjavík). */
export function matchesPlace(p: AnyPlace, query: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return true
  return fold(p.city ?? '').includes(q) || fold(p.country).includes(q)
}
