import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  ChevronDown,
  GraduationCap,
  HeartHandshake,
  MessagesSquare,
  Quote,
  Receipt,
  School,
  Search,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import { Link } from 'react-router'
import { Avatar, AvatarStack } from '../../components/ui/Avatar'
import { ButtonLink } from '../../components/ui/Button'
import { Countdown } from '../../components/ui/Countdown'
import { BentoCard, BentoGrid, GlowOrbs, SpotlightCard, TiltCard } from '../../components/ui/Fx'
import { IconTile } from '../../components/ui/IconTile'
import { Reveal, Stagger } from '../../components/ui/Motion'
import { ProgressRing } from '../../components/ui/Progress'
import { useLang, useT, type MsgKey } from '../../i18n'
import { fameImageUrl, fameTitle, usePublicWallOfFame } from '../fame/api'
import type { FlagshipEvent } from './api'

function SectionIntro({ eyebrow, title, body, id, center }: { eyebrow: string; title: string; body?: string; id: string; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-eyebrow text-gold-ink">{eyebrow}</p>
      <h2 id={id} className="text-display mt-3 text-balance">
        {title}
      </h2>
      {body && <p className="text-body-lg mt-4 text-muted">{body}</p>}
    </div>
  )
}

// illustrative initials only (never real people) for the product previews
const SAMPLE = ['A K', 'R S', 'P M', 'S J', 'V T', 'N G', 'D R']

/** What the app does, as a bento of small live previews built from the real components. */
export function FeatureBento({ flagship }: { flagship: FlagshipEvent | null }) {
  const tx = useT()
  return (
    <section aria-labelledby="features-title" className="relative px-5 py-20 sm:px-8 sm:py-28">
      <div aria-hidden className="fx-dots absolute inset-x-0 top-0 h-80 opacity-60" />
      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <SectionIntro id="features-title" eyebrow={tx('landing.featEyebrow')} title={tx('landing.featTitle')} body={tx('landing.featBody')} />
        </Reveal>
        <Reveal className="mt-10">
          <BentoGrid>
            <BentoCard cols={2} rows={2} tone="hero" className="flex min-h-[300px] flex-col p-6">
              <IconTile icon={Users} variant="glass" size="lg" />
              <h3 className="mt-5 font-display text-[26px] font-semibold leading-tight">{tx('landing.f.batch')}</h3>
              <p className="mt-2 max-w-sm text-white/75">{tx('landing.f.batchBody')}</p>
              <div aria-hidden className="mt-6 space-y-2.5">
                <div className="flex min-h-11 items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.06] px-4 text-sm text-white/60">
                  <Search className="size-4" /> {tx('landing.f.batchSearch')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {['1972', '1986', '1999', '2008', '2016', '2024'].map((y) => (
                    <span key={y} className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[13px] font-semibold tabular-nums text-white/85">
                      {y}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-auto pt-6">
                <div className="fx-liquid-dark flex items-center gap-3 rounded-2xl p-3">
                  <AvatarStack people={SAMPLE.map((n) => ({ name: n }))} max={5} size={36} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{tx('landing.f.batchPreview')}</p>
                    <p className="text-xs text-white/65">{tx('landing.f.batchPreviewSub')}</p>
                  </div>
                </div>
              </div>
            </BentoCard>
            <BentoCard cols={2} className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-[22px] font-semibold leading-tight">{tx('landing.f.meet')}</h3>
                  <p className="mt-1.5 text-muted">{tx('landing.f.meetBody')}</p>
                </div>
                <IconTile icon={Sparkles} tone="gold" variant="solid" />
              </div>
              {flagship?.starts_at && Date.parse(flagship.starts_at) > Date.now() && <Countdown to={flagship.starts_at} seconds={false} className="mt-5" />}
            </BentoCard>
            <BentoCard className="flex flex-col p-5">
              <TiltCard className="rounded-2xl" max={8}>
                <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0f7a57,#062a20)] p-3 text-white shadow-e3">
                  <div className="flex items-center gap-2">
                    <img src="/jec-logo.png" alt="" className="size-7 object-contain" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">{tx('landing.f.cardLabel')}</span>
                  </div>
                  <div className="mt-4 h-2 w-20 rounded-full bg-white/70" />
                  <div className="mt-1.5 h-2 w-14 rounded-full bg-white/35" />
                  <div className="mt-3 h-1 w-full rounded-full bg-(image:--grad-gold)" />
                </div>
              </TiltCard>
              <h3 className="mt-4 text-title">{tx('landing.f.card')}</h3>
              <p className="mt-1 text-sm text-muted">{tx('landing.f.cardBody')}</p>
            </BentoCard>
            <BentoCard className="flex flex-col p-5">
              <IconTile icon={BriefcaseBusiness} tone="ink" />
              <h3 className="mt-4 text-title">{tx('landing.f.jobs')}</h3>
              <p className="mt-1 text-sm text-muted">{tx('landing.f.jobsBody')}</p>
              <span className="mt-auto inline-flex w-fit items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 pt-1 text-xs font-semibold text-success">
                <BadgeCheck className="size-3.5" aria-hidden /> {tx('landing.f.jobsChip')}
              </span>
            </BentoCard>
            <BentoCard cols={2} className="p-6">
              <div className="flex items-center gap-3">
                {SAMPLE.slice(0, 5).map((n, i) => (
                  <Avatar key={n} name={n} size={44} ring={i < 3 ? 'story' : 'seen'} />
                ))}
              </div>
              <h3 className="mt-4 font-display text-[22px] font-semibold leading-tight">{tx('landing.f.stories')}</h3>
              <p className="mt-1.5 text-muted">{tx('landing.f.storiesBody')}</p>
            </BentoCard>
            <BentoCard className="flex flex-col p-5">
              <IconTile icon={MessagesSquare} tone="teal" />
              <h3 className="mt-4 text-title">{tx('landing.f.chat')}</h3>
              <p className="mt-1 text-sm text-muted">{tx('landing.f.chatBody')}</p>
            </BentoCard>
            <BentoCard className="flex flex-col p-5">
              <IconTile icon={GraduationCap} tone="plum" />
              <h3 className="mt-4 text-title">{tx('landing.f.mentor')}</h3>
              <p className="mt-1 text-sm text-muted">{tx('landing.f.mentorBody')}</p>
            </BentoCard>
            <BentoCard cols={2} tone="gold" className="flex items-center gap-5 p-6">
              <ProgressRing value={72} size={76} stroke={7} tone="brand" className="shrink-0">
                <HeartHandshake className="size-7" aria-hidden />
              </ProgressRing>
              <div>
                <h3 className="font-display text-[22px] font-semibold leading-tight">{tx('landing.f.give')}</h3>
                <p className="mt-1 text-[15px] text-[#3d2a0c]">{tx('landing.f.giveBody')}</p>
              </div>
            </BentoCard>
            <BentoCard cols={2} className="flex items-center gap-5 p-6">
              <div className="flex shrink-0 flex-col items-center gap-1 rounded-2xl bg-primary-soft px-4 py-3 text-primary">
                <span className="font-display text-[22px] font-semibold leading-none">Aa</span>
                <span className="text-[20px] font-semibold leading-none" lang="hi">अ</span>
              </div>
              <div>
                <h3 className="font-display text-[22px] font-semibold leading-tight">{tx('landing.f.lang')}</h3>
                <p className="mt-1 text-[15px] text-muted">{tx('landing.f.langBody')}</p>
              </div>
            </BentoCard>
          </BentoGrid>
        </Reveal>
      </div>
    </section>
  )
}

/** Public Wall of Fame entries (only those marked public). Hidden when there are none. */
export function FameTeaser() {
  const tx = useT()
  const { lang } = useLang()
  const { data } = usePublicWallOfFame(6)
  if (!data?.length) return null
  return (
    <section aria-labelledby="fame-title" className="px-5 pb-20 sm:px-8 sm:pb-28" data-testid="landing-fame">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionIntro id="fame-title" eyebrow={tx('landing.fameEyebrow')} title={tx('landing.fameTitle')} body={tx('landing.fameBody')} />
        </Reveal>
        <Stagger className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((e) => {
            const img = fameImageUrl(e)
            return (
              <SpotlightCard key={`${e.name}-${e.title}`} tone="gold" className="fx-hairline fx-lift relative h-full overflow-hidden rounded-[1.6rem] bg-surface p-5 shadow-card">
                <div className="flex items-center gap-4">
                  {img ? (
                    <img src={img} alt="" className="size-16 shrink-0 rounded-2xl object-cover shadow-e2" loading="lazy" />
                  ) : (
                    <Avatar name={e.name} size={64} ring="verified" />
                  )}
                  <div className="min-w-0">
                    <p className="font-display text-[19px] font-semibold leading-tight">{e.name}</p>
                    <p className="mt-0.5 text-sm text-muted">{[e.branch, e.grad_year].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                <p className="mt-4 flex gap-2 text-[15px] font-medium leading-snug">
                  <Trophy className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden /> {fameTitle(e, lang)}
                </p>
              </SpotlightCard>
            )
          })}
        </Stagger>
      </div>
    </section>
  )
}

/** Give back: what giving looks like here (campaign figures are for members only). */
export function GiveTeaser() {
  const tx = useT()
  const points: { icon: typeof School; key: MsgKey }[] = [
    { icon: School, key: 'landing.give1' },
    { icon: Receipt, key: 'landing.give2' },
    { icon: BadgeCheck, key: 'landing.give3' },
  ]
  return (
    <section aria-labelledby="give-title" className="px-5 pb-20 sm:px-8 sm:pb-28">
      <Reveal className="mx-auto max-w-6xl">
        <div className="fx-hairline relative grid overflow-hidden rounded-[2rem] bg-surface p-6 shadow-e3 sm:p-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
          <div aria-hidden className="absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative">
            <p className="text-eyebrow text-gold-ink">{tx('landing.giveEyebrow')}</p>
            <h2 id="give-title" className="text-display mt-3 text-balance">{tx('landing.giveTitle')}</h2>
            <p className="text-body-lg mt-4 text-muted">{tx('landing.giveBody')}</p>
            <ButtonLink to="/signin?next=%2Fgive" variant="gold" size="lg" className="fx-shine mt-7">
              <HeartHandshake className="size-5" aria-hidden /> {tx('landing.giveCta')}
            </ButtonLink>
          </div>
          <ul className="relative mt-8 space-y-3 lg:mt-0 lg:self-center">
            {points.map((p) => (
              <li key={p.key} className="flex items-center gap-4 rounded-2xl border border-border/70 bg-bg/60 p-4">
                <IconTile icon={p.icon} tone="gold" variant="solid" />
                <span className="text-[15px] font-medium">{tx(p.key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  )
}

export function QuoteBand() {
  const tx = useT()
  return (
    <section aria-label={tx('landing.quoteLabel')} className="px-5 pb-20 sm:px-8 sm:pb-28">
      <Reveal className="relative mx-auto max-w-4xl text-center">
        <Quote className="mx-auto size-10 text-gold-ink/70" aria-hidden />
        <blockquote className="mt-5 font-display text-[clamp(1.6rem,4.2vw,2.6rem)] font-medium leading-[1.2] tracking-[-0.015em] text-balance">
          {tx('landing.quote')}
        </blockquote>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-muted">{tx('landing.quoteBy')}</p>
      </Reveal>
    </section>
  )
}

const FAQ: [MsgKey, MsgKey][] = [
  ['landing.q1', 'landing.a1'],
  ['landing.q2', 'landing.a2'],
  ['landing.q3', 'landing.a3'],
  ['landing.q4', 'landing.a4'],
  ['landing.q5', 'landing.a5'],
  ['landing.q6', 'landing.a6'],
]

export function Faq() {
  const tx = useT()
  return (
    <section aria-labelledby="faq-title" className="px-5 pb-20 sm:px-8 sm:pb-28">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <SectionIntro id="faq-title" eyebrow={tx('landing.faqEyebrow')} title={tx('landing.faqTitle')} />
        </Reveal>
        <Reveal>
          <div className="divide-y divide-border/80 overflow-hidden rounded-[1.6rem] border border-border/80 bg-surface shadow-card">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                  {tx(q)}
                  <ChevronDown className="size-5 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" aria-hidden />
                </summary>
                <p className="px-5 pb-5 text-[15px] leading-relaxed text-muted">{tx(a)}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function FinalCta() {
  const tx = useT()
  return (
    <section className="px-5 pb-16 sm:px-8" aria-labelledby="final-title">
      <Reveal className="mx-auto max-w-6xl">
        <div className="aurora relative overflow-hidden rounded-[2rem] px-6 py-14 text-center text-white sm:py-20">
          <GlowOrbs className="opacity-50" />
          <div aria-hidden className="fx-grid fx-grid-light absolute inset-0" />
          <div className="relative">
            <img src="/jec-logo.png" alt="" className="mx-auto size-16 object-contain drop-shadow-lg" />
            <h2 id="final-title" className="text-display mx-auto mt-5 max-w-2xl text-balance text-white">{tx('landing.finalTitle')}</h2>
            <p className="text-body-lg mx-auto mt-3 max-w-lg text-white/75">{tx('landing.finalBody')}</p>
            <ButtonLink to="/signin" variant="gold" size="lg" className="fx-shine mt-8">
              {tx('landing.finalCta')} <ArrowRight className="size-5" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

export function LandingFooter() {
  const tx = useT()
  const links: [string, MsgKey][] = [
    ['/about', 'menu.about'],
    ['/meet', 'landing.navMeet'],
    ['/meets', 'menu.pastMeets'],
    ['/privacy', 'menu.privacy'],
    ['/terms', 'menu.terms'],
    ['/install', 'landing.install'],
  ]
  return (
    <footer className="border-t border-border/70 px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-12 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-3">
            <img src="/jec-logo.png" alt={tx('landing.crestAlt')} className="h-12 w-auto" />
            <img src="/gec-crest.png" alt={tx('landing.gecAlt')} className="h-12 w-auto rounded-lg bg-white p-0.5" />
            <img src="/jecaa-logo.png" alt={tx('landing.jecaaAlt')} className="h-12 w-auto rounded-lg bg-white p-0.5" />
          </div>
          <p className="mt-4 font-display text-lg font-semibold">JEC Alumni Connect</p>
          <p className="mt-1 text-sm text-muted">{tx('landing.footerAbout')}</p>
        </div>
        <nav aria-label={tx('landing.footerNav')}>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
            {links.map(([to, key]) => (
              <li key={to}>
                <Link to={to} className="inline-flex min-h-11 items-center text-[15px] font-medium text-muted hover:text-text">
                  {tx(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-muted">{tx('landing.footerNote', { year: new Date().getFullYear() })}</p>
    </footer>
  )
}
