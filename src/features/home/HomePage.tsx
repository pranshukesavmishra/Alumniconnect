import { ArrowRight, CalendarHeart, Camera, Search, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Page } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Avatar, Card, PageSkeleton } from '../../components/ui/Display'
import { LinkedInIcon } from '../../components/ui/Icons'
import { MEET_SLUG } from '../../lib/constants'
import { daysUntil, formatDateRange } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { useAuth, useMyProfile } from '../auth/AuthProvider'
import { useEvent, useMyRegistration } from '../events/queries'
import { StatusBadge } from '../events/StatusBadge'

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
    <div className="min-h-dvh bg-[#0c1e45] text-white">
      <div className="relative mx-auto max-w-3xl overflow-hidden px-5 pb-16 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <div aria-hidden className="absolute -right-32 -top-24 size-96 rounded-full bg-[#14306B]" />
        <div className="relative">
          <img src="/pwa-192.png" alt="" className="size-14 rounded-2xl" />
          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">Every JECian, one tap away.</h1>
          <p className="mt-4 max-w-xl text-lg text-[#C9D4EA]">
            For everyone who studied at Jabalpur Engineering College, the oldest technical institution in Central India (est. 1947). Find your batch, see where everyone is today, and register for the Alumni Meet 2026.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row [&_a:first-child]:bg-white [&_a:first-child]:text-[#14306B]">
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
  const { data: mine } = useMyRegistration(event?.id)

  if (loading || (session && isLoading)) return <PageSkeleton />
  if (!session || !profile) return <Landing />

  const first = profile.full_name.split(' ')[0] || 'there'
  const comp = profileCompleteness(profile)
  const days = daysUntil(event?.starts_at ?? null)
  const reg = mine?.registration && mine.registration.status !== 'cancelled' ? mine.registration : null

  return (
    <Page className="space-y-6 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
      <header className="flex items-center gap-3">
        <Avatar src={profile.avatar_url} name={profile.full_name} size={48} />
        <div className="min-w-0">
          <p className="text-sm text-muted">{greeting()},</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{first}</h1>
        </div>
      </header>

      {event && (
        <Link to={reg ? '/meet/my' : '/meet'} className="block overflow-hidden rounded-2xl bg-[#0c1e45] text-white">
          <div className="relative p-5">
            <div aria-hidden className="absolute -right-10 -top-14 size-40 rounded-full bg-[#14306B]" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F2A33A]">
                  <CalendarHeart className="size-4" aria-hidden /> {days ? `In ${days} days` : 'Alumni Meet'}
                </span>
                {reg && <StatusBadge status={reg.status} />}
              </div>
              <p className="mt-2 text-xl font-bold">{event.title}</p>
              <p className="text-sm text-[#C9D4EA]">{formatDateRange(event.starts_at, event.ends_at)}</p>
              <p className="mt-4 inline-flex items-center gap-1 font-semibold">
                {reg ? (reg.status === 'confirmed' ? 'View your entry pass' : reg.status === 'pending_payment' ? 'Complete your payment' : 'See your registration') : 'Register now'}
                <ArrowRight className="size-4" aria-hidden />
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

      <section className="grid gap-3 sm:grid-cols-2">
        <QuickAction to="/people" icon={<Search className="size-5" />} title="Find JECians" text="Search by name, batch, company or city" />
        <QuickAction to="/me/import" icon={<LinkedInIcon />} title="Import from LinkedIn" text="Fill your profile in 30 seconds" />
        <QuickAction to="/meet/photos" icon={<Camera className="size-5" />} title="Share old photos" text="For the “Then and Now” slideshow" />
      </section>
    </Page>
  )
}
