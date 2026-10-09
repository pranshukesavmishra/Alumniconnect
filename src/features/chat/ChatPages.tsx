import clsx from 'clsx'
import { AlertCircle, ArrowDown, Bell, BellOff, Check, CheckCheck, Clock, Gauge, Megaphone, MessagesSquare, Pin, Search, ShieldAlert, Users, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/layout/AppShell'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Avatar, EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { PushToggle } from '../community/PushToggle'
import { useJoinGroup } from '../community/queries'
import { ChatComposer } from './Composer'
import { FileCard, Lightbox, MessageActionsSheet, PhotoGrid, PollCard, VoicePlayer, ReactionChips, ReactorsSheet, ReplyQuote, replyPreviewOf, RichText, useMessageGestures, type ActionPermissions } from './MessageBits'
import { firstUnreadIndex, isContinuation, previewOf, type Attachment, type Message, type ReplyPreview } from './merge'
import {
  chatKeys,
  discardLocal,
  newLocalId,
  pendingInput,
  useAcceptRequest,
  useChatSearch,
  useDeleteMessage,
  useEditMessage,
  usePinMessage,
  usePinnedMessage,
  useSetSlowMode,
  isNetworkError,
  reportMessage,
  useReact,
  useVote,
  useChat,
  useChats,
  useChatSignals,
  useMarkRead,
  useMessages,
  useSendMessage,
  type ChatSummary,
  type SendInput,
} from './queries'

// ------------------------------------------------------------------ helpers
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

/** WhatsApp-style list stamp: time today, "Yesterday", weekday this week, else date. */
function listStamp(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days <= 0) return timeOf(iso)
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-IN', { weekday: 'short' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' })
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

// Stable per-person name colour in groups (Telegram/WhatsApp style), readable in light and dark.
const NAME_COLOURS = ['text-[#c0392b] dark:text-[#ff8a80]', 'text-[#1f7a3a] dark:text-[#7ddc94]', 'text-[#1d4ed8] dark:text-[#93b4ff]', 'text-[#9a3fb5] dark:text-[#e0a5f5]', 'text-[#b45309] dark:text-[#fbbf6a]', 'text-[#0f766e] dark:text-[#5eead4]']
function nameColour(id: string | null) {
  let h = 0
  for (const ch of id ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NAME_COLOURS[h % NAME_COLOURS.length]
}

function ChatAvatar({ c, size }: { c: Pick<ChatSummary, 'kind' | 'avatar_url' | 'icon' | 'title' | 'group_kind'>; size: number }) {
  if (c.kind === 'dm') return <Avatar src={c.avatar_url} name={c.title} size={size} />
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary-soft text-primary" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {c.icon ?? (c.group_kind === 'channel' ? <Megaphone className="size-1/2" /> : <Users className="size-1/2" />)}
    </span>
  )
}

function VerifiedOnly({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState icon={<ShieldAlert />} title="Chat is for verified members">
        You’ll be verified once your Alumni Meet payment is confirmed, or when two verified JECians vouch for you.
      </EmptyState>
    </div>
  )
}

// ------------------------------------------------------------------ list
type Filter = 'all' | 'unread' | 'groups' | 'direct'

function ChatRow({ c, uid }: { c: ChatSummary; uid: string | null }) {
  const unread = c.unread > 0
  const mine = c.last_sender === uid
  const seen = mine && c.kind === 'dm' && !!c.other_last_read_at && !!c.last_message_at && c.other_last_read_at >= c.last_message_at
  const who = c.last_message && c.kind === 'group' && c.last_sender_name ? `${mine ? 'You' : c.last_sender_name}: ` : ''
  return (
    <li>
      <Link to={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 active:bg-surface-2">
        <ChatAvatar c={c} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={clsx('truncate text-[16px]', unread ? 'font-bold' : 'font-semibold')}>{c.title}</p>
            <p className={clsx('shrink-0 text-xs', unread && !c.muted ? 'font-semibold text-primary' : 'text-muted')}>{listStamp(c.last_message_at)}</p>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {mine && c.kind === 'dm' && (seen ? <CheckCheck className="size-4 shrink-0 text-primary" aria-label="Seen" /> : <Check className="size-4 shrink-0 text-muted" aria-label="Sent" />)}
            <p className={clsx('min-w-0 flex-1 truncate text-sm', unread ? 'font-medium text-text' : 'text-muted')}>
              {c.last_message ? `${who}${c.last_message}` : c.kind === 'group' ? 'Say hello to the group 👋' : 'No messages yet'}
            </p>
            {c.muted && <BellOff className="size-4 shrink-0 text-muted" aria-label="Muted" />}
            {unread && (
              <span className={clsx('min-w-5.5 shrink-0 rounded-full px-1.5 text-center text-xs font-bold leading-5.5 text-white', c.muted ? 'bg-muted' : 'bg-primary')} aria-label={`${c.unread} unread`}>
                {c.unread >= 100 ? '99+' : c.unread}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}

export function ChatListPage() {
  const uid = useUserId()
  const { data: me, isLoading: meLoading } = useMyProfile()
  const { data, isLoading, error, refetch } = useChats()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [showRequests, setShowRequests] = useState(false)

  if (meLoading) return <PageSkeleton />
  if (me?.verification !== 'verified' && !me?.is_admin) return <VerifiedOnly title="Chat" />

  const all = data ?? []
  const requests = all.filter((c) => c.kind === 'dm' && c.is_request && c.started_by !== uid)
  const term = q.trim().toLowerCase()
  const main = all
    .filter((c) => !(c.kind === 'dm' && c.is_request && c.started_by !== uid))
    .filter((c) => (filter === 'unread' ? c.unread > 0 : filter === 'groups' ? c.kind === 'group' : filter === 'direct' ? c.kind === 'dm' : true))
    .filter((c) => !term || c.title.toLowerCase().includes(term) || (c.last_message ?? '').toLowerCase().includes(term))
  const counts = { unread: all.filter((c) => c.unread > 0).length }
  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: counts.unread ? `Unread · ${counts.unread}` : 'Unread' },
    { key: 'groups', label: 'Groups' },
    { key: 'direct', label: 'Direct' },
  ]

  return (
    <div>
      <PageHeader title="Chat" />
      <div className="mx-auto w-full max-w-3xl">
        <div className="space-y-3 px-4 pt-3">
          <label className="relative block">
            <span className="sr-only">Search chats</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats"
              className="min-h-12 w-full rounded-full border border-border bg-surface pl-12 pr-4 text-[16px] focus:border-primary focus:outline-none"
            />
          </label>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter chats">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={clsx('min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold', filter === c.key ? 'bg-primary text-on-primary' : 'border border-border bg-surface text-text')}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 pt-3 empty:hidden">
          <PushToggle onlyWhenOff />
        </div>
        {error && (
          <div className="px-4 pt-3">
            <Notice tone="danger" title="Couldn’t load your chats">
              {friendlyError(error)}{' '}
              <button type="button" className="font-semibold text-primary underline" onClick={() => void refetch()}>Try again</button>
            </Notice>
          </div>
        )}

        {requests.length > 0 && (
          <div className="px-4 pt-3">
            <button type="button" onClick={() => setShowRequests((s) => !s)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-primary-soft px-4 text-left font-semibold text-primary" aria-expanded={showRequests}>
              <MessagesSquare className="size-5" aria-hidden />
              <span className="flex-1">Message requests</span>
              <span className="rounded-full bg-primary px-2 text-xs font-bold leading-5.5 text-on-primary">{requests.length}</span>
            </button>
            {showRequests && <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{requests.map((c) => <ChatRow key={c.id} c={c} uid={uid} />)}</ul>}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-13 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : main.length ? (
          <ul className="mt-2 divide-y divide-border">{main.map((c) => <ChatRow key={c.id} c={c} uid={uid} />)}</ul>
        ) : term || filter !== 'all' ? (
          <p className="p-8 text-center text-muted">No chats match.</p>
        ) : (
          <EmptyState icon={<MessagesSquare />} title="No chats yet" action={<Link to="/people" className="font-semibold text-primary">Find a batchmate to message</Link>}>
            Your batch and circle group chats appear here. Open anyone’s profile and tap Message to start a direct chat.
          </EmptyState>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ thread
const EDIT_WINDOW_MS = 15 * 60_000

function TickStatus({ m, seen }: { m: Message; seen: boolean }) {
  if (m.pending) return <Clock className="size-3.5" aria-label="Sending" />
  if (seen) return <CheckCheck className="size-4 text-accent" aria-label="Seen" />
  return <Check className="size-4" aria-label="Sent" />
}

interface BubbleProps {
  m: Message
  me: string | null
  mine: boolean
  showName: boolean
  isGroup: boolean
  seen: boolean
  interactive: boolean
  quote: ReplyPreview | null
  onMenu: () => void
  onReply: () => void
  onHeart: () => void
  onPhotos: (items: Attachment[], start: number) => void
  onVote: (options: number[]) => void
  onReactions: () => void
  onQuote: (id: string) => void
  onRetry: () => void
  onDiscard: () => void
}

function Bubble({ m, me, mine, showName, isGroup, seen, interactive, quote, onMenu, onReply, onHeart, onPhotos, onVote, onReactions, onQuote, onRetry, onDiscard }: BubbleProps) {
  const gestures = useMessageGestures({ onReply, onMenu, onDoubleTap: onHeart, enabled: interactive })
  if (m.kind === 'system') {
    return <p className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-surface-2 px-3 py-1 text-center text-xs text-muted">{m.body}</p>
  }
  const deleted = !!m.deleted_at
  return (
    <div className={clsx('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
      {isGroup && !mine && (
        <span className="w-8 shrink-0 self-start">
          {showName && (
            <Link to={m.sender_id ? `/people/${m.sender_id}` : '#'} aria-label={m.sender?.full_name ?? 'Member'}>
              <Avatar src={m.sender?.avatar_url} name={m.sender?.full_name ?? '?'} size={32} />
            </Link>
          )}
        </span>
      )}
      {mine && interactive && <MenuButton onClick={onMenu} />}
      <div className={clsx('flex max-w-[80%] flex-col', mine ? 'items-end' : 'items-start')}>
        <div ref={gestures} style={{ touchAction: 'pan-y' }} className="[-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none">
          <div
            className={clsx(
              'min-w-16 whitespace-pre-line break-words rounded-2xl px-3 py-1.5 text-[16px] leading-snug shadow-sm [overflow-wrap:anywhere]',
              mine ? 'bg-primary text-on-primary [&_a]:text-on-primary' : 'bg-surface text-text',
              mine ? (showName ? 'rounded-tr-md' : '') : showName ? 'rounded-tl-md' : '',
              m.failed && 'ring-2 ring-danger',
            )}
          >
            {isGroup && !mine && showName && <p className={clsx('mb-0.5 text-[13px] font-semibold', nameColour(m.sender_id))}>{m.sender?.full_name ?? 'Former member'}</p>}
            {quote && !deleted && <ReplyQuote r={quote} mine={mine} me={me} onClick={() => onQuote(quote.id)} />}
            {deleted ? (
              <p className={clsx('italic', mine ? 'text-on-primary/80' : 'text-muted')}>🚫 This message was deleted</p>
            ) : (
              <>
                {m.kind === 'image' && <PhotoGrid items={m.attachments} pending={m.pending} onOpen={(i) => onPhotos(m.attachments, i)} />}
                {m.kind === 'voice' && m.attachments[0] && <VoicePlayer a={m.attachments[0]} mine={mine} pending={m.pending} />}
                {m.kind === 'poll' && <PollCard m={m} me={me} mine={mine} onVote={onVote} />}
                {m.kind === 'file' && m.attachments[0] && <FileCard a={m.attachments[0]} mine={mine} pending={m.pending} />}
                {m.kind === 'text' || m.kind === 'image' || m.kind === 'file' ? m.body && <RichText text={m.body} mentions={isGroup} mine={mine} /> : null}
              </>
            )}
            <p className={clsx('-mb-0.5 mt-0.5 flex items-center justify-end gap-1 text-[11px]', mine ? 'text-on-primary/75' : 'text-muted')}>
              {m.edited_at && !deleted && <span>edited ·</span>}
              <span>{timeOf(m.created_at)}</span>
              {mine && !m.failed && <TickStatus m={m} seen={seen} />}
            </p>
          </div>
        </div>
        {!deleted && <ReactionChips list={m.reactions} me={me} mine={mine} onOpen={onReactions} />}
        {m.failed && (
          <div className="mt-1 flex items-center gap-1 text-sm">
            <AlertCircle className="size-4 text-danger" aria-hidden />
            <span className="text-danger">Not sent.</span>
            <button type="button" onClick={onRetry} className="min-h-11 rounded-full px-2 font-semibold text-primary">Retry</button>
            <button type="button" onClick={onDiscard} className="min-h-11 rounded-full px-2 font-semibold text-muted">Delete</button>
          </div>
        )}
      </div>
      {!mine && interactive && <MenuButton onClick={onMenu} />}
    </div>
  )
}

/** Desktop hover button for message options (phones use long-press). */
function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden size-9 shrink-0 place-items-center self-center rounded-full text-muted opacity-0 hover:bg-surface-2 focus:opacity-100 group-hover:opacity-100 [@media(pointer:fine)]:grid"
      aria-label="Message options"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
  )
}

function TypingLine({ names }: { names: string[] }) {
  if (!names.length) return null
  const who = names.length === 1 ? `${names[0]} is` : names.length === 2 ? `${names[0]} and ${names[1]} are` : `${names.length} people are`
  return <span className="text-primary">{who} typing…</span>
}

export function ChatThreadPage() {
  const { id = '' } = useParams()
  const uid = useUserId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: me, isLoading: meLoading } = useMyProfile()
  const { data: chat, isLoading: chatLoading } = useChat(id)
  const { data: win, isLoading, error, loadOlder, loadingOlder } = useMessages(id)
  const send = useSendMessage(id)
  const react = useReact(id)
  const vote = useVote(id)
  const edit = useEditMessage(id)
  const del = useDeleteMessage(id)
  const accept = useAcceptRequest(id)
  const pin = usePinMessage(id)
  const pinned = usePinnedMessage(id, chat?.pinned_message ?? null)
  const join = useJoinGroup()
  const signals = useChatSignals(id)
  const markRead = useMarkRead(id, signals.sentRead)

  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0)
  const [actionFor, setActionFor] = useState<string | null>(null)
  const [reactorsFor, setReactorsFor] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [searching, setSearching] = useState(false)
  const [slowOpen, setSlowOpen] = useState(false)
  const [reportFor, setReportFor] = useState<string | null>(null)
  const setSlow = useSetSlowMode(id)
  const [viewer, setViewer] = useState<{ items: Attachment[]; start: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const items = useMemo(() => win?.items ?? [], [win])
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items])

  // "Unread messages" divider: frozen at the read position when the chat was opened.
  const [openedReadAt, setOpenedReadAt] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (chat && openedReadAt === undefined) setOpenedReadAt(chat.last_read_at)
  }, [chat, openedReadAt])
  const unreadIdx = openedReadAt === undefined ? -1 : firstUnreadIndex(items, openedReadAt, uid)
  const unreadRef = useRef<HTMLLIElement>(null)

  // Initial position: first unread message if any, else the bottom.
  const positioned = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (positioned.current || !el || !items.length || openedReadAt === undefined) return
    positioned.current = true
    if (unreadIdx > 0 && unreadRef.current) unreadRef.current.scrollIntoView({ block: 'start' })
    else el.scrollTop = el.scrollHeight
  }, [items.length, openedReadAt, unreadIdx])

  // Keep the reading position when older messages are prepended.
  const firstId = items[0]?.id
  const heightBefore = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && heightBefore.current !== null) {
      el.scrollTop += el.scrollHeight - heightBefore.current
      heightBefore.current = null
    }
  }, [firstId])

  // New message at the bottom: follow it if the reader is at the bottom or it is mine, else show "↓ new".
  const lastId = items[items.length - 1]?.id
  const prevLast = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !positioned.current) {
      prevLast.current = lastId
      return
    }
    if (lastId && prevLast.current && lastId !== prevLast.current) {
      const last = items[items.length - 1]
      if (atBottom || last?.sender_id === uid) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      else setNewBelow((n) => n + 1)
    }
    prevLast.current = lastId
  }, [lastId, items, atBottom, uid])

  // Load older when the top comes into view.
  useEffect(() => {
    const el = topSentinel.current
    if (!el || !win?.hasOlder) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && positioned.current && scroller.current) {
          heightBefore.current = scroller.current.scrollHeight
          void loadOlder()
        }
      },
      { root: scroller.current, rootMargin: '200px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [win?.hasOlder, loadOlder])

  // Read receipts: mark read while the chat is open, visible and the newest message is in view.
  const newestFromOthers = useMemo(() => [...items].reverse().find((m) => !m.pending && !m.failed && m.sender_id !== uid)?.created_at, [items, uid])
  useEffect(() => {
    if (!chat || !newestFromOthers) return
    if (chat.last_read_at && chat.last_read_at >= newestFromOthers && chat.unread === 0) return
    const go = () => {
      if (document.visibilityState === 'visible' && atBottom) void markRead().then(() => qc.invalidateQueries({ queryKey: chatKeys.one(id) }))
    }
    const t = setTimeout(go, 400)
    document.addEventListener('visibilitychange', go)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', go)
    }
  }, [chat, newestFromOthers, atBottom, markRead, qc, id])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setAtBottom(bottom)
    if (bottom) setNewBelow(0)
  }, [])

  // Jump to a quoted message, loading earlier pages if needed, and flash it.
  const jumpTo = useCallback(
    async (target: string) => {
      for (let i = 0; i < 20; i++) {
        const el = document.getElementById(`msg-${target}`)
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el.animate([{ background: 'var(--primary-soft)' }, { background: 'transparent' }], { duration: 1600, easing: 'ease-out' })
          return
        }
        if (!qc.getQueryData<{ hasOlder: boolean }>(chatKeys.messages(id))?.hasOlder) break
        await loadOlder()
        await new Promise((r) => requestAnimationFrame(r))
      }
      toast('That message is no longer available.')
    },
    [id, loadOlder, qc],
  )

  function doSend(input: SendInput, localId = newLocalId()) {
    send.mutate(
      { ...input, localId },
      {
        // no connection: the message waits (and is sent automatically when we're back online); other errors are shown
        onError: (err) => (isNetworkError(err) ? toast('No connection. Your message will send when you’re back online.') : toast.error(friendlyError(err))),
      },
    )
    signals.sentMessage()
  }

  // back online: send whatever was waiting
  const waiting = useRef<Message[]>([])
  useEffect(() => {
    waiting.current = items.filter((m) => m.failed && pendingInput(m.id))
  }, [items])
  useEffect(() => {
    const retry = () => waiting.current.forEach((m) => {
      const input = pendingInput(m.id)
      if (input) doSend(input, m.id)
    })
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doSend only uses stable mutation refs
  }, [])

  async function saveEdit(messageId: string, body: string) {
    try {
      await edit.mutateAsync({ id: messageId, body })
      return true
    } catch (e) {
      toast.error(friendlyError(e))
      return false
    }
  }

  async function block() {
    if (!chat?.other_id || !window.confirm(`Block ${chat.title}? They won’t be able to message you, and you won’t see each other’s posts.`)) return
    const { error: err } = await supabase.from('blocks').insert({ blocker: uid, blocked: chat.other_id })
    if (err && err.code !== '23505') return toast.error(friendlyError(err))
    toast.success('Blocked')
    void qc.invalidateQueries({ queryKey: ['chats'] })
    navigate('/chat')
  }

  async function toggleMute() {
    if (!chat) return
    const { error: err } = await supabase.rpc('set_chat_muted', { p_chat: chat.id, p_muted: !chat.muted })
    if (err) return toast.error(friendlyError(err))
    toast.success(chat.muted ? 'Notifications on' : 'Muted. You won’t get notifications from this chat.')
    await Promise.all([qc.invalidateQueries({ queryKey: chatKeys.one(id) }), qc.invalidateQueries({ queryKey: ['chats'] })])
  }

  function permsFor(m: Message | undefined): ActionPermissions {
    const none = { canReact: false, canReply: false, canEdit: false, canDelete: false, adminDelete: false, canPin: false, canReport: false }
    if (!m || !chat || m.pending || m.failed || m.kind === 'system') return none
    const deleted = !!m.deleted_at
    const mine = m.sender_id === uid
    const blockedRequest = chat.kind === 'dm' && chat.is_request && chat.started_by !== uid
    return {
      canReact: !deleted && !blockedRequest,
      canReply: !deleted && chat.can_post && !blockedRequest,
      canEdit: mine && !deleted && ['text', 'image', 'file'].includes(m.kind) && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS - 30_000,
      canDelete: !deleted && (mine || (chat.kind === 'group' && chat.is_group_admin)),
      adminDelete: !mine,
      canPin: !deleted && (chat.kind === 'dm' || chat.is_group_admin) && !blockedRequest,
      canReport: !deleted && !mine,
    }
  }

  function heart(m: Message) {
    if (!permsFor(m).canReact) return
    const mineNow = m.reactions?.find((r) => r.user_id === uid)?.emoji
    react.mutate({ id: m.id, emoji: mineNow === '❤️' ? null : '❤️' }, { onError: (e) => toast.error(friendlyError(e)) })
  }

  if (meLoading) return <PageSkeleton />
  if (me?.verification !== 'verified' && !me?.is_admin) return <VerifiedOnly title="Chat" />
  if (!chatLoading && !chat) {
    return (
      <div>
        <PageHeader title="Chat" back="/chat" />
        <EmptyState icon={<MessagesSquare />} title="Chat not found">It may have been removed, or you’re not a member of this group.</EmptyState>
      </div>
    )
  }

  const isGroup = chat?.kind === 'group'
  const incomingRequest = chat?.kind === 'dm' && chat.is_request && chat.started_by !== uid
  const lastMineIdx = (() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i]?.sender_id === uid && !items[i]?.pending && !items[i]?.failed) return i
    return -1
  })()
  const titleLink = chat ? (chat.kind === 'dm' ? `/people/${chat.other_id}` : `/groups/${chat.group_slug}`) : '#'
  const slow = chat?.kind === 'group' && !chat.is_group_admin ? chat.slow_mode_seconds : 0
  const lastOwn = [...items].reverse().find((m) => m.sender_id === uid && !m.failed)
  const cooldownUntil = slow > 0 && lastOwn ? new Date(lastOwn.created_at).getTime() + slow * 1000 : 0
  const actionMsg = actionFor ? (byId.get(actionFor) ?? null) : null
  const reactorsMsg = reactorsFor ? (byId.get(reactorsFor) ?? null) : null

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 pt-safe backdrop-blur">
        <div className="mx-auto flex min-h-15 max-w-3xl items-center gap-2 px-2">
          <Link to="/chat" className="grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label="Back to chats">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          {chat ? (
            <Link to={titleLink} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 pr-2 hover:bg-surface-2">
              <ChatAvatar c={chat} size={40} />
              <span className="min-w-0">
                <span className="block truncate font-bold leading-tight">{chat.title}</span>
                <span className="block truncate text-sm text-muted">{signals.typingNames.length ? <TypingLine names={signals.typingNames} /> : chat.kind === 'dm' && chat.other_id && signals.online.includes(chat.other_id) ? <span className="text-success">● online</span> : chat.subtitle}</span>
              </span>
            </Link>
          ) : (
            <div className="flex flex-1 items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          )}
          {chat?.kind === 'group' && chat.is_group_admin && chat.group_kind !== 'channel' && (
            <button type="button" onClick={() => setSlowOpen(true)} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Slow mode" title="Slow mode">
              <Gauge className={clsx('size-5', chat.slow_mode_seconds > 0 && 'text-primary')} />
            </button>
          )}
          {chat && (
            <button type="button" onClick={() => setSearching((x) => !x)} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Search in chat" aria-expanded={searching}>
              <Search className="size-5" />
            </button>
          )}
          {chat && (chat.joined || chat.kind === 'dm') && (
            <button type="button" onClick={toggleMute} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={chat.muted ? 'Unmute chat' : 'Mute chat'} title={chat.muted ? 'Unmute' : 'Mute'}>
              {chat.muted ? <BellOff className="size-5" /> : <Bell className="size-5" />}
            </button>
          )}
        </div>
      </header>

      {searching && <ChatSearch chatId={id} onClose={() => setSearching(false)} onPick={(mid) => { setSearching(false); void jumpTo(mid) }} />}
      {!searching && chat?.pinned_message && pinned.data && !pinned.data.deleted_at && (
        <button type="button" onClick={() => void jumpTo(pinned.data!.id)} className="flex min-h-12 w-full items-center gap-3 border-b border-border bg-surface px-4 text-left" aria-label="Go to pinned message">
          <Pin className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-primary">Pinned</span>
            <span className="block truncate text-sm">{previewOf(pinned.data)}</span>
          </span>
        </button>
      )}
      <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          {error && <Notice tone="danger" title={friendlyError(error)} />}
          <div ref={topSentinel} />
          {loadingOlder && <p className="py-2 text-center text-sm text-muted">Loading earlier messages…</p>}
          {win && !win.hasOlder && items.length > 0 && (
            <p className="mx-auto mb-3 w-fit max-w-[90%] rounded-xl bg-surface-2 px-3 py-1.5 text-center text-xs text-muted">
              {isGroup ? 'This is the start of the group chat. Everyone who joins can read the full history.' : 'This is the start of your conversation.'}
            </p>
          )}
          {isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-10 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
              <Skeleton className="h-14 w-3/5 rounded-2xl" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted">
              <p className="text-4xl" aria-hidden>👋</p>
              <p className="mt-2">{isGroup ? 'No messages yet. Start the conversation!' : 'Say hello!'}</p>
            </div>
          ) : (
            <ul className="space-y-0.5" aria-label="Messages">
              {items.map((m, i) => {
                const prev = items[i - 1]
                const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
                const cont = !newDay && i !== unreadIdx && isContinuation(prev, m) && !m.reply_to
                const mine = m.sender_id === uid
                const seen = chat?.kind === 'dm' && !!chat.other_last_read_at && chat.other_last_read_at >= m.created_at
                const target = m.reply_to ? byId.get(m.reply_to) : undefined
                const quote = m.reply_to ? (target ? replyPreviewOf(target) : (m.reply ?? null)) : null
                const interactive = !m.pending && !m.failed && !m.deleted_at && m.kind !== 'system'
                return (
                  <li key={m.id} id={`msg-${m.id}`} ref={i === unreadIdx ? unreadRef : undefined} className={clsx('rounded-xl', !cont && 'pt-2', (m.reactions?.length ?? 0) > 0 && 'pb-1')}>
                    {newDay && <p className="sticky top-1 z-10 mx-auto my-2 w-fit rounded-full bg-surface-2/95 px-3 py-1 text-xs font-semibold text-muted shadow-sm">{dayLabel(m.created_at)}</p>}
                    {i === unreadIdx && <p className="my-2 rounded-full bg-primary-soft py-1 text-center text-xs font-bold text-primary">Unread messages</p>}
                    <Bubble
                      m={m}
                      me={uid}
                      mine={mine}
                      showName={!cont}
                      isGroup={!!isGroup}
                      seen={seen}
                      interactive={interactive}
                      quote={quote}
                      onMenu={() => setActionFor(m.id)}
                      onReply={() => permsFor(m).canReply && setReplyTo(replyPreviewOf(m))}
                      onHeart={() => heart(m)}
                      onPhotos={(list, start) => setViewer({ items: list, start })}
                      onVote={(options) => vote.mutate({ id: m.id, options }, { onError: (e) => toast.error(friendlyError(e)) })}
                      onReactions={() => setReactorsFor(m.id)}
                      onQuote={(qid) => void jumpTo(qid)}
                      onRetry={() => {
                        const input = pendingInput(m.id)
                        if (input) doSend(input, m.id)
                        else doSend({ body: m.body ?? '' }, m.id)
                      }}
                      onDiscard={() => discardLocal(qc, id, m.id)}
                    />
                    {mine && i === lastMineIdx && chat?.kind === 'dm' && seen && <p className="mt-0.5 pr-1 text-right text-[11px] text-muted">Seen</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
            className="sticky bottom-3 left-full z-10 mr-3 grid size-11 place-items-center rounded-full border border-border bg-surface text-primary shadow-md"
            aria-label={newBelow ? `${newBelow} new messages, jump to latest` : 'Jump to latest'}
          >
            <ArrowDown className="size-5" />
            {newBelow > 0 && <span className="absolute -top-2 right-0 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] font-bold leading-5 text-on-primary">{newBelow}</span>}
          </button>
        )}
      </div>

      <div className="border-t border-border bg-bg pb-safe">
        <div className="mx-auto w-full max-w-3xl px-3 py-2">
          {incomingRequest ? (
            <div className="space-y-2 py-1">
              <p className="text-center text-sm text-muted">
                <strong className="text-text">{chat?.title}</strong> wants to message you. They won’t know you’ve seen this until you accept.
              </p>
              <div className="flex gap-2">
                <Button variant="danger-ghost" block onClick={block}>Block</Button>
                <Button block loading={accept.isPending} onClick={() => accept.mutate(undefined, { onError: (e) => toast.error(friendlyError(e)) })}>Accept</Button>
              </div>
            </div>
          ) : chat && !chat.can_post ? (
            isGroup && !chat.joined && chat.group_kind !== 'batch' && chat.group_kind !== 'year' ? (
              <Button
                block
                loading={join.isPending}
                onClick={() =>
                  join.mutate({ id: chat.group_id!, join: true }, { onSuccess: () => void qc.invalidateQueries({ queryKey: chatKeys.one(id) }), onError: (e) => toast.error(friendlyError(e)) })
                }
              >
                {chat.group_kind === 'channel' ? 'Follow this channel' : 'Join to chat'}
              </Button>
            ) : (
              <p className="flex min-h-12 items-center justify-center gap-2 text-center text-sm text-muted">
                {chat.group_kind === 'channel' ? (
                  <>
                    <Megaphone className="size-4" aria-hidden /> Only admins can post in this channel
                  </>
                ) : (
                  'You can’t send messages in this chat.'
                )}
              </p>
            )
          ) : (
            <ChatComposer
              chatId={id}
              isGroup={!!isGroup}
              me={uid}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              onSend={(input) => doSend(input)}
              onEdit={saveEdit}
              onTyping={signals.sendTyping}
              slowSeconds={slow}
              cooldownUntil={cooldownUntil}
            />
          )}
        </div>
      </div>

      <MessageActionsSheet
        m={actionMsg}
        perms={permsFor(actionMsg ?? undefined)}
        me={uid}
        onReport={() => {
          setReportFor(actionMsg?.id ?? null)
          setActionFor(null)
        }}
        pinned={!!actionMsg && chat?.pinned_message === actionMsg.id}
        onPin={() => {
          if (actionMsg) pin.mutate(chat?.pinned_message === actionMsg.id ? null : actionMsg.id, { onError: (e) => toast.error(friendlyError(e)) })
          setActionFor(null)
        }}
        onClose={() => setActionFor(null)}
        onReact={(emoji) => {
          if (actionMsg) react.mutate({ id: actionMsg.id, emoji }, { onError: (e) => toast.error(friendlyError(e)) })
          setActionFor(null)
        }}
        onReply={() => {
          if (actionMsg) setReplyTo(replyPreviewOf(actionMsg))
          setActionFor(null)
        }}
        onEdit={() => {
          setEditing(actionMsg)
          setReplyTo(null)
          setActionFor(null)
        }}
        onDelete={() => {
          const m = actionMsg
          setActionFor(null)
          if (!m) return
          const admin = m.sender_id !== uid
          if (!window.confirm(admin ? 'Remove this message for everyone in the group?' : 'Delete this message for everyone?')) return
          del.mutate(m, { onSuccess: () => toast.success('Message deleted'), onError: (e) => toast.error(friendlyError(e)) })
        }}
      />
      <ReactorsSheet
        m={reactorsMsg}
        me={uid}
        onClose={() => setReactorsFor(null)}
        onRemoveMine={() => {
          if (reactorsMsg) react.mutate({ id: reactorsMsg.id, emoji: null }, { onError: (e) => toast.error(friendlyError(e)) })
          setReactorsFor(null)
        }}
      />
      <SlowModeSheet open={slowOpen} current={chat?.slow_mode_seconds ?? 0} busy={setSlow.isPending} onClose={() => setSlowOpen(false)} onPick={(seconds) => chat?.group_id && setSlow.mutate({ groupId: chat.group_id, seconds }, { onSuccess: () => { setSlowOpen(false); toast.success(seconds ? 'Slow mode on' : 'Slow mode off') }, onError: (e) => toast.error(friendlyError(e)) })} />
      <ReportSheet messageId={reportFor} onClose={() => setReportFor(null)} />
      {viewer && <Lightbox items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} />}
    </div>
  )
}

/** Search bar + results for one chat. Debounced; tapping a result jumps to the message. */
function ChatSearch({ chatId, onClose, onPick }: { chatId: string; onClose: () => void; onPick: (messageId: string) => void }) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(text), 300)
    return () => clearTimeout(t)
  }, [text])
  const { data, isFetching } = useChatSearch(chatId, term)
  const typed = text.trim().length >= 2
  return (
    <div className="border-b border-border bg-bg">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
        <input
          autoFocus
          type="search"
          aria-label="Search in this chat"
          placeholder="Search in this chat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          className="min-h-11 flex-1 rounded-full border border-border bg-surface px-4 text-[16px] focus:border-primary focus:outline-none"
        />
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Close search">
          <X className="size-5" />
        </button>
      </div>
      {typed && (
        <ul className="mx-auto max-h-[45dvh] max-w-3xl divide-y divide-border overflow-y-auto" aria-label="Search results">
          {data?.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h.id)} className="block min-h-14 w-full px-4 py-2 text-left hover:bg-surface-2">
                <span className="flex justify-between gap-2 text-xs text-muted">
                  <span className="truncate font-semibold">{h.sender_name ?? 'Member'}</span>
                  <span className="shrink-0">{listStamp(h.created_at)}</span>
                </span>
                <span className="line-clamp-2 break-words text-[15px]">{h.body}</span>
              </button>
            </li>
          ))}
          {!isFetching && term.trim().length >= 2 && !data?.length && <li className="p-4 text-center text-sm text-muted">No messages found.</li>}
        </ul>
      )}
    </div>
  )
}

const SLOW_OPTIONS = [
  { seconds: 0, label: 'Off' },
  { seconds: 10, label: '10 seconds' },
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
]

/** Group admins: limit how often each member can send (admins are exempt). */
function SlowModeSheet({ open, current, busy, onClose, onPick }: { open: boolean; current: number; busy: boolean; onClose: () => void; onPick: (seconds: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} label="Slow mode">
      <h2 className="px-5 pb-1 pt-1 text-lg font-bold">Slow mode</h2>
      <p className="px-5 pb-2 text-sm text-muted">Members can send one message per interval. Admins aren’t limited.</p>
      {SLOW_OPTIONS.map((o) => (
        <SheetAction key={o.seconds} disabled={busy} icon={current === o.seconds ? <Check className="size-5 text-primary" /> : undefined} onClick={() => onPick(o.seconds)}>
          <span className={current === o.seconds ? 'font-bold text-primary' : ''}>{o.label}</span>
        </SheetAction>
      ))}
    </Sheet>
  )
}

const REPORT_REASONS = ['Spam or scam', 'Harassment or hate', 'Inappropriate content', 'Something else']

function ReportSheet({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  async function send(reason: string) {
    if (!messageId) return
    setBusy(true)
    try {
      await reportMessage(messageId, reason)
      toast.success('Thanks. Our moderators will review this message.')
      onClose()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={!!messageId} onClose={onClose} label="Report message">
      <h2 className="px-5 pb-1 pt-1 text-lg font-bold">Report this message</h2>
      <p className="px-5 pb-2 text-sm text-muted">Only moderators see your report. The sender isn’t told.</p>
      {REPORT_REASONS.map((r) => (
        <SheetAction key={r} disabled={busy} onClick={() => void send(r)}>{r}</SheetAction>
      ))}
    </Sheet>
  )
}
