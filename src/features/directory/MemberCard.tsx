// Member cards for Find JECians (grid + list rows) with quick Connect / Message.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, MapPin, MessageCircle, Sparkles, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { SpotlightCard } from '../../components/ui/Fx'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useUserId } from '../auth/AuthProvider'
import { startDm } from '../chat/queries'
import { SocialLinks } from '../profile/SocialLinks'
import { StoryAvatar, StoryRingOverlay } from '../stories/StoryRing'
import { useStoryRing } from '../stories/api'

export type ConnState = 'none' | 'sent' | 'received' | 'connected'

/** Every connection row that involves me, as a map other-id → state (one query for the whole list). */
export function useMyConnectionStates() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['connection-states', uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('connections').select('requester, addressee, status').or(`requester.eq.${uid},addressee.eq.${uid}`)
      if (error) throw error
      const m = new Map<string, ConnState>()
      for (const c of data ?? []) {
        const other = (c.requester === uid ? c.addressee : c.requester) as string
        m.set(other, c.status === 'accepted' ? 'connected' : c.requester === uid ? 'sent' : 'received')
      }
      return m
    },
  })
}

/** Connect (or accept) when not connected; Message once connected. */
export function QuickAction({ p, state, compact }: { p: Profile; state: ConnState; compact?: boolean }) {
  const tx = useT()
  const qc = useQueryClient()
  const uid = useUserId()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const first = p.full_name.split(' ')[0]!
  const base = cn(
    'fx-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 [&_svg]:size-4',
    compact ? 'size-11 shrink-0' : 'w-full px-4',
  )
  if (state === 'connected') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={tx('dir.messageName', { name: first })}
        className={cn(base, 'border border-border bg-surface-2 text-text hover:bg-surface-3')}
        onClick={async () => {
          setBusy(true)
          try {
            navigate(`/chat/${await startDm(p.id)}`)
          } catch (e) {
            toast.error(friendlyError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <MessageCircle aria-hidden />
        {!compact && tx('dir.message')}
      </button>
    )
  }
  if (state === 'sent') {
    return (
      <span className={cn(base, 'text-muted')} aria-label={tx('dir.pending')}>
        <Clock aria-hidden />
        {!compact && tx('dir.pending')}
      </span>
    )
  }
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={tx(state === 'received' ? 'dir.acceptName' : 'dir.connectName', { name: first })}
      className={cn(base, 'bg-primary-soft text-primary hover:bg-primary hover:text-on-primary')}
      onClick={async () => {
        setBusy(true)
        const { error } =
          state === 'received' ? await supabase.rpc('respond_connection', { p_other: p.id, p_accept: true }) : await supabase.rpc('request_connection', { p_other: p.id })
        setBusy(false)
        if (error) return toast.error(friendlyError(error))
        toast.success(state === 'received' ? tx('dir.connected') : tx('dir.requestSent'))
        void qc.invalidateQueries({ queryKey: ['connection-states', uid] })
        void qc.invalidateQueries({ queryKey: ['connection', uid, p.id] })
      }}
    >
      {state === 'received' ? <Check aria-hidden /> : <UserPlus aria-hidden />}
      {!compact && tx(state === 'received' ? 'dir.accept' : 'dir.connect')}
    </button>
  )
}

const roleOf = (p: Profile) => (p.current_title && p.current_company ? `${p.current_title} · ${p.current_company}` : (p.current_title ?? p.headline ?? ''))

function GridAvatar({ p }: { p: Profile }) {
  const { data: ring } = useStoryRing(p.id)
  if (ring) return <StoryAvatar userId={p.id} name={p.full_name} src={p.avatar_url} size={76} />
  return <Avatar name={p.full_name} src={p.avatar_url} size={76} ring={p.verification === 'verified' ? 'verified' : 'none'} />
}

/** Grid card: big ringed avatar, name, role, batch · branch, city, quick action. */
export function MemberGridCard({ p, state, isMe }: { p: Profile; state: ConnState; isMe: boolean }) {
  const tx = useT()
  return (
    <SpotlightCard className="fx-lift flex h-full flex-col items-center rounded-3xl border border-border/80 bg-surface p-4 pt-5 text-center shadow-card" data-testid="member-card">
      <div aria-hidden className="absolute inset-x-0 top-0 h-16 bg-[radial-gradient(80%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent)]" />
      <span className="relative z-10">
        <GridAvatar p={p} />
      </span>
      <Link to={`/people/${p.id}`} className="mt-3 block min-w-0 after:absolute after:inset-0 after:content-['']">
        <span className="line-clamp-2 text-[16px] font-semibold leading-snug">{p.full_name}</span>
      </Link>
      <p className="text-caption mt-1 line-clamp-2 min-h-[2.6em] text-muted">{roleOf(p)}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        {p.grad_year && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-bold text-primary">{p.grad_year}</span>}
        {p.branch && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-muted">{shortBranch(p.branch)}</span>}
      </div>
      {p.city && (
        <p className="text-caption mt-1.5 flex items-center gap-1 text-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1">{p.city}</span>
        </p>
      )}
      <div className="relative z-10 mt-auto w-full pt-3">{!isMe && <QuickAction p={p} state={state} />}</div>
      {p.help_tags.includes('Referrals') && (
        <span className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-full bg-accent-soft text-gold-ink" title={tx('dir.refers')}>
          <Sparkles className="size-3.5" aria-hidden />
          <span className="sr-only">{tx('dir.refers')}</span>
        </span>
      )}
    </SpotlightCard>
  )
}

/** List row. */
export function MemberRow({ p, state, isMe }: { p: Profile; state: ConnState; isMe: boolean }) {
  const tx = useT()
  return (
    <li className="relative flex items-center gap-1 pr-2 transition-colors hover:bg-surface-2" data-testid="member-row">
      <Link to={`/people/${p.id}`} className="fx-press flex min-w-0 flex-1 items-center gap-3.5 p-3.5">
        <StoryAvatar userId={p.id} name={p.full_name} src={p.avatar_url} size={52} interactive={false} bleed />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-[16px] font-semibold">{p.full_name}</span>
            {state === 'connected' && <span className="shrink-0 rounded-full bg-success-soft px-1.5 text-[11px] font-bold leading-5 text-success">{tx('dir.youKnow')}</span>}
          </p>
          {roleOf(p) && <p className="truncate text-sm">{roleOf(p)}</p>}
          <p className="text-caption truncate text-muted">{[p.grad_year ? tx('common.batch', { year: p.grad_year }) : null, shortBranch(p.branch), p.city].filter(Boolean).join(' · ')}</p>
        </div>
        {p.help_tags.includes('Referrals') && <Sparkles className="size-4 shrink-0 text-gold-ink" aria-label={tx('dir.refers')} />}
      </Link>
      <StoryRingOverlay userId={p.id} name={p.full_name} size={52} className="left-[9px] top-1/2 -translate-y-1/2" />
      <SocialLinks userId={p.id} name={p.full_name} variant="compact" className="shrink-0 flex-nowrap" />
      {!isMe && <QuickAction p={p} state={state} compact />}
    </li>
  )
}
