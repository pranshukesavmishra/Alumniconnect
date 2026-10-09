import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Copy, Download, FileText, Loader2, Pause, Pencil, Pin, PinOff, Play, Plus, Reply, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { Avatar } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { Linkified } from '../community/PostCard'
import { downloadUrl, formatBytes, useMediaUrl } from './media'
import { formatDuration, groupReactions, nextSelection, pollTally, previewOf, type Attachment, type Message, type Reaction, type ReplyPreview } from './merge'

export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏']
const MORE_REACTIONS = ['🔥', '🎉', '👏', '💯', '🙌', '😍', '🤣', '😊', '🤔', '😎', '🥳', '😅', '👌', '✅', '🙂', '😇', '🤝', '💪', '🌟', '🎂', '🇮🇳', '☕', '🍰', '📸']

// ------------------------------------------------------------------ media
function MediaImg({ a, thumb, className, alt }: { a: Attachment; thumb?: boolean; className?: string; alt: string }) {
  const path = thumb ? (a.thumb ?? a.path) : a.path
  const { data: url, isError } = useMediaUrl(path, a.localUrl)
  const src = a.localUrl ?? url
  if (isError) return <div className={clsx('grid place-items-center bg-surface-2 text-xs text-muted', className)}>Photo unavailable</div>
  if (!src) return <div className={clsx('skeleton', className)} />
  return <img src={src} alt={alt} className={clsx('bg-surface-2 object-cover', className)} loading="lazy" decoding="async" draggable={false} />
}

/** Photos in a message: 1 large, 2 side by side, 3+ as a 2×2 grid with "+N". Space is reserved, so the chat never jumps. */
export function PhotoGrid({ items, pending, onOpen }: { items: Attachment[]; pending?: boolean; onOpen: (index: number) => void }) {
  const shown = items.slice(0, 4)
  const extra = items.length - shown.length
  const one = items.length === 1 ? items[0]! : null
  const ratio = one?.width && one?.height ? Math.min(Math.max(one.width / one.height, 0.6), 1.9) : 4 / 3
  return (
    <div className={clsx('relative -mx-2 -mt-0.5 mb-1 overflow-hidden rounded-xl', items.length > 1 && 'grid grid-cols-2 gap-0.5')} style={one ? { width: 'min(68vw, 300px)', aspectRatio: String(ratio) } : { width: 'min(68vw, 300px)' }}>
      {shown.map((a, i) => (
        <button
          key={a.path + i}
          type="button"
          onClick={() => !pending && onOpen(i)}
          className={clsx('relative block', one ? 'size-full' : 'aspect-square', items.length === 3 && i === 0 && 'col-span-2 aspect-[2/1]')}
          aria-label={`Open photo ${i + 1} of ${items.length}`}
        >
          <MediaImg a={a} thumb={!one} className="size-full" alt="" />
          {i === 3 && extra > 0 && <span className="absolute inset-0 grid place-items-center bg-black/50 text-2xl font-bold text-white">+{extra}</span>}
        </button>
      ))}
      {pending && (
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <Loader2 className="size-8 animate-spin text-white" aria-label="Uploading" />
        </span>
      )}
    </div>
  )
}

export function FileCard({ a, mine, pending }: { a: Attachment; mine: boolean; pending?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function open() {
    if (pending || busy) return
    setBusy(true)
    try {
      const url = await downloadUrl(a)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const ext = (a.name?.split('.').pop() ?? '').slice(0, 4).toUpperCase()
  return (
    <button type="button" onClick={open} className={clsx('-mx-1 mb-1 flex w-[min(64vw,280px)] items-center gap-3 rounded-xl p-2 text-left', mine ? 'bg-white/15' : 'bg-surface-2')}>
      <span className={clsx('grid size-11 shrink-0 place-items-center rounded-lg', mine ? 'bg-white/20' : 'bg-primary-soft text-primary')}>
        {pending || busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <FileText className="size-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{a.name ?? 'File'}</span>
        <span className={clsx('block text-xs', mine ? 'text-on-primary/75' : 'text-muted')}>{[ext, formatBytes(a.size)].filter(Boolean).join(' · ')}</span>
      </span>
      {!pending && <Download className="size-5 shrink-0 opacity-80" aria-label="Download" />}
    </button>
  )
}

/** Full-screen photo viewer: swipe or arrow keys to move, Escape to close, download button. */
export function Lightbox({ items, start, onClose }: { items: Attachment[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const touch = useRef<number | null>(null)
  const a = items[i]!
  const { data: url } = useMediaUrl(a.path, a.localUrl)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [items.length, onClose])
  async function save() {
    try {
      window.open(await downloadUrl(a), '_blank', 'noopener')
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touch.current
        const end = e.changedTouches[0]?.clientX
        if (start == null || end == null) return
        if (end - start > 60) setI((x) => Math.max(0, x - 1))
        if (start - end > 60) setI((x) => Math.min(items.length - 1, x + 1))
      }}
    >
      <div className="flex items-center gap-2 p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
          <X className="size-6" />
        </button>
        <span className="flex-1 text-center text-sm">{items.length > 1 ? `${i + 1} of ${items.length}` : ''}</span>
        <button type="button" onClick={save} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label="Download photo">
          <Download className="size-6" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {url || a.localUrl ? <img src={a.localUrl ?? url} alt={`Photo ${i + 1}`} className="max-h-full max-w-full object-contain" /> : <Loader2 className="size-8 animate-spin" />}
        {i > 0 && (
          <button type="button" onClick={() => setI(i - 1)} className="absolute left-2 hidden size-12 place-items-center rounded-full bg-white/10 md:grid" aria-label="Previous photo">
            <ChevronLeft className="size-7" />
          </button>
        )}
        {i < items.length - 1 && (
          <button type="button" onClick={() => setI(i + 1)} className="absolute right-2 hidden size-12 place-items-center rounded-full bg-white/10 md:grid" aria-label="Next photo">
            <ChevronRight className="size-7" />
          </button>
        )}
      </div>
      <div className="pb-[calc(env(safe-area-inset-bottom)+0.75rem)]" />
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------ replies
export function replyPreviewOf(m: Message): ReplyPreview {
  return {
    id: m.id,
    sender_id: m.sender_id,
    kind: m.kind,
    body: m.body,
    attachments: m.attachments,
    poll: m.poll,
    deleted_at: m.deleted_at,
    sender: m.sender ? { full_name: m.sender.full_name } : null,
  }
}

export function ReplyQuote({ r, mine, me, onClick }: { r: ReplyPreview; mine: boolean; me: string | null; onClick?: () => void }) {
  const photo = r.kind === 'image' && !r.deleted_at ? r.attachments[0] : undefined
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('-mx-1 mb-1 flex w-[calc(100%+0.5rem)] min-w-40 items-stretch gap-2 overflow-hidden rounded-lg border-l-4 text-left text-sm', mine ? 'border-white/70 bg-white/15' : 'border-primary bg-primary-soft')}
    >
      <span className="min-w-0 flex-1 py-1 pl-1">
        <span className={clsx('block truncate font-semibold', mine ? 'text-on-primary' : 'text-primary')}>{r.sender_id === me ? 'You' : (r.sender?.full_name ?? 'Member')}</span>
        <span className={clsx('line-clamp-2 break-words', mine ? 'text-on-primary/85' : 'text-muted')}>{previewOf(r)}</span>
      </span>
      {photo && <MediaImg a={photo} thumb className="size-12 shrink-0" alt="" />}
    </button>
  )
}

// ------------------------------------------------------------------ reactions
export function ReactionChips({ list, me, mine, onOpen }: { list: Reaction[] | undefined; me: string | null; mine: boolean; onOpen: () => void }) {
  const groups = groupReactions(list, me)
  if (!groups.length) return null
  const total = groups.reduce((n, g) => n + g.count, 0)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx('relative z-[1] -mt-1.5 flex min-h-7 items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 text-sm shadow-sm', mine ? 'mr-2 self-end' : 'ml-2 self-start', groups.some((g) => g.mine) && 'border-primary/50 bg-primary-soft')}
      aria-label={`Reactions: ${groups.map((g) => `${g.emoji} ${g.count}`).join(', ')}. Show who reacted`}
    >
      {groups.slice(0, 3).map((g) => (
        <span key={g.emoji} aria-hidden>{g.emoji}</span>
      ))}
      {total > 1 && <span className="ml-0.5 text-xs font-semibold text-muted">{total}</span>}
    </button>
  )
}

export function ReactorsSheet({ m, me, onClose, onRemoveMine }: { m: Message | null; me: string | null; onClose: () => void; onRemoveMine: () => void }) {
  const groups = groupReactions(m?.reactions, me)
  const [tab, setTab] = useState<string | null>(null)
  const list = (m?.reactions ?? []).filter((r) => !tab || r.emoji === tab)
  return (
    <Sheet open={!!m} onClose={onClose} label="Reactions">
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 pt-1">
        <button type="button" onClick={() => setTab(null)} className={clsx('min-h-10 shrink-0 rounded-full px-3 text-sm font-semibold', !tab ? 'bg-primary-soft text-primary' : 'text-muted')}>
          All {m?.reactions?.length ?? 0}
        </button>
        {groups.map((g) => (
          <button key={g.emoji} type="button" onClick={() => setTab(g.emoji)} className={clsx('min-h-10 shrink-0 rounded-full px-3 text-sm font-semibold', tab === g.emoji ? 'bg-primary-soft text-primary' : 'text-muted')}>
            {g.emoji} {g.count}
          </button>
        ))}
      </div>
      <ul className="py-1">
        {list.map((r) => (
          <li key={r.user_id}>
            {r.user_id === me ? (
              <button type="button" onClick={onRemoveMine} className="flex min-h-14 w-full items-center gap-3 px-5 text-left hover:bg-surface-2">
                <Avatar src={r.user?.avatar_url} name={r.user?.full_name ?? 'You'} size={36} />
                <span className="flex-1">
                  <span className="block font-semibold">You</span>
                  <span className="block text-xs text-muted">Tap to remove</span>
                </span>
                <span className="text-2xl">{r.emoji}</span>
              </button>
            ) : (
              <div className="flex min-h-14 items-center gap-3 px-5">
                <Avatar src={r.user?.avatar_url} name={r.user?.full_name ?? 'Member'} size={36} />
                <span className="flex-1 font-semibold">{r.user?.full_name ?? 'Member'}</span>
                <span className="text-2xl">{r.emoji}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

// ------------------------------------------------------------------ actions (long-press / right-click)
export interface ActionPermissions {
  canReact: boolean
  canReply: boolean
  canEdit: boolean
  canDelete: boolean
  adminDelete: boolean
  canPin: boolean
}

export function MessageActionsSheet({
  m,
  perms,
  me,
  onClose,
  onReact,
  onReply,
  onEdit,
  onDelete,
  pinned,
  onPin,
}: {
  m: Message | null
  perms: ActionPermissions
  me: string | null
  onClose: () => void
  onReact: (emoji: string | null) => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  pinned: boolean
  onPin: () => void
}) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!m) setMore(false)
  }, [m])
  const myEmoji = m?.reactions?.find((r) => r.user_id === me)?.emoji ?? null
  const copyable = !!m?.body && !m.deleted_at
  return (
    <Sheet open={!!m} onClose={onClose} label="Message options">
      {m && (
        <>
          <p className="mx-5 mb-2 mt-1 line-clamp-2 text-sm text-muted">{previewOf(m)}</p>
          {perms.canReact && (
            <div className="px-3 pb-2">
              <div className="flex items-center justify-between gap-1 rounded-full bg-surface-2 p-1.5" role="group" aria-label="React">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onReact(myEmoji === e ? null : e)}
                    className={clsx('grid size-11 place-items-center rounded-full text-2xl transition-transform active:scale-110', myEmoji === e && 'bg-primary-soft ring-2 ring-primary')}
                    aria-label={myEmoji === e ? `Remove ${e}` : `React ${e}`}
                    aria-pressed={myEmoji === e}
                  >
                    {e}
                  </button>
                ))}
                <button type="button" onClick={() => setMore((x) => !x)} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface" aria-label="More reactions" aria-expanded={more}>
                  <Plus className="size-5" />
                </button>
              </div>
              {more && (
                <div className="mt-2 grid grid-cols-8 gap-1">
                  {MORE_REACTIONS.map((e) => (
                    <button key={e} type="button" onClick={() => onReact(myEmoji === e ? null : e)} className={clsx('grid aspect-square min-h-11 place-items-center rounded-xl text-2xl hover:bg-surface-2', myEmoji === e && 'bg-primary-soft')} aria-label={`React ${e}`}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-border pt-1">
            {perms.canReply && <SheetAction icon={<Reply className="size-5" />} onClick={onReply}>Reply</SheetAction>}
            {copyable && (
              <SheetAction
                icon={<Copy className="size-5" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(m.body ?? '').then(() => toast.success('Copied'))
                  onClose()
                }}
              >
                Copy text
              </SheetAction>
            )}
            {perms.canPin && <SheetAction icon={pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />} onClick={onPin}>{pinned ? 'Unpin' : 'Pin to top'}</SheetAction>}
            {perms.canEdit && <SheetAction icon={<Pencil className="size-5" />} onClick={onEdit}>Edit</SheetAction>}
            {perms.canDelete && (
              <SheetAction icon={<Trash2 className="size-5" />} danger onClick={onDelete}>
                {perms.adminDelete ? 'Remove as group admin' : 'Delete for everyone'}
              </SheetAction>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}

/**
 * Touch gestures on a message, like WhatsApp/Instagram:
 * swipe right to reply, long-press for options, double-tap to ❤️. Right-click opens options on desktop.
 */
export function useMessageGestures({ onReply, onMenu, onDoubleTap, enabled }: { onReply: () => void; onMenu: () => void; onDoubleTap: () => void; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useRef({ x: 0, y: 0, dx: 0, swiping: false, cancelled: false, longFired: false, timer: 0 as unknown as ReturnType<typeof setTimeout>, lastTap: 0, touchAt: 0 })
  const cb = useRef({ onReply, onMenu, onDoubleTap })
  useEffect(() => {
    cb.current = { onReply, onMenu, onDoubleTap }
  }, [onReply, onMenu, onDoubleTap])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const s = state.current
    const setX = (x: number) => {
      el.style.transform = x ? `translateX(${x}px)` : ''
      el.style.transition = x ? 'none' : 'transform 160ms ease-out'
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      Object.assign(s, { x: e.clientX, y: e.clientY, dx: 0, swiping: false, cancelled: false, longFired: false })
      clearTimeout(s.timer)
      s.timer = setTimeout(() => {
        if (s.cancelled || s.swiping) return
        s.longFired = true
        navigator.vibrate?.(15)
        cb.current.onMenu()
      }, 450)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || s.cancelled) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (!s.swiping && (Math.abs(dy) > 10 || dx < -10)) {
        s.cancelled = true
        clearTimeout(s.timer)
        setX(0)
        return
      }
      if (dx > 10 && dx > Math.abs(dy)) {
        s.swiping = true
        clearTimeout(s.timer)
        s.dx = dx
        setX(Math.min(dx, 80))
      }
    }
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      s.touchAt = Date.now()
      clearTimeout(s.timer)
      if (s.swiping) {
        if (s.dx > 56) {
          navigator.vibrate?.(10)
          cb.current.onReply()
        }
        setX(0)
        return
      }
      if (s.cancelled || s.longFired) return
      const now = Date.now()
      if (now - s.lastTap < 300) {
        s.lastTap = 0
        cb.current.onDoubleTap()
      } else s.lastTap = now
    }
    const cancel = () => {
      clearTimeout(s.timer)
      s.cancelled = true
      setX(0)
    }
    const ctx = (e: MouseEvent) => {
      e.preventDefault()
      if (!s.longFired) cb.current.onMenu()
    }
    const dbl = (e: MouseEvent) => {
      // touch double-taps are handled above; some phones also emit dblclick, which must not toggle twice
      if (Date.now() - s.touchAt < 800) return
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      cb.current.onDoubleTap()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('contextmenu', ctx)
    el.addEventListener('dblclick', dbl)
    return () => {
      clearTimeout(s.timer)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('contextmenu', ctx)
      el.removeEventListener('dblclick', dbl)
    }
  }, [enabled])
  return ref
}

/** Message text: links become clickable and (in groups) @mentions are highlighted. */
export function RichText({ text, mentions, mine }: { text: string; mentions: boolean; mine: boolean }) {
  if (!mentions || !text.includes('@')) return <Linkified text={text} />
  return (
    <>
      {text.split(/((?:^|(?<=\s))@[\p{L}\p{N}_.-]+)/u).map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className={clsx('font-semibold', mine ? 'underline decoration-white/40' : 'text-primary')}>{part}</span>
        ) : (
          <Linkified key={i} text={part} />
        ),
      )}
    </>
  )
}

// ------------------------------------------------------------------ voice notes
export function VoicePlayer({ a, mine, pending }: { a: Attachment; mine: boolean; pending?: boolean }) {
  const { data: url, isError } = useMediaUrl(a.path, a.localUrl)
  const src = a.localUrl ?? url
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(a.duration ?? 0)
  const [rate, setRate] = useState(1)

  function toggle() {
    const el = audio.current
    if (!el) return
    if (el.paused) {
      // only one voice note plays at a time
      document.querySelectorAll('audio').forEach((x) => x !== el && x.pause())
      void el.play().catch(() => toast.error('Couldn’t play this voice message.'))
    } else el.pause()
  }
  function cycleRate() {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
    setRate(next)
    if (audio.current) audio.current.playbackRate = next
  }
  const shown = playing || pos > 0 ? pos : dur
  return (
    <div className="flex w-[min(62vw,260px)] items-center gap-2 py-0.5">
      <button type="button" onClick={toggle} disabled={!src || pending} className={clsx('grid size-11 shrink-0 place-items-center rounded-full', mine ? 'bg-white/20' : 'bg-primary-soft text-primary')} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        {!src && !isError ? <Loader2 className="size-5 animate-spin" aria-hidden /> : playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(dur, 0.1)}
        step={0.1}
        value={Math.min(pos, dur || pos)}
        onChange={(e) => {
          const t = Number(e.target.value)
          setPos(t)
          if (audio.current) audio.current.currentTime = t
        }}
        aria-label="Seek"
        className="h-8 min-w-0 flex-1 accent-current"
      />
      <span className="w-9 shrink-0 text-xs tabular-nums">{formatDuration(shown)}</span>
      <button type="button" onClick={cycleRate} className={clsx('min-h-8 shrink-0 rounded-full px-1.5 text-xs font-bold', mine ? 'bg-white/20' : 'bg-surface-2')} aria-label={`Speed ${rate}x`}>
        {rate}×
      </button>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setPos(0)
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ polls
export function PollCard({ m, me, mine, onVote }: { m: Message; me: string | null; mine: boolean; onVote: (options: number[]) => void }) {
  const poll = m.poll
  if (!poll) return null
  const t = pollTally(poll, m.votes, me)
  const total = t.counts.reduce((a, b) => a + b, 0)
  return (
    <div className="w-[min(70vw,300px)] py-0.5">
      <p className="mb-2 font-semibold">📊 {poll.question}</p>
      <p className={clsx('mb-1.5 text-xs', mine ? 'text-on-primary/75' : 'text-muted')}>{poll.multiple ? 'Select one or more' : 'Select one'}</p>
      <ul className="space-y-1.5">
        {poll.options.map((o, i) => {
          const picked = t.mine.includes(i)
          const pct = total ? Math.round((t.counts[i]! / total) * 100) : 0
          return (
            <li key={i}>
              <button
                type="button"
                disabled={m.pending || m.failed}
                onClick={() => onVote(nextSelection(poll, t.mine, i))}
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={picked}
                className={clsx('relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-xl border px-3 text-left', mine ? 'border-white/30' : 'border-border')}
              >
                <span aria-hidden className={clsx('absolute inset-y-0 left-0', mine ? 'bg-white/20' : 'bg-primary-soft')} style={{ width: `${pct}%` }} />
                <span className={clsx('relative grid size-5 shrink-0 place-items-center border-2', poll.multiple ? 'rounded-md' : 'rounded-full', picked ? (mine ? 'border-white bg-white text-primary' : 'border-primary bg-primary text-on-primary') : 'border-current opacity-60')}>
                  {picked && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m2 6 3 3 5-6" /></svg>}
                </span>
                <span className="relative min-w-0 flex-1 break-words">{o}</span>
                <span className="relative text-sm font-semibold tabular-nums">{t.counts[i]}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className={clsx('mt-1.5 text-xs', mine ? 'text-on-primary/75' : 'text-muted')}>{t.voters} {t.voters === 1 ? 'vote' : 'votes'}</p>
    </div>
  )
}
