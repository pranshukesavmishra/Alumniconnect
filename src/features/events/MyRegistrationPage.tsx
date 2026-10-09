import clsx from 'clsx'
import { CalendarPlus, Check, Copy, Images, Pencil, Smartphone, Upload, UserPlus, X } from 'lucide-react'
import { readCachedTicket, ticketKey, type CachedTicket } from './ticketCache'
import { useOnline } from '../../hooks/useOnline'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, KeyValue, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Field, Input } from '../../components/ui/Form'
import { WhatsAppIcon } from '../../components/ui/Icons'
import { QrCode } from '../../components/ui/QrCode'
import { MEET_SLUG } from '../../lib/constants'
import { useT } from '../../i18n'
import { tr } from '../../i18n/core'
import { foodLabel, modeLabel, performLabel, sponsorLabel, teamLabel, tshirtLabel } from '../../i18n/labels'
import { friendlyError } from '../../lib/errors'
import { formatDateRange, formatDateTime } from '../../lib/format'
import { buildIcs, downloadFile } from '../../lib/ics'
import { compressImage } from '../../lib/image'
import { formatPaise } from '../../lib/money'
import type { EventRow, Payment } from '../../lib/types'
import { buildUpiLink, isValidUpiId, normalizeUtr } from '../../lib/upi'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { useCancelRegistration, useEvent, useEventQuestions, useMyRegistration, useSubmitPayment, type MyRegistration } from './queries'
import { answerText, dayLabel, eventDayCount } from './reunion'
import { PaymentBadge, StatusBadge } from './StatusBadge'

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
const isPhone = isIos || /Android/i.test(ua)

/** iPhones have no system "upi://" chooser, so offer the popular apps' own links (same UPI parameters). */
const IOS_APPS = [
  { name: 'Google Pay', scheme: 'gpay://upi/pay' },
  { name: 'PhonePe', scheme: 'phonepe://pay' },
  { name: 'Paytm', scheme: 'paytmmp://pay' },
]



export function MyRegistrationPage() {
  const tx = useT()
  const { data: event, isLoading } = useEvent(MEET_SLUG)
  const { data: mine, isLoading: lm, isFetching, error } = useMyRegistration(event?.id)
  const uid = useUserId()
  const online = useOnline()
  const justRegistered = !!(useLocation().state as { justRegistered?: boolean } | null)?.justRegistered

  // Keep the entry pass on the phone so it can be shown at the gate without network.
  useEffect(() => {
    const r = mine?.registration
    if (!event || !r) return
    try {
      if (r.status === 'confirmed') {
        const t: CachedTicket = { code: r.code, name: r.full_name, headcount: r.headcount, title: event.title, when: formatDateRange(event.starts_at, event.ends_at) }
        localStorage.setItem(ticketKey(uid), JSON.stringify(t))
      } else localStorage.removeItem(ticketKey(uid))
    } catch {
      /* ignore */
    }
  }, [mine, event, uid])

  // no signal at the gate: show the pass saved on this phone straight away, never a loading screen
  if (!online) {
    const saved = readCachedTicket(uid)
    if (saved) return <Page><OfflineTicket t={saved} /></Page>
  }
  if ((isLoading || lm) && !error) return <PageSkeleton />
  if (error || (!event && !navigator.onLine)) {
    const cached = readCachedTicket(uid)
    return <Page>{cached ? <OfflineTicket t={cached} /> : <Notice tone="danger" title={friendlyError(error)} />}</Page>
  }
  if (!event) return <Navigate to="/meet" replace />
  // just registered / re-registered: wait for the fresh data instead of bouncing to /meet
  if ((!mine || mine.registration.status === 'cancelled') && isFetching) return <PageSkeleton />
  if (!mine || mine.registration.status === 'cancelled') return <Navigate to="/meet" replace />

  const reg = mine.registration
  return (
    <div>
      <PageHeader title={tx('my.title')} subtitle={event.title} back="/meet" action={<StatusBadge status={reg.status} />} />
      <Page className="space-y-6">
        {justRegistered && <WhatNext mine={mine} />}
        <Timeline status={reg.status} hasPayment={mine.payments.some((p) => p.status !== 'rejected')} free={reg.amount_paise === 0} />
        {reg.status === 'confirmed' && <TicketCard event={event} mine={mine} />}
        {reg.status === 'pending_payment' && <PaymentPanel event={event} mine={mine} />}
        {reg.status === 'under_review' && <UnderReview mine={mine} />}
        <Details mine={mine} event={event} />
        <Actions event={event} mine={mine} />
        <BringBatch />
      </Page>
    </div>
  )
}

function OfflineTicket({ t }: { t: CachedTicket }) {
  const tx = useT()
  return (
    <Card className="overflow-hidden">
      <div className="bg-hero px-5 py-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{tx('my.passOffline')}</p>
        <p className="text-lg font-bold">{t.title}</p>
        <p className="text-sm text-hero-text">{t.when}</p>
      </div>
      <div className="flex flex-col items-center gap-3 p-5">
        <QrCode value={t.code} size={200} label={tx('my.qrLabel', { code: t.code })} />
        <p className="font-mono text-2xl font-bold tracking-widest">{t.code}</p>
        <p className="text-center">
          <span className="font-semibold">{t.name}</span>
          <span className="text-muted"> · {tx('my.admits', { count: t.headcount })}</span>
        </p>
        <p className="text-center text-sm text-muted">{tx('my.offlineNote')}</p>
      </div>
    </Card>
  )
}

function Timeline({ status, hasPayment, free }: { status: string; hasPayment: boolean; free: boolean }) {
  const tx = useT()
  const steps = free
    ? [{ label: tx('my.tlRegistered'), done: true }, { label: tx('my.tlConfirmed'), done: status === 'confirmed' }]
    : [
        { label: tx('my.tlRegistered'), done: true },
        { label: tx('my.tlPaid'), done: hasPayment || status === 'confirmed' },
        { label: tx('my.tlVerified'), done: status === 'confirmed' },
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
    () => toast.success(tr('my.copied', { what })),
    () => toast.error(tr('my.copyFailed')),
  )
}

function PaymentPanel({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const tx = useT()
  const reg = mine.registration
  const { data: profile } = useMyProfile()
  const submit = useSubmitPayment(event.id)
  const [utr, setUtr] = useState('')
  const [payer, setPayer] = useState(profile?.full_name ?? '')
  const [proof, setProof] = useState<File | null>(null)
  const [utrError, setUtrError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(!isPhone)
  const [submitting, setSubmitting] = useState(false)

  const paidOrPending = mine.payments.filter((p) => p.status !== 'rejected').reduce((s, p) => s + p.amount_paise, 0)
  const due = Math.max(0, reg.amount_paise - paidOrPending)
  const lastRejected = mine.payments.find((p) => p.status === 'rejected')
  const upiReady = !!event.upi_id && isValidUpiId(event.upi_id)
  const link = upiReady ? buildUpiLink({ upiId: event.upi_id!, payeeName: event.upi_payee_name ?? 'JEC Alumni', amountPaise: due, note: reg.code }) : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    const clean = normalizeUtr(utr)
    if (!clean) return setUtrError(tx('my.utrError'))
    setUtrError(null)
    setSubmitting(true) // covers screenshot compression too, so a second tap can't submit twice
    let sent = false
    try {
      let blob: Blob | null = null
      let ext = 'jpg'
      if (proof) {
        if (proof.type === 'application/pdf') {
          blob = proof
          ext = 'pdf'
        } else {
          const img = await compressImage(proof, 1600, 0.8)
          blob = img.blob
          ext = img.ext
        }
      }
      sent = true
      await submit.mutateAsync({ registrationId: reg.id, utr: clean, payerName: payer, proof: blob, proofExt: ext })
      toast.success(tx('my.paymentSent'))
    } catch (err) {
      // server errors are shown under the form; this covers e.g. an unreadable screenshot
      if (!sent) toast.error(err instanceof Error ? err.message : friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!upiReady) {
    return (
      <Notice tone="warning" title={tx('my.soonTitle')}>
        {tx('my.soonBody')}
      </Notice>
    )
  }

  return (
    <section className="space-y-4">
      {lastRejected && (
        <Notice tone="danger" title={tx('my.rejectedTitle')}>
          {lastRejected.review_note ?? tx('my.rejectedBody')}
        </Notice>
      )}
      <Card className="overflow-hidden">
        <div className="bg-primary-soft p-4">
          <p className="text-sm font-semibold text-primary">{tx('my.step1')}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatPaise(due)}</p>
          <p className="text-sm text-muted">{tx('my.payTo', { name: event.upi_payee_name ?? '' })}</p>
          {reg.fund_paise > 0 && <p className="mt-1 text-sm text-muted">{tx('rr.payBreakdown', { tickets: formatPaise(reg.amount_paise - reg.fund_paise, { zeroAsFree: false }), fund: formatPaise(reg.fund_paise) })}</p>}
        </div>
        <div className="space-y-4 p-4">
          {isIos && link && (
            <div className="space-y-2">
              <p className="text-center text-sm font-semibold">{tx('my.payWith', { amount: formatPaise(due) })}</p>
              <div className="grid grid-cols-3 gap-2">
                {IOS_APPS.map((a) => (
                  <a key={a.name} href={link.replace('upi://pay', a.scheme)} className="flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-2 text-center text-sm font-semibold text-primary hover:bg-primary-soft">
                    {a.name}
                  </a>
                ))}
              </div>
              <p className="text-center text-xs text-muted">{tx('my.otherApp')}</p>
            </div>
          )}
          {isPhone && !isIos && link && (
            <a
              href={link}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-on-primary hover:bg-primary-hover"
            >
              <Smartphone className="size-5" aria-hidden /> {tx('my.payApp', { amount: formatPaise(due) })}
            </a>
          )}
          <dl className="divide-y divide-border rounded-xl border border-border px-3">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">{tx('my.upiId')}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-[15px] font-semibold">{event.upi_id}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(event.upi_id!, tx('my.upiId'))} aria-label={tx('my.copyUpi')}>
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">{tx('my.amount')}</dt>
              <dd className="flex items-center gap-1">
                <span className="font-semibold tabular-nums">{formatPaise(due)}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(String(due / 100), tx('my.amount'))} aria-label={tx('my.copyAmount')}>
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-sm text-muted">{tx('my.note')}</dt>
              <dd className="flex items-center gap-1">
                <span className="font-mono font-semibold">{reg.code}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-primary hover:bg-primary-soft" onClick={() => copy(reg.code, tx('my.code'))} aria-label={tx('my.copyCode')}>
                  <Copy className="size-4" />
                </button>
              </dd>
            </div>
          </dl>
          {link &&
            (showQr ? (
              <div className="flex flex-col items-center gap-2">
                <QrCode value={link} size={220} label={tx('my.upiQr', { amount: formatPaise(due) })} />
                <p className="text-center text-sm text-muted">{tx('my.scan')}</p>
              </div>
            ) : (
              <button type="button" className="w-full text-center text-sm font-semibold text-primary" onClick={() => setShowQr(true)}>
                {tx('my.showQr')}
              </button>
            ))}
          {event.payment_note && <p className="text-sm text-muted">{event.payment_note}</p>}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-primary">{tx('my.step2')}</p>
        <form onSubmit={onSubmit} noValidate className="mt-3 space-y-4">
          <Field
            label={tx('my.utr')}
            error={utrError}
            hint={tx('my.utrHint')}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                placeholder={tx('my.utrPh')}
                className="font-mono tracking-wider"
                value={utr}
                maxLength={16}
                onChange={(e) => setUtr(e.target.value.replace(/[^\d ]/g, ''))}
              />
            )}
          </Field>
          <Field label={tx('my.payer')} optional hint={tx('my.payerHint')}>
            {(p) => <Input {...p} value={payer} maxLength={120} onChange={(e) => setPayer(e.target.value)} />}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">
              {tx('my.screenshot')} <span className="font-normal text-muted">{tx('my.screenshotHint')}</span>
            </p>
            {proof ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="truncate text-sm">{proof.name}</span>
                <button type="button" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setProof(null)} aria-label={tx('my.removeShot')}>
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[15px] font-semibold text-primary hover:bg-primary-soft">
                <Upload className="size-4" aria-hidden /> {tx('my.addShot')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f && f.size > 15 * 1024 * 1024) return toast.error(tx('my.tooLarge'))
                    setProof(f ?? null)
                  }}
                />
              </label>
            )}
          </div>
          {submit.error && <Notice tone="danger" title={friendlyError(submit.error)} />}
          <Button type="submit" size="lg" block loading={submitting}>
            {tx('my.submitPay')}
          </Button>
        </form>
      </Card>
    </section>
  )
}

function UnderReview({ mine }: { mine: MyRegistration }) {
  const tx = useT()
  const pending = mine.payments.filter((p) => p.status === 'submitted')
  return (
    <section className="space-y-3">
      <Notice tone="info" title={tx('my.reviewTitle')}>
        {tx('my.reviewBody')}
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
  const tx = useT()
  const reg = mine.registration
  return (
    <Card className="overflow-hidden">
      <div className="bg-hero px-5 py-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{tx('my.pass')}</p>
        <p className="text-lg font-bold">{event.title}</p>
        <p className="text-sm text-hero-text">{formatDateRange(event.starts_at, event.ends_at)}</p>
      </div>
      <div className="flex flex-col items-center gap-3 p-5">
        <QrCode value={reg.code} size={200} label={tx('my.qrLabel', { code: reg.code })} />
        <p className="font-mono text-2xl font-bold tracking-widest">{reg.code}</p>
        <p className="text-center">
          <span className="font-semibold">{reg.full_name}</span>
          <span className="text-muted"> · {tx('my.admits', { count: reg.headcount })}</span>
        </p>
        {reg.checked_in_at && <p className="text-sm font-semibold text-success">{tx('my.checkedIn', { when: formatDateTime(reg.checked_in_at) })}</p>}
        <p className="text-center text-sm text-muted">{tx('my.showAtGate')}</p>
      </div>
    </Card>
  )
}

function Details({ mine, event }: { mine: MyRegistration; event: EventRow }) {
  const tx = useT()
  const reg = mine.registration
  const { data: questions } = useEventQuestions(event.id)
  const nDays = eventDayCount(event)
  const yn = (v: boolean | null) => (v === null ? '—' : v ? tx('common.yes') : tx('common.no'))
  const reunion = event.ask_reunion_questions
  const ticketsTotal = reg.amount_paise - reg.fund_paise
  return (
    <section>
      <SectionTitle>{tx('my.details')}</SectionTitle>
      <Card className="px-4">
        <dl className="divide-y divide-border">
          <KeyValue label={tx('my.regCode')}>
            <span className="font-mono">{reg.code}</span>
          </KeyValue>
          {mine.items.map((i) => (
            <KeyValue key={i.ticket_type_id} label={`${i.label} × ${i.quantity}`}>
              {formatPaise(i.unit_price_paise * i.quantity)}
            </KeyValue>
          ))}
          {nDays > 1 && Object.keys(reg.day_heads ?? {}).length > 0 && (
            <KeyValue label={tx('rr.peoplePerDay')}>
              {Array.from({ length: nDays }, (_, i) => `${dayLabel(event, i + 1)}: ${reg.day_heads[String(i + 1)] ?? 0}`).join(' · ')}
            </KeyValue>
          )}
          {reg.guests.length > 0 && (
            <KeyValue label={tx('my.withYou')}>{reg.guests.map((g) => [g.name || g.relation, g.food ? `(${foodLabel(tx, g.food)})` : ''].filter(Boolean).join(' ')).join(', ')}</KeyValue>
          )}
          <KeyValue label={tx('reg.foodShort')}>{foodLabel(tx, reg.food_pref) || '—'}</KeyValue>
          <KeyValue label={tx('reg.tshirtShort')}>{tshirtLabel(tx, reg.tshirt_size) || '—'}</KeyValue>
          <KeyValue label={tx('reg.accomShort')}>{reg.needs_accommodation ? tx('my.requested') : tx('common.no')}</KeyValue>
          {reunion && <KeyValue label={tx('rr.travelShort')}>{reg.needs_local_travel ? tx('my.requested') : tx('common.no')}</KeyValue>}
          {reunion && (reg.org_team_interest ?? null) !== null && <KeyValue label={tx('rr.teamShort')}>{reg.org_team_interest ? reg.org_teams.map((v) => teamLabel(tx, v)).join(', ') : tx('common.no')}</KeyValue>}
          {reunion && reg.perform_interest && (
            <KeyValue label={tx('rr.performShort')}>{`${reg.perform_types.map((v) => performLabel(tx, v)).join(', ')} · ${tx('rr.minutes', { n: reg.perform_minutes ?? 0 })}`}</KeyValue>
          )}
          {reunion && reg.sponsor_interest && <KeyValue label={tx('rr.sponsorShort')}>{`${sponsorLabel(tx, reg.sponsor_level)} · ${reg.sponsor_org ?? ''}`}</KeyValue>}
          {reunion && reg.arrival_mode && <KeyValue label={tx('rr.arrivalTitle')}>{[reg.arrival_from, reg.arrival_date, modeLabel(tx, reg.arrival_mode)].filter(Boolean).join(' · ')}</KeyValue>}
          {(questions ?? [])
            .filter((q) => reg.custom_answers[q.id] !== undefined)
            .map((q) => (
              <KeyValue key={q.id} label={q.label}>
                {answerText(reg.custom_answers[q.id], tx('common.yes'), tx('common.no'))}
              </KeyValue>
            ))}
          {reg.feedback && <KeyValue label={tx('rr.feedbackShort')}>{reg.feedback}</KeyValue>}
          {reunion && (
            <KeyValue label={tx('rr.fundShort')}>{reg.fund_paise > 0 ? tx('rr.fundThanks') : yn(reg.fund_interest)}</KeyValue>
          )}
          {reg.fund_paise > 0 && (
            <>
              <KeyValue label={tx('rr.ticketsSubtotalShort')}>{formatPaise(ticketsTotal, { zeroAsFree: false })}</KeyValue>
              <KeyValue label={tx('rr.fundLine')}>{formatPaise(reg.fund_paise)}</KeyValue>
            </>
          )}
          <div className="flex items-center justify-between py-3">
            <dt className="font-semibold">{tx('my.totalLabel')}</dt>
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

/** Shown right after registering: the code and what happens next. */
function WhatNext({ mine }: { mine: MyRegistration }) {
  const tx = useT()
  const reg = mine.registration
  const free = reg.amount_paise === 0
  return (
    <Card className="overflow-hidden border-success/40">
      <div className="bg-success-soft p-4">
        <p className="flex items-center gap-2 font-bold text-success">
          <Check className="size-5" aria-hidden /> {tx('rr.doneTitle')}
        </p>
        <p className="mt-1 text-sm">
          {tx('rr.doneCode')} <span className="font-mono text-base font-bold tracking-wide">{reg.code}</span>
        </p>
      </div>
      <ol className="space-y-2 p-4 text-[15px]">
        <li>{free ? tx('rr.next1Free') : tx('rr.next1')}</li>
        {!free && <li>{tx('rr.next2')}</li>}
        <li>{tx('rr.next3')}</li>
      </ol>
    </Card>
  )
}

/** End of registration: bring the batch, and add throwback photos. */
function BringBatch() {
  const tx = useT()
  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label={tx('rr.bringTitle')}>
      <Card className="flex flex-col gap-2 p-4">
        <p className="flex items-center gap-2 font-semibold">
          <UserPlus className="size-4 text-primary" aria-hidden /> {tx('rr.bringTitle')}
        </p>
        <p className="text-sm text-muted">{tx('rr.bringBody')}</p>
        <ButtonLink to="/invite" variant="secondary" size="sm">
          {tx('rr.bringCta')}
        </ButtonLink>
      </Card>
      <Card className="flex flex-col gap-2 p-4">
        <p className="flex items-center gap-2 font-semibold">
          <Images className="size-4 text-primary" aria-hidden /> {tx('rr.throwbackTitle')}
        </p>
        <p className="text-sm text-muted">{tx('rr.throwbackBody')}</p>
        <ButtonLink to="/meet/photos" variant="secondary" size="sm">
          {tx('rr.throwbackCta')}
        </ButtonLink>
      </Card>
    </section>
  )
}

function Actions({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const tx = useT()
  const reg = mine.registration
  const cancel = useCancelRegistration(event.id)
  const shareText = tx('my.shareText', { title: event.title + (event.tagline ? ` (${event.tagline})` : ''), when: formatDateRange(event.starts_at, event.ends_at), url: `${window.location.origin}/meet` })

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <ButtonLink to="/meet/register" variant="secondary" icon={<Pencil className="size-4" />}>
        {reg.status === 'pending_payment' ? tx('my.editPrefs') : tx('rr.editAnswers')}
      </ButtonLink>
      {event.starts_at && (
        <Button
          variant="secondary"
          icon={<CalendarPlus className="size-4" />}
          onClick={() =>
            downloadFile(
              'jec-reunion.ics',
              buildIcs({ uid: reg.id, title: event.title, start: event.starts_at!, end: event.ends_at, location: event.venue, description: `Registration ${reg.code}`, url: `${window.location.origin}/meet/my` }),
              'text/calendar',
            )
          }
        >
          {tx('my.addCal')}
        </Button>
      )}
      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#128c4a] px-5 text-[15px] font-semibold text-white hover:opacity-90"
      >
        <WhatsAppIcon className="size-4" /> {tx('my.inviteWa')}
      </a>
      {reg.status === 'pending_payment' && (
        <Button
          variant="danger-ghost"
          loading={cancel.isPending}
          onClick={() => {
            if (window.confirm(tx('my.cancelConfirm'))) {
              cancel.mutate(reg.id, { onError: (e) => toast.error(friendlyError(e)), onSuccess: () => toast.success(tx('my.cancelled')) })
            }
          }}
        >
          {tx('my.cancel')}
        </Button>
      )}
    </section>
  )
}
