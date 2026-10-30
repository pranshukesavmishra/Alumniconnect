import { ArrowRight, CalendarClock, HeartHandshake, Receipt, ScrollText, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { SectionHeader } from '../../components/ui/Card'
import { Badge, EmptyState, Notice, PageSkeleton } from '../../components/ui/Display'
import { Select } from '../../components/ui/Form'
import { BorderBeam, GlowOrbs, SpotlightCard, TextReveal } from '../../components/ui/Fx'
import { IconTile } from '../../components/ui/IconTile'
import { NoResultsArt } from '../../components/ui/Illustrations'
import { Stagger } from '../../components/ui/Motion'
import { Tabs } from '../../components/ui/Tabs'
import { useT } from '../../i18n'
import { formatPaise } from '../../lib/money'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useHub, type CampaignSummary } from './api'
import { CAMPAIGN_TYPES, daysLeft, percentOf } from './helpers'
import { Cover, GoalRing, Money, ProgressBar, StatusBadge, TickerMoney, TYPE_ICON, TYPE_KEY } from './parts'

function DaysLeft({ endsAt, light }: { endsAt: string | null; light?: boolean }) {
  const tx = useT()
  const d = daysLeft(endsAt)
  if (d === null) return null
  return (
    <span className={light ? 'inline-flex items-center gap-1 text-sm text-white/80' : 'inline-flex items-center gap-1 text-sm text-muted'}>
      <CalendarClock className="size-3.5" aria-hidden />
      {d === 0 ? tx('give.ended') : tx('give.daysLeft', { count: d })}
    </span>
  )
}

/** The featured appeal: photo or poster, a beam around the card, a big ring and counting figures. */
export function Hero({ c }: { c: CampaignSummary }) {
  const tx = useT()
  const pct = percentOf(c.raised_paise, c.goal_paise)
  const t = TYPE_ICON[c.type] ?? TYPE_ICON.project!
  return (
    <BorderBeam className="rounded-[1.75rem]" speed={7}>
      <Link to={`/give/${c.slug}`} data-testid="give-hero" className="fx-press block overflow-hidden rounded-[1.75rem] bg-[linear-gradient(160deg,#0b4a37,#062a20_55%,#041a14)] text-white shadow-pop">
        <div className="relative">
          <Cover c={c} className="h-44 sm:h-60" />
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,#062a20)]" />
          <span className="fx-liquid-dark absolute left-4 top-4 inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold uppercase tracking-wider">
            <HeartHandshake className="size-4 text-accent" aria-hidden /> {tx('give.featured')}
          </span>
        </div>
        <div className="relative -mt-10 space-y-4 p-5 pt-0">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 text-eyebrow text-accent">
                <t.icon className="size-3.5" aria-hidden /> {tx(TYPE_KEY[c.type] ?? 'give.type.project')}
              </span>
              <p className="text-h1 mt-1 text-white">{c.title}</p>
            </div>
            <GoalRing raised={c.raised_paise} goal={c.goal_paise} size={104} tone="light" label={tx('give.progress')}>
              <span className="text-stat text-2xl leading-none">
                {pct}
                <span className="text-sm">%</span>
              </span>
            </GoalRing>
          </div>
          {c.summary && <p className="text-body line-clamp-2 text-hero-text">{c.summary}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="fx-liquid-dark min-w-0 rounded-2xl p-3">
              <p className="text-caption text-white/70">{tx('evx.raised')}</p>
              <TickerMoney paise={c.raised_paise} className="text-stat block truncate text-lg" />
            </div>
            <div className="fx-liquid-dark min-w-0 rounded-2xl p-3">
              <p className="text-caption text-white/70">{tx('evx.goal')}</p>
              <p className="text-stat truncate text-lg">{formatPaise(c.goal_paise, { zeroAsFree: false })}</p>
            </div>
            <div className="fx-liquid-dark col-span-2 min-w-0 rounded-2xl p-3 sm:col-span-1">
              <p className="text-caption text-white/70">{tx('evx.donorsShort')}</p>
              <p className="text-stat text-lg">{c.donor_count.toLocaleString('en-IN')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DaysLeft endsAt={c.ends_at} light />
            <span className="fx-shine inline-flex min-h-11 items-center gap-1.5 rounded-full bg-(image:--grad-gold) px-5 font-semibold text-[#2b1a05] shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]">
              {tx('give.giveNow')} <ArrowRight className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      </Link>
    </BorderBeam>
  )
}

export function CampaignCard({ c }: { c: CampaignSummary }) {
  const tx = useT()
  const t = TYPE_ICON[c.type] ?? TYPE_ICON.project!
  const pct = percentOf(c.raised_paise, c.goal_paise)
  return (
    <Link to={`/give/${c.slug}`} data-testid="give-card" className="fx-press block h-full rounded-[1.6rem]">
      <SpotlightCard className="fx-hairline flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-border/80 bg-surface shadow-card">
        <div className="relative">
          <Cover c={c} className="h-36" />
          <IconTile icon={t.icon} tone={t.tone} variant="solid" size="md" className="absolute -bottom-5 left-4 ring-4 ring-surface" />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-4 pt-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-eyebrow text-gold-ink">{tx(TYPE_KEY[c.type] ?? 'give.type.project')}</span>
            <StatusBadge c={c} />
            {c.department && <Badge>{c.department}</Badge>}
          </div>
          <p className="text-title text-[1.15rem] leading-snug">{c.title}</p>
          {c.summary && <p className="text-body line-clamp-2 text-muted">{c.summary}</p>}
          <div className="mt-auto space-y-2 pt-1">
            <ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={tx('give.progress')} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span>
                <b className="text-stat text-base"><Money paise={c.raised_paise} /></b> <span className="text-muted">· {pct}%</span>
              </span>
              <span className="text-muted">
                {tx('give.donors', { count: c.donor_count })}
                {c.ends_at && <> · <DaysLeft endsAt={c.ends_at} /></>}
              </span>
            </div>
          </div>
        </div>
      </SpotlightCard>
    </Link>
  )
}

export function GivingHub() {
  const tx = useT()
  const { data, isLoading, error } = useHub()
  const [type, setType] = useState<string>('all')
  const [dept, setDept] = useState('')
  if (isLoading) return <PageSkeleton />
  const live = data?.campaigns.filter((c) => c.status === 'live' || c.status === 'paused') ?? []
  const hero = live.find((c) => c.is_featured && c.status === 'live') ?? live.find((c) => c.status === 'live')
  const shown = (data?.campaigns ?? []).filter((c) => (type === 'all' || c.type === type) && (!dept || c.department === dept) && c.id !== hero?.id)
  const r = data?.reunion
  const totalRaised = (data?.campaigns ?? []).reduce((s, c) => s + c.raised_paise, 0)
  return (
    <div>
      <PageHeader title={tx('give.title')} subtitle={tx('give.subtitle')} back="/" />
      <Page className="space-y-8">
        {error && <Notice tone="danger" title={friendlyError(error)} />}

        {/* hero statement */}
        <section className="aurora relative isolate -mx-4 overflow-hidden px-5 pb-7 pt-6 text-white sm:mx-0 sm:rounded-[1.75rem]">
          <GlowOrbs className="-z-10 opacity-60" />
          <div aria-hidden className="fx-dots-light absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(80%_70%_at_30%_30%,#000,transparent)]" />
          <p className="text-eyebrow text-accent">{tx('evx.giveHeroEyebrow')}</p>
          <TextReveal as="h2" text={tx('evx.giveHeroTitle')} className="text-display mt-2 max-w-[16ch] text-white" />
          <p className="text-body-lg mt-3 max-w-[38ch] text-hero-text">{tx('evx.giveHeroBody')}</p>
          {totalRaised > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="fx-liquid-dark inline-flex min-h-11 items-center gap-2 rounded-full px-4">
                <span className="text-caption text-white/70">{tx('evx.raised')}</span>
                <TickerMoney paise={totalRaised} className="text-stat text-lg" />
              </span>
              <Link to="/give/where-it-went" className="fx-liquid-dark fx-press inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold">
                {tx('give.wentTitle')} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          )}
        </section>

        {hero && <Hero c={hero} />}

        <div className="grid grid-cols-2 gap-3">
          <Link to="/give/mine" className="fx-press fx-hairline flex min-h-16 items-center gap-3 rounded-[1.4rem] bg-surface p-3 font-semibold shadow-card">
            <IconTile icon={Receipt} tone="gold" size="md" /> {tx('give.myGiving')}
          </Link>
          <Link to="/give/where-it-went" className="fx-press fx-hairline flex min-h-16 items-center gap-3 rounded-[1.4rem] bg-surface p-3 font-semibold shadow-card">
            <IconTile icon={ScrollText} tone="emerald" size="md" /> <span className="min-w-0">{tx('give.wentTitle')}</span>
          </Link>
        </div>

        {r && (
          <SpotlightCard tone="gold" className="fx-hairline rounded-[1.6rem] border border-accent/30 bg-[radial-gradient(120%_100%_at_100%_0%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_60%),var(--surface)] p-5 shadow-card" data-testid="reunion-fund-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconTile icon={Users} tone="gold" variant="solid" size="md" />
                <p className="text-title">{tx('give.reunionFund')}</p>
              </div>
              <Badge tone="accent">{tx('give.contributors', { count: r.contributors })}</Badge>
            </div>
            <p className="text-body mt-2 text-muted">{tx('give.reunionBlurb')}</p>
            <p className="text-stat mt-3 text-[2rem] leading-none" data-testid="reunion-raised"><Money paise={r.raised_paise} /></p>
            {r.pending_paise > 0 && <p className="text-caption mt-1 text-muted">{tx('give.reunionPending', { amount: formatPaise(r.pending_paise, { zeroAsFree: false }) })}</p>}
            <Link to="/meet" className="mt-2 inline-flex min-h-11 items-center gap-1 font-semibold text-primary">{tx('give.reunionHow')} <ArrowRight className="size-4" aria-hidden /></Link>
          </SpotlightCard>
        )}

        <section aria-label={tx('give.appeals')} className="space-y-4">
          <SectionHeader eyebrow={tx('evx.waysEyebrow')} title={tx('give.appeals')} />
          <Tabs
            variant="pills"
            label={tx('give.filterType')}
            value={type}
            onChange={setType}
            options={['all', ...CAMPAIGN_TYPES].map((t) => {
              const I = TYPE_ICON[t]?.icon
              return { value: t, label: t === 'all' ? tx('give.all') : tx(TYPE_KEY[t]!), icon: I ? <I aria-hidden /> : undefined }
            })}
          />
          {!!data?.departments.length && (
            <Select aria-label={tx('give.department')} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">{tx('give.allDepartments')}</option>
              {data.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          )}
          {shown.length === 0 ? (
            <EmptyState illustration={<NoResultsArt />} title={hero && type === 'all' && !dept ? tx('give.noOthers') : tx('give.none')}>{tx('give.noneBody')}</EmptyState>
          ) : (
            <Stagger className="grid gap-4 sm:grid-cols-2">{shown.map((c) => <CampaignCard key={c.id} c={c} />)}</Stagger>
          )}
        </section>
        <p className="text-center text-xs text-muted">{tx('give.updated', { date: formatDate(new Date().toISOString()) })}</p>
      </Page>
    </div>
  )
}
