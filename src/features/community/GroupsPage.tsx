import { InviteBatch } from '../quickprofile/InviteBatch'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Check, ChevronLeft, ChevronRight, Megaphone, MessagesSquare, Plus, ShieldAlert, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { AvatarStack, Card, EmptyState } from '../../components/ui/Display'
import { Skeleton } from '../../components/ui/Skeleton'
import { Input } from '../../components/ui/Form'
import { IconTile } from '../../components/ui/IconTile'
import { cn } from '../../lib/cn'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useT, type MsgKey } from '../../i18n'
import { useMyProfile } from '../auth/AuthProvider'
import { Composer } from './Composer'
import { FeedList } from './FeedList'
import { useGroupChatId } from '../chat/queries'
import { useGroups, useJoinGroup, type GroupWithMe } from './queries'
import { CIRCLE_ICON_CHOICES, GroupIcon } from '../../components/ui/GroupIcon'
import { GroupCover } from '../profile/ProfileParts'

/** A few member faces for a group (decorative preview). */
function useGroupFaces(groupId: string, enabled = true) {
  return useQuery({
    queryKey: ['group-faces', groupId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('group_members').select('user:profiles!group_members_user_id_fkey(full_name, avatar_url)').eq('group_id', groupId).limit(5)
      if (error) throw error
      return (data ?? []).map((r) => (r as unknown as { user: { full_name: string; avatar_url: string | null } | null }).user).filter((u): u is { full_name: string; avatar_url: string | null } => !!u?.full_name)
    },
  })
}

function useMembersLabel() {
  const tx = useT()
  return (n: number) => tx('grp.members', { count: n })
}

function JoinButton({ g, className, glass }: { g: GroupWithMe; className?: string; glass?: boolean }) {
  const tx = useT()
  const join = useJoinGroup()
  return (
    <Button
      size="sm"
      variant={g.joined ? (glass ? 'glass' : 'secondary') : glass ? 'gold' : 'primary'}
      className={className}
      loading={join.isPending}
      icon={g.joined ? <Check className="size-4" /> : undefined}
      onClick={(e) => {
        e.preventDefault()
        join.mutate({ id: g.id, join: !g.joined }, { onError: (err) => toast.error(friendlyError(err)) })
      }}
    >
      {g.joined ? (g.kind === 'channel' ? tx('cx.following') : tx('cx.joined')) : g.kind === 'channel' ? tx('cx.follow') : tx('cx.join')}
    </Button>
  )
}

const AUTO = new Set(['batch', 'year', 'official', 'department'])

/** Large cover tile for your own spaces (official, department, batch). */
function FeatureTile({ g }: { g: GroupWithMe }) {
  const tx = useT()
  const members = useMembersLabel()
  const { data: faces } = useGroupFaces(g.id)
  return (
    <Link to={`/groups/${g.slug}`} className="fx-press fx-lift group block overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-card" data-testid="group-tile">
      <GroupCover kind={g.kind} seed={g.slug} className="h-24">
        <div className="flex h-full items-start justify-between p-3">
          <GroupIcon icon={g.icon} kind={g.kind} variant="glass" size="md" />
          {g.kind === 'official' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-official px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-on-official shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]">
              <BadgeCheck className="size-3.5" aria-hidden />
              {tx('grp.official')}
            </span>
          )}
          {(g.kind === 'channel' || g.post_mode === 'staff_only') && g.kind !== 'official' && (
            <span className="fx-liquid-dark inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold">
              <Megaphone className="size-3.5" aria-hidden />
              {tx('grp.announcements')}
            </span>
          )}
        </div>
      </GroupCover>
      <div className="flex items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-title line-clamp-2 leading-snug">{g.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            {faces && faces.length > 0 && <AvatarStack people={faces.map((f) => ({ name: f.full_name, src: f.avatar_url }))} max={4} size={22} />}
            <span className="text-caption text-muted">{members(g.member_count)}</span>
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </Link>
  )
}

/** Compact card for channels and circles, with Join / Follow. */
function CompactTile({ g }: { g: GroupWithMe }) {
  const members = useMembersLabel()
  return (
    <div className="fx-lift relative flex h-full flex-col overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-card" data-testid="group-tile">
      <GroupCover kind={g.kind} seed={g.slug} className="h-14" />
      <div className="flex flex-1 flex-col px-3 pb-3">
        <span className="-mt-6 mb-2 inline-flex w-fit rounded-[15px] bg-surface p-1 shadow-e2">
          <GroupIcon icon={g.icon} kind={g.kind} size="md" />
        </span>
        <Link to={`/groups/${g.slug}`} className="text-[15px] font-semibold leading-snug after:absolute after:inset-0 after:content-['']">
          <span className="line-clamp-2">{g.name}</span>
        </Link>
        <p className="text-caption mt-0.5 text-muted">{members(g.member_count)}</p>
        {!AUTO.has(g.kind) && <JoinButton g={g} className="relative z-10 mt-3 w-full" />}
      </div>
    </div>
  )
}

const SECTIONS: { key: string; title: MsgKey; feature: boolean; pick: (g: GroupWithMe) => boolean }[] = [
  { key: 'Official', title: 'grp.sec.official', feature: true, pick: (g) => g.kind === 'official' },
  { key: 'My department', title: 'grp.sec.department', feature: true, pick: (g) => g.kind === 'department' && g.joined },
  { key: 'My batch', title: 'grp.sec.batch', feature: true, pick: (g) => g.kind === 'year' && g.joined },
  { key: 'My department + batch', title: 'grp.sec.deptBatch', feature: true, pick: (g) => g.kind === 'batch' && g.joined },
  { key: 'Channels', title: 'grp.sec.channels', feature: false, pick: (g) => g.kind === 'channel' },
  { key: 'Circles', title: 'grp.sec.circles', feature: false, pick: (g) => g.kind === 'circle' && g.joined },
  { key: 'Discover circles', title: 'grp.sec.discover', feature: false, pick: (g) => g.kind === 'circle' && !g.joined },
]

export function GroupsPage() {
  const tx = useT()
  const { data: me } = useMyProfile()
  const { data, isLoading } = useGroups()
  const [proposing, setProposing] = useState(false)
  if (!isLoading && me?.verification !== 'verified' && !me?.is_admin) {
    return (
      <div>
        <PageHeader title="Groups" />
        <EmptyState icon={<ShieldAlert />} title="Groups are for verified members">
          You’ll be verified once your Alumni Meet payment is confirmed, or when two verified JECians vouch for you.
        </EmptyState>
      </div>
    )
  }
  const groups = data ?? []
  return (
    <div>
      <PageHeader
        title={tx('grp.title')}
        subtitle={tx('grp.subtitle')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setProposing(true)}>{tx('groups.newCircle')}</Button>}
      />
      <Page className="space-y-8">
        {proposing && <ProposeCircle onDone={() => setProposing(false)} />}
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-3xl" />
            ))}
          </div>
        ) : (
          SECTIONS.map((s) => {
            const list = groups.filter(s.pick)
            if (!list.length) return null
            return (
              <section key={s.key} aria-label={s.key} data-section={s.key}>
                <h2 className="text-eyebrow mb-3 flex items-center gap-2 px-1 font-sans text-gold-ink">
                  {tx(s.title)}
                  <span className="rounded-full bg-surface-2 px-2 text-[11px] leading-5 tabular-nums text-muted">{list.length}</span>
                  <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
                </h2>
                {s.feature ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map((g) => (
                      <FeatureTile key={g.id} g={g} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {list.map((g) => (
                      <CompactTile key={g.id} g={g} />
                    ))}
                  </div>
                )}
              </section>
            )
          })
        )}
      </Page>
    </div>
  )
}

function ProposeCircle({ onDone }: { onDone: () => void }) {
  const tx = useT()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [icon, setIcon] = useState(CIRCLE_ICON_CHOICES[0]!.stored)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (name.trim().length < 2) return toast.error('Give the circle a name.')
    setBusy(true)
    const { error } = await supabase.rpc('propose_circle', { p_name: name, p_description: desc, p_icon: icon })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Circle proposed. An admin will approve it shortly.')
    onDone()
  }
  return (
    <Card variant="gradient-border" className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <GroupIcon icon={icon} size="lg" variant="solid" />
        <div>
          <p className="text-title">Propose a new circle</p>
          <p className="text-caption text-muted">{tx('grp.proposeHint')}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="Icon" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
        {CIRCLE_ICON_CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={icon === c.stored}
            aria-label={c.label}
            onClick={() => setIcon(c.stored)}
            className={cn('tap grid size-12 shrink-0 place-items-center rounded-2xl', icon === c.stored ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'opacity-80 hover:opacity-100')}
          >
            <GroupIcon icon={c.stored} size="md" />
          </button>
        ))}
      </div>
      <Input aria-label="Circle name" placeholder="e.g. JECians in Pune" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="What is it about?" placeholder="What is it about?" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex gap-2">
        <Button loading={busy} onClick={submit}>Propose</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  )
}

const KIND_LABEL: Record<string, MsgKey> = {
  official: 'grp.kind.official',
  department: 'grp.kind.department',
  year: 'grp.kind.year',
  batch: 'grp.kind.batch',
  channel: 'grp.kind.channel',
  circle: 'grp.kind.circle',
  meetup: 'grp.kind.circle',
}

export function GroupPage() {
  const tx = useT()
  const { slug } = useParams()
  const { data: me } = useMyProfile()
  const { data, isLoading } = useGroups()
  const join = useJoinGroup()
  const g = data?.find((x) => x.slug === slug)
  const { data: faces } = useGroupFaces(g?.id ?? '', !!g)
  const members = useMembersLabel()
  if (isLoading)
    return (
      <div className="mx-auto max-w-3xl md:px-4 md:pt-4">
        <Skeleton className="h-56 rounded-none md:rounded-[32px]" />
      </div>
    )
  if (!g) {
    return (
      <div>
        <PageHeader title="Group" back="/groups" />
        <EmptyState icon={<Users />} title="Group not found">It may be private to its members.</EmptyState>
      </div>
    )
  }
  const canPost = g.joined && (g.kind !== 'channel' || g.myRole === 'admin' || !!me?.is_admin) && (g.post_mode !== 'staff_only' || g.myRole === 'admin' || !!me?.is_admin)
  const canRead = g.joined || g.kind === 'channel' || !!me?.is_admin
  const joinable = g.kind === 'circle' || g.kind === 'channel'
  return (
    <div>
      <div className="mx-auto max-w-3xl md:px-4 md:pt-4">
        <GroupCover kind={g.kind} seed={g.slug} className="md:rounded-[32px]">
          <div className="px-4 pb-5 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <Link to="/groups" aria-label={tx('common.back')} className="fx-liquid-dark fx-press grid size-11 place-items-center rounded-full">
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
            <div className="mt-6 flex items-end gap-4">
              <GroupIcon icon={g.icon} kind={g.kind} variant="glass" size="xl" />
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-eyebrow flex items-center gap-1.5 text-accent">
                  {g.kind === 'official' && <BadgeCheck className="size-3.5" aria-hidden />}
                  {tx(KIND_LABEL[g.kind] ?? 'grp.kind.circle')}
                </p>
                <h1 className="font-display mt-1 text-[28px] font-semibold leading-tight sm:text-[34px]">{g.name}</h1>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {faces && faces.length > 0 && <AvatarStack people={faces.map((f) => ({ name: f.full_name, src: f.avatar_url }))} max={5} size={30} className="[&>span]:ring-[#062a20]" />}
              <span className="text-sm font-semibold text-white/85">{members(g.member_count)}</span>
              {joinable && (
                <Button
                  size="sm"
                  variant={g.joined ? 'glass' : 'gold'}
                  className="ml-auto"
                  loading={join.isPending}
                  onClick={() => join.mutate({ id: g.id, join: !g.joined }, { onError: (e) => toast.error(friendlyError(e)) })}
                >
                  {g.joined ? tx('cx.leave') : g.kind === 'channel' ? tx('cx.follow') : tx('cx.join')}
                </Button>
              )}
            </div>
          </div>
        </GroupCover>
      </div>
      <Page className="space-y-4 pt-4">
        {g.description && <p className="text-body-lg text-muted">{g.description}</p>}
        {g.joined && g.grad_year && (g.kind === 'year' || g.kind === 'batch') && <InviteBatch year={g.grad_year} />}
        {canRead && <GroupChatLink groupId={g.id} channel={g.kind === 'channel' || g.post_mode === 'staff_only'} />}
        {canPost && <Composer fixedGroup={g} />}
        {canRead ? (
          <FeedList scope={`group:${g.id}`} showGroup={false} empty={g.kind === 'channel' || g.post_mode === 'staff_only' ? tx('cx.noAnnouncements') : tx('cx.startConversation')} />
        ) : (
          <Card variant="gradient-border" className="flex flex-col items-center p-6 text-center">
            <IconTile icon={Users} tone="emerald" variant="solid" size="lg" />
            <p className="text-title mt-3">{tx('cx.joinToSee')}</p>
            <Button className="mt-4" onClick={() => join.mutate({ id: g.id, join: true })}>
              {tx('cx.joinNamed', { name: g.name })}
            </Button>
          </Card>
        )}
      </Page>
    </div>
  )
}

/** Entry to the group's chat (full history is visible to every member, including new joiners). */
function GroupChatLink({ groupId, channel }: { groupId: string; channel: boolean }) {
  const tx = useT()
  const { data: chatId } = useGroupChatId(groupId)
  if (!chatId) return null
  return (
    <Link to={`/chat/${chatId}`} className="fx-press fx-lift flex min-h-16 items-center gap-3.5 rounded-3xl border border-border/80 bg-surface p-3.5 shadow-card">
      <IconTile icon={channel ? Megaphone : MessagesSquare} tone={channel ? 'ink' : 'emerald'} variant="solid" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{channel ? tx('cx.channelUpdates') : tx('cx.groupChat')}</span>
        <span className="text-caption block text-muted">{channel ? tx('cx.channelUpdatesHint') : tx('cx.groupChatHint')}</span>
      </span>
      <ChevronRight className="size-5 text-subtle" aria-hidden />
    </Link>
  )
}
