import clsx from 'clsx'
import { Check, Copy, FileSpreadsheet, ImageIcon, Phone, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice } from '../../components/ui/Display'
import { matchStatement, readStatementFile, type MatchResult } from '../../lib/bankStatement'
import { friendlyError } from '../../lib/errors'
import { relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import type { EventRow, Payment, Registration } from '../../lib/types'
import { proofUrl, useReviewPayment, type AdminData } from './queries'

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

  const regs = useMemo(() => new Map(data.registrations.map((r) => [r.id, r])), [data.registrations])
  const queue = data.payments.filter((p) => p.status === 'submitted')
  const matched = matches ? queue.filter((p) => matches.get(p.id)?.status === 'matched') : []

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

  async function approveMatched() {
    if (!window.confirm(`Verify ${matched.length} payments whose UTR and amount match the bank statement?`)) return
    setBulk({ done: 0, total: matched.length })
    let failed = 0
    for (const [i, p] of matched.entries()) {
      try {
        await review.mutateAsync({ paymentId: p.id, approve: true, note: `Matched bank statement ${statementName ?? ''}`.trim() })
      } catch {
        failed++
      }
      setBulk({ done: i + 1, total: matched.length })
    }
    setBulk(null)
    if (failed) toast.error(`${failed} could not be verified; please check them individually.`)
    else toast.success(`${matched.length} payments verified`)
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
                {bulk ? `Verifying ${bulk.done}/${bulk.total}` : `Verify ${matched.length} matched`}
              </Button>
            )}
          </div>
        )}
      </Card>

      {queue.length === 0 ? (
        <EmptyState icon={<Check />} title="All caught up">
          No payments are waiting for verification.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {queue.map((p) => (
            <PaymentCard key={p.id} p={p} reg={regs.get(p.registration_id)} match={matches?.get(p.id)} onApprove={() => review.mutate({ paymentId: p.id, approve: true }, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Verified') })} onReject={() => setRejecting(p)} busy={review.isPending} />
          ))}
        </ul>
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

function PaymentCard({ p, reg, match, onApprove, onReject, busy }: { p: Payment; reg?: Registration; match?: MatchResult; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const [opening, setOpening] = useState(false)
  const short = reg && p.amount_paise < reg.amount_paise
  return (
    <li>
      <Card className={clsx('p-4', match?.status === 'matched' && 'border-success')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{reg?.full_name ?? 'Unknown'}</p>
            <p className="text-sm text-muted">
              <span className="font-mono">{reg?.code}</span> · {[reg?.branch, reg?.grad_year].filter(Boolean).join(' ')} · {reg?.headcount} people
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">{formatPaise(p.amount_paise)}</p>
            <p className="text-xs text-muted">{relativeTime(p.created_at)}</p>
          </div>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">UTR</dt>
            <dd className="flex items-center gap-1 font-mono font-semibold">
              {p.utr}
              <button type="button" aria-label="Copy UTR" className="grid size-8 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => navigator.clipboard?.writeText(p.utr ?? '').then(() => toast.success('UTR copied'))}>
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
                <a className="inline-flex items-center gap-1 font-semibold text-primary" href={`tel:${reg.phone.replace(/\s/g, '')}`}>
                  <Phone className="size-3.5" aria-hidden /> {reg.phone}
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

function RejectDialog({ p, onClose, onSubmit }: { p: Payment; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState(REJECT_REASONS[0]!)
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
        <h2 id="reject-title" className="text-lg font-bold">
          Payment not received?
        </h2>
        <p className="mt-1 text-sm text-muted">UTR {p.utr}. The member will see this message and can submit again.</p>
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
