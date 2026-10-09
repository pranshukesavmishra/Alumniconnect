import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { ROLE_INFO } from '../../lib/roles'
import { RoleAssign } from './RoleAssign'
import { useEventStaff, useRoleMutations } from './queries'

/** The people on one event and the role each holds. Giving and removing roles is admin-only in the database too. */
export function AdminTeam({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const { data: staff, error, isLoading } = useEventStaff(eventId)
  const { revoke } = useRoleMutations(eventId)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Notice tone="info" title="Who can do what">
        <strong>Treasurers</strong> handle payments, refunds and registrations. <strong>Content managers</strong> send messages and edit the programme. <strong>Check-in volunteers</strong> only scan tickets and see names. Give someone both treasurer and content to let them do everything on this event. Ask team members to sign in once so you can find them here.
      </Notice>
      {error && <Notice tone="danger" title={friendlyError(error)} />}

      <section>
        <SectionTitle>Team for this event</SectionTitle>
        {isLoading ? (
          <PageSkeleton />
        ) : staff?.length ? (
          <Card className="divide-y divide-border" data-testid="team-list">
            {staff.map((s) => (
              <div key={`${s.user_id}:${s.role}`} className="flex items-center gap-3 p-3" data-role={s.role}>
                <Avatar src={s.profiles.avatar_url} name={s.profiles.full_name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.profiles.full_name}</p>
                  <Badge tone={ROLE_INFO[s.role].tone}>{ROLE_INFO[s.role].label}</Badge>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${ROLE_INFO[s.role].label} role from ${s.profiles.full_name}`}
                  className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  onClick={() => {
                    if (!window.confirm(`Remove the ${ROLE_INFO[s.role].label} role from ${s.profiles.full_name} on ${eventTitle}?`)) return
                    revoke.mutate({ userId: s.user_id, role: s.role }, { onSuccess: () => toast.success('Role removed'), onError: (e) => toast.error(friendlyError(e)) })
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState title="No one added yet">Search for a member below and give them a role.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Add someone</SectionTitle>
        <RoleAssign roles={['checkin', 'treasurer', 'content']} fixedEventId={eventId} events={[{ id: eventId, title: eventTitle }]} />
      </section>
    </div>
  )
}
