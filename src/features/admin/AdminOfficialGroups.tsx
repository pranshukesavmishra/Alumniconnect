import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pencil, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Notice, Skeleton, SectionTitle } from '../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { MemberPicker } from './MemberPicker'

interface DeptGroup {
  id: string
  kind: 'official' | 'department'
  slug: string
  name: string
  description: string | null
  icon: string | null
  branch: string | null
  post_mode: 'everyone' | 'staff_only'
  comments_allowed: boolean
  slow_mode_seconds: number
  member_count: number
  admins: { id: string; name: string }[]
}

const KEY = ['admin-department-groups']

function useDeptGroups() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_department_groups')
      if (error) throw error
      return (data ?? []) as unknown as DeptGroup[]
    },
  })
}

/** Admin: the official group and the department groups: group admins, who may post, name and description, member counts. */
export function AdminOfficialGroups() {
  const q = useDeptGroups()
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section aria-labelledby="dept-groups-title" data-testid="admin-dept-groups">
      <SectionTitle><span id="dept-groups-title">Official and department groups</span></SectionTitle>
      <p className="mb-3 text-sm text-muted">Everyone is in the official group and in the group of their department. Name the Head of Department as a group admin so they can pin and remove messages.</p>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.error ? (
        <Notice tone="danger" title={friendlyError(q.error)} />
      ) : !q.data?.length ? (
        <EmptyState icon={<Megaphone />} title="No groups yet" />
      ) : (
        <ul className="space-y-3">
          {q.data.map((g) => (
            <li key={g.id}>
              <Card className="space-y-3 p-4" data-group={g.slug}>
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-2xl" aria-hidden>{g.icon ?? '👥'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{g.name}</p>
                    <p className="text-sm text-muted">
                      {g.member_count} {g.member_count === 1 ? 'member' : 'members'} · {g.post_mode === 'staff_only' ? 'Only staff post' : 'Everyone posts'}
                      {g.post_mode === 'staff_only' && (g.comments_allowed ? ' · replies on' : ' · replies off')}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(editing === g.id ? null : g.id)} aria-expanded={editing === g.id}>
                    Manage
                  </Button>
                </div>
                {editing === g.id && <GroupEditor g={g} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GroupEditor({ g }: { g: DeptGroup }) {
  const qc = useQueryClient()
  const [name, setName] = useState(g.name)
  const [desc, setDesc] = useState(g.description ?? '')
  const [mode, setMode] = useState<string>(g.post_mode)
  const [comments, setComments] = useState(g.comments_allowed ? 'yes' : 'no')
  const [adding, setAdding] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_update_group', { p_group: g.id, p_name: name, p_description: desc, p_post_mode: mode, p_comments_allowed: comments === 'yes' })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Group saved'); void refresh(); void qc.invalidateQueries({ queryKey: ['groups'] }); void qc.invalidateQueries({ queryKey: ['chats'] }) },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const setAdmin = useMutation({
    mutationFn: async (v: { user: string; admin: boolean }) => {
      const { error } = await supabase.rpc('admin_set_group_admin', { p_group: g.id, p_user: v.user, p_admin: v.admin })
      if (error) throw error
    },
    onSuccess: (_d, v) => { toast.success(v.admin ? 'Group admin added' : 'Group admin removed'); setAdding(false); void refresh(); void qc.invalidateQueries({ queryKey: ['groups'] }) },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <Field label="Group name">{(p) => <Input {...p} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Description" optional>{(p) => <Textarea {...p} value={desc} maxLength={500} rows={3} onChange={(e) => setDesc(e.target.value)} />}</Field>
      <Field label="Who can post">
        {(p) => (
          <Select {...p} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="everyone">Everyone in the group</option>
            <option value="staff_only">Only staff (admins, moderators, group admins)</option>
          </Select>
        )}
      </Field>
      {mode === 'staff_only' && (
        <Field label="Can members reply?" hint="Members can always read and react. When replies are on they can answer a message.">
          {(p) => (
            <Select {...p} value={comments} onChange={(e) => setComments(e.target.value)}>
              <option value="yes">Yes, members can reply</option>
              <option value="no">No, read and react only</option>
            </Select>
          )}
        </Field>
      )}
      <Button loading={save.isPending} onClick={() => save.mutate()}>Save group</Button>

      <div className="space-y-2">
        <p className="font-semibold">Group admins</p>
        {g.admins.length === 0 ? <p className="text-sm text-muted">No group admin yet.</p> : (
          <ul className="space-y-1.5">
            {g.admins.map((a) => (
              <li key={a.id} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3">
                <span className="truncate">{a.name}</span>
                <button type="button" aria-label={`Remove ${a.name} as group admin`} className="grid size-9 place-items-center rounded-full hover:bg-surface"
                  onClick={() => window.confirm(`Remove ${a.name} as admin of ${g.name}?`) && setAdmin.mutate({ user: a.id, admin: false })}>
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <MemberPicker actionLabel="Make admin" busy={setAdmin.isPending} onPick={(id) => setAdmin.mutate({ user: id, admin: true })} />
        ) : (
          <Button size="sm" variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add a group admin</Button>
        )}
      </div>
    </div>
  )
}
