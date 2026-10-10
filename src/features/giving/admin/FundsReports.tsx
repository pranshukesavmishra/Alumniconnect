import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Card, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { Select } from '../../../components/ui/Form'
import { friendlyError } from '../../../lib/errors'
import { formatPaise } from '../../../lib/money'
import { saveCsv, stamp } from '../../admin/export'
import { admin, useAdminCampaigns, useReport, useSponsorReport } from '../api'
import { useRunner } from './util'

const KINDS = [
  { id: 'campaign', label: 'By appeal' },
  { id: 'batch', label: 'By batch' },
  { id: 'department', label: 'By department' },
  { id: 'month', label: 'By month' },
  { id: 'donor', label: 'Gifts (donors)' },
  { id: 'sponsors', label: 'Sponsorship: target vs raised' },
  { id: 'sponsor_tiers', label: 'Sponsorship: by tier' },
  { id: 'sponsor_outstanding', label: 'Sponsorship: outstanding' },
] as const

type Row = Record<string, unknown>
const isMoney = (k: string) => k.endsWith('_paise')
const head = (k: string) => k.replace(/_paise$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function FundsReports() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('campaign')
  const [campaign, setCampaign] = useState('')
  const campaigns = useAdminCampaigns()
  const isSponsor = kind.startsWith('sponsor')
  const gift = useReport(isSponsor ? 'campaign' : kind, campaign || null, !isSponsor)
  const sp = useSponsorReport(kind === 'sponsors' ? 'event' : kind === 'sponsor_tiers' ? 'tier' : 'outstanding', isSponsor)
  const q = isSponsor ? sp : gift
  const rows = (q.data ?? []) as Row[]
  const { run } = useRunner()
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => !/(^id$|_id$|^anonymous$)/.test(k)) : []
  const cell = (r: Row, k: string) => (isMoney(k) ? formatPaise(Number(r[k] ?? 0), { zeroAsFree: false }) : r[k] == null ? '' : String(r[k]))

  async function download() {
    // the export is logged first; the file is formula-safe (saveCsv neutralises = + - @ cells)
    const ok = await run(() => admin.logExport(kind, rows.length))
    if (!ok) return
    saveCsv(`funds-${kind}-${stamp()}.csv`, rows.map((r) => Object.fromEntries(cols.map((k) => [head(k) + (isMoney(k) ? ' (INR)' : ''), isMoney(k) ? Number(r[k] ?? 0) / 100 : (r[k] ?? '')]))))
  }

  return (
    <section className="space-y-3" aria-label="Reports">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label="Report" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="report-kind">{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>
        {!isSponsor && <Select aria-label="Appeal" value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">All appeals</option>{(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}
      </div>
      {q.error && <Notice tone="danger" title={friendlyError(q.error)} />}
      {q.isLoading ? <Skeleton className="h-28" /> : !rows.length ? <EmptyState title="Nothing to report yet" /> : (
        <>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={download} data-testid="report-csv">Download CSV</Button>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm" data-testid="report-table">
              <thead className="bg-surface-2 text-muted"><tr>{cols.map((k) => <th key={k} className="px-3 py-2.5 font-semibold">{head(k)}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => <tr key={i}>{cols.map((k) => <td key={k} className={`px-3 py-2.5 ${isMoney(k) ? 'tabular-nums' : ''}`}>{cell(r, k)}</td>)}</tr>)}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted">Only verified gifts count. Anonymous donors are shown as “A JECian” unless you can also verify donations. In-kind sponsorship is shown apart from cash.</p>
        </>
      )}
    </section>
  )
}
