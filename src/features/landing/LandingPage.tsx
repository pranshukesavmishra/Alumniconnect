import { ArrowRight, CalendarDays, Languages, MapPin, ShieldCheck } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ButtonLink } from '../../components/ui/Button'
import { Countdown } from '../../components/ui/Countdown'
import { GlowOrbs, Meteors, TextReveal } from '../../components/ui/Fx'
import { NumberTicker, useInViewOnce, useReducedMotion } from '../../components/ui/Motion'
import { useLang, useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { formatDateRange } from '../../lib/format'
import { glimpsePoster, useLiveGlimpses } from '../glimpses/api'
import { useGlimpseAutoplay } from '../glimpses/GlimpseCarousel'
import { mediaUrl } from '../photos/video'
import { landingNumber, usePublicLandingStats, type LandingStats } from './api'
import { FameTeaser, FeatureBento, Faq, FinalCta, GiveTeaser, LandingFooter, QuoteBand } from './LandingSections'

// Below the fold and heavy (WebGL): fetched only when the section comes near the screen.
const LandingWorld = lazy(() => import('./LandingWorld').then((m) => ({ default: m.LandingWorld })))

export const FOUNDED = 1947

/** The signed-out front door: cinematic hero, live numbers, the reunion countdown, the globe, what the app does. */
export function LandingPage() {
  const tx = useT()
  const stats = usePublicLandingStats()
  useEffect(() => {
    // arriving at /#world (e.g. a visitor sent here from /world): bring the globe section into view once it exists
    if (window.location.hash !== '#world') return
    const t = window.setTimeout(() => document.getElementById('world')?.scrollIntoView({ block: 'start' }), 350)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg text-text" data-testid="landing">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        {tx('landing.skip')}
      </a>
      <LandingNav />
      <main id="main">
        <Hero stats={stats.data} />
        <WorldSlot />
        <FeatureBento flagship={stats.data?.flagship ?? null} />
        <FameTeaser />
        <GiveTeaser />
        <QuoteBand />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}

function useScrolled(px = 24) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const on = () => setPast(window.scrollY > px)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [px])
  return past
}

/** One button that switches to the other language (its label is written in that language). */
export function LangToggle({ onDark }: { onDark?: boolean }) {
  const { lang, setLang } = useLang()
  const other = lang === 'hi' ? 'en' : 'hi'
  return (
    <button
      type="button"
      lang={other}
      onClick={() => setLang(other)}
      className={cn(
        'fx-press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
        onDark ? 'text-white/90 hover:bg-white/10' : 'text-text hover:bg-surface-2',
      )}
    >
      <Languages className="size-4" aria-hidden />
      {other === 'hi' ? 'हिन्दी' : 'English'}
    </button>
  )
}

function LandingNav() {
  const tx = useT()
  const scrolled = useScrolled()
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:px-5">
      <nav
        aria-label={tx('landing.nav')}
        className={cn(
          'mx-auto flex h-14 max-w-6xl items-center gap-1 rounded-full pl-2 pr-1.5 transition-[background-color,box-shadow,color] duration-300',
          scrolled ? 'fx-liquid text-text' : 'text-white',
        )}
      >
        <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 rounded-full pr-2" aria-label="JEC Alumni Connect">
          <img src="/jec-logo.png" alt="" className="size-9 shrink-0 object-contain drop-shadow" />
          <span className="truncate font-display text-[17px] font-semibold tracking-[-0.01em] max-[379px]:hidden">JEC Alumni Connect</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <a href="#world" className={cn('hidden min-h-11 items-center rounded-full px-3.5 text-sm font-semibold md:inline-flex', scrolled ? 'hover:bg-surface-2' : 'text-white/85 hover:bg-white/10')}>
            {tx('landing.navWorld')}
          </a>
          <Link to="/meet" className={cn('hidden min-h-11 items-center rounded-full px-3.5 text-sm font-semibold md:inline-flex', scrolled ? 'hover:bg-surface-2' : 'text-white/85 hover:bg-white/10')}>
            {tx('landing.navMeet')}
          </Link>
          <LangToggle onDark={!scrolled} />
          <ButtonLink to="/signin" size="sm" variant={scrolled ? 'primary' : 'glass'} className="px-4">
            {tx('landing.signIn')}
          </ButtonLink>
        </div>
      </nav>
    </header>
  )
}

/** The glimpse poster (instantly) and, when the connection allows, the glimpse itself playing silently behind the hero. */
function HeroMedia() {
  const { data: items } = useLiveGlimpses()
  const reduced = useReducedMotion()
  const autoplay = useGlimpseAutoplay()
  const g = items[0]
  const [mount, setMount] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!g || reduced || !autoplay) return
    // after the first paint has settled, so the video never competes with the page itself
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    let t = 0
    if (idle) idle(() => setMount(true), { timeout: 2500 })
    else t = window.setTimeout(() => setMount(true), 1200)
    return () => window.clearTimeout(t)
  }, [g, reduced, autoplay])
  if (!g) return null
  return (
    <div aria-hidden className="absolute inset-0">
      <img src={glimpsePoster(g)} alt="" fetchPriority="high" decoding="async" className="absolute inset-0 size-full scale-105 object-cover opacity-60" />
      {mount && !failed && (
        <video
          src={mediaUrl('glimpse', g.id)}
          poster={glimpsePoster(g)}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-1000', playing ? 'opacity-60' : 'opacity-0')}
          data-testid="landing-hero-video"
        />
      )}
    </div>
  )
}

function Hero({ stats }: { stats: LandingStats | undefined }) {
  const tx = useT()
  const flagship = stats?.flagship ?? null
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-[#041a14] text-white" data-theme="dark">
      <HeroMedia />
      {/* aurora light over the footage, darkest at the bottom where the text and numbers sit */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(60%_50%_at_15%_10%,rgb(31_145_106/0.55),transparent_70%),radial-gradient(45%_40%_at_90%_15%,rgb(228_173_69/0.30),transparent_70%),linear-gradient(180deg,rgb(4_26_20/0.55)_0%,rgb(4_26_20/0.45)_35%,rgb(4_22_17/0.94)_80%,#041a14_100%)]"
      />
      <div aria-hidden className="fx-grid fx-grid-light absolute inset-0 opacity-70" />
      <GlowOrbs className="opacity-60" />
      <Meteors count={9} />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-10 pt-[calc(env(safe-area-inset-top)+7rem)] sm:px-8 lg:min-h-[min(100svh,980px)] lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-14 lg:pb-16 lg:pt-32">
        <div>
          <div className="flex items-center gap-3">
            <span className="fx-liquid-dark grid size-16 shrink-0 place-items-center rounded-[22px] p-2">
              <img src="/jec-logo.png" alt={tx('landing.crestAlt')} className="size-full object-contain" width={48} height={48} />
            </span>
            <p className="text-eyebrow leading-snug text-accent">
              {tx('brand.college')}
              <span className="mt-1 block text-white/70">{tx('landing.est', { year: FOUNDED })}</span>
            </p>
          </div>
          <h1 id="hero-title" className="text-display-xl mt-7 max-w-[16ch] text-balance text-white">
            <TextReveal as="span" text={tx('landing.heroA')} /> <span className="fx-gradient-text">{tx('landing.heroB')}</span>
          </h1>
          <p className="text-body-lg mt-5 max-w-xl text-white/78">{tx('landing.heroBody', { year: FOUNDED })}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/signin" variant="gold" size="lg" className="fx-shine">
              {tx('landing.cta')} <ArrowRight className="size-5" aria-hidden />
            </ButtonLink>
            <ButtonLink to="/meet" variant="glass" size="lg">
              {tx('landing.ctaMeet')}
            </ButtonLink>
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-white/70">
            <ShieldCheck className="size-4 shrink-0 text-emerald-300" aria-hidden /> {tx('landing.trust')}
          </p>
        </div>

        <div className="space-y-3">
          {flagship?.starts_at && <MeetCard title={flagship.title} startsAt={flagship.starts_at} endsAt={flagship.ends_at} venue={flagship.venue} />}
          <StatChips stats={stats} />
        </div>
      </div>
    </section>
  )
}

function MeetCard({ title, startsAt, endsAt, venue }: { title: string; startsAt: string; endsAt: string | null; venue: string | null }) {
  const tx = useT()
  const past = Date.parse(startsAt) < Date.now()
  return (
    <div className="fx-liquid-dark rounded-[28px] p-5" data-testid="landing-countdown">
      <div className="flex items-center justify-between gap-3">
        <p className="text-eyebrow text-accent">{tx('landing.meetEyebrow')}</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_var(--emerald-300)]" /> {tx('landing.regOpen')}
        </span>
      </div>
      <p className="mt-2 font-display text-[22px] font-semibold leading-tight">{title}</p>
      <div className="mt-2 flex flex-col gap-1 text-sm text-white/75">
        <span className="inline-flex items-center gap-2">
          <CalendarDays className="size-4 shrink-0 text-accent" aria-hidden /> {formatDateRange(startsAt, endsAt)}
        </span>
        {venue && (
          <span className="inline-flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> {venue}
          </span>
        )}
      </div>
      {!past && <Countdown to={startsAt} variant="glass" className="mt-4" />}
      <Link to="/meet" className="mt-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent hover:underline">
        {tx('landing.meetMore')} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  )
}

function StatChips({ stats }: { stats: LandingStats | undefined }) {
  const tx = useT()
  const years = new Date().getFullYear() - FOUNDED
  const tiles = stats
    ? [
        { key: 'members', n: landingNumber(stats.verified_members), label: tx('landing.statMembers') },
        { key: 'batches', n: landingNumber(stats.batches), label: tx('landing.statBatches') },
        { key: 'cities', n: landingNumber(stats.cities), label: tx('landing.statCities') },
        { key: 'countries', n: landingNumber(stats.countries, 5), label: tx('landing.statCountries') },
        { key: 'companies', n: landingNumber(stats.companies), label: tx('landing.statCompanies') },
      ].filter((t) => t.n.show)
    : []
  const shown = [...tiles.slice(0, 3), { key: 'years', n: { show: true, value: years, plus: false }, label: tx('landing.statYears', { year: FOUNDED }) }]
  return (
    <ul className="grid grid-cols-2 gap-3" aria-label={tx('landing.statsLabel')} data-testid="landing-stats">
      {(stats ? shown : Array.from({ length: 4 }, (_, i) => ({ key: `s${i}`, n: null, label: '' }))).map((t) => (
        <li key={t.key} className="fx-liquid-dark min-w-0 rounded-[22px] px-4 py-3.5">
          {t.n ? (
            <>
              <p className="text-stat text-[30px] leading-none text-white">
                <NumberTicker value={t.n.value} />
                {t.n.plus && <span className="text-accent">+</span>}
              </p>
              <p className="mt-1.5 text-[13px] font-medium leading-snug text-white/70">{t.label}</p>
            </>
          ) : (
            <div aria-hidden className="space-y-2">
              <div className="h-7 w-20 animate-pulse rounded-lg bg-white/10" />
              <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Holds the globe section's place; loads it when it is about to scroll into view. */
function WorldSlot() {
  const [ref, near] = useInViewOnce<HTMLDivElement>('600px 0px 600px 0px')
  return (
    <div ref={ref} id="world" className="scroll-mt-20">
      {near ? (
        <Suspense fallback={<div className="h-[720px]" aria-hidden />}>
          <LandingWorld />
        </Suspense>
      ) : (
        <div className="h-[720px]" aria-hidden />
      )}
    </div>
  )
}
