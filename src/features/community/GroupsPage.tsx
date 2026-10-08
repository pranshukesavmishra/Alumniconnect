import clsx from 'clsx'
import { Check, Plus, ShieldAlert, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { Composer } from './Composer'
import { FeedList } from './FeedList'
import { useGroups, useJoinGroup, type GroupWithMe } from './queries'

function GroupRow({ g }: { g: GroupWithMe }) {
  const join = useJoinGroup()
  const auto = g.kind === 'batch' || g.kind === 'year'
  return (
    <div className="flex items-center gap-3 p-3.5">
      <Link to={`/groups/${g.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-2xl" aria-hidden>
          {g.icon ?? '👥'}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{g.name}</span>
          <span className="block truncate text-sm text-muted">
            {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
            {g.kind === 'channel' && ' · announcements'}
          </span>
        </span>
      </Link>
      {!auto && (
        <Button
          size="sm"
          variant={g.joined ? 'secondary' : 'primary'}
          loading={join.isPending}
          icon={g.joined ? <Check className="size-4" /> : undefined}
          onClick={() => join.mutate({ id: g.id, join: !g.joined }, { onError: (e) => toast.error(friendlyError(e)) })}
        >
          {g.joined ? (g.kind === 'channel' ? 'Following' : 'Joined') : g.kind === 'channel' ? 'Follow' : 'Join'}
        </Button>
      )}
    </div>
  )
}

export function GroupsPage() {
  const { data: me } = useMyProfile()
  const { data, isLoading } = useGroups()
  const [proposing, setProposing] = useState(false)
  if (isLoading) return <PageSkeleton />
  if (me?.verification !== 'verified' && !me?.is_admin) {
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
  const mine = groups.filter((g) => g.kind === 'batch' || g.kind === 'year')
  const channels = groups.filter((g) => g.kind === 'channel')
  const circles = groups.filter((g) => g.kind === 'circle')
  const sections: [string, GroupWithMe[]][] = [
    ['Your batch', mine.filter((g) => g.joined)],
    ['Channels', channels],
    ['Your circles', circles.filter((g) => g.joined)],
    ['Discover circles', circles.filter((g) => !g.joined)],
  ]
  return (
    <div>
      <PageHeader title="Groups" subtitle="Your batch, interest circles and official channels" action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setProposing(true)}>New circle</Button>} />
      <Page className="space-y-6">
        {proposing && <ProposeCircle onDone={() => setProposing(false)} />}
        {sections.map(([title, list]) =>
          list.length ? (
            <section key={title}>
              <SectionTitle>{title}</SectionTitle>
              <Card className="divide-y divide-border">
                {list.map((g) => (
                  <GroupRow key={g.id} g={g} />
                ))}
              </Card>
            </section>
          ) : null,
        )}
      </Page>
    </div>
  )
}

function ProposeCircle({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [icon, setIcon] = useState('✨')
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
    <Card className="space-y-3 p-4">
      <p className="font-semibold">Propose a new circle</p>
      <div className="flex gap-2">
        <input aria-label="Icon (emoji)" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} className="min-h-12 w-14 rounded-xl border border-border bg-surface text-center text-2xl" />
        <input aria-label="Circle name" placeholder="e.g. JECians in Pune" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="min-h-12 flex-1 rounded-xl border border-border bg-surface px-3" />
      </div>
      <input aria-label="What is it about?" placeholder="What is it about?" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} className="min-h-12 w-full rounded-xl border border-border bg-surface px-3" />
      <div className="flex gap-2">
        <Button loading={busy} onClick={submit}>Propose</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  )
}

export function GroupPage() {
  const { slug } = useParams()
  const { data: me } = useMyProfile()
  const { data, isLoading } = useGroups()
  const join = useJoinGroup()
  if (isLoading) return <PageSkeleton />
  const g = data?.find((x) => x.slug === slug)
  if (!g) {
    return (
      <div>
        <PageHeader title="Group" back="/groups" />
        <EmptyState icon={<Users />} title="Group not found">It may be private to its members.</EmptyState>
      </div>
    )
  }
  const canPost = g.joined && (g.kind !== 'channel' || g.myRole === 'admin' || !!me?.is_admin)
  const canRead = g.joined || g.kind === 'channel' || !!me?.is_admin
  return (
    <div>
      <PageHeader
        title={`${g.icon ?? ''} ${g.name}`}
        subtitle={`${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
        back="/groups"
        action={
          g.kind === 'circle' || g.kind === 'channel' ? (
            <Button size="sm" variant={g.joined ? 'secondary' : 'primary'} loading={join.isPending} onClick={() => join.mutate({ id: g.id, join: !g.joined }, { onError: (e) => toast.error(friendlyError(e)) })}>
              {g.joined ? 'Leave' : g.kind === 'channel' ? 'Follow' : 'Join'}
            </Button>
          ) : undefined
        }
      />
      <Page className="space-y-4">
        {g.description && <p className="text-[15px] text-muted">{g.description}</p>}
        {canPost && <Composer fixedGroup={g} />}
        {canRead ? (
          <FeedList scope={`group:${g.id}`} showGroup={false} empty={g.kind === 'channel' ? 'No announcements yet.' : 'Start the conversation.'} />
        ) : (
          <Card className={clsx('p-6 text-center')}>
            <p className="font-semibold">Join to see posts</p>
            <Button className="mt-3" onClick={() => join.mutate({ id: g.id, join: true })}>
              Join {g.name}
            </Button>
          </Card>
        )}
      </Page>
    </div>
  )
}
