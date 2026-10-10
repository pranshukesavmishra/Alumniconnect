import { Lock, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { missing, permissionLabel, permissionsByGroup, PERMISSION_KEYS, scopeText, summarize, type RoleTemplate } from '../../lib/adminAccess'
import { BRANCHES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { useAdminAccess } from './access'
import { MemberPicker } from './MemberPicker'
import { useAdminAccessMutations, useAdminList, useRoleTemplates, type AdminListEntry } from './superQueries'

interface Person {
  id: string
  name: string
}

/**
 * Admins and owners. Everyone who may see the admin list sees the owners, and each admin's role and scope.
 * Owners are permanent: no button here can change or remove them, and the database refuses it from every route.
 * Only super admins see the permission chips and get the buttons: make an admin from a role, change it, remove it.
 */
export function AdminsAndOwners() {
  const me = useUserId()
  const { isSuper } = useAdminAccess()
  const list = useAdminList(true)
  const muts = useAdminAccessMutations()
  const [params, setParams] = useSearchParams()
  const [sheet, setSheet] = useState<{ person: Person | null; entry: AdminListEntry | null } | null>(null)

  // deep link from the member editor: /admin/roles?admin=<member id>
  const deepLink = params.get('admin')
  useEffect(() => {
    if (!deepLink || !isSuper || !list.data) return
    let alive = true
    const entry = list.data.admins.find((a) => a.id === deepLink) ?? null
    void (async () => {
      let name = entry?.full_name
      if (!name) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', deepLink).maybeSingle()
        name = (data?.full_name as string | undefined) ?? 'this member'
      }
      if (alive && !entry?.is_owner) setSheet({ person: { id: deepLink, name }, entry })
      if (alive) setParams((p) => { p.delete('admin'); return p }, { replace: true })
    })()
    return () => { alive = false }
  }, [deepLink, isSuper, list.data, setParams])

  const removeAdmin = (a: AdminListEntry) => {
    if (!window.confirm(`Remove admin access from ${a.full_name}?\n\nThey keep their member account but can no longer open any admin screen. This is written to the activity log and they are told.`)) return
    muts.setAdmin.mutate({ userId: a.id, enabled: false, permissions: null }, {
      onSuccess: (r) => toast.success(r.changed ? `${a.full_name} is no longer an admin` : 'They were not an admin'),
      onError: (e) => toast.error(friendlyError(e)),
    })
  }
  return (
    <section className="space-y-3" aria-label="Admins and owners" data-testid="admins-and-owners">
      <SectionTitle
        action={isSuper && <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setSheet({ person: null, entry: null })}>Make admin</Button>}
      >
        Admins and owners{list.data ? ` (${list.data.admins.length})` : ''}
      </SectionTitle>
      <Notice tone="info" title="Owners and admins">
        The <strong>owners</strong> run the app for good: they can do everything, they are the only people who can make admins, and their access is permanent and cannot be changed or removed from the app by anyone.
        Every other <strong>admin</strong> has a role (such as Treasurer or Department head) and can do only what that role allows, for everyone or for one department or batch. {isSuper ? 'Everything you change here is written to the activity log and the person is told.' : 'Only a super admin can change this list.'}
      </Notice>
      {list.error ? (
        <Notice tone="danger" title={friendlyError(list.error)} />
      ) : !list.data ? (
        <PageSkeleton />
      ) : list.data.admins.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title="No admins yet" />
      ) : (
        <Card className="divide-y divide-border" data-testid="admins-list">
          {list.data.admins.map((a) => (
            <div key={a.id} className="space-y-2 p-3" data-admin={a.id}>
              <div className="flex min-h-12 items-center gap-3">
                <Avatar src={a.avatar_url} name={a.full_name || '?'} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.full_name}{a.id === me ? ' (you)' : ''}</span>
                  <span className="block truncate text-sm text-muted">{[a.branch, a.grad_year].filter(Boolean).join(' · ')}</span>
                </span>
                {a.is_owner || a.is_super ? (
                  <Badge tone="warning"><Lock className="size-3" aria-hidden /> Owner · permanent</Badge>
                ) : a.full ? (
                  <Badge tone="primary">Full admin</Badge>
                ) : (
                  <Badge tone="neutral">{a.role_label}</Badge>
                )}
              </div>
              {scopeText(a.scope_kind, a.scope_value) && (
                <p className="text-sm font-semibold" data-testid="admin-scope">{scopeText(a.scope_kind, a.scope_value)}</p>
              )}
              {a.is_owner || a.is_super ? (
                <p className="text-sm text-muted">Everything, always. This access is permanent and has no edit or remove button.</p>
              ) : a.permissions ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={`What ${a.full_name} may do`}>
                  {a.full ? (
                    <li><Badge tone="success">Everything except admin access</Badge></li>
                  ) : (
                    a.permissions.map((k) => <li key={k}><Badge>{permissionLabel(k)}</Badge></li>)
                  )}
                </ul>
              ) : (
                !a.full && <p className="text-sm text-muted">Limited access ({a.permission_count} {a.permission_count === 1 ? 'permission' : 'permissions'})</p>
              )}
              {isSuper && (a.note || a.granted_by) && (
                <p className="text-xs text-muted">
                  {a.granted_by ? `Set by ${a.granted_by}` : ''}{a.granted_at ? ` on ${formatDate(a.granted_at)}` : ''}{a.note ? ` · “${a.note}”` : ''}
                </p>
              )}
              {isSuper && a.id !== me && !a.is_owner && !a.is_super && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" aria-label={`Edit permissions for ${a.full_name}`} onClick={() => setSheet({ person: { id: a.id, name: a.full_name }, entry: a })}>Change role</Button>
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} aria-label={`Remove admin access from ${a.full_name}`} onClick={() => removeAdmin(a)}>Remove admin access</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <p className="text-sm text-muted">Owners are permanent. Nobody can remove their own admin access either; an owner who truly must go needs the emergency database procedure described in the admin guide.</p>

      <AdminAccessSheet key={sheet ? `${sheet.person?.id ?? 'new'}` : 'closed'} state={sheet} onClose={() => setSheet(null)} />
    </section>
  )
}

// ------------------------------------------------------------------ make an admin / change their role
type Step = 'pick' | 'role' | 'scope' | 'review'

function AdminAccessSheet({ state, onClose }: { state: { person: Person | null; entry: AdminListEntry | null } | null; onClose: () => void }) {
  const muts = useAdminAccessMutations()
  const templates = useRoleTemplates(!!state)
  const entry = state?.entry ?? null
  const [person, setPerson] = useState<Person | null>(state?.person ?? null)
  const [step, setStep] = useState<Step>(state?.person ? 'role' : 'pick')
  const [roleKey, setRoleKey] = useState<string>(entry ? (entry.full ? 'full' : entry.role_key ?? 'custom') : 'moderator')
  const [scopeValue, setScopeValue] = useState<string>(entry?.scope_value ?? '')
  const [customise, setCustomise] = useState<boolean>(!!entry && !entry.full && !entry.role_key)
  const [custom, setCustom] = useState<string[]>(() => (entry && !entry.full ? entry.permissions ?? [] : []))
  const [note, setNote] = useState(entry?.note ?? '')
  const editing = !!entry

  const list: RoleTemplate[] = templates.data ?? []
  const tpl = list.find((t) => t.key === roleKey) ?? null
  const isCustomRole = roleKey === 'custom'
  const scopeKind = tpl && tpl.scope_kind !== 'none' ? tpl.scope_kind : null
  // what this admin will hold: null = full admin
  const perms: string[] | null = tpl?.full ? null : customise || isCustomRole ? custom : tpl?.permissions ?? []
  const can = perms ? PERMISSION_KEYS.filter((k) => perms.includes(k)) : null
  const cannot = missing(perms)
  const scopeOk = !scopeKind || (scopeKind === 'batch' ? /^[0-9]{4}$/.test(scopeValue) : scopeValue.length > 1)
  const scopeLine = scopeKind ? scopeText(scopeKind, scopeValue) : ''
  const roleLabel = isCustomRole ? 'Custom' : tpl?.label ?? ''

  const chooseRole = (key: string) => {
    setRoleKey(key)
    const t = list.find((x) => x.key === key)
    setCustomise(false)
    if (t && !t.full) setCustom(t.permissions)
    if (key === 'custom') setCustom((c) => (c.length ? c : []))
  }
  const toggle = (k: string, on: boolean) => setCustom((c) => (on ? [...new Set([...c, k])] : c.filter((x) => x !== k)))

  const save = () => {
    if (!person) return
    muts.setAdmin.mutate({
      userId: person.id, enabled: true, permissions: perms, note,
      template: isCustomRole ? null : roleKey, scopeKind: scopeKind, scopeValue: scopeKind ? scopeValue : null,
    }, {
      onSuccess: (r) => {
        toast.success(r.changed ? (editing ? `Saved ${person.name}’s role` : `${person.name} is now an admin`) : 'No change: they already had exactly this')
        onClose()
      },
      onError: (e) => toast.error(friendlyError(e)),
    })
  }

  return (
    <Sheet open={!!state} onClose={onClose} label={editing ? 'Edit admin permissions' : 'Make admin'}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{editing ? `What role has ${person?.name}?` : person ? `Make ${person.name} an admin` : 'Make admin'}</h2>

        {step === 'pick' && (
          <>
            <p className="text-sm text-muted">Find the member. They must have signed in once. Next you pick their role, which decides what they can do.</p>
            <MemberPicker actionLabel="Choose" onPick={(id, name) => { setPerson({ id, name }); setStep('role') }} />
          </>
        )}

        {step === 'role' && (
          <>
            {templates.error ? <Notice tone="danger" title={friendlyError(templates.error)} /> : !templates.data ? <PageSkeleton /> : (
              <ChoiceGroup<string>
                label="Choose a role"
                options={[...list.map((t) => ({ value: t.key, label: t.label, hint: t.description })), { value: 'custom', label: 'Custom', hint: 'Tick exactly what this admin may do.' }]}
                value={roleKey}
                onChange={chooseRole}
              />
            )}
            {!tpl?.full && tpl && (
              <details open={customise} onToggle={(e) => setCustomise((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">Customise permissions (optional)</summary>
                <PermissionPicker custom={custom} toggle={toggle} />
              </details>
            )}
            {isCustomRole && <PermissionPicker custom={custom} toggle={toggle} />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button disabled={!tpl && !isCustomRole || (perms !== null && perms.length === 0)} onClick={() => setStep(scopeKind ? 'scope' : 'review')}>Next</Button>
            </div>
          </>
        )}

        {step === 'scope' && scopeKind && (
          <>
            <p className="text-sm text-muted">
              {scopeKind === 'department'
                ? 'A department head sees and verifies only the members of this one department.'
                : 'A batch representative sees only the members of this one batch year.'}
            </p>
            {scopeKind === 'department' ? (
              <Field label="Department">
                {(p) => (
                  <Select {...p} value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                    <option value="">Choose the department</option>
                    {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Batch year" hint="The year they graduated, for example 2005.">
                {(p) => <Input {...p} inputMode="numeric" maxLength={4} value={scopeValue} onChange={(e) => setScopeValue(e.target.value.replace(/\D/g, ''))} />}
              </Field>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep('role')}>Back</Button>
              <Button disabled={!scopeOk} onClick={() => setStep('review')}>Review</Button>
            </div>
          </>
        )}

        {step === 'review' && person && (
          <>
            <div className="space-y-2 rounded-2xl bg-surface-2 p-3" data-testid="review">
              <p className="font-semibold">{roleLabel}{scopeLine ? ` · ${scopeLine}` : ''}</p>
              <p className="text-sm text-muted">{summarize(perms)}</p>
              {can && (
                <>
                  <p className="pt-1 text-sm font-semibold">{person.name} will be able to</p>
                  <ul className="flex flex-wrap gap-1.5">{can.map((k) => <li key={k}><Badge tone="success">{permissionLabel(k)}</Badge></li>)}</ul>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">…and will not be able to ({cannot.length})</summary>
                    <ul className="flex flex-wrap gap-1.5 pb-1">{cannot.map((l) => <li key={l}><Badge>{l}</Badge></li>)}</ul>
                  </details>
                </>
              )}
              {!can && <p className="text-sm">Everything an admin can do, including things added in future. They still cannot make or remove admins.</p>}
              {scopeLine && <p className="text-sm">Members they can see and change: {scopeLine.toLowerCase()} only.</p>}
            </div>
            <Field label="Note" optional hint="Why, or until when. Only super admins see it.">
              {(p) => <Textarea {...p} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <p className="text-sm text-muted">{person.name} is told about this, and it is written to the activity log.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep(scopeKind ? 'scope' : 'role')}>Back</Button>
              <Button loading={muts.setAdmin.isPending} onClick={save}>{editing ? 'Save changes' : `Make ${person.name} an admin`}</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

function PermissionPicker({ custom, toggle }: { custom: string[]; toggle: (k: string, on: boolean) => void }) {
  return (
    <div className="space-y-3" data-testid="custom-permissions">
      {permissionsByGroup().map(({ group, items }) => (
        <fieldset key={group} className="rounded-2xl border border-border p-3">
          <legend className="px-1 text-sm font-bold">{group}</legend>
          {items.map((p) => (
            <Checkbox key={p.key} checked={custom.includes(p.key)} onChange={(v) => toggle(p.key, v)}>
              <span className="block font-semibold">{p.label}</span>
              <span className="block text-sm text-muted">{p.description}</span>
            </Checkbox>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
