// Pure helpers for the message list kept in the query cache. Kept separate so they can be unit-tested:
// ordering, de-duplication and optimistic (pending/failed) messages are where chat apps usually break.

export type MessageKind = 'text' | 'image' | 'file' | 'voice' | 'poll' | 'system'

export interface Attachment {
  path: string
  /** small version of a photo */
  thumb?: string
  /** client-only: preview of a file that is still uploading */
  localUrl?: string
  name?: string
  mime?: string
  size?: number
  width?: number
  height?: number
  duration?: number
}

export interface Poll {
  question: string
  options: string[]
  multiple?: boolean
}

export interface Sender {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface Vote {
  user_id: string
  option_index: number
}

export interface Reaction {
  user_id: string
  emoji: string
  user?: { full_name: string; avatar_url: string | null } | null
}

/** The message a reply points to (embedded by the server; may be missing for live rows). */
export interface ReplyPreview {
  id: string
  sender_id: string | null
  kind: MessageKind
  body: string | null
  attachments: Attachment[]
  poll: Poll | null
  deleted_at: string | null
  sender?: { full_name: string } | null
}

export interface Message {
  id: string
  chat_id: string
  sender_id: string | null
  kind: MessageKind
  body: string | null
  attachments: Attachment[]
  reply_to: string | null
  poll: Poll | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  sender?: Sender | null
  reactions?: Reaction[]
  votes?: Vote[]
  reply?: ReplyPreview | null
  /** client-only: optimistic message waiting for the server */
  pending?: boolean
  /** client-only: the send failed; the user can retry or discard */
  failed?: boolean
}

export interface MessageWindow {
  items: Message[]
  /** true when older messages exist on the server that are not loaded yet */
  hasOlder: boolean
}

export const PAGE_SIZE = 50

const isLocal = (m: Message) => !!(m.pending || m.failed)

function byTime(a: Message, b: Message): number {
  // local (unsent) messages always sit at the bottom, in the order they were written
  if (isLocal(a) !== isLocal(b)) return isLocal(a) ? 1 : -1
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Merge server messages into the window. Server copies replace cached copies with the same id (edits,
 * deletions) and keep a known sender if the incoming row has none (realtime rows carry no join).
 * When `me` is given, each incoming message of mine also retires the oldest matching optimistic copy,
 * so a message never shows twice when the live update arrives before the send call returns.
 */
export function mergeMessages(current: Message[], incoming: Message[], me?: string | null): Message[] {
  const map = new Map<string, Message>()
  for (const m of current) map.set(m.id, m)
  const senders = new Map<string, Sender>()
  for (const m of current) if (m.sender && m.sender_id) senders.set(m.sender_id, m.sender)
  for (const m of incoming) {
    const prev = map.get(m.id)
    if (!prev && me && m.sender_id === me) {
      const local = [...map.values()].find((x) => x.pending && x.kind === m.kind && (x.body ?? '') === (m.body ?? ''))
      if (local) map.delete(local.id)
    }
    const sender = m.sender ?? prev?.sender ?? (m.sender_id ? senders.get(m.sender_id) : undefined) ?? null
    // live rows carry no joins: keep what we already know
    const reactions = m.reactions ?? prev?.reactions ?? []
    const votes = m.deleted_at ? [] : (m.votes ?? prev?.votes ?? [])
    const reply = m.reply !== undefined ? m.reply : (prev?.reply ?? null)
    map.set(m.id, { ...m, sender, reactions: m.deleted_at ? [] : reactions, votes, reply, pending: false, failed: false })
  }
  return [...map.values()].sort(byTime)
}

/** Drop one optimistic message (after it was confirmed or discarded). */
export function removeLocal(items: Message[], localId: string): Message[] {
  return items.filter((m) => m.id !== localId)
}

/** True when the realtime/poll row has a sender we don't know yet (so we should refetch to get the name). */
export function hasUnknownSender(items: Message[], m: Message): boolean {
  return !!m.sender_id && !m.sender && !items.some((x) => x.sender_id === m.sender_id && x.sender)
}

/** Preview line for a message (chat list, reply quote, notifications). */
export function previewOf(m: Pick<Message, 'kind' | 'body' | 'attachments' | 'poll' | 'deleted_at'>): string {
  if (m.deleted_at) return 'This message was deleted'
  switch (m.kind) {
    case 'image':
      return m.body ? `📷 ${m.body}` : '📷 Photo'
    case 'file':
      return `📄 ${m.attachments[0]?.name ?? 'File'}`
    case 'voice':
      return '🎤 Voice message'
    case 'poll':
      return `📊 ${m.poll?.question ?? 'Poll'}`
    default:
      return m.body ?? ''
  }
}

/** Index of the first unread message from someone else, given my last-read time when the chat was opened. */
export function firstUnreadIndex(items: Message[], lastReadAt: string | null, me: string | null): number {
  if (!lastReadAt) return -1
  return items.findIndex((m) => !isLocal(m) && m.sender_id !== me && m.created_at > lastReadAt && !m.deleted_at)
}

/** Whether two consecutive messages should be visually grouped (same sender, within 5 minutes, same day). */
export function isContinuation(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.kind === 'system' || m.kind === 'system' || prev.sender_id !== m.sender_id) return false
  const gap = new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()
  return gap >= 0 && gap < 5 * 60_000 && new Date(m.created_at).toDateString() === new Date(prev.created_at).toDateString()
}

/** Reactions grouped for display: most popular first, with whether I reacted. */
export function groupReactions(list: Reaction[] | undefined, me: string | null): { emoji: string; count: number; mine: boolean }[] {
  const by = new Map<string, { emoji: string; count: number; mine: boolean; first: number }>()
  ;(list ?? []).forEach((r, i) => {
    const g = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, first: i }
    g.count++
    if (r.user_id === me) g.mine = true
    by.set(r.emoji, g)
  })
  return [...by.values()].sort((a, b) => b.count - a.count || a.first - b.first).map(({ emoji, count, mine }) => ({ emoji, count, mine }))
}

/** Apply my reaction locally (optimistic): same emoji again removes it, a new one replaces it. */
export function applyMyReaction(list: Reaction[] | undefined, me: string, emoji: string | null): Reaction[] {
  const others = (list ?? []).filter((r) => r.user_id !== me)
  return emoji ? [...others, { user_id: me, emoji }] : others
}

/** Poll results: votes per option, number of voters, and which options I picked. */
export function pollTally(poll: Poll, votes: Vote[] | undefined, me: string | null) {
  const counts = poll.options.map(() => 0)
  const voters = new Set<string>()
  const mine: number[] = []
  for (const v of votes ?? []) {
    if (v.option_index >= 0 && v.option_index < counts.length) {
      counts[v.option_index]!++
      voters.add(v.user_id)
      if (v.user_id === me) mine.push(v.option_index)
    }
  }
  return { counts, voters: voters.size, mine }
}

/** My new selection after tapping an option (single choice replaces, multiple toggles). */
export function nextSelection(poll: Poll, current: number[], tapped: number): number[] {
  if (!poll.multiple) return current.length === 1 && current[0] === tapped ? [] : [tapped]
  return current.includes(tapped) ? current.filter((i) => i !== tapped) : [...current, tapped].sort((a, b) => a - b)
}

/** "0:07" / "12:03" */
export function formatDuration(seconds: number | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
