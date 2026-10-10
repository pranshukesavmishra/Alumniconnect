import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RotateCw, Stamp, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { Field, Input } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { tr, type MsgKey } from '../../i18n/core'
import { useOnline } from '../../hooks/useOnline'
import { compressImageSizes, PHOTO_SIZE, THUMB_SIZE } from '../../lib/image'
import { supabase } from '../../lib/supabase'
import type { EventRow } from '../../lib/types'
import { useUserId } from '../auth/AuthProvider'
import { photoError, photoQueryKey, type PhotoCaps } from './api'
import { sha256Hex } from './hash'
import { UploadQueue, type QueueItem } from './uploadQueue'

export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024
const CONCURRENCY = 3

/** A problem that retrying cannot fix (wrong file type, too big, not allowed): shown against the file straight away. */
export class FatalUpload extends Error {
  key: MsgKey
  constructor(key: MsgKey, params?: Record<string, string | number>) {
    super(tr(key, params))
    this.key = key
  }
}

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name)
}

/** Network and server hiccups are worth another try; refusals from the database or a bad file are not. */
export function isTransient(e: unknown): boolean {
  if (e instanceof FatalUpload) return false
  const x = e as { code?: string; status?: number; statusCode?: string | number; message?: string; name?: string } | null
  if (x?.code && /^(42|P0|22|23)/.test(x.code)) return false
  const status = Number(x?.status ?? x?.statusCode ?? 0)
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false
  return true
}

function waitOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
}

/**
 * Sends the full-quality original to the committee's Google Drive (best effort).
 * The phone uploads straight to Google; our server only hands out a one-time upload link. If Drive isn't set up the server answers {skipped: true}.
 */
export async function archiveOriginal(photoId: string, file: File) {
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

interface Payload {
  file: File
  id: string
  kind: 'event' | 'throwback'
  caption: string
}

export function PhotoUpload({ event, caps }: { event: EventRow; caps: PhotoCaps }) {
  const tx = useT()
  const uid = useUserId()
  const qc = useQueryClient()
  const online = useOnline()
  const [kind, setKind] = useState<'event' | 'throwback'>('event')
  const [caption, setCaption] = useState('')
  const [items, setItems] = useState<readonly QueueItem<Payload>[]>([])
  const hashes = useRef(new Map<string, string>()) // hash -> queue key, so the same photo picked twice is added once
  const announced = useRef(false)
  const ctx = useRef({ uid, eventId: event.id, official: caps.official })
  ctx.current = { uid, eventId: event.id, official: caps.official }

  const [queue] = useState(
    () =>
      new UploadQueue<Payload>({
        concurrency: CONCURRENCY,
        online: waitOnline,
        isRetryable: isTransient,
        messageOf: (e) => (e instanceof FatalUpload ? e.message : photoError(e)),
        onChange: setItems,
        run: async (item, setStage) => {
          const { uid, eventId, official } = ctx.current
          const { file, id, kind, caption } = item.payload
          if (!uid) throw new FatalUpload('err.session')
          if (!isImageFile(file)) throw new FatalUpload('photos.errNotImage')
          if (file.size > MAX_ORIGINAL_BYTES) throw new FatalUpload('photos.errTooBig', { mb: 25 })
          if (item.attempts > 1) {
            // a retry after the row was saved but the answer got lost: nothing left to do
            const again = await supabase.from('event_photos').select('id').eq('id', id).maybeSingle()
            if (again.data) return 'done'
          }
          setStage('checking')
          const hash = await sha256Hex(file)
          if (hash) {
            const first = hashes.current.get(hash)
            if (first && first !== item.key) return 'duplicate'
            hashes.current.set(hash, item.key)
            const taken = await supabase.rpc('photo_hashes_taken', { p_event: eventId, p_hashes: [hash] })
            if (taken.error) throw taken.error
            if ((taken.data as string[] | null)?.length && item.attempts === 1) return 'duplicate'
          }
          setStage('resizing')
          let sizes
          try {
            sizes = await compressImageSizes(file, [
              { maxSide: PHOTO_SIZE, quality: 0.82 },
              { maxSide: THUMB_SIZE, quality: 0.75 },
            ])
          } catch (e) {
            console.warn('Could not read the photo', e)
            throw new FatalUpload(/\.hei[cf]$/i.test(file.name) || /hei[cf]/.test(file.type) ? 'photos.errHeic' : 'photos.errFormat')
          }
          const [big, thumb] = sizes as [(typeof sizes)[number], (typeof sizes)[number]]
          const path = `${uid}/${eventId}/${id}.${big.ext}`
          const tpath = `${uid}/${eventId}/${id}_t.${thumb.ext}`
          setStage('uploading')
          for (const [p, b] of [[path, big], [tpath, thumb]] as const) {
            const r = await supabase.storage.from('event-photos').upload(p, b.blob, { contentType: b.type })
            if (r.error && !/already exists|Duplicate/i.test(r.error.message)) throw r.error
          }
          const ins = await supabase.from('event_photos').insert({
            id, event_id: eventId, uploaded_by: uid, storage_path: path, thumb_path: tpath, width: big.width, height: big.height,
            kind, caption: caption.trim() || null, content_hash: hash,
          })
          if (ins.error) {
            if (ins.error.code === '23505' && /hash/.test(ins.error.message)) {
              void supabase.storage.from('event-photos').remove([path, tpath])
              return 'duplicate'
            }
            if (ins.error.code === '23505') return 'done' // this very photo was saved by an earlier attempt
            if (ins.error.code !== undefined && !isTransient(ins.error)) void supabase.storage.from('event-photos').remove([path, tpath])
            throw ins.error
          }
          if (official) {
            setStage('original')
            await archiveOriginal(id, file)
          } else void archiveOriginal(id, file)
          return 'done'
        },
      }),
  )

  const stats = queue.stats
  const finished = stats.done + stats.duplicate + stats.failed
  const busy = stats.queued + stats.working > 0

  useEffect(() => {
    if (!items.length || busy) {
      if (busy) announced.current = false
      return
    }
    if (announced.current) return
    announced.current = true
    void qc.invalidateQueries({ queryKey: photoQueryKey(event.id) })
    void qc.invalidateQueries({ queryKey: ['photo-summary', event.id] })
    if (stats.failed) toast.error(tx('photos.upFailedToast', { count: stats.failed }))
    else toast.success(tx('photos.upDoneToast', { count: stats.done }))
  }, [busy, items.length, stats.failed, stats.done, qc, event.id, tx])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queue.stats.queued + queue.stats.working > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [queue])

  function pick(files: FileList) {
    const list = Array.from(files)
    queue.add(list.map((file) => ({ key: crypto.randomUUID(), name: file.name, size: file.size, payload: { file, id: crypto.randomUUID(), kind, caption } })))
    setCaption('')
  }

  const failed = items.filter((i) => i.state === 'failed')
  const working = items.filter((i) => i.state === 'working').slice(0, CONCURRENCY)
  const pct = stats.total ? Math.round((finished / stats.total) * 100) : 0

  return (
    <div className="space-y-4">
      {caps.official ? (
        <Notice tone="info" title={tx('photos.officialUploadTitle')}>
          <span className="inline-flex items-center gap-1.5"><Stamp className="size-4" aria-hidden />{tx('photos.officialUploadBody')}</span>
        </Notice>
      ) : (
        <Notice tone="info">{caps.member_uploads === 'approval' ? tx('photos.memberApprovalNote') : tx('photos.memberImmediateNote')}</Notice>
      )}

      <div role="tablist" aria-label={tx('photos.kindLabel')} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
        {([['event', tx('photos.kindEvent')], ['throwback', tx('photos.kindThen')]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={clsx('min-h-11 rounded-full text-sm font-semibold', kind === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>

      <Field label={tx('photos.captionLabel')} optional hint={tx('photos.captionHint')}>
        {(p) => <Input {...p} value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} placeholder={tx('photos.captionPh')} />}
      </Field>

      <label className="flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">
        <ImagePlus className="size-5" aria-hidden />
        {tx('photos.addPhotos')}
        <input
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) pick(e.target.files)
            e.target.value = ''
          }}
        />
      </label>
      <p className="text-center text-sm text-muted">{tx('photos.pickHint', { mb: 25 })}</p>

      {!online && busy && (
        <Notice tone="warning" title={tx('photos.offlineTitle')}>
          <span className="inline-flex items-center gap-1.5"><WifiOff className="size-4" aria-hidden />{tx('photos.offlineBody')}</span>
        </Notice>
      )}

      {stats.total > 0 && (
        <section aria-label={tx('photos.progress')} aria-live="polite" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm font-semibold">
            <span data-testid="upload-progress">{busy ? tx('photos.uploadingOf', { done: finished, total: stats.total }) : tx('photos.finishedOf', { done: stats.done + stats.duplicate, total: stats.total })}</span>
            <span className="tabular-nums text-muted">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted">
            <CheckCircle2 className="mr-1 inline size-4 text-success" aria-hidden />
            {tx('photos.countsLine', { done: stats.done, dup: stats.duplicate, failed: stats.failed })}
          </p>
          {working.map((w) => (
            <p key={w.key} className="flex items-center gap-2 truncate text-sm text-muted">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              <span className="truncate">{w.name}</span>
              {w.stage && <span className="shrink-0">· {tx(`photos.stage_${w.stage}` as MsgKey)}</span>}
            </p>
          ))}
          {failed.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-danger"><AlertTriangle className="size-4" aria-hidden />{tx('photos.failedHeading', { count: failed.length })}</p>
                <Button size="sm" variant="secondary" icon={<RotateCw className="size-4" />} onClick={() => queue.retryFailed()}>{tx('photos.retryAll')}</Button>
              </div>
              <ul className="space-y-2">
                {failed.slice(0, 20).map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft p-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block text-danger">{f.error}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => queue.retry(f.key)}>{tx('photos.retry')}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!busy && (
            <Link to={`/events/${event.slug}/photos`} className="inline-flex min-h-11 items-center font-semibold text-primary">
              {tx('photos.viewPhotos')}
            </Link>
          )}
        </section>
      )}
    </div>
  )
}
