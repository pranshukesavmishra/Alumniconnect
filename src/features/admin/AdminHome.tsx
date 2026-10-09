import { BarChart3, CalendarPlus, CheckCircle2, ChevronRight, Flag, Activity, History, Inbox, KeyRound, Network, ShieldCheck, Users } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { buildQueue, type QueueItem } from '../../lib/adminAttention'
import { describeAccess, ROLE_INFO } from '../../lib/roles'
import { friendlyError } from '../../lib/errors'
import { formatDateRange } from '../../lib/format'
import { useMyProfile } from '../auth/AuthProvider'
import { AdminSearch } from './AdminSearch'
import { useAttention, useIsModerator, useManagedEvents } from './queries'

export function AdminHome() {
  const { data: me } = useMyProfile()
  const { data, isLoading, error } = useManagedEvents()
  const moderator = useIsModerator()
  const canManage = !!me?.is_admin || moderator || !!data?.some((d) => d.caps.manage)
  const attention = useAttention(canManage)
  if (isLoading || !me) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!me.is_admin && !moderator && !data?.length) return <Navigate to="/" replace />
  if (data?.length === 1 && !me.is_admin && !moderator && !data[0]!.caps.manage) return <Navigate to={`/admin/events/${data[0]!.event.slug}`} replace />

  return (
    <div>
      <PageHeader
        title="Organise"
        subtitle="Events you manage"
        action={me.is_admin && <ButtonLink to="/admin/events/new" size="sm" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>}
      />
      <Page className="space-y-3">
        <p className="text-sm text-muted" data-testid="my-access">
          Signed in as{' '}
          {describeAccess(me.is_admin, moderator, (data ?? []).flatMap((d) => d.roles.map((role) => ({ role, title: d.event.title })))).map((a) => a.label).filter((l, i, all) => all.indexOf(l) === i).join(' + ') || 'member'}.
          {me.is_admin && <> <Link to="/admin/roles" className="font-semibold text-primary">Who can do what</Link></>}
        </p>
        {canManage && (me.is_admin || data?.some((d) => d.caps.finance)) && <AdminSearch members={me.is_admin} />}
        {canManage && (
          <section aria-label="Needs your attention" className="space-y-2 pt-1">
            <SectionTitle>Needs your attention</SectionTitle>
            {attention.error ? (
              <Notice tone="danger" title={friendlyError(attention.error)} />
            ) : !attention.data ? (
              <PageSkeleton />
            ) : (
              <Queue items={buildQueue(attention.data)} />
            )}
          </section>
        )}
        {(moderator || me.is_admin || data?.some((d) => d.caps.finance)) && (
          <Link to="/admin/inbox" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Inbox className="size-5" aria-hidden /></span>
            <span className="flex-1"><span className="block font-semibold">Inbox</span><span className="block text-sm text-muted">Everything waiting for a decision</span></span>
            <ChevronRight className="size-5 text-muted" aria-hidden />
          </Link>
        )}
        {moderator && !me.is_admin && (
          <Link to="/admin/reports" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Flag className="size-5" aria-hidden /></span>
            <span className="flex-1"><span className="block font-semibold">Reports and slow mode</span><span className="block text-sm text-muted">Posts and messages members flagged</span></span>
            {!!attention.data?.global?.reports_open && <Badge tone="danger">{attention.data.global.reports_open}</Badge>}
            <ChevronRight className="size-5 text-muted" aria-hidden />
          </Link>
        )}
        {me.is_admin && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Link to="/admin/members" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Users className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Members</span><span className="block text-sm text-muted">Edit profiles, verify, admins</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/analytics" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><BarChart3 className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Analytics</span><span className="block text-sm text-muted">Growth, batches, engagement</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/community" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Network className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Community</span><span className="block text-sm text-muted">Approve circles, spotlight, batch sizes</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/reports" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Flag className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Reports</span><span className="block text-sm text-muted">Posts and messages members flagged</span></span>
              {!!attention.data?.global?.reports_open && <Badge tone="danger">{attention.data.global.reports_open}</Badge>}
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/roles" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><KeyRound className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Roles</span><span className="block text-sm text-muted">Admins, treasurers, content managers, moderators</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/health" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Activity className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Health</span><span className="block text-sm text-muted">Backups, push, storage</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
            <Link to="/admin/activity" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><History className="size-5" aria-hidden /></span>
              <span className="flex-1"><span className="block font-semibold">Activity log</span><span className="block text-sm text-muted">Every admin change, with names</span></span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          </div>
        )}
        <h2 className="pt-2 text-[13px] font-bold uppercase tracking-wide text-muted">Events</h2>
        {!data?.length ? (
          <EmptyState icon={<ShieldCheck />} title="No events yet" action={<ButtonLink to="/admin/events/new">Create the Alumni Meet</ButtonLink>}>
            Create the event, set the fees and UPI details, then publish it.
          </EmptyState>
        ) : (
          data.map(({ event, roles }) => (
            <Link key={event.id} to={`/admin/events/${event.slug}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{event.title}</p>
                <p className="text-sm text-muted">{formatDateRange(event.starts_at, event.ends_at)}</p>
              </div>
              {!event.is_published && <Badge tone="warning">Draft</Badge>}
              <Badge tone="primary">{me.is_admin ? 'Admin' : roles.map((x) => ROLE_INFO[x].label).join(' + ')}</Badge>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          ))
        )}
      </Page>
    </div>
  )
}

const TONE = { danger: 'danger', warning: 'warning', primary: 'primary', neutral: 'neutral' } as const

function Queue({ items }: { items: QueueItem[] }) {
  if (!items.length) {
    return (
      <Card className="flex items-center gap-3 p-4" data-testid="queue-empty">
        <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-semibold">All caught up</p>
          <p className="text-sm text-muted">No payments, members, reports or circles are waiting.</p>
        </div>
      </Card>
    )
  }
  return (
    <ul className="space-y-2" data-testid="queue">
      {items.map((i) => (
        <li key={i.id}>
          <Link to={i.href} data-queue={i.id} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:border-primary/40">
            <Badge tone={TONE[i.tone]} className="min-w-8 justify-center">{i.count > 0 ? i.count : '!'}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{i.title}</span>
              <span className="block text-sm text-muted [overflow-wrap:anywhere]">{i.detail}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}
