import { useState } from 'react'
import { toast } from 'sonner'
import { Card, Notice } from '../../components/ui/Display'
import { Field, Select } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { ROLE_INFO, type RoleId } from '../../lib/roles'
import { MemberPicker } from './MemberPicker'
import { useRoleMutations, type GrantableRole } from './queries'

/** Pick a member and a role, confirm, give it. Event roles need an event: fixed on the Team tab, chosen on the Roles page. */
export function RoleAssign({ events, fixedEventId, roles }: { events: { id: string; title: string }[]; fixedEventId?: string; roles: RoleId[] }) {
  const [role, setRole] = useState<RoleId>(roles[0]!)
  const [eventId, setEventId] = useState(fixedEventId ?? events[0]?.id ?? '')
  const { grant } = useRoleMutations()
  const needsEvent = ROLE_INFO[role].scope === 'event'
  const eventTitle = events.find((e) => e.id === (fixedEventId ?? eventId))?.title

  return (
    <Card className="space-y-3 p-4">
      <div className={fixedEventId ? '' : 'grid gap-3 sm:grid-cols-2'}>
        <Field label="Role" hint={ROLE_INFO[role].blurb}>
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
            </Select>
          )}
        </Field>
        {needsEvent && !fixedEventId && (
          <Field label="Event">
            {(p) => (
              <Select {...p} value={eventId} onChange={(e) => setEventId(e.target.value)}>
                {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </Select>
            )}
          </Field>
        )}
      </div>
      {needsEvent && !fixedEventId && events.length === 0 && <Notice tone="warning" title="Create an event first: this role belongs to one event." />}
      <MemberPicker
        actionLabel="Give role"
        busy={grant.isPending}
        onPick={(id, name) => {
          if (needsEvent && !(fixedEventId ?? eventId)) return toast.error('Choose the event first.')
          const where = needsEvent ? ` for ${eventTitle}` : ''
          if (!window.confirm(`Give ${name} the ${ROLE_INFO[role].label} role${where}?\n\n${ROLE_INFO[role].blurb}`)) return
          grant.mutate(
            { userId: id, role: role as GrantableRole, eventId: needsEvent ? (fixedEventId ?? eventId) : undefined },
            { onSuccess: (changed) => toast.success(changed ? `${name} is now ${ROLE_INFO[role].label}${where}` : `${name} already had this role`), onError: (e) => toast.error(friendlyError(e)) },
          )
        }}
      />
    </Card>
  )
}
