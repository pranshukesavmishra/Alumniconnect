import { BadgeCheck, Briefcase, Globe, GraduationCap, LogOut, MapPin, Pencil, ShieldAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Avatar, Badge, Card, EmptyState, Notice, PageSkeleton, SectionTitle } from '../../components/ui/Display'
import { LinkedInIcon } from '../../components/ui/Icons'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import type { Education, Experience } from '../../lib/types'
import { signOut, useMyProfile, useUserId } from '../auth/AuthProvider'
import { DownloadMyData } from './DownloadMyData'
import { useMember } from './queries'
import { BadgesRow, ProfileActions } from '../community/ProfileActions'
import { useIsOrganiser } from '../../components/layout/AppShell'
import { useT } from '../../i18n'
import { LanguageSwitch } from '../../i18n/LanguageSwitch'

function period(e: Experience) {
  const from = e.start_date ? formatDate(e.start_date, { month: 'short', year: 'numeric' }) : ''
  const to = e.is_current ? 'Present' : e.end_date ? formatDate(e.end_date, { month: 'short', year: 'numeric' }) : ''
  return [from, to].filter(Boolean).join(' – ')
}

function ExperienceItem({ e }: { e: Experience }) {
  return (
    <li className="flex gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
        <Briefcase className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{e.title}</p>
        <p className="text-[15px]">{e.company}</p>
        <p className="text-sm text-muted">{[period(e), e.location].filter(Boolean).join(' · ')}</p>
        {e.description && <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm text-muted">{e.description}</p>}
      </div>
    </li>
  )
}

function EducationItem({ e }: { e: Education }) {
  return (
    <li className="flex gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{e.school}</p>
        <p className="text-[15px]">{[e.degree, e.field].filter(Boolean).join(', ')}</p>
        {(e.start_year || e.end_year) && <p className="text-sm text-muted">{[e.start_year, e.end_year].filter(Boolean).join(' – ')}</p>}
      </div>
    </li>
  )
}

export function ProfilePage({ self }: { self?: boolean }) {
  const tx = useT()
  const params = useParams()
  const uid = useUserId()
  const id = self ? (uid ?? undefined) : params.id
  const isMe = id === uid
  const { data, isLoading, error } = useMember(id)
  const { data: me } = useMyProfile()
  const navigate = useNavigate()
  const organiser = useIsOrganiser()

  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!data) {
    return (
      <div>
        <PageHeader title="Profile" back="/people" />
        <EmptyState icon={<ShieldAlert />} title="Profile not available">
          {me?.verification !== 'verified' ? 'Profiles are visible to verified JEC members. You’ll be verified once your Alumni Meet payment is confirmed, or by an admin.' : 'This member may have left.'}
        </EmptyState>
      </div>
    )
  }

  const { profile: p, experiences, educations } = data
  const role = p.current_title && p.current_company ? `${p.current_title} at ${p.current_company}` : p.headline
  return (
    <div>
      {!isMe && <PageHeader title={p.full_name} back="/people" />}
      <div className="h-24 bg-gradient-to-r from-hero to-hero-2 sm:h-32" aria-hidden />
      <Page className="-mt-14 space-y-6 pt-0">
        <section>
          <Avatar src={p.avatar_url} name={p.full_name} size={104} className="border-4 border-bg" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{p.full_name}</h1>
            {p.verification === 'verified' && (
              <Badge tone="success">
                <BadgeCheck className="size-3.5" aria-hidden /> Verified
              </Badge>
            )}
          </div>
          {role && <p className="mt-1 text-[17px]">{role}</p>}
          <p className="mt-1 text-[15px] text-muted">
            {[p.branch, p.grad_year && tx('common.batch', { year: p.grad_year })].filter(Boolean).join(' · ')}
          </p>
          {p.city && (
            <p className="mt-0.5 flex items-center gap-1 text-[15px] text-muted">
              <MapPin className="size-4" aria-hidden /> {[p.city, p.country !== 'India' ? p.country : null].filter(Boolean).join(', ')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {isMe ? (
              <>
                <ButtonLink to="/me/edit" icon={<Pencil className="size-4" />}>
                  {tx('profile.edit')}
                </ButtonLink>
                <ButtonLink to="/me/import" variant="secondary" icon={<LinkedInIcon className="size-4" />}>
                  {tx('home.importLinkedin')}
                </ButtonLink>
              </>
            ) : (
              <ProfileActions profile={p} />
            )}
            {p.website_url && /^https?:\/\//i.test(p.website_url) && (
              <a
                href={p.website_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 font-semibold text-primary hover:bg-primary-soft"
              >
                <Globe className="size-4" aria-hidden /> {new URL(p.website_url).hostname.replace(/^www\./, '')}
              </a>
            )}
            {!isMe && (
              p.linkedin_url && (
                <a
                  href={p.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 font-semibold text-primary hover:bg-primary-soft"
                >
                  <LinkedInIcon className="size-4" /> View on LinkedIn
                </a>
              )
            )}
          </div>
        </section>

        <BadgesRow memberId={p.id} />

        {isMe && (
          <nav className="grid gap-2 sm:grid-cols-2" aria-label={tx('profile.shortcuts')}>
            {[
              { to: '/me/connections', label: tx('profile.connections'), hint: tx('profile.connectionsHint'), icon: '🤝' },
              { to: '/help', label: tx('profile.askJec'), hint: tx('profile.askJecHint'), icon: '🤝' },
              { to: '/jobs', label: tx('profile.jobs'), hint: tx('profile.jobsHint'), icon: '💼' },
              { to: '/invite', label: tx('profile.invite'), hint: tx('profile.inviteHint'), icon: '💌' },
              { to: '/people', label: tx('home.findJecians'), hint: tx('profile.findHint'), icon: '🔎' },
              { to: '/notifications', label: tx('notif.title'), hint: tx('profile.notifHint'), icon: '🔔' },
              ...(organiser ? [{ to: '/admin', label: tx('nav.organise'), hint: tx('profile.organiseHint'), icon: '🛡️' }] : []),
            ].map((l) => (
              <Link key={l.to} to={l.to} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:border-primary/40">
                <span className="text-2xl" aria-hidden>{l.icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold">{l.label}</span>
                  <span className="block truncate text-sm text-muted">{l.hint}</span>
                </span>
              </Link>
            ))}
          </nav>
        )}

        {isMe && p.verification !== 'verified' && (
          <Notice tone="info" title={tx('profile.unverified')}>
            {tx('profile.unverifiedBody')}
          </Notice>
        )}

        {p.help_tags.length > 0 && (
          <section>
            <SectionTitle>Can help with</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {p.help_tags.map((t) => (
                <Badge key={t} tone="accent" className="px-3 py-1 text-sm">
                  {t}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {p.about && (
          <section>
            <SectionTitle>About</SectionTitle>
            <Card className="whitespace-pre-line p-4 text-[15px] leading-relaxed">{p.about}</Card>
          </section>
        )}

        {experiences.length > 0 && (
          <section>
            <SectionTitle>Experience</SectionTitle>
            <Card>
              <ul className="divide-y divide-border">
                {experiences.map((e) => (
                  <ExperienceItem key={e.id} e={e} />
                ))}
              </ul>
            </Card>
          </section>
        )}

        {educations.length > 0 && (
          <section>
            <SectionTitle>Education</SectionTitle>
            <Card>
              <ul className="divide-y divide-border">
                {educations.map((e) => (
                  <EducationItem key={e.id} e={e} />
                ))}
              </ul>
            </Card>
          </section>
        )}

        {p.skills.length > 0 && (
          <section>
            <SectionTitle>Skills</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {p.skills.map((s) => (
                <Badge key={s} tone="neutral" className="px-3 py-1 text-sm">
                  {s}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {isMe && experiences.length === 0 && !p.about && (
          <Card className="p-5 text-center">
            <p className="font-semibold">Fill your profile in 30 seconds</p>
            <p className="mt-1 text-[15px] text-muted">Import your experience, education and skills from LinkedIn, then review before saving.</p>
            <ButtonLink to="/me/import" className="mt-4" icon={<LinkedInIcon className="size-4" />}>
              Import from LinkedIn
            </ButtonLink>
          </Card>
        )}

        {isMe && (
          <section aria-labelledby="lang-title">
            <SectionTitle><span id="lang-title">भाषा / Language</span></SectionTitle>
            <LanguageSwitch />
          </section>
        )}

        {isMe && (
          <section className="pt-2">
            <DownloadMyData />
          </section>
        )}

        {isMe && (
          <section className="pt-2">
            <Button
              variant="danger-ghost"
              icon={<LogOut className="size-4" />}
              onClick={async () => {
                await signOut()
                navigate('/', { replace: true })
              }}
            >
              {tx('profile.signOut')}
            </Button>
          </section>
        )}
      </Page>
    </div>
  )
}
