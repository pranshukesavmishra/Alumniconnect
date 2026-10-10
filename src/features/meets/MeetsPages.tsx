import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, CalendarHeart, ImagePlus, MapPin, Pencil, Play, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Badge, EmptyState, Notice, PageSkeleton, SectionTitle, Skeleton } from '../../components/ui/Display'
import { ButtonLink } from '../../components/ui/Button'
import { useLang, useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useAdminAccess } from '../admin/access'
import { useAuth } from '../auth/AuthProvider'
import { glimpseCaption, glimpsePoster, useLiveGlimpses, type Glimpse } from '../glimpses/api'
import { GlimpseViewer } from '../glimpses/GlimpseCarousel'
import { fetchPhotos, isVideo, photoQueryKey, thumbUrl, usePhotoCaps, type PhotoRow } from '../photos/api'
import { PhotoLightbox } from '../photos/PhotoLightbox'
import { formatDuration } from '../photos/video'
import { groupByYear, meetCover, meetDescription, meetHighlights, meetTitle, useMeetEvent, usePastMeet, usePastMeets, type PastMeet } from './api'

function Facts({ m }: { m: PastMeet }) {
  const tx = useT()
  const facts = [
    m.held_on ? { icon: CalendarDays, text: formatDate(m.held_on) } : null,
    m.venue ? { icon: MapPin, text: m.venue } : null,
    m.attendance ? { icon: Users, text: tx('meets.attended', { count: m.attendance }) } : null,
  ].filter((f): f is { icon: typeof CalendarDays; text: string } => !!f)
  if (!facts.length) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {facts.map((f) => (
        <li key={f.text} className="inline-flex items-center gap-1.5"><f.icon className="size-4 shrink-0" aria-hidden />{f.text}</li>
      ))}
    </ul>
  )
}

/** /meets: the earlier alumni meets, newest year first. Open to everyone. */
export function MeetsPage() {
  const tx = useT()
  const { lang } = useLang()
  const { data, isLoading, error } = usePastMeets()
  const { can } = useAdminAccess()
  const groups = groupByYear(data ?? [])
  return (
    <div>
      <PageHeader
        title={tx('meets.title')}
        subtitle={tx('meets.subtitle')}
        back="/meet"
        action={can('gallery_manage') ? <ButtonLink size="sm" variant="secondary" to="/admin/content?tab=meets" icon={<Pencil className="size-4" />}>{tx('meets.manage')}</ButtonLink> : undefined}
      />
      <Page className="space-y-6">
        {error && <Notice tone="danger" title={friendlyError(error)} />}
        {isLoading ? (
          <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-3xl" />)}</div>
        ) : groups.length === 0 ? (
          <EmptyState icon={<CalendarHeart />} title={tx('meets.empty')}>{tx('meets.emptyBody')}</EmptyState>
        ) : (
          groups.map(([year, meets]) => (
            <section key={year} aria-label={String(year)} className="space-y-3" data-testid={`meets-year-${year}`}>
              <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{year}</h2>
              <ul className="space-y-3">
                {meets.map((m) => {
                  const cover = meetCover(m)
                  return (
                    <li key={m.id}>
                      <Link to={`/meets/${m.slug}`} className="block overflow-hidden rounded-3xl border border-border bg-surface hover:border-primary/40" data-testid="meet-card">
                        {cover ? <img src={cover} alt="" loading="lazy" className="aspect-[16/7] w-full object-cover" /> : <div aria-hidden className="grid aspect-[16/5] place-items-center bg-gradient-to-br from-hero to-hero-2 text-white/80"><CalendarHeart className="size-9" /></div>}
                        <div className="space-y-1.5 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-lg font-bold leading-tight">{meetTitle(m, lang)}</p>
                            {!m.is_published && <Badge tone="warning">{tx('meets.draft')}</Badge>}
                          </div>
                          <Facts m={m} />
                          {meetHighlights(m, lang) && <p className="line-clamp-2 text-[15px] text-muted">{meetHighlights(m, lang)}</p>}
                          <p className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-primary">{tx('meets.open')}<ArrowRight className="size-4" aria-hidden /></p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </Page>
    </div>
  )
}

function GlimpsesOfMeet({ meetId }: { meetId: string }) {
  const tx = useT()
  const { lang } = useLang()
  const { data } = useLiveGlimpses(meetId)
  const [open, setOpen] = useState<Glimpse | null>(null)
  if (!data.length) return null
  return (
    <section aria-label={tx('meets.glimpses')} className="space-y-2">
      <SectionTitle>{tx('meets.glimpses')}</SectionTitle>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {data.map((g) => (
          <li key={g.id} className="w-64 shrink-0">
            <button type="button" onClick={() => setOpen(g)} className="relative block aspect-video w-full overflow-hidden rounded-2xl bg-surface-2" aria-label={tx('glimpse.play', { caption: glimpseCaption(g, lang) ?? tx('glimpse.title') })} data-testid="meet-glimpse">
              <img src={glimpsePoster(g)} alt="" loading="lazy" className="size-full object-cover" />
              <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-black/55 text-white"><Play className="size-5 fill-current" aria-hidden /></span></span>
            </button>
          </li>
        ))}
      </ul>
      {open && <GlimpseViewer glimpse={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** The photos and videos of one meet: a preview of the archive event's photo area, opened in place. Verified members only. */
function MeetMedia({ m }: { m: PastMeet }) {
  const tx = useT()
  const qc = useQueryClient()
  const { session } = useAuth()
  const event = useMeetEvent(m.event_id)
  const caps = usePhotoCaps(event.data?.id)
  const [open, setOpen] = useState<number | null>(null)
  const list = useQuery({
    queryKey: [...photoQueryKey(event.data?.id), 'meet-preview'],
    enabled: !!event.data && !!caps.data?.view,
    queryFn: () => fetchPhotos(event.data!.id, { scope: 'approved' }, 0, 12),
  })
  if (!m.event_id) return null
  if (!session) {
    return (
      <Notice tone="info" title={tx('meets.mediaSignIn')}>
        <Link to={`/signin?next=${encodeURIComponent(`/meets/${m.slug}`)}`} className="font-semibold text-primary">{tx('home.signInOrJoin')}</Link>
      </Notice>
    )
  }
  if (event.isLoading || caps.isLoading) return <Skeleton className="h-32 rounded-2xl" />
  if (!event.data) return null
  if (caps.data && !caps.data.view) return <Notice tone="info" title={tx('photos.verifyTitle')}>{tx('photos.verifyBody')}</Notice>
  const photos: PhotoRow[] = list.data ?? []
  const base = `/events/${event.data.slug}/photos`
  const canAdd = !!caps.data && (caps.data.official || caps.data.member_uploads !== 'off')
  return (
    <section aria-label={tx('meets.media')} className="space-y-2" data-testid="meet-media">
      <SectionTitle action={<Link to={base} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">{tx('home.seeAll')}</Link>}>{tx('meets.media')}</SectionTitle>
      {list.isLoading ? (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div>
      ) : photos.length === 0 ? (
        <p className="text-sm text-muted">{tx('meets.mediaEmpty')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4" data-testid="meet-media-grid">
          {photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setOpen(i)} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2" aria-label={p.caption ?? tx('photos.photoN', { n: p.id.slice(0, 4) })}>
              <img src={thumbUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
              {isVideo(p) && <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-xs font-semibold text-white"><Play className="size-3 fill-current" aria-hidden />{formatDuration(p.duration_ms)}</span>}
            </button>
          ))}
        </div>
      )}
      {canAdd && (
        <ButtonLink to={`${base}/upload`} variant="secondary" size="sm" icon={<ImagePlus className="size-4" />}>{tx('meets.addYours')}</ButtonLink>
      )}
      {!canAdd && <p className="text-sm text-muted">{tx('meets.teamOnly')}</p>}
      {open !== null && photos[open] && (
        <PhotoLightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} caps={caps.data} onChanged={() => void qc.invalidateQueries({ queryKey: photoQueryKey(event.data?.id) })} />
      )}
    </section>
  )
}

/** /meets/:slug: the story of one meet, its glimpses, and its photos and videos. */
export function MeetDetailPage() {
  const tx = useT()
  const { lang } = useLang()
  const { slug } = useParams()
  const { data: m, isLoading, error } = usePastMeet(slug)
  const { can } = useAdminAccess()
  if (isLoading) return <PageSkeleton />
  if (error) return <Page><Notice tone="danger" title={friendlyError(error)} /></Page>
  if (!m) return <div><PageHeader title={tx('meets.title')} back="/meets" /><Page><EmptyState title={tx('meets.notFound')}>{tx('meets.notFoundBody')}</EmptyState></Page></div>
  const cover = meetCover(m)
  const description = meetDescription(m, lang)
  const highlights = meetHighlights(m, lang)
  return (
    <div>
      <PageHeader
        title={meetTitle(m, lang)}
        subtitle={String(m.year)}
        back="/meets"
        action={can('gallery_manage') ? <ButtonLink size="sm" variant="secondary" to={`/admin/content?tab=meets&edit=${m.id}`} icon={<Pencil className="size-4" />}>{tx('common.edit')}</ButtonLink> : undefined}
      />
      <Page className="space-y-5">
        {!m.is_published && <Notice tone="warning" title={tx('meets.draftNote')} />}
        {cover && <img src={cover} alt="" className="aspect-[16/8] w-full rounded-3xl object-cover" />}
        <Facts m={m} />
        {description && <p className="whitespace-pre-line text-[16px] leading-relaxed" data-testid="meet-description">{description}</p>}
        {highlights && (
          <section aria-label={tx('meets.highlights')} className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('meets.highlights')}</h2>
            <p className="whitespace-pre-line text-[15px]">{highlights}</p>
          </section>
        )}
        <GlimpsesOfMeet meetId={m.id} />
        <MeetMedia m={m} />
        {!description && !highlights && !cover && <p className="text-sm text-muted">{tx('meets.comingSoon')}</p>}
        <p className="text-center text-sm"><Link to="/meets" className="font-semibold text-primary">{tx('meets.allMeets')}</Link></p>
      </Page>
    </div>
  )
}
