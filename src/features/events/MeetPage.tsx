import { CalendarDays, Clock, MapPin, Phone, Ticket, Users } from 'lucide-react'
import { Link } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { MEET_SLUG, yearRange } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { daysUntil, formatDateRange, formatDateTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { useAuth } from '../auth/AuthProvider'
import { registrationOpen, useEvent, useEventStats, useMyRegistration, useTicketTypes } from './queries'
import { StatusBadge } from './StatusBadge'

export function MeetPage() {
  const { session } = useAuth()
  const { data: event, isLoading, error } = useEvent(MEET_SLUG)
  const { data: tickets } = useTicketTypes(event?.id)
  const { data: stats } = useEventStats(event?.id)
  const { data: mine, isPending: regPending } = useMyRegistration(event?.id)

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title="Couldn’t load the event">{friendlyError(error)}</Notice></Page>
  if (!event) return <EmptyState title="The Alumni Meet page isn’t published yet" icon={<CalendarDays />}>Please check back soon.</EmptyState>

  const open = registrationOpen(event)
  const days = daysUntil(event.starts_at)
  const reg = mine?.registration
  const active = reg && reg.status !== 'cancelled'
  const countByYear = new Map((stats?.by_year ?? []).map((y) => [y.year, y.count]))
  const years = event.eligible_from_year && event.eligible_to_year ? yearRange(event.eligible_from_year, event.eligible_to_year).reverse() : []

  // while a signed-in member's registration is still loading, show a placeholder, never the wrong button
  const waiting = !!session && regPending
  const cta = waiting ? (
    <div className="skeleton h-14 w-full rounded-full" aria-busy="true" aria-label="Loading your registration" />
  ) : active ? (
    <ButtonLink to="/meet/my" size="lg" block icon={<Ticket className="size-5" />}>
      {reg.status === 'confirmed' ? 'View my ticket' : reg.status === 'pending_payment' ? 'Complete payment' : 'View my registration'}
    </ButtonLink>
  ) : open ? (
    <ButtonLink to={session ? '/meet/register' : '/signin?next=/meet/register'} size="lg" block>
      Register now
    </ButtonLink>
  ) : null

  return (
    <div>
      {/* hero */}
      <section className="relative overflow-hidden bg-hero px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)] text-white">
        <div aria-hidden className="absolute -right-24 -top-24 size-72 rounded-full bg-hero-2" />
        <div aria-hidden className="absolute -bottom-20 right-10 size-40 rounded-full bg-accent/15" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Jabalpur Engineering College</p>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.1] tracking-tight sm:text-4xl">{event.title}</h1>
          {event.tagline && <p className="mt-2 text-lg text-hero-text">{event.tagline}</p>}
          <ul className="mt-6 space-y-2.5 text-[15px] text-hero-text">
            <li className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <span>
                {formatDateRange(event.starts_at, event.ends_at)}
                {days !== null && days > 0 && <span className="text-hero-text"> · in {days} days</span>}
              </span>
            </li>
            {event.venue && (
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                {event.venue_map_url ? (
                  <a href={event.venue_map_url} target="_blank" rel="noreferrer" className="underline decoration-white/40 underline-offset-4">
                    {event.venue}
                  </a>
                ) : (
                  <span>{event.venue}</span>
                )}
              </li>
            )}
            {stats && stats.registered > 0 && (
              <li className="flex items-start gap-3">
                <Users className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                <span>
                  {stats.registered} alumni registered · {stats.people} people coming
                </span>
              </li>
            )}
          </ul>
          <div className="mt-7 hidden max-w-xs sm:block [&_a]:bg-white [&_a]:text-hero [&_a:hover]:bg-primary-soft">{cta}</div>
        </div>
      </section>

      <Page className="space-y-6">
        {active && (
          <Card className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm text-muted">Your registration</p>
              <p className="font-mono text-lg font-semibold tracking-wide">{reg.code}</p>
            </div>
            <StatusBadge status={reg.status} />
          </Card>
        )}

        {!open && !active && (
          <Notice tone="warning" title="Registration has closed">
            Please contact the organisers if you still wish to attend.
          </Notice>
        )}

        {years.length > 0 && (
          <section>
            <SectionTitle>Batches coming</SectionTitle>
            <div className="grid grid-cols-5 gap-2">
              {years.map((y) => (
                <div key={y} className="rounded-xl border border-border bg-surface px-1 py-2 text-center">
                  <p className="text-[15px] font-bold tabular-nums">{y}</p>
                  <p className="text-xs text-muted">{countByYear.get(y) ?? 0} in</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {tickets && tickets.length > 0 && (
          <section>
            <SectionTitle>Registration fees</SectionTitle>
            <Card className="divide-y divide-border">
              {tickets.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{t.label}</p>
                    {t.description && <p className="text-sm text-muted">{t.description}</p>}
                  </div>
                  <p className="shrink-0 text-lg font-bold tabular-nums">{formatPaise(t.price_paise)}</p>
                </div>
              ))}
            </Card>
            <p className="mt-2 text-sm text-muted">Pay by any UPI app after registering. Your seat is confirmed once the treasurer verifies the payment.</p>
          </section>
        )}

        {event.description && (
          <section>
            <SectionTitle>About the meet</SectionTitle>
            <Card className="whitespace-pre-line p-4 text-[15px] leading-relaxed">{event.description}</Card>
          </section>
        )}

        <section>
          <SectionTitle>Good to know</SectionTitle>
          <Card className="divide-y divide-border">
            {event.registration_closes_at && (
              <div className="flex items-center gap-3 p-4">
                <Clock className="size-5 text-primary" aria-hidden />
                <p className="text-[15px]">
                  Registration closes <strong>{formatDateTime(event.registration_closes_at)}</strong>
                </p>
              </div>
            )}
            {(event.contact_phone || event.contact_email) && (
              <div className="flex items-start gap-3 p-4">
                <Phone className="mt-0.5 size-5 text-primary" aria-hidden />
                <p className="text-[15px]">
                  Questions? {event.contact_phone && <a className="font-semibold text-primary" href={`tel:${event.contact_phone.replace(/\s/g, '')}`}>{event.contact_phone}</a>}
                  {event.contact_phone && event.contact_email && ' · '}
                  {event.contact_email && <a className="font-semibold text-primary" href={`mailto:${event.contact_email}`}>{event.contact_email}</a>}
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 p-4">
              <Badge tone="primary">Tip</Badge>
              <p className="text-[15px] text-muted">
                Add this app to your home screen for quick access to your ticket. <Link to="/install" className="font-semibold text-primary">How?</Link>
              </p>
            </div>
          </Card>
        </section>
      </Page>

      {cta && (
        <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-10 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:hidden">
          {cta}
        </div>
      )}
    </div>
  )
}
