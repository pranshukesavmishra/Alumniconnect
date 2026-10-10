import { Crown, KeyRound, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { missing, permissionLabel, permissionsByGroup, PERMISSION_KEYS, presetFor, PRESETS, summarize } from '../../lib/adminAccess'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { useAdminAccess } from './access'
import { MemberPicker } from './MemberPicker'
import { useAdminAccessMutations, useAdminList, type AdminListEntry } from './superQueries'

const SUPER_PHRASE = 'MAKE SUPER ADMIN'
const TRANSFER_PHRASE = 'TRANSFER OWNERSHIP'

interface Person {
  id: string
  name: string
}

/**
 * Admins and owners. Everyone who may see the admin list sees who is a super admin and who is a full or limited admin.
 * Only super admins see the permission chips and get the buttons: make an admin, choose what they may do, remove them,
 * make a second owner, hand ownership over. The database refuses all of it for anyone else.
 */
export function AdminsAndOwners() {
  const me = useUserId()
  const { isSuper } = useAdminAccess()
  const list = useAdminList(true)
  const muts = useAdminAccessMutations()
  const [params, setParams] = useSearchParams()
  const [sheet, setSheet] = useState<{ person: Person | null; entry: AdminListEntry | null } | null>(null)
  const [superFor, setSuperFor] = useState<Person | null>(null)
  const [transfer, setTransfer] = useState(false)

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
      if (alive && !entry?.is_super) setSheet({ person: { id: deepLink, name }, entry })
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
  const removeSuper = (a: AdminListEntry) => {
    if (!window.confirm(`Remove super admin status from ${a.full_name}?\n\nThey stay a full admin. At least one super admin must always remain.`)) return
    muts.setSuper.mutate({ userId: a.id, enabled: false }, {
      onSuccess: (r) => toast.success(r.changed ? `${a.full_name} is now a full admin, not a super admin` : 'No change'),
      onError: (e) => toast.error(friendlyError(e)),
    })
  }

  return (
    <section className="space-y-3" aria-label="Admins and owners" data-testid="admins-and-owners">
      <SectionTitle
        action={isSuper && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setSheet({ person: null, entry: null })}>Make admin</Button>
            <Button size="sm" variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setTransfer(true)}>Transfer ownership</Button>
          </div>
        )}
      >
        Admins and owners{list.data ? ` (${list.data.admins.length})` : ''}
      </SectionTitle>
      <Notice tone="info" title="Owners and admins">
        <strong>Super admins</strong> own the app: they can do everything and are the only people who can make admins, choose what each admin may do, or hand over ownership.
        An <strong>admin</strong> can do only what a super admin allowed. {isSuper ? 'Everything you change here is written to the activity log and the person is told.' : 'Only a super admin can change this list.'}
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
                {a.is_super ? (
                  <Badge tone="warning"><Crown className="size-3" aria-hidden /> Super admin</Badge>
                ) : a.full ? (
                  <Badge tone="primary">Full admin</Badge>
                ) : (
                  <Badge tone="neutral">Limited admin</Badge>
                )}
              </div>
              {a.permissions ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={`What ${a.full_name} may do`}>
                  {a.full ? (
                    <li><Badge tone="success">{a.is_super ? 'Everything, including admin access' : 'Everything except admin access'}</Badge></li>
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
              {isSuper && a.id !== me && (
                <div className="flex flex-wrap gap-2">
                  {a.is_super ? (
                    <Button size="sm" variant="danger-ghost" aria-label={`Remove super admin status from ${a.full_name}`} onClick={() => removeSuper(a)}>Remove super admin status</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" aria-label={`Edit permissions for ${a.full_name}`} onClick={() => setSheet({ person: { id: a.id, name: a.full_name }, entry: a })}>Edit permissions</Button>
                      <Button size="sm" variant="secondary" icon={<Crown className="size-4" />} aria-label={`Make ${a.full_name} a super admin`} onClick={() => setSuperFor({ id: a.id, name: a.full_name })}>Make super admin</Button>
                      <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} aria-label={`Remove admin access from ${a.full_name}`} onClick={() => removeAdmin(a)}>Remove admin access</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <p className="text-sm text-muted">There is always at least one super admin. Nobody can remove their own admin access: another super admin does it, or you hand over ownership.</p>

      <AdminAccessSheet key={sheet ? `${sheet.person?.id ?? 'new'}` : 'closed'} state={sheet} onClose={() => setSheet(null)} />
      <SuperSheet person={superFor} onClose={() => setSuperFor(null)} />
      <TransferSheet open={transfer} onClose={() => setTransfer(false)} />
    </section>
  )
}

// ------------------------------------------------------------------ make an admin / edit what they may do
function AdminAccessSheet({ state, onClose }: { state: { person: Person | null; entry: AdminListEntry | null } | null; onClose: () => void }) {
  const muts = useAdminAccessMutations()
  const entry = state?.entry ?? null
  const startPerms: string[] | null = entry ? (entry.full ? null : entry.permissions ?? []) : null
  const [person, setPerson] = useState<Person | null>(state?.person ?? null)
  const [step, setStep] = useState<'pick' | 'preset' | 'review'>(state?.person ? 'preset' : 'pick')
  const [presetId, setPresetId] = useState<string>(entry ? presetFor(startPerms) : 'moderation')
  const [custom, setCustom] = useState<string[]>(() => (startPerms ?? []))
  const [note, setNote] = useState(entry?.note ?? '')
  const editing = !!entry

  const preset = PRESETS.find((p) => p.id === presetId)!
  // what this admin will hold: null = full admin
  const perms: string[] | null = presetId === 'custom' ? custom : preset.permissions
  const can = perms ? PERMISSION_KEYS.filter((k) => perms.includes(k)) : null
  const cannot = missing(perms)

  const choosePreset = (id: string) => {
    setPresetId(id)
    const p = PRESETS.find((x) => x.id === id)!
    // picking a ready-made set pre-ticks the custom list, so "Custom" starts from the last choice
    if (id !== 'custom') setCustom(p.permissions ?? [...PERMISSION_KEYS].filter((k) => k !== 'admins'))
  }
  const toggle = (k: string, on: boolean) => setCustom((c) => (on ? [...new Set([...c, k])] : c.filter((x) => x !== k)))

  const save = () => {
    if (!person) return
    muts.setAdmin.mutate({ userId: person.id, enabled: true, permissions: perms, note }, {
      onSuccess: (r) => {
        toast.success(r.changed ? (editing ? `Saved what ${person.name} may do` : `${person.name} is now an admin`) : 'No change: they already had exactly this')
        onClose()
      },
      onError: (e) => toast.error(friendlyError(e)),
    })
  }

  return (
    <Sheet open={!!state} onClose={onClose} label={editing ? 'Edit admin permissions' : 'Make admin'}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{editing ? `What may ${person?.name} do?` : person ? `Make ${person.name} an admin` : 'Make admin'}</h2>

        {step === 'pick' && (
          <>
            <p className="text-sm text-muted">Find the member. They must have signed in once. They can only do what you allow in the next step.</p>
            <MemberPicker actionLabel="Choose" onPick={(id, name) => { setPerson({ id, name }); setStep('preset') }} />
          </>
        )}

        {step === 'preset' && (
          <>
            <ChoiceGroup<string>
              label="What may they do?"
              options={PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.blurb }))}
              value={presetId}
              onChange={choosePreset}
            />
            {presetId === 'custom' && (
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
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button disabled={presetId === 'custom' && custom.length === 0} onClick={() => setStep('review')}>Review</Button>
            </div>
          </>
        )}

        {step === 'review' && person && (
          <>
            <div className="space-y-2 rounded-2xl bg-surface-2 p-3" data-testid="review">
              <p className="font-semibold">{presetId === 'custom' ? 'Custom' : preset.label}</p>
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
            </div>
            <Field label="Note" optional hint="Why, or until when. Only super admins see it.">
              {(p) => <Textarea {...p} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <p className="text-sm text-muted">{person.name} is told about this, and it is written to the activity log.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep('preset')}>Back</Button>
              <Button loading={muts.setAdmin.isPending} onClick={save}>{editing ? 'Save changes' : `Make ${person.name} an admin`}</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ------------------------------------------------------------------ make a super admin (typed confirmation)
function SuperSheet({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const muts = useAdminAccessMutations()
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [person?.id])
  const ok = typed.trim().toUpperCase() === SUPER_PHRASE
  return (
    <Sheet open={!!person} onClose={onClose} label="Make super admin">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">Make {person?.name} a super admin?</h2>
        <Notice tone="warning" title="All access">
          A super admin can do everything an admin can, and also make and remove admins, choose what each admin may do, remove other super admins and hand over ownership. Only do this for someone who co-owns the app.
        </Notice>
        <Field label={`Type ${SUPER_PHRASE} to confirm`}>
          {(p) => <Input {...p} autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!ok}
            loading={muts.setSuper.isPending}
            onClick={() => person && muts.setSuper.mutate({ userId: person.id, enabled: true }, {
              onSuccess: (r) => { toast.success(r.changed ? `${person.name} is now a super admin` : 'They already were'); onClose() },
              onError: (e) => toast.error(friendlyError(e)),
            })}
          >
            Make super admin
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

// ------------------------------------------------------------------ transfer ownership
function TransferSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const muts = useAdminAccessMutations()
  const [person, setPerson] = useState<Person | null>(null)
  const [how, setHow] = useState<'share' | 'handover'>('handover')
  const [typed, setTyped] = useState('')
  const step = useMemo(() => (!person ? 'pick' : 'confirm'), [person])
  useEffect(() => {
    if (!open) { setPerson(null); setTyped(''); setHow('handover') }
  }, [open])
  const ok = typed.trim().toUpperCase() === TRANSFER_PHRASE

  return (
    <Sheet open={open} onClose={onClose} label="Transfer ownership">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">Transfer ownership</h2>
        {step === 'pick' ? (
          <>
            <p className="text-sm text-muted">Choose who becomes a super admin. Use this when a new committee takes over. They are told straight away.</p>
            <MemberPicker actionLabel="Choose" onPick={(id, name) => setPerson({ id, name })} />
          </>
        ) : (
          <>
            <ChoiceGroup<'share' | 'handover'>
              label={`How should ${person!.name} get ownership?`}
              options={[
                { value: 'handover', label: 'Hand over and step down', hint: 'They become a super admin and you stop being one in the same moment. You stay a full admin until they remove you.' },
                { value: 'share', label: 'Add them as an owner', hint: 'They become a super admin and you stay one. Two owners.' },
              ]}
              value={how}
              onChange={setHow}
            />
            <Notice tone="warning" title="Read this first">
              {how === 'handover'
                ? `${person!.name} will own the app: they can make and remove admins and super admins, including you. You lose the power to do that. This cannot be undone by you.`
                : `${person!.name} will have the same power as you: they can make and remove admins and super admins, including you.`}
            </Notice>
            <Field label={`Type ${TRANSFER_PHRASE} to confirm`}>
              {(p) => <Input {...p} autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setPerson(null)}>Back</Button>
              <Button
                variant={how === 'handover' ? 'danger' : 'primary'}
                disabled={!ok}
                loading={muts.transfer.isPending}
                onClick={() => muts.transfer.mutate({ toUser: person!.id, stepDown: how === 'handover' }, {
                  onSuccess: (r) => { toast.success(r.changed ? (how === 'handover' ? `${person!.name} now owns the app` : `${person!.name} is now an owner too`) : 'No change'); onClose() },
                  onError: (e) => toast.error(friendlyError(e)),
                })}
              >
                Transfer ownership
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
