import { CalendarDays, Clock, Pin, Phone, Ticket } from 'lucide-react'
import { Link } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { Card, SectionHeader } from '../../components/ui/Card'
import { EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { NoEventsArt } from '../../components/ui/Illustrations'
import { Reveal } from '../../components/ui/Motion'
import { MEET_SLUG, yearRange } from '../../lib/constants'
import { useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, relativeTime } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { formatPhone, telHref } from '../../lib/phone'
import { useAuth } from '../auth/AuthProvider'
import { GlimpseCarousel } from '../glimpses/GlimpseCarousel'
import { SponsorStrip } from '../giving/SponsorWall'
import { Faq, MeetHero, MemoriesTeaser, PrimaryCta, ProgrammeTimeline, StickyCta, TierCards, VenueCard, WhyCome, type FaqItem } from './MeetParts'
import { useAnnouncements, useProgramme } from './programme'
import { registrationOpen, useEvent, useMyRegistration, useTicketTypes } from './queries'
import { eventDayCount } from './reunion'
import { StatusBadge } from './StatusBadge'
import { WaitlistCard } from './WaitlistCard'

export function MeetPage() {
  const tx = useT()
  const { session } = useAuth()
  const { data: event, isLoading, error } = useEvent(MEET_SLUG)
  const { data: tickets } = useTicketTypes(event?.id)
  const { data: mine, isPending: regPending } = useMyRegistration(event?.id)
  const programme = useProgramme(event?.id)
  const announcements = useAnnouncements(event?.id, !!session)

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={tx('meet.loadError')}>{friendlyError(error)}</Notice></Page>
  if (!event) return <Page><EmptyState illustration={<NoEventsArt />} title={tx('meet.notPublished')}>{tx('meet.checkBack')}</EmptyState></Page>

  const open = registrationOpen(event)
  const reg = mine?.registration
  const active = reg && reg.status !== 'cancelled'
  const years = event.eligible_from_year && event.eligible_to_year ? yearRange(event.eligible_from_year, event.eligible_to_year).reverse() : []
  const primaryPrices = (tickets ?? []).filter((t) => t.is_primary).map((t) => t.price_paise)
  const from = primaryPrices.length ? formatPaise(Math.min(...primaryPrices)) : null
  const registerTo = session ? '/meet/register' : '/signin?next=/meet/register'
  const hrefFor = (id: string) => (active ? '/meet/register' : session ? `/meet/register?ticket=${id}` : `/signin?next=${encodeURIComponent(`/meet/register?ticket=${id}`)}`)
  const hasFamily = (tickets ?? []).some((t) => !t.is_primary)
  const nDays = eventDayCount(event, tickets ?? [])

  // while a signed-in member's registration is still loading, show a placeholder, never the wrong button
  const waiting = !!session && regPending
  const cta = waiting ? (
    <div className="skeleton h-14 w-full rounded-full" aria-busy="true" aria-label={tx('meet.loadingReg')} />
  ) : active ? (
    <PrimaryCta to="/meet/my" icon={<Ticket className="size-5" />} gold={reg.status === 'confirmed'}>
      {reg.status === 'confirmed' ? tx('meet.viewTicket') : reg.status === 'pending_payment' ? tx('meet.completePayment') : tx('meet.viewReg')}
    </PrimaryCta>
  ) : open ? (
    <PrimaryCta to={registerTo} gold>
      {tx('meet.registerNow')}
    </PrimaryCta>
  ) : null

  const faq: FaqItem[] = [
    { q: tx('evx.faqPayQ'), a: tx('evx.faqPayA') },
    ...(hasFamily ? [{ q: tx('evx.faqFamilyQ'), a: tx('evx.faqFamilyA') }] : []),
    ...(event.ask_reunion_questions ? [{ q: tx('evx.faqStayQ'), a: tx('evx.faqStayA') }] : []),
    { q: tx('evx.faqEditQ'), a: tx('evx.faqEditA') },
    { q: tx('evx.faqGateQ'), a: tx('evx.faqGateA') },
    ...(event.eligible_from_year && event.eligible_to_year ? [{ q: tx('evx.faqWhoQ'), a: tx('evx.faqWhoA', { from: event.eligible_from_year, to: event.eligible_to_year }) }] : []),
  ]

  return (
    <div className="bg-bg">
      <MeetHero event={event} cta={cta} />

      <Page className="space-y-10 pt-5">
        {active && (
          <Link to="/meet/my" className="fx-press fx-hairline -mt-12 relative z-10 flex items-center justify-between gap-3 rounded-[1.6rem] bg-surface p-4 shadow-pop" data-testid="meet-my-reg">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[image:var(--grad-gold)] text-[#2b1a05]" aria-hidden>
                <Ticket className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-caption text-muted">{tx('meet.yourReg')}</p>
                <p className="font-mono text-lg font-semibold tracking-wider">{reg.code}</p>
              </div>
            </div>
            <StatusBadge status={reg.status} />
          </Link>
        )}

        <GlimpseCarousel />

        {!active && open && !waiting && !!session && <WaitlistCard eventId={event.id} />}

        {!!announcements.data?.length && (
          <section aria-label="Announcements" className="space-y-3">
            <SectionHeader eyebrow={tx('evx.annEyebrow')} title="Announcements" />
            {announcements.data.slice(0, 3).map((a) => (
              <Card key={a.id} variant={a.pinned ? 'gradient-border' : 'default'} className="p-4">
                <p className="text-title">{a.pinned && <Pin className="mr-1.5 inline size-4 text-gold-ink" aria-label="Pinned" />}{a.title}</p>
                <p className="text-body mt-1 whitespace-pre-line text-muted">{a.body}</p>
                <p className="text-caption mt-2 text-subtle">{relativeTime(a.created_at)}</p>
              </Card>
            ))}
          </section>
        )}

        <Reveal>
          <WhyCome hasFamily={hasFamily} days={nDays} />
        </Reveal>

        {!!programme.data?.length && <ProgrammeTimeline items={programme.data} event={event} />}

        {!open && !active && (
          <Notice tone="warning" title={tx('meet.closed')}>
            {tx('meet.closedBody')}
          </Notice>
        )}

        {tickets && tickets.length > 0 && (
          <Reveal>
            <TierCards tickets={tickets} hrefFor={hrefFor} />
          </Reveal>
        )}

        {years.length > 0 && (
          <section aria-labelledby="batches-title">
            <SectionHeader title={<span id="batches-title">{tx('meet.batches')}</span>} />
            <div className="grid grid-cols-5 gap-2">
              {years.map((y) => (
                <div key={y} className="fx-hairline rounded-2xl bg-surface px-1 py-3 text-center shadow-e1">
                  <p className="text-stat text-[17px]">{y}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <Reveal>
          <VenueCard event={event} />
        </Reveal>

        {event.description && (
          <section aria-labelledby="about-title">
            <SectionHeader title={<span id="about-title">{tx('meet.about')}</span>} />
            <p className="text-body-lg whitespace-pre-line text-text/90">{event.description}</p>
          </section>
        )}

        <SponsorStrip event={event.id} />

        <Reveal>
          <MemoriesTeaser />
        </Reveal>

        <Faq items={faq} />

        <section aria-label={tx('meet.goodToKnow')} className="grid gap-3 sm:grid-cols-2">
          {event.registration_closes_at && (
            <Card variant="sunken" className="flex items-center gap-3 p-4">
              <Clock className="size-5 shrink-0 text-primary" aria-hidden />
              <p className="text-body">
                {tx('meet.closes')} <strong>{formatDateTime(event.registration_closes_at)}</strong>
              </p>
            </Card>
          )}
          {(event.contact_phone || event.contact_email) && (
            <Card variant="sunken" className="flex items-start gap-3 p-4">
              <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="text-body min-w-0 [overflow-wrap:anywhere]">
                {tx('meet.questions')} {event.contact_phone && <a className="font-semibold text-primary" href={telHref(event.contact_phone)}>{formatPhone(event.contact_phone)}</a>}
                {event.contact_phone && event.contact_email && ' · '}
                {event.contact_email && <a className="font-semibold text-primary" href={`mailto:${event.contact_email}`}>{event.contact_email}</a>}
              </p>
            </Card>
          )}
          <Card variant="sunken" className="flex items-center gap-3 p-4 sm:col-span-2">
            <CalendarDays className="size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-body text-muted">
              {tx('meet.addHome')} <Link to="/install" className="font-semibold text-primary">{tx('meet.how')}</Link>
            </p>
          </Card>
        </section>
        {cta && <div className="h-16 sm:hidden" aria-hidden />}
      </Page>

      {cta && <StickyCta from={active ? null : from}>{cta}</StickyCta>}
    </div>
  )
}
