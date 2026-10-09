import { CalendarDays, Clock, MapPin, Phone, Pin, Ticket, Users } from 'lucide-react'
import { Link } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { MEET_SLUG, yearRange } from '../../lib/constants'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { daysUntil, formatDateRange, formatDateTime, relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { useAuth } from '../auth/AuthProvider'
import { clock, groupByDay, useAnnouncements, useProgramme } from './programme'
import { registrationOpen, useEvent, useEventStats, useMyRegistration, useTicketTypes } from './queries'
import { StatusBadge } from './StatusBadge'
import { WaitlistCard } from './WaitlistCard'

export function MeetPage() {
  const tx = useT()
  const { session } = useAuth()
  const { data: event, isLoading, error } = useEvent(MEET_SLUG)
  const { data: tickets } = useTicketTypes(event?.id)
  const { data: stats } = useEventStats(event?.id)
  const { data: mine, isPending: regPending } = useMyRegistration(event?.id)
  const programme = useProgramme(event?.id)
  const announcements = useAnnouncements(event?.id, !!session)

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={tx('meet.loadError')}>{friendlyError(error)}</Notice></Page>
  if (!event) return <EmptyState title={tx('meet.notPublished')} icon={<CalendarDays />}>{tx('meet.checkBack')}</EmptyState>

  const open = registrationOpen(event)
  const days = daysUntil(event.starts_at)
  const reg = mine?.registration
  const active = reg && reg.status !== 'cancelled'
  const countByYear = new Map((stats?.by_year ?? []).map((y) => [y.year, y.count]))
  const years = event.eligible_from_year && event.eligible_to_year ? yearRange(event.eligible_from_year, event.eligible_to_year).reverse() : []

  // while a signed-in member's registration is still loading, show a placeholder, never the wrong button
  const waiting = !!session && regPending
  const cta = waiting ? (
    <div className="skeleton h-14 w-full rounded-full" aria-busy="true" aria-label={tx('meet.loadingReg')} />
  ) : active ? (
    <ButtonLink to="/meet/my" size="lg" block icon={<Ticket className="size-5" />}>
      {reg.status === 'confirmed' ? tx('meet.viewTicket') : reg.status === 'pending_payment' ? tx('meet.completePayment') : tx('meet.viewReg')}
    </ButtonLink>
  ) : open ? (
    <ButtonLink to={session ? '/meet/register' : '/signin?next=/meet/register'} size="lg" block>
      {tx('meet.registerNow')}
    </ButtonLink>
  ) : null

  return (
    <div>
      {/* hero */}
      <section className="relative overflow-hidden bg-hero px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)] text-white">
        <div aria-hidden className="absolute -right-24 -top-24 size-72 rounded-full bg-hero-2" />
        <div aria-hidden className="absolute -bottom-20 right-10 size-40 rounded-full bg-accent/15" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">{tx('brand.college')}</p>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.1] tracking-tight sm:text-4xl">{event.title}</h1>
          {event.tagline && <p className="mt-2 text-lg text-hero-text">{event.tagline}</p>}
          <ul className="mt-6 space-y-2.5 text-[15px] text-hero-text">
            <li className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <span>
                {formatDateRange(event.starts_at, event.ends_at)}
                {days !== null && days > 0 && <span className="text-hero-text"> · {tx('meet.inDays', { count: days })}</span>}
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
                  {tx('meet.registered', { registered: stats.registered, people: stats.people })}
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
              <p className="text-sm text-muted">{tx('meet.yourReg')}</p>
              <p className="font-mono text-lg font-semibold tracking-wide">{reg.code}</p>
            </div>
            <StatusBadge status={reg.status} />
          </Card>
        )}

        {!active && open && !waiting && !!session && <WaitlistCard eventId={event.id} />}

        {!!announcements.data?.length && (
          <section aria-label="Announcements" className="space-y-2">
            <SectionTitle>Announcements</SectionTitle>
            {announcements.data.slice(0, 3).map((a) => (
              <Card key={a.id} className={a.pinned ? 'border-accent/50 bg-accent-soft p-4' : 'p-4'}>
                <p className="font-semibold">{a.pinned && <Pin className="mr-1 inline size-4 text-warning" aria-label="Pinned" />}{a.title}</p>
                <p className="mt-1 whitespace-pre-line text-[15px] text-muted">{a.body}</p>
                <p className="mt-2 text-xs text-muted">{relativeTime(a.created_at)}</p>
              </Card>
            ))}
          </section>
        )}

        {!!programme.data?.length && (
          <section aria-label="Programme" className="space-y-4">
            <SectionTitle>Programme</SectionTitle>
            {groupByDay(programme.data).map((d) => (
              <div key={d.day}>
                <h3 className="mb-1.5 text-sm font-bold">{d.heading}</h3>
                <Card className="divide-y divide-border">
                  {d.items.map((it) => (
                    <div key={it.id} className="flex gap-3 p-3.5">
                      <p className="w-20 shrink-0 text-sm font-semibold tabular-nums">{clock(it.starts_at)}</p>
                      <div className="min-w-0">
                        <p className="font-semibold">{it.title}</p>
                        {(it.venue || it.ends_at) && (
                          <p className="text-sm text-muted">{[it.venue, it.ends_at ? `until ${clock(it.ends_at)}` : null].filter(Boolean).join(' · ')}</p>
                        )}
                        {it.details && <p className="mt-1 whitespace-pre-line text-sm text-muted">{it.details}</p>}
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            ))}
          </section>
        )}

        {!open && !active && (
          <Notice tone="warning" title={tx('meet.closed')}>
            {tx('meet.closedBody')}
          </Notice>
        )}

        {years.length > 0 && (
          <section>
            <SectionTitle>{tx('meet.batches')}</SectionTitle>
            <div className="grid grid-cols-5 gap-2">
              {years.map((y) => (
                <div key={y} className="rounded-xl border border-border bg-surface px-1 py-2 text-center">
                  <p className="text-[15px] font-bold tabular-nums">{y}</p>
                  <p className="text-xs text-muted">{countByYear.get(y) ? tx('meet.batchIn', { n: countByYear.get(y)! }) : tx('meet.beFirst')}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {tickets && tickets.length > 0 && (
          <section>
            <SectionTitle>{tx('meet.fees')}</SectionTitle>
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
            <p className="mt-2 text-sm text-muted">{tx('meet.payNote')}</p>
          </section>
        )}

        {event.description && (
          <section>
            <SectionTitle>{tx('meet.about')}</SectionTitle>
            <Card className="whitespace-pre-line p-4 text-[15px] leading-relaxed">{event.description}</Card>
          </section>
        )}

        <section>
          <SectionTitle>{tx('meet.goodToKnow')}</SectionTitle>
          <Card className="divide-y divide-border">
            {event.registration_closes_at && (
              <div className="flex items-center gap-3 p-4">
                <Clock className="size-5 text-primary" aria-hidden />
                <p className="text-[15px]">
                  {tx('meet.closes')} <strong>{formatDateTime(event.registration_closes_at)}</strong>
                </p>
              </div>
            )}
            {(event.contact_phone || event.contact_email) && (
              <div className="flex items-start gap-3 p-4">
                <Phone className="mt-0.5 size-5 text-primary" aria-hidden />
                <p className="text-[15px]">
                  {tx('meet.questions')} {event.contact_phone && <a className="font-semibold text-primary" href={`tel:${event.contact_phone.replace(/\s/g, '')}`}>{event.contact_phone}</a>}
                  {event.contact_phone && event.contact_email && ' · '}
                  {event.contact_email && <a className="font-semibold text-primary" href={`mailto:${event.contact_email}`}>{event.contact_email}</a>}
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 p-4">
              <Badge tone="primary">{tx('meet.tip')}</Badge>
              <p className="text-[15px] text-muted">
                {tx('meet.addHome')} <Link to="/install" className="font-semibold text-primary">{tx('meet.how')}</Link>
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
