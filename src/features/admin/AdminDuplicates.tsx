import { useQueryClient } from '@tanstack/react-query'
import { Merge } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { attentionKey, useDuplicates, useMergePreview, type DuplicatePair, type DuplicateSide, type MergeSide } from './queries'

const REASONS: Record<string, string> = { phone: 'Same mobile number', name: 'Same name', similar_name: 'Very similar name, same batch' }
const TABLES: Record<string, string> = {
  event_registrations: 'event registrations', posts: 'posts', comments: 'comments', messages: 'chat messages', group_members: 'circle / group memberships',
  connections: 'connections', follows: 'follows', vouches: 'vouches', notifications: 'notifications', chats: 'direct chats', chat_reads: 'chat read markers',
  push_subscriptions: 'push devices', jobs: 'job posts', businesses: 'business listings', mentorships: 'mentorships', help_requests: 'help requests',
}

/** Possible duplicate profiles, side by side, with a merge that shows exactly what moves before anything happens. */
export function AdminDuplicates() {
  const { data: me, isLoading } = useMyProfile()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [dq, setDq] = useState(q.trim())
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data, isLoading: loading, error } = useDuplicates(dq.toLowerCase(), !!me?.is_admin)
  const qc = useQueryClient()
  const [merge, setMerge] = useState<{ keep: string; drop: string } | null>(null)
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />

  async function dismiss(p: DuplicatePair) {
    const { error: e } = await supabase.rpc('admin_dismiss_duplicate', { p_a: p.a.id, p_b: p.b.id })
    if (e) return toast.error(friendlyError(e))
    toast.success('Marked as different people')
    void qc.invalidateQueries({ queryKey: ['admin-duplicates'] })
  }

  return (
    <div>
      <PageHeader title="Duplicate members" subtitle="Same person, two profiles? Merge them safely" back="/admin/members" />
      <Page wide className="space-y-4">
        <Input type="search" aria-label="Narrow by name" placeholder="Narrow by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {loading ? <PageSkeleton /> : !data?.length ? (
          <EmptyState title="No duplicates found">Pairs with the same mobile number, the same name, or a very similar name in the same batch show up here.</EmptyState>
        ) : (
          <ul className="space-y-3" data-testid="duplicates">
            {data.map((p) => (
              <li key={p.a.id + p.b.id}>
                <Card className="space-y-3 p-4">
                  <div className="flex flex-wrap gap-1">{p.reasons.map((r) => <Badge key={r} tone="warning">{REASONS[r] ?? r}</Badge>)}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Side s={p.a} />
                    <Side s={p.b} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon={<Merge className="size-4" />} onClick={() => setMerge({ keep: p.a.id, drop: p.b.id })}>Merge…</Button>
                    <Button size="sm" variant="secondary" onClick={() => dismiss(p)}>Different people</Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Page>
      {merge && <MergeSheet initial={merge} onClose={() => setMerge(null)} onDone={() => { setMerge(null); void qc.invalidateQueries({ queryKey: ['admin-duplicates'] }); void qc.invalidateQueries({ queryKey: ['admin-members'] }); void qc.invalidateQueries({ queryKey: attentionKey }) }} />}
    </div>
  )
}

function Side({ s }: { s: DuplicateSide | MergeSide }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3 text-sm">
      <p className="truncate font-semibold">{s.full_name}</p>
      <p className="truncate text-muted">{[s.branch, s.grad_year, s.city].filter(Boolean).join(' · ') || 'No details'}</p>
      {'email' in s && s.email && <p className="truncate text-muted">{s.email}</p>}
      <p className="text-muted">Joined {formatDate(s.created_at)} · {s.last_sign_in_at ? `signed in ${formatDate(s.last_sign_in_at)}` : 'never signed in'}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {s.is_admin && <Badge tone="primary">Admin</Badge>}
        {s.verification === 'verified' ? <Badge tone="success">Verified</Badge> : <Badge>Not verified</Badge>}
        {!s.onboarded && <Badge>Profile not completed</Badge>}
      </div>
    </div>
  )
}

function MergeSheet({ initial, onClose, onDone }: { initial: { keep: string; drop: string }; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState(initial)
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error } = useMergePreview(ids.keep, ids.drop)
  const moves = Object.entries(data?.moves ?? {})
  async function run() {
    if (!data) return
    if (!window.confirm(`Merge ${data.drop.full_name} into ${data.keep.full_name}? The duplicate account is deleted and this cannot be undone.`)) return
    setBusy(true)
    const { error: e } = await supabase.rpc('admin_merge_members', { p_keep: ids.keep, p_drop: ids.drop })
    setBusy(false)
    if (e) return toast.error(friendlyError(e))
    toast.success('Profiles merged')
    onDone()
  }
  return (
    <Sheet open onClose={onClose} label="Merge profiles">
      <div className="space-y-4 px-5 pb-3 pt-1">
        <h2 className="text-lg font-bold">Merge two profiles</h2>
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading || !data ? <PageSkeleton /> : (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-success">Keep (stays, receives everything)</p>
              <Side s={data.keep} />
              <p className="text-sm font-semibold text-danger">Remove (account is deleted)</p>
              <Side s={data.drop} />
              <Button size="sm" variant="secondary" onClick={() => setIds({ keep: ids.drop, drop: ids.keep })}>Swap: keep the other one</Button>
            </div>
            <div>
              <p className="font-semibold">What moves to the kept profile</p>
              {moves.length ? (
                <ul className="mt-1 list-disc pl-5 text-sm" data-testid="merge-moves">
                  {moves.map(([k, n]) => <li key={k}>{n} {TABLES[k] ?? k.replace(/_/g, ' ')}</li>)}
                </ul>
              ) : <p className="text-sm text-muted">Nothing: the duplicate has no activity.</p>}
              <p className="mt-2 text-xs text-muted">Empty fields on the kept profile are filled from the other one. A circle, follow or like both had is kept once.</p>
            </div>
            {data.blocks.map((b) => <Notice key={b} tone="danger" title={b} />)}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="danger" loading={busy} disabled={data.blocks.length > 0} onClick={run}>Merge</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
