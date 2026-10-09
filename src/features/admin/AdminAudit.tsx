import { useQuery } from '@tanstack/react-query'
import { Download, History } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { AUDIT_GROUPS, AUDIT_LABELS, auditSummary } from '../../lib/auditText'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../auth/AuthProvider'
import { saveCsv } from './export'
import { fetchAuditForExport, useAuditSearch, type AuditFilter, type AuditRow } from './queries'

type Names = Record<string, string>

/** The audit log stores ids; look up who/what each entry is about so it reads in plain words. */
async function resolveTargets(rows: AuditRow[]): Promise<Names> {
  const isId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)
  const ids = (table: string) => [...new Set(rows.filter((r) => r.target_table === table).map((r) => r.target_id).filter(isId))]
  const staffUsers = rows.filter((r) => r.target_table === 'event_staff').map((r) => (r.details as Record<string, unknown>).name)
  const profileIds = [...new Set([...ids('profiles'), ...staffUsers.filter(isId)])]
  const regIds = ids('event_registrations')
  const eventIds = [...new Set([...ids('events'), ...rows.filter((r) => ['event_staff', 'event_settings'].includes(r.target_table)).map((r) => r.target_id).filter(isId)])]
  const out: Names = {}
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

const EMPTY: AuditFilter = { actions: [], actor: '', q: '', from: '', to: '' }

/** Every admin change. Filter by kind of action, person, words and dates; download what you see as a spreadsheet. */
export function AdminAudit() {
  const { data: me, isLoading } = useMyProfile()
  const [group, setGroup] = useState<string>('')
  const [qText, setQText] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const filter: AuditFilter = { ...EMPTY, actions: AUDIT_GROUPS.find((g) => g.id === group)?.actions ?? [], q: qText, from, to }
  const [applied, setApplied] = useState<AuditFilter>(filter)
  const q = useAuditSearch(applied, !!me?.is_admin)
  const rows = q.data?.pages.flat() ?? []
  const names = useQuery({ queryKey: ['admin-audit-names', rows.map((r) => r.id).join(',')], enabled: rows.length > 0, staleTime: 60_000, queryFn: () => resolveTargets(rows) })
  const [exporting, setExporting] = useState(false)
  if (isLoading) return <PageSkeleton />
  if (!me?.is_admin) return <Navigate to="/admin" replace />
  const apply = (next: Partial<{ group: string; q: string; from: string; to: string }> = {}) => {
    const g = next.group ?? group
    setApplied({ ...EMPTY, actions: AUDIT_GROUPS.find((x) => x.id === g)?.actions ?? [], q: next.q ?? qText, from: next.from ?? from, to: next.to ?? to })
  }
  const filtered = applied.actions.length > 0 || !!applied.q || !!applied.from || !!applied.to

  async function download() {
    setExporting(true)
    try {
      const all = await fetchAuditForExport(applied)
      const nm = await resolveTargets(all)
      // the download itself is written to the log (before the file is saved)
      const logged = await supabase.rpc('admin_log_audit_export', { p_count: all.length, p_filter: { actions: applied.actions, q: applied.q, from: applied.from, to: applied.to } })
      if (logged.error) throw logged.error
      saveCsv('activity-log.csv', all.map((r) => ({ when: r.created_at, who: r.actor_name ?? 'System', action: AUDIT_LABELS[r.action] ?? r.action, about: subject(r, nm) ?? '', details: auditSummary(r.details) })))
      toast.success(`${all.length} entries downloaded`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Every change made by admins and the event team" back="/admin" />
      <Page className="space-y-3">
        <form className="space-y-2" role="search" onSubmit={(e) => { e.preventDefault(); apply() }}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of action">
            {[{ id: '', label: 'Everything', actions: [] as string[] }, ...AUDIT_GROUPS].map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={group === g.id}
                onClick={() => { setGroup(g.id); apply({ group: g.id }) }}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${group === g.id ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted'}`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <Input type="search" aria-label="Search the activity log" placeholder="Search by person, event, code or words" value={qText} onChange={(e) => setQText(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">Search</Button>
            {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => { setGroup(''); setQText(''); setFrom(''); setTo(''); setApplied(EMPTY) }}>Clear filters</Button>}
            <Button type="button" size="sm" variant="secondary" icon={<Download className="size-4" />} loading={exporting} disabled={rows.length === 0} onClick={download}>Download CSV</Button>
          </div>
        </form>
        {q.error && <Notice tone="danger" title={friendlyError(q.error)} />}
        {q.isLoading ? (
          <PageSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={<History />} title={filtered ? 'Nothing matches' : 'Nothing yet'}>{filtered ? 'Try fewer filters or different words.' : 'Admin actions will appear here.'}</EmptyState>
        ) : (
          <Card className="divide-y divide-border" data-testid="audit-rows">
            {rows.map((r) => (
              <div key={r.id} className="p-4" data-action={r.action}>
                <p className="font-semibold">
                  {AUDIT_LABELS[r.action] ?? r.action}
                  {subject(r, names.data ?? {}) && <span className="font-bold text-primary"> · {subject(r, names.data ?? {})}</span>}
                </p>
                <p className="text-sm text-muted">{r.actor_name ?? 'System'} · {formatDateTime(r.created_at)}</p>
                {auditSummary(r.details) && <p className="mt-1 text-sm [overflow-wrap:anywhere]">{auditSummary(r.details)}</p>}
              </div>
            ))}
          </Card>
        )}
        {q.hasNextPage && <Button variant="secondary" block loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Show older</Button>}
      </Page>
    </div>
  )
}
