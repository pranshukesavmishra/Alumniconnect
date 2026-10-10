import clsx from 'clsx'
import { Check, Copy, FileSpreadsheet, ImageIcon, Keyboard, Phone, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice } from '../../components/ui/Display'
import { Checkbox } from '../../components/ui/Form'
import { matchStatement, readStatementFile, type MatchResult } from '../../lib/bankStatement'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import type { EventRow, Payment, Registration } from '../../lib/types'
import { indexAfterRemoval, reviewAction, stepIndex } from '../../lib/paymentQueue'
import { useBulkReview } from './opsQueries'
import { proofUrl, useReviewPayment, type AdminData } from './queries'
import { usePaged } from '../../lib/paging'
import { formatPhone, telHref } from '../../lib/phone'

const REJECT_REASONS = [
  'UPI reference not found in our bank statement. Please check the 12-digit UTR and submit again.',
  'Amount received is less than the amount due. Please pay the balance and submit its UTR.',
  'This payment was already counted for another registration.',
]

export function AdminPayments({ event, data }: { event: EventRow; data: AdminData }) {
  const review = useReviewPayment(event.id)
  const [matches, setMatches] = useState<Map<string, MatchResult> | null>(null)
  const [statementName, setStatementName] = useState<string | null>(null)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [rejecting, setRejecting] = useState<Payment | null>(null)
  const [rejectingMany, setRejectingMany] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState(false)
  const bulkReview = useBulkReview(event.id)

  const regs = useMemo(() => new Map(data.registrations.map((r) => [r.id, r])), [data.registrations])
  const queue = data.payments.filter((p) => p.status === 'submitted')
  const paged = usePaged(queue, 50)
  const matched = matches ? queue.filter((p) => matches.get(p.id)?.status === 'matched') : []
  const chosen = queue.filter((p) => selected.has(p.id))

  async function onStatement(file: File) {
    try {
      const rows = await readStatementFile(file)
      const m = matchStatement(rows, queue)
      setMatches(m)
      setStatementName(file.name)
      const n = [...m.values()].filter((x) => x.status === 'matched').length
      toast.success(`${n} of ${queue.length} payments matched the statement`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : friendlyError(e))
    }
  }

  async function runBulk(ids: string[], approve: boolean, note: string) {
    setBulk({ done: 0, total: ids.length })
    try {
      const res = await bulkReview.mutateAsync({ ids, approve, note })
      if (res.failed.length) toast.error(`${res.done} done, ${res.failed.length} could not be reviewed (${res.failed[0]!.error}). Please check them one by one.`)
      else toast.success(`${res.done} ${approve ? 'payments verified' : 'payments marked as not received'}${res.unchanged ? ` (${res.unchanged} already were)` : ''}`)
      setSelected(new Set())
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBulk(null)
    }
  }

  async function approveMatched() {
    if (!window.confirm(`Verify ${matched.length} payments whose UTR and amount match the bank statement?`)) return
    await runBulk(matched.map((p) => p.id), true, `Matched bank statement ${statementName ?? ''}`.trim())
  }

  function approveChosen() {
    if (!window.confirm(`Verify ${chosen.length} selected payments? Only do this once the money is in the bank.`)) return
    void runBulk(chosen.map((p) => p.id), true, 'Verified in bulk')
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Match with bank statement</p>
            <p className="text-sm text-muted">Upload the account statement (.csv or .xlsx). Payments are matched only when the 12-digit UTR and the exact amount are both found on a credit.</p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 font-semibold text-primary hover:bg-primary-soft">
            <FileSpreadsheet className="size-4" aria-hidden /> {statementName ? 'Upload another' : 'Upload statement'}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void onStatement(f)
              }}
            />
          </label>
        </div>
        {matches && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3 text-sm">
            <span>
              <strong>{matched.length}</strong> matched · {queue.filter((p) => matches.get(p.id)?.status === 'needs_review').length} need a look ·{' '}
              {queue.filter((p) => matches.get(p.id)?.status === 'not_found').length} not in statement
            </span>
            {matched.length > 0 && (
              <Button size="sm" variant="success" loading={!!bulk} onClick={approveMatched} icon={<Check className="size-4" />}>
                {bulk ? `Verifying ${bulk.total}…` : `Verify ${matched.length} matched`}
              </Button>
            )}
          </div>
        )}
      </Card>

      {queue.length === 0 ? (
        <EmptyState icon={<Check />} title="All caught up">
          No payments are waiting for verification.
        </EmptyState>
      ) : focus ? (
        <FocusReview
          queue={queue}
          regs={regs}
          matches={matches}
          paused={!!rejecting}
          busy={review.isPending}
          onExit={() => setFocus(false)}
          onApprove={(p) => review.mutate({ paymentId: p.id, approve: true }, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success(`Verified ${regs.get(p.registration_id)?.code ?? ''}`) })}
          onReject={(p) => setRejecting(p)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox
              checked={chosen.length > 0 && chosen.length === queue.length}
              onChange={(v) => setSelected(v ? new Set(queue.map((p) => p.id)) : new Set())}
            >
              Select all {queue.length}
            </Checkbox>
            <Button size="sm" variant="secondary" icon={<Keyboard className="size-4" />} onClick={() => setFocus(true)}>
              Review one by one
            </Button>
          </div>
          {chosen.length > 0 && (
            <div role="region" aria-label="Bulk payment actions" className="sticky top-[calc(7.5rem+env(safe-area-inset-top))] z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-primary bg-primary-soft p-3">
              <span className="mr-auto text-sm font-semibold">{chosen.length} selected</span>
              <Button size="sm" variant="success" loading={!!bulk} icon={<Check className="size-4" />} onClick={approveChosen}>
                Verify {chosen.length}
              </Button>
              <Button size="sm" variant="secondary" disabled={!!bulk} icon={<X className="size-4" />} onClick={() => setRejectingMany(true)}>
                Not received
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}
          <ul className="space-y-3">
            {paged.shown.map((p) => (
              <PaymentCard
                key={p.id}
                p={p}
                reg={regs.get(p.registration_id)}
                match={matches?.get(p.id)}
                selected={selected.has(p.id)}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(p.id); else n.delete(p.id); return n })}
                onApprove={() => review.mutate({ paymentId: p.id, approve: true }, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Verified') })}
                onReject={() => setRejecting(p)}
                busy={review.isPending}
              />
            ))}
          </ul>
          {paged.hidden > 0 && <Button variant="secondary" block onClick={paged.more}>Show {Math.min(50, paged.hidden)} more ({paged.hidden} not shown)</Button>}
        </>
      )}

      {rejectingMany && (
        <RejectDialog
          p={null}
          count={chosen.length}
          onClose={() => setRejectingMany(false)}
          onSubmit={(note) => {
            setRejectingMany(false)
            void runBulk(chosen.map((p) => p.id), false, note)
          }}
        />
      )}
      {rejecting && (
        <RejectDialog
          p={rejecting}
          onClose={() => setRejecting(null)}
          onSubmit={(note) =>
            review.mutate(
              { paymentId: rejecting.id, approve: false, note },
              {
                onError: (e) => toast.error(friendlyError(e)),
                onSuccess: () => {
                  toast.success('Marked as not verified. The member will see your reason.')
                  setRejecting(null)
                },
              },
            )
          }
        />
      )}
    </div>
  )
}

function PaymentCard({ p, reg, match, onApprove, onReject, busy, selected, onSelect }: { p: Payment; reg?: Registration; match?: MatchResult; onApprove: () => void; onReject: () => void; busy: boolean; selected?: boolean; onSelect?: (v: boolean) => void }) {
  const [opening, setOpening] = useState(false)
  const short = reg && p.amount_paise < reg.amount_paise
  return (
    <li>
      <Card className={clsx('p-4', match?.status === 'matched' && 'border-success', selected && 'border-primary')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {onSelect && (
            <div className="-mb-2 -ml-1 -mt-1 shrink-0">
              <Checkbox checked={!!selected} onChange={onSelect}>
                <span className="sr-only">Select {reg?.full_name ?? 'payment'}</span>
              </Checkbox>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{reg?.full_name ?? 'Unknown'}</p>
            <p className="text-sm text-muted">
              <span className="font-mono">{reg?.code}</span> · {[reg?.branch, reg?.grad_year].filter(Boolean).join(' ')} · {reg?.headcount} people
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">{formatPaise(p.amount_paise)}</p>
            <p className="text-xs text-muted">{relativeTime(p.created_at)}</p>
            {!!reg?.fund_paise && <p className="text-xs text-muted">incl. {formatPaise(reg.fund_paise)} Reunion Fund</p>}
          </div>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">UTR</dt>
            <dd className="flex items-center gap-1 font-mono font-semibold">
              {p.utr}
              <button type="button" aria-label="Copy UTR" className="grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => navigator.clipboard?.writeText(p.utr ?? '').then(() => toast.success('UTR copied'))}>
                <Copy className="size-3.5" />
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Paid by</dt>
            <dd>{p.payer_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Mobile</dt>
            <dd>
              {reg?.phone ? (
                <a className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary" href={telHref(reg.phone)}>
                  <Phone className="size-3.5" aria-hidden /> {formatPhone(reg.phone)}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        {short && <Notice tone="warning" className="mt-3" title={`Partial payment: total due is ${formatPaise(reg.amount_paise)}`} />}
        {match && (
          <div className="mt-3 text-sm">
            {match.status === 'matched' && <Badge tone="success">Matches bank statement</Badge>}
            {match.status === 'needs_review' && (
              <Badge tone="warning">
                Check manually: {match.reason}
                {match.creditedPaise != null && ` (credited ${formatPaise(match.creditedPaise)})`}
              </Badge>
            )}
            {match.status === 'not_found' && <Badge tone="danger">Not in this statement</Badge>}
            {match.row && <p className="mt-1 truncate font-mono text-xs text-muted" title={match.row}>{match.row}</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="success" icon={<Check className="size-4" />} onClick={onApprove} disabled={busy}>
            Verify
          </Button>
          <Button variant="secondary" icon={<X className="size-4" />} onClick={onReject} disabled={busy}>
            Not received
          </Button>
          {p.proof_path && (
            <Button
              variant="ghost"
              icon={<ImageIcon className="size-4" />}
              loading={opening}
              onClick={async () => {
                setOpening(true)
                try {
                  window.open(await proofUrl(p.proof_path!), '_blank', 'noopener')
                } catch (e) {
                  toast.error(friendlyError(e))
                } finally {
                  setOpening(false)
                }
              }}
            >
              Screenshot
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}

function RejectDialog({ p, count, onClose, onSubmit }: { p: Payment | null; count?: number; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState(REJECT_REASONS[0]!)
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
        <h2 id="reject-title" className="text-lg font-bold">
          Payment not received?
        </h2>
        <p className="mt-1 text-sm text-muted">{p ? `UTR ${p.utr}.` : `${count} payments.`} The member will see this message and can submit again.</p>
        <div className="mt-4 space-y-2">
          {REJECT_REASONS.map((r) => (
            <label key={r} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', note === r ? 'border-primary bg-primary-soft' : 'border-border')}>
              <input type="radio" name="reason" className="mt-0.5" checked={note === r} onChange={() => setNote(r)} />
              {r}
            </label>
          ))}
          <textarea
            aria-label="Message to the member"
            className="min-h-20 w-full rounded-xl border border-border bg-surface p-3 text-[15px]"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!note.trim()} onClick={() => onSubmit(note.trim())}>
            Mark as not received
          </Button>
        </div>
      </div>
    </div>
  )
}

/** One payment at a time, with keyboard shortcuts: V verify, R not received, S skip, B back, O screenshot, C copy UTR. */
function FocusReview({ queue, regs, matches, paused, busy, onExit, onApprove, onReject }: {
  queue: Payment[]
  regs: Map<string, Registration>
  matches: Map<string, MatchResult> | null
  paused: boolean
  busy: boolean
  onExit: () => void
  onApprove: (p: Payment) => void
  onReject: (p: Payment) => void
}) {
  const [index, setIndex] = useState(0)
  const at = indexAfterRemoval(index, queue.length)
  const cur = queue[at]
  const [proof, setProof] = useState<{ id: string; url: string } | null>(null)
  const [help, setHelp] = useState(false)

  // the screenshot is shown right on the card: no extra tap to look at it
  useEffect(() => {
    let off = false
    if (cur?.proof_path) {
      proofUrl(cur.proof_path).then((url) => { if (!off) setProof({ id: cur.id, url }) }).catch(() => undefined)
    }
    return () => { off = true }
  }, [cur?.id, cur?.proof_path])

  useEffect(() => {
    if (!cur || paused) return
    const onKey = (e: KeyboardEvent) => {
      const act = reviewAction(e)
      if (!act) return
      e.preventDefault()
      if (act === 'verify') { if (!busy) onApprove(cur) }
      else if (act === 'reject') onReject(cur)
      else if (act === 'skip') setIndex(stepIndex(at, queue.length, 1))
      else if (act === 'back') setIndex(stepIndex(at, queue.length, -1))
      else if (act === 'copy') void navigator.clipboard?.writeText(cur.utr ?? '').then(() => toast.success('UTR copied'))
      else if (act === 'proof') { if (proof?.id === cur.id) window.open(proof.url, '_blank', 'noopener') }
      else if (act === 'help') setHelp((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cur, paused, busy, at, queue.length, onApprove, onReject, proof])

  if (!cur) return null
  const reg = regs.get(cur.registration_id)
  const m = matches?.get(cur.id)
  return (
    <div className="space-y-3" data-testid="focus-review">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" aria-live="polite">Payment {at + 1} of {queue.length}</p>
        <Button size="sm" variant="ghost" onClick={onExit}>Back to the list</Button>
      </div>
      <PaymentCard p={cur} reg={reg} match={m} onApprove={() => onApprove(cur)} onReject={() => onReject(cur)} busy={busy} />
      {proof?.id === cur.id && !/\.pdf($|\?)/i.test(cur.proof_path ?? '') && (
        <Card className="overflow-hidden p-2">
          <img src={proof.url} alt={`Payment screenshot from ${reg?.full_name ?? 'the member'}`} className="mx-auto max-h-[60vh] w-auto max-w-full rounded-xl object-contain" />
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setIndex(stepIndex(at, queue.length, -1))} disabled={at === 0}>Back</Button>
        <Button variant="secondary" onClick={() => setIndex(stepIndex(at, queue.length, 1))} disabled={at >= queue.length - 1}>Skip</Button>
        <Button variant="ghost" onClick={() => setHelp((h) => !h)} icon={<Keyboard className="size-4" />}>Keys</Button>
      </div>
      {help && (
        <Card className="p-4 text-sm">
          <p className="mb-2 font-semibold">Keyboard</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-mono font-bold">V</dt><dd>Verify and show the next</dd>
            <dt className="font-mono font-bold">R</dt><dd>Not received (asks for the reason)</dd>
            <dt className="font-mono font-bold">S or →</dt><dd>Skip to the next</dd>
            <dt className="font-mono font-bold">B or ←</dt><dd>Back to the previous</dd>
            <dt className="font-mono font-bold">O</dt><dd>Open the screenshot full size</dd>
            <dt className="font-mono font-bold">C</dt><dd>Copy the UTR</dd>
          </dl>
        </Card>
      )}
    </div>
  )
}
