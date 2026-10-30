import { ExternalLink, FlaskConical, Landmark, Medal, Palette, Rocket, Sparkles, Trophy, UserRound, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Notice, Skeleton } from '../../components/ui/Display'
import { GlowOrbs, SpotlightCard, TextReveal } from '../../components/ui/Fx'
import { Sheet } from '../../components/ui/Sheet'
import { Tabs } from '../../components/ui/Tabs'
import { useLang, useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { Portrait } from '../yearbook/Portrait'
import { FAME_CATEGORIES, FAME_CATEGORY_LABELS, fameImageUrl, fameStory, fameTitle, isSafeFameLink, useWallOfFame, type FameCategory, type FameEntry } from './api'

export const FAME_ICONS: Record<FameCategory, LucideIcon> = {
  achiever: Trophy,
  entrepreneur: Rocket,
  public_service: Landmark,
  research: FlaskConical,
  sports: Medal,
  arts: Palette,
  legend: Sparkles,
}

type Tab = 'all' | FameCategory

/** The gold picture frame used on the wall (and in the admin preview). */
export function FameFrame({ e, featured, onOpen }: { e: FameEntry; featured?: boolean; onOpen?: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const Icon = FAME_ICONS[e.category]
  const cat = FAME_CATEGORY_LABELS[e.category][lang === 'hi' ? 'hi' : 'en']
  const story = fameStory(e, lang)
  const meta = [e.grad_year ? tx('wow.card.classOf', { year: e.grad_year }) : null, shortBranch(e.branch)].filter(Boolean).join(' · ')
  return (
    <SpotlightCard tone="gold" className="group h-full rounded-[30px]">
      <button
        type="button"
        onClick={onOpen}
        className="fx-press flex h-full w-full flex-col rounded-[30px] bg-[linear-gradient(145deg,#fff1c4,#e4ad45_22%,#7a4a12_48%,#f4dc9e_70%,#915719)] p-[5px] text-left shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9),0_0_0_1px_rgb(0_0_0/0.4)]"
        data-testid="fame-card"
      >
        <span className="flex h-full flex-col overflow-hidden rounded-[25px] bg-[#07130f] ring-1 ring-black/60">
          <span className={cn('relative block w-full overflow-hidden', featured ? 'aspect-[4/5] sm:aspect-[16/11]' : 'aspect-[4/5]')}>
            <Portrait src={fameImageUrl(e)} name={e.name} className="absolute inset-0 transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.03]" />
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgb(4_12_9/0.55)_62%,rgb(4_12_9/0.97)_100%)]" />
            <span className="fx-liquid-dark absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#f4dc9e]">
              <Icon className="size-3.5" aria-hidden />
              {cat}
            </span>
            <span className="absolute inset-x-0 bottom-0 block p-5">
              <span className={cn('block font-display font-semibold leading-[1.05] tracking-[-0.02em] text-white', featured ? 'text-[34px] sm:text-[44px]' : 'text-[28px]')}>{e.name}</span>
              <span className="mt-2 block text-[15px] font-semibold leading-snug text-[#f4dc9e]">{fameTitle(e, lang)}</span>
              {meta && <span className="mt-1 block text-caption text-white/65">{meta}</span>}
            </span>
          </span>
          {story && (
            <span className="block px-5 pb-5 pt-1">
              <span className="line-clamp-3 block text-[15px] leading-relaxed text-white/75">{story}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-[#f4dc9e]">{tx('wow.fame.readStory')}</span>
            </span>
          )}
        </span>
      </button>
    </SpotlightCard>
  )
}

export function FamePage() {
  const tx = useT()
  const { lang } = useLang()
  const [tab, setTab] = useState<Tab>('all')
  const q = useWallOfFame(tab === 'all' ? null : tab)
  const [open, setOpen] = useState<FameEntry | null>(null)
  const list = q.data ?? []
  const options = [
    { value: 'all' as Tab, label: tx('wow.fame.all') },
    ...FAME_CATEGORIES.map((c) => {
      const Icon = FAME_ICONS[c]
      return { value: c as Tab, label: FAME_CATEGORY_LABELS[c][lang === 'hi' ? 'hi' : 'en'], icon: <Icon className="size-4" aria-hidden /> }
    }),
  ]

  return (
    <div data-theme="dark" className="min-h-dvh bg-[#040b08] text-text">
      <PageHeader title={tx('wow.fame.title')} back="/" />
      <Page wide className="space-y-6">
        <section className="relative overflow-hidden rounded-[32px] px-5 pb-8 pt-10 text-center sm:px-10 sm:pt-14">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(55%_70%_at_50%_-10%,rgb(244_220_158/0.28),transparent_70%)]" />
          <div aria-hidden className="absolute inset-x-[20%] top-0 h-full bg-[conic-gradient(from_180deg_at_50%_0%,transparent_160deg,rgb(244_220_158/0.10)_180deg,transparent_200deg)]" />
          <GlowOrbs className="opacity-50" />
          <div aria-hidden className="fx-dots fx-dots-light absolute inset-0" />
          <div className="relative">
            <img src="/jec-logo.png" alt="" className="mx-auto h-16 w-auto drop-shadow-[0_10px_30px_rgb(228_173_69/0.35)]" />
            <p className="mt-5 text-eyebrow text-accent">{tx('wow.fame.eyebrow')}</p>
            <TextReveal text={tx('wow.fame.headline')} as="h2" className="text-display-xl mx-auto mt-3 max-w-3xl text-white" />
            <p className="mx-auto mt-4 max-w-xl text-body-lg text-hero-text">{tx('wow.fame.intro')}</p>
          </div>
        </section>

        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <Tabs options={options} value={tab} onChange={setTab} label={tx('wow.fame.categories')} variant="pills" />
        </div>

        {q.error ? (
          <Notice tone="warning" title={tx('wow.fame.cantLoad')}>
            {(q.error as { code?: string }).code === '42501' ? tx('wow.fame.verifiedOnly') : friendlyError(q.error)}
          </Notice>
        ) : q.isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-[30px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyWall />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((e, i) => (
              <li key={e.id} className={cn(i === 0 && list.length > 2 && 'sm:col-span-2')}>
                <FameFrame e={e} featured={i === 0 && list.length > 2} onOpen={() => setOpen(e)} />
              </li>
            ))}
          </ul>
        )}
      </Page>
      <FameSheet e={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function EmptyWall() {
  const tx = useT()
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-[#e4ad45]/25 bg-[#07130f] px-6 py-14 text-center">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,rgb(244_220_158/0.16),transparent)]" />
      <div className="relative mx-auto grid size-20 place-items-center rounded-full bg-[linear-gradient(145deg,#fff1c4,#e4ad45_40%,#915719)] p-[3px]">
        <span className="grid size-full place-items-center rounded-full bg-[#07130f] text-[#f4dc9e]">
          <Trophy className="size-8" aria-hidden />
        </span>
      </div>
      <p className="relative mt-5 font-display text-[26px] font-semibold text-white">{tx('wow.fame.emptyTitle')}</p>
      <p className="relative mx-auto mt-2 max-w-md text-body text-white/70">{tx('wow.fame.emptyBody')}</p>
    </div>
  )
}

function FameSheet({ e, onClose }: { e: FameEntry | null; onClose: () => void }) {
  return (
    <Sheet open={!!e} onClose={onClose} label={e?.name ?? ''}>
      {e && <FameStory e={e} />}
    </Sheet>
  )
}

function FameStory({ e }: { e: FameEntry }) {
  const tx = useT()
  const { lang } = useLang()
  const story = fameStory(e, lang)
  const Icon = FAME_ICONS[e.category]
  const link = e.link_url && isSafeFameLink(e.link_url) ? e.link_url : null
  const meta = [e.grad_year ? tx('wow.card.classOf', { year: e.grad_year }) : null, e.branch].filter(Boolean).join(' · ')
  return (
    <>
      <div className="p-3">
        <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(145deg,#fff1c4,#e4ad45_22%,#7a4a12_48%,#f4dc9e_70%,#915719)] p-[4px]">
          <div className="relative overflow-hidden rounded-[20px]">
            <Portrait src={fameImageUrl(e)} name={e.name} className="aspect-[4/3] w-full" />
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgb(4_12_9/0.92))]" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#f4dc9e]">
                <Icon className="size-3.5" aria-hidden />
                {FAME_CATEGORY_LABELS[e.category][lang === 'hi' ? 'hi' : 'en']}
              </p>
              <h2 className="mt-1 font-display text-[30px] font-semibold leading-tight">{e.name}</h2>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-5 pb-4 pt-2">
        <div>
          <p className="text-title text-gold-ink">{fameTitle(e, lang)}</p>
          {meta && <p className="mt-0.5 text-caption text-muted">{meta}</p>}
        </div>
        {story && <p className="whitespace-pre-line text-body-lg leading-relaxed">{story}</p>}
        <div className="grid gap-2">
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 text-[15px] font-semibold hover:bg-surface-2">
              <ExternalLink className="size-4" aria-hidden />
              {tx('wow.fame.readMore')}
              <span className="sr-only">{tx('wow.fame.newTab')}</span>
            </a>
          )}
          {e.member_id && (
            <ButtonLink to={`/people/${e.member_id}`} variant="primary" icon={<UserRound className="size-4" aria-hidden />} block>
              {tx('wow.fame.viewProfile')}
            </ButtonLink>
          )}
        </div>
      </div>
    </>
  )
}
