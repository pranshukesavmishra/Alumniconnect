import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Ban, Check, MessageCircle, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { startConversation } from '../chat/queries'

type ConnState = 'none' | 'sent' | 'received' | 'connected'

export function useConnectionState(otherId: string) {
  const uid = useUserId()
  return useQuery({
    queryKey: ['connection', uid, otherId],
    enabled: !!uid && uid !== otherId,
    queryFn: async (): Promise<ConnState> => {
      const { data, error } = await supabase
        .from('connections')
        .select('requester, addressee, status')
        .or(`and(requester.eq.${uid},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${uid})`)
        .maybeSingle()
      if (error) throw error
      if (!data) return 'none'
      if (data.status === 'accepted') return 'connected'
      return data.requester === uid ? 'sent' : 'received'
    },
  })
}

export function ProfileActions({ profile }: { profile: Profile }) {
  const { data: me } = useMyProfile()
  const uid = useUserId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: state } = useConnectionState(profile.id)
  const [busy, setBusy] = useState<string | null>(null)
  const verified = me?.verification === 'verified' || me?.is_admin

  if (!verified || profile.id === uid) return null

  const refresh = () => qc.invalidateQueries({ queryKey: ['connection', uid, profile.id] })

  async function connect() {
    setBusy('connect')
    const { error } = state === 'received'
      ? await supabase.rpc('respond_connection', { p_other: profile.id, p_accept: true })
      : await supabase.rpc('request_connection', { p_other: profile.id })
    setBusy(null)
    if (error) return toast.error(friendlyError(error))
    toast.success(state === 'received' ? 'Connected' : 'Request sent')
    void refresh()
  }

  async function message() {
    setBusy('message')
    try {
      const id = await startConversation(profile.id)
      navigate(`/chat/${id}`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function vouch() {
    if (!window.confirm(`Confirm that you personally know ${profile.full_name} from JEC? Two vouches from verified members verify them.`)) return
    const { error } = await supabase.rpc('vouch_for', { p_member: profile.id })
    if (error) return toast.error(friendlyError(error))
    toast.success('Thanks for vouching')
    void qc.invalidateQueries({ queryKey: ['member', profile.id] })
  }

  async function block() {
    if (!window.confirm(`Block ${profile.full_name}? They won’t be able to message you, and you won’t see each other’s posts.`)) return
    const { error } = await supabase.from('blocks').insert({ blocker: uid, blocked: profile.id })
    if (error && error.code !== '23505') return toast.error(friendlyError(error))
    toast.success('Blocked')
    void qc.invalidateQueries({ queryKey: ['feed'] })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button icon={<MessageCircle className="size-4" />} loading={busy === 'message'} onClick={message}>
        Message
      </Button>
      {state === 'connected' ? (
        <Badge tone="success" className="min-h-11 px-4 text-sm">
          <Check className="size-4" aria-hidden /> Connected
        </Badge>
      ) : (
        <Button variant="secondary" icon={<UserPlus className="size-4" />} loading={busy === 'connect'} disabled={state === 'sent'} onClick={connect}>
          {state === 'sent' ? 'Request sent' : state === 'received' ? 'Accept request' : 'Connect'}
        </Button>
      )}
      {profile.verification !== 'verified' && (
        <Button variant="secondary" icon={<BadgeCheck className="size-4" />} onClick={vouch}>
          I know them from JEC
        </Button>
      )}
      <Button variant="danger-ghost" size="sm" icon={<Ban className="size-4" />} onClick={block}>
        Block
      </Button>
    </div>
  )
}

export function BadgesRow({ memberId }: { memberId: string }) {
  const { data } = useQuery({
    queryKey: ['badges', memberId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('member_badges', { p_member: memberId })
      if (error) throw error
      return data as { id: string; label: string; hint: string }[]
    },
  })
  if (!data?.length) return null
  const icon: Record<string, string> = { connector: '🤝', champion: '🏆', founding: '🌟', complete: '✅', meet2026: '🎉' }
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((b) => (
        <span key={b.id} title={b.hint} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-warning">
          <span aria-hidden>{icon[b.id] ?? '🏅'}</span> {b.label}
        </span>
      ))}
    </div>
  )
}
