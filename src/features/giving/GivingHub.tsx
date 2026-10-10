import { ArrowRight, HeartHandshake, Receipt, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { Select } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { formatPaise } from '../../lib/money'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useHub, type CampaignSummary } from './api'
import { CAMPAIGN_TYPES, daysLeft, percentOf } from './helpers'
import { Cover, Money, ProgressBar, StatusBadge, TYPE_KEY } from './parts'

function DaysLeft({ endsAt, light }: { endsAt: string | null; light?: boolean }) {
  const tx = useT()
  const d = daysLeft(endsAt)
  if (d === null) return null
  return <span className={light ? 'text-sm text-hero-text' : 'text-sm text-muted'}>{d === 0 ? tx('give.ended') : tx('give.daysLeft', { count: d })}</span>
}

export function Hero({ c }: { c: CampaignSummary }) {
  const tx = useT()
  return (
    <Link to={`/give/${c.slug}`} data-testid="give-hero" className="block overflow-hidden rounded-3xl bg-gradient-to-br from-hero to-hero-2 text-white shadow-pop">
      <Cover c={c} className="h-40 sm:h-56" />
      <div className="space-y-3 p-5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
          <HeartHandshake className="size-4" aria-hidden /> {tx('give.featured')} · {tx(TYPE_KEY[c.type] ?? 'give.type.project')}
        </span>
        <p className="text-xl font-bold leading-tight">{c.title}</p>
        {c.summary && <p className="line-clamp-2 text-sm text-hero-text">{c.summary}</p>}
        <ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={tx('give.progress')} tone="light" />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p>
            <span className="text-2xl font-bold tabular-nums"><Money paise={c.raised_paise} /></span>{' '}
            <span className="text-sm text-hero-text">{tx('give.ofGoal', { goal: formatPaise(c.goal_paise, { zeroAsFree: false }) })}</span>
          </p>
          <DaysLeft endsAt={c.ends_at} light />
        </div>
        <p className="inline-flex min-h-6 items-center gap-1 font-semibold">{tx('give.giveNow')} <ArrowRight className="size-4" aria-hidden /></p>
      </div>
    </Link>
  )
}

export function CampaignCard({ c }: { c: CampaignSummary }) {
  const tx = useT()
  return (
    <Link to={`/give/${c.slug}`} data-testid="give-card" className="block overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-card hover:border-primary/40">
      <Cover c={c} className="h-32" />
      <div className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{tx(TYPE_KEY[c.type] ?? 'give.type.project')}</Badge>
          <StatusBadge c={c} />
          {c.department && <Badge>{c.department}</Badge>}
        </div>
        <p className="text-lg font-bold leading-snug">{c.title}</p>
        {c.summary && <p className="line-clamp-2 text-[15px] text-muted">{c.summary}</p>}
        <ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={tx('give.progress')} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span><b className="tabular-nums"><Money paise={c.raised_paise} /></b> <span className="text-muted">· {percentOf(c.raised_paise, c.goal_paise)}%</span></span>
          <span className="text-muted">{tx('give.donors', { count: c.donor_count })}{c.ends_at && <> · <DaysLeft endsAt={c.ends_at} /></>}</span>
        </div>
      </div>
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
  return (
    <div>
      <PageHeader title={tx('give.title')} subtitle={tx('give.subtitle')} back="/" />
      <Page className="space-y-5">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {hero && <Hero c={hero} />}

        <div className="grid grid-cols-2 gap-3">
          <Link to="/give/mine" className="flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-surface p-3 font-semibold hover:border-primary/40"><Receipt className="size-5 text-primary" aria-hidden /> {tx('give.myGiving')}</Link>
          <Link to="/give/where-it-went" className="flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-surface p-3 font-semibold hover:border-primary/40"><ScrollText className="size-5 text-primary" aria-hidden /> {tx('give.wentTitle')}</Link>
        </div>

        {r && (
          <Card className="p-4" data-testid="reunion-fund-card">
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold">{tx('give.reunionFund')}</p>
              <Badge tone="accent">{tx('give.contributors', { count: r.contributors })}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{tx('give.reunionBlurb')}</p>
            <p className="mt-3 text-2xl font-bold tabular-nums" data-testid="reunion-raised"><Money paise={r.raised_paise} /></p>
            {r.pending_paise > 0 && <p className="text-sm text-muted">{tx('give.reunionPending', { amount: formatPaise(r.pending_paise, { zeroAsFree: false }) })}</p>}
            <Link to="/meet" className="mt-2 inline-flex min-h-11 items-center gap-1 font-semibold text-primary">{tx('give.reunionHow')} <ArrowRight className="size-4" aria-hidden /></Link>
          </Card>
        )}

        <section aria-label={tx('give.appeals')} className="space-y-3">
          <SectionTitle>{tx('give.appeals')}</SectionTitle>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={tx('give.filterType')}>
            {['all', ...CAMPAIGN_TYPES].map((t) => (
              <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${type === t ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-text'}`}>
                {t === 'all' ? tx('give.all') : tx(TYPE_KEY[t]!)}
              </button>
            ))}
          </div>
          {!!data?.departments.length && (
            <Select aria-label={tx('give.department')} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">{tx('give.allDepartments')}</option>
              {data.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          )}
          {shown.length === 0 ? (
            <EmptyState icon={<HeartHandshake />} title={hero && type === 'all' && !dept ? tx('give.noOthers') : tx('give.none')}>{tx('give.noneBody')}</EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">{shown.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
          )}
        </section>
        <p className="text-center text-xs text-muted">{tx('give.updated', { date: formatDate(new Date().toISOString()) })}</p>
      </Page>
    </div>
  )
}
