import { Check, Copy, FileSpreadsheet, Plus, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { matchStatement, readStatementFile, type MatchResult } from '../../../lib/bankStatement'
import { friendlyError } from '../../../lib/errors'
import { formatDateTime } from '../../../lib/format'
import { formatPaise } from '../../../lib/money'
import { MemberPicker } from '../../admin/MemberPicker'
import { admin, useAdminCampaigns, useQueue, type QueueRow } from '../api'
import { money, todayIst, useRunner } from './util'

const STATUSES = [
  { id: 'submitted', label: 'To verify' },
  { id: 'verified', label: 'Verified' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'refunded', label: 'Refunded' },
  { id: 'all', label: 'All' },
]

function OfflineSheet({ onClose }: { onClose: () => void }) {
  const campaigns = useAdminCampaigns()
  const { run, busy } = useRunner()
  const live = (campaigns.data ?? []).filter((c) => c.status !== 'draft')
  const [campaign, setCampaign] = useState('')
  const [member, setMember] = useState<{ id: string; name: string } | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayIst())
  const [anon, setAnon] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    const a = money(amount, 'The amount', { min: 1000 })
    if (a.error) return setErr(a.error)
    if (!campaign) return setErr('Choose the appeal.')
    if (!member && !name.trim()) return setErr('Choose the member or type the donor’s name.')
    setErr(null)
    const ok = await run(() => admin.recordOffline({ campaign_id: campaign, user_id: member?.id ?? null, donor_name: member ? null : name, amount_paise: a.paise, method, reference: ref, reason, received_on: date, anonymous: anon }), 'Gift recorded.')
    if (ok) onClose()
  }
  return (
    <Sheet open onClose={onClose} label="Record a cash, cheque or bank gift">
      <div className="space-y-4 p-5" data-testid="offline-sheet">
        <h2 className="text-lg font-bold">Record a cash, cheque or bank gift</h2>
        <Field label="Appeal">{(p) => <Select {...p} value={campaign} onChange={(e) => setCampaign(e.target.value)} data-testid="off-campaign"><option value="">Choose…</option>{live.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
        {member ? (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft p-3 font-semibold">{member.name}<Button size="sm" variant="ghost" onClick={() => setMember(null)}>Change</Button></p>
        ) : (
          <>
            <MemberPicker label="Search a member (optional)" actionLabel="Pick" onPick={(id, n) => setMember({ id, name: n })} />
            <Field label="Or the donor’s name" optional>{(p) => <Input {...p} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-testid="off-name" />}</Field>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="off-amount" />}</Field>
          <Field label="How">{(p) => <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option></Select>}</Field>
        </div>
        <Field label="Cheque number or bank reference" optional hint="A 12-digit bank UTR is checked against UPI and event payments.">{(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
        <Field label="Date received">{(p) => <Input {...p} type="date" max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Why is this recorded by hand?" hint="Kept in the activity log.">{(p) => <Textarea {...p} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="off-reason" />}</Field>
        <Checkbox checked={anon} onChange={setAnon}>The donor asked to stay anonymous</Checkbox>
        {err && <Notice tone="danger" title={err} />}
        <Button block loading={busy} onClick={save} data-testid="off-save">Record gift</Button>
      </div>
    </Sheet>
  )
}

function ReasonSheet({ title, label, cta, onClose, onDo }: { title: string; label: string; cta: string; onClose: () => void; onDo: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open onClose={onClose} label={title}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{title}</h2>
        <Field label={label}>{(p) => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" />}</Field>
        <Button block variant="danger" loading={busy} data-testid="reason-ok" onClick={async () => { setBusy(true); const ok = await onDo(reason); setBusy(false); if (ok) onClose() }}>{cta}</Button>
      </div>
    </Sheet>
  )
}

export function FundsQueue() {
  const [status, setStatus] = useState('submitted')
  const [campaign, setCampaign] = useState('')
  const [q, setQ] = useState('')
  const campaigns = useAdminCampaigns()
  const { data, isLoading, error } = useQueue(status, campaign || null, q.trim(), true)
  const { run, busy } = useRunner()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [offline, setOffline] = useState(false)
  const [reject, setReject] = useState<QueueRow | null>(null)
  const [refund, setRefund] = useState<QueueRow | null>(null)
  const [matches, setMatches] = useState<Map<string, MatchResult> | null>(null)

  const rows = data ?? []
  const pending = useMemo(() => rows.filter((r) => r.status === 'submitted'), [rows])

  async function verify(ids: string[]) {
    if (!ids.length) return
    let skipped: { id: string; reason: string }[] = []
    let n = 0
    const ok = await run(async () => { const r = await admin.verify(ids); n = r.verified; skipped = r.skipped })
    if (ok) {
      setSel(new Set())
      if (n) toast.success(`${n} gift${n === 1 ? '' : 's'} verified. Donors have been thanked.`)
      if (skipped.length) toast.error(`${skipped.length} skipped: ${skipped[0]!.reason}`)
    }
  }

  async function onStatement(f: File | undefined) {
    if (!f) return
    try {
      const sheet = await readStatementFile(f)
      setMatches(matchStatement(sheet, pending.filter((p) => p.utr).map((p) => ({ id: p.id, utr: p.utr, amount_paise: p.amount_paise }))))
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  const matched = matches ? pending.filter((p) => matches.get(p.id)?.status === 'matched') : []

  return (
    <section className="space-y-3" aria-label="Verification queue">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOffline(true)} data-testid="record-offline">Record a cash, cheque or bank gift</Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft">
          <FileSpreadsheet className="size-4" aria-hidden /> Match a bank statement
          <input type="file" accept=".csv,.xlsx" className="sr-only" data-testid="statement-input" onChange={(e) => { void onStatement(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      {matches && (
        <Notice tone={matched.length ? 'success' : 'info'} title={`${matched.length} of ${pending.length} waiting gifts match the statement exactly (UTR and amount)`}>
          {matched.length > 0 && <Button size="sm" className="mt-2" loading={busy} data-testid="verify-matched" onClick={() => verify(matched.map((m) => m.id))}>Verify the {matched.length} matched</Button>}
        </Notice>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setSel(new Set()) }} data-testid="queue-status">{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        <Select aria-label="Appeal" value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">All appeals</option>{(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
        <Input type="search" aria-label="Search by name, UTR or receipt" placeholder="Name, UTR or receipt" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {status === 'submitted' && pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox checked={sel.size === pending.length} onChange={(v) => setSel(v ? new Set(pending.map((p) => p.id)) : new Set())}>Select all</Checkbox>
          <Button size="sm" disabled={!sel.size} loading={busy} data-testid="verify-selected" onClick={() => verify([...sel])}>Verify selected ({sel.size})</Button>
        </div>
      )}
      {error && <Notice tone="danger" title={friendlyError(error)} />}
      {isLoading ? <Skeleton className="h-28" /> : !rows.length ? (
        <EmptyState title={status === 'submitted' ? 'Nothing waiting' : 'Nothing here'}>{status === 'submitted' ? 'New gifts appear here as soon as a donor sends a UTR.' : 'No gifts with this status.'}</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const m = matches?.get(r.id)
            return (
              <Card key={r.id} className="space-y-2 p-4" data-testid="queue-row" data-utr={r.utr ?? ''} data-status={r.status}>
                <div className="flex items-start gap-3">
                  {r.status === 'submitted' && <div className="pt-1"><Checkbox checked={sel.has(r.id)} onChange={(v) => { const n = new Set(sel); if (v) n.add(r.id); else n.delete(r.id); setSel(n) }}><span className="sr-only">Select {r.donor_name}</span></Checkbox></div>}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{r.donor_name ?? 'Unknown'}{r.donor_batch ? <span className="font-normal text-muted"> · batch {r.donor_batch}</span> : null}</p>
                    <p className="text-sm text-muted">{r.campaign_title}{r.item_name ? ` · ${r.item_name}` : ''}{r.kind === 'sponsorship' ? ' · sponsorship' : ''}</p>
                  </div>
                  <b className="tabular-nums">{formatPaise(r.amount_paise, { zeroAsFree: false })}</b>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={r.status === 'verified' ? 'success' : r.status === 'submitted' ? 'warning' : r.status === 'rejected' ? 'danger' : 'neutral'}>{r.status}</Badge>
                  {r.is_anonymous && <Badge>Anonymous to members</Badge>}
                  {r.utr_conflict && <Badge tone="danger">UTR also used elsewhere</Badge>}
                  {m && <Badge tone={m.status === 'matched' ? 'success' : m.status === 'needs_review' ? 'warning' : 'neutral'}>{m.status === 'matched' ? 'Matches statement' : m.status === 'needs_review' ? (m.reason ?? 'Check the statement') : 'Not in statement'}</Badge>}
                  <span className="text-muted">{formatDateTime(r.created_at)}</span>
                </div>
                {(r.utr || r.reference) && (
                  <p className="flex items-center gap-1 font-mono text-sm">{r.method.toUpperCase()} {r.utr ?? r.reference}
                    {r.utr && <button type="button" className="grid size-9 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label="Copy UTR" onClick={() => void navigator.clipboard?.writeText(r.utr!)}><Copy className="size-4" /></button>}</p>
                )}
                {r.dedication && <p className="text-sm text-muted">In honour of: {r.dedication}</p>}
                {r.message && <p className="text-sm">“{r.message}”</p>}
                {r.offline_reason && <p className="text-sm text-muted">Recorded by hand: {r.offline_reason}</p>}
                {r.review_note && <p className="text-sm text-danger">{r.review_note}</p>}
                {r.refund_reason && <p className="text-sm text-muted">Refund: {r.refund_reason}</p>}
                <div className="flex flex-wrap gap-2">
                  {r.status === 'submitted' && <>
                    <Button size="sm" icon={<Check className="size-4" />} loading={busy} data-testid="verify-one" onClick={() => verify([r.id])}>Verify</Button>
                    <Button size="sm" variant="secondary" icon={<X className="size-4" />} data-testid="reject-one" onClick={() => setReject(r)}>Not received</Button>
                  </>}
                  {r.status === 'verified' && <>
                    {r.receipt_no && <Link to={`/give/receipt/${r.id}`} className="inline-flex min-h-9 items-center text-sm font-semibold text-primary">Receipt {r.receipt_no}</Link>}
                    <Button size="sm" variant="secondary" icon={<Undo2 className="size-4" />} data-testid="refund-one" onClick={() => setRefund(r)}>Refund</Button>
                  </>}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {offline && <OfflineSheet onClose={() => setOffline(false)} />}
      {reject && <ReasonSheet title="Mark as not received" label="Why? The donor will see this." cta="Mark as not received" onClose={() => setReject(null)} onDo={(why) => run(() => admin.reject(reject.id, why), 'Marked as not received. The donor has been told.')} />}
      {refund && <ReasonSheet title="Refund this gift" label="Why is it refunded?" cta="Record refund" onClose={() => setRefund(null)} onDo={(why) => run(() => admin.refund(refund.id, why), 'Refund recorded.')} />}
    </section>
  )
}
