import { Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, Notice, SectionTitle } from '../../components/ui/Display'
import { Input, Select } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import type { Profile, StaffRole } from '../../lib/types'
import { searchProfiles, useEventStaff, useStaffMutations } from './queries'

export function AdminTeam({ eventId }: { eventId: string }) {
  const { data: staff, error } = useEventStaff(eventId)
  const { add, remove } = useStaffMutations(eventId)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [role, setRole] = useState<StaffRole>('checkin')

  useEffect(() => {
    if (q.trim().length < 2) return setResults([])
    const t = setTimeout(() => {
      searchProfiles(q.trim()).then(setResults, (e) => toast.error(friendlyError(e)))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Notice tone="info" title="Who can do what">
        <strong>Treasurers / managers</strong> see payments and registrations and verify payments. <strong>Check-in volunteers</strong> can only scan tickets and see names. Admins can do everything. Ask team members to sign in to the app once so you can find them here.
      </Notice>
      {error && <Notice tone="danger" title={friendlyError(error)} />}

      <section>
        <SectionTitle>Team for this event</SectionTitle>
        {staff?.length ? (
          <Card className="divide-y divide-border">
            {staff.map((s) => (
              <div key={s.user_id} className="flex items-center gap-3 p-3">
                <Avatar src={s.profiles.avatar_url} name={s.profiles.full_name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.profiles.full_name}</p>
                  <p className="text-sm text-muted">{s.role === 'manager' ? 'Treasurer / manager' : 'Check-in volunteer'}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${s.profiles.full_name}`}
                  className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  onClick={() => window.confirm(`Remove ${s.profiles.full_name} from the team?`) && remove.mutate(s.user_id, { onError: (e) => toast.error(friendlyError(e)) })}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-[15px] text-muted">No one added yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Add someone</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
          <Input type="search" aria-label="Search members by name" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="checkin">Check-in volunteer</option>
            <option value="manager">Treasurer / manager</option>
          </Select>
        </div>
        {results.length > 0 && (
          <Card className="divide-y divide-border">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3">
                <Avatar src={p.avatar_url} name={p.full_name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.full_name}</p>
                  <p className="truncate text-sm text-muted">{[p.branch, p.grad_year, p.city].filter(Boolean).join(' · ')}</p>
                </div>
                <Button
                  size="sm"
                  icon={<UserPlus className="size-4" />}
                  loading={add.isPending}
                  onClick={() =>
                    add.mutate(
                      { userId: p.id, role },
                      {
                        onSuccess: () => {
                          toast.success(`${p.full_name} added`)
                          setQ('')
                        },
                        onError: (e) => toast.error(friendlyError(e)),
                      },
                    )
                  }
                >
                  Add
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  )
}
