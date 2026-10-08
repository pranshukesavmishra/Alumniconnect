import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ImagePlus, Images, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { EmptyState, Notice, PageSkeleton, Skeleton } from '../../components/ui/Display'
import { MEET_SLUG } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { compressImageSizes, PHOTO_SIZE, THUMB_SIZE } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'
import type { EventPhoto } from '../../lib/types'
import { useUserId } from '../auth/AuthProvider'
import { useEvent } from './queries'

type Kind = 'throwback' | 'event'

/**
 * Sends the full-quality original to the committee's Google Drive (best effort, in the background).
 * The phone uploads straight to Google; our server only hands out a one-time upload link.
 * If Drive isn't set up yet the server answers {skipped: true} and nothing happens.
 */
async function archiveOriginal(photoId: string, file: File) {
  try {
    const start = await supabase.functions.invoke('drive-upload', { body: { action: 'start', photo_id: photoId, mime_type: file.type || 'image/jpeg', size: file.size } })
    const url = (start.data as { upload_url?: string } | null)?.upload_url
    if (start.error || !url) return
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file })
    if (!put.ok) throw new Error(`Drive upload failed: ${put.status}`)
    const { id } = (await put.json()) as { id: string }
    await supabase.functions.invoke('drive-upload', { body: { action: 'finish', photo_id: photoId, file_id: id } })
  } catch (e) {
    console.warn('Original not archived to Drive (photo is still saved in the app)', e)
  }
}
const PAGE = 48

export function PhotosPage() {
  const { data: event, isLoading } = useEvent(MEET_SLUG)
  const uid = useUserId()
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>('throwback')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  const photos = useInfiniteQuery({
    queryKey: ['photos', event?.id, kind],
    enabled: !!event,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from('event_photos')
        .select('*')
        .eq('event_id', event!.id)
        .eq('kind', kind)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1)
      if (error) throw error
      return data as EventPhoto[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
  const list = photos.data?.pages.flat() ?? []

  if (isLoading) return <PageSkeleton />
  if (!event) return <EmptyState title="No event found" />

  async function upload(files: FileList) {
    const arr = Array.from(files).slice(0, 30)
    if (files.length > 30) toast.info('Uploading the first 30 photos. You can add more afterwards.')
    setProgress({ done: 0, total: arr.length })
    let failed = 0
    let firstError: unknown = null
    for (const [i, file] of arr.entries()) {
      const uploaded: string[] = []
      try {
        const [big, thumb] = await compressImageSizes(file, [
          { maxSide: PHOTO_SIZE, quality: 0.82 },
          { maxSide: THUMB_SIZE, quality: 0.75 },
        ])
        const id = crypto.randomUUID()
        const path = `${uid}/${event!.id}/${id}.${big!.ext}`
        const tpath = `${uid}/${event!.id}/${id}_t.${thumb!.ext}`
        const a = await supabase.storage.from('event-photos').upload(path, big!.blob, { contentType: big!.type })
        if (a.error) throw a.error
        uploaded.push(path)
        const b = await supabase.storage.from('event-photos').upload(tpath, thumb!.blob, { contentType: thumb!.type })
        if (b.error) throw b.error
        uploaded.push(tpath)
        const { data: row, error } = await supabase
          .from('event_photos')
          .insert({ event_id: event!.id, uploaded_by: uid, storage_path: path, thumb_path: tpath, width: big!.width, height: big!.height, kind })
          .select('id')
          .single()
        if (error) throw error
        void archiveOriginal(row.id as string, file)
      } catch (e) {
        failed++
        firstError ??= e
        if (uploaded.length) void supabase.storage.from('event-photos').remove(uploaded) // no orphaned files
      }
      setProgress({ done: i + 1, total: arr.length })
    }
    setProgress(null)
    void qc.invalidateQueries({ queryKey: ['photos', event!.id, kind] })
    if (failed) toast.error(`${failed} photo${failed > 1 ? 's' : ''} couldn’t be uploaded: ${friendlyError(firstError)}`)
    else toast.success(`${arr.length} photo${arr.length > 1 ? 's' : ''} added. Thank you!`)
  }

  async function remove(p: EventPhoto) {
    if (!window.confirm('Delete this photo?')) return
    const { error } = await supabase.from('event_photos').delete().eq('id', p.id)
    if (error) return toast.error(friendlyError(error))
    await supabase.storage.from('event-photos').remove([p.storage_path, p.thumb_path])
    setOpen(null)
    void qc.invalidateQueries({ queryKey: ['photos', event!.id, kind] })
  }

  return (
    <div>
      <PageHeader title="Photos" subtitle={event.title} back="/meet" />
      <Page className="space-y-4">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {(
            [
              ['throwback', 'Then (college days)'],
              ['event', 'Now (at the meet)'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={clsx('min-h-10 rounded-full text-sm font-semibold', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
              {label}
            </button>
          ))}
        </div>

        <Notice tone="info">
          {kind === 'throwback'
            ? 'Share photos from your JEC days for the “Then and Now” slideshow at the meet. Photos are visible to verified JEC members.'
            : 'Share your photos from the meet. Everyone who attended can see and enjoy them.'}
        </Notice>

        <label
          className={clsx(
            'flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover',
            progress && 'pointer-events-none opacity-70',
          )}
        >
          <ImagePlus className="size-5" aria-hidden />
          {progress ? `Uploading ${progress.done} of ${progress.total}…` : 'Add photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={!!progress}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>

        {photos.error && <Notice tone="danger" title={friendlyError(photos.error)} />}
        {photos.isLoading ? (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={<Images />} title="No photos yet">
            Be the first to add one.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
            {list.map((p, i) => (
              <button key={p.id} type="button" className="aspect-square overflow-hidden rounded-lg bg-surface-2" onClick={() => setOpen(i)} aria-label={p.caption ?? `Photo ${i + 1}`}>
                <img src={publicUrl('event-photos', p.thumb_path) ?? ''} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {photos.hasNextPage && (
          <button type="button" className="mx-auto block min-h-11 font-semibold text-primary" onClick={() => photos.fetchNextPage()}>
            Load more
          </button>
        )}
      </Page>

      {open !== null && list[open] && (
        <Lightbox photos={list} index={open} onIndex={setOpen} onClose={() => setOpen(null)} canDelete={list[open]!.uploaded_by === uid} onDelete={() => remove(list[open]!)} />
      )}
    </div>
  )
}

function Lightbox({ photos, index, onIndex, onClose, canDelete, onDelete }: { photos: EventPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void; canDelete: boolean; onDelete: () => void }) {
  const p = photos[index]!
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndex])
  const btn = 'grid size-12 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70'
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/95">
      <img src={publicUrl('event-photos', p.storage_path) ?? ''} alt={p.caption ?? ''} className="max-h-full max-w-full object-contain" />
      <div className="absolute inset-x-0 top-0 flex justify-between p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button type="button" className={btn} onClick={onClose} aria-label="Close">
          <X className="size-6" />
        </button>
        {canDelete && (
          <button type="button" className={btn} onClick={onDelete} aria-label="Delete photo">
            <Trash2 className="size-5" />
          </button>
        )}
      </div>
      {index > 0 && (
        <button type="button" className={clsx(btn, 'absolute left-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index - 1)} aria-label="Previous">
          <ChevronLeft className="size-6" />
        </button>
      )}
      {index < photos.length - 1 && (
        <button type="button" className={clsx(btn, 'absolute right-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index + 1)} aria-label="Next">
          <ChevronRight className="size-6" />
        </button>
      )}
    </div>
  )
}
