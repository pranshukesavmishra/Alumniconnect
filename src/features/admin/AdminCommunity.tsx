import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles, Trash2, Users, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Avatar, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { BRANCHES, CURRENT_YEAR, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { NoAccess, useAdminAccess } from './access'
import { AdminOfficialGroups } from './AdminOfficialGroups'

interface Circle {
  id: string
  name: string
  icon: string | null
  description: string | null
  created_at: string
  creator: { full_name: string } | null
}
interface Spot {
  id: string
  headline: string
  starts_on: string
  profile: { id: string; full_name: string; avatar_url: string | null } | null
}
interface BatchSize {
  grad_year: number
  branch: string
  total: number
}

/** Admin: approve member-proposed circles, choose the Member Spotlight, set batch sizes for the "% on board" bars. */
export function AdminCommunity() {
  const { data: me, isLoading } = useMyProfile()
  const { can, isLoading: accessLoading } = useAdminAccess()
  if (isLoading || accessLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  if (!can('community_*')) return <NoAccess what="Community tools" />
  return (
    <div>
      <PageHeader title="Community" subtitle="Circles, spotlight and batch sizes" back="/admin" />
      <Page className="space-y-8">
        {can('community_circles') && <AdminOfficialGroups />}
        {can('community_circles') && <PendingCircles />}
        {can('community_spotlight') && <SpotlightEditor />}
        {can('community_batches') && <BatchSizes />}
      </Page>
    </div>
  )
}

function PendingCircles() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin-pending-circles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, icon, description, created_at, creator:profiles!groups_created_by_fkey(full_name)')
        .eq('kind', 'circle')
        .eq('is_approved', false)
        .order('created_at')
      if (error) throw error
      return data as unknown as Circle[]
    },
  })
  const review = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = approve ? await supabase.from('groups').update({ is_approved: true }).eq('id', id) : await supabase.from('groups').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      toast.success(v.approve ? 'Circle approved. Members can now find and join it.' : 'Circle removed')
      void qc.invalidateQueries({ queryKey: ['admin-pending-circles'] })
      void qc.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <section>
      <SectionTitle>Circles waiting for approval</SectionTitle>
      {q.error && <Notice tone="danger" title={friendlyError(q.error)} />}
      {q.isLoading ? (
        <PageSkeleton />
      ) : !q.data?.length ? (
        <EmptyState icon={<Users />} title="Nothing waiting">When a member proposes a new circle it will appear here for you to approve.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {q.data.map((c) => (
            <li key={c.id}>
              <Card className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-2xl">{c.icon ?? '👥'}</span>
                  <div className="min-w-0">
                    <p className="font-bold">{c.name}</p>
                    {c.description && <p className="text-[15px] text-muted">{c.description}</p>}
                    <p className="mt-1 text-xs text-muted">Proposed by {c.creator?.full_name ?? 'a member'} · {formatDate(c.created_at)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button icon={<Check className="size-4" />} loading={review.isPending && review.variables?.id === c.id && review.variables.approve} onClick={() => review.mutate({ id: c.id, approve: true })}>Approve</Button>
                  <Button
                    variant="danger-ghost"
                    icon={<X className="size-4" />}
                    onClick={() => window.confirm(`Remove the proposed circle “${c.name}”?`) && review.mutate({ id: c.id, approve: false })}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SpotlightEditor() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<{ id: string; full_name: string } | null>(null)
  const [headline, setHeadline] = useState('')
  const [story, setStory] = useState('')
  const people = useQuery({
    queryKey: ['admin-spotlight-search', search],
    enabled: search.trim().length >= 2 && !picked,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, grad_year, branch').ilike('full_name', `%${search.trim().replace(/[%,()]/g, ' ')}%`).limit(6)
      if (error) throw error
      return data as { id: string; full_name: string; grad_year: number | null; branch: string | null }[]
    },
  })
  const list = useQuery({
    queryKey: ['admin-spotlights'],
    queryFn: async () => {
      const { data, error } = await supabase.from('spotlights').select('id, headline, starts_on, profile:profiles!spotlights_profile_id_fkey(id, full_name, avatar_url)').order('starts_on', { ascending: false }).order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data as unknown as Spot[]
    },
  })
  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault()
      if (!picked) throw new Error('Choose a member first.')
      if (headline.trim().length < 3) throw new Error('Add a short headline, e.g. “Built a unicorn from Jabalpur”.')
      const { error } = await supabase.from('spotlights').insert({ profile_id: picked.id, headline: headline.trim(), story: story.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Spotlight published on everyone’s Home screen.')
      setPicked(null); setSearch(''); setHeadline(''); setStory('')
      void qc.invalidateQueries({ queryKey: ['admin-spotlights'] })
      void qc.invalidateQueries({ queryKey: ['spotlight'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('spotlights').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-spotlights'] })
      void qc.invalidateQueries({ queryKey: ['spotlight'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <section>
      <SectionTitle>Member spotlight</SectionTitle>
      <Card className="p-4">
        <form onSubmit={save.mutate} className="space-y-4" noValidate>
          {picked ? (
            <div className="flex items-center justify-between rounded-2xl bg-primary-soft px-4 py-3">
              <span className="font-semibold">{picked.full_name}</span>
              <button type="button" className="text-sm font-semibold text-primary" onClick={() => setPicked(null)}>Change</button>
            </div>
          ) : (
            <div>
              <Field label="Member">{(p) => <Input {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" autoComplete="off" />}</Field>
              {!!people.data?.length && (
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {people.data.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex min-h-12 w-full items-center gap-3 px-3 text-left hover:bg-surface-2" onClick={() => setPicked({ id: p.id, full_name: p.full_name })}>
                        <span className="font-semibold">{p.full_name}</span>
                        <span className="text-sm text-muted">{[p.grad_year && `Batch ${p.grad_year}`, p.branch].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Headline">{(p) => <Input {...p} value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={160} />}</Field>
          <Field label="Story" optional>{(p) => <Textarea {...p} value={story} onChange={(e) => setStory(e.target.value)} maxLength={2000} />}</Field>
          <Button type="submit" icon={<Sparkles className="size-4" />} loading={save.isPending}>Publish spotlight</Button>
        </form>
      </Card>
      {!!list.data?.length && (
        <Card className="mt-3 divide-y divide-border">
          {list.data.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3.5">
              <Avatar src={s.profile?.avatar_url} name={s.profile?.full_name ?? '?'} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{s.profile?.full_name}</p>
                <p className="truncate text-sm text-muted">{s.headline} · from {formatDate(s.starts_on)}</p>
              </div>
              <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Remove spotlight for ${s.profile?.full_name}`} onClick={() => window.confirm('Remove this spotlight?') && remove.mutate(s.id)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}

function BatchSizes() {
  const qc = useQueryClient()
  const [year, setYear] = useState('')
  const [branch, setBranch] = useState('')
  const [total, setTotal] = useState('')
  const q = useQuery({
    queryKey: ['admin-batch-sizes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_sizes').select('*').order('grad_year', { ascending: false }).order('branch')
      if (error) throw error
      return data as BatchSize[]
    },
  })
  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault()
      const n = Number(total)
      if (!year || !branch) throw new Error('Choose the year and branch.')
      if (!Number.isInteger(n) || n <= 0 || n > 2000) throw new Error('Enter how many students passed out (a whole number).')
      const { error } = await supabase.from('batch_sizes').upsert({ grad_year: Number(year), branch, total: n })
      if (error) throw error
    },
    onSuccess: () => {
      setTotal('')
      void qc.invalidateQueries({ queryKey: ['admin-batch-sizes'] })
      void qc.invalidateQueries({ queryKey: ['batch-progress'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const remove = useMutation({
    mutationFn: async (r: BatchSize) => {
      const { error } = await supabase.from('batch_sizes').delete().eq('grad_year', r.grad_year).eq('branch', r.branch)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-batch-sizes'] })
      void qc.invalidateQueries({ queryKey: ['batch-progress'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <section>
      <SectionTitle>Batch sizes</SectionTitle>
      <p className="mb-3 text-[15px] text-muted">How many students passed out in each batch. Members then see “120 of 180 on board” while inviting friends.</p>
      <Card className="p-4">
        <form onSubmit={save.mutate} className="grid grid-cols-2 gap-3" noValidate>
          <Field label="Passing-out year">
            {(p) => (
              <Select {...p} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Choose</option>
                {yearRange(1960, CURRENT_YEAR + 4).reverse().map((y) => <option key={y}>{y}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Students">{(p) => <Input {...p} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ''))} maxLength={4} />}</Field>
          <div className="col-span-2">
            <Field label="Branch">
              {(p) => (
                <Select {...p} value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">Choose</option>
                  {BRANCHES.map((b) => <option key={b}>{b}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Button type="submit" className="col-span-2" loading={save.isPending}>Save batch size</Button>
        </form>
      </Card>
      {!!q.data?.length && (
        <Card className="mt-3 divide-y divide-border">
          {q.data.map((r) => (
            <div key={`${r.grad_year}-${r.branch}`} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Batch {r.grad_year} · {r.branch}</p>
                <p className="text-sm text-muted">{r.total} students</p>
              </div>
              <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${r.branch} ${r.grad_year}`} onClick={() => remove.mutate(r)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}
