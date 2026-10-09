import { Check, Minus } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { useRolesOverview } from './queries'

/** What each role may do. This mirrors the database rules (is_admin / is_event_manager / event_staff); the database enforces it, not this table. */
const MATRIX: { what: string; admin: boolean; manager: boolean; checkin: boolean }[] = [
  { what: 'Scan tickets and see attendee names', admin: true, manager: true, checkin: true },
  { what: 'See registrations, phone numbers and amounts', admin: true, manager: true, checkin: false },
  { what: 'Verify payments and record cash', admin: true, manager: true, checkin: false },
  { what: 'Edit or cancel registrations', admin: true, manager: true, checkin: false },
  { what: 'Programme and announcements', admin: true, manager: true, checkin: false },
  { what: 'Create events, tickets and fees', admin: true, manager: false, checkin: false },
  { what: 'Choose who is on an event team', admin: true, manager: false, checkin: false },
  { what: 'Edit, verify and promote members', admin: true, manager: false, checkin: false },
  { what: 'Reports, circles, spotlight, analytics', admin: true, manager: false, checkin: false },
  { what: 'Read the activity log', admin: true, manager: false, checkin: false },
]

export function AdminRoles() {
  const { data: me, isLoading: meLoading } = useMyProfile()
  const { data, isLoading, error } = useRolesOverview(!!me?.is_admin)
  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />

  const byEvent = new Map<string, { title: string; slug: string; rows: NonNullable<typeof data>['staff'] }>()
  for (const s of data?.staff ?? []) {
    const g = byEvent.get(s.event_id) ?? { title: s.event_title, slug: s.event_slug, rows: [] }
    g.rows.push(s)
    byEvent.set(s.event_id, g)
  }

  return (
    <div>
      <PageHeader title="Roles" subtitle="Who can do what" back="/admin" />
      <Page className="space-y-6">
        <Notice tone="info" title="Three roles">
          <strong>Admins</strong> run the whole site. <strong>Treasurers / managers</strong> and <strong>check-in volunteers</strong> are chosen per event and only see that event. Every change here is written to the activity log.
        </Notice>

        <section>
          <SectionTitle>What each role can do</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="p-3 font-bold">Action</th>
                  <th scope="col" className="p-3 text-center font-bold">Admin</th>
                  <th scope="col" className="p-3 text-center font-bold">Treasurer</th>
                  <th scope="col" className="p-3 text-center font-bold">Check-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MATRIX.map((r) => (
                  <tr key={r.what}>
                    <th scope="row" className="p-3 font-medium">{r.what}</th>
                    {[r.admin, r.manager, r.checkin].map((yes, i) => (
                      <td key={i} className="p-3 text-center">
                        {yes ? <Check className="mx-auto size-4 text-success" aria-label="Yes" /> : <Minus className="mx-auto size-4 text-muted" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading ? (
          <PageSkeleton />
        ) : data ? (
          <>
            <section>
              <SectionTitle>Admins ({data.admins.length})</SectionTitle>
              <Card className="divide-y divide-border" data-testid="admins-list">
                {data.admins.map((a) => (
                  <Link key={a.id} to={`/admin/members?open=${a.id}`} className="flex min-h-14 items-center gap-3 p-3 hover:bg-surface-2">
                    <Avatar src={a.avatar_url} name={a.full_name || '?'} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.full_name}{a.id === me.id ? ' (you)' : ''}</span>
                      <span className="block truncate text-sm text-muted">{[a.branch, a.grad_year].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Badge tone="primary">Admin</Badge>
                  </Link>
                ))}
              </Card>
              <p className="mt-2 text-sm text-muted">Make or remove an admin from the member’s profile: Members, open the person, then “Make admin”. You cannot remove yourself.</p>
            </section>

            <section className="space-y-3">
              <SectionTitle>Event teams</SectionTitle>
              {byEvent.size === 0 ? (
                <EmptyState title="No event teams yet">Add treasurers and check-in volunteers from an event’s Team tab.</EmptyState>
              ) : (
                [...byEvent.values()].map((g) => (
                  <Card key={g.slug} className="divide-y divide-border" data-testid="event-team">
                    <Link to={`/admin/events/${g.slug}?tab=team`} className="block p-3 font-semibold text-primary hover:bg-surface-2">{g.title}</Link>
                    {g.rows.map((s) => (
                      <div key={s.user_id} className="flex min-h-14 items-center gap-3 p-3">
                        <Avatar src={s.avatar_url} name={s.full_name || '?'} size={36} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.full_name}</span>
                        <Badge tone={s.role === 'manager' ? 'accent' : 'neutral'}>{s.role === 'manager' ? 'Treasurer / manager' : 'Check-in volunteer'}</Badge>
                      </div>
                    ))}
                  </Card>
                ))
              )}
              {data.circle_admins > 0 && <p className="text-sm text-muted">{data.circle_admins} circle {data.circle_admins === 1 ? 'owner' : 'owners'} manage their own circle’s members. That is separate from the roles above.</p>}
            </section>
          </>
        ) : null}
      </Page>
    </div>
  )
}
