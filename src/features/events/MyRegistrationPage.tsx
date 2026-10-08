import clsx from 'clsx'
import { CalendarPlus, Check, Copy, Pencil, Share2, Smartphone, Upload, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, KeyValue, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Field, Input } from '../../components/ui/Form'
import { QrCode } from '../../components/ui/QrCode'
import { FOOD_PREFS, MEET_SLUG } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { formatDateRange, formatDateTime } from '../../lib/format'
import { buildIcs, downloadFile } from '../../lib/ics'
import { compressImage } from '../../lib/image'
import { formatPaise } from '../../lib/money'
import type { EventRow, Payment } from '../../lib/types'
import { buildUpiLink, isValidUpiId, normalizeUtr } from '../../lib/upi'
import { useMyProfile } from '../auth/AuthProvider'
import { useCancelRegistration, useEvent, useMyRegistration, useSubmitPayment, type MyRegistration } from './queries'
import { PaymentBadge, StatusBadge } from './StatusBadge'

const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function MyRegistrationPage() {
  const { data: event, isLoading } = useEvent(MEET_SLUG)
  const { data: mine, isLoading: lm, error } = useMyRegistration(event?.id)

  if (isLoading || lm) return <PageSkeleton />
  if (!event) return <Navigate to="/meet" replace />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!mine || mine.registration.status === 'cancelled') return <Navigate to="/meet" replace />

  const reg = mine.registration
  return (
    <div>
      <PageHeader title="My registration" subtitle={event.title} back="/meet" action={<StatusBadge status={reg.status} />} />
      <Page className="space-y-6">
        <Timeline status={reg.status} hasPayment={mine.payments.some((p) => p.status !== 'rejected')} free={reg.amount_paise === 0} />
        {reg.status === 'confirmed' && <TicketCard event={event} mine={mine} />}
        {reg.status === 'pending_payment' && <PaymentPanel event={event} mine={mine} />}
        {reg.status === 'under_review' && <UnderReview mine={mine} />}
        <Details mine={mine} />
        <Actions event={event} mine={mine} />
      </Page>
    </div>
  )
}

function Timeline({ status, hasPayment, free }: { status: string; hasPayment: boolean; free: boolean }) {
  const steps = free
    ? [{ label: 'Registered', done: true }, { label: 'Confirmed', done: status === 'confirmed' }]
    : [
        { label: 'Registered', done: true },
        { label: 'Paid', done: hasPayment || status === 'confirmed' },
        { label: 'Verified', done: status === 'confirmed' },
      ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="flex items-start">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 && <span aria-hidden className={clsx('absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2', s.done ? 'bg-success' : 'bg-border')} />}
          <span
            className={clsx(
              'relative z-10 grid size-8 place-items-center rounded-full border-2 text-sm font-bold',
              s.done ? 'border-success bg-success text-white' : i === current ? 'border-primary bg-surface text-primary' : 'border-border bg-surface text-muted',
            )}
          >
            {s.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
          </span>
          <span className={clsx('mt-1.5 text-xs font-semibold', s.done ? 'text-success' : i === current ? 'text-primary' : 'text-muted')}>{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Couldn’t copy. Please select and copy it manually.'),
  )
}

function PaymentPanel({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const reg = mine.registration
  const { data: profile } = useMyProfile()
  const submit = useSubmitPayment(event.id)
  const [utr, setUtr] = useState('')
  const [payer, setPayer] = useState(profile?.full_name ?? '')
  const [proof, setProof] = useState<File | null>(null)
  const [utrError, setUtrError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(!isPhone)

  const paidOrPending = mine.payments.filter((p) => p.status !== 'rejected').reduce((s, p) => s + p.amount_paise, 0)
  const due = Math.max(0, reg.amount_paise - paidOrPending)
  const lastRejected = mine.payments.find((p) => p.status === 'rejected')
  const upiReady = !!event.upi_id && isValidUpiId(event.upi_id)
  const link = upiReady ? buildUpiLink({ upiId: event.upi_id!, payeeName: event.upi_payee_name ?? 'JEC Alumni', amountPaise: due, note: reg.code }) : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const clean = normalizeUtr(utr)
    if (!clean) return setUtrError('The UPI reference (UTR) is the 12-digit number shown in your payment app after paying.')
    setUtrError(null)
    let blob: Blob | null = null
    let ext = 'jpg'
    if (proof) {
      if (proof.type === 'application/pdf') {
        blob = proof
        ext = 'pdf'
      } else {
        const img = await compressImage(proof, 1600, 0.8).catch((err: Error) => {
          toast.error(err.message)
          return null
        })
        if (!img) return
        blob = img.blob
        ext = img.ext
      }
    }
    try {
      await submit.mutateAsync({ registrationId: reg.id, utr: clean, payerName: payer, proof: blob, proofExt: ext })
      toast.success('Payment details sent for verification')
    } catch {
      /* shown below */
    }
  }

  if (!upiReady) {
    return (
      <Notice tone="warning" title="Payment details coming soon">
        The organisers will publish the payment details shortly. You’ll be able to pay from this page. Your registration is saved.
      </Notice>
    )
  }

  return (
    <section className="space-y-4">
      {lastRejected && (
        <Notice tone="danger" title="We couldn’t verify your last payment">
          {lastRejected.review_note ?? 'Please check the UPI reference and submit again, or contact the organisers.'}
        </Notice>
      )}
      <Card className="overflow-hidden">
        <div className="bg-primary-soft p-4">
          <p className="text-sm font-semibold text-primary">Step 1 · Pay by UPI</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatPaise(due)}</p>
          <p className="text-sm text-muted">to {event.upi_payee_name}</p>
        </div>
        <div className="space-y-4 p-4">
          {isPhone && link && (
            <a
              href={link}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-on-primary hover:bg-primary-hover"
            >
              <Smartphone className="size-5" aria-hidden /> Pay {formatPaise(due)} with a UPI app
            </a>
          )}
          <dl className="divide-y divide-border rounded-xl border border-border px-3">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">UPI ID</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-[15px] font-semibold">{event.upi_id}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(event.upi_id!, 'UPI ID')} aria-label="Copy UPI ID">
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">Amount</dt>
              <dd className="flex items-center gap-1">
                <span className="font-semibold tabular-nums">{formatPaise(due)}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(String(due / 100), 'Amount')} aria-label="Copy amount">
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">Note / remark</dt>
              <dd className="flex items-center gap-1">
                <span className="font-mono font-semibold">{reg.code}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(reg.code, 'Code')} aria-label="Copy registration code">
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
          </dl>
          {link &&
            (showQr ? (
              <div className="flex flex-col items-center gap-2">
                <QrCode value={link} size={220} label={`UPI QR code to pay ${formatPaise(due)}`} />
                <p className="text-center text-sm text-muted">Scan with GPay, PhonePe, Paytm or any UPI app</p>
              </div>
            ) : (
              <button type="button" className="w-full text-center text-sm font-semibold text-primary" onClick={() => setShowQr(true)}>
                Paying from another phone? Show QR code
              </button>
            ))}
          {event.payment_note && <p className="text-sm text-muted">{event.payment_note}</p>}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-primary">Step 2 · Tell us you’ve paid</p>
        <form onSubmit={onSubmit} noValidate className="mt-3 space-y-4">
          <Field
            label="UPI reference number (UTR)"
            error={utrError}
            hint="12 digits. In GPay: open the payment, “UPI transaction ID”. In PhonePe: “UTR”. In Paytm: “UPI Ref No.”"
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 412345678901"
                className="font-mono tracking-wider"
                value={utr}
                maxLength={16}
                onChange={(e) => setUtr(e.target.value.replace(/[^\d ]/g, ''))}
              />
            )}
          </Field>
          <Field label="Paid from the account of" optional hint="If someone else paid for you, enter their name.">
            {(p) => <Input {...p} value={payer} maxLength={120} onChange={(e) => setPayer(e.target.value)} />}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">
              Payment screenshot <span className="font-normal text-muted">(optional, speeds up verification)</span>
            </p>
            {proof ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="truncate text-sm">{proof.name}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setProof(null)} aria-label="Remove screenshot">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[15px] font-semibold text-primary hover:bg-primary-soft">
                <Upload className="size-4" aria-hidden /> Add screenshot
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f && f.size > 15 * 1024 * 1024) return toast.error('That file is too large (max 15 MB).')
                    setProof(f ?? null)
                  }}
                />
              </label>
            )}
          </div>
          {submit.error && <Notice tone="danger" title={friendlyError(submit.error)} />}
          <Button type="submit" size="lg" block loading={submit.isPending}>
            Submit payment details
          </Button>
        </form>
      </Card>
    </section>
  )
}

function UnderReview({ mine }: { mine: MyRegistration }) {
  const pending = mine.payments.filter((p) => p.status === 'submitted')
  return (
    <section className="space-y-3">
      <Notice tone="info" title="Payment received. The treasurer is verifying it.">
        This usually takes less than 24 hours. Your ticket will appear here once verified; you don’t need to do anything else.
      </Notice>
      {pending.map((p) => (
        <PaymentRow key={p.id} p={p} />
      ))}
    </section>
  )
}

function PaymentRow({ p }: { p: Payment }) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-semibold tabular-nums">{formatPaise(p.amount_paise)}</p>
        <p className="truncate text-sm text-muted">
          {p.utr ? `UTR ${p.utr}` : p.method.replace('_', ' ')} · {formatDateTime(p.created_at)}
        </p>
      </div>
      <PaymentBadge status={p.status} />
    </Card>
  )
}

function TicketCard({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const reg = mine.registration
  return (
    <Card className="overflow-hidden">
      <div className="bg-[#0c1e45] px-5 py-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#F2A33A]">Entry pass</p>
        <p className="text-lg font-bold">{event.title}</p>
        <p className="text-sm text-[#C9D4EA]">{formatDateRange(event.starts_at, event.ends_at)}</p>
      </div>
      <div className="flex flex-col items-center gap-3 p-5">
        <QrCode value={reg.code} size={200} label={`Entry QR code ${reg.code}`} />
        <p className="font-mono text-2xl font-bold tracking-widest">{reg.code}</p>
        <p className="text-center">
          <span className="font-semibold">{reg.full_name}</span>
          <span className="text-muted"> · admits {reg.headcount}</span>
        </p>
        {reg.checked_in_at && <p className="text-sm font-semibold text-success">Checked in {formatDateTime(reg.checked_in_at)}</p>}
        <p className="text-center text-sm text-muted">Show this at the entrance. Tip: take a screenshot in case the network is weak.</p>
      </div>
    </Card>
  )
}

function Details({ mine }: { mine: MyRegistration }) {
  const reg = mine.registration
  return (
    <section>
      <SectionTitle>Details</SectionTitle>
      <Card className="px-4">
        <dl className="divide-y divide-border">
          <KeyValue label="Registration code">
            <span className="font-mono">{reg.code}</span>
          </KeyValue>
          {mine.items.map((i) => (
            <KeyValue key={i.ticket_type_id} label={`${i.label} × ${i.quantity}`}>
              {formatPaise(i.unit_price_paise * i.quantity)}
            </KeyValue>
          ))}
          {reg.guests.length > 0 && <KeyValue label="With you">{reg.guests.map((g) => g.name || g.relation).join(', ')}</KeyValue>}
          <KeyValue label="Food">{FOOD_PREFS.find((f) => f.value === reg.food_pref)?.label ?? '—'}</KeyValue>
          <KeyValue label="T-shirt">{reg.tshirt_size ?? '—'}</KeyValue>
          <KeyValue label="Accommodation help">{reg.needs_accommodation ? 'Requested' : 'No'}</KeyValue>
          <div className="flex items-center justify-between py-3">
            <dt className="font-semibold">Total</dt>
            <dd className="text-lg font-bold tabular-nums">{formatPaise(reg.amount_paise)}</dd>
          </div>
        </dl>
      </Card>
      {mine.payments.filter((p) => p.status === 'verified').map((p) => (
        <div key={p.id} className="mt-2">
          <PaymentRow p={p} />
        </div>
      ))}
    </section>
  )
}

function Actions({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const reg = mine.registration
  const cancel = useCancelRegistration(event.id)
  const shareText = `I’m attending ${event.title}${event.tagline ? ` (${event.tagline})` : ''}, ${formatDateRange(event.starts_at, event.ends_at)}. Register here: ${window.location.origin}/meet`

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <ButtonLink to="/meet/register" variant="secondary" icon={<Pencil className="size-4" />}>
        Edit preferences
      </ButtonLink>
      {event.starts_at && (
        <Button
          variant="secondary"
          icon={<CalendarPlus className="size-4" />}
          onClick={() =>
            downloadFile(
              'jec-alumni-meet.ics',
              buildIcs({ uid: reg.id, title: event.title, start: event.starts_at!, end: event.ends_at, location: event.venue, description: `Registration ${reg.code}`, url: `${window.location.origin}/meet/my` }),
              'text/calendar',
            )
          }
        >
          Add to calendar
        </Button>
      )}
      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1F9D57] px-5 text-[15px] font-semibold text-white hover:opacity-90"
      >
        <Share2 className="size-4" aria-hidden /> Invite batchmates on WhatsApp
      </a>
      {reg.status === 'pending_payment' && (
        <Button
          variant="ghost"
          className="text-danger hover:bg-danger-soft"
          loading={cancel.isPending}
          onClick={() => {
            if (window.confirm('Cancel your registration? You can register again later while registration is open.')) {
              cancel.mutate(reg.id, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success('Registration cancelled') })
            }
          }}
        >
          Cancel registration
        </Button>
      )}
    </section>
  )
}
