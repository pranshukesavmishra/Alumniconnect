// Organise -> event -> Advances: the list of advances people paid before registrations moved to the app (Google Form days).
// Import it from the organisers' sheet (CSV or Excel) or add people one by one; the server applies each advance to the
// matching member's registration (now, for people already registered, or when they register) and the member pays the rest.
import clsx from 'clsx'
import { FileUp, Plus, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Field, Input, Select } from '../../components/ui/Form'
import { BRANCHES } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, plural } from '../../lib/format'
import { formatPaise, parseRupeesToPaise } from '../../lib/money'
import type { EventRow } from '../../lib/types'
import { advEmail, advPhone } from '../events/advance'
import { DEFAULT_ADVANCE_PAISE, readAdvanceFile, toAdvancePayload, type AdvanceRow, type ParsedAdvance } from './advanceImport'
import { useAddAdvanceCredits, useAdvanceCredits, useVoidAdvanceCredit, type AdvanceCredit, type AdvanceImportResult } from './advanceQueries'

const STATUS: Record<AdvanceCredit['status'], { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  open: { label: 'Not used yet', tone: 'neutral' },
  claimed: { label: 'Applied', tone: 'success' },
  void: { label: 'Void', tone: 'danger' },
}
const MATCH: Record<NonNullable<AdvanceCredit['match_reason']>, string> = {
  phone: 'Matched by mobile number',
  email: 'Matched by email',
  name: 'Matched by name, batch and branch',
  admin: 'Applied by an organiser',
}
const PROBLEM: Record<Exclude<AdvanceRow['problem'], ''>, string> = {
  no_name: 'No name',
  no_amount: 'Amount says not paid',
  no_key: 'Needs a mobile, an email, or batch and branch',
}
const PARSE_ERROR: Record<NonNullable<ParsedAdvance['error']>, string> = {
  empty: 'The file has no rows.',
  no_name: 'No name column was found. Use a column called Name.',
  too_many: 'At most 5000 rows at a time.',
}

export function AdminAdvances({ event, canWrite }: { event: EventRow; canWrite: boolean }) {
  const list = useAdvanceCredits(event.id)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | AdvanceCredit['status']>('all')
  const credits = useMemo(() => list.data?.credits ?? [], [list.data])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return credits.filter((c) => (status === 'all' || c.status === status) &&
      (!needle || [c.full_name, c.branch, String(c.grad_year ?? ''), c.registration_code, c.note].some((v) => v?.toLowerCase().includes(needle))))
  }, [credits, q, status])

  if (list.isLoading) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
  if (list.error || !list.data) return <Notice tone="danger" title={friendlyError(list.error)} />
  const sum = (s: AdvanceCredit['status']) => credits.filter((c) => c.status === s)
  const money = (rows: AdvanceCredit[]) => formatPaise(rows.reduce((a, c) => a + c.amount_paise, 0), { zeroAsFree: false })

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="advances">
      <p className="text-sm text-muted">
        Advances people paid before registrations moved to the app. When someone on this list registers, their advance comes off what they pay by UPI. They are found by mobile number, by email, or by name with the same batch and branch. If two advances could belong to one person, nothing is applied and the registration is marked for you to check.
      </p>
      <div className="grid grid-cols-3 gap-3 text-center" data-testid="advance-figures">
        <Card className="p-3"><p className="text-xs text-muted">Not used yet</p><p className="text-xl font-bold tabular-nums">{sum('open').length}</p><p className="text-xs text-muted">{money(sum('open'))}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Applied</p><p className="text-xl font-bold tabular-nums text-success">{sum('claimed').length}</p><p className="text-xs text-muted">{money(sum('claimed'))}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Void</p><p className="text-xl font-bold tabular-nums">{sum('void').length}</p><p className="text-xs text-muted">{money(sum('void'))}</p></Card>
      </div>

      {list.data.review.length > 0 && (
        <section className="space-y-2" data-testid="advance-review">
          <SectionTitle>Needs review: possible advance match</SectionTitle>
          <Card className="divide-y divide-border">
            {list.data.review.map((r) => (
              <Link key={r.id} to={`?tab=people&q=${encodeURIComponent(r.code)}`} className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.full_name}</span>
                  <span className="block truncate text-sm text-muted"><span className="font-mono">{r.code}</span> · {[r.branch, r.grad_year].filter(Boolean).join(' ')}</span>
                </span>
                <Badge tone="accent">Open</Badge>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {canWrite && <ImportCard eventId={event.id} />}
      {canWrite && <AddOneCard eventId={event.id} />}

      <section className="space-y-3">
        <SectionTitle>Advance list</SectionTitle>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search advances" placeholder="Name, batch, branch, code…" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show">
          {(['all', 'open', 'claimed', 'void'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={clsx('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', status === s ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}
            >
              {s === 'all' ? 'All' : STATUS[s].label} · {s === 'all' ? credits.length : sum(s).length}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState title="No advances here">Import the organisers’ advance list, or add people one by one.</EmptyState>
        ) : (
          <Card className="divide-y divide-border" data-testid="advance-list">
            {shown.map((c) => <CreditRow key={c.id} c={c} eventId={event.id} canWrite={canWrite} />)}
          </Card>
        )}
      </section>
    </div>
  )
}

function CreditRow({ c, eventId, canWrite }: { c: AdvanceCredit; eventId: string; canWrite: boolean }) {
  const voidIt = useVoidAdvanceCredit(eventId)
  function onVoid() {
    const reason = window.prompt(`Void the advance of ${c.full_name}? Give a reason (kept in the activity log).`)
    if (!reason?.trim()) return
    voidIt.mutate({ creditId: c.id, reason: reason.trim() }, { onSuccess: () => toast.success('Advance voided'), onError: (e) => toast.error(friendlyError(e)) })
  }
  return (
    <div className="flex items-start gap-3 p-3" data-status={c.status}>
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold">{c.full_name}</p>
        <p className="break-words text-sm text-muted">{[c.grad_year, c.branch].filter(Boolean).join(' · ') || '—'}</p>
        <p className="break-words text-xs text-muted">{[c.phone_masked, c.email_masked, c.note].filter(Boolean).join(' · ')}</p>
        {c.status === 'claimed' && c.registration_code && (
          <p className="text-sm">
            <Link className="font-semibold text-primary underline" to={`?tab=people&q=${encodeURIComponent(c.registration_code)}`}>
              <span className="font-mono">{c.registration_code}</span> {c.registration_name}
            </Link>
            {c.match_reason && <span className="text-muted">{` · ${MATCH[c.match_reason]} · ${formatDateTime(c.claimed_at ?? c.created_at)}`}</span>}
          </p>
        )}
        {c.status === 'void' && c.void_reason && <p className="text-sm text-muted">{c.void_reason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-semibold tabular-nums">{formatPaise(c.amount_paise)}</span>
        <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
        {canWrite && c.status === 'open' && (
          <Button size="sm" variant="ghost" loading={voidIt.isPending} onClick={onVoid}>Void</Button>
        )}
      </div>
    </div>
  )
}

function resultMessage(r: AdvanceImportResult): string {
  return [
    `${plural(r.added, 'advance', 'advances')} added`,
    r.duplicates.length ? `${r.duplicates.length} already on the list` : '',
    r.rejected.length ? `${r.rejected.length} not usable` : '',
    r.applied ? `${r.applied} applied to registrations` : '',
    r.review ? `${r.review} need review` : '',
  ].filter(Boolean).join(' · ')
}

function ImportCard({ eventId }: { eventId: string }) {
  const file = useRef<HTMLInputElement>(null)
  const add = useAddAdvanceCredits(eventId)
  const [parsed, setParsed] = useState<ParsedAdvance | null>(null)
  const [reading, setReading] = useState(false)
  const [source, setSource] = useState('Google Form advance list')
  const [fallback, setFallback] = useState(String(DEFAULT_ADVANCE_PAISE / 100))

  async function pick(f: File | undefined) {
    setParsed(null)
    if (!f) return
    if (f.size > 5_000_000) return toast.error('That file is too big (5 MB at most).')
    setReading(true)
    try {
      setParsed(await readAdvanceFile(f, parseRupeesToPaise(fallback) ?? DEFAULT_ADVANCE_PAISE))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setReading(false)
    }
  }
  const ready = parsed && !parsed.error ? parsed.rows.filter((r) => !r.problem) : []
  const skipped = parsed && !parsed.error ? parsed.rows.filter((r) => r.problem) : []

  return (
    <Card className="space-y-3 p-4">
      <p className="font-semibold">Import the advance list</p>
      <p className="-mt-2 text-sm text-muted">CSV or Excel with the columns Name, JEC Graduation Year, Branch, Contact Number, Email Id, Advance amount and Note. A blank amount or “Paid” means the default advance. Rows already on the list are skipped, so importing the same file again is safe.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where the list came from">{(p) => <Input {...p} maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} />}</Field>
        <Field label="Default advance (₹)">{(p) => <Input {...p} inputMode="decimal" value={fallback} onChange={(e) => setFallback(e.target.value)} />}</Field>
      </div>
      <Button icon={<FileUp className="size-4" />} loading={reading} onClick={() => file.current?.click()}>Choose a CSV or Excel file</Button>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Advance list file"
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {parsed?.error && <Notice tone="danger" title={PARSE_ERROR[parsed.error]} />}
      {parsed && !parsed.error && (
        <div className="space-y-2 text-sm" data-testid="advance-parsed">
          <p className="font-semibold">{plural(ready.length, 'person', 'people')} ready to import</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {ready.slice(0, 5).map((r) => (
              <li key={r.line} className="flex justify-between gap-3 p-2">
                <span className="min-w-0 truncate">{r.full_name} · {[r.grad_year, r.branch].filter(Boolean).join(' ')}</span>
                <span className="shrink-0 tabular-nums">{formatPaise(r.amount_paise ?? 0)}</span>
              </li>
            ))}
          </ul>
          {ready.length > 5 && <p className="text-muted">{`and ${ready.length - 5} more`}</p>}
          {skipped.length > 0 && (
            <div className="text-warning">
              <p className="font-semibold">{plural(skipped.length, 'row', 'rows')} skipped</p>
              <ul className="list-disc pl-5">
                {skipped.slice(0, 10).map((r) => <li key={r.line}>{`Row ${r.line + 1}: ${r.full_name || '—'} (${PROBLEM[r.problem as Exclude<AdvanceRow['problem'], ''>]})`}</li>)}
              </ul>
            </div>
          )}
          <Button
            size="lg"
            block
            disabled={!ready.length}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { rows: toAdvancePayload(ready), source: source.trim() || null },
                {
                  onSuccess: (r) => {
                    toast.success(resultMessage(r))
                    setParsed(null)
                  },
                  onError: (e) => toast.error(friendlyError(e)),
                },
              )
            }
          >
            {`Import ${plural(ready.length, 'advance', 'advances')}`}
          </Button>
        </div>
      )}
    </Card>
  )
}

function AddOneCard({ eventId }: { eventId: string }) {
  const add = useAddAdvanceCredits(eventId)
  const [open, setOpen] = useState(false)
  const empty = { name: '', year: '', branch: '', phone: '', email: '', amount: String(DEFAULT_ADVANCE_PAISE / 100), note: '' }
  const [f, setF] = useState(empty)
  const set = (k: keyof typeof empty, v: string) => setF((x) => ({ ...x, [k]: v }))

  function save() {
    const amount = parseRupeesToPaise(f.amount)
    if (f.name.trim().length < 2) return toast.error('Enter the name.')
    if (!amount) return toast.error('Enter the advance amount.')
    const phone = advPhone(f.phone)
    const email = advEmail(f.email)
    const year = /^(19|20)\d{2}$/.test(f.year.trim()) ? Number(f.year.trim()) : null
    if (f.phone.trim() && !phone) return toast.error('Check the mobile number.')
    if (!phone && !email && !(year && f.branch)) return toast.error('Add a mobile number, an email, or the batch and branch.')
    add.mutate(
      { rows: [{ full_name: f.name.trim(), grad_year: year, branch: f.branch || null, phone, email, amount_paise: amount, note: f.note.trim() || null }], source: 'Added by hand' },
      {
        onSuccess: (r) => {
          if (r.added === 0) return toast.error(r.duplicates.length ? 'This person is already on the advance list.' : 'This row could not be added.')
          toast.success(resultMessage(r))
          setF(empty)
          setOpen(false)
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    )
  }

  if (!open) return <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add one person</Button>
  return (
    <Card className="space-y-3 p-4" data-testid="advance-add">
      <p className="font-semibold">Add one person</p>
      <Field label="Name">{(p) => <Input {...p} maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="JEC graduation year" optional>{(p) => <Input {...p} inputMode="numeric" maxLength={4} value={f.year} onChange={(e) => set('year', e.target.value)} />}</Field>
        <Field label="Branch" optional>
          {(p) => (
            <Select {...p} value={f.branch} onChange={(e) => set('branch', e.target.value)}>
              <option value="">—</option>
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mobile number" optional>{(p) => <Input {...p} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <Field label="Email" optional>{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />}</Field>
        <Field label="Advance (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} />}</Field>
        <Field label="Note" optional>{(p) => <Input {...p} maxLength={500} value={f.note} onChange={(e) => set('note', e.target.value)} />}</Field>
      </div>
      <div className="flex gap-2">
        <Button loading={add.isPending} onClick={save}>Add advance</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  )
}
