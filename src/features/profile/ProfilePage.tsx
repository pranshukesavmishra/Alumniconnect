import { BadgeCheck, Briefcase, Globe, GraduationCap, Lightbulb, MapPin, Pencil, ShieldAlert, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Avatar, Card, EmptyState, Notice, SectionHeader } from '../../components/ui/Display'
import { SkeletonProfile } from '../../components/ui/Skeleton'
import { LinkedInIcon } from '../../components/ui/Icons'
import { BentoCard, BentoGrid } from '../../components/ui/Fx'
import { NumberTicker } from '../../components/ui/Motion'
import { IconTile } from '../../components/ui/IconTile'
import { friendlyError } from '../../lib/errors'
import { shortBranch } from '../../lib/constants'
import type { Profile } from '../../lib/types'
import { useMyProfile, useUserId } from '../auth/AuthProvider'
import { TripChips } from '../location/TripChips'
import { useMember } from './queries'
import { SocialLinks } from './SocialLinks'
import { useMySocialLinks } from './socialQueries'
import { profileCompleteness } from '../home/HomePage'
import { ProfileActions } from '../community/ProfileActions'
import { useT, type MsgKey } from '../../i18n'
import { MyStoriesPanel, ProfileHighlights } from '../stories/Highlights'
import { StoryComposer } from '../stories/StoryComposer'
import { StoryAvatar } from '../stories/StoryRing'
import { useStoryRing } from '../stories/api'
import { BadgesStrip, CareerTimeline, EducationList, MetaChip, MutualConnections, ProfileCover, useProfileStats } from './ProfileParts'
import { MeSettings, ProfileStrengthCard } from './MeSettings'

/** The same checks as profileCompleteness(), listed so the Me page can show every next step. */
function strengthSteps(p: Profile): { label: MsgKey; to: string; done: boolean }[] {
  return [
    { label: 'home.stepPhoto', to: '/me/edit', done: !!p.avatar_url },
    { label: 'home.stepRole', to: '/me/import', done: !!p.headline || !!p.current_title },
    { label: 'home.stepAbout', to: '/me/edit', done: !!p.about },
    { label: 'home.stepSkills', to: '/me/import', done: p.skills.length > 0 },
    { label: 'home.stepHelp', to: '/me/edit', done: p.help_tags.length > 0 },
    { label: 'home.stepLinkedin', to: '/me/edit', done: !!p.linkedin_url },
  ]
}

function ProfileAvatar({ p }: { p: Profile }) {
  const { data: ring } = useStoryRing(p.id)
  return (
    <span className="relative inline-grid rounded-full bg-bg p-1 shadow-e3">
      {ring ? (
        <StoryAvatar userId={p.id} name={p.full_name} src={p.avatar_url} size={112} />
      ) : (
        <Avatar name={p.full_name} src={p.avatar_url} size={112} ring={p.verification === 'verified' ? 'verified' : 'seen'} />
      )}
    </span>
  )
}

function Stat({ value, label, to, capped }: { value: number | null; label: string; to?: string; capped?: boolean }) {
  const body = (
    <>
      <span className="text-stat block text-[28px] leading-none">
        {value === null ? <span className="text-muted">–</span> : <NumberTicker value={value} />}
        {capped && <span className="text-gold-ink">+</span>}
      </span>
      <span className="text-caption mt-1.5 block font-semibold text-muted">{label}</span>
    </>
  )
  const cls = 'fx-press flex min-h-16 flex-1 flex-col items-center justify-center rounded-2xl px-1 py-2 text-center'
  return to ? <Link to={to} className={`${cls} hover:bg-surface-2`}>{body}</Link> : <div className={cls}>{body}</div>
}

export function ProfilePage({ self }: { self?: boolean }) {
  const tx = useT()
  const params = useParams()
  const uid = useUserId()
  const id = self ? (uid ?? undefined) : params.id
  const isMe = id === uid
  const { data, isLoading, error } = useMember(id)
  const { data: me } = useMyProfile()
  const { data: mySocial } = useMySocialLinks()
  const stats = useProfileStats(data ? id : undefined)
  const { hash } = useLocation()
  const [composer, setComposer] = useState(false)
  useEffect(() => {
    if (!hash) return
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [hash, data])

  if (isLoading)
    return (
      <div>
        <div className="mx-auto h-44 max-w-3xl animate-pulse bg-surface-2 md:mt-4 md:rounded-[32px]" />
        <Page>
          <SkeletonProfile />
        </Page>
      </div>
    )
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
  const comp = profileCompleteness(p, !!(mySocial?.instagram_url || mySocial?.facebook_url))
  const role = p.current_title && p.current_company ? tx('pp.roleAt', { title: p.current_title, company: p.current_company }) : p.current_title || p.headline
  const subline = p.headline && role && role.toLowerCase() !== p.headline.toLowerCase() && !role.toLowerCase().startsWith(p.headline.toLowerCase()) ? p.headline : null
  const place = [p.city, p.country !== 'India' ? p.country : null].filter(Boolean).join(', ')
  const verified = p.verification === 'verified'
  const website = p.website_url && /^https?:\/\//i.test(p.website_url) ? p.website_url : null
  const linkPill =
    'fx-press inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[15px] font-semibold text-primary shadow-e1 hover:bg-primary-soft'

  return (
    <div>
      {!isMe && <PageHeader title={p.full_name} back="/people" />}
      <div className="mx-auto max-w-3xl md:px-4 md:pt-4">
        <ProfileCover year={p.grad_year} branch={p.branch} className="h-40 sm:h-52 md:rounded-[32px]">
          <div className="flex justify-end p-4">
            {p.grad_year && (
              <span className="fx-liquid-dark inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold">
                <GraduationCap className="size-3.5 text-accent" aria-hidden />
                {tx('pp.classOf', { year: p.grad_year })}
              </span>
            )}
          </div>
        </ProfileCover>
      </div>

      <Page className="relative -mt-16 space-y-8 pt-0 md:px-8">
        <section aria-label={tx('pp.profileOf', { name: p.full_name })} className="space-y-4">
          <ProfileAvatar p={p} />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="font-display text-[30px] font-semibold leading-[1.1] tracking-tight sm:text-[36px]">{p.full_name}</h1>
              {verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary" title={tx('pp.verifiedHint')}>
                  <BadgeCheck className="size-4" fill="currentColor" stroke="var(--surface)" aria-hidden />
                  {tx('pp.verified')}
                </span>
              )}
            </div>
            {role && <p className="text-body-lg mt-1.5 font-medium">{role}</p>}
            {subline && <p className="text-body mt-0.5 text-muted">{subline}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {p.grad_year && <MetaChip icon={<GraduationCap />}>{tx('common.batch', { year: p.grad_year })}</MetaChip>}
            {p.branch && <MetaChip icon={<Lightbulb />}>{shortBranch(p.branch)}</MetaChip>}
            {place && <MetaChip icon={<MapPin />}>{place}</MetaChip>}
          </div>
          {!isMe && <MutualConnections otherId={p.id} />}

          {isMe ? (
            <div className="flex gap-2">
              <ButtonLink to="/me/edit" className="flex-1" icon={<Pencil className="size-4" />}>
                {tx('profile.edit')}
              </ButtonLink>
              <ButtonLink to="/me/import" variant="secondary" aria-label={tx('home.importLinkedin')} icon={<LinkedInIcon className="size-4" />}>
                LinkedIn
              </ButtonLink>
            </div>
          ) : (
            <ProfileActions profile={p} />
          )}

          {(website || (!isMe && p.linkedin_url)) && (
            <div className="flex flex-wrap gap-2">
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={linkPill}>
                  <Globe className="size-4" aria-hidden /> {new URL(website).hostname.replace(/^www\./, '')}
                </a>
              )}
              {!isMe && p.linkedin_url && (
                <a href={p.linkedin_url} target="_blank" rel="noreferrer" className={linkPill}>
                  <LinkedInIcon className="size-4" /> View on LinkedIn
                </a>
              )}
            </div>
          )}
          <SocialLinks userId={p.id} name={p.full_name} />
        </section>

        <BentoGrid>
          {isMe && (
            <BentoCard cols={2} tone="hero" className="p-5">
              <ProfileStrengthCard percent={comp.percent} steps={strengthSteps(p)} />
            </BentoCard>
          )}
          <BentoCard cols={2} className="flex items-stretch gap-1 p-2" data-testid="profile-stats">
            <Stat value={stats.connections} capped={stats.connectionsCapped} label={tx('pp.stat.connections')} to={isMe ? '/me/connections' : undefined} />
            <span aria-hidden className="my-3 w-px bg-border" />
            <Stat value={stats.groups} label={tx('pp.stat.groups')} to={isMe ? '/groups' : undefined} />
            <span aria-hidden className="my-3 w-px bg-border" />
            <Stat value={stats.badges} label={tx('pp.stat.badges')} to={isMe ? '/me/badges' : undefined} />
          </BentoCard>
        </BentoGrid>

        <BadgesStrip userId={p.id} isMe={isMe} />

        <ProfileHighlights userId={p.id} isMe={isMe} />

        {isMe && <MyStoriesPanel onAdd={() => setComposer(true)} />}
        {isMe && <StoryComposer open={composer} onClose={() => setComposer(false)} />}

        <TripChips userId={p.id} isMe={isMe} />

        {isMe && !verified && (
          <Notice tone="info" title={tx('profile.unverified')}>
            {tx('profile.unverifiedBody')}
          </Notice>
        )}

        {p.about && (
          <section>
            <SectionHeader eyebrow={isMe ? undefined : tx('pp.inTheirWords')} title={tx('pp.about')} />
            <Card variant="gradient-border" className="text-body-lg whitespace-pre-line p-5 leading-relaxed">{p.about}</Card>
          </section>
        )}

        {experiences.length > 0 && (
          <section>
            <SectionHeader eyebrow={tx('pp.career')} title="Experience" />
            <Card className="p-5">
              <CareerTimeline items={experiences} />
            </Card>
          </section>
        )}

        {educations.length > 0 && (
          <section>
            <SectionHeader title={tx('pp.education')} />
            <Card className="p-5">
              <EducationList items={educations} />
            </Card>
          </section>
        )}

        {(p.help_tags.length > 0 || p.skills.length > 0) && (
          <section className="space-y-5">
            {p.help_tags.length > 0 && (
              <div>
                <SectionHeader eyebrow={tx('pp.forJuniors')} title={tx('pp.canHelp')} />
                <div className="flex flex-wrap gap-2">
                  {p.help_tags.map((t) => (
                    <span key={t} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3.5 text-sm font-semibold text-gold-ink">
                      <Sparkles className="size-3.5" aria-hidden />
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {p.skills.length > 0 && (
              <div>
                <SectionHeader title={tx('pp.skills')} />
                <div className="flex flex-wrap gap-2">
                  {p.skills.map((s) => (
                    <span key={s} className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3.5 text-sm font-semibold shadow-e1">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {isMe && experiences.length === 0 && !p.about && (
          <Card variant="gradient-border" className="flex flex-col items-center p-6 text-center">
            <IconTile icon={Briefcase} tone="ink" variant="solid" size="lg" />
            <p className="text-title mt-3">Fill your profile in 30 seconds</p>
            <p className="text-body mt-1 text-muted">Import your experience, education and skills from LinkedIn, then review before saving.</p>
            <ButtonLink to="/me/import" className="mt-4" icon={<LinkedInIcon className="size-4" />}>
              Import from LinkedIn
            </ButtonLink>
          </Card>
        )}

        {!isMe && experiences.length === 0 && !p.about && p.skills.length === 0 && (
          <EmptyState compact icon={<Users />} title={tx('pp.sparse', { name: p.full_name.split(' ')[0]! })} />
        )}

        {isMe && <MeSettings profile={p} />}
      </Page>
    </div>
  )
}
