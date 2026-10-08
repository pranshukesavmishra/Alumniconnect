import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useUserId } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'

export interface Conversation {
  id: string
  user_a: string
  user_b: string
  started_by: string
  is_request: boolean
  last_message_at: string
  last_message: string | null
  a_read_at: string | null
  b_read_at: string | null
  other: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null }
  unread: boolean
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  pending?: boolean
}

const OTHER = 'id, full_name, avatar_url, grad_year, branch'

export function useConversations() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['conversations', uid],
    enabled: !!uid,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(`*, a:profiles!conversations_user_a_fkey(${OTHER}), b:profiles!conversations_user_b_fkey(${OTHER})`)
        .order('last_message_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data as (Omit<Conversation, 'other' | 'unread'> & { a: Conversation['other']; b: Conversation['other'] })[]).map((c) => {
        const iAmA = c.user_a === uid
        const myRead = iAmA ? c.a_read_at : c.b_read_at
        return { ...c, other: iAmA ? c.b : c.a, unread: !!c.last_message && (!myRead || myRead < c.last_message_at) } as Conversation
      })
    },
  })
}

export function useMessages(conversationId: string | undefined) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    refetchInterval: 8_000, // fallback if live updates are unavailable
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId!).order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return (data as Message[]).reverse()
    },
  })
  // Live: new messages appear instantly
  useEffect(() => {
    if (!conversationId) return
    const ch = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new as Message
        qc.setQueryData<Message[]>(['messages', conversationId], (old) => (old?.some((x) => x.id === m.id) ? old : [...(old ?? []).filter((x) => !(x.pending && x.body === m.body)), m]))
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [conversationId, qc])
  return q
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (body: string) => {
      const { data, error } = await supabase.rpc('send_message', { p_conversation: conversationId, p_body: body })
      if (error) throw error
      return data as Message
    },
    // show the message immediately; replace with the real one when the server confirms
    onMutate: (body) => {
      const temp: Message = { id: `temp-${Date.now()}`, conversation_id: conversationId, sender_id: uid!, body: body.trim(), created_at: new Date().toISOString(), pending: true }
      qc.setQueryData<Message[]>(['messages', conversationId], (old) => [...(old ?? []), temp])
      return { tempId: temp.id }
    },
    onSuccess: (m, _b, ctx) => {
      qc.setQueryData<Message[]>(['messages', conversationId], (old) => {
        const without = (old ?? []).filter((x) => x.id !== ctx?.tempId)
        return without.some((x) => x.id === m.id) ? without : [...without, m]
      })
      void qc.invalidateQueries({ queryKey: ['conversations', uid] })
    },
    onError: (_e, _b, ctx) => qc.setQueryData<Message[]>(['messages', conversationId], (old) => (old ?? []).filter((x) => x.id !== ctx?.tempId)),
  })
}

export async function startConversation(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_conversation', { p_other: otherId })
  if (error) throw error
  return (data as { id: string }).id
}
