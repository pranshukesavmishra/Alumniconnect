import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Copy, Download, Eye, History, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, Upload, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { Sheet } from '../../components/ui/Sheet'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { PhoneInput, usePhoneError } from '../../components/ui/PhoneInput'
import { cn } from '../../lib/cn'
import { BRANCHES, CURRENT_YEAR, MEMBER_TYPES, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { normalizePhone } from '../../lib/phone'
import { formatDateTime } from '../../lib/format'
import { cleanFilter, describeFilter, extraFilterCount, filterFromParams, filterToParams, PRESET_VIEWS, sameFilter, toRpcFilter, type MemberFilter, type MemberSort, type MemberStatus } from '../../lib/memberFilters'
import { supabase } from '../../lib/supabase'
import type { Profile, VerificationStatus } from '../../lib/types'
import { useMyProfile } from '../auth/AuthProvider'
import { RequirePerm, useAdminAccess } from './access'
import { exportMembers, type MemberExportRow } from './export'
import { attentionKey, fetchMemberIds, useMemberList, useMemberViews, type MemberView } from './queries'

const EXTRA_FILTERS = ['onboarded', 'older', 'signin', 'branch', 'batch_from', 'batch_to', 'city', 'type', 'sort'] as const

export function AdminMembers() {
  return (
    <RequirePerm any={['members_view']} what="The members list">
      <AdminMembersPage />
    </RequirePerm>
  )
}

function AdminMembersPage() {
  const { can, isSuper } = useAdminAccess()
  const { data: me, isLoading } = useMyProfile()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => filterFromParams(params), [params])
  const rpcFilter = useMemo(() => toRpcFilter(filter), [filter])
  const filterKey = JSON.stringify(rpcFilter)
  const [q, setQ] = useState(filter.q ?? '')
  // deep links from the admin home or search (?open=<member id>); the list's filters stay in the URL
  const [openId, setOpenIdState] = useState<string | null>(params.get('open'))
  const [adding, setAdding] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bulk, setBulk] = useState<VerificationStatus | null>(null)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [selectingAll, setSelectingAll] = useState(false)

  const latest = useRef(params)
  useEffect(() => {
    latest.current = params
  })
  const setFilter = (f: MemberFilter) => setParams(filterToParams(f), { replace: true })
  /** The filters sheet owns the "more" filters only. Search and status are read as they are NOW, so a change made a moment ago is never undone. */
  const applyExtras = (f: MemberFilter) => {
    const live = filterFromParams(latest.current)
    const next: Record<string, unknown> = { q: live.q, status: live.status }
    for (const k of EXTRA_FILTERS) if (f[k] !== undefined) next[k] = f[k]
    setParams(filterToParams(next as MemberFilter), { replace: true })
  }
  const setOpenId = (id: string | null) => {
    setOpenIdState(id)
    if (params.has('open')) setParams(filterToParams(filter), { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => {
      // read the URL as it is when the timer fires: a filter or saved view chosen meanwhile must not be undone
      const now = filterFromParams(latest.current)
      if ((now.q ?? '') !== q.trim()) setParams(filterToParams({ ...now, q: q.trim() || undefined }), { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [q, setParams])
  // a different filter is a different list: never act on members the admin can no longer see
  useEffect(() => setSelected(new Set()), [filterKey])

  const list = useMemberList(rpcFilter, !!me?.is_admin)
  const views = useMemberViews(!!me?.is_admin)

  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const words = describeFilter(filter)
  const extra = extraFilterCount(filter)
  const allSelected = total > 0 && selected.size >= Math.min(total, 2000)
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-members'] })
    void qc.invalidateQueries({ queryKey: attentionKey })
  }

  async function selectAll() {
    setSelectingAll(true)
    try {
      const r = await fetchMemberIds(rpcFilter)
      setSelected(new Set(r.ids))
      if (r.total > r.ids.length) toast.info(`Selected the first ${r.ids.length} of ${r.total}. Narrow the filter to reach the rest.`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setSelectingAll(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Find, verify and look after every member"
        back="/admin"
        action={can('members_import') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add member</Button>}
      />
      <Page wide className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {can('members_import') && <ButtonLink to="/admin/members/import" size="sm" variant="secondary" icon={<Upload className="size-4" />}>Import from CSV</ButtonLink>}
          {can('members_merge') && <ButtonLink to="/admin/members/duplicates" size="sm" variant="secondary" icon={<Users className="size-4" />}>Find duplicates</ButtonLink>}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" aria-label="Search members" placeholder="Name, city, company, branch…" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 sm:contents">
            <Select aria-label="Filter" value={filter.status ?? 'all'} onChange={(e) => setFilter({ ...filterFromParams(latest.current), status: e.target.value as MemberStatus })}>
              <option value="all">All members</option>
              <option value="pending">Not yet verified</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="admins">Admins</option>
            </Select>
            <Button variant="secondary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setFiltersOpen(true)} aria-label={`Refine the list${extra ? ` (${extra} on)` : ''}`}>
              Filters{extra > 0 && <Badge tone="primary">{extra}</Badge>}
            </Button>
          </div>
        </div>

        <div role="group" aria-label="Saved views" className="flex flex-wrap gap-2">
          {[...PRESET_VIEWS.map((v) => ({ key: v.id, name: v.name, filter: v.filter })), ...(views.data ?? []).map((v) => ({ key: v.id, name: v.name, filter: cleanFilter(v.filter) }))].map((v) => {
            // a view sets the filters, not the search box: whatever is typed stays unless the view carries its own search
            const on = sameFilter(v.filter, { ...filter, q: v.filter.q })
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const keep = v.filter.q ?? (q.trim() || undefined)
                  setQ(keep ?? '')
                  setFilter(on ? { q: keep } : { ...v.filter, q: keep })
                }}
                className={cn('min-h-11 rounded-full border px-4 text-sm font-semibold', on ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:bg-surface-2')}
              >
                {v.name}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
          <p className="min-w-0 flex-1 text-sm text-muted" data-testid="member-total">
            {list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'member' : 'members'}`}
            {words.length > 0 && <> · {words.join(' · ')}</>}
          </p>
          {words.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { setQ(''); setFilter({}) }}>Clear filters</Button>
          )}
          {total > 0 && can('members_export') && (
            <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => setExporting(true)}>
              {selected.size ? `Export ${selected.size}` : 'Export'}
            </Button>
          )}
        </div>

        {list.error && <Notice tone="danger" title={friendlyError(list.error)} />}
        {list.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No members found">{words.length ? 'Nobody matches these filters.' : undefined}</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center gap-1 border-b border-border bg-surface-2/60 pl-1 pr-3">
              <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
                <input
                  type="checkbox"
                  aria-label="Select everyone shown"
                  className="size-5 accent-[var(--primary)]"
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected((s) => { const n = new Set(s); for (const r of rows) { if (e.target.checked) n.add(r.id); else n.delete(r.id) } return n })}
                />
              </label>
              <span className="flex-1 text-sm text-muted">{selected.size ? `${selected.size} selected` : 'Select to act on many at once'}</span>
              {total > rows.length && !allSelected && (
                <Button size="sm" variant="ghost" loading={selectingAll} onClick={selectAll}>Select all {total}</Button>
              )}
            </div>
            <ul className="divide-y divide-border">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-1 pl-1">
                  <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
                    <input type="checkbox" aria-label={`Select ${p.full_name || 'member'}`} className="size-5 accent-[var(--primary)]" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </label>
                  <button type="button" onClick={() => setOpenId(p.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
                    <Avatar src={p.avatar_url} name={p.full_name || '?'} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.full_name || '(no name yet)'}</span>
                      <span className="block truncate text-sm text-muted">{[p.branch, p.grad_year, p.city].filter(Boolean).join(' · ') || 'Profile not completed'}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.is_admin && <Badge tone="primary"><ShieldCheck className="size-3" aria-hidden /> Admin</Badge>}
                        {p.verification === 'verified' ? <Badge tone="success">Verified</Badge> : p.verification === 'rejected' ? <Badge tone="danger">Rejected</Badge> : <Badge tone="neutral">Not verified</Badge>}
                        {!p.last_sign_in_at && <Badge tone="warning">Never signed in</Badge>}
                        {p.notes > 0 && <Badge tone="neutral">{p.notes} {p.notes === 1 ? 'note' : 'notes'}</Badge>}
                      </span>
                    </span>
                  </button>
                  <Link to={`/admin/members/${p.id}`} aria-label={`History of ${p.full_name || 'member'}`} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2">
                    <History className="size-5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" block loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Show more
          </Button>
        )}

        {selected.size > 0 && can('members_verify') && (
          <div role="region" aria-label="Bulk actions" className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">{selected.size} selected</p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="success" icon={<BadgeCheck className="size-4" />} onClick={() => setBulk('verified')}>Verify</Button>
              <Button size="sm" variant="secondary" className="text-danger" onClick={() => setBulk('rejected')}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => setBulk('pending')}>Unverify</Button>
            </div>
          </div>
        )}
      </Page>
      <AddMemberSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(newId) => {
          setAdding(false)
          refresh()
          setOpenId(newId)
        }}
      />
      <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} filter={{ ...filter, q: q.trim() || undefined }} views={views.data ?? []} onApply={applyExtras} />
      <BulkSheet
        to={bulk}
        ids={[...selected]}
        onClose={() => setBulk(null)}
        onDone={() => {
          setBulk(null)
          setSelected(new Set())
          refresh()
        }}
      />
      <ExportSheet open={exporting} onClose={() => setExporting(false)} ids={[...selected]} filter={rpcFilter} total={total} />
      {openId && <MemberEditor id={openId} isSelf={openId === me.id} canEdit={can('members_edit')} canVerify={can('members_verify')} isSuper={isSuper} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const BULK_WORDS: Record<VerificationStatus, { verb: string; done: string; warn: string }> = {
  verified: { verb: 'Verify', done: 'verified', warn: 'They will be able to see the member directory and message other members.' },
  rejected: { verb: 'Reject', done: 'rejected', warn: 'They will be marked as NOT JECians and lose access to the directory.' },
  pending: { verb: 'Unverify', done: 'moved back to “not yet verified”', warn: 'They will lose access to the directory until verified again.' },
}

/** Verify / reject / unverify many members at once. Every change is logged per member, with the optional note. */
function BulkSheet({ to, ids, onClose, onDone }: { to: VerificationStatus | null; ids: string[]; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // one request id per open sheet: if the answer is lost and you press the button again, nothing is done twice
  const [request, setRequest] = useState(() => crypto.randomUUID())
  useEffect(() => {
    if (!to) {
      setNote('')
      setRequest(crypto.randomUUID())
    }
  }, [to])
  if (!to) return null
  const w = BULK_WORDS[to]
  const n = ids.length
  async function run() {
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_bulk_set_verification', { p_ids: ids, p_verification: to!, p_note: note.trim() || null, p_request: request })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    const r = data as { changed: number; unchanged: number }
    toast.success(`${r.changed} ${r.changed === 1 ? 'member' : 'members'} ${w.done}${r.unchanged ? ` (${r.unchanged} already were)` : ''}`)
    onDone()
  }
  return (
    <Sheet open onClose={onClose} label={`${w.verb} members`}>
      <div className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">{w.verb} {n} {n === 1 ? 'member' : 'members'}?</h2>
          <p className="text-sm text-muted">{w.warn}</p>
        </div>
        <Field label="Note for the activity log" optional>{(x) => <Textarea {...x} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Checked against the 2005 batch register" />}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={to === 'rejected' ? 'danger' : to === 'verified' ? 'success' : 'primary'} loading={busy} onClick={run}>
            {w.verb} {n}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Download members as CSV: the selection, or everyone matching the filter. Phone and e-mail only on request, and logged. */
function ExportSheet({ open, onClose, ids, filter, total }: { open: boolean; onClose: () => void; ids: string[]; filter: Record<string, string>; total: number }) {
  const [contact, setContact] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) setContact(false)
  }, [open])
  const n = ids.length || Math.min(total, 2000)
  async function run() {
    setBusy(true)
    try {
      const target = ids.length ? ids : (await fetchMemberIds(filter)).ids
      const { data, error } = await supabase.rpc('admin_export_members', { p_ids: target, p_contact: contact })
      if (error) throw error
      exportMembers(data as unknown as MemberExportRow[], contact)
      toast.success(`Downloaded ${target.length} ${target.length === 1 ? 'member' : 'members'}`)
      onClose()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} label="Export members">
      <div className="space-y-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-bold">Export {n} {n === 1 ? 'member' : 'members'}</h2>
          <p className="text-sm text-muted">{ids.length ? 'The members you selected' : 'Everyone matching the current filters'}, as a spreadsheet (CSV).</p>
        </div>
        <Checkbox checked={contact} onChange={setContact}>Include mobile and e-mail (recorded in the activity log)</Checkbox>
        {contact && <Notice tone="warning" title="Contact details are private">Keep the file safe and delete it when you are done.</Notice>}
        <Button size="lg" block icon={<Download className="size-4" />} loading={busy} onClick={run}>Download CSV</Button>
      </div>
    </Sheet>
  )
}

/** Every filter beyond search and status, plus saving the current filters as a shared view. */
function FiltersSheet({ open, onClose, filter, views, onApply }: { open: boolean; onClose: () => void; filter: MemberFilter; views: MemberView[]; onApply: (f: MemberFilter) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<MemberFilter>(filter)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setF(filter)
      setName('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time the sheet opens
  }, [open])
  const years = yearRange(1960, CURRENT_YEAR + 5)
  const set = <K extends keyof MemberFilter>(k: K, v: MemberFilter[K] | '') => setF((s) => ({ ...s, [k]: v === '' ? undefined : v }))

  async function save() {
    if (!name.trim()) return toast.error('Give the view a name.')
    setBusy(true)
    const { error } = await supabase.rpc('admin_save_member_view', { p_name: name.trim(), p_filter: toRpcFilter({ ...f, q: undefined }) })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    toast.success(`Saved “${name.trim()}” for every admin`)
    void qc.invalidateQueries({ queryKey: ['admin-member-views'] })
    onApply(cleanFilter(f as Record<string, unknown>))
    onClose()
  }
  async function remove(v: MemberView) {
    if (!window.confirm(`Remove the view “${v.name}” for every admin?`)) return
    const { error } = await supabase.rpc('admin_delete_member_view', { p_id: v.id })
    if (error) return toast.error(friendlyError(error))
    toast.success('View removed')
    void qc.invalidateQueries({ queryKey: ['admin-member-views'] })
  }

  return (
    <Sheet open={open} onClose={onClose} label="Refine members">
      <div className="space-y-4 px-5 pb-3 pt-1">
        <h2 className="text-lg font-bold">Filters</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Profile">
            {(x) => (
              <Select {...x} value={f.onboarded ?? ''} onChange={(e) => set('onboarded', e.target.value as MemberFilter['onboarded'] | '')}>
                <option value="">Any</option>
                <option value="yes">Completed</option>
                <option value="no">Not completed</option>
              </Select>
            )}
          </Field>
          <Field label="Signed in">
            {(x) => (
              <Select {...x} value={f.signin ?? ''} onChange={(e) => set('signin', e.target.value as MemberFilter['signin'] | '')}>
                <option value="">Any</option>
                <option value="yes">Has signed in</option>
                <option value="never">Never</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Joined more than … days ago" optional hint="e.g. 3 to find people who have waited too long">
          {(x) => <Input {...x} type="number" inputMode="numeric" min={1} max={9999} value={f.older ?? ''} onChange={(e) => set('older', e.target.value ? Number(e.target.value) : '')} />}
        </Field>
        <Field label="Branch" optional>
          {(x) => (
            <Select {...x} value={f.branch ?? ''} onChange={(e) => set('branch', e.target.value)}>
              <option value="">Any</option>
              {BRANCHES.map((b) => <option key={b}>{b}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batch from" optional>
            {(x) => (
              <Select {...x} value={f.batch_from ?? ''} onChange={(e) => set('batch_from', e.target.value ? Number(e.target.value) : '')}>
                <option value="">Any</option>
                {years.map((y) => <option key={y}>{y}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Batch to" optional>
            {(x) => (
              <Select {...x} value={f.batch_to ?? ''} onChange={(e) => set('batch_to', e.target.value ? Number(e.target.value) : '')}>
                <option value="">Any</option>
                {years.map((y) => <option key={y}>{y}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" optional>{(x) => <Input {...x} value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />}</Field>
          <Field label="Member type" optional>
            {(x) => (
              <Select {...x} value={f.type ?? ''} onChange={(e) => set('type', e.target.value as MemberFilter['type'] | '')}>
                <option value="">Any</option>
                {MEMBER_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label.split(' /')[0]}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Order">
          {(x) => (
            <Select {...x} value={f.sort ?? 'newest'} onChange={(e) => set('sort', e.target.value as MemberSort)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first (longest waiting)</option>
              <option value="name">By name</option>
              <option value="batch">By batch</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => { onApply({}); onClose() }}>Clear these</Button>
          <Button onClick={() => { onApply(cleanFilter(f as Record<string, unknown>)); onClose() }}>Show members</Button>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="font-semibold">Save as a view</h3>
          <p className="text-sm text-muted">Saved views appear as buttons above the list for every admin.</p>
          <div className="flex gap-2">
            <Input aria-label="View name" placeholder="e.g. 2005 batch in Pune" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <Button variant="secondary" loading={busy} onClick={save}>Save</Button>
          </div>
          {views.length > 0 && (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-2 pl-4">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.name}</span>
                    <span className="block truncate text-xs text-muted">{describeFilter(cleanFilter(v.filter)).join(' · ') || 'Everyone'}</span>
                  </span>
                  <button type="button" aria-label={`Remove view ${v.name}`} className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft" onClick={() => remove(v)}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function MemberEditor({ id, isSelf, canEdit, canVerify, isSuper, onClose }: { id: string; isSelf: boolean; canEdit: boolean; canVerify: boolean; isSuper: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const phoneError = usePhoneError()
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
    const pe = phoneError(f.phone)
    if (pe) return toast.error(pe)
    setBusy(true)
    const { phone, skills, ...rest } = f
    const fields = { ...rest, skills: (skills ?? '').split(',').map((x) => x.trim()).filter(Boolean) }
    const { error } = await supabase.rpc('admin_update_member', { p_id: id, p_fields: fields, p_phone: normalizePhone(phone) })
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
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-2" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {isLoading || !f || !p ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {canVerify && (p.verification !== 'verified' ? (
                <Button size="sm" variant="success" icon={<BadgeCheck className="size-4" />} onClick={() => setFlags(null, 'verified', `Verify ${p.full_name} as a genuine JECian? They will see the member directory.`)}>
                  Verify member
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setFlags(null, 'pending', `Remove ${p.full_name}'s verification? They will lose access to the directory.`)}>
                  Remove verification
                </Button>
              ))}
              {canVerify && p.verification !== 'rejected' && (
                <Button size="sm" variant="danger-ghost" onClick={() => setFlags(null, 'rejected', `Mark ${p.full_name} as NOT a JECian?`)}>
                  Reject
                </Button>
              )}
              {p.is_admin && <Badge tone="primary"><ShieldCheck className="size-3" aria-hidden /> Admin</Badge>}
              {isSuper && !isSelf && (
                <ButtonLink to={`/admin/roles?admin=${id}`} size="sm" variant="secondary" icon={<ShieldCheck className="size-4" />}>
                  {p.is_admin ? 'Manage admin access' : 'Make admin'}
                </ButtonLink>
              )}
            </div>
            {!canEdit && <Notice tone="info" title="You can look but not change this member">Your admin permissions do not include editing members. Ask a super admin for access.</Notice>}

            <div className="flex flex-wrap gap-2">
              <ButtonLink to={`/admin/members/${id}`} size="sm" variant="secondary" icon={<History className="size-4" />}>History</ButtonLink>
              <ButtonLink to={`/admin/members/duplicates?q=${encodeURIComponent(p.full_name)}`} size="sm" variant="secondary" icon={<Users className="size-4" />}>Look for duplicates</ButtonLink>
            </div>
            <MemberNotes id={id} canWrite={canEdit} />

            <fieldset disabled={!canEdit} className="min-w-0 space-y-5 border-0 p-0">
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
            <Field label="Mobile (private)">{(x) => <PhoneInput {...x} value={f.phone ?? ''} onChange={(v) => setF((s) => ({ ...s!, phone: v }))} />}</Field>
            <EmailRow id={id} />
            <Field label="Headline">{(x) => <Input {...x} value={f.headline} onChange={set('headline')} maxLength={160} />}</Field>
            <Field label="About">{(x) => <Textarea {...x} value={f.about} onChange={set('about')} maxLength={2000} />}</Field>
            <Field label="LinkedIn profile link">{(x) => <Input {...x} type="url" inputMode="url" value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/…" />}</Field>
            <Field label="Website">{(x) => <Input {...x} type="url" inputMode="url" value={f.website_url} onChange={set('website_url')} />}</Field>
            <Field label="Skills" hint="Separate with commas">{(x) => <Input {...x} value={f.skills} onChange={set('skills')} />}</Field>
            </fieldset>
            {canEdit && (
              <Button size="lg" block loading={busy} onClick={save}>
                Save changes
              </Button>
            )}
            <p className="text-center text-xs text-muted">Every change is recorded in the activity log with your name.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Private committee notes about one member. Members never see them; adding and removing is logged. */
export function MemberNotes({ id, canWrite = true }: { id: string; canWrite?: boolean }) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-member-notes', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('admin_member_notes').select('id, body, created_at, author:profiles!admin_member_notes_author_fkey(full_name)').eq('member_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as { id: string; body: string; created_at: string; author: { full_name: string } | null }[]
    },
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-member-notes', id] })
    void qc.invalidateQueries({ queryKey: ['admin-member-timeline', id] })
    void qc.invalidateQueries({ queryKey: ['admin-members'] })
  }
  async function add() {
    if (!body.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_add_member_note', { p_member: id, p_body: body })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    setBody('')
    toast.success('Note saved')
    refresh()
  }
  async function remove(noteId: string) {
    if (!window.confirm('Remove this note?')) return
    const { error } = await supabase.rpc('admin_delete_member_note', { p_id: noteId })
    if (error) return toast.error(friendlyError(error))
    toast.success('Note removed')
    refresh()
  }
  return (
    <section aria-label="Private notes" className="space-y-2 rounded-2xl border border-border bg-surface p-3.5">
      <h3 className="font-semibold">Private notes</h3>
      <p className="text-xs text-muted">Only admins can see these.</p>
      {isLoading ? <Skeleton className="h-10" /> : (data ?? []).map((n) => (
        <div key={n.id} className="flex items-start gap-2 rounded-xl bg-surface-2 p-2.5">
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words text-[15px]">{n.body}</p>
            <p className="text-xs text-muted">{n.author?.full_name ?? 'An admin'} · {formatDateTime(n.created_at)}</p>
          </div>
          {canWrite && (
            <button type="button" aria-label="Remove note" className="grid size-11 shrink-0 place-items-center rounded-full text-danger hover:bg-danger-soft" onClick={() => remove(n.id)}>
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      ))}
      {canWrite && <Textarea aria-label="New private note" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="e.g. Called on 3 Oct, sending ID proof" rows={2} />}
      {canWrite && <Button size="sm" variant="secondary" loading={busy} disabled={!body.trim()} onClick={add}>Add note</Button>}
    </section>
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
  const phoneError = usePhoneError()
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
    const pe = phoneError(f.phone)
    if (pe) return setError(pe)
    setBusy(true)
    const { data, error: err } = await supabase.functions.invoke('admin-create-member', { body: { ...f, phone: normalizePhone(f.phone) } })
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
        <Field label="Mobile (private)" optional>{(x) => <PhoneInput {...x} value={f.phone} onChange={(v) => setF((s) => ({ ...s, phone: v }))} />}</Field>
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
