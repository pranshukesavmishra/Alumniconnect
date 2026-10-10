import { BarChart3, CalendarPlus, CheckCircle2, ChevronRight, Flag, HeartHandshake, Activity, History, Inbox, KeyRound, Network, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
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
import { useAdminAccess } from './access'
import { useAttention, useManagedEvents, useModerationCaps } from './queries'

function TileLink({ to, icon, title, blurb, badge }: { to: string; icon: ReactNode; title: string; blurb: string; badge?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
      <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="flex-1"><span className="block font-semibold">{title}</span><span className="block text-sm text-muted">{blurb}</span></span>
      {badge}
      <ChevronRight className="size-5 text-muted" aria-hidden />
    </Link>
  )
}

export function AdminHome() {
  const { data: me } = useMyProfile()
  const { data, isLoading, error } = useManagedEvents()
  const { access, isLoading: accessLoading, can, canAny } = useAdminAccess()
  const mod = useModerationCaps()
  const canManage = access.is_admin || mod.any || !!data?.some((d) => d.caps.manage)
  const attention = useAttention(canManage)
  if (isLoading || accessLoading || !me) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!access.is_admin && !mod.any && !data?.length) return <Navigate to="/" replace />
  if (data?.length === 1 && !access.is_admin && !mod.any && !data[0]!.caps.manage) return <Navigate to={`/admin/events/${data[0]!.event.slug}`} replace />

  // every tile shows only what this person may use; the database refuses the rest anyway
  const seesInbox = mod.reports || can('messages_send') || canAny(['money_refunds', 'events_registrations']) || !!data?.some((d) => d.caps.finance)
  const seesReports = mod.any
  const g = attention.data?.global
  const queueRelevant = access.is_admin ? canAny(['members_verify', 'moderation_*', 'community_circles', 'messages_send', 'money_*', 'events_*']) || mod.any : canManage
  const accessLabel = access.is_super
    ? 'Owner'
    : access.is_admin
      ? access.full ? 'Admin' : `Admin (${access.permissions.length} permissions)`
      : ''
  const staffLabels = describeAccess(false, mod.any && !access.is_admin, (data ?? []).flatMap((d) => d.roles.map((role) => ({ role, title: d.event.title })))).map((a) => a.label)
  const labels = [accessLabel, ...staffLabels].filter((l, i, all) => !!l && all.indexOf(l) === i)

  return (
    <div>
      <PageHeader
        title="Organise"
        subtitle="Events you manage"
        action={can('events_create') && <ButtonLink to="/admin/events/new" size="sm" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>}
      />
      <Page className="space-y-3">
        <p className="text-sm text-muted" data-testid="my-access">
          Signed in as {labels.join(' + ') || 'member'}.
          {canAny(['admins', 'events_team']) && <> <Link to="/admin/roles" className="font-semibold text-primary">Who can do what</Link></>}
        </p>
        {canManage && (can('members_view') || data?.some((d) => d.caps.finance) || canAny(['money_*', 'events_registrations'])) && <AdminSearch members={can('members_view')} />}
        {canManage && queueRelevant && (
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
        {seesInbox && <TileLink to="/admin/inbox" icon={<Inbox className="size-5" aria-hidden />} title="Inbox" blurb="Everything waiting for a decision" />}
        {mod.any && !can('moderation_*') && (
          <TileLink to="/admin/reports" icon={<Flag className="size-5" aria-hidden />} title="Reports and slow mode" blurb="Posts and messages members flagged"
            badge={!!g?.reports_open && <Badge tone="danger">{g.reports_open}</Badge>} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {can('members_view') && <TileLink to="/admin/members" icon={<Users className="size-5" aria-hidden />} title="Members" blurb="Edit profiles, verify, import" />}
          {canAny(['funds_manage', 'funds_verify', 'funds_reports', 'sponsors_manage']) && <TileLink to="/admin/funds" icon={<HeartHandshake className="size-5" aria-hidden />} title="Funds" blurb="Appeals, donations, sponsors, expenses, reports" />}
          {can('analytics') && <TileLink to="/admin/analytics" icon={<BarChart3 className="size-5" aria-hidden />} title="Analytics" blurb="Growth, batches, engagement" />}
          {can('community_*') && <TileLink to="/admin/community" icon={<Network className="size-5" aria-hidden />} title="Community" blurb="Approve circles, spotlight, batch sizes" />}
          {seesReports && can('moderation_*') && (
            <TileLink to="/admin/reports" icon={<Flag className="size-5" aria-hidden />} title="Reports" blurb="Posts and messages members flagged"
              badge={!!g?.reports_open && <Badge tone="danger">{g.reports_open}</Badge>} />
          )}
          {canAny(['admins', 'events_team']) && <TileLink to="/admin/roles" icon={<KeyRound className="size-5" aria-hidden />} title="Roles" blurb="Admins, owners, treasurers, content managers, moderators" />}
          {can('health') && <TileLink to="/admin/health" icon={<Activity className="size-5" aria-hidden />} title="Health" blurb="Backups, push, storage" />}
          {can('audit') && <TileLink to="/admin/activity" icon={<History className="size-5" aria-hidden />} title="Activity log" blurb="Every admin change, with names" />}
        </div>
        <h2 className="pt-2 text-[13px] font-bold uppercase tracking-wide text-muted">Events</h2>
        {!data?.length ? (
          <EmptyState icon={<ShieldCheck />} title="No events yet" action={can('events_create') ? <ButtonLink to="/admin/events/new">Create the Alumni Meet</ButtonLink> : undefined}>
            {can('events_create') ? 'Create the event, set the fees and UPI details, then publish it.' : 'There are no events you can manage yet.'}
          </EmptyState>
        ) : (
          data.map(({ event, roles }) => (
            <Link key={event.id} to={`/admin/events/${event.slug}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{event.title}</p>
                <p className="text-sm text-muted">{formatDateRange(event.starts_at, event.ends_at)}</p>
              </div>
              {!event.is_published && <Badge tone="warning">Draft</Badge>}
              <Badge tone="primary">{access.is_admin ? (access.is_super ? 'Owner' : 'Admin') : roles.map((x) => ROLE_INFO[x].label).join(' + ')}</Badge>
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
