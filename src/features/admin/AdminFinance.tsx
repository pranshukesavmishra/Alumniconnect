import clsx from 'clsx'
import { Download, FileSpreadsheet, Scale } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Field, Input } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { formatDate, plural } from '../../lib/format'
import { FLAGS, groupFlags, ledgerRowsToRecords, ledgerSummaryRecords, METHOD_LABELS, percentCollected } from '../../lib/ledger'
import { formatPaise } from '../../lib/money'
import type { EventRow } from '../../lib/types'
import { saveCsv } from './export'
import { fetchLedgerRows, useLedger } from './opsQueries'

const money = (p: number) => formatPaise(p, { zeroAsFree: false })

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tabular-nums', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  )
}

/** Treasurer view: what was collected, verified, refunded and is still pending, by method, ticket type and day; with discrepancy flags and CSV downloads. */
export function AdminFinance({ event }: { event: EventRow }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<'rows' | 'summary' | null>(null)
  const bad = !!from && !!to && to < from
  const { data: l, isLoading, error, isFetching } = useLedger(event.id, bad ? '' : from, bad ? '' : to)

  async function download(kind: 'rows' | 'summary') {
    if (!l) return
    setBusy(kind)
    try {
      if (kind === 'rows') {
        const rows = await fetchLedgerRows(event.id, from, to, true)
        if (rows.length === 0) return void toast.message('Nothing to download for this period.')
        saveCsv(`${event.slug}-ledger-${from || 'start'}-${to || 'today'}.csv`, ledgerRowsToRecords(rows))
        toast.success(`${plural(rows.length, 'line', 'lines')} downloaded`)
      } else {
        saveCsv(`${event.slug}-reconciliation-${from || 'start'}-${to || 'today'}.csv`, ledgerSummaryRecords(l))
      }
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <div className="space-y-3" aria-busy="true" aria-label="Loading the ledger"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
  if (error && !l) return <Notice tone="danger" title={friendlyError(error)} />
  if (!l) return null

  const flags = groupFlags(l.flags)
  const pct = percentCollected(l.position)
  const periodLabel = from || to ? `${from ? formatDate(from) : 'the start'} to ${to ? formatDate(to) : 'today'}` : 'all time'

  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="From" optional>{(p) => <Input {...p} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To" optional error={bad ? 'The end date is before the start date.' : null}>{(p) => <Input {...p} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Button variant="ghost" disabled={!from && !to} onClick={() => { setFrom(''); setTo('') }}>All time</Button>
        </div>
        <p className="text-xs text-muted">Money in and out is counted for {periodLabel} (India time). Totals for what is booked and still owed are always as of now.{isFetching ? ' Updating…' : ''}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ledger-totals">
        <Figure label="Verified (collected)" value={money(l.totals.verified)} hint={plural(l.totals.payments, 'payment', 'payments')} tone="success" />
        <Figure label="Refunded" value={money(l.totals.refunded)} hint={plural(l.totals.refunds, 'refund', 'refunds')} tone={l.totals.refunded ? 'warning' : undefined} />
        <Figure label="Net kept" value={money(l.totals.net)} hint="Verified minus refunded" />
        <Figure label="Awaiting verification" value={money(l.totals.pending)} hint={plural(l.totals.pending_count, 'payment', 'payments')} tone={l.totals.pending ? 'warning' : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Booked (all tickets)" value={money(l.position.booked)} hint={plural(l.position.registrations, 'registration', 'registrations')} />
        <Figure label="Covered so far" value={money(l.position.covered)} hint={`${pct}% of booked (incl. waivers)`} tone="success" />
        <Figure label="Still to collect" value={money(l.position.outstanding)} hint="Not paid and not waiting" tone={l.position.outstanding ? 'warning' : undefined} />
        <Figure label="Waived" value={money(l.totals.waived)} hint="Fee waivers and discounts" />
      </div>

      <section className="space-y-3" aria-label="Discrepancies">
        <SectionTitle action={<Badge tone={l.flag_total ? 'danger' : 'success'}>{l.flag_total ? plural(l.flag_total, 'flag', 'flags') : 'All clear'}</Badge>}>Needs checking</SectionTitle>
        {flags.length === 0 ? (
          <EmptyState icon={<Scale />} title="Everything adds up">No registration has more or less money than it should, and nothing has been waiting long.</EmptyState>
        ) : (
          flags.map((g) => (
            <Card key={g.kind} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{FLAGS[g.kind].title}</p>
                  <p className="text-sm text-muted">{FLAGS[g.kind].what}</p>
                </div>
                <Badge tone={FLAGS[g.kind].tone}>{g.items.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {g.items.map((f) => (
                  <li key={f.registration_id + f.kind}>
                    <Link to={`?tab=people&q=${encodeURIComponent(f.code)}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-primary">
                      <span className="min-w-0 truncate"><span className="font-mono text-sm">{f.code}</span> · {f.full_name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{money(f.amount_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {l.flag_total > l.flags.length && <p className="text-xs text-muted">Showing the first {l.flags.length} of {l.flag_total}.</p>}
            </Card>
          ))
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>By method</SectionTitle>
          <Table
            head={['Method', 'Verified', 'Refunded', 'Waiting']}
            rows={l.by_method.map((m) => [METHOD_LABELS[m.method] ?? m.method, money(m.verified), money(m.refunded), money(m.pending)])}
            empty="No money in this period."
          />
        </Card>
        <Card className="p-4">
          <SectionTitle>By ticket type</SectionTitle>
          <Table
            head={['Ticket', 'Booked', 'Collected*']}
            rows={l.by_ticket.map((k) => [`${k.label} × ${k.quantity}`, money(k.booked), money(k.collected)])}
            empty="No tickets."
          />
          <p className="mt-2 text-xs text-muted">*An estimate: a registration’s verified money shared across its tickets in proportion.</p>
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle>Per day</SectionTitle>
        <Table
          head={['Day', 'Verified', 'Refunded', 'Waiting', 'Waived']}
          rows={l.by_day.map((d) => [formatDate(d.day), money(d.verified), money(d.refunded), money(d.pending), money(d.waived)])}
          empty="No money in this period."
        />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Download className="size-4" />} loading={busy === 'rows'} onClick={() => download('rows')}>
          Download every payment and refund (CSV)
        </Button>
        <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} loading={busy === 'summary'} onClick={() => download('summary')}>
          Download this summary (CSV)
        </Button>
      </div>
      <p className="text-xs text-muted">Downloads of the line-by-line ledger are written to the activity log. Refunds are recorded from a person’s card on the People tab.</p>
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[18rem] text-left text-sm">
        <thead>
          <tr className="text-muted">
            {head.map((h, i) => <th key={h} scope="col" className={clsx('py-1.5 pr-3 font-medium', i > 0 && 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => <td key={i} className={clsx('py-2 pr-3', i > 0 ? 'text-right tabular-nums' : 'font-medium')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
