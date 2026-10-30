import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BookImage,
  BriefcaseBusiness,
  CalendarHeart,
  GraduationCap,
  HeartHandshake,
  IdCard,
  MapPin,
  MessageCircle,
  PartyPopper,
  Search,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AvatarStack, Avatar } from '../../components/ui/Avatar'
import { Countdown } from '../../components/ui/Countdown'
import { Skeleton } from '../../components/ui/Display'
import { BentoCard, BorderBeam } from '../../components/ui/Fx'
import { IconTile, type TileTone } from '../../components/ui/IconTile'
import { Confetti } from '../../components/ui/Confetti'
import { NumberTicker, useInViewOnce } from '../../components/ui/Motion'
import { ProgressBar, ProgressRing } from '../../components/ui/Progress'
import { useLang, useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { MEET_SLUG } from '../../lib/constants'
import { formatDateRange } from '../../lib/format'
import { formatPaise } from '../../lib/money'
import { haptic } from '../../lib/haptics'
import { badgeTitle, sortForDisplay, type ShownBadge } from '../badges/catalog'
import { useEvent, useMyRegistration } from '../events/queries'
import { StatusBadge } from '../events/StatusBadge'
import { fameImageUrl, fameTitle, useWallOfFame } from '../fame/api'
import { useFeatured } from '../giving/api'
import { percentOf } from '../giving/helpers'
import { glimpsePoster, useLiveGlimpses } from '../glimpses/api'
import { anniversaryKind, type AnniversaryKind } from '../highlights/countdown'
import type { HomeHighlightsResult } from '../highlights/api'
import { useAlumniWorld } from '../world/api'
import { worldTotals } from '../world/geo'
import { toGlobePoints } from '../world/places'
import type { BatchmatesSummary } from '../yearbook/api'
import { badgeIcon } from './badgeIcons'
import { firstTimeToday, isMilestone } from './homeLogic'

const Globe = lazy(() => import('../world/Globe').then((m) => ({ default: m.Globe })))

// Routes owned by other screens (kept in one place so they are easy to adjust).
export const ROUTES = {
  idCard: '/id-card',
  badges: '/me/badges',
  yearbook: (year: number) => `/yearbook/${year}`,
  fame: '/fame',
  world: '/world',
}

function TileLink({ to, children, className, label }: { to: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <Link to={to} aria-label={label} className={cn('fx-press absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)}>
      {children}
    </Link>
  )
}

function TileHead({ eyebrow, icon, tone = 'emerald', onDark }: { eyebrow: string; icon?: LucideIcon; tone?: TileTone; onDark?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className={cn('text-eyebrow', onDark ? 'text-accent' : 'text-gold-ink')}>{eyebrow}</p>
      {icon && <IconTile icon={icon} tone={tone} size="sm" variant={onDark ? 'glass' : 'soft'} />}
    </div>
  )
}

// ---------------------------------------------------------------- Next up (one beam per screen)
export function NextUpTile({ h, loading }: { h: HomeHighlightsResult | undefined; loading: boolean }) {
  const tx = useT()
  const { data: event } = useEvent(MEET_SLUG)
  const { data: mine, isPending: regPending } = useMyRegistration(event?.id)
  const { data: glimpses } = useLiveGlimpses()
  const up = h?.upcoming_events[0]
  const reg = mine?.registration && mine.registration.status !== 'cancelled' ? mine.registration : null
  const offset = h?.clock_offset_ms ?? 0

  if (loading && !up) return <Skeleton className="col-span-2 h-[300px] rounded-[1.6rem] md:row-span-2 md:h-auto" />

  const cover = up?.cover_url ?? (glimpses[0] ? glimpsePoster(glimpses[0]) : null)
  const title = up?.title ?? event?.title
  if (!title) return null
  const startsAt = up?.starts_at ?? event?.starts_at ?? null
  const endsAt = up?.ends_at ?? event?.ends_at ?? null
  const status = up?.registration_status ?? reg?.status ?? null
  const future = startsAt ? Date.parse(startsAt) - offset > Date.now() : false
  const to = up ? (up.slug === MEET_SLUG ? '/meet/my' : '/meet') : reg ? '/meet/my' : '/meet'
  const action = status
    ? status === 'confirmed'
      ? tx('home.viewPass')
      : status === 'pending_payment'
        ? tx('home.completePay')
        : tx('home.seeReg')
    : tx('home.registerCta')

  return (
    <BorderBeam className="col-span-2 rounded-[1.6rem] md:row-span-2" data-testid="home-next-up">
      <section aria-label={tx('home.nextUp')} className="relative isolate flex h-full min-h-[300px] flex-col overflow-hidden rounded-[1.6rem] bg-[#062a20] p-5 text-white shadow-pop" data-theme="dark">
        {cover && <img src={cover} alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-55" loading="lazy" />}
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(4_26_20/0.35)_0%,rgb(4_26_20/0.55)_45%,rgb(4_22_17/0.96)_100%)]" />
        <div className="flex items-center justify-between gap-3">
          <span className="fx-liquid-dark inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-accent">
            <CalendarHeart className="size-4" aria-hidden /> {up ? tx('home.nextUp') : tx('home.alumniMeet')}
          </span>
          {status && <StatusBadge status={status} />}
        </div>
        <div className="mt-auto pt-16">
          <h2 className="font-display text-[26px] font-semibold leading-[1.1] md:text-[30px]">{title}</h2>
          <p className="mt-1.5 text-sm text-white/75">{formatDateRange(startsAt, endsAt)}</p>
          {up?.venue && (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-white/65">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {up.venue}
            </p>
          )}
          {!up && <p className="mt-1 text-sm text-white/70">{tx('home.registerBody')}</p>}
          {future && startsAt && <Countdown to={new Date(Date.parse(startsAt) - offset)} seconds={false} variant="glass" className="mt-4" />}
          <p className="mt-4 inline-flex min-h-6 items-center gap-1.5 font-semibold text-accent">
            {regPending && !up ? <span className="skeleton inline-block h-5 w-40 rounded-md bg-white/20" aria-busy="true" aria-label={tx('common.loading')} /> : action}
            {!(regPending && !up) && <ArrowRight className="size-4" aria-hidden />}
          </p>
        </div>
        <TileLink to={to} label={`${title}: ${action}`}>
          <span className="sr-only">{action}</span>
        </TileLink>
      </section>
    </BorderBeam>
  )
}

// ---------------------------------------------------------------- Your batch
export function BatchTile({ batch, loading, fallbackYear }: { batch: BatchmatesSummary | undefined; loading: boolean; fallbackYear: number | null }) {
  const tx = useT()
  if (loading) return <Skeleton className="col-span-2 h-[176px] rounded-[1.6rem]" />
  const year = batch?.grad_year ?? fallbackYear
  const newest = batch?.newest ?? []
  return (
    <BentoCard cols={2} className="flex min-h-[176px] flex-col" data-testid="home-batch">
      <TileHead eyebrow={tx('home.yourBatch')} icon={Users} />
      {year ? (
        <>
          <h2 className="mt-1 font-display text-[24px] font-semibold leading-tight">{tx('home.batchOf', { year })}</h2>
          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <div className="min-w-0">
              <p className="text-stat text-[34px] leading-none">
                <NumberTicker value={batch?.batchmates ?? 0} />
              </p>
              <p className="mt-1 text-[13px] text-muted">{tx('home.batchmates', { count: batch?.batchmates ?? 0 })}</p>
            </div>
            {newest.length > 0 && (
              <div className="flex flex-col items-end gap-1">
                <AvatarStack people={newest.map((p) => ({ name: p.full_name, src: p.avatar_url }))} max={4} size={34} />
                <p className="text-xs font-semibold text-primary">{tx('home.batchNew', { count: newest.length })}</p>
              </div>
            )}
          </div>
          <TileLink to={ROUTES.yearbook(year)} label={`${tx('home.batchOf', { year })}: ${tx('home.openYearbook')}`}>
            <span className="sr-only">{tx('home.openYearbook')}</span>
          </TileLink>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{tx('home.noBatch')}</p>
      )}
    </BentoCard>
  )
}

// ---------------------------------------------------------------- JEC World (mini globe)
export function WorldTile({ enabled }: { enabled: boolean }) {
  const tx = useT()
  const [ref, near] = useInViewOnce<HTMLDivElement>('200px')
  const { data } = useAlumniWorld(enabled)
  const places = useMemo(() => data ?? [], [data])
  const totals = worldTotals(places)
  const points = useMemo(() => toGlobePoints(places, (n, place) => tx('world.inPlace', { n, place })), [places, tx])
  return (
    <div ref={ref} className="col-span-2 md:row-span-2">
      <section
        aria-label={tx('home.worldTitle')}
        className="fx-hairline relative isolate flex h-full min-h-[260px] flex-col overflow-hidden rounded-[1.6rem] bg-[radial-gradient(90%_70%_at_70%_60%,#0b4a37_0%,#062a20_55%,#041a14_100%)] p-5 text-white shadow-pop"
        data-theme="dark"
        data-testid="home-world"
      >
        <div aria-hidden className="pointer-events-none absolute -bottom-[48%] -right-[26%] w-[84%] md:-bottom-[10%] md:-right-[12%] md:w-[95%]">
          {near && points.length > 0 && (
            <Suspense fallback={null}>
              <Globe points={points} labels={0} interactive={false} ariaLabel={tx('world.globeAria')} />
            </Suspense>
          )}
        </div>
        <TileHead eyebrow={tx('home.worldTitle')} onDark />
        <h2 className="relative z-10 mt-1 max-w-[16ch] font-display text-[24px] font-semibold leading-tight">{tx('landing.worldTitle')}</h2>
        {places.length > 0 && <p className="relative z-10 mt-1.5 max-w-[22ch] text-sm text-white/75">{tx('home.worldBody', { cities: totals.cities, countries: totals.countries })}</p>}
        <p className="relative z-10 mt-auto inline-flex items-center gap-1.5 pt-6 font-semibold text-accent">
          {tx('home.worldCta')} <ArrowUpRight className="size-4" aria-hidden />
        </p>
        <TileLink to={ROUTES.world} label={tx('home.worldCta')}>
          <span className="sr-only">{tx('home.worldCta')}</span>
        </TileLink>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Badges
export function BadgesTile({ badges, loading }: { badges: ShownBadge[]; loading: boolean }) {
  const tx = useT()
  const { lang } = useLang()
  if (loading) return <Skeleton className="col-span-2 h-[176px] rounded-[1.6rem]" />
  if (!badges.length) return null
  const sorted = sortForDisplay(badges)
  const earned = sorted.filter((b) => b.earned)
  const next = sorted.find((b) => !b.earned && b.attainable && b.ratio !== null)
  return (
    <BentoCard cols={2} className="flex min-h-[176px] flex-col" data-testid="home-badges">
      <TileHead eyebrow={tx('home.badges')} />
      <p className="mt-1 font-display text-[22px] font-semibold leading-tight">{tx('home.badgesEarned', { count: earned.length })}</p>
      <ul className="mt-3 flex gap-2" aria-label={tx('home.badges')}>
        {earned.slice(0, 5).map((b) => {
          const I = badgeIcon(b.icon)
          return (
            <li key={b.key} title={badgeTitle(b, lang)}>
              <span
                className={cn(
                  'grid size-11 place-items-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_14px_-8px_rgb(0_0_0/0.5)]',
                  b.tier === 'platinum'
                    ? 'bg-[linear-gradient(135deg,#a7dfc6,#1f916a_55%,#084434)]'
                    : b.tier === 'gold'
                      ? 'bg-(image:--grad-gold)'
                      : b.tier === 'silver'
                        ? 'bg-[linear-gradient(135deg,#dcd7c9,#8b8676)]'
                        : 'bg-[linear-gradient(135deg,#d99a62,#8a4b1e)]',
                )}
              >
                <I className="size-5" aria-hidden />
              </span>
              <span className="sr-only">{badgeTitle(b, lang)}</span>
            </li>
          )
        })}
      </ul>
      {next && (
        <div className="mt-auto pt-3">
          <p className="mb-1.5 text-[13px] font-medium text-muted">{tx('home.badgeNext', { title: badgeTitle(next, lang) })}</p>
          <ProgressBar value={Math.round((next.ratio ?? 0) * 100)} label={tx('home.badgeNext', { title: badgeTitle(next, lang) })} tone="gold" size="sm" />
        </div>
      )}
      <TileLink to={ROUTES.badges} label={tx('home.badgesAll')}>
        <span className="sr-only">{tx('home.badgesAll')}</span>
      </TileLink>
    </BentoCard>
  )
}

// ---------------------------------------------------------------- Give back (keeps data-testid="home-give-card")
export function GiveTile() {
  const tx = useT()
  const { data: c } = useFeatured()
  if (!c) return null
  const pct = Math.min(100, Math.round(percentOf(c.raised_paise, c.goal_paise)))
  return (
    <BentoCard cols={2} tone="gold" className="flex min-h-[176px] items-center gap-4" data-testid="home-give-card">
      <ProgressRing value={pct} size={88} stroke={8} tone="brand" label={tx('give.progress')} className="shrink-0">
        <span className="text-stat text-[20px] leading-none">{pct}%</span>
      </ProgressRing>
      <div className="min-w-0">
        <p className="text-eyebrow text-[#5f3918]">{tx('home.giveTitle')}</p>
        <h2 className="mt-1 line-clamp-2 font-display text-[20px] font-semibold leading-tight">{c.title}</h2>
        <p className="mt-1 text-sm font-medium text-[#4a2e0f]">
          {tx('home.giveRaised', { raised: formatPaise(c.raised_paise) })} · {tx('give.ofGoal', { goal: formatPaise(c.goal_paise, { zeroAsFree: false }) })}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-bold">
          {tx('give.giveNow')} <ArrowRight className="size-4" aria-hidden />
        </p>
      </div>
      <TileLink to={`/give/${c.slug}`} label={`${tx('home.giveTitle')}: ${c.title}`}>
        <span className="sr-only">{tx('give.giveNow')}</span>
      </TileLink>
    </BentoCard>
  )
}

// ---------------------------------------------------------------- Wall of Fame spotlight
export function FameTile({ enabled }: { enabled: boolean }) {
  const tx = useT()
  const { lang } = useLang()
  const { data } = useWallOfFame()
  if (!enabled || !data?.length) return null
  const e = data[0]!
  const img = fameImageUrl(e)
  return (
    <BentoCard cols={2} className="flex min-h-[176px] items-center gap-4" data-testid="home-fame">
      {img ? <img src={img} alt="" className="size-20 shrink-0 rounded-2xl object-cover shadow-e2" loading="lazy" /> : <Avatar name={e.name} size={80} ring="verified" />}
      <div className="min-w-0">
        <p className="text-eyebrow inline-flex items-center gap-1.5 text-gold-ink">
          <Trophy className="size-3.5" aria-hidden /> {tx('home.fame')}
        </p>
        <h2 className="mt-1 font-display text-[20px] font-semibold leading-tight">{e.name}</h2>
        <p className="mt-0.5 text-sm text-muted">{[e.branch, e.grad_year].filter(Boolean).join(' · ')}</p>
        <p className="mt-1.5 line-clamp-2 text-sm font-medium">{fameTitle(e, lang)}</p>
      </div>
      <TileLink to={ROUTES.fame} label={`${tx('home.fame')}: ${e.name}`}>
        <span className="sr-only">{tx('home.fameCta')}</span>
      </TileLink>
    </BentoCard>
  )
}

// ---------------------------------------------------------------- Quick actions (region "Quick actions"; Groups and Jobs links are tested)
const QUICK: { to: string | ((year: number | null) => string); label: MsgKey; icon: LucideIcon; tone: TileTone; verified?: boolean }[] = [
  { to: '/people', label: 'home.findJecians', icon: Search, tone: 'emerald', verified: true },
  { to: '/groups', label: 'nav.groups', icon: Users, tone: 'teal', verified: true },
  { to: '/nearby', label: 'nearby.title', icon: MapPin, tone: 'ink', verified: true },
  { to: '/jobs', label: 'profile.jobs', icon: BriefcaseBusiness, tone: 'plum', verified: true },
  { to: '/mentors', label: 'menu.mentorship', icon: GraduationCap, tone: 'emerald', verified: true },
  { to: '/give', label: 'home.qa.give', icon: HeartHandshake, tone: 'gold', verified: true },
  { to: ROUTES.idCard, label: 'home.qa.idcard', icon: IdCard, tone: 'maroon' },
  { to: (y) => (y ? ROUTES.yearbook(y) : '/people'), label: 'home.qa.yearbook', icon: BookImage, tone: 'gold', verified: true },
]

export function QuickActionsTile({ verified, year }: { verified: boolean; year: number | null }) {
  const tx = useT()
  const items = QUICK.filter((q) => verified || !q.verified)
  if (!items.length) return null
  return (
    <section aria-label={tx('menu.quick')} className="col-span-2 md:col-span-4">
      <ul className="grid grid-cols-4 gap-2 sm:gap-3 md:grid-cols-8">
        {items.map((q) => {
          const to = typeof q.to === 'function' ? q.to(year) : q.to
          return (
            <li key={q.label}>
              <Link
                to={to}
                className="fx-press fx-lift flex h-full min-h-[92px] flex-col items-center justify-start gap-2 rounded-[20px] border border-border/70 bg-surface px-1 pb-2.5 pt-3 text-center shadow-card"
              >
                <IconTile icon={q.icon} tone={q.tone} variant="solid" />
                <span className="text-[12.5px] font-semibold leading-tight">{tx(q.label)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- Waiting for you (requests, unread, nearby)
export function ActivityChips({ h }: { h: HomeHighlightsResult | undefined }) {
  const tx = useT()
  if (!h) return null
  const chips: { to: string; icon: LucideIcon; text: string; tone: string }[] = []
  if (h.pending_connection_requests > 0) chips.push({ to: '/me/connections', icon: UserPlus, text: tx('home.pendingRequests', { count: h.pending_connection_requests }), tone: 'text-gold-ink' })
  if (h.unread.chats > 0) chips.push({ to: '/chat', icon: MessageCircle, text: tx('home.unreadChats', { count: h.unread.chats }), tone: 'text-primary' })
  if (h.unread.notifications > 0) chips.push({ to: '/notifications', icon: BellRing, text: tx('home.unreadNotifs', { count: h.unread.notifications }), tone: 'text-primary' })
  if (h.nearby_in_my_city > 0) chips.push({ to: '/nearby', icon: MapPin, text: tx('home.nearbyN', { count: h.nearby_in_my_city }), tone: 'text-info' })
  if (!chips.length) return null
  return (
    <nav aria-label={tx('home.activity')} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max gap-2">
        {chips.map((c) => (
          <li key={c.to}>
            <Link to={c.to} className="fx-press fx-liquid inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold">
              <c.icon className={cn('size-4', c.tone)} aria-hidden /> {c.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------- Batch anniversary
const ANNIV_KEY: Record<Exclude<AnniversaryKind, 'none'>, MsgKey> = {
  first: 'home.anniv.first',
  silver: 'home.anniv.silver',
  pearl: 'home.anniv.pearl',
  ruby: 'home.anniv.ruby',
  golden: 'home.anniv.golden',
  milestone: 'home.anniv.milestone',
  plain: 'home.anniv.plain',
}

export function AnniversaryBanner({ h }: { h: HomeHighlightsResult | undefined }) {
  const tx = useT()
  const a = h?.batch_anniversary
  const kind = anniversaryKind(a?.years)
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    if (!a || !isMilestone(kind)) return
    let store: Storage | null = null
    try {
      store = window.localStorage
    } catch {
      store = null
    }
    if (firstTimeToday(`jec-anniv-${a.grad_year}-${a.years}`, store)) {
      const t = window.setTimeout(() => {
        setBurst(1)
        haptic()
      }, 600)
      return () => window.clearTimeout(t)
    }
  }, [a, kind])
  if (!a || kind === 'none') return null
  const golden = kind !== 'plain'
  return (
    <section
      aria-label={tx(ANNIV_KEY[kind], { years: a.years })}
      data-testid="home-anniversary"
      className={cn(
        'fx-hairline relative overflow-hidden rounded-[1.6rem] p-5 shadow-card',
        golden ? 'bg-[radial-gradient(120%_120%_at_100%_0%,#f4dc9e_0%,#e4ad45_45%,#b5741c_100%)] text-[#2b1a05]' : 'bg-surface',
      )}
    >
      {golden && <div aria-hidden className="fx-shine absolute inset-0" />}
      <div className="relative flex items-center gap-4">
        <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', golden ? 'bg-white/35 text-[#5f3918]' : 'bg-accent-soft text-gold-ink')}>
          <PartyPopper className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[20px] font-semibold leading-tight">{tx(ANNIV_KEY[kind], { years: a.years })}</p>
          <p className={cn('mt-1 text-sm', golden ? 'text-[#4a2e0f]' : 'text-muted')}>{tx('home.annivBody', { year: a.grad_year })}</p>
          <Link to={ROUTES.yearbook(a.grad_year)} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold">
            {tx('home.annivCta')} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
      <Confetti trigger={burst} />
    </section>
  )
}
