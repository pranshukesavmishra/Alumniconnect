import { useInfiniteQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'

interface AuditRow {
  id: number
  action: string
  target_table: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
  actor: { full_name: string } | null
}

const LABELS: Record<string, string> = {
  update_member: 'Edited a member profile',
  set_member_flags: 'Changed verification / admin access',
  update_registration: 'Edited a registration',
  cancel_registration: 'Cancelled a registration',
  reopen_registration: 'Reopened a registration',
  verify_payment: 'Verified a payment',
  reject_payment: 'Marked a payment as not received',
  record_cash: 'Recorded a cash payment',
  record_bank_transfer: 'Recorded a bank transfer',
  record_waiver: 'Waived a fee',
}

function summary(r: AuditRow): string {
  const d = r.details as Record<string, any>
  const parts: string[] = []
  if (d.code) parts.push(String(d.code))
  if (typeof d.amount === 'number') parts.push(formatPaise(d.amount))
  if (d.amount?.from !== undefined && d.amount.from !== d.amount.to) parts.push(`${formatPaise(d.amount.from)} → ${formatPaise(d.amount.to)}`)
  if (d.status?.from && d.status.from !== d.status.to) parts.push(`${d.status.from} → ${d.status.to}`)
  if (d.utr) parts.push(`UTR ${d.utr}`)
  if (d.changed) parts.push(`changed: ${Object.keys(d.changed).join(', ')}`)
  if (d.verification?.from !== d.verification?.to && d.verification) parts.push(`verification ${d.verification.from} → ${d.verification.to}`)
  if (d.is_admin && d.is_admin.from !== d.is_admin.to) parts.push(d.is_admin.to ? 'made admin' : 'admin removed')
  if (d.reason) parts.push(`“${d.reason}”`)
  else if (d.note) parts.push(`“${d.note}”`)
  return parts.join(' · ')
}

export function AdminAudit() {
  const { data: me, isLoading } = useMyProfile()
  const q = useInfiniteQuery({
    queryKey: ['admin-audit'],
    enabled: !!me?.is_admin,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from('admin_audit')
        .select('id, action, target_table, target_id, details, created_at, actor:profiles(full_name)')
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + 49)
      if (error) throw error
      return data as unknown as AuditRow[]
    },
    getNextPageParam: (last, all) => (last.length === 50 ? all.length * 50 : undefined),
  })
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const rows = q.data?.pages.flat() ?? []
  return (
    <div>
      <PageHeader title="Activity log" subtitle="Every change made by admins and treasurers" back="/admin" />
      <Page className="space-y-3">
        {q.error && <Notice tone="danger" title={friendlyError(q.error)} />}
        {q.isLoading ? (
          <PageSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={<History />} title="Nothing yet">Admin actions will appear here.</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="p-4">
                <p className="font-semibold">{LABELS[r.action] ?? r.action}</p>
                <p className="text-sm text-muted">
                  {r.actor?.full_name ?? 'System'} · {formatDateTime(r.created_at)}
                </p>
                {summary(r) && <p className="mt-1 text-sm">{summary(r)}</p>}
              </div>
            ))}
          </Card>
        )}
        {q.hasNextPage && (
          <Button variant="secondary" block loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Show older
          </Button>
        )}
      </Page>
    </div>
  )
}
