import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BriefcaseBusiness, Cake, Send, Star } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { Avatar } from '../../components/ui/Avatar'
import { SectionHeader } from '../../components/ui/Card'
import { Card, PageSkeleton } from '../../components/ui/Display'
import { BentoGrid, Meteors } from '../../components/ui/Fx'
import { IconTile } from '../../components/ui/IconTile'
import { LinkedInIcon } from '../../components/ui/Icons'
import { Reveal, Stagger } from '../../components/ui/Motion'
import { ProgressRing } from '../../components/ui/Progress'
import { useT, type MsgKey } from '../../i18n'
import { dateLocale } from '../../i18n/core'
import { cn } from '../../lib/cn'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useAuth, useMyProfile, useUserId } from '../auth/AuthProvider'
import { useShownBadges } from '../badges/api'
import { Composer } from '../community/Composer'
import { FeedList } from '../community/FeedList'
import { useGroups } from '../community/queries'
import { GlimpseCarousel } from '../glimpses/GlimpseCarousel'
import { useLiveGlimpses } from '../glimpses/api'
import { useHomeHighlights } from '../highlights/api'
import type { JobListItem } from '../jobs/queries'
import { LandingPage } from '../landing/LandingPage'
import { LocationPromptCard } from '../location/LocationSharing'
import { PastMeetsStrip } from '../meets/PastMeetsStrip'
import { GalleryStrips } from '../photos/GalleryStrips'
import { useMySocialLinks } from '../profile/socialQueries'
import { HighlightsStrip, StoryRow } from '../stories/StoryRow'
import { useMyBatchmatesSummary } from '../yearbook/api'
import { dayPart, istHour, type DayPart } from './homeLogic'
import { ActivityChips, AnniversaryBanner, BadgesTile, BatchTile, FameTile, GiveTile, NextUpTile, QuickActionsTile, WorldTile } from './HomeTiles'

/** `hasSocial` (an Instagram or Facebook link) is a pure bonus: it is not in the total, so nobody's score goes down, and it is capped at 100. */
export function profileCompleteness(p: Profile, hasSocial = false): { percent: number; next: { label: MsgKey; to: string } | null } {
  const checks: [boolean, MsgKey, string][] = [
    [!!p.avatar_url, 'home.stepPhoto', '/me/edit'],
    [!!p.headline || !!p.current_title, 'home.stepRole', '/me/import'],
    [!!p.about, 'home.stepAbout', '/me/edit'],
    [p.skills.length > 0, 'home.stepSkills', '/me/import'],
    [p.help_tags.length > 0, 'home.stepHelp', '/me/edit'],
    [!!p.linkedin_url, 'home.stepLinkedin', '/me/edit'],
  ]
  const done = checks.filter((c) => c[0]).length + 2 // name + batch from onboarding
  const total = checks.length + 2
  const first = checks.find((c) => !c[0])
  return { percent: Math.min(100, Math.round(((done + (hasSocial ? 1 : 0)) / total) * 100)), next: first ? { label: first[1], to: first[2] } : null }
}

const GREETING: Record<DayPart, MsgKey> = { morning: 'home.morning', afternoon: 'home.afternoon', evening: 'home.evening', night: 'home.night' }

// The light of the hero follows the clock in India: warm gold mornings, bright emerald afternoons, deep emerald evenings.
const SKY: Record<DayPart, string> = {
  morning:
    'bg-[radial-gradient(70%_80%_at_95%_0%,rgb(240_180_79/0.75),transparent_65%),radial-gradient(60%_70%_at_0%_100%,rgb(31_145_106/0.55),transparent_70%),linear-gradient(160deg,#0f5a43_0%,#0a4433_55%,#062a20_100%)]',
  afternoon:
    'bg-[radial-gradient(70%_80%_at_90%_0%,rgb(79_209_161/0.55),transparent_65%),radial-gradient(50%_60%_at_0%_100%,rgb(228_173_69/0.35),transparent_70%),linear-gradient(160deg,#0f7a57_0%,#0a5540_55%,#062a20_100%)]',
  evening:
    'bg-[radial-gradient(60%_70%_at_100%_100%,rgb(228_173_69/0.38),transparent_65%),radial-gradient(70%_70%_at_0%_0%,rgb(31_145_106/0.45),transparent_70%),linear-gradient(160deg,#0a4433_0%,#062a20_55%,#03140f_100%)]',
  night:
    'bg-[radial-gradient(60%_60%_at_85%_10%,rgb(111_200_165/0.22),transparent_65%),radial-gradient(50%_50%_at_10%_100%,rgb(139_30_45/0.25),transparent_70%),linear-gradient(170deg,#062a20_0%,#04170f_60%,#020b08_100%)]',
}

export function HomePage() {
  const tx = useT()
  const uid = useUserId()
  const { session, loading } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const { data: groups } = useGroups()
  const { data: social } = useMySocialLinks()
  const verified = !!profile && (profile.verification === 'verified' || profile.is_admin)
  const h = useHomeHighlights()
  const batch = useMyBatchmatesSummary()
  const badges = useShownBadges(verified ? uid : null)
  const { data: glimpses } = useLiveGlimpses()

  if (loading || (session && isLoading)) return <PageSkeleton />
  if (!session || !profile) return <LandingPage />
  if (!profile.onboarded) return <Navigate to="/welcome?next=/" replace />

  const comp = profileCompleteness(profile, !!(social?.instagram_url || social?.facebook_url))
  const year = batch.data?.grad_year ?? profile.grad_year ?? null

  return (
    <Page wide className="space-y-5 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:space-y-6 md:pt-8">
      <Hero profile={profile} percent={comp.percent} next={comp.next} />

      {verified && (
        <div className="space-y-3">
          <StoryRow />
          <HighlightsStrip />
        </div>
      )}

      <ActivityChips h={h.data} />
      <AnniversaryBanner h={h.data} />

      <BentoGrid>
        <NextUpTile h={h.data} loading={h.isLoading} />
        {verified && <BatchTile batch={batch.data} loading={batch.isLoading} fallbackYear={profile.grad_year} />}
        {verified && <BadgesTile badges={badges.badges} loading={badges.isLoading} />}
        <QuickActionsTile verified={verified} year={year} />
        {verified && <WorldTile enabled={verified} />}
        {verified && <GiveTile />}
        {verified && <FameTile enabled={verified} />}
      </BentoGrid>

      {glimpses.length > 0 && (
        <Reveal as="section">
          <SectionHeader eyebrow={tx('home.glimpses')} title={tx('home.glimpsesTitle')} />
          <GlimpseCarousel />
        </Reveal>
      )}

      <PastMeetsStrip />

      {verified ? (
        <>
          <LocationPromptCard />
          <div className="grid gap-5 md:grid-cols-2 md:items-start">
            <Spotlight />
            <LatestJobs />
          </div>
          <Birthdays />
          <GalleryStrips verified />
          <section aria-labelledby="home-community" className="space-y-3">
            <SectionHeader eyebrow={tx('home.community')} title={<span id="home-community">{tx('home.communityTitle')}</span>} />
            <div className="mx-auto max-w-2xl space-y-4">
              <Composer groups={groups} />
              <FeedList scope="home" />
            </div>
          </section>
        </>
      ) : (
        <>
          <Card variant="gradient-border" className="p-5">
            <p className="font-display text-[20px] font-semibold">{tx('home.unlock')}</p>
            <p className="mt-1 text-[15px] text-muted">{tx('home.unlockBody')}</p>
          </Card>
          <Stagger className="grid gap-3 sm:grid-cols-2">
            <QuickAction to="/me/import" icon={<LinkedInIcon />} title={tx('home.importLinkedin')} text={tx('home.fill30')} />
            <QuickAction to="/invite" icon={<Send className="size-5" />} title={tx('home.invite')} text={tx('home.vouch')} />
          </Stagger>
        </>
      )}
    </Page>
  )
}

function Hero({ profile, percent, next }: { profile: Profile; percent: number; next: { label: MsgKey; to: string } | null }) {
  const tx = useT()
  const part = dayPart(istHour())
  const first = profile.full_name.split(' ')[0] || tx('home.there')
  const today = new Intl.DateTimeFormat(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date())
  const sub = [profile.grad_year ? tx('home.batchOf', { year: profile.grad_year }) : null, profile.branch?.replace(/^B\.E\. in /, '')].filter(Boolean).join(' · ')
  return (
    <header data-theme="dark" data-daypart={part} className={cn('relative isolate overflow-hidden rounded-[2rem] p-5 text-white shadow-e4 sm:p-7', SKY[part])}>
      <div aria-hidden className="fx-grid fx-grid-light absolute inset-0 -z-10 opacity-60" />
      {part === 'night' && <Meteors count={5} className="-z-10" />}
      <div className="flex items-center justify-between gap-3">
        <p className="text-eyebrow text-accent">{today}</p>
      </div>
      <div className="mt-4 flex items-center gap-4 sm:gap-6">
        <Link to="/me" aria-label={tx('nav.yourProfile')} className="fx-press shrink-0 rounded-full">
          <ProgressRing value={percent} size={88} stroke={5} tone="brand" label={tx('home.strength', { percent })}>
            <Avatar src={profile.avatar_url} name={profile.full_name} size={70} />
          </ProgressRing>
        </Link>
        <div className="min-w-0">
          <p className="text-[15px] text-white/75">{tx(GREETING[part])},</p>
          <h1 className="text-display truncate leading-[1.05] text-white">{first}</h1>
          {sub && <p className="mt-1 text-sm text-white/70">{sub}</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-white/12 bg-white/[0.07] px-4 py-3 backdrop-blur-md">
        <p className="text-sm font-semibold">{tx('home.complete', { percent })}</p>
        {next && (
          <Link to={next.to} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
            {tx('home.next')} {tx(next.label)} <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
    </header>
  )
}

function QuickAction({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link to={to} className="fx-press fx-lift flex items-center gap-3 rounded-[1.4rem] border border-border/80 bg-surface p-4 shadow-card">
      <IconTile icon={icon} tone="emerald" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <ArrowRight className="size-4 text-muted" aria-hidden />
    </Link>
  )
}

function Birthdays() {
  const tx = useT()
  const { data } = useQuery({
    queryKey: ['birthdays'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('upcoming_birthdays')
      if (error) throw error
      return data as { id: string; full_name: string; avatar_url: string | null; days_away: number }[]
    },
  })
  if (!data?.length) return null
  return (
    <section aria-label={tx('home.birthdays')}>
      <SectionHeader eyebrow={tx('home.birthdays')} title={<span className="inline-flex items-center gap-2"><Cake className="size-5 text-gold-ink" aria-hidden />{tx('home.birthdays')}</span>} />
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {data.map((b) => (
          <li key={b.id} className="w-24 shrink-0">
            <Link to={`/people/${b.id}`} className="fx-press flex flex-col items-center rounded-[1.4rem] border border-border/70 bg-surface p-3 text-center shadow-card">
              <Avatar src={b.avatar_url} name={b.full_name} size={56} ring={b.days_away === 0 ? 'verified' : 'none'} />
              <p className="mt-2 w-full truncate text-sm font-semibold">{b.full_name.split(' ')[0]}</p>
              <p className="text-xs text-muted">{b.days_away === 0 ? tx('home.today') : b.days_away === 1 ? tx('home.tomorrow') : tx('home.inDays', { count: b.days_away })}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Spotlight() {
  const tx = useT()
  const { data } = useQuery({
    queryKey: ['spotlight'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('spotlights')
        .select('id, headline, story, starts_on, profile:profiles!spotlights_profile_id_fkey(id, full_name, avatar_url, grad_year, branch)')
        .lte('starts_on', new Date().toISOString().slice(0, 10))
        .order('starts_on', { ascending: false })
        .order('created_at', { ascending: false }) // newest wins when two start the same day
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as unknown as { id: string; headline: string; story: string | null; profile: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null } } | null
    },
  })
  if (!data) return null
  return (
    <Link to={`/people/${data.profile.id}`} className="fx-press fx-lift fx-hairline relative block overflow-hidden rounded-[1.6rem] bg-surface p-5 shadow-card">
      <div aria-hidden className="absolute -right-16 -top-16 size-48 rounded-full bg-accent/20 blur-3xl" />
      <p className="text-eyebrow relative flex items-center gap-1.5 text-gold-ink">
        <Star className="size-3.5 fill-current" aria-hidden /> {tx('home.spotlight')}
      </p>
      <div className="relative mt-3 flex items-center gap-3">
        <Avatar src={data.profile.avatar_url} name={data.profile.full_name} size={56} ring="verified" />
        <div className="min-w-0">
          <p className="font-display text-[19px] font-semibold leading-tight">{data.profile.full_name}</p>
          <p className="text-sm text-muted">{[data.profile.branch, data.profile.grad_year].filter(Boolean).join(' ')}</p>
        </div>
      </div>
      <p className="relative mt-3 text-[16px] font-semibold leading-snug">{data.headline}</p>
      {data.story && <p className="relative mt-1 line-clamp-3 text-sm text-muted">{data.story}</p>}
    </Link>
  )
}

/** The three newest openings, so jobs are visible from Home without hunting for them. */
function LatestJobs() {
  const tx = useT()
  const { data } = useQuery({
    queryKey: ['jobs', 'latest'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_jobs', { p_limit: 3 })
      if (error) throw error
      return data as JobListItem[]
    },
  })
  if (!data?.length) return null
  return (
    <section aria-label={tx('home.latestJobs')}>
      <SectionHeader
        title={tx('home.latestJobs')}
        action={
          <Link to="/jobs" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
            {tx('home.seeAll')}
          </Link>
        }
      />
      <Stagger className="space-y-2">
        {data.map((j) => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="fx-press fx-lift flex items-center gap-3 rounded-[1.4rem] border border-border/80 bg-surface p-3.5 shadow-card">
            <IconTile icon={BriefcaseBusiness} tone="ink" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{j.title}</span>
              <span className="block truncate text-sm text-muted">
                {j.company} · {j.poster_name}
                {j.can_refer ? ` · ${tx('home.canRefer')}` : ''}
              </span>
            </span>
          </Link>
        ))}
      </Stagger>
    </section>
  )
}
