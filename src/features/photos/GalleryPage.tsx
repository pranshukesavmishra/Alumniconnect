import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Folders, ImagePlus, Inbox, Link2, Pencil, Star, Tags, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Badge, EmptyState, Notice, PageSkeleton, SectionTitle, Skeleton } from '../../components/ui/Display'
import { Button } from '../../components/ui/Button'
import { useLang, useT } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { hasPerm } from '../../lib/adminAccess'
import { supabase } from '../../lib/supabase'
import { useAdminAccess } from '../admin/access'
import { useMyProfile } from '../auth/AuthProvider'
import { albumTitle, chipLabel, fetchGalleryPhoto, galleryTitle, galleryUrl, useGalleryAlbums, useGalleryCategories, useGalleryPhotos, useGallerySuggestions, useOnThisDay, type GalleryPhoto } from './api'
import { BeforeAfter } from './BeforeAfter'
import { AlbumsSheet, ChipsSheet, GalleryEditSheet, GalleryUploadSheet, SuggestionsSheet } from './GalleryAdmin'

function usePairBases(photos: GalleryPhoto[]) {
  const ids = [...new Set(photos.map((p) => p.pair_of).filter((x): x is string => !!x))].sort()
  return useQuery({
    queryKey: ['gallery-pairs', ids.join()],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('gallery_photos').select('*').in('id', ids)
      if (error) throw error
      return new Map((data as GalleryPhoto[]).map((p) => [p.id, p]))
    },
  })
}

export function GalleryPage() {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const { data: profile, isLoading: profileLoading } = useMyProfile()
  const { access } = useAdminAccess()
  const [sp, setSp] = useSearchParams()
  const verified = profile?.verification === 'verified' || !!profile?.is_admin
  const curator = hasPerm(access, 'gallery_manage')
  const cat = sp.get('cat')
  const albumId = sp.get('album')
  const openId = sp.get('photo')
  const cats = useGalleryCategories(verified)
  const albums = useGalleryAlbums(verified)
  const photos = useGalleryPhotos({ category: cat, album: albumId }, verified)
  const today = useOnThisDay(verified && !cat && !albumId)
  const suggestions = useGallerySuggestions(curator)
  const list = useMemo(() => photos.data?.pages.flat() ?? [], [photos.data])
  const bases = usePairBases(list)
  const [files, setFiles] = useState<File[] | null>(null)
  const [sheet, setSheet] = useState<'chips' | 'albums' | 'suggestions' | null>(null)
  const [editing, setEditing] = useState<GalleryPhoto | null>(null)
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  // the "Then" half of a pair is shown inside the pair, not on its own
  const hidden = new Set(list.map((p) => p.pair_of).filter((x): x is string => !!x))
  const shown = list.filter((p) => !hidden.has(p.id))
  const openIdx = openId ? shown.findIndex((p) => p.id === openId) : -1
  const single = useQuery({
    queryKey: ['gallery-one', openId],
    enabled: verified && !!openId && openIdx < 0 && !photos.isLoading,
    queryFn: () => fetchGalleryPhoto(openId!),
  })
  const viewer = openIdx >= 0 ? shown[openIdx] : single.data ?? null
  const album = albums.data?.find((a) => a.id === albumId)

  if (profileLoading) return <PageSkeleton />
  if (!verified) {
    return (
      <div>
        <PageHeader title={tx('gallery.title')} back="/" />
        <Page><Notice tone="info" title={tx('gallery.verifyTitle')}>{tx('gallery.verifyBody')}</Notice></Page>
      </div>
    )
  }

  const chip = (id: string | null, label: string) => (
    <button key={id ?? 'all'} type="button" role="tab" aria-selected={(cat ?? null) === id} onClick={() => { const n = new URLSearchParams(sp); if (id) n.set('cat', id); else n.delete('cat'); n.delete('album'); n.delete('photo'); setSp(n, { replace: true }) }} className={clsx('inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold', (cat ?? null) === id ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-muted hover:border-primary/50')}>
      {label}
    </button>
  )

  return (
    <div>
      <PageHeader title={tx('gallery.title')} subtitle={tx('gallery.subtitle')} back="/" />
      <Page className="space-y-4">
        {curator && (
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label={tx('gallery.manage')}>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
              <ImagePlus className="size-4" aria-hidden />{tx('gallery.addPhotos')}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) setFiles(Array.from(e.target.files)); e.target.value = '' }} />
            </label>
            <Button size="sm" variant="secondary" icon={<Tags className="size-4" />} onClick={() => setSheet('chips')}>{tx('gallery.chipsTitle')}</Button>
            <Button size="sm" variant="secondary" icon={<Folders className="size-4" />} onClick={() => setSheet('albums')}>{tx('gallery.albumsTitle')}</Button>
            <Button size="sm" variant="secondary" icon={<Inbox className="size-4" />} onClick={() => setSheet('suggestions')}>
              {tx('gallery.suggestionsTitle')} {!!suggestions.data?.length && <Badge tone="warning">{suggestions.data.length}</Badge>}
            </Button>
          </div>
        )}

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={tx('gallery.chips')}>
          {chip(null, tx('gallery.all'))}
          {(cats.data ?? []).map((c) => chip(c.id, chipLabel(c, lang)))}
        </div>

        {album && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{albumTitle(album, lang)}</p>
              {album.description && <p className="text-sm text-muted">{album.description}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} aria-label={tx('gallery.shareAlbum')} onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/gallery?album=${album.id}`).then(() => toast.success(tx('photos.linkCopied')))} />
              <Button size="sm" variant="secondary" icon={<X className="size-4" />} onClick={() => set('album', null)}>{tx('gallery.closeAlbum')}</Button>
            </div>
          </div>
        )}

        {!cat && !albumId && !!today.data?.length && (
          <section aria-label={tx('gallery.onThisDay')} className="space-y-2">
            <SectionTitle>{tx('gallery.onThisDay')}</SectionTitle>
            <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {today.data.map((p) => (
                <li key={p.id} className="shrink-0">
                  <button type="button" onClick={() => set('photo', p.id)} className="relative block size-32 overflow-hidden rounded-2xl bg-surface-2">
                    <img src={galleryUrl(p.thumb_path)} alt={p.alt_text ?? galleryTitle(p, lang) ?? ''} loading="lazy" className="size-full object-cover" />
                    {p.taken_on && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white">{p.taken_on.slice(0, 4)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!cat && !albumId && !!albums.data?.length && (
          <section aria-label={tx('gallery.albums')} className="space-y-2">
            <SectionTitle>{tx('gallery.albums')}</SectionTitle>
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {albums.data.map((a) => (
                <li key={a.id} className="shrink-0">
                  <button type="button" onClick={() => set('album', a.id)} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-surface px-4 text-sm font-semibold hover:border-primary/50"><Folders className="size-4 text-primary" aria-hidden />{albumTitle(a, lang)}</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {photos.error && <Notice tone="danger" title={friendlyError(photos.error)} />}
        {photos.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState title={tx('gallery.empty')}>{curator ? tx('gallery.emptyCurator') : tx('gallery.emptyBody')}</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="gallery-grid">
            {shown.map((p) => {
              const base = p.pair_of ? bases.data?.get(p.pair_of) : null
              if (base) {
                return (
                  <div key={p.id} className="col-span-2 sm:col-span-3" data-gallery-id={p.id}>
                    <BeforeAfter before={galleryUrl(base.storage_path)} after={galleryUrl(p.storage_path)} alt={p.alt_text ?? galleryTitle(p, lang) ?? ''} />
                    <button type="button" className="mt-1 min-h-11 text-left text-sm font-semibold" onClick={() => set('photo', p.id)}>{galleryTitle(p, lang) ?? tx('gallery.thenNow')}</button>
                  </div>
                )
              }
              return (
                <button key={p.id} type="button" onClick={() => set('photo', p.id)} aria-label={galleryTitle(p, lang) ?? p.alt_text ?? tx('photos.photo')} data-gallery-id={p.id} className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface-2">
                  <img src={galleryUrl(p.thumb_path)} alt={p.alt_text ?? galleryTitle(p, lang) ?? ''} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
                  {p.is_featured && <span className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-accent text-black" title={tx('gallery.featuredBadge')}><Star className="size-3.5 fill-current" aria-hidden /></span>}
                </button>
              )
            })}
          </div>
        )}
        {photos.hasNextPage && <button type="button" className="mx-auto block min-h-11 font-semibold text-primary" onClick={() => photos.fetchNextPage()}>{tx('common.loadMore')}</button>}
      </Page>

      {viewer && (
        <GalleryViewer
          photo={viewer}
          base={viewer.pair_of ? bases.data?.get(viewer.pair_of) ?? null : null}
          index={openIdx}
          count={shown.length}
          onIndex={(i) => set('photo', shown[i]!.id)}
          onClose={() => set('photo', null)}
          curator={curator}
          onEdit={() => setEditing(viewer)}
        />
      )}
      {files && <GalleryUploadSheet files={files} onClose={() => setFiles(null)} />}
      {sheet === 'chips' && <ChipsSheet onClose={() => setSheet(null)} />}
      {sheet === 'albums' && <AlbumsSheet onClose={() => setSheet(null)} />}
      {sheet === 'suggestions' && <SuggestionsSheet onClose={() => setSheet(null)} />}
      {editing && <GalleryEditSheet photo={editing} others={list} onClose={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['gallery-one'] }) }} />}
    </div>
  )
}

function GalleryViewer({ photo, base, index, count, onIndex, onClose, curator, onEdit }: { photo: GalleryPhoto; base: GalleryPhoto | null; index: number; count: number; onIndex: (i: number) => void; onClose: () => void; curator: boolean; onEdit: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const title = galleryTitle(photo, lang)
  const btn = 'grid size-12 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70'
  async function share() {
    const url = `${window.location.origin}/gallery?photo=${photo.id}`
    try {
      if (navigator.share) await navigator.share({ url, title: title ?? tx('gallery.title') })
      else {
        await navigator.clipboard.writeText(url)
        toast.success(tx('photos.linkCopied'))
      }
    } catch {
      /* cancelled */
    }
  }
  useKeys(index, count, onIndex, onClose)
  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? tx('photos.photo')} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-3" data-gallery-id={photo.id}>
      <div className="flex w-full max-w-3xl flex-1 items-center justify-center overflow-hidden">
        {base ? <BeforeAfter className="w-full" before={galleryUrl(base.storage_path)} after={galleryUrl(photo.storage_path)} alt={photo.alt_text ?? title ?? ''} /> : <img src={galleryUrl(photo.storage_path)} alt={photo.alt_text ?? title ?? ''} className="max-h-full max-w-full object-contain" />}
      </div>
      <div className="absolute inset-x-0 top-0 flex justify-between p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button type="button" className={btn} onClick={onClose} aria-label={tx('common.close')}><X className="size-6" /></button>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={share} aria-label={tx('photos.shareLink')}><Link2 className="size-5" /></button>
          {curator && <button type="button" className={btn} onClick={onEdit} aria-label={tx('gallery.editTitle')}><Pencil className="size-5" /></button>}
        </div>
      </div>
      {index > 0 && <button type="button" className={clsx(btn, 'absolute left-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index - 1)} aria-label={tx('common.previous')}><ChevronLeft className="size-6" /></button>}
      {index >= 0 && index < count - 1 && <button type="button" className={clsx(btn, 'absolute right-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index + 1)} aria-label={tx('common.next')}><ChevronRight className="size-6" /></button>}
      <div className="w-full max-w-3xl space-y-1 px-1 pb-[env(safe-area-inset-bottom)] pt-3 text-white">
        {title && <p className="text-lg font-semibold">{title}</p>}
        {photo.taken_on && <p className="text-sm text-white/70">{new Date(photo.taken_on).getFullYear()}</p>}
        {photo.event && <Link to={`/events/${photo.event.slug}/photos`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent" data-testid="from-event">{tx('gallery.fromEvent', { event: photo.event.title })}<ChevronRight className="size-4" aria-hidden /></Link>}
      </div>
    </div>
  )
}

function useKeys(index: number, count: number, onIndex: (i: number) => void, onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index >= 0 && index < count - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [index, count, onIndex, onClose])
}
