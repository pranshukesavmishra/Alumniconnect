import clsx from 'clsx'
import { CalendarPlus, Check, Copy, Images, Pencil, Smartphone, Upload, UserPlus, X } from 'lucide-react'
import { readCachedTicket, ticketKey, type CachedTicket } from './ticketCache'
import { useOnline } from '../../hooks/useOnline'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink, buttonClass } from '../../components/ui/Button'
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
import { useEvent, useEventQuestions, useMyRegistration, useSubmitPayment, type MyRegistration } from './queries'
import { answerText, dayLabel, eventDayCount } from './reunion'
import { EntryPass, PassTips, RegisteredCelebration, ShareCardButton } from './PassParts'
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
      <PageHeader title={tx('my.title')} subtitle={event.title} back="/meet" />
      <Page className="space-y-6">
        {justRegistered && <WhatNext mine={mine} event={event} />}
        <div className="flex justify-center"><StatusBadge status={reg.status} /></div>
        <Timeline status={reg.status} hasPayment={mine.payments.some((p) => p.status !== 'rejected')} free={reg.amount_paise === 0} />
        {reg.status === 'confirmed' && <TicketCard event={event} mine={mine} />}
        {reg.status === 'confirmed' && !justRegistered && <ShareRow event={event} mine={mine} />}
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
    <div className="space-y-3">
      <p className="text-caption flex items-center justify-center gap-2 font-semibold text-muted">{tx('my.passOffline')}</p>
      <EntryPass pass={{ title: t.title, when: t.when, code: t.code, name: t.name, headcount: t.headcount, status: 'offline' }} />
      <p className="text-center text-sm text-muted">{tx('my.offlineNote')}</p>
    </div>
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

  const digits = utr.replace(/\D/g, '').length
  const utrOk = !!normalizeUtr(utr)
  const copyRow = (label: string, value: ReactNode, onCopy: () => void, aria: string, mono?: boolean) => (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2/70 py-2 pl-4 pr-1.5">
      <div className="min-w-0">
        <dt className="text-caption text-muted">{label}</dt>
        <dd className={clsx('truncate text-[15px] font-semibold tabular-nums', mono && 'font-mono')}>{value}</dd>
      </div>
      <button type="button" className="fx-press grid size-11 shrink-0 place-items-center rounded-full bg-surface text-primary shadow-e1 hover:bg-primary-soft" onClick={onCopy} aria-label={aria}>
        <Copy className="size-4" />
      </button>
    </div>
  )

  return (
    <section className="space-y-4">
      {lastRejected && (
        <Notice tone="danger" title={tx('my.rejectedTitle')}>
          {lastRejected.review_note ?? tx('my.rejectedBody')}
        </Notice>
      )}
      <div className="fx-hairline overflow-hidden rounded-[1.75rem] bg-surface shadow-e3">
        <div className="aurora relative px-5 pb-6 pt-5 text-white">
          <p className="text-eyebrow text-accent">{tx('my.step1')}</p>
          <p className="text-caption mt-3 text-white/70">{tx('evx.amountDue')}</p>
          <p className="text-stat text-[2.75rem] leading-tight">{formatPaise(due)}</p>
          <p className="text-caption text-hero-text">{tx('my.payTo', { name: event.upi_payee_name ?? '' })}</p>
          {reg.fund_paise > 0 && <p className="text-caption mt-1 text-hero-text">{tx('rr.payBreakdown', { tickets: formatPaise(reg.amount_paise - reg.fund_paise, { zeroAsFree: false }), fund: formatPaise(reg.fund_paise) })}</p>}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {isIos && link && (
            <div className="space-y-2">
              <p className="text-center text-sm font-semibold">{tx('my.payWith', { amount: formatPaise(due) })}</p>
              <div className="grid grid-cols-3 gap-2">
                {IOS_APPS.map((a) => (
                  <a key={a.name} href={link.replace('upi://pay', a.scheme)} className="fx-press flex min-h-12 items-center justify-center rounded-2xl border border-border bg-surface px-2 text-center text-sm font-semibold text-primary shadow-e1 hover:bg-primary-soft">
                    {a.name}
                  </a>
                ))}
              </div>
              <p className="text-center text-xs text-muted">{tx('my.otherApp')}</p>
            </div>
          )}
          {isPhone && !isIos && link && (
            <a href={link} className={buttonClass('primary', 'lg', 'fx-shine w-full')}>
              <Smartphone className="size-5" aria-hidden /> {tx('my.payApp', { amount: formatPaise(due) })}
            </a>
          )}
          <dl className="grid gap-2">
            {copyRow(tx('my.upiId'), event.upi_id, () => copy(event.upi_id!, tx('my.upiId')), tx('my.copyUpi'), true)}
            {copyRow(tx('my.amount'), formatPaise(due), () => copy(String(due / 100), tx('my.amount')), tx('my.copyAmount'))}
            {copyRow(tx('my.note'), reg.code, () => copy(reg.code, tx('my.code')), tx('my.copyCode'), true)}
          </dl>
          {link &&
            (showQr ? (
              <div className="flex flex-col items-center gap-2 rounded-[1.5rem] bg-surface-2/60 p-4">
                <div className="rounded-[1.4rem] bg-white p-2.5 shadow-e2">
                  <QrCode value={link} size={220} label={tx('my.upiQr', { amount: formatPaise(due) })} />
                </div>
                <p className="text-center text-sm text-muted">{tx('my.scan')}</p>
              </div>
            ) : (
              <button type="button" className="min-h-11 w-full text-center text-sm font-semibold text-primary" onClick={() => setShowQr(true)}>
                {tx('my.showQr')}
              </button>
            ))}
          {event.payment_note && <p className="text-sm text-muted">{event.payment_note}</p>}
        </div>
      </div>

      <div className="fx-hairline rounded-[1.75rem] bg-surface p-4 shadow-card sm:p-5">
        <p className="text-eyebrow text-gold-ink">{tx('my.step2')}</p>
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <Field label={tx('my.utr')} error={utrError} success={!utrError && utrOk ? tx('evx.utrLooksGood') : null} hint={tx('my.utrHint')}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                placeholder={tx('my.utrPh')}
                className={clsx('font-mono text-lg tracking-[0.12em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal', utrOk && !utrError && 'border-success ring-2 ring-success/20')}
                value={utr}
                maxLength={16}
                onChange={(e) => {
                  setUtr(e.target.value.replace(/[^\d ]/g, ''))
                  if (utrError) setUtrError(null)
                }}
                trailing={
                  <span className={clsx('mr-2 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', utrOk ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')} aria-hidden>
                    {utrOk ? <Check className="size-4" /> : `${digits}/12`}
                  </span>
                }
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
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/60 p-3">
                <span className="truncate text-sm">{proof.name}</span>
                <button type="button" className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => setProof(null)} aria-label={tx('my.removeShot')}>
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <label className="fx-press flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface-2/40 text-[15px] font-semibold text-primary hover:border-primary/50 hover:bg-primary-soft">
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
          <Button type="submit" size="lg" block loading={submitting} haptic>
            {tx('my.submitPay')}
          </Button>
        </form>
      </div>
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
  const nDays = eventDayCount(event)
  const heads = reg.day_heads ?? {}
  const days =
    nDays > 1 && Object.keys(heads).length
      ? Array.from({ length: nDays }, (_, i) => i + 1)
          .filter((d) => (heads[String(d)] ?? 0) > 0)
          .map((d) => dayLabel(event, d))
          .join(' & ')
      : null
  return (
    <section className="space-y-3">
      <EntryPass
        pass={{
          title: event.title,
          when: formatDateRange(event.starts_at, event.ends_at),
          venue: event.venue,
          code: reg.code,
          name: reg.full_name,
          headcount: reg.headcount,
          days: days && days.split(' & ').length < nDays ? days : null,
          guests: reg.guests.map((g) => g.name || g.relation || '').filter(Boolean),
          status: 'confirmed',
        }}
        footer={reg.checked_in_at ? <p className="text-sm font-semibold text-emerald-200">{tx('my.checkedIn', { when: formatDateTime(reg.checked_in_at) })}</p> : null}
      />
      <p className="text-center text-sm text-muted">{tx('my.showAtGate')}</p>
      <PassTips />
    </section>
  )
}

function ShareRow({ event, mine }: { event: EventRow; mine: MyRegistration }) {
  const { data: profile } = useMyProfile()
  return <ShareCardButton variant="secondary" name={mine.registration.full_name} batch={profile?.grad_year ?? mine.registration.grad_year ?? null} url={`${window.location.origin}/meet`} eventTitle={event.title} />
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
            <KeyValue key={`${i.ticket_type_id}:${i.for_ticket_type_id ?? ''}`} label={`${i.label} × ${i.quantity}${i.names?.length ? ` (${i.names.join(', ')})` : ''}`}>
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

/** Shown right after registering: confetti, the code, what happens next and the share card. */
function WhatNext({ mine, event }: { mine: MyRegistration; event: EventRow }) {
  const tx = useT()
  const { data: profile } = useMyProfile()
  const reg = mine.registration
  const free = reg.amount_paise === 0
  const steps = [free ? tx('rr.next1Free') : tx('rr.next1'), ...(free ? [] : [tx('rr.next2')]), tx('rr.next3')]
  return (
    <RegisteredCelebration
      code={reg.code}
      steps={steps}
      share={<ShareCardButton name={reg.full_name} batch={profile?.grad_year ?? reg.grad_year ?? null} url={`${window.location.origin}/meet`} eventTitle={event.title} />}
    />
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
    </section>
  )
}
