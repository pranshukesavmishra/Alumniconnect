// Leaflet + OpenStreetMap, loaded only when the member taps "Show map" (no third-party request before that).
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

export default function VenueMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([lat, lng], 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(m)
    L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<span class="nearby-pin nearby-pin-active"></span>', iconSize: [44, 44], iconAnchor: [22, 22] }), title: label, alt: label }).addTo(m)
    return () => void m.remove()
  }, [lat, lng, label])
  return <div ref={el} role="region" aria-label={label} className="size-full" />
}
