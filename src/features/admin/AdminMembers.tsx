import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Copy, Eye, Plus, Search, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Sheet } from '../../components/ui/Sheet'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, MEMBER_TYPES, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Profile, VerificationStatus } from '../../lib/types'
import { useMyProfile } from '../auth/AuthProvider'

const PAGE = 40

export function AdminMembers() {
  const { data: me, isLoading } = useMyProfile()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [filter, setFilter] = useState<'all' | VerificationStatus | 'admins'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const list = useInfiniteQuery({
    queryKey: ['admin-members', dq, filter],
    enabled: !!me?.is_admin,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('profiles').select('*').order('created_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1)
      if (dq) {
        const s = dq.replace(/[%,()]/g, ' ')
        query = query.or(`full_name.ilike.%${s}%,city.ilike.%${s}%,current_company.ilike.%${s}%,branch.ilike.%${s}%`)
      }
      if (filter === 'admins') query = query.eq('is_admin', true)
      else if (filter !== 'all') query = query.eq('verification', filter)
      const { data, error } = await query
      if (error) throw error
      return data as Profile[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })

  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const rows = list.data?.pages.flat() ?? []

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Edit any profile, verify members, manage admins"
        back="/admin"
        action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add member</Button>}
      />
      <Page wide className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" aria-label="Search members" placeholder="Name, city, company, branch…" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All members</option>
            <option value="pending">Not yet verified</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="admins">Admins</option>
          </Select>
        </div>
        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {list.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No members found" />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenId(p.id)} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-surface-2">
                  <Avatar src={p.avatar_url} name={p.full_name || '?'} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.full_name || '(no name yet)'}</p>
                    <p className="truncate text-sm text-muted">{[p.branch, p.grad_year, p.city].filter(Boolean).join(' · ') || 'Profile not completed'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {p.is_admin && <Badge tone="primary"><ShieldCheck className="size-3" aria-hidden /> Admin</Badge>}
                    {p.verification === 'verified' ? <Badge tone="success">Verified</Badge> : p.verification === 'rejected' ? <Badge tone="danger">Rejected</Badge> : <Badge tone="neutral">Not verified</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Show more
          </Button>
        )}
      </Page>
      <AddMemberSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(newId) => {
          setAdding(false)
          void list.refetch()
          setOpenId(newId)
        }}
      />
      {openId && <MemberEditor id={openId} isSelf={openId === me.id} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function MemberEditor({ id, isSelf, onClose }: { id: string; isSelf: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-member', id],
    queryFn: async () => {
      const [p, priv] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('profile_private').select('phone').eq('id', id).maybeSingle(),
      ])
      if (p.error) throw p.error
      return { profile: p.data as Profile, phone: (priv.data?.phone as string | null) ?? '' }
    },
  })
  const [f, setF] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data && !f) {
      const p = data.profile
      setF({
        full_name: p.full_name, member_type: p.member_type ?? '', branch: p.branch ?? '', grad_year: p.grad_year ? String(p.grad_year) : '',
        join_year: p.join_year ? String(p.join_year) : '', city: p.city ?? '', current_title: p.current_title ?? '', current_company: p.current_company ?? '',
        phone: data.phone,
        headline: p.headline ?? '', about: p.about ?? '', linkedin_url: p.linkedin_url ?? '', website_url: p.website_url ?? '', country: p.country ?? '',
        skills: p.skills.join(', '),
      })
    }
  }, [data, f])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-members'] })
    void qc.invalidateQueries({ queryKey: ['admin-member', id] })
    void qc.invalidateQueries({ queryKey: ['member', id] })
  }

  async function save() {
    if (!f) return
    setBusy(true)
    const { phone, skills, ...rest } = f
    const fields = { ...rest, skills: (skills ?? '').split(',').map((x) => x.trim()).filter(Boolean) }
    const { error } = await supabase.rpc('admin_update_member', { p_id: id, p_fields: fields, p_phone: phone ?? '' })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success('Profile updated')
    refresh()
  }

  async function setFlags(isAdmin: boolean | null, verification: VerificationStatus | null, confirmText: string) {
    if (!window.confirm(confirmText)) return
    const { error } = await supabase.rpc('admin_set_member', { p_id: id, p_is_admin: isAdmin, p_verification: verification })
    if (error) return toast.error(friendlyError(error))
    toast.success('Saved')
    refresh()
  }

  const p = data?.profile
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s!, [k]: e.target.value }))
  const years = yearRange(1960, CURRENT_YEAR + 5)

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit member" className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-bg p-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {p && <Avatar src={p.avatar_url} name={p.full_name || '?'} size={48} />}
            <div>
              <h2 className="text-xl font-bold">{p?.full_name || 'Member'}</h2>
              {p && <p className="text-sm text-muted">Joined {formatDateTime(p.created_at)}</p>}
            </div>
          </div>
          <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-2" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {isLoading || !f || !p ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {p.verification !== 'verified' ? (
                <Button size="sm" variant="success" icon={<BadgeCheck className="size-4" />} onClick={() => setFlags(null, 'verified', `Verify ${p.full_name} as a genuine JECian? They will see the member directory.`)}>
                  Verify member
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setFlags(null, 'pending', `Remove ${p.full_name}'s verification? They will lose access to the directory.`)}>
                  Remove verification
                </Button>
              )}
              {p.verification !== 'rejected' && (
                <Button size="sm" variant="danger-ghost" onClick={() => setFlags(null, 'rejected', `Mark ${p.full_name} as NOT a JECian?`)}>
                  Reject
                </Button>
              )}
              {!isSelf &&
                (p.is_admin ? (
                  <Button size="sm" variant="danger-ghost" onClick={() => setFlags(false, null, `Remove admin access from ${p.full_name}?`)}>
                    Remove admin
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" icon={<ShieldCheck className="size-4" />} onClick={() => setFlags(true, null, `Make ${p.full_name} an ADMIN? Admins can see and change everything.`)}>
                    Make admin
                  </Button>
                ))}
            </div>

            <Field label="Full name">{(x) => <Input {...x} value={f.full_name} onChange={set('full_name')} />}</Field>
            <ChoiceGroup label="Member type" columns={3} options={MEMBER_TYPES.map((m) => ({ value: m.value, label: m.label.split(' /')[0]! }))} value={(f.member_type || null) as never} onChange={(v) => setF({ ...f, member_type: v })} />
            <Field label="Branch">
              {(x) => (
                <Select {...x} value={f.branch} onChange={set('branch')}>
                  <option value="">—</option>
                  {BRANCHES.map((b) => <option key={b}>{b}</option>)}
                  {f.branch && !BRANCHES.includes(f.branch as never) && <option>{f.branch}</option>}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Passing-out year">
                {(x) => (
                  <Select {...x} value={f.grad_year} onChange={set('grad_year')}>
                    <option value="">—</option>
                    {years.map((y) => <option key={y}>{y}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Joining year">
                {(x) => (
                  <Select {...x} value={f.join_year} onChange={set('join_year')}>
                    <option value="">—</option>
                    {years.map((y) => <option key={y}>{y}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Current role">{(x) => <Input {...x} value={f.current_title} onChange={set('current_title')} />}</Field>
              <Field label="Company">{(x) => <Input {...x} value={f.current_company} onChange={set('current_company')} />}</Field>
            </div>
            <Field label="City">{(x) => <Input {...x} value={f.city} onChange={set('city')} />}</Field>
            <Field label="Country">{(x) => <Input {...x} value={f.country} onChange={set('country')} />}</Field>
            <Field label="Mobile (private)">{(x) => <Input {...x} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
            <EmailRow id={id} />
            <Field label="Headline">{(x) => <Input {...x} value={f.headline} onChange={set('headline')} maxLength={160} />}</Field>
            <Field label="About">{(x) => <Textarea {...x} value={f.about} onChange={set('about')} maxLength={2000} />}</Field>
            <Field label="LinkedIn profile link">{(x) => <Input {...x} type="url" inputMode="url" value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/…" />}</Field>
            <Field label="Website">{(x) => <Input {...x} type="url" inputMode="url" value={f.website_url} onChange={set('website_url')} />}</Field>
            <Field label="Skills" hint="Separate with commas">{(x) => <Input {...x} value={f.skills} onChange={set('skills')} />}</Field>
            <Button size="lg" block loading={busy} onClick={save}>
              Save changes
            </Button>
            <p className="text-center text-xs text-muted">Every change is recorded in the activity log with your name.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** The member's email lives in the sign-in system; showing it is a deliberate, logged action. */
function EmailRow({ id }: { id: string }) {
  const [email, setEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setEmail(null), [id])
  async function reveal() {
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_member_email', { p_id: id })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    setEmail((data as string | null) ?? '')
  }
  return (
    <div>
      <p className="mb-1.5 text-[15px] font-semibold">Email (private)</p>
      {email === null ? (
        <Button type="button" size="sm" variant="secondary" icon={<Eye className="size-4" />} loading={busy} onClick={reveal}>
          Show email (logged)
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 text-[15px]">{email || 'No email on file'}</span>
          {email && (
            <Button type="button" size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(email).then(() => toast.success('Copied'))}>
              Copy
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Add a member who hasn't signed up yet. They claim the profile by signing in with the same email. */
function AddMemberSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const empty = { full_name: '', email: '', member_type: 'alumnus', branch: '', grad_year: '', city: '', current_title: '', current_company: '', phone: '', verified: true }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setF(empty)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when closing
  }, [open])
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const years = yearRange(1960, CURRENT_YEAR + 5)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (f.full_name.trim().length < 2) return setError('Please enter the member’s full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setError('Please enter a valid email address.')
    setBusy(true)
    const { data, error: err } = await supabase.functions.invoke('admin-create-member', { body: f })
    setBusy(false)
    if (err) {
      const body = await (err as { context?: Response }).context?.json?.().catch(() => null)
      return setError(body?.message ?? friendlyError(err))
    }
    toast.success(`${f.full_name.trim()} was added. They can sign in with ${f.email.trim().toLowerCase()} to claim their profile.`)
    onCreated((data as { id: string }).id)
  }

  return (
    <Sheet open={open} onClose={onClose} label="Add a member">
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">Add a member</h2>
          <p className="text-sm text-muted">For someone who hasn’t signed up yet. When they sign in with this email, the profile is theirs to confirm.</p>
        </div>
        <Field label="Full name">{(x) => <Input {...x} value={f.full_name} onChange={set('full_name')} autoComplete="off" />}</Field>
        <Field label="Email">{(x) => <Input {...x} type="email" inputMode="email" value={f.email} onChange={set('email')} autoComplete="off" />}</Field>
        <ChoiceGroup label="Member type" columns={3} options={MEMBER_TYPES.map((m) => ({ value: m.value, label: m.label.split(' /')[0]! }))} value={f.member_type as never} onChange={(v) => setF({ ...f, member_type: v })} />
        <Field label="Branch" optional>
          {(x) => (
            <Select {...x} value={f.branch} onChange={set('branch')}>
              <option value="">—</option>
              {BRANCHES.map((b) => <option key={b}>{b}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Passing-out year" optional>
          {(x) => (
            <Select {...x} value={f.grad_year} onChange={set('grad_year')}>
              <option value="">—</option>
              {years.map((y) => <option key={y}>{y}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current role" optional>{(x) => <Input {...x} value={f.current_title} onChange={set('current_title')} />}</Field>
          <Field label="Company" optional>{(x) => <Input {...x} value={f.current_company} onChange={set('current_company')} />}</Field>
        </div>
        <Field label="City" optional>{(x) => <Input {...x} value={f.city} onChange={set('city')} />}</Field>
        <Field label="Mobile (private)" optional>{(x) => <Input {...x} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} className="size-5 accent-[var(--primary)]" />
          <span>Mark as a verified JECian</span>
        </label>
        {error && <Notice tone="danger" title={error} />}
        <Button type="submit" size="lg" block loading={busy}>Add member</Button>
      </form>
    </Sheet>
  )
}
