import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { describeTimelineItem, TIMELINE_GROUPS, type RawTimelineItem, type TimelineGroup } from '../../lib/memberTimeline'
import { useMyProfile } from '../auth/AuthProvider'
import { MemberNotes } from './AdminMembers'
import { useMemberTimeline } from './queries'

/** Everything done to or by one member: admin actions, registrations, payments, reports, notes. Admins only. */
export function AdminMemberTimeline() {
  const { id } = useParams()
  const { data: me, isLoading } = useMyProfile()
  const qc = useQueryClient()
  const { data, isLoading: loading, error } = useMemberTimeline(id, !!me?.is_admin)
  const [group, setGroup] = useState<TimelineGroup | 'all'>('all')
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const m = data?.member
  const lines = (data?.items ?? []).map((i) => ({ at: i.at, ...describeTimelineItem(i as RawTimelineItem) })).filter((l) => group === 'all' || l.group === group)
  return (
    <div>
      <PageHeader title={m?.full_name || 'Member history'} subtitle="Everything done to or by this member" back="/admin/members" />
      <Page className="space-y-4">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {loading ? <PageSkeleton /> : m && (
          <>
            <Card className="flex items-center gap-3 p-4">
              <Avatar src={m.avatar_url} name={m.full_name || '?'} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.full_name || '(no name yet)'}</p>
                <p className="truncate text-sm text-muted">{[m.branch, m.grad_year, m.city].filter(Boolean).join(' · ') || 'Profile not completed'}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.is_admin && <Badge tone="primary">Admin</Badge>}
                  {m.verification === 'verified' ? <Badge tone="success">Verified</Badge> : m.verification === 'rejected' ? <Badge tone="danger">Rejected</Badge> : <Badge>Not verified</Badge>}
                  {m.added_by_admin && <Badge>Added by an admin</Badge>}
                </div>
              </div>
              <Link to={`/admin/members?open=${m.id}`} className="grid min-h-11 place-items-center rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary-soft">Open profile</Link>
            </Card>
            <MemberNotes id={m.id} />
            <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
              {TIMELINE_GROUPS.map((g) => (
                <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${group === g.id ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  {g.label}
                </button>
              ))}
            </div>
            {lines.length === 0 ? (
              <EmptyState title="Nothing here yet" />
            ) : (
              <Card className="divide-y divide-border" data-testid="timeline">
                {lines.map((l, i) => (
                  <div key={i} className="p-4" data-kind={l.group}>
                    <p className="font-semibold">{l.title}</p>
                    {l.detail && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{l.detail}</p>}
                    <p className="mt-0.5 text-sm text-muted">{[l.by, formatDateTime(l.at)].filter(Boolean).join(' · ')}</p>
                    {l.href && <Link to={l.href} className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><ExternalLink className="size-4" aria-hidden /> Open</Link>}
                  </div>
                ))}
              </Card>
            )}
            <p className="text-center text-xs text-muted">Phone numbers and e-mail addresses are never shown here.</p>
            <button type="button" className="sr-only" onClick={() => void qc.invalidateQueries({ queryKey: ['admin-member-timeline', id] })}>Refresh</button>
          </>
        )}
      </Page>
    </div>
  )
}
