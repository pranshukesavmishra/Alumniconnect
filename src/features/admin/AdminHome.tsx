import { CalendarPlus, ChevronRight, ShieldCheck } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDateRange } from '../../lib/format'
import { useMyProfile } from '../auth/AuthProvider'
import { useManagedEvents } from './queries'

export function AdminHome() {
  const { data: me } = useMyProfile()
  const { data, isLoading, error } = useManagedEvents()
  if (isLoading || !me) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!me.is_admin && !data?.length) return <Navigate to="/" replace />
  if (data?.length === 1 && !me.is_admin) return <Navigate to={`/admin/events/${data[0]!.event.slug}`} replace />

  return (
    <div>
      <PageHeader
        title="Organise"
        subtitle="Events you manage"
        action={me.is_admin && <ButtonLink to="/admin/events/new" size="sm" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>}
      />
      <Page className="space-y-3">
        {!data?.length ? (
          <EmptyState icon={<ShieldCheck />} title="No events yet" action={<ButtonLink to="/admin/events/new">Create the Alumni Meet</ButtonLink>}>
            Create the event, set the fees and UPI details, then publish it.
          </EmptyState>
        ) : (
          data.map(({ event, role }) => (
            <Link key={event.id} to={`/admin/events/${event.slug}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{event.title}</p>
                <p className="text-sm text-muted">{formatDateRange(event.starts_at, event.ends_at)}</p>
              </div>
              {!event.is_published && <Badge tone="warning">Draft</Badge>}
              <Badge tone="primary">{role === 'manager' ? 'Manager' : 'Check-in'}</Badge>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          ))
        )}
      </Page>
    </div>
  )
}
