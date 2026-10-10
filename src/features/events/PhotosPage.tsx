import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BadgeCheck, Check, CheckSquare, Clock, EyeOff, Heart, ImagePlus, Images, Play, Settings2, Stamp, Trash2, UserSearch, Vote } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, ButtonLink } from '../../components/ui/Button'
import { EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { Field, Input, Select } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { MEET_SLUG } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useT } from '../../i18n'
import { formatDuration } from '../photos/video'
import { fetchPhotos, isVideo, photoError, photoQueryKey, thumbUrl, usePhotoCaps, usePhotoPages, type PhotoFilter, type PhotoRow, type PhotoScope } from '../photos/api'
import { GalleryAddSheet } from '../photos/PhotoSheets'
import { PhotoAdminPanel } from '../photos/PhotoAdminPanel'
import { PhotoLightbox } from '../photos/PhotoLightbox'
import { PhotoUpload } from '../photos/PhotoUpload'
import { PhotoVoteCard } from '../photos/PhotoVoteCard'
import { useEvent } from './queries'

type Source = 'all' | 'official' | 'member'
const SCOPES: PhotoScope[] = ['approved', 'tagged', 'mine', 'pending', 'hidden', 'reported']

function Thumb({ p, selecting, order, onOpen }: { p: PhotoRow; selecting: boolean; order: number; onOpen: () => void }) {
  const tx = useT()
  return (
    <button type="button" className={clsx('relative aspect-square overflow-hidden rounded-lg bg-surface-2', order > 0 && 'ring-4 ring-primary')} onClick={onOpen} aria-label={p.caption ?? p.alt_text ?? tx('photos.photoN', { n: p.id.slice(0, 4) })} aria-pressed={selecting ? order > 0 : undefined} data-photo-id={p.id}>
      <img src={thumbUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
      <span className="absolute left-1 top-1 flex gap-1">
        {p.source === 'official' && <span className="grid size-6 place-items-center rounded-full bg-primary text-on-primary" title={tx('photos.official')}><BadgeCheck className="size-4" aria-hidden /></span>}
        {p.status === 'pending' && <span className="grid size-6 place-items-center rounded-full bg-warning text-on-primary" title={tx('photos.pendingBadge')}><Clock className="size-4" aria-hidden /></span>}
        {p.is_hidden && <span className="grid size-6 place-items-center rounded-full bg-danger text-on-danger" title={tx('photos.hiddenBadge')}><EyeOff className="size-4" aria-hidden /></span>}
      </span>
      {isVideo(p) && (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-xs font-semibold text-white" data-testid="video-badge">
          <Play className="size-3 fill-current" aria-hidden />{formatDuration(p.duration_ms)}
        </span>
      )}
      {p.hearts > 0 && <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white"><Heart className="size-3 fill-current" aria-hidden />{p.hearts}</span>}
      {p.report_count > 0 && <span className="absolute left-1 top-8 rounded-full bg-danger px-1.5 py-0.5 text-xs font-bold text-on-danger">{p.report_count}</span>}
      {selecting && <span className={clsx('absolute right-1 top-1 grid size-7 place-items-center rounded-full border-2 text-xs font-bold', order > 0 ? 'border-primary bg-primary text-on-primary' : 'border-white bg-black/30 text-white')}>{order > 0 ? order : ''}</span>}
    </button>
  )
}

export function PhotosPage() {
  const tx = useT()
  const qc = useQueryClient()
  const { slug = MEET_SLUG } = useParams()
  const [sp, setSp] = useSearchParams()
  const { data: event, isLoading } = useEvent(slug)
  const caps = usePhotoCaps(event?.id)
  const scope = (SCOPES.includes(sp.get('view') as PhotoScope) ? sp.get('view') : 'approved') as PhotoScope
  const kind = sp.get('kind') === 'throwback' ? 'throwback' : 'event'
  const source = (['official', 'member'].includes(sp.get('source') ?? '') ? sp.get('source') : 'all') as Source
  const batch = Number(sp.get('batch')) || null
  const media = (['photo', 'video'].includes(sp.get('media') ?? '') ? sp.get('media') : null) as 'photo' | 'video' | null
  const [managing, setManaging] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [gallery, setGallery] = useState(false)
  const [voteSheet, setVoteSheet] = useState(false)
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    if (k !== 'photo') n.delete('photo')
    setSp(n, { replace: true })
  }

  const manager = !!caps.data?.official
  const filter: PhotoFilter = { scope, kind: scope === 'approved' || scope === 'tagged' || scope === 'mine' ? kind : null, source: source === 'all' ? null : source, media, batch }
  const photos = usePhotoPages(event?.id, filter, !!caps.data?.view)
  const list = useMemo(() => photos.data?.pages.flat() ?? [], [photos.data])
  const openId = sp.get('photo')
  const openIdx = openId ? list.findIndex((p) => p.id === openId) : -1
  const single = useQuery({
    queryKey: ['photo-one', event?.id, openId],
    enabled: !!event && !!openId && openIdx < 0 && !photos.isLoading && !!caps.data?.view,
    queryFn: async () => (await fetchPhotos(event!.id, { scope: 'approved' }, 0, 1, openId!))[0] ?? null,
  })
  const viewerList = openIdx >= 0 ? list : single.data ? [single.data] : []
  const viewerIdx = openIdx >= 0 ? openIdx : 0
  const closeViewer = () => {
    const n = new URLSearchParams(sp)
    n.delete('photo')
    setSp(n, { replace: true })
  }
  useEffect(() => setSel([]), [scope, kind, source, batch, media])

  if (isLoading || caps.isLoading) return <PageSkeleton />
  if (!event) return <EmptyState title={tx('photos.noEvent')} />
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: photoQueryKey(event.id) })
    void qc.invalidateQueries({ queryKey: ['photo-summary', event.id] })
  }
  const years = Array.from({ length: new Date().getFullYear() - 1979 }, (_, i) => new Date().getFullYear() - i)

  if (caps.data && !caps.data.view) {
    return (
      <div>
        <PageHeader title={tx('photos.title')} subtitle={event.title} back="/meet" />
        <Page><Notice tone="info" title={tx('photos.verifyTitle')}>{tx('photos.verifyBody')}</Notice></Page>
      </div>
    )
  }

  function toggle(p: PhotoRow) {
    setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))
  }

  async function bulk(action: 'approve' | 'hide' | 'unhide' | 'delete' | 'first') {
    if (!sel.length) return
    if (action === 'delete') {
      if (!window.confirm(tx('photos.confirmDeleteN', { count: sel.length }))) return
      const chosen = list.filter((p) => sel.includes(p.id))
      const { error } = await supabase.from('event_photos').delete().in('id', sel)
      if (error) return toast.error(photoError(error))
      void supabase.storage.from('event-photos').remove(chosen.filter((p) => !isVideo(p)).flatMap((p) => [p.storage_path, p.thumb_path]).concat(chosen.filter(isVideo).map((p) => p.thumb_path)))
      toast.success(tx('photos.deletedN', { count: chosen.length }))
    } else if (action === 'first') {
      const { error } = await supabase.rpc('admin_reorder_photos', { p_event: event!.id, p_ids: sel })
      if (error) return toast.error(photoError(error))
      toast.success(tx('photos.reordered'))
    } else {
      const { error } = await supabase.rpc('admin_review_photos', { p_event: event!.id, p_ids: sel, p_action: action })
      if (error) return toast.error(photoError(error))
      toast.success(tx(action === 'approve' ? 'photos.approvedN' : action === 'hide' ? 'photos.hiddenN' : 'photos.unhiddenN', { count: sel.length }))
    }
    setSel([])
    refresh()
  }

  const views: { id: PhotoScope; label: string; icon: typeof Images }[] = [
    { id: 'approved', label: tx('photos.viewAll'), icon: Images },
    { id: 'tagged', label: tx('photos.findMine'), icon: UserSearch },
    { id: 'mine', label: tx('photos.myUploads'), icon: ImagePlus },
    ...(manager ? [{ id: 'pending' as const, label: tx('photos.viewWaiting'), icon: Clock }, { id: 'hidden' as const, label: tx('photos.viewHidden'), icon: EyeOff }, { id: 'reported' as const, label: tx('photos.viewReported'), icon: Stamp }] : []),
  ]

  return (
    <div>
      <PageHeader
        title={tx('photos.title')}
        subtitle={event.title}
        back="/meet"
        action={<ButtonLink size="sm" to={`/events/${event.slug}/photos/upload`} icon={<ImagePlus className="size-4" />}>{tx('photos.addPhotos')}</ButtonLink>}
      />
      <Page className={clsx('space-y-4', selecting && 'pb-32')}>
        {caps.data && !manager && caps.data.member_uploads === 'approval' && <Notice tone="info">{tx('photos.memberApprovalNote')}</Notice>}
        {caps.data && !manager && caps.data.member_uploads === 'off' && <Notice tone="info">{tx('photos.uploadsOffNote')}</Notice>}
        <PhotoVoteCard eventId={event.id} manager={manager} />

        {manager && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<Settings2 className="size-4" />} aria-expanded={managing} onClick={() => setManaging(!managing)}>{tx('photos.manage')}</Button>
              <Button variant={selecting ? 'primary' : 'secondary'} size="sm" icon={<CheckSquare className="size-4" />} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSel([]) }}>{selecting ? tx('photos.doneSelecting') : tx('photos.select')}</Button>
            </div>
            {managing && caps.data && <PhotoAdminPanel event={event} caps={caps.data} onView={(s) => set('view', s)} />}
          </div>
        )}

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={tx('photos.views')}>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={scope === v.id} onClick={() => set('view', v.id === 'approved' ? null : v.id)} className={clsx('inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold', scope === v.id ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}>
              <v.icon className="size-4" aria-hidden />{v.label}
            </button>
          ))}
        </div>

        {(scope === 'approved' || scope === 'tagged' || scope === 'mine') && (
          <>
            <div role="tablist" aria-label={tx('photos.kindLabel')} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
              {([['event', tx('photos.kindEvent')], ['throwback', tx('photos.kindThen')]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={kind === k} onClick={() => set('kind', k === 'event' ? null : k)} className={clsx('min-h-10 rounded-full text-sm font-semibold', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{label}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tx('photos.mediaFilter')}>
              {([[null, tx('photos.mediaAll')], ['photo', tx('photos.mediaPhotos')], ['video', tx('photos.mediaVideos')]] as const).map(([m, label]) => (
                <button key={m ?? 'all'} type="button" aria-pressed={media === m} onClick={() => set('media', m)} className={clsx('min-h-11 rounded-full border px-4 text-sm font-semibold', media === m ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}>{label}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'official', 'member'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={source === s} onClick={() => set('source', s === 'all' ? null : s)} className={clsx('min-h-11 rounded-full border px-4 text-sm font-semibold', source === s ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted')}>
                  {s === 'all' ? tx('photos.sourceAll') : s === 'official' ? tx('photos.official') : tx('photos.fromMembers')}
                </button>
              ))}
              <div className="min-w-36 flex-1">
                <Field label={tx('photos.batchFilter')}>
                  {(p) => (
                    <Select {...p} value={batch ? String(batch) : ''} onChange={(e) => set('batch', e.target.value || null)}>
                      <option value="">{tx('photos.allBatches')}</option>
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
            </div>
          </>
        )}

        {photos.error && <Notice tone="danger" title={friendlyError(photos.error)} />}
        {photos.isLoading ? (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState icon={<Images />} title={scope === 'tagged' ? tx('photos.noneTagged') : scope === 'pending' ? tx('photos.noneWaiting') : tx('photos.empty')}>
            {scope === 'tagged' ? tx('photos.noneTaggedBody') : scope === 'approved' ? tx('photos.emptyBody') : null}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4" data-testid="photo-grid">
            {list.map((p) => <Thumb key={p.id} p={p} selecting={selecting} order={sel.indexOf(p.id) + 1} onOpen={() => (selecting ? toggle(p) : set('photo', p.id))} />)}
          </div>
        )}
        {photos.hasNextPage && (
          <button type="button" className="mx-auto block min-h-11 font-semibold text-primary" onClick={() => photos.fetchNextPage()}>{photos.isFetchingNextPage ? tx('common.loading') : tx('common.loadMore')}</button>
        )}
        <p className="text-center text-sm text-muted"><Link to="/gallery" className="font-semibold text-primary">{tx('gallery.seeGallery')}</Link></p>
      </Page>

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-bg/95 px-3 py-2 backdrop-blur md:bottom-0" role="toolbar" aria-label={tx('photos.bulkBar')}>
          <p className="px-1 pb-1 text-sm font-semibold">{tx('photos.selectedN', { count: sel.length })}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {scope === 'pending' && <Button size="sm" icon={<Check className="size-4" />} disabled={!sel.length} onClick={() => bulk('approve')}>{tx('photos.approve')}</Button>}
            {scope !== 'hidden' ? <Button size="sm" variant="secondary" icon={<EyeOff className="size-4" />} disabled={!sel.length} onClick={() => bulk('hide')}>{tx('photos.hide')}</Button> : <Button size="sm" variant="secondary" disabled={!sel.length} onClick={() => bulk('unhide')}>{tx('photos.unhide')}</Button>}
            <Button size="sm" variant="secondary" disabled={!sel.length} onClick={() => bulk('first')}>{tx('photos.showFirst')}</Button>
            <Button size="sm" variant="secondary" icon={<Vote className="size-4" />} disabled={sel.length < 2 || sel.length > 24 || list.some((p) => sel.includes(p.id) && isVideo(p))} onClick={() => setVoteSheet(true)}>{tx('photos.startVote')}</Button>
            {caps.data?.gallery && <Button size="sm" variant="secondary" icon={<Images className="size-4" />} disabled={!sel.length} onClick={() => setGallery(true)}>{tx('gallery.addToGallery')}</Button>}
            <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} disabled={!sel.length} onClick={() => bulk('delete')}>{tx('photos.delete')}</Button>
          </div>
        </div>
      )}
      {voteSheet && <StartVoteSheet eventId={event.id} ids={sel} onClose={(done) => { setVoteSheet(false); if (done) { setSel([]); setSelecting(false) } }} />}
      {gallery && <GalleryAddSheet photos={list.filter((p) => sel.includes(p.id))} open onClose={() => setGallery(false)} onDone={() => setSel([])} />}
      {viewerList.length > 0 && (
        <PhotoLightbox photos={viewerList} index={viewerIdx} onIndex={(i) => set('photo', viewerList[i]!.id)} onClose={closeViewer} caps={caps.data} onChanged={refresh} />
      )}
    </div>
  )
}

function StartVoteSheet({ eventId, ids, onClose }: { eventId: string; ids: string[]; onClose: (done: boolean) => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const [title, setTitle] = useState(tx('photos.voteDefaultTitle'))
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)
  async function start() {
    setBusy(true)
    const { error } = await supabase.rpc('admin_open_photo_vote', { p_event: eventId, p_title: title, p_photos: ids, p_hours: Number(hours) })
    setBusy(false)
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.voteStarted'))
    void qc.invalidateQueries({ queryKey: ['photo-vote', eventId] })
    onClose(true)
  }
  return (
    <Sheet open onClose={() => onClose(false)} label={tx('photos.startVote')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('photos.startVote')}</h2>
        <p className="text-sm text-muted">{tx('photos.voteStartHint', { count: ids.length })}</p>
        <Field label={tx('photos.voteTitle')}>{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={tx('photos.voteHours')}>
          {(p) => (
            <Select {...p} value={hours} onChange={(e) => setHours(e.target.value)}>
              {[['1', '1'], ['6', '6'], ['24', '24'], ['72', '72'], ['168', '168']].map(([v]) => <option key={v} value={v}>{tx('photos.hoursN', { count: Number(v) })}</option>)}
            </Select>
          )}
        </Field>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={() => onClose(false)}>{tx('common.cancel')}</Button>
          <Button block loading={busy} disabled={title.trim().length < 3} onClick={start}>{tx('photos.startVote')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

/** /events/:slug/photos/upload: the page the QR code opens. Also where the photographer drops a whole card of pictures. */
export function PhotoUploadPage() {
  const tx = useT()
  const { slug = MEET_SLUG } = useParams()
  const { data: event, isLoading } = useEvent(slug)
  const caps = usePhotoCaps(event?.id)
  if (isLoading || caps.isLoading) return <PageSkeleton />
  if (!event) return <EmptyState title={tx('photos.noEvent')} />
  return (
    <div>
      <PageHeader title={tx('photos.uploadTitle')} subtitle={event.title} back={`/events/${event.slug}/photos`} />
      <Page className="space-y-4">
        {caps.data && !caps.data.view ? <Notice tone="info" title={tx('photos.verifyTitle')}>{tx('photos.verifyBody')}</Notice> : caps.data ? <PhotoUpload event={event} caps={caps.data} /> : <Notice tone="danger" title={friendlyError(caps.error)} />}
      </Page>
    </div>
  )
}
