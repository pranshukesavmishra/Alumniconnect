import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Download, EyeOff, Flag, Heart, Images, Link2, MoreHorizontal, Pencil, Star, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/Display'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { useLang, useT } from '../../i18n'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { captionOf, isVideo, photoError, photoUrl, thumbUrl, type PhotoCaps, type PhotoRow } from './api'
import { DriveVideo } from './DriveVideo'
import { formatDuration, mediaUrl } from './video'
import { EditPhotoSheet, GalleryAddSheet, ReportSheet, SuggestSheet, TagSheet } from './PhotoSheets'

const btn = 'grid size-12 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70'

export function photoLink(p: Pick<PhotoRow, 'id'>) {
  return `${window.location.origin}/photo/${p.id}`
}

/** Full-screen viewer: heart, tag, download, share, report, and (for owners and managers) edit, delete, approve, hide, add to the gallery. */
export function PhotoLightbox({ photos, index, onIndex, onClose, caps, onChanged }: { photos: PhotoRow[]; index: number; onIndex: (i: number) => void; onClose: () => void; caps: PhotoCaps | undefined; onChanged: () => void }) {
  const p = photos[index]!
  const tx = useT()
  const { lang } = useLang()
  const uid = useUserId()
  const qc = useQueryClient()
  const [more, setMore] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [heart, setHeart] = useState({ on: p.hearted, n: p.hearts })
  const own = p.uploaded_by === uid
  const manager = !!caps?.official
  const modal = more || tagging || reporting || editing || gallery || suggesting

  useEffect(() => setHeart({ on: p.hearted, n: p.hearts }), [p.id, p.hearted, p.hearts])
  useEffect(() => {
    if (modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndex, modal])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['photos'] })
    void qc.invalidateQueries({ queryKey: ['photo-summary'] })
    onChanged()
  }

  async function toggleHeart() {
    const next = { on: !heart.on, n: heart.n + (heart.on ? -1 : 1) }
    setHeart(next)
    const { data, error } = await supabase.rpc('heart_photo', { p_photo: p.id })
    if (error) {
      setHeart({ on: heart.on, n: heart.n })
      return toast.error(photoError(error))
    }
    const r = data as { hearted: boolean; count: number }
    setHeart({ on: r.hearted, n: r.count })
  }

  async function download() {
    if (isVideo(p)) {
      const { data } = await supabase.auth.getSession()
      const a = document.createElement('a')
      a.href = mediaUrl('event', p.id, data.session?.access_token, { download: true })
      document.body.appendChild(a)
      a.click()
      a.remove()
      return
    }
    try {
      const res = await fetch(photoUrl(p))
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${p.event_slug}-${p.id.slice(0, 8)}.${p.storage_path.split('.').pop() ?? 'jpg'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch {
      toast.error(tx('photos.downloadFailed'))
    }
  }

  async function share() {
    setMore(false)
    const url = photoLink(p)
    try {
      if (navigator.share) await navigator.share({ url, title: p.event_title })
      else {
        await navigator.clipboard.writeText(url)
        toast.success(tx('photos.linkCopied'))
      }
    } catch {
      /* cancelled */
    }
  }

  async function remove() {
    setMore(false)
    if (!window.confirm(tx('photos.confirmDelete'))) return
    const { error } = await supabase.from('event_photos').delete().eq('id', p.id)
    if (error) return toast.error(photoError(error))
    void supabase.storage.from('event-photos').remove(isVideo(p) ? [p.thumb_path] : [p.storage_path, p.thumb_path])
    toast.success(tx('photos.deleted'))
    refresh()
    onClose()
  }

  async function review(action: 'approve' | 'hide' | 'unhide') {
    setMore(false)
    const { error } = await supabase.rpc('admin_review_photos', { p_event: p.event_id, p_ids: [p.id], p_action: action })
    if (error) return toast.error(photoError(error))
    toast.success(tx(action === 'approve' ? 'photos.approved' : action === 'hide' ? 'photos.hidden' : 'photos.unhidden'))
    refresh()
    onClose()
  }

  const caption = captionOf(p, lang)
  return (
    <div role="dialog" aria-modal="true" aria-label={tx('photos.photo')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" data-photo-id={p.id}>
      {isVideo(p) ? (
        <div className="flex size-full items-center justify-center px-3 pb-44 pt-20">
          {p.playable ? (
            <DriveVideo kind="event" id={p.id} poster={thumbUrl(p)} className="max-h-full max-w-full rounded-lg bg-black" label={p.alt_text ?? caption ?? tx('photos.video')} />
          ) : (
            <div className="space-y-2 text-center text-white">
              <img src={thumbUrl(p)} alt="" className="mx-auto max-h-48 rounded-lg opacity-60" />
              <p className="text-sm" role="status">{tx('photos.videoUnfinished')}</p>
            </div>
          )}
        </div>
      ) : (
        <img src={photoUrl(p)} alt={p.alt_text ?? caption ?? ''} className="max-h-full max-w-full object-contain" />
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button type="button" className={btn} onClick={onClose} aria-label={tx('common.close')}><X className="size-6" /></button>
        <div className="flex items-center gap-2">
          {isVideo(p) && p.duration_ms ? <Badge tone="neutral">{formatDuration(p.duration_ms)}</Badge> : null}
          <Badge tone={p.source === 'official' ? 'primary' : 'neutral'}>{p.source === 'official' ? tx('photos.official') : tx('photos.fromMembers')}</Badge>
          {p.status === 'pending' && <Badge tone="warning">{tx('photos.pendingBadge')}</Badge>}
          {p.is_hidden && <Badge tone="danger">{tx('photos.hiddenBadge')}</Badge>}
        </div>
      </div>
      {index > 0 && <button type="button" className={clsx(btn, 'absolute left-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index - 1)} aria-label={tx('common.previous')}><ChevronLeft className="size-6" /></button>}
      {index < photos.length - 1 && <button type="button" className={clsx(btn, 'absolute right-3 top-1/2 -translate-y-1/2')} onClick={() => onIndex(index + 1)} aria-label={tx('common.next')}><ChevronRight className="size-6" /></button>}
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/80 to-transparent p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] text-white">
        {(caption || p.uploader_name) && (
          <p className="px-1 text-[15px]">
            {caption}
            {p.uploader_name && <span className="block text-sm text-white/70">{tx('photos.by', { name: p.uploader_name })}</span>}
          </p>
        )}
        <div className="flex items-center justify-center gap-2">
          <button type="button" className={clsx(btn, 'w-auto gap-1.5 px-4')} onClick={toggleHeart} aria-pressed={heart.on} aria-label={heart.on ? tx('photos.unheart') : tx('photos.heart')} disabled={p.status !== 'approved' || p.is_hidden}>
            <Heart className={clsx('size-5', heart.on && 'fill-current text-red-400')} />
            <span className="text-sm tabular-nums" data-testid="heart-count">{heart.n}</span>
          </button>
          <button type="button" className={clsx(btn, 'w-auto gap-1.5 px-4')} onClick={() => setTagging(true)} aria-label={tx('photos.tagPeople')}>
            <Tag className="size-5" />
            <span className="text-sm tabular-nums">{p.tag_count}</span>
          </button>
          <button type="button" className={btn} onClick={download} aria-label={tx('photos.download')}><Download className="size-5" /></button>
          <button type="button" className={btn} onClick={() => setMore(true)} aria-label={tx('photos.moreActions')}><MoreHorizontal className="size-5" /></button>
        </div>
      </div>

      <Sheet open={more} onClose={() => setMore(false)} label={tx('photos.moreActions')}>
        <div className="py-2">
          <SheetAction icon={<Link2 className="size-5" />} onClick={share}>{tx('photos.shareLink')}</SheetAction>
          {(own || manager) && <SheetAction icon={<Pencil className="size-5" />} onClick={() => { setMore(false); setEditing(true) }}>{tx('photos.editCaption')}</SheetAction>}
          {manager && p.status === 'pending' && <SheetAction icon={<Check className="size-5" />} onClick={() => review('approve')}>{tx('photos.approve')}</SheetAction>}
          {manager && !p.is_hidden && <SheetAction icon={<EyeOff className="size-5" />} onClick={() => review('hide')}>{tx('photos.hide')}</SheetAction>}
          {manager && p.is_hidden && <SheetAction icon={<EyeOff className="size-5" />} onClick={() => review('unhide')}>{tx('photos.unhide')}</SheetAction>}
          {caps?.gallery && <SheetAction icon={<Images className="size-5" />} onClick={() => { setMore(false); setGallery(true) }}>{tx('gallery.addToGallery')}</SheetAction>}
          {!caps?.gallery && !own && p.status === 'approved' && <SheetAction icon={<Star className="size-5" />} onClick={() => { setMore(false); setSuggesting(true) }}>{tx('gallery.suggestAction')}</SheetAction>}
          {!own && p.status === 'approved' && <SheetAction icon={<Flag className="size-5" />} onClick={() => { setMore(false); setReporting(true) }}>{tx('photos.report')}</SheetAction>}
          {(own || manager) && <SheetAction danger icon={<Trash2 className="size-5" />} onClick={remove}>{tx('photos.delete')}</SheetAction>}
        </div>
      </Sheet>
      {tagging && <TagSheet photo={p} open onClose={() => { setTagging(false); onChanged() }} canManage={manager} />}
      {reporting && <ReportSheet photo={p} open onClose={() => setReporting(false)} />}
      {editing && <EditPhotoSheet photo={p} open onClose={() => setEditing(false)} />}
      {suggesting && <SuggestSheet photo={p} open onClose={() => setSuggesting(false)} />}
      {gallery && <GalleryAddSheet photos={[p]} open onClose={() => setGallery(false)} />}
    </div>
  )
}
