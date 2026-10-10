import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Maximize2, Play, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang, useT } from '../../i18n'
import { DriveVideo } from '../photos/DriveVideo'
import { glimpseAutoplays } from '../photos/video'
import { glimpseCaption, glimpsePoster, useLiveGlimpses, type Glimpse } from './api'

/** Reduced motion / Data Saver / a slow connection: show the poster only and let a tap play it. */
export function useGlimpseAutoplay(): boolean {
  const [ok, setOk] = useState(() => read())
  function read() {
    if (typeof window === 'undefined') return false
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    return glimpseAutoplays({
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      saveData: conn?.saveData,
      effectiveType: conn?.effectiveType,
    })
  }
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const on = () => setOk(read())
    mq?.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])
  return ok
}

/** True while the element is on screen and the tab is in front. */
function useActive(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return inView && tabVisible
}

/**
 * The glimpses from earlier alumni meets, in a carousel. Only the slide on screen has a <video> (muted, playsInline, no controls): the
 * others are posters, so one clip downloads and plays at a time. It pauses when scrolled away or the tab is hidden. Tap the picture to
 * watch with sound and controls; the speaker button unmutes in place.
 */
export function GlimpseCarousel({ className }: { className?: string }) {
  const tx = useT()
  const { lang } = useLang()
  const { data: items } = useLiveGlimpses()
  const root = useRef<HTMLElement | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const active = useActive(root)
  const autoplay = useGlimpseAutoplay()
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [open, setOpen] = useState<Glimpse | null>(null)
  const count = items.length
  const cur = items[Math.min(index, Math.max(count - 1, 0))]
  const playing = active && autoplay && !open

  // pause when off screen, the tab is hidden, or the viewer is open; play when back
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (playing) void v.play().catch(() => {})
    else v.pause()
  }, [playing, cur?.id])

  const go = useCallback((by: number) => setIndex((i) => (count ? (i + by + count) % count : 0)), [count])
  useEffect(() => setMuted(true), [cur?.id])

  if (!count || !cur) return null
  const caption = glimpseCaption(cur, lang)
  const btn = 'grid size-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65'

  return (
    <section ref={root} aria-roledescription="carousel" aria-label={tx('glimpse.title')} className={clsx('relative overflow-hidden rounded-3xl bg-black shadow-pop', className)} data-testid="glimpse-carousel">
      <div className="relative aspect-video w-full">
        {playing ? (
          <DriveVideo
            key={cur.id}
            kind="glimpse"
            id={cur.id}
            poster={glimpsePoster(cur)}
            className="absolute inset-0 size-full cursor-pointer object-cover"
            controls={false}
            autoPlay
            muted={muted}
            loop={count === 1}
            preload="metadata"
            label={caption ?? tx('glimpse.title')}
            videoRef={video}
            onEnded={() => count > 1 && go(1)}
            onClick={() => setOpen(cur)}
            testId="glimpse-video"
          />
        ) : (
          <button type="button" className="absolute inset-0 block size-full" onClick={() => setOpen(cur)} aria-label={tx('glimpse.play', { caption: caption ?? tx('glimpse.title') })}>
            <img src={glimpsePoster(cur)} alt="" className="size-full object-cover" data-testid="glimpse-poster" />
            <span className="absolute inset-0 grid place-items-center"><span className="grid size-14 place-items-center rounded-full bg-black/55 text-white"><Play className="size-7 fill-current" aria-hidden /></span></span>
          </button>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3.5 text-white">
          <div className="min-w-0">
            {cur.year && <p className="text-xs font-bold uppercase tracking-wider text-accent">{cur.year}</p>}
            {caption && <p className="line-clamp-2 text-[15px] font-semibold leading-tight drop-shadow" data-testid="glimpse-caption">{caption}</p>}
          </div>
          <ul className="pointer-events-auto flex shrink-0 items-center gap-1.5" aria-label={tx('glimpse.slides')}>
            {items.map((g, i) => (
              <li key={g.id}>
                <button type="button" aria-label={tx('glimpse.goTo', { n: i + 1 })} aria-current={i === index} onClick={() => setIndex(i)} className="grid size-6 place-items-center">
                  <span className={clsx('block h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50')} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="absolute right-2.5 top-2.5 flex gap-2">
          {playing && (
            <button type="button" className={btn} aria-pressed={!muted} aria-label={muted ? tx('glimpse.unmute') : tx('glimpse.mute')} onClick={() => setMuted((m) => !m)} data-testid="glimpse-mute">
              {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
            </button>
          )}
          <button type="button" className={btn} aria-label={tx('glimpse.fullscreen')} onClick={() => setOpen(cur)}><Maximize2 className="size-5" aria-hidden /></button>
        </div>
        {count > 1 && (
          <>
            <button type="button" className={clsx(btn, 'absolute left-2.5 top-1/2 -translate-y-1/2')} aria-label={tx('common.previous')} onClick={() => go(-1)}><ChevronLeft className="size-5" aria-hidden /></button>
            <button type="button" className={clsx(btn, 'absolute right-2.5 top-1/2 -translate-y-1/2')} aria-label={tx('common.next')} onClick={() => go(1)}><ChevronRight className="size-5" aria-hidden /></button>
          </>
        )}
      </div>
      {open && <GlimpseViewer glimpse={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** One glimpse full screen with sound and the browser's own controls. */
export function GlimpseViewer({ glimpse, onClose }: { glimpse: Glimpse; onClose: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const caption = glimpseCaption(glimpse, lang)
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={caption ?? tx('glimpse.title')} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-3" data-testid="glimpse-viewer">
      <button type="button" onClick={onClose} aria-label={tx('common.close')} className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] grid size-12 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><X className="size-6" /></button>
      <DriveVideo kind="glimpse" id={glimpse.id} poster={glimpsePoster(glimpse)} className="max-h-[80dvh] max-w-full rounded-lg bg-black" autoPlay controls preload="metadata" label={caption ?? tx('glimpse.title')} testId="glimpse-viewer-video" />
      {(caption || glimpse.year) && (
        <p className="mt-3 max-w-xl text-center text-white">
          {glimpse.year && <span className="mr-2 text-sm font-bold text-accent">{glimpse.year}</span>}
          {caption}
        </p>
      )}
    </div>
  )
}

