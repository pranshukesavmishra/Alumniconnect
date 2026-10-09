import { Eye } from 'lucide-react'
import { Navigate, useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { useMyProfile } from '../auth/AuthProvider'
import { useViewAsMember } from './queries'

/** A read-only picture of what one member sees. Nothing here can change anything, and phone/e-mail are never loaded. */
export function AdminViewAs() {
  const { id } = useParams()
  const { data: me, isLoading: meLoading } = useMyProfile()
  const q = useViewAsMember(me?.is_admin ? id : undefined)
  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const d = q.data
  return (
    <div>
      <PageHeader title="View as member" subtitle="Read-only preview" back={`/admin/members/${id}`} />
      <Page className="space-y-4">
        <Notice tone="warning" title={<span className="inline-flex items-center gap-2"><Eye className="size-4" aria-hidden /> Read-only preview{d ? ` of ${d.profile.full_name}` : ''}</span>}>
          This is what the member sees. You cannot act as them, and nothing on this page changes anything. Opening it is written to the activity log.
        </Notice>
        {q.isError ? (
          <Notice tone="danger" title={friendlyError(q.error)} />
        ) : q.isLoading || !d ? (
          <PageSkeleton />
        ) : (
          <div data-testid="member-preview" className="space-y-4">
            <Card className="flex items-center gap-3 p-4">
              <Avatar src={d.profile.avatar_url} name={d.profile.full_name || '?'} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{d.profile.full_name || '(no name yet)'}</p>
                <p className="truncate text-sm text-muted">{[d.profile.current_title, d.profile.current_company].filter(Boolean).join(' at ') || d.profile.headline || ''}</p>
                <p className="truncate text-sm text-muted">{[d.profile.branch, d.profile.grad_year, d.profile.city].filter(Boolean).join(' · ')}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.profile.verification === 'verified' ? <Badge tone="success">Verified</Badge> : d.profile.verification === 'rejected' ? <Badge tone="danger">Rejected</Badge> : <Badge tone="warning">Waiting for verification</Badge>}
                  {!d.profile.onboarded && <Badge>Profile not finished</Badge>}
                  {d.profile.language === 'hi' && <Badge>हिन्दी</Badge>}
                </div>
              </div>
            </Card>
            {d.profile.verification !== 'verified' && <Notice tone="info" title="This member cannot see the directory yet">Profiles are visible to verified JEC members only.</Notice>}

            <section>
              <SectionTitle>Registrations</SectionTitle>
              {d.registrations.length === 0 ? (
                <EmptyState title="No registrations" />
              ) : (
                <Card className="divide-y divide-border">
                  {d.registrations.map((r) => (
                    <div key={r.id} className="space-y-1 p-4">
                      <p className="font-semibold">{r.event_title} <span className="font-normal text-muted">· {r.code}</span></p>
                      <p className="text-sm text-muted">{r.status.replace('_', ' ')} · {r.headcount} {r.headcount === 1 ? 'person' : 'people'} · {formatPaise(r.amount_paise)}{r.checked_in ? ' · checked in' : ''}</p>
                      {r.payments.map((p, i) => <p key={i} className="text-sm">Payment {formatPaise(p.amount_paise)} via {p.method.replace('_', ' ')}: {p.status}</p>)}
                    </div>
                  ))}
                </Card>
              )}
            </section>

            <section>
              <SectionTitle>Circles and groups</SectionTitle>
              {d.groups.length === 0 ? <p className="text-sm text-muted">Not in any group.</p> : <div className="flex flex-wrap gap-2">{d.groups.map((g) => <Badge key={g.id}>{g.name}</Badge>)}</div>}
            </section>

            <section>
              <SectionTitle>Notifications ({d.unread} unread)</SectionTitle>
              {d.notifications.length === 0 ? (
                <p className="text-sm text-muted">No notifications.</p>
              ) : (
                <Card className="divide-y divide-border">
                  {d.notifications.map((n, i) => (
                    <div key={i} className="p-3">
                      <p className={n.unread ? 'font-semibold' : ''}>{n.body ?? n.kind}</p>
                      <p className="text-xs text-muted" title={formatDateTime(n.created_at)}>{relativeTime(n.created_at)}</p>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          </div>
        )}
      </Page>
    </div>
  )
}
