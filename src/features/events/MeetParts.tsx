// Visual building blocks of the Alumni Meet page (Layer 3b). Pure presentation: data comes in through props.
import clsx from 'clsx'
import { ArrowRight, CalendarDays, Camera, ChevronDown, Clock, Crown, GraduationCap, History, Images, Landmark, MapPin, Navigation, Ticket, Trees, Users } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ButtonLink } from '../../components/ui/Button'
import { SectionHeader } from '../../components/ui/Card'
import { Countdown } from '../../components/ui/Countdown'
import { BentoCard, BentoGrid, BorderBeam, GlowOrbs, SpotlightCard, TextReveal } from '../../components/ui/Fx'
import { IconTile } from '../../components/ui/IconTile'
import { CampusArchArt } from '../../components/ui/Illustrations'
import { Tabs } from '../../components/ui/Tabs'
import { useT } from '../../i18n'
import { formatDateRange } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import type { EventRow, TicketType } from '../../lib/types'
import { glimpsePoster, useLiveGlimpses } from '../glimpses/api'
import { clock, groupByDay, type ProgrammeItem } from './programme'
import { PriceTag } from './PriceTag'

import './events.css'

/** Liquid glass, but dense enough to read over busy content (floating bars). */
const DENSE_GLASS = { backgroundColor: 'color-mix(in oklab, var(--surface) 86%, transparent)' } as const

const VenueMap = lazy(() => import('./VenueMap'))

/** "lat,lng" from a Google Maps style link (…/@23.17,79.98,15z or ?q=23.17,79.98), else null. */
export function coordsFromMapUrl(url: string | null | undefined): [number, number] | null {
  if (!url) return null
  const m = url.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) ?? url.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

export function directionsUrl(event: Pick<EventRow, 'venue' | 'venue_map_url'>): string | null {
  if (event.venue_map_url) return event.venue_map_url
  if (event.venue) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.venue)}`
  return null
}

/** The cinematic hero: glimpse poster (or a designed poster), aurora, glow orbs, serif title, glass countdown. */
export function MeetHero({ event, cta }: { event: EventRow; cta: ReactNode }) {
  const tx = useT()
  const { data: glimpses } = useLiveGlimpses()
  const poster = glimpses[0] ? glimpsePoster(glimpses[0]) : ''
  const [imgOk, setImgOk] = useState(true)
  const future = event.starts_at && new Date(event.starts_at).getTime() > Date.now()
  const ended = event.ends_at && new Date(event.ends_at).getTime() < Date.now()
  return (
    <section className="aurora relative isolate overflow-hidden text-white" data-testid="meet-hero">
      {poster && imgOk && (
        <img
          src={poster}
          alt=""
          aria-hidden
          onError={() => setImgOk(false)}
          className="absolute inset-0 -z-10 size-full scale-110 object-cover opacity-45 [animation:meet-kenburns_24s_ease-in-out_infinite_alternate] motion-reduce:animate-none"
        />
      )}
      {/* tint: keeps the type readable over any photo */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(4_26_20/0.55)_0%,rgb(6_42_32/0.35)_40%,rgb(4_20_15/0.92)_100%)]" />
      <GlowOrbs className="-z-10 opacity-70" />
      <div aria-hidden className="fx-dots-light absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_30%,#000,transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 text-white/[0.08] [&_svg]:h-auto [&_svg]:w-full">
        <CampusArchArt />
      </div>
      <div className="relative mx-auto max-w-3xl px-5 pb-9 pt-[calc(env(safe-area-inset-top)+2.25rem)] sm:pb-12 sm:pt-16">
        <p className="text-eyebrow text-accent">{tx('evx.heroEyebrow')}</p>
        <TextReveal text={event.title} as="h1" className="text-display-xl mt-3 max-w-[14ch] text-balance text-white drop-shadow-[0_2px_24px_rgb(0_0_0/0.35)]" />
        {event.tagline && <p className="text-body-lg mt-3 max-w-[34ch] text-hero-text">{event.tagline}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="fx-liquid-dark inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold">
            <CalendarDays className="size-4 text-accent" aria-hidden />
            {formatDateRange(event.starts_at, event.ends_at)}
          </span>
          {event.venue && (
            <span className="fx-liquid-dark inline-flex min-h-10 max-w-full items-center gap-2 rounded-full px-3.5 text-sm font-semibold">
              <MapPin className="size-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">{event.venue.split(',')[0]}</span>
            </span>
          )}
        </div>
        {future ? (
          <div className="mt-6 max-w-md">
            <p className="text-eyebrow mb-2 text-white/70">{tx('evx.countdownTitle')}</p>
            <div className="fx-liquid-dark rounded-[1.6rem] p-2">
              <Countdown to={event.starts_at!} variant="glass" />
            </div>
          </div>
        ) : !ended && event.starts_at ? (
          <p className="fx-liquid-dark mt-6 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold">
            <span className="pulse-ring size-2.5 rounded-full bg-emerald-300" aria-hidden /> {tx('evx.underway')}
          </p>
        ) : null}
        {cta && <div className="mt-7 hidden max-w-sm sm:block">{cta}</div>}
      </div>
    </section>
  )
}

/** Bento "why come": four honest reasons (family only when there are family tickets). */
export function WhyCome({ hasFamily, days }: { hasFamily: boolean; days: number }) {
  const tx = useT()
  return (
    <section aria-labelledby="why-title">
      <SectionHeader eyebrow={tx('evx.whyEyebrow')} title={<span id="why-title">{days > 1 ? tx('evx.whyTitle') : tx('evx.why1Title')}</span>} />
      <BentoGrid>
        <BentoCard cols={2} tone="hero" className="min-h-40">
          <div aria-hidden className="fx-dots-light absolute inset-0 opacity-30" />
          <IconTile icon={Users} tone="gold" variant="solid" size="lg" />
          <p className="text-h3 mt-4">{tx('evx.why1Title')}</p>
          <p className="text-body mt-1 text-hero-text">{tx('evx.why1Body')}</p>
        </BentoCard>
        <BentoCard className="min-h-40">
          <IconTile icon={Landmark} tone="emerald" size="md" />
          <p className="text-title mt-3">{tx('evx.why2Title')}</p>
          <p className="text-caption mt-1 text-muted">{tx('evx.why2Body')}</p>
        </BentoCard>
        {hasFamily ? (
          <BentoCard className="min-h-40">
            <IconTile icon={Trees} tone="teal" size="md" />
            <p className="text-title mt-3">{tx('evx.why3Title')}</p>
            <p className="text-caption mt-1 text-muted">{tx('evx.why3Body')}</p>
          </BentoCard>
        ) : (
          <BentoCard className="min-h-40">
            <IconTile icon={GraduationCap} tone="plum" size="md" />
            <p className="text-title mt-3">{tx('meet.batches')}</p>
          </BentoCard>
        )}
        <BentoCard cols={2} tone="gold" className="min-h-32">
          <div className="flex items-start gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/35 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]" aria-hidden>
              <Camera className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-h3">{tx('evx.why4Title')}</p>
              <p className="text-body mt-1 text-[#4a2e08]">{tx('evx.why4Body')}</p>
            </div>
          </div>
        </BentoCard>
      </BentoGrid>
    </section>
  )
}

/** The programme as a vertical timeline. Day tabs jump to each day (every day stays on the page). */
export function ProgrammeTimeline({ items, event }: { items: ProgrammeItem[]; event: EventRow }) {
  const tx = useT()
  const days = useMemo(() => groupByDay(items), [items])
  const [active, setActive] = useState(days[0]?.day ?? '')
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const start = event.starts_at ? Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(event.starts_at))) : null
  const dayNo = (key: string) => (start !== null ? Math.round((Date.parse(key) - start) / 86_400_000) + 1 : null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || days.length < 2) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive((top.target as HTMLElement).dataset.day!)
      },
      { rootMargin: '-35% 0px -55% 0px' },
    )
    for (const d of days) if (refs.current[d.day]) io.observe(refs.current[d.day]!)
    return () => io.disconnect()
  }, [days])

  const label = (key: string, heading: string) => {
    const n = dayNo(key)
    return n !== null && n >= 1 && n <= 14 ? tx('evx.dayN', { n }) : heading.split(',')[0]!
  }

  return (
    <section id="programme" aria-label="Programme" className="scroll-mt-20">
      <SectionHeader eyebrow={tx('evx.programmeEyebrow')} title={tx('evx.programmeTitle')} />
      {days.length > 1 && (
        <div className="sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-10 mb-4 w-fit rounded-full" style={DENSE_GLASS}>
          <Tabs
            label={tx('evx.programmeTitle')}
            value={active}
            onChange={(v) => {
              setActive(v)
              refs.current[v]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            options={days.map((d) => ({ value: d.day, label: label(d.day, d.heading) }))}
            className="fx-liquid border-0"
          />
        </div>
      )}
      <div className="space-y-6">
        {days.map((d) => (
          <div key={d.day} data-day={d.day} ref={(el) => void (refs.current[d.day] = el)} className="scroll-mt-40">
            <h3 className="text-h3 mb-3 flex items-baseline gap-2">
              <span className="text-eyebrow text-gold-ink">{label(d.day, d.heading)}</span>
              <span className="text-caption font-semibold text-muted">{d.heading}</span>
            </h3>
            <ol className="relative space-y-3 pl-7 before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-0.5 before:rounded-full before:bg-[linear-gradient(var(--primary),var(--accent))] before:opacity-40">
              {d.items.map((it, i) => (
                <li key={it.id} className="relative">
                  <span
                    aria-hidden
                    className={clsx(
                      'absolute -left-7 top-4 grid size-5 place-items-center rounded-full border-2 border-bg',
                      i === 0 ? 'bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_25%,transparent)]' : 'bg-primary',
                    )}
                  />
                  <SpotlightCard className="fx-press rounded-3xl border border-border/80 bg-surface p-4 shadow-card">
                    <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-sm font-bold tabular-nums text-primary">
                      <Clock className="size-3.5" aria-hidden />
                      {clock(it.starts_at)}
                    </p>
                    <p className="text-title mt-2">{it.title}</p>
                    {(it.venue || it.ends_at) && (
                      <p className="text-caption mt-0.5 text-muted">{[it.venue, it.ends_at ? tx('evx.until', { time: clock(it.ends_at) }) : null].filter(Boolean).join(' · ')}</p>
                    )}
                    {it.details && <p className="text-body mt-1.5 whitespace-pre-line text-muted">{it.details}</p>}
                  </SpotlightCard>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Ticket tiers as premium cards. The full pass (all days) wears the beam; family tickets get the gold hairline. */
export function TierCards({ tickets, hrefFor }: { tickets: TicketType[]; hrefFor: (ticketId: string) => string }) {
  const tx = useT()
  // the full pass (every day) leads
  const primary = tickets.filter((t) => t.is_primary).sort((a, b) => Number(!!a.days) - Number(!!b.days))
  const family = tickets.filter((t) => !t.is_primary)
  const price = (p: number) => (p === 0 ? tx('evx.free') : formatPaise(p))
  const card = (t: TicketType) => {
    const full = t.is_primary && !t.days
    const body = (
      <SpotlightCard
        tone={full ? 'gold' : 'emerald'}
        className={clsx(
          'fx-hairline relative flex h-full flex-col rounded-[1.6rem] p-5',
          full ? 'bg-[radial-gradient(130%_100%_at_100%_0%,#0f7a57_0%,#084434_45%,#062a20_100%)] text-white shadow-pop' : 'border border-border/80 bg-surface shadow-card',
        )}
        data-testid="tier-card"
        data-full={full || undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <IconTile icon={full ? Crown : t.is_primary ? Ticket : Users} tone={full ? 'gold' : t.is_primary ? 'emerald' : 'gold'} variant={full ? 'solid' : 'soft'} size="md" />
          {full && <span className="rounded-full bg-[image:var(--grad-gold)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#2b1a05]">{tx('evx.fullPass')}</span>}
        </div>
        <p className={clsx('text-title mt-4', full && 'text-white')}>{t.label}</p>
        {t.description && <p className={clsx('text-caption mt-1', full ? 'text-hero-text' : 'text-muted')}>{t.description}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <PriceTag t={t} size="lg" tone={full ? 'dark' : 'light'} perPerson={tx('evx.perPerson')} />
          {t.is_primary && (
            <span className={clsx('inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold', full ? 'bg-white/15 text-white' : 'bg-primary-soft text-primary')}>
              {tx('evx.choose')} <ArrowRight className="size-4" aria-hidden />
            </span>
          )}
        </div>
      </SpotlightCard>
    )
    const wrapped = full ? <BorderBeam className="h-full rounded-[1.6rem]">{body}</BorderBeam> : body
    return t.is_primary ? (
      <Link key={t.id} to={hrefFor(t.id)} className="fx-press block rounded-[1.6rem]" aria-label={`${t.label} · ${price(t.price_paise)}${t.list_price_paise && t.list_price_paise > t.price_paise ? `, was ${price(t.list_price_paise)}` : ''}`}>
        {wrapped}
      </Link>
    ) : (
      <div key={t.id}>{wrapped}</div>
    )
  }
  return (
    <section aria-labelledby="tiers-title">
      <SectionHeader eyebrow={tx('evx.tiersEyebrow')} title={<span id="tiers-title">{tx('evx.tiersTitle')}</span>} />
      <div className="grid gap-3 sm:grid-cols-3">{primary.map(card)}</div>
      {family.length > 0 && (
        <>
          <h3 className="text-h3 mb-3 mt-6">{tx('evx.familyTitle')}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {family.map((t) => (
              <div key={t.id} className="fx-hairline flex items-center gap-3 rounded-3xl border border-accent/40 bg-accent-soft/50 p-4 shadow-card">
                <IconTile icon={Users} tone="gold" size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-title">{t.label}</p>
                  {t.description && <p className="text-caption text-muted">{t.description}</p>}
                </div>
                <PriceTag t={t} className="shrink-0 items-end" />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="text-caption mt-3 text-muted">{tx('meet.payNote')}</p>
    </section>
  )
}

/** Venue: a designed map poster (no third-party request until asked), an optional live map, and directions. */
export function VenueCard({ event }: { event: EventRow }) {
  const tx = useT()
  const coords = coordsFromMapUrl(event.venue_map_url)
  const [showMap, setShowMap] = useState(false)
  const dir = directionsUrl(event)
  if (!event.venue) return null
  return (
    <section aria-labelledby="venue-title">
      <SectionHeader eyebrow={tx('evx.venueTitle')} title={<span id="venue-title">{event.venue.split(',')[0]}</span>} />
      <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-surface shadow-card">
        <div className="relative h-48 overflow-hidden">
          {showMap && coords ? (
            <Suspense fallback={<div className="skeleton size-full" />}>
              <VenueMap lat={coords[0]} lng={coords[1]} label={tx('evx.mapLabel')} />
            </Suspense>
          ) : (
            <MapPoster />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-body min-w-0 flex-1 text-muted">{event.venue}</p>
          <div className="flex gap-2">
            {coords && !showMap && (
              <button type="button" onClick={() => setShowMap(true)} className="fx-press inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold">
                {tx('evx.showMap')}
              </button>
            )}
            {dir && (
              <a href={dir} target="_blank" rel="noreferrer" className="fx-press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary bg-(image:--grad-primary) px-4 text-sm font-semibold text-on-primary">
                <Navigation className="size-4" aria-hidden /> {tx('evx.directions')}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** A stylised map (streets, a river, the campus pin). Pure SVG, theme aware, decorative. */
function MapPoster() {
  return (
    <div aria-hidden className="relative size-full bg-[radial-gradient(120%_100%_at_30%_20%,var(--primary-soft),var(--surface-2))]">
      <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <path d="M-10 150 C 80 120, 140 190, 230 150 S 360 110, 420 140" stroke="var(--info)" strokeOpacity=".25" strokeWidth="14" fill="none" />
        {[30, 80, 130, 175].map((y) => <path key={y} d={`M0 ${y} L400 ${y - 18}`} stroke="var(--border-strong)" strokeOpacity=".7" strokeWidth={y === 80 ? 6 : 3} />)}
        {[60, 150, 250, 330].map((x) => <path key={x} d={`M${x} 0 L${x + 24} 200`} stroke="var(--border-strong)" strokeOpacity=".7" strokeWidth={x === 250 ? 6 : 3} />)}
        <rect x="170" y="70" width="80" height="54" rx="10" fill="var(--primary)" opacity=".12" />
        <circle cx="210" cy="96" r="34" fill="var(--primary)" opacity=".10" />
      </svg>
      <span className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-full">
        <span className="pulse-ring grid size-12 place-items-center rounded-full rounded-br-none bg-primary bg-(image:--grad-primary) text-on-primary shadow-pop [transform:rotate(45deg)]">
          <MapPin className="size-5 [transform:rotate(-45deg)]" />
        </span>
      </span>
    </div>
  )
}

export interface FaqItem {
  q: string
  a: string
}

/** Accordion FAQ built on <details> (keyboard and screen-reader friendly without script). */
export function Faq({ items }: { items: FaqItem[] }) {
  const tx = useT()
  return (
    <section aria-labelledby="faq-title">
      <SectionHeader eyebrow={tx('evx.faqEyebrow')} title={<span id="faq-title">{tx('evx.faqTitle')}</span>} />
      <div className="divide-y divide-border overflow-hidden rounded-[1.6rem] border border-border/80 bg-surface shadow-card">
        {items.map((f) => (
          <details key={f.q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-title [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none">
                <ChevronDown className="size-4" aria-hidden />
              </span>
            </summary>
            <p className="text-body px-5 pb-5 text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** Photos of this meet and the archive of earlier meets, as two image-led tiles. */
export function MemoriesTeaser() {
  const tx = useT()
  const { data: glimpses } = useLiveGlimpses()
  const posters = glimpses.slice(0, 2).map(glimpsePoster).filter(Boolean)
  const tile = (to: string, title: string, hint: string, icon: typeof Images, img: string | undefined, testId?: string) => (
    <Link to={to} data-testid={testId} className="fx-press fx-hairline group relative isolate flex min-h-40 flex-col justify-end overflow-hidden rounded-[1.6rem] p-4 text-white shadow-card">
      <span aria-hidden className="aurora absolute inset-0 -z-20" />
      {img && <img src={img} alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover opacity-75 mix-blend-luminosity transition-transform duration-700 group-hover:scale-105" />}
      <span aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_20%,rgb(4_20_15/0.85))]" />
      <IconTile icon={icon} variant="glass" size="sm" className="absolute left-4 top-4" />
      <span className="block text-title">{title}</span>
      <span className="text-caption block text-white/80">{hint}</span>
    </Link>
  )
  return (
    <section aria-labelledby="mem-title">
      <SectionHeader eyebrow={tx('evx.memoriesEyebrow')} title={<span id="mem-title">{tx('evx.memoriesTitle')}</span>} />
      <div className="grid grid-cols-2 gap-3">
        {tile('/meet/photos', tx('meet.photosButton'), tx('meet.photosHint'), Images, posters[1] ?? posters[0])}
        {tile('/meets', tx('meets.relive'), tx('meets.reliveHint'), History, posters[0], 'meet-past-link')}
      </div>
    </section>
  )
}

/** Floating liquid-glass bar above the bottom navigation on phones. */
export function StickyCta({ children, from }: { children: ReactNode; from: string | null }) {
  const tx = useT()
  return (
    <div className="pointer-events-none sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 px-3 pb-2 sm:hidden">
      <div className="fx-liquid pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-full p-1.5 pl-5" style={DENSE_GLASS}>
        {from && (
          <p className="min-w-0 shrink-0 leading-tight">
            <span className="text-caption block text-muted">{tx('evx.fromLabel')}</span>
            <span className="text-stat block text-lg">{from}</span>
          </p>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

export function PrimaryCta({ to, children, icon, gold }: { to: string; children: ReactNode; icon?: ReactNode; gold?: boolean }) {
  return (
    <ButtonLink to={to} size="lg" block variant={gold ? 'gold' : 'primary'} icon={icon} className="fx-shine">
      {children}
    </ButtonLink>
  )
}
