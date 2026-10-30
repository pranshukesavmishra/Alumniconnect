import { Award, Crown, Handshake, PartyPopper, Trophy, type LucideIcon } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Ban, Check, MessageCircle, MoreHorizontal, Share2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button, IconButton } from '../../components/ui/Button'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { Badge } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'

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
  const [more, setMore] = useState(false)
  const tx = useT()
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
      const id = await startDm(profile.id)
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

  async function share() {
    const url = `${window.location.origin}/people/${profile.id}`
    try {
      if (navigator.share) await navigator.share({ title: profile.full_name, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success(tx('pp.linkCopied'))
      }
    } catch {
      /* cancelled */
    }
  }

  async function block() {
    if (!window.confirm(`Block ${profile.full_name}? They won’t be able to message you, and you won’t see each other’s posts.`)) return
    const { error } = await supabase.from('blocks').insert({ blocker: uid, blocked: profile.id })
    if (error && error.code !== '23505') return toast.error(friendlyError(error))
    toast.success('Blocked')
    void qc.invalidateQueries({ queryKey: ['feed'] })
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Button className="flex-1" icon={<MessageCircle className="size-4" />} loading={busy === 'message'} onClick={message}>
        {tx('cx.message')}
      </Button>
      {state === 'connected' ? (
        <span className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-4 text-[15px] font-semibold text-success">
          <Check className="size-4" aria-hidden /> {tx('cx.connected')}
        </span>
      ) : (
        <Button className="flex-1" variant="secondary" icon={state === 'sent' ? <Check className="size-4" /> : <UserPlus className="size-4" />} loading={busy === 'connect'} disabled={state === 'sent'} onClick={connect}>
          {state === 'sent' ? tx('cx.requestSent') : state === 'received' ? tx('cx.acceptRequest') : tx('cx.connect')}
        </Button>
      )}
      <IconButton label={tx('pp.more')} variant="secondary" size="md" onClick={() => setMore(true)}>
        <MoreHorizontal className="size-5" />
      </IconButton>
      <Sheet open={more} onClose={() => setMore(false)} label={tx('pp.more')}>
        <div className="pb-2">
          {profile.verification !== 'verified' && (
            <SheetAction icon={<BadgeCheck />} onClick={() => { setMore(false); void vouch() }}>
              {tx('cx.vouch')}
            </SheetAction>
          )}
          <SheetAction icon={<Share2 />} onClick={() => { setMore(false); void share() }}>
            {tx('pp.shareProfile')}
          </SheetAction>
          <SheetAction danger icon={<Ban />} onClick={() => { setMore(false); void block() }}>
            {tx('cx.block')}
          </SheetAction>
        </div>
      </Sheet>
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
  const icon: Record<string, LucideIcon> = { connector: Handshake, champion: Trophy, founding: Crown, complete: BadgeCheck, meet2026: PartyPopper }
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((b) => (
        <Badge key={b.id} tone={b.id === 'founding' ? 'founding' : 'gold'} className="px-3 py-1 text-sm" icon={(() => {
          const I = icon[b.id] ?? Award
          return <I aria-hidden />
        })()}>
          <span title={b.hint}>{b.label}</span>
        </Badge>
      ))}
    </div>
  )
}
