import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { applyMyReaction, hasUnknownSender, mergeMessages, PAGE_SIZE, removeLocal, type Attachment, type Message, type MessageKind, type MessageWindow, type Poll, type ReplyPreview } from './merge'
import { removeMyFiles, uploadFile, uploadPhoto } from './media'

export type { Message } from './merge'

export interface ChatSummary {
  id: string
  kind: 'dm' | 'group'
  title: string
  avatar_url: string | null
  icon: string | null
  subtitle: string | null
  other_id: string | null
  group_id: string | null
  group_slug: string | null
  group_kind: 'batch' | 'year' | 'circle' | 'channel' | 'meetup' | null
  joined: boolean
  is_group_admin: boolean
  is_request: boolean
  started_by: string | null
  last_message: string | null
  last_message_at: string | null
  last_sender: string | null
  last_sender_name: string | null
  unread: number
  muted: boolean
  last_read_at: string | null
  other_last_read_at: string | null
  pinned_message: string | null
  can_post: boolean
  slow_mode_seconds: number
}

const SELECT =
  '*, sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url),' +
  ' reactions:message_reactions(user_id, emoji, user:profiles(full_name, avatar_url)),' +
  ' votes:poll_votes(user_id, option_index),' +
  ' reply:reply_to(id, sender_id, kind, body, attachments, poll, deleted_at, sender:profiles!messages_sender_id_fkey(full_name))'

export const chatKeys = {
  list: (uid: string | null) => ['chats', uid] as const,
  one: (id: string) => ['chat', id] as const,
  messages: (id: string) => ['messages', id] as const,
}

/** My inbox: DMs + group chats, newest first, with unread counts. One round trip. */
export function useChats() {
  const uid = useUserId()
  const { data: me } = useMyProfile()
  const verified = me?.verification === 'verified' || !!me?.is_admin
  return useQuery({
    queryKey: chatKeys.list(uid),
    enabled: !!uid && verified,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_chats', { p_chat: null })
      if (error) throw error
      return data as ChatSummary[]
    },
  })
}

/** One chat's header info (also works for a channel I can read but don't follow). */
export function useChat(id: string | undefined) {
  return useQuery({
    queryKey: chatKeys.one(id ?? ''),
    enabled: !!id,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_chats', { p_chat: id })
      if (error) throw error
      return ((data as ChatSummary[])[0] ?? null) as ChatSummary | null
    },
  })
}

/** Total unread chats for the tab badge (muted chats don't count, like WhatsApp). */
export function useUnreadChats(): number {
  const { data } = useChats()
  return data?.filter((c) => c.unread > 0 && !c.muted).length ?? 0
}

/** Live inbox: any new message I can see refreshes the list (RLS filters what each person receives). */
export function useInboxLive() {
  const uid = useUserId()
  const qc = useQueryClient()
  useEffect(() => {
    if (!uid) return
    let t: ReturnType<typeof setTimeout> | undefined
    const ch = supabase
      .channel(`inbox:${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        clearTimeout(t)
        t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['chats', uid] }), 300)
      })
      .subscribe()
    return () => {
      clearTimeout(t)
      void supabase.removeChannel(ch)
    }
  }, [uid, qc])
}

async function fetchPage(chatId: string, before?: string): Promise<Message[]> {
  let q = supabase.from('messages').select(SELECT).eq('chat_id', chatId).order('created_at', { ascending: false }).limit(PAGE_SIZE)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) throw error
  return (data as unknown as Message[]).reverse()
}

async function refetchMessages(chatId: string, ids: string[]): Promise<Message[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('messages').select(SELECT).eq('chat_id', chatId).in('id', ids)
  if (error) return []
  return data as unknown as Message[]
}

function setWindow(qc: QueryClient, chatId: string, fn: (w: MessageWindow) => MessageWindow) {
  qc.setQueryData<MessageWindow>(chatKeys.messages(chatId), (old) => fn(old ?? { items: [], hasOlder: false }))
}

/**
 * Messages of one chat. Loads the newest page, then older pages on demand. New messages, edits and
 * deletions arrive live; if live updates are unavailable we poll the newest page instead.
 */
export function useMessages(chatId: string | undefined) {
  const qc = useQueryClient()
  const uid = useUserId()
  const [live, setLive] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const q = useQuery({
    queryKey: chatKeys.messages(chatId ?? ''),
    enabled: !!chatId,
    refetchInterval: live ? 60_000 : 5_000,
    queryFn: async () => {
      const page = await fetchPage(chatId!)
      const old = qc.getQueryData<MessageWindow>(chatKeys.messages(chatId!))
      if (!old) return { items: page, hasOlder: page.length === PAGE_SIZE }
      return { items: mergeMessages(old.items, page, uid), hasOlder: old.hasOlder || (old.items.length === 0 && page.length === PAGE_SIZE) }
    },
  })

  useEffect(() => {
    if (!chatId) return
    const onRow = (payload: { new: Record<string, unknown> }) => {
      const m = payload.new as unknown as Message
      if (!m?.id) return
      const items = qc.getQueryData<MessageWindow>(chatKeys.messages(chatId))?.items ?? []
      setWindow(qc, chatId, (w) => ({ ...w, items: mergeMessages(w.items, [m], uid) }))
      if (hasUnknownSender(items, m)) void qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) })
    }
    // reactions changed: re-read just those messages (batched), with their joins
    const touched = new Set<string>()
    let t: ReturnType<typeof setTimeout> | undefined
    const onReaction = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
      const id = (payload.new?.message_id ?? payload.old?.message_id) as string | undefined
      if (!id) return
      touched.add(id)
      clearTimeout(t)
      t = setTimeout(() => {
        const ids = [...touched]
        touched.clear()
        void refetchMessages(chatId, ids).then((rows) => setWindow(qc, chatId, (w) => ({ ...w, items: mergeMessages(w.items, rows, uid) })))
      }, 250)
    }
    const ch = supabase
      .channel(`messages:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, onRow)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, onRow)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `chat_id=eq.${chatId}` }, onReaction)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `chat_id=eq.${chatId}` }, onReaction)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))
    return () => {
      clearTimeout(t)
      setLive(false)
      void supabase.removeChannel(ch)
    }
  }, [chatId, qc, uid])

  const loadOlder = useCallback(async () => {
    if (!chatId || loadingOlder) return
    const w = qc.getQueryData<MessageWindow>(chatKeys.messages(chatId))
    const oldest = w?.items.find((m) => !m.pending && !m.failed)
    if (!w?.hasOlder || !oldest) return
    setLoadingOlder(true)
    try {
      const page = await fetchPage(chatId, oldest.created_at)
      setWindow(qc, chatId, (cur) => ({ items: mergeMessages(cur.items, page, uid), hasOlder: page.length === PAGE_SIZE }))
    } finally {
      setLoadingOlder(false)
    }
  }, [chatId, loadingOlder, qc, uid])

  return { ...q, loadOlder, loadingOlder, live }
}

export interface SendInput {
  body: string
  kind?: MessageKind
  /** photos (sent together as one album) or a single document */
  files?: File[]
  /** voice notes: length in seconds */
  duration?: number
  replyTo?: ReplyPreview | null
  poll?: Poll | null
}

// Files of unsent messages, kept so "Retry" can upload them again.
const pendingFiles = new Map<string, SendInput>()

/** Send with an instant optimistic bubble; on failure the bubble stays with "Retry". */
export function useSendMessage(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  const { data: me } = useMyProfile()
  return useMutation({
    mutationFn: async (input: SendInput & { localId: string }) => {
      const kind = input.kind ?? 'text'
      let attachments: Attachment[] = []
      if (input.files?.length) {
        attachments = await Promise.all(input.files.map((f) => (kind === 'image' ? uploadPhoto(uid!, chatId, f) : uploadFile(uid!, chatId, f))))
        if (kind === 'voice' && attachments[0]) attachments[0].duration = input.duration
      }
      const { data, error } = await supabase.rpc('send_message', {
        p_chat: chatId,
        p_body: input.body,
        p_kind: kind,
        p_attachments: attachments,
        p_reply_to: input.replyTo?.id ?? null,
        p_poll: input.poll ?? null,
      })
      if (error) {
        void removeMyFiles(attachments) // don't leave orphaned uploads behind
        throw error
      }
      return data as Message
    },
    onMutate: (input) => {
      pendingFiles.set(input.localId, input)
      const kind = input.kind ?? 'text'
      const local: Message = {
        id: input.localId,
        chat_id: chatId,
        sender_id: uid,
        kind,
        body: input.body.trim() || null,
        attachments: (input.files ?? []).map((f) => ({ path: `local:${f.name}`, name: f.name, size: f.size, mime: f.type, localUrl: kind === 'image' || kind === 'voice' ? URL.createObjectURL(f) : undefined, duration: input.duration })),
        reply_to: input.replyTo?.id ?? null,
        reply: input.replyTo ?? null,
        poll: input.poll ?? null,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        sender: me ? { id: me.id, full_name: me.full_name, avatar_url: me.avatar_url } : null,
        reactions: [],
        votes: [],
        pending: true,
      }
      setWindow(qc, chatId, (w) => ({ ...w, items: [...removeLocal(w.items, input.localId), local] }))
    },
    onSuccess: (m, input) => {
      pendingFiles.delete(input.localId)
      setWindow(qc, chatId, (w) => {
        const local = w.items.find((x) => x.id === input.localId)
        local?.attachments.forEach((a) => a.localUrl && URL.revokeObjectURL(a.localUrl))
        return { ...w, items: mergeMessages(removeLocal(w.items, input.localId), [{ ...m, reply: input.replyTo ?? null, reactions: [], votes: [] }], uid) }
      })
      qc.setQueryData<ChatSummary[]>(chatKeys.list(uid), (list) =>
        list?.map((c) => (c.id === chatId ? { ...c, last_message_at: m.created_at, last_sender: uid, unread: 0, is_request: c.started_by === uid ? c.is_request : false } : c)),
      )
      void qc.invalidateQueries({ queryKey: chatKeys.list(uid) })
    },
    onError: (_e, input) => {
      setWindow(qc, chatId, (w) => ({ ...w, items: w.items.map((x) => (x.id === input.localId ? { ...x, pending: false, failed: true } : x)) }))
    },
  })
}

/** What was sent for a failed message, to retry it as-is. */
export function pendingInput(localId: string): SendInput | undefined {
  return pendingFiles.get(localId)
}

export function newLocalId(): string {
  return `local-${crypto.randomUUID()}`
}

/** Discard a failed message. */
export function discardLocal(qc: QueryClient, chatId: string, localId: string) {
  pendingFiles.delete(localId)
  setWindow(qc, chatId, (w) => {
    w.items.find((x) => x.id === localId)?.attachments.forEach((a) => a.localUrl && URL.revokeObjectURL(a.localUrl))
    return { ...w, items: removeLocal(w.items, localId) }
  })
}

function patchMessage(qc: QueryClient, chatId: string, id: string, fn: (m: Message) => Message) {
  setWindow(qc, chatId, (w) => ({ ...w, items: w.items.map((m) => (m.id === id ? fn(m) : m)) }))
}

/** React (or remove my reaction with null). Optimistic; rolls back on error. */
export function useReact(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  const { data: me } = useMyProfile()
  return useMutation({
    mutationFn: async ({ id, emoji }: { id: string; emoji: string | null }) => {
      const { error } = await supabase.rpc('react_to_message', { p_message: id, p_emoji: emoji ?? '' })
      if (error) throw error
    },
    onMutate: ({ id, emoji }) => {
      const before = qc.getQueryData<MessageWindow>(chatKeys.messages(chatId))?.items.find((m) => m.id === id)?.reactions
      patchMessage(qc, chatId, id, (m) => ({
        ...m,
        reactions: applyMyReaction(m.reactions, uid!, emoji).map((r) => (r.user_id === uid && me ? { ...r, user: { full_name: me.full_name, avatar_url: me.avatar_url } } : r)),
      }))
      return { before }
    },
    onError: (_e, { id }, ctx) => patchMessage(qc, chatId, id, (m) => ({ ...m, reactions: ctx?.before ?? m.reactions })),
  })
}

export function useEditMessage(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { data, error } = await supabase.rpc('edit_message', { p_message: id, p_body: body })
      if (error) throw error
      return data as Message
    },
    onSuccess: (m) => {
      setWindow(qc, chatId, (w) => ({ ...w, items: mergeMessages(w.items, [m], uid) }))
      void qc.invalidateQueries({ queryKey: chatKeys.list(uid) })
    },
  })
}

export function useDeleteMessage(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (m: Message) => {
      const { error } = await supabase.rpc('delete_message', { p_message: m.id })
      if (error) throw error
      if (m.sender_id === uid) await removeMyFiles(m.attachments)
    },
    onSuccess: (_d, m) => {
      patchMessage(qc, chatId, m.id, (x) => ({ ...x, body: null, attachments: [], poll: null, reactions: [], deleted_at: new Date().toISOString() }))
      void qc.invalidateQueries({ queryKey: chatKeys.list(uid) })
      void qc.invalidateQueries({ queryKey: chatKeys.one(chatId) })
    },
  })
}

/** Mark read (server + local cache), and tell the other side via the live channel. */
export function useMarkRead(chatId: string | undefined, notify: () => void) {
  const qc = useQueryClient()
  const uid = useUserId()
  const busy = useRef(false)
  return useCallback(async () => {
    if (!chatId || busy.current) return
    busy.current = true
    try {
      const { error } = await supabase.rpc('mark_chat_read', { p_chat: chatId })
      if (error) return
      qc.setQueryData<ChatSummary[]>(chatKeys.list(uid), (list) => list?.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)))
      notify()
    } finally {
      busy.current = false
    }
  }, [chatId, notify, qc, uid])
}

/**
 * Typing indicators and instant "Seen" updates over a lightweight broadcast channel (nothing stored).
 * Works best-effort: if live updates are unavailable, Seen still updates on the next refresh.
 */
export function useChatSignals(chatId: string | undefined) {
  const qc = useQueryClient()
  const { data: me } = useMyProfile()
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const [online, setOnline] = useState<string[]>([])
  const channel = useRef<RealtimeChannel | null>(null)
  const joined = useRef(false)
  const lastTypingSent = useRef(0)

  useEffect(() => {
    if (!chatId || !me) return
    const ch = supabase.channel(`chat:${chatId}`, { config: { broadcast: { self: false }, presence: { key: me.id } } })
    ch.on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState()).filter((k) => k !== me.id)))
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const p = payload as { id: string; name: string; stop?: boolean }
      if (!p?.id || p.id === me.id) return
      setTyping((t) => {
        const next = { ...t }
        if (p.stop) delete next[p.id]
        else next[p.id] = { name: p.name, until: Date.now() + 6000 }
        return next
      })
    })
      .on('broadcast', { event: 'read' }, () => void qc.invalidateQueries({ queryKey: chatKeys.one(chatId) }))
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const p = payload as { id?: string }
        if (p?.id) setTyping((t) => {
          const next = { ...t }
          delete next[p.id!]
          return next
        })
      })
      .subscribe((status) => {
        joined.current = status === 'SUBSCRIBED'
        if (status === 'SUBSCRIBED') void ch.track({ at: Date.now() })
      })
    channel.current = ch
    const sweep = setInterval(() => setTyping((t) => {
      const now = Date.now()
      const live = Object.entries(t).filter(([, v]) => v.until > now)
      return live.length === Object.keys(t).length ? t : Object.fromEntries(live)
    }), 2000)
    return () => {
      clearInterval(sweep)
      channel.current = null
      joined.current = false
      setOnline([])
      void supabase.removeChannel(ch)
    }
  }, [chatId, me, qc])

  const sendTyping = useCallback(() => {
    if (!me || !channel.current || !joined.current || Date.now() - lastTypingSent.current < 3000) return
    lastTypingSent.current = Date.now()
    void channel.current.send({ type: 'broadcast', event: 'typing', payload: { id: me.id, name: me.full_name.split(' ')[0] } })
  }, [me])
  const sentMessage = useCallback(() => {
    if (!me || !channel.current || !joined.current) return
    lastTypingSent.current = 0
    void channel.current.send({ type: 'broadcast', event: 'message', payload: { id: me.id } })
  }, [me])
  const sentRead = useCallback(() => {
    if (!me || !channel.current || !joined.current) return
    void channel.current.send({ type: 'broadcast', event: 'read', payload: { id: me.id } })
  }, [me])

  const names = Object.values(typing).map((t) => t.name)
  return { typingNames: names, online, sendTyping, sentMessage, sentRead }
}

export async function startDm(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_dm', { p_other: otherId })
  if (error) throw error
  return (data as { id: string }).id
}

export function useAcceptRequest(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('accept_message_request', { p_chat: chatId })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: chatKeys.one(chatId) }), qc.invalidateQueries({ queryKey: chatKeys.list(uid) })])
    },
  })
}

/** The chat id of a group (for the "Chat" button on a group page). */
export function useGroupChatId(groupId: string | undefined) {
  return useQuery({
    queryKey: ['group-chat', groupId],
    enabled: !!groupId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('chats').select('id').eq('group_id', groupId!).maybeSingle()
      if (error) throw error
      return (data?.id as string | undefined) ?? null
    },
  })
}

export interface SearchHit {
  id: string
  chat_id: string
  body: string
  created_at: string
  sender_name: string | null
  chat_title: string | null
}

/** Search inside one chat (or all my chats when chatId is null). `term` should already be debounced. */
export function useChatSearch(chatId: string | null, term: string) {
  const q = term.trim()
  return useQuery({
    queryKey: ['chat-search', chatId, q],
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_messages', { p_query: q, p_chat: chatId })
      if (error) throw error
      return data as SearchHit[]
    },
  })
}

export function usePinMessage(chatId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (messageId: string | null) => {
      const { error } = await supabase.rpc('pin_message', { p_chat: chatId, p_message: messageId })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.one(chatId) }),
  })
}

/** The pinned message (from the loaded window when possible, else fetched once). */
export function usePinnedMessage(chatId: string, pinnedId: string | null) {
  return useQuery({
    queryKey: ['pinned', chatId, pinnedId],
    enabled: !!pinnedId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select(SELECT).eq('id', pinnedId!).maybeSingle()
      if (error) throw error
      return (data as unknown as Message | null) ?? null
    },
  })
}

export interface MentionCandidate {
  id: string
  full_name: string
  avatar_url: string | null
}

/** Group members matching what was typed after "@". */
export function useMentionCandidates(chatId: string, prefix: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['mentions', chatId, prefix],
    enabled: enabled && prefix !== null,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mention_candidates', { p_chat: chatId, p_prefix: prefix ?? '' })
      if (error) throw error
      return data as MentionCandidate[]
    },
  })
}

/** Vote in a poll (empty selection removes my vote). Optimistic. */
export function useVote(chatId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async ({ id, options }: { id: string; options: number[] }) => {
      const { error } = await supabase.rpc('vote_poll', { p_message: id, p_options: options })
      if (error) throw error
    },
    onMutate: ({ id, options }) => {
      const before = qc.getQueryData<MessageWindow>(chatKeys.messages(chatId))?.items.find((m) => m.id === id)?.votes
      patchMessage(qc, chatId, id, (m) => ({ ...m, votes: [...(m.votes ?? []).filter((v) => v.user_id !== uid), ...options.map((o) => ({ user_id: uid!, option_index: o }))] }))
      return { before }
    },
    onError: (_e, { id }, ctx) => patchMessage(qc, chatId, id, (m) => ({ ...m, votes: ctx?.before ?? m.votes })),
  })
}

/** True for "no connection / server unreachable" failures (as opposed to the server refusing the request). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const err = e as { code?: string; status?: number; message?: string } | null
  if (!err || err.code || err.status) return false
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(err.message ?? '')
}

export function useSetSlowMode(chatId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ groupId, seconds }: { groupId: string; seconds: number }) => {
      const { error } = await supabase.rpc('set_slow_mode', { p_group: groupId, p_seconds: seconds })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.one(chatId) }),
  })
}

export async function reportMessage(messageId: string, reason: string) {
  const { error } = await supabase.rpc('report_message', { p_message: messageId, p_reason: reason })
  if (error) throw error
}
