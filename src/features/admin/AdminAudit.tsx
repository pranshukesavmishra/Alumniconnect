import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { AUDIT_LABELS, auditSummary } from '../../lib/auditText'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
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


type Names = Record<string, string>

/** The audit log stores ids; look up who/what each entry is about so it reads in plain words. */
async function resolveTargets(rows: AuditRow[]): Promise<Names> {
  const ids = (table: string, extra: (r: AuditRow) => (string | null | undefined)[] = () => []) =>
    [...new Set(rows.flatMap((r) => (r.target_table === table ? [r.target_id, ...extra(r)] : extra(r))).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))]
  const out: Names = {}
  const staffUsers = rows.filter((r) => r.target_table === 'event_staff').map((r) => String((r.details as Record<string, unknown>).name ?? ''))
  const profileIds = [...new Set([...ids('profiles'), ...staffUsers.filter((x) => /^[0-9a-f-]{36}$/i.test(x))])]
  const regIds = ids('event_registrations')
  const eventIds = [...new Set([...ids('events'), ...rows.filter((r) => ['event_staff', 'event_settings'].includes(r.target_table)).map((r) => r.target_id).filter((x): x is string => !!x)])]
  const [p, r, e, t] = await Promise.all([
    profileIds.length ? supabase.from('profiles').select('id, full_name').in('id', profileIds) : null,
    regIds.length ? supabase.from('event_registrations').select('id, code, full_name').in('id', regIds) : null,
    eventIds.length ? supabase.from('events').select('id, title').in('id', eventIds) : null,
    ids('event_ticket_types').length ? supabase.from('event_ticket_types').select('id, label').in('id', ids('event_ticket_types')) : null,
  ])
  for (const x of (p?.data ?? []) as { id: string; full_name: string }[]) out[x.id] = x.full_name || 'Member'
  for (const x of (r?.data ?? []) as { id: string; code: string; full_name: string }[]) out[x.id] = `${x.full_name} (${x.code})`
  for (const x of (e?.data ?? []) as { id: string; title: string }[]) out[x.id] = x.title
  for (const x of (t?.data ?? []) as { id: string; label: string }[]) out[x.id] = x.label
  return out
}

/** What the entry is about, in words: "Asha Rao", "Priya Sharma (JEC-AB12CD)", the event or ticket name. */
function subject(r: AuditRow, names: Names): string | null {
  const d = r.details as Record<string, any>
  if (r.target_table === 'event_staff') {
    const who = names[String(d.name)] ?? null
    const ev = r.target_id ? names[r.target_id] : null
    return [who, ev && `on ${ev}`].filter(Boolean).join(' ') || null
  }
  if (r.target_table === 'event_payments') return d.code ? String(d.code) : null
  if (r.target_table === 'messages' || r.target_table === 'groups') return null
  return (r.target_id && names[r.target_id]) || (typeof d.name === 'string' ? d.name : null)
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
  const rows = q.data?.pages.flat() ?? []
  const names = useQuery({ queryKey: ['admin-audit-names', rows.map((r) => r.id).join(',')], enabled: rows.length > 0, staleTime: 60_000, queryFn: () => resolveTargets(rows) })
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
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
                <p className="font-semibold">
                  {AUDIT_LABELS[r.action] ?? r.action}
                  {subject(r, names.data ?? {}) && <span className="font-bold text-primary"> · {subject(r, names.data ?? {})}</span>}
                </p>
                <p className="text-sm text-muted">
                  {r.actor?.full_name ?? 'System'} · {formatDateTime(r.created_at)}
                </p>
                {auditSummary(r.details) && <p className="mt-1 text-sm">{auditSummary(r.details)}</p>}
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
