// Leaflet + OpenStreetMap tiles. Loaded on demand only (lazy import from NearbyPage), so the main bundle stays small.
// It draws ONE pin per city (the public city centre) with the number of JECians there, never a pin per person.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { useT } from '../../i18n'
import type { Cluster } from './geo'

export default function NearbyMap({ clusters, selected, onSelect }: { clusters: Cluster[]; selected: number | null; onSelect: (id: number) => void }) {
  const t = useT()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const pick = useRef(onSelect)

  useEffect(() => {
    pick.current = onSelect
  })

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([22.5, 79], 4)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    for (const c of clusters) {
      const icon = L.divIcon({
        className: '',
        html: `<span class="nearby-pin${c.id === selected ? ' nearby-pin-active' : ''}">${c.people.length}</span>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      })
      const label = `${c.name}: ${t('nearby.clusterPeople', { count: c.people.length })}`
      const marker = L.marker([c.lat, c.lng], { icon, title: label, alt: label, keyboard: true, riseOnHover: true })
      marker.on('click', () => pick.current(c.id))
      marker.addTo(g)
    }
    if (clusters.length === 1) m.setView([clusters[0]!.lat, clusters[0]!.lng], 9)
    else if (clusters.length > 1) m.fitBounds(L.latLngBounds(clusters.map((c) => [c.lat, c.lng] as [number, number])), { padding: [48, 48], maxZoom: 9 })
  }, [clusters, selected, t])

  return <div ref={el} role="region" aria-label={t('nearby.mapLabel')} data-testid="nearby-map" className="h-80 w-full overflow-hidden rounded-2xl border border-border" />
}
