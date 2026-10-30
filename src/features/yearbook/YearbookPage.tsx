import { BookOpenText, Building2, ChevronLeft, ChevronRight, EyeOff, Globe2, MapPin, Quote, Share2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink, IconButton } from '../../components/ui/Button'
import { Badge, Chip, EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { BentoCard, BentoGrid, GlowOrbs } from '../../components/ui/Fx'
import { NumberTicker } from '../../components/ui/Motion'
import { useLang, useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { useSetShowcasePrefs } from '../idcard/api'
import { shareOrDownload } from '../share/canvasArt'
import { renderShareCard } from '../share/renderShareCard'
import { useBatchYearbook, yearbookImageUrl, yearbookMemories, yearbookQuote, type BatchYearbook, type YearbookMember } from './api'
import { Portrait } from './Portrait'

const FIRST_YEAR = 1950
const thisYear = () => new Date().getFullYear()

/** /yearbook: straight to my own batch. */
export function MyYearbookRedirect() {
  const { data: me, isLoading } = useMyProfile()
  if (isLoading) return <PageSkeleton />
  const y = me?.grad_year
  return <Navigate to={y ? `/yearbook/${y}` : `/yearbook/${thisYear() - 20}`} replace />
}

export function YearbookPage() {
  const tx = useT()
  const { year: yParam } = useParams()
  const [sp, setSp] = useSearchParams()
  const year = Number(yParam)
  const branch = sp.get('branch') || null
  const valid = Number.isInteger(year) && year >= 1947 && year <= thisYear() + 6
  const q = useBatchYearbook(valid ? year : null, branch)
  const d = q.data

  if (!valid) return <Navigate to="/yearbook" replace />
  return (
    <div>
      <PageHeader title={tx('wow.yb.title')} back="/" action={d ? <ShareYearbook d={d} /> : undefined} />
      <Page wide className="space-y-8">
        <Hero year={year} d={d} loading={q.isLoading} />
        <YearRail year={year} />
        {q.error ? (
          <Notice tone="warning" title={tx('wow.yb.cantOpen')}>
            {(q.error as { code?: string }).code === '42501' ? tx('wow.yb.verifiedOnly') : friendlyError(q.error)}
          </Notice>
        ) : q.isLoading || !d ? (
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-3xl" />
            <Skeleton className="h-64 rounded-3xl" />
          </div>
        ) : (
          <>
            {d.branches.length > 1 && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label={tx('wow.yb.branches')}>
                <Chip selected={!branch} onClick={() => setSp({}, { replace: true })}>
                  {tx('wow.yb.allBranches')}
                </Chip>
                {d.branches.map((b) => (
                  <Chip key={b.branch} selected={branch === b.branch} onClick={() => setSp({ branch: b.branch }, { replace: true })}>
                    {shortBranch(b.branch)}
                    <span className="text-caption opacity-70">{b.members}</span>
                  </Chip>
                ))}
              </div>
            )}
            <Motto d={d} />
            <Stats d={d} />
            <ClassPhotos d={d} />
            <Memories d={d} />
            <Members d={d} />
          </>
        )}
      </Page>
    </div>
  )
}

function Hero({ year, d, loading }: { year: number; d: BatchYearbook | undefined; loading: boolean }) {
  const tx = useT()
  const cover = yearbookImageUrl(d?.yearbook?.cover_path)
  const since = thisYear() - year
  return (
    <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-[32px]" aria-label={tx('wow.yb.classOf', { year })}>
      <div className={cn('relative min-h-[440px] sm:min-h-[480px]', !cover && 'aurora')}>
        {cover ? (
          <>
            <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(3_20_15/0.25)_0%,rgb(3_20_15/0.35)_40%,rgb(3_20_15/0.92)_100%)]" />
          </>
        ) : (
          <>
            <GlowOrbs />
            <div aria-hidden className="fx-grid fx-grid-light absolute inset-0" />
            <img src="/jec-logo.png" alt="" aria-hidden className="absolute -right-10 top-8 w-56 rotate-[8deg] opacity-[0.07] grayscale sm:right-10 sm:w-72" />
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 px-5 pb-7 pt-24 text-white sm:px-10 sm:pb-10">
          <p className="text-eyebrow text-accent">{tx('wow.yb.eyebrow')}</p>
          <p className="mt-3 font-display text-[28px] font-medium italic leading-none text-white/85 sm:text-[36px]">{tx('wow.yb.classOfWord')}</p>
          <h1 className="fx-gradient-text font-display text-[112px] font-semibold leading-[0.86] tracking-[-0.05em] sm:text-[168px]" data-testid="yb-year">
            {year}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {since > 0 && <span className="fx-liquid-dark rounded-full px-3 py-1.5 text-caption font-semibold">{tx('wow.yb.yearsSince', { count: since })}</span>}
            {d?.branch && <span className="fx-liquid-dark rounded-full px-3 py-1.5 text-caption font-semibold">{shortBranch(d.branch)}</span>}
            {d?.yearbook && !d.yearbook.is_published && <Badge tone="warning">{tx('wow.yb.draft')}</Badge>}
            {loading && <Skeleton className="h-8 w-28 rounded-full bg-white/10" />}
          </div>
        </div>
      </div>
    </section>
  )
}

function YearRail({ year }: { year: number }) {
  const tx = useT()
  const navigate = useNavigate()
  const rail = useRef<HTMLDivElement>(null)
  const years = Array.from({ length: thisYear() + 4 - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>(`[data-year="${year}"]`)
    if (el && rail.current) {
      const r = rail.current.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      rail.current.scrollLeft += e.left - r.left - r.width / 2 + e.width / 2
    }
  }, [year])
  const go = (y: number) => navigate(`/yearbook/${y}`)
  return (
    <nav aria-label={tx('wow.yb.otherYears')} className="flex items-center gap-2">
      <IconButton label={tx('wow.yb.prevYear')} variant="secondary" onClick={() => go(year - 1)} disabled={year <= FIRST_YEAR}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <div ref={rail} className="flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth py-1 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)] [scrollbar-width:none]">
        {years.map((y) => (
          <Link
            key={y}
            to={`/yearbook/${y}`}
            data-year={y}
            aria-current={y === year ? 'page' : undefined}
            className={cn(
              'grid min-h-11 min-w-14 shrink-0 snap-center place-items-center rounded-full px-3 font-display text-[17px] font-semibold tabular-nums transition-colors',
              y === year ? 'bg-primary text-on-primary shadow-[0_6px_14px_-8px_var(--primary-glow)]' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {y}
          </Link>
        ))}
      </div>
      <IconButton label={tx('wow.yb.nextYear')} variant="secondary" onClick={() => go(year + 1)} disabled={year >= thisYear() + 4}>
        <ChevronRight className="size-5" />
      </IconButton>
    </nav>
  )
}

function Motto({ d }: { d: BatchYearbook }) {
  const { lang } = useLang()
  const quote = d.yearbook ? yearbookQuote(d.yearbook, lang) : null
  if (!quote) return null
  return (
    <figure className="relative mx-auto max-w-3xl px-2 text-center">
      <Quote aria-hidden className="mx-auto size-10 rotate-180 fill-accent/30 text-gold-ink" strokeWidth={1.2} />
      <blockquote className="mt-3 font-display text-[26px] font-medium italic leading-[1.25] tracking-[-0.015em] sm:text-[34px]">{quote}</blockquote>
      <div aria-hidden className="mx-auto mt-5 h-px w-24 bg-(image:--grad-gold)" />
    </figure>
  )
}

function Stats({ d }: { d: BatchYearbook }) {
  const tx = useT()
  const s = d.stats
  return (
    <section aria-labelledby="yb-stats">
      <h2 id="yb-stats" className="sr-only">
        {tx('wow.yb.byNumbers')}
      </h2>
      <BentoGrid>
        <BentoCard cols={2} rows={2} tone="hero" className="flex flex-col justify-between p-5" data-testid="yb-members-stat">
          <Users className="size-6 text-accent" aria-hidden />
          <div>
            <p className="text-stat text-[72px] leading-none sm:text-[96px]">
              <NumberTicker value={s.members} />
            </p>
            <p className="mt-2 text-body-lg text-hero-text">{tx('wow.yb.onApp')}</p>
          </div>
        </BentoCard>
        <BentoCard className="flex flex-col justify-between gap-3">
          <MapPin className="size-5 text-primary" aria-hidden />
          <div>
            <p className="text-stat text-[40px]">
              <NumberTicker value={s.cities} />
            </p>
            <p className="text-caption font-semibold text-muted">{tx('wow.yb.cities')}</p>
          </div>
        </BentoCard>
        <BentoCard tone="gold" className="flex flex-col justify-between gap-3">
          <Globe2 className="size-5" aria-hidden />
          <div>
            <p className="text-stat text-[40px]">
              <NumberTicker value={s.countries} />
            </p>
            <p className="text-caption font-semibold opacity-80">{tx('wow.yb.countries')}</p>
          </div>
        </BentoCard>
        {s.top_companies.length > 0 && (
          <BentoCard cols={2} className="space-y-3">
            <p className="flex items-center gap-2 text-caption font-bold uppercase tracking-[0.12em] text-muted">
              <Building2 className="size-4" aria-hidden />
              {tx('wow.yb.topCompanies')}
            </p>
            <ul className="flex flex-wrap gap-2">
              {s.top_companies.map((c) => (
                <li key={c.name} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[14px] font-semibold">
                  {c.name} <span className="text-muted">· {c.members}</span>
                </li>
              ))}
            </ul>
          </BentoCard>
        )}
        {s.top_cities.length > 0 && (
          <BentoCard cols={2} className="space-y-3">
            <p className="flex items-center gap-2 text-caption font-bold uppercase tracking-[0.12em] text-muted">
              <MapPin className="size-4" aria-hidden />
              {tx('wow.yb.topCities')}
            </p>
            <ul className="flex flex-wrap gap-2">
              {s.top_cities.map((c) => (
                <li key={`${c.city}-${c.country}`} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[14px] font-semibold">
                  {c.city} <span className="text-muted">· {c.members}</span>
                </li>
              ))}
            </ul>
          </BentoCard>
        )}
      </BentoGrid>
    </section>
  )
}

function ClassPhotos({ d }: { d: BatchYearbook }) {
  const tx = useT()
  const photos = (d.yearbook?.class_photo_paths ?? []).map((p) => yearbookImageUrl(p)).filter((u): u is string => !!u)
  const strip = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  if (photos.length === 0) return null
  const scrollTo = (n: number) => {
    const el = strip.current?.children[n] as HTMLElement | undefined
    if (el && strip.current) strip.current.scrollTo({ left: el.offsetLeft - strip.current.offsetLeft, behavior: 'smooth' })
  }
  return (
    <section aria-labelledby="yb-photos" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow text-gold-ink">{tx('wow.yb.album')}</p>
          <h2 id="yb-photos" className="text-h1 mt-1">
            {tx('wow.yb.classPhotos')}
          </h2>
        </div>
        {photos.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="mr-2 text-caption font-semibold tabular-nums text-muted">
              {i + 1} / {photos.length}
            </span>
            <IconButton label={tx('wow.yb.prevPhoto')} variant="secondary" onClick={() => scrollTo(Math.max(0, i - 1))} disabled={i === 0}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <IconButton label={tx('wow.yb.nextPhoto')} variant="secondary" onClick={() => scrollTo(Math.min(photos.length - 1, i + 1))} disabled={i === photos.length - 1}>
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
        )}
      </div>
      <div
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget
          const w = (el.children[0] as HTMLElement | undefined)?.clientWidth ?? 1
          setI(Math.round(el.scrollLeft / (w + 12)))
        }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {photos.map((src, n) => (
          <figure key={src} className="fx-hairline relative aspect-[4/3] w-[86%] shrink-0 snap-center overflow-hidden rounded-[28px] bg-surface-2 shadow-pop sm:w-[70%]">
            <img src={src} alt={tx('wow.yb.photoAlt', { n: n + 1, year: d.grad_year })} loading="lazy" className="size-full object-cover" />
          </figure>
        ))}
      </div>
    </section>
  )
}

function Memories({ d }: { d: BatchYearbook }) {
  const tx = useT()
  const { lang } = useLang()
  const text = d.yearbook ? yearbookMemories(d.yearbook, lang) : null
  if (!text) return null
  return (
    <section aria-labelledby="yb-mem" className="mx-auto max-w-2xl">
      <p className="text-eyebrow text-gold-ink">{tx('wow.yb.remember')}</p>
      <h2 id="yb-mem" className="text-h1 mt-1">
        {tx('wow.yb.memories')}
      </h2>
      <div className="mt-4 space-y-4 whitespace-pre-line text-body-lg first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-display first-letter:text-[64px] first-letter:font-semibold first-letter:leading-[0.8] first-letter:text-gold-ink">
        {text}
      </div>
    </section>
  )
}

function MemberTile({ m }: { m: YearbookMember }) {
  const tx = useT()
  const sub = [m.current_company || m.current_title, m.city].filter(Boolean).join(' · ')
  const inner = (
    <>
      <Portrait src={m.avatar_url} name={m.full_name} className="aspect-[4/5] w-full rounded-[22px] shadow-card" />
      <p className="mt-2 text-[15px] font-semibold leading-tight">{m.full_name}</p>
      {sub && <p className="mt-0.5 line-clamp-2 text-caption text-muted">{sub}</p>}
      {m.is_me && <Badge tone="primary" className="mt-1">{tx('wow.yb.you')}</Badge>}
    </>
  )
  return m.is_me ? (
    <Link to="/me" className="fx-press block rounded-[22px]">
      {inner}
    </Link>
  ) : (
    <Link to={`/people/${m.id}`} className="fx-press fx-lift block rounded-[22px]" data-testid="yb-member">
      {inner}
    </Link>
  )
}

function Members({ d }: { d: BatchYearbook }) {
  const tx = useT()
  const setPrefs = useSetShowcasePrefs()
  const meHidden = d.members.find((m) => m.is_me && !m.listed)
  const shown = d.members.filter((m) => m.listed)
  return (
    <section aria-labelledby="yb-people" className="space-y-4">
      <div>
        <p className="text-eyebrow text-gold-ink">{tx('wow.yb.faces')}</p>
        <h2 id="yb-people" className="text-h1 mt-1">
          {tx('wow.yb.batchmates', { count: shown.length })}
        </h2>
      </div>
      {meHidden && (
        <div className="flex flex-col gap-3 rounded-[24px] border border-dashed border-border-strong bg-surface-2/60 p-4 sm:flex-row sm:items-center" data-testid="yb-self-hidden">
          <Portrait src={meHidden.avatar_url} name={meHidden.full_name} className="size-16 shrink-0 rounded-2xl opacity-60" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-title">
              <EyeOff className="size-4 text-muted" aria-hidden />
              {tx('wow.yb.onlyYou')}
            </p>
            <p className="text-caption text-muted">{tx('wow.yb.onlyYouBody')}</p>
          </div>
          <Button size="sm" variant="secondary" loading={setPrefs.isPending} onClick={() => setPrefs.mutate({ show_in_yearbook: true }, { onError: (e) => toast.error(friendlyError(e)) })}>
            {tx('wow.yb.showMe')}
          </Button>
        </div>
      )}
      {shown.length === 0 && !meHidden ? (
        <EmptyState icon={<BookOpenText />} title={tx('wow.yb.emptyTitle')} action={<ButtonLink to="/invite">{tx('wow.yb.invite')}</ButtonLink>}>
          {tx('wow.yb.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map((m) => (
            <li key={m.id}>
              <MemberTile m={m} />
            </li>
          ))}
        </ul>
      )}
      {d.hidden_count > 0 && <p className="text-center text-caption text-muted">{tx('wow.yb.hiddenOthers', { count: d.hidden_count })}</p>}
    </section>
  )
}

function ShareYearbook({ d }: { d: BatchYearbook }) {
  const tx = useT()
  const [busy, setBusy] = useState(false)
  async function share() {
    setBusy(true)
    try {
      const blob = await renderShareCard({
        eyebrow: tx('wow.share.ybEyebrow'),
        title: tx('wow.yb.classOf', { year: d.grad_year }),
        subtitle: tx('wow.share.ybSub', { members: d.stats.members, cities: d.stats.cities }),
        art: { type: 'yearbook', year: d.grad_year, cover: yearbookImageUrl(d.yearbook?.cover_path) },
        footer: `${window.location.host}/yearbook/${d.grad_year}`,
        college: tx('wow.card.college'),
        collegeSub: tx('wow.card.collegeSub'),
      })
      const r = await shareOrDownload(blob, `JEC-class-of-${d.grad_year}.png`, tx('wow.share.ybText', { year: d.grad_year }))
      if (r === 'downloaded') toast.success(tx('wow.share.saved'))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <IconButton label={tx('wow.yb.share')} variant="secondary" loading={busy} onClick={() => void share()}>
      <Share2 className="size-5" />
    </IconButton>
  )
}
