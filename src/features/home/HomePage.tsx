import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bell, BriefcaseBusiness, CalendarHeart, Search, Send, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import type { JobListItem } from '../jobs/queries'
import { Avatar, Card, PageSkeleton } from '../../components/ui/Display'
import { LinkedInIcon } from '../../components/ui/Icons'
import { MEET_SLUG } from '../../lib/constants'
import { daysUntil, formatDateRange } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { useEvent, useMyRegistration } from '../events/queries'
import { StatusBadge } from '../events/StatusBadge'
import { supabase } from '../../lib/supabase'
import { Composer } from '../community/Composer'
import { FeedList } from '../community/FeedList'
import { useGroups, useNotifications } from '../community/queries'

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function profileCompleteness(p: Profile): { percent: number; next: { label: string; to: string } | null } {
  const checks: [boolean, string, string][] = [
    [!!p.avatar_url, 'Add a profile photo', '/me/edit'],
    [!!p.headline || !!p.current_title, 'Add your current role', '/me/import'],
    [!!p.about, 'Write a short “About”', '/me/edit'],
    [p.skills.length > 0, 'Add a few skills', '/me/import'],
    [p.help_tags.length > 0, 'Say how you can help juniors', '/me/edit'],
    [!!p.linkedin_url, 'Link your LinkedIn', '/me/edit'],
  ]
  const done = checks.filter((c) => c[0]).length + 2 // name + batch from onboarding
  const total = checks.length + 2
  const first = checks.find((c) => !c[0])
  return { percent: Math.round((done / total) * 100), next: first ? { label: first[1], to: first[2] } : null }
}

function Landing() {
  return (
    <div className="min-h-dvh bg-hero text-white">
      <div className="relative mx-auto max-w-3xl overflow-hidden px-5 pb-16 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <div aria-hidden className="absolute -right-32 -top-24 size-96 rounded-full bg-hero-2" />
        <div className="relative">
          <img src="/pwa-192.png" alt="" className="size-14 rounded-2xl" />
          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">Every JECian, one tap away.</h1>
          <p className="mt-4 max-w-xl text-lg text-hero-text">
            For everyone who studied at Jabalpur Engineering College, the oldest technical institution in Central India (est. 1947). Find your batch, see where everyone is today, and register for the Alumni Meet 2026.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row [&_a:first-child]:bg-white [&_a:first-child]:text-hero">
            <ButtonLink to="/signin" size="lg">
              Sign in or join
            </ButtonLink>
            <ButtonLink to="/meet" size="lg" variant="ghost" className="text-white hover:bg-white/10">
              Alumni Meet 2026 <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickAction({ to, icon, title, text }: { to: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-primary/40">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <ArrowRight className="size-4 text-muted" aria-hidden />
    </Link>
  )
}

export function HomePage() {
  const { session, loading } = useAuth()
  const { data: profile, isLoading } = useMyProfile()
  const { data: event } = useEvent(MEET_SLUG)
  const { data: mine, isPending: regPending } = useMyRegistration(event?.id)
  const { data: groups } = useGroups()

  if (loading || (session && isLoading)) return <PageSkeleton />
  if (!session || !profile) return <Landing />
  if (!profile.onboarded) return <Navigate to="/welcome?next=/" replace />

  const first = profile.full_name.split(' ')[0] || 'there'
  const comp = profileCompleteness(profile)
  const days = daysUntil(event?.starts_at ?? null)
  const reg = mine?.registration && mine.registration.status !== 'cancelled' ? mine.registration : null

  const verified = profile.verification === 'verified' || profile.is_admin
  return (
    <Page className="space-y-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <header className="flex items-center gap-3">
        <Avatar src={profile.avatar_url} name={profile.full_name} size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{greeting()},</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{first}</h1>
        </div>
        <Link to="/people" aria-label="Find JECians" className="grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft">
          <Search className="size-5" />
        </Link>
        <NotificationBell />
      </header>

      {event && (
        <Link to={reg ? '/meet/my' : '/meet'} className="block overflow-hidden rounded-3xl bg-gradient-to-br from-hero to-hero-2 text-white shadow-pop">
          <div className="relative p-5">
            <div aria-hidden className="absolute -right-10 -top-14 size-40 rounded-full bg-hero-2" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                  <CalendarHeart className="size-4" aria-hidden /> {days ? `In ${days} days` : 'Alumni Meet'}
                </span>
                {reg && <StatusBadge status={reg.status} />}
              </div>
              <p className="mt-2 text-xl font-bold">{event.title}</p>
              <p className="text-sm text-hero-text">{formatDateRange(event.starts_at, event.ends_at)}</p>
              <p className="mt-4 inline-flex min-h-6 items-center gap-1 font-semibold">
                {regPending ? <span className="skeleton inline-block h-5 w-40 rounded-md bg-white/20" aria-busy="true" aria-label="Loading" /> : reg ? (reg.status === 'confirmed' ? 'View your entry pass' : reg.status === 'pending_payment' ? 'Complete your payment' : 'See your registration') : 'Register now'}
                {!regPending && <ArrowRight className="size-4" aria-hidden />}
              </p>
            </div>
          </div>
        </Link>
      )}

      {comp.next && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">Your profile is {comp.percent}% complete</p>
            <Sparkles className="size-5 text-accent" aria-hidden />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={comp.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${comp.percent}%` }} />
          </div>
          <Link to={comp.next.to} className="mt-3 inline-flex min-h-11 items-center gap-1 font-semibold text-primary">
            Next: {comp.next.label} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
      )}

      {verified ? (
        <>
          <Spotlight />
          <LatestJobs />
          <Birthdays />
          <Composer groups={groups} />
          <FeedList scope="home" />
        </>
      ) : (
        <>
          <Card className="p-4">
            <p className="font-semibold">Unlock the JEC community</p>
            <p className="mt-1 text-[15px] text-muted">
              The feed, groups and messages are for verified JECians. You’re verified automatically when your Alumni Meet payment is confirmed, or when two verified members vouch for you (send them your invite link).
            </p>
          </Card>
          <section className="grid gap-3 sm:grid-cols-2">
            <QuickAction to="/me/import" icon={<LinkedInIcon />} title="Import from LinkedIn" text="Fill your profile in 30 seconds" />
            <QuickAction to="/invite" icon={<Send className="size-5" />} title="Invite batchmates" text="They can vouch for you" />
          </section>
        </>
      )}
    </Page>
  )
}

function NotificationBell() {
  const { data } = useNotifications()
  const unread = data?.filter((n) => !n.read_at).length ?? 0
  return (
    <Link to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4.5 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4.5 text-white">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  )
}

function Birthdays() {
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
    <Card className="p-4">
      <p className="font-semibold">🎂 Birthdays</p>
      <ul className="mt-3 flex gap-4 overflow-x-auto pb-1">
        {data.map((b) => (
          <li key={b.id} className="w-20 shrink-0 text-center">
            <Link to={`/people/${b.id}`} className="block">
              <Avatar src={b.avatar_url} name={b.full_name} size={56} className="mx-auto" />
              <p className="mt-1 truncate text-sm font-semibold">{b.full_name.split(' ')[0]}</p>
              <p className="text-xs text-muted">{b.days_away === 0 ? 'Today!' : b.days_away === 1 ? 'Tomorrow' : `In ${b.days_away} days`}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Spotlight() {
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
    <Link to={`/people/${data.profile.id}`} className="block rounded-2xl border border-accent/40 bg-accent-soft p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-warning">⭐ JECian of the Week</p>
      <div className="mt-2 flex items-center gap-3">
        <Avatar src={data.profile.avatar_url} name={data.profile.full_name} size={52} />
        <div className="min-w-0">
          <p className="font-bold">{data.profile.full_name}</p>
          <p className="text-sm text-muted">{[data.profile.branch, data.profile.grad_year].filter(Boolean).join(' ')}</p>
        </div>
      </div>
      <p className="mt-2 text-[15px] font-semibold">{data.headline}</p>
      {data.story && <p className="mt-1 line-clamp-3 text-sm text-muted">{data.story}</p>}
    </Link>
  )
}

/** The three newest openings, so jobs are visible from Home without hunting for them. */
function LatestJobs() {
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
    <section aria-label="Latest jobs">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">Latest jobs</h2>
        <Link to="/jobs" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
          See all
        </Link>
      </div>
      <ul className="space-y-2">
        {data.map((j) => (
          <li key={j.id}>
            <Link to={`/jobs/${j.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:bg-surface-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden>
                <BriefcaseBusiness className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{j.title}</span>
                <span className="block truncate text-sm text-muted">
                  {j.company} · {j.poster_name}
                  {j.can_refer ? ' · can refer' : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
