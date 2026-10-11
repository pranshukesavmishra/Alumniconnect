import clsx from 'clsx'
import { BadgeCheck, EllipsisVertical, ExternalLink, Eye, Heart, Pause, Play, RefreshCw, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Display'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { relativeTime } from '../../lib/format'
import { DriveVideo, useMediaToken } from '../photos/DriveVideo'
import { mediaUrl } from '../photos/video'
import { storyError, useDeleteStory, useHeartState, useMarkSeen, useMuteOwner, useSourceStories, useStoryUrls, type StoryCard } from './api'
import {
  advanceProgress, bgStyle, HOLD_MS, isCloseSwipe, isExpired, isSafeLink, isSwiping, MAX_VIDEO_MS_SERVER, segmentFractions, startIndex, stepFrom, storyDurationMs, tapZone, textCardSize, timeLeft, videoFraction,
} from './rules'
import { HighlightPickerSheet, ReportSheet, ViewersSheet } from './StorySheets'
import type { ViewerRequest } from './viewerContext'

type SheetName = 'menu' | 'viewers' | 'report' | 'highlight' | null

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) : false))
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq?.matches ?? false)
    mq?.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])
  return reduced
}

function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

/**
 * The full-screen story viewer: segmented progress bars, auto-advance (photo and text 6 s, video its own length), tap right / left for
 * next / previous, press and hold to pause, swipe down to close, arrow keys and Esc, pause and mute buttons. Esc and the phone's Back
 * both close it (it adds one history entry, like the phone menu does).
 */
export function StoryViewer({ request, onClose }: { request: ViewerRequest; onClose: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const tabHidden = useTabHidden()
  const panel = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  const followed = useRef(false)
  const wantLast = useRef(false)
  const initFor = useRef<string | null>(null)
  const [sourceIdx, setSourceIdx] = useState(0)
  const source = request.sources[sourceIdx] ?? null
  const q = useSourceStories(source)
  const stories = useMemo(() => q.data?.stories ?? [], [q.data])
  const urls = useStoryUrls(stories)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [muted, setMuted] = useState(true)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [fraction, setFraction] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const elapsed = useRef(0)
  const markSeen = useMarkSeen()
  const { token } = useMediaToken(true)
  const mute = useMuteOwner()
  const del = useDeleteStory()
  const seenSent = useRef(new Set<string>())

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const story: StoryCard | undefined = stories[Math.min(index, Math.max(stories.length - 1, 0))]
  const heart = useHeartState(story)
  const sheetOpen = sheet !== null
  const durationMs = story ? storyDurationMs(story) : 0
  const stopped = paused || holding || sheetOpen || tabHidden || !mediaReady || mediaFailed || !story

  // ---- where to start in a person's stories, and what to do when there are none
  useEffect(() => {
    if (!q.data) return
    const key = `${sourceIdx}`
    if (initFor.current === key) return
    initFor.current = key
    const list = q.data.stories
    if (list.length === 0) {
      const step = stepFrom(0, 0, 1, sourceIdx, request.sources.length)
      if (step.kind === 'source') setSourceIdx((i) => i + 1)
      else closeRef.current()
      return
    }
    let at = startIndex(list)
    if (wantLast.current) at = list.length - 1
    else if (sourceIdx === 0 && request.startStoryId) at = Math.max(0, list.findIndex((s) => s.id === request.startStoryId))
    wantLast.current = false
    setIndex(at)
  }, [q.data, sourceIdx, request.sources.length, request.startStoryId])

  // ---- a new story: start again
  const storyId = story?.id
  useEffect(() => {
    storyIdRef.current = storyId
    advancedFor.current = null
    elapsed.current = 0
    setFraction(0)
    setMediaFailed(false)
    setMediaReady(story?.kind === 'text')
    setPaused(false)
    setVideoEl(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId])

  const go = useCallback(
    (dir: 1 | -1) => {
      const step = stepFrom(index, stories.length, dir, sourceIdx, request.sources.length)
      if (step.kind === 'story') {
        if (step.index === index) {
          advancedFor.current = null
          elapsed.current = 0
          setFraction(0)
          if (videoEl) videoEl.currentTime = 0
        } else setIndex(step.index)
      } else if (step.kind === 'source') {
        wantLast.current = step.dir === -1
        setSourceIdx((i) => i + step.dir)
        setIndex(0)
      } else closeRef.current()
    },
    [index, stories.length, sourceIdx, request.sources.length, videoEl],
  )
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  }, [go])
  // the clock and the video's own "ended" can both ask to move on: only the first counts for a story
  const advancedFor = useRef<string | null>(null)
  const storyIdRef = useRef<string | undefined>(undefined)
  const advance = useCallback(() => {
    if (advancedFor.current === storyIdRef.current) return
    advancedFor.current = storyIdRef.current ?? null
    goRef.current(1)
  }, [])

  // ---- the clock: photos and text count up, a video follows its own playback
  useEffect(() => {
    if (!story || stopped) return
    const isVideo = story.kind === 'video'
    let raf = 0
    let last = performance.now()
    let painted = -1
    const tick = (now: number) => {
      const dt = now - last
      last = now
      let f: number
      let done = false
      if (isVideo) {
        const v = videoEl
        const total = v && Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, MAX_VIDEO_MS_SERVER / 1000) : durationMs / 1000
        f = v ? videoFraction(v.currentTime, total) : 0
        done = !!v && v.ended
      } else {
        const p = advanceProgress(elapsed.current, dt, durationMs, false)
        elapsed.current = p.elapsed
        f = p.fraction
        done = p.done
      }
      if (!reduced || Math.abs(f - painted) >= 0.04 || done) {
        painted = f
        setFraction(f)
      }
      if (done) {
        advance()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [story, stopped, durationMs, reduced, videoEl, advance])

  // ---- video follows the play / pause / mute state
  useEffect(() => {
    if (!videoEl) return
    videoEl.muted = muted
    if (stopped) videoEl.pause()
    else void videoEl.play().catch(() => undefined)
  }, [videoEl, stopped, muted])

  // ---- mark as watched once it is really showing
  useEffect(() => {
    if (!story || !mediaReady || story.mine || story.seen || source?.type === 'highlight' || isExpired(story.expires_at)) return
    if (seenSent.current.has(story.id)) return
    seenSent.current.add(story.id)
    markSeen.mutate(story.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, mediaReady])

  // ---- Esc and Back close it; keyboard control; keep focus inside; no page scrolling behind
  useEffect(() => {
    const marker = { story: true }
    window.history.pushState({ ...(window.history.state ?? {}), ...marker }, '')
    let closedByBack = false
    const onPop = () => {
      closedByBack = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!closedByBack && !followed.current && (window.history.state as { story?: boolean } | null)?.story) window.history.back()
      document.body.style.overflow = overflow
      before?.focus?.({ preventScroll: true })
    }
  }, [])

  const toggleMute = useCallback(() => setMuted((m) => !m), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen) return // the sheet has its own Esc and focus handling
      const inControl = (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select')
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goRef.current(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goRef.current(-1)
      } else if ((e.key === ' ' || e.key === 'k') && !inControl) {
        e.preventDefault()
        setPaused((p) => !p)
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute()
      } else if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const [a, z] = [items[0]!, items[items.length - 1]!]
        if (e.shiftKey && (document.activeElement === a || document.activeElement === panel.current)) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [sheetOpen, toggleMute])

  // ---- touch / mouse on the picture: tap = next / previous, hold = pause, swipe down = close
  const press = useRef<{ x: number; y: number; t: number; swiped: boolean; held: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-ctl]')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    stage.current?.setPointerCapture?.(e.pointerId)
    const p = { x: e.clientX, y: e.clientY, t: performance.now(), swiped: false, held: false, timer: null as ReturnType<typeof setTimeout> | null }
    p.timer = setTimeout(() => {
      if (press.current === p && !p.swiped) {
        p.held = true
        setHolding(true)
      }
    }, HOLD_MS)
    press.current = p
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.swiped && isSwiping(dx, dy)) {
      p.swiped = true
      if (p.timer) clearTimeout(p.timer)
      setHolding(true)
    }
    if (p.swiped && dy > 0 && !reduced) setDragY(Math.min(dy, 400))
  }
  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    setDragY(0)
    setHolding(false)
    stage.current?.releasePointerCapture?.(e.pointerId)
    if (cancelled) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (p.swiped) {
      if (isCloseSwipe(dx, dy)) closeRef.current()
      return
    }
    if (p.held) return
    const rect = stage.current?.getBoundingClientRect()
    goRef.current(tapZone(e.clientX - (rect?.left ?? 0), rect?.width ?? 0) === 'prev' ? -1 : 1)
  }

  // ---- details for the screen
  const nextCard = stories[index + 1]
  useEffect(() => {
    if (nextCard?.kind === 'photo' && nextCard.media_path && urls.data?.[nextCard.media_path]) {
      const img = new Image()
      img.src = urls.data[nextCard.media_path]!
    }
  }, [nextCard, urls.data])

  const official = !!story?.is_official
  const name = official ? tx('stories.officialName') : (story?.owner_name ?? '')
  const mediaUrlFor = (c: Pick<StoryCard, 'media_path' | 'thumb_path'>) => (c.media_path ? urls.data?.[c.media_path] : c.thumb_path ? urls.data?.[c.thumb_path] : undefined)
  const poster = story?.thumb_path ? urls.data?.[story.thumb_path] : undefined
  const left = story ? timeLeft(story.expires_at) : null
  const canSeeViewers = !!story && story.views !== null
  const bars = segmentFractions(stories.length, index, fraction)
  const reloadMedia = () => {
    setMediaFailed(false)
    void urls.refetch()
    void q.refetch()
  }

  async function onDelete() {
    if (!story) return
    if (!window.confirm(tx('stories.confirmDelete'))) return
    try {
      await del.mutateAsync(story.id)
      toast.success(tx('stories.deleted'))
      setSheet(null)
      void q.refetch().then((r) => {
        if (!r.data?.stories.length) closeRef.current()
      })
    } catch (e) {
      toast.error(storyError(e))
    }
  }

  async function onMute(on: boolean) {
    if (!story) return
    try {
      await mute.mutateAsync({ user: story.owner_id, mute: on })
      toast.success(tx(on ? 'stories.muted' : 'stories.unmuted', { name: story.owner_name ?? '' }))
      setSheet(null)
      if (on) closeRef.current()
    } catch (e) {
      toast.error(storyError(e))
    }
  }

  const btn = 'grid size-11 place-items-center rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white'

  const body = (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={tx('stories.viewer')}
      tabIndex={-1}
      data-testid="story-viewer"
      data-story-id={story?.id}
      data-story-kind={story?.kind}
      data-paused={stopped ? 'true' : 'false'}
      className="fixed inset-0 z-[45] flex items-center justify-center bg-black text-white select-none"
    >
      <div
        className="relative h-dvh w-full max-w-[480px] overflow-hidden bg-black sm:h-[min(100dvh,920px)] sm:rounded-2xl"
        style={dragY ? { transform: `translateY(${dragY}px) scale(${1 - dragY / 2400})`, transition: 'none' } : reduced ? undefined : { transition: 'transform 160ms ease-out' }}
      >
        {/* the picture and the touch surface */}
        <div
          ref={stage}
          className="absolute inset-0 touch-none"
          data-testid="story-stage"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {q.isError ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center" data-ctl role="alert">
              <div className="space-y-3">
                <p>{storyError(q.error)}</p>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-5 font-semibold" onClick={() => void q.refetch()}>
                  <RefreshCw className="size-4" aria-hidden /> {tx('stories.retry')}
                </button>
              </div>
            </div>
          ) : !story ? (
            <div className="absolute inset-0 grid place-items-center" aria-busy="true">
              <span className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label={tx('common.loading')} />
            </div>
          ) : story.kind === 'text' ? (
            <div className="absolute inset-0 grid place-items-center px-7 text-center" style={{ background: bgStyle(story.bg_key) }} data-testid="story-text">
              <p dir="auto" className="max-w-full whitespace-pre-line break-words font-bold leading-tight [overflow-wrap:anywhere]" style={{ fontSize: textCardSize(story.text_body ?? '') }}>
                {story.text_body}
              </p>
            </div>
          ) : story.kind === 'photo' ? (
            mediaUrlFor(story) ? (
              <img
                key={story.id}
                src={mediaUrlFor(story)}
                alt={story.caption ?? tx('stories.photoAlt', { name })}
                className="absolute inset-0 size-full object-contain"
                draggable={false}
                data-testid="story-photo"
                onLoad={() => setMediaReady(true)}
                onError={() => setMediaFailed(true)}
              />
            ) : urls.isError ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center" data-ctl role="alert">
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-5 font-semibold" onClick={reloadMedia}>
                  <RefreshCw className="size-4" aria-hidden /> {tx('stories.retry')}
                </button>
              </div>
            ) : null
          ) : (
            <>
              {poster && !mediaReady && <img src={poster} alt="" className="absolute inset-0 size-full object-contain opacity-70" draggable={false} />}
              <DriveVideo
                key={story.id}
                kind="story"
                id={story.id}
                poster={poster}
                className="absolute inset-0 size-full object-contain"
                controls={false}
                autoPlay
                muted={muted}
                preload="auto"
                label={story.caption ?? tx('stories.videoAlt', { name })}
                videoRef={setVideoEl}
                onPlaying={() => setMediaReady(true)}
                onEnded={advance}
                testId="story-video"
              />
            </>
          )}
          {mediaFailed && story?.kind === 'photo' && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center" data-ctl role="alert">
              <div className="space-y-3">
                <p>{tx('stories.mediaError')}</p>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-5 font-semibold" onClick={reloadMedia}>
                  <RefreshCw className="size-4" aria-hidden /> {tx('stories.retry')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* shade for the writing */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/75 to-transparent" />

        {/* progress bars and who */}
        <div className="pointer-events-none absolute inset-x-0 top-0 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <div className="flex gap-1" role="progressbar" aria-label={tx('stories.progress', { n: Math.min(index + 1, Math.max(stories.length, 1)), total: stories.length })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
            {bars.map((f, i) => (
              <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35" data-testid="story-bar" data-fill={f.toFixed(2)}>
                <span className="block h-full origin-left rounded-full bg-white" style={{ width: `${f * 100}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {story && (
              <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2.5" data-ctl>
                {official ? (
                  <img src="/jec-logo.png" alt="" className="size-9 shrink-0 rounded-full bg-white object-contain p-0.5" />
                ) : (
                  <Avatar src={story.owner_avatar} name={name} size={36} />
                )}
                <div className="min-w-0 leading-tight">
                  <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold drop-shadow">
                    {!official && !story.mine ? (
                      <button
                        type="button"
                        className="min-h-11 truncate text-left font-semibold"
                        onClick={() => {
                          followed.current = true
                          navigate(`/people/${story.owner_id}`)
                          closeRef.current()
                        }}
                      >
                        {name}
                      </button>
                    ) : (
                      <span className="truncate">{story.mine ? tx('stories.yours') : name}</span>
                    )}
                    {official && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-black" data-testid="story-official-badge">
                        <BadgeCheck className="size-3.5" aria-hidden /> {tx('stories.official')}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-white/80">
                    {relativeTime(story.created_at)}
                    {(story.mine || canSeeViewers) && left ? ` · ${left.hours > 0 ? tx('stories.leftHM', { h: left.hours, m: left.minutes }) : tx('stories.leftM', { m: left.minutes })}` : ''}
                  </p>
                </div>
              </div>
            )}
            <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1" data-ctl>
              {story?.kind === 'video' && (
                <button type="button" className={btn} onClick={toggleMute} aria-pressed={!muted} aria-label={tx(muted ? 'stories.unmute' : 'stories.mute')} data-testid="story-mute">
                  {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
                </button>
              )}
              <button type="button" className={btn} onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={tx(paused ? 'stories.play' : 'stories.pause')} data-testid="story-pause">
                {paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
              </button>
              {story && (
                <button type="button" className={btn} onClick={() => { setSheet('menu') }} aria-label={tx('stories.options')} aria-haspopup="dialog" data-testid="story-options">
                  <EllipsisVertical className="size-5" aria-hidden />
                </button>
              )}
              <button ref={closeBtn} type="button" className={btn} onClick={() => closeRef.current()} aria-label={tx('stories.close')} data-testid="story-close">
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* caption, link, counts, heart */}
        {story && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-2.5 px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)]">
            {story.caption && (
              <p dir="auto" className="max-h-40 overflow-y-auto whitespace-pre-line break-words text-[16px] leading-snug drop-shadow [overflow-wrap:anywhere]" data-testid="story-caption">
                {story.caption}
              </p>
            )}
            {story.link_url && isSafeLink(story.link_url) && (
              <a
                href={story.link_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                data-ctl
                data-testid="story-link"
                className="pointer-events-auto flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 font-semibold text-black"
              >
                {story.link_label || tx('stories.linkDefault')} <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
            <div className="flex items-center justify-between gap-3">
              {canSeeViewers ? (
                <button type="button" data-ctl className="pointer-events-auto inline-flex min-h-11 items-center gap-3 rounded-full bg-black/45 px-4 text-sm font-semibold backdrop-blur" onClick={() => setSheet('viewers')} data-testid="story-stats">
                  <span className="inline-flex items-center gap-1.5"><Eye className="size-4" aria-hidden /> <span data-testid="story-views">{story.views}</span></span>
                  <span className="inline-flex items-center gap-1.5"><Heart className="size-4" aria-hidden /> <span data-testid="story-hearts">{story.hearts}</span></span>
                  <span className="sr-only">{tx('stories.seenBy')}</span>
                </button>
              ) : (
                <span />
              )}
              {!story.mine && (
                <button
                  type="button"
                  data-ctl
                  className={clsx('pointer-events-auto grid size-12 place-items-center rounded-full backdrop-blur', heart.on ? 'bg-rose-500 text-white' : 'bg-black/45 text-white hover:bg-black/65')}
                  aria-pressed={heart.on}
                  aria-label={tx(heart.on ? 'stories.unheart' : 'stories.heart')}
                  data-testid="story-heart"
                  onClick={() => void heart.toggle().catch((e: unknown) => toast.error(storyError(e)))}
                >
                  <Heart className={clsx('size-6', heart.on && 'fill-current')} aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}

        <p className="sr-only" aria-live="polite">
          {story ? tx('stories.progress', { n: index + 1, total: stories.length }) + ` ${name}` : ''}
        </p>
        {nextCard?.kind === 'video' && token && <video className="hidden" preload="metadata" muted src={mediaUrl('story', nextCard.id, token)} aria-hidden />}
      </div>

      {/* menu */}
      {story && (
        <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} label={tx('stories.options')}>
          <div className="py-1" data-testid="story-menu">
            {canSeeViewers && <SheetAction icon={<Eye className="size-5" />} onClick={() => setSheet('viewers')}>{tx('stories.seenBy')}</SheetAction>}
            {(story.mine || canSeeViewers) && <SheetAction icon={<BadgeCheck className="size-5" />} onClick={() => setSheet('highlight')}>{tx('stories.saveToHighlight')}</SheetAction>}
            {(story.mine || canSeeViewers) && <SheetAction danger icon={<X className="size-5" />} onClick={() => void onDelete()}>{tx('stories.delete')}</SheetAction>}
            {!story.mine && !canSeeViewers && <SheetAction icon={<EllipsisVertical className="size-5" />} onClick={() => setSheet('report')}>{tx('stories.report')}</SheetAction>}
            {!story.mine && !story.is_official && (
              <SheetAction icon={<VolumeX className="size-5" />} onClick={() => void onMute(true)}>{tx('stories.muteOwner', { name: story.owner_name ?? '' })}</SheetAction>
            )}
            {!story.mine && !story.is_official && (
              <SheetAction
                icon={<Eye className="size-5" />}
                onClick={() => {
                  followed.current = true
                  navigate(`/people/${story.owner_id}`)
                  closeRef.current()
                }}
              >
                {tx('stories.viewProfile')}
              </SheetAction>
            )}
          </div>
        </Sheet>
      )}
      {story && <ViewersSheet open={sheet === 'viewers'} onClose={() => setSheet(null)} story={story} />}
      {story && <ReportSheet open={sheet === 'report'} onClose={() => setSheet(null)} story={story} />}
      {story && <HighlightPickerSheet open={sheet === 'highlight'} onClose={() => setSheet(null)} story={story} />}
    </div>
  )
  return createPortal(body, document.body)
}
