import { useQuery } from '@tanstack/react-query'
import { Expand, LogOut, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { PageSkeleton } from '../../components/ui/Display'
import { QrCode } from '../../components/ui/QrCode'
import { useLang, useT } from '../../i18n'
import { MEET_SLUG } from '../../lib/constants'
import { useEvent } from '../events/queries'
import { captionOf, fetchPhotos, photoUrl, type PhotoRow } from './api'
import { uploadLink } from './PhotoAdminPanel'

/**
 * Live slideshow for a venue projector: full screen, autoplay, new approved photos jump the queue as they arrive (the list is
 * re-read every few seconds), a QR code in the corner invites everybody to add their own. Keyboard: Esc leaves, Space pauses,
 * arrows move, F toggles full screen. The controls hide themselves after a few seconds without the mouse.
 */
export function PhotoSlideshow() {
  const tx = useT()
  const { lang } = useLang()
  const nav = useNavigate()
  const { slug = MEET_SLUG } = useParams()
  const [sp] = useSearchParams()
  const seconds = Math.min(60, Math.max(2, Number(sp.get('s')) || 6))
  const { data: event, isLoading } = useEvent(slug)
  const [slides, setSlides] = useState<PhotoRow[]>([])
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [freshN, setFreshN] = useState(0) // how many new arrivals are waiting to be shown
  const [badge, setBadge] = useState<string | null>(null) // the slide on screen that just arrived
  const fresh = useRef<string[]>([])
  const [showControls, setShowControls] = useState(true)
  const known = useRef<Set<string> | null>(null)
  const slidesRef = useRef<PhotoRow[]>([])
  slidesRef.current = slides

  const feed = useQuery({
    queryKey: ['slideshow', event?.id],
    enabled: !!event,
    refetchInterval: 5000,
    queryFn: () => fetchPhotos(event!.id, { scope: 'approved', order: 'new' }, 0, 200),
  })

  useEffect(() => {
    if (!feed.data) return
    if (known.current === null) {
      known.current = new Set(feed.data.map((p) => p.id))
      setSlides([...feed.data].reverse())
      return
    }
    const added = feed.data.filter((p) => !known.current!.has(p.id))
    const present = new Set(feed.data.map((p) => p.id))
    if (added.length) {
      added.forEach((p) => known.current!.add(p.id))
      setSlides((s) => [...s.filter((p) => present.has(p.id)), ...added.reverse()])
      fresh.current.push(...added.map((p) => p.id))
      setFreshN((n) => n + added.length)
    } else setSlides((s) => (s.length === feed.data.length && s.every((p) => present.has(p.id)) ? s : s.filter((p) => present.has(p.id))))
  }, [feed.data])

  const next = useCallback(() => {
    while (fresh.current.length) {
      const id = fresh.current.shift()!
      setFreshN((n) => Math.max(0, n - 1))
      const i = slidesRef.current.findIndex((p) => p.id === id)
      if (i >= 0) {
        setIdx(i)
        setBadge(id)
        return
      }
    }
    setBadge(null)
    setIdx((i) => (slidesRef.current.length ? (i + 1) % slidesRef.current.length : 0))
  }, [])
  const prev = useCallback(() => setIdx((i) => (slidesRef.current.length ? (i - 1 + slidesRef.current.length) % slidesRef.current.length : 0)), [])

  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setInterval(next, seconds * 1000)
    return () => clearInterval(t)
  }, [paused, slides.length, seconds, next])

  // a new arrival should not wait a whole turn
  useEffect(() => {
    if (freshN > 0 && !paused) {
      const t = setTimeout(next, 1200)
      return () => clearTimeout(t)
    }
  }, [freshN, paused, next])

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }, [])
  const leave = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    nav(`/events/${slug}/photos`)
  }, [nav, slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leave()
      else if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      } else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'f' || e.key === 'F') fullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leave, next, prev, fullscreen])

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav2 = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav2.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined)
    return () => void lock?.release().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (sp.get('kiosk')) return setShowControls(false)
    let t: ReturnType<typeof setTimeout>
    const wake = () => {
      setShowControls(true)
      clearTimeout(t)
      t = setTimeout(() => setShowControls(false), 4000)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('touchstart', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('touchstart', wake)
    }
  }, [sp])

  if (isLoading) return <PageSkeleton />
  if (!event) return null
  const cur = slides[idx % Math.max(slides.length, 1)]
  const upcoming = slides.length > 1 ? slides[(idx + 1) % slides.length] : null
  const caption = cur ? captionOf(cur, lang) : null
  const isNew = !!cur && badge === cur.id
  const btn = 'grid size-12 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25'

  return (
    <div role="region" aria-label={tx('photos.slideshow')} className={`fixed inset-0 z-50 flex items-center justify-center bg-black text-white ${showControls ? '' : 'cursor-none'}`} data-testid="slideshow">
      {cur ? (
        <>
          <img key={cur.id} src={photoUrl(cur)} alt={cur.alt_text ?? caption ?? ''} data-photo-id={cur.id} data-testid="slide" className="max-h-full max-w-full animate-[fadeIn_0.6s_ease] object-contain" />
          {upcoming && <link rel="prefetch" as="image" href={photoUrl(upcoming)} />}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/80 to-transparent p-5 pr-44 sm:p-8 sm:pr-56">
            <div className="min-w-0">
              {isNew && <span className="mb-2 inline-block rounded-full bg-accent px-3 py-1 text-sm font-bold text-black">{tx('photos.justAdded')}</span>}
              {caption && <p className="text-xl font-semibold sm:text-3xl">{caption}</p>}
              <p className="text-sm text-white/70 sm:text-lg">{cur.source === 'official' ? tx('photos.official') : cur.uploader_name ? tx('photos.by', { name: cur.uploader_name }) : tx('photos.fromMembers')} · {event.title}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="px-8 text-center text-2xl text-white/80" role="status">{tx('photos.slideshowEmpty')}</p>
      )}
      <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1 rounded-2xl bg-white p-2 text-black sm:bottom-6 sm:right-6">
        <QrCode value={uploadLink(event.slug)} size={128} label={tx('photos.qrLabel')} />
        <p className="max-w-32 text-center text-xs font-semibold">{tx('photos.scanToAdd')}</p>
      </div>
      <div className={`absolute inset-x-0 top-0 flex items-center justify-between p-4 transition-opacity ${showControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <button type="button" className={btn} onClick={leave} aria-label={tx('photos.exitSlideshow')}><LogOut className="size-5" /></button>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => setPaused(!paused)} aria-label={paused ? tx('photos.play') : tx('photos.pause')}>{paused ? <Play className="size-5" /> : <Pause className="size-5" />}</button>
          <button type="button" className={btn} onClick={fullscreen} aria-label={tx('photos.fullscreen')}><Expand className="size-5" /></button>
        </div>
      </div>
    </div>
  )
}
