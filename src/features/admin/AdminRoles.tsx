import { Check, Minus, Trash2 } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { MATRIX, ROLE_INFO } from '../../lib/roles'
import { useMyProfile } from '../auth/AuthProvider'
import { RoleAssign } from './RoleAssign'
import { useManagedEvents, useRoleMutations, useRolesOverview } from './queries'

const COLS = ['admin', 'treasurer', 'content', 'moderator', 'checkin'] as const

/** Who holds which role, and where admins give or remove them. Every change is confirmed and written to the activity log. */
export function AdminRoles() {
  const { data: me, isLoading: meLoading } = useMyProfile()
  const { data, isLoading, error } = useRolesOverview(!!me?.is_admin)
  const events = useManagedEvents()
  const { revoke } = useRoleMutations()
  if (meLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />

  const byEvent = new Map<string, { title: string; slug: string; rows: NonNullable<typeof data>['staff'] }>()
  for (const s of data?.staff ?? []) {
    const g = byEvent.get(s.event_id) ?? { title: s.event_title, slug: s.event_slug, rows: [] }
    g.rows.push(s)
    byEvent.set(s.event_id, g)
  }
  const remove = (userId: string, name: string, role: 'admin' | 'moderator' | 'treasurer' | 'content' | 'checkin', eventId?: string, where?: string) => {
    if (!window.confirm(`Remove the ${ROLE_INFO[role].label} role from ${name}${where ? ` on ${where}` : ''}?${role === 'admin' ? '\n\nThey will lose all admin access.' : ''}`)) return
    revoke.mutate({ userId, role, eventId }, { onSuccess: (c) => toast.success(c ? 'Role removed' : 'They no longer had this role'), onError: (e) => toast.error(friendlyError(e)) })
  }
  const RemoveBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button type="button" aria-label={label} onClick={onClick} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger">
      <Trash2 className="size-4" />
    </button>
  )

  return (
    <div>
      <PageHeader title="Roles" subtitle="Who can do what" back="/admin" />
      <Page className="space-y-6">
        <Notice tone="info" title="Five roles">
          <strong>Admins</strong> run the whole site. <strong>Moderators</strong> handle reports across the community. <strong>Treasurers</strong>, <strong>content managers</strong> and <strong>check-in volunteers</strong> are chosen per event and only see that event. The database enforces this, not just the screens. Every change is written to the activity log.
        </Notice>

        <section>
          <SectionTitle>What each role can do</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="p-3 font-bold">Action</th>
                  {COLS.map((c) => <th key={c} scope="col" className="p-3 text-center font-bold">{ROLE_INFO[c].label.replace(' volunteer', '').replace(' manager', '')}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MATRIX.map((r) => (
                  <tr key={r.what}>
                    <th scope="row" className="p-3 font-medium">{r.what}</th>
                    {COLS.map((c) => (
                      <td key={c} className="p-3 text-center">
                        {r.roles.includes(c) ? <Check className="mx-auto size-4 text-success" aria-label="Yes" /> : <Minus className="mx-auto size-4 text-muted" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionTitle>Give a role</SectionTitle>
          <RoleAssign roles={['admin', 'moderator', 'treasurer', 'content', 'checkin']} events={(events.data ?? []).map((e) => ({ id: e.event.id, title: e.event.title }))} />
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
                  <div key={a.id} className="flex min-h-14 items-center gap-1 pr-1 hover:bg-surface-2">
                    <Link to={`/admin/members?open=${a.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3">
                      <Avatar src={a.avatar_url} name={a.full_name || '?'} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{a.full_name}{a.id === me.id ? ' (you)' : ''}</span>
                        <span className="block truncate text-sm text-muted">{[a.branch, a.grad_year].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Badge tone="primary">Admin</Badge>
                    </Link>
                    {a.id !== me.id && data.admins.length > 1 && <RemoveBtn label={`Remove admin access from ${a.full_name}`} onClick={() => remove(a.id, a.full_name, 'admin')} />}
                  </div>
                ))}
              </Card>
              <p className="mt-2 text-sm text-muted">You cannot remove your own admin access, and there is always at least one admin.</p>
            </section>

            <section>
              <SectionTitle>Moderators ({data.moderators.length})</SectionTitle>
              {data.moderators.length === 0 ? (
                <EmptyState title="No moderators yet">Give the Moderator role to someone who can review reports.</EmptyState>
              ) : (
                <Card className="divide-y divide-border" data-testid="moderators-list">
                  {data.moderators.map((a) => (
                    <div key={a.id} className="flex min-h-14 items-center gap-3 p-3">
                      <Avatar src={a.avatar_url} name={a.full_name || '?'} size={40} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{a.full_name}</span>
                      <Badge tone="warning">Moderator</Badge>
                      <RemoveBtn label={`Remove moderator role from ${a.full_name}`} onClick={() => remove(a.id, a.full_name, 'moderator')} />
                    </div>
                  ))}
                </Card>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle>Event teams</SectionTitle>
              {byEvent.size === 0 ? (
                <EmptyState title="No event teams yet">Give treasurer, content or check-in roles above, or from an event’s Team tab.</EmptyState>
              ) : (
                [...byEvent.entries()].map(([eventId, g]) => (
                  <Card key={g.slug} className="divide-y divide-border" data-testid="event-team">
                    <Link to={`/admin/events/${g.slug}?tab=team`} className="block p-3 font-semibold text-primary hover:bg-surface-2">{g.title}</Link>
                    {g.rows.map((s) => (
                      <div key={`${s.user_id}:${s.role}`} className="flex min-h-14 items-center gap-3 p-3">
                        <Avatar src={s.avatar_url} name={s.full_name || '?'} size={36} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.full_name}</span>
                        <Badge tone={ROLE_INFO[s.role].tone}>{ROLE_INFO[s.role].label}</Badge>
                        <RemoveBtn label={`Remove ${ROLE_INFO[s.role].label} role from ${s.full_name} on ${g.title}`} onClick={() => remove(s.user_id, s.full_name, s.role, eventId, g.title)} />
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
