import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Tag, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Badge, Skeleton } from '../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { addEventPhotoToGallery, addEventVideoToGallery, isVideo, chipLabel, photoError, photoQueryKey, thumbUrl, useGalleryAlbums, useGalleryCategories, albumTitle, type PhotoRow } from './api'
import { useLang } from '../../i18n'

interface TagRow {
  user_id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  tagged_by: string
}

/** Who is tagged on a photo, with the people who may remove a tag, and a search to tag more batchmates. */
export function TagSheet({ photo, open, onClose, canManage }: { photo: PhotoRow; open: boolean; onClose: () => void; canManage: boolean }) {
  const tx = useT()
  const uid = useUserId()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const tags = useQuery({
    queryKey: ['photo-tags', photo.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('photo_tags_of', { p_photo: photo.id })
      if (error) throw error
      return (data ?? []) as TagRow[]
    },
  })
  const found = useQuery({
    queryKey: ['photo-tag-search', q],
    enabled: open && q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', { q: q.trim(), p_limit: 8 })
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; verification: string }[]
    },
  })
  const refresh = () => {
    void tags.refetch()
    void qc.invalidateQueries({ queryKey: photoQueryKey(photo.event_id) })
    void qc.invalidateQueries({ queryKey: photoQueryKey(null) })
  }
  async function tag(userId: string) {
    const { error } = await supabase.rpc('tag_photo', { p_photo: photo.id, p_user: userId })
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.tagged'))
    setQ('')
    refresh()
  }
  async function untag(userId: string) {
    const { error } = await supabase.rpc('untag_photo', { p_photo: photo.id, p_user: userId })
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.tagRemoved'))
    refresh()
  }
  const tagged = tags.data ?? []
  const already = new Set(tagged.map((t) => t.user_id))
  return (
    <Sheet open={open} onClose={onClose} label={tx('photos.tagTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('photos.tagTitle')}</h2>
        <p className="text-sm text-muted">{tx('photos.tagHint')}</p>
        {tags.isLoading ? (
          <Skeleton className="h-12" />
        ) : tagged.length === 0 ? (
          <p className="text-sm text-muted">{tx('photos.noTags')}</p>
        ) : (
          <ul className="space-y-2" aria-label={tx('photos.taggedHere')}>
            {tagged.map((t) => (
              <li key={t.user_id} className="flex items-center gap-3">
                <Avatar src={t.avatar_url} name={t.full_name} size={36} />
                <span className="min-w-0 flex-1 truncate font-medium">{t.full_name}{t.grad_year ? <span className="text-muted"> · {t.grad_year}</span> : null}</span>
                {(t.user_id === uid || t.tagged_by === uid || photo.uploaded_by === uid || canManage) && (
                  <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => untag(t.user_id)} aria-label={tx('photos.removeTagOf', { name: t.full_name })}>
                    {t.user_id === uid ? tx('photos.removeMyTag') : tx('photos.removeTag')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {uid && !already.has(uid) && (
          <Button variant="secondary" size="sm" icon={<UserCheck className="size-4" />} onClick={() => tag(uid)}>{tx('photos.thisIsMe')}</Button>
        )}
        <Field label={tx('photos.tagSearch')}>
          {(p) => (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" placeholder={tx('photos.tagSearchPh')} autoComplete="off" />
            </div>
          )}
        </Field>
        {q.trim().length >= 2 && (
          <ul className="space-y-1" aria-label={tx('photos.results')}>
            {(found.data ?? []).filter((m) => !already.has(m.id) && m.id !== uid).map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <Avatar src={m.avatar_url} name={m.full_name} size={36} />
                <span className="min-w-0 flex-1 truncate">{m.full_name}{m.grad_year ? <span className="text-muted"> · {m.grad_year}</span> : null}</span>
                <Button size="sm" icon={<Tag className="size-4" />} onClick={() => tag(m.id)}>{tx('photos.tagThem')}</Button>
              </li>
            ))}
            {found.data && found.data.filter((m) => !already.has(m.id) && m.id !== uid).length === 0 && <li className="text-sm text-muted">{tx('photos.noMatch')}</li>}
          </ul>
        )}
        <Button block variant="secondary" onClick={onClose}>{tx('common.done')}</Button>
      </div>
    </Sheet>
  )
}

export function ReportSheet({ photo, open, onClose }: { photo: PhotoRow; open: boolean; onClose: () => void }) {
  const tx = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    const { error } = await supabase.rpc('report_photo', { p_photo: photo.id, p_reason: reason })
    setBusy(false)
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.reported'))
    setReason('')
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} label={tx('photos.reportTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('photos.reportTitle')}</h2>
        <p className="text-sm text-muted">{tx('photos.reportHint')}</p>
        <Field label={tx('photos.reportReason')}>{(p) => <Textarea {...p} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={send}>{tx('photos.sendReport')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

export function EditPhotoSheet({ photo, open, onClose }: { photo: PhotoRow; open: boolean; onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const [caption, setCaption] = useState(photo.caption ?? '')
  const [hi, setHi] = useState(photo.caption_hi ?? '')
  const [alt, setAlt] = useState(photo.alt_text ?? '')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('admin_edit_photo', { p_photo: photo.id, p_caption: caption, p_caption_hi: hi, p_alt: alt })
    setBusy(false)
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.saved'))
    void qc.invalidateQueries({ queryKey: ['photos'] })
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} label={tx('photos.editTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('photos.editTitle')}</h2>
        <Field label={tx('photos.captionEn')} optional>{(p) => <Input {...p} value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} />}</Field>
        <Field label={tx('photos.captionHi')} optional hint={tx('photos.captionHiHint')}>{(p) => <Input {...p} value={hi} maxLength={300} lang="hi" onChange={(e) => setHi(e.target.value)} />}</Field>
        <Field label={tx('photos.altText')} optional hint={tx('photos.altHint')}>{(p) => <Input {...p} value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} />}</Field>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={busy} onClick={save}>{tx('common.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

export function SuggestSheet({ photo, open, onClose }: { photo: PhotoRow; open: boolean; onClose: () => void }) {
  const tx = useT()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    const { error } = await supabase.rpc('suggest_gallery_photo', { p_photo: photo.id, p_note: note })
    setBusy(false)
    if (error) return toast.error(photoError(error))
    toast.success(tx('gallery.suggested'))
    setNote('')
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} label={tx('gallery.suggestTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.suggestTitle')}</h2>
        <p className="text-sm text-muted">{tx('gallery.suggestHint')}</p>
        <img src={thumbUrl(photo)} alt="" className="h-32 rounded-xl object-cover" />
        <Field label={tx('gallery.suggestNote')} optional>{(p) => <Textarea {...p} value={note} rows={2} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={busy} onClick={send}>{tx('gallery.sendSuggestion')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

/** "Add to college gallery": picks the chip, album and title, then copies the picture into the gallery. */
export function GalleryAddSheet({ photos, open, onClose, suggestionId, onDone }: { photos: PhotoRow[]; open: boolean; onClose: () => void; suggestionId?: string; onDone?: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const cats = useGalleryCategories(open)
  const albums = useGalleryAlbums(open)
  const [category, setCategory] = useState('')
  const [album, setAlbum] = useState('')
  const [title, setTitle] = useState('')
  const [featured, setFeatured] = useState(false)
  const [taken, setTaken] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  async function add() {
    let n = 0
    let failed: unknown = null
    setProgress(0)
    for (const p of photos) {
      try {
        await (isVideo(p) ? addEventVideoToGallery : addEventPhotoToGallery)(p, {
          title: title || p.caption || undefined, category_id: category || null, album_id: album || null, is_featured: featured, taken_on: taken || null,
          suggestion_id: suggestionId ?? null,
        })
        n++
      } catch (e) {
        failed = e
      }
      setProgress(n)
    }
    setProgress(null)
    void qc.invalidateQueries({ queryKey: ['gallery-photos'] })
    void qc.invalidateQueries({ queryKey: ['gallery-featured'] })
    void qc.invalidateQueries({ queryKey: ['gallery-suggestions'] })
    if (failed) toast.error(photoError(failed))
    if (n) toast.success(tx('gallery.addedToast', { count: n }))
    if (n === photos.length) {
      onDone?.()
      onClose()
    }
  }
  return (
    <Sheet open={open} onClose={onClose} label={tx('gallery.addTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.addTitle')}</h2>
        <div className="flex gap-2 overflow-x-auto">{photos.slice(0, 6).map((p) => <img key={p.id} src={thumbUrl(p)} alt="" className="size-16 rounded-lg object-cover" />)}{photos.length > 6 && <Badge>+{photos.length - 6}</Badge>}</div>
        <p className="text-sm text-muted">{tx('gallery.addHint')}</p>
        <Field label={tx('gallery.chip')} optional>
          {(p) => (
            <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{tx('gallery.noChip')}</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{chipLabel(c, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx('gallery.album')} optional>
          {(p) => (
            <Select {...p} value={album} onChange={(e) => setAlbum(e.target.value)}>
              <option value="">{tx('gallery.noAlbum')}</option>
              {(albums.data ?? []).map((a) => <option key={a.id} value={a.id}>{albumTitle(a, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx('gallery.titleLabel')} optional>{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={tx('gallery.takenOn')} optional hint={tx('gallery.takenOnHint')}>{(p) => <Input {...p} type="date" value={taken} onChange={(e) => setTaken(e.target.value)} />}</Field>
        <Checkbox checked={featured} onChange={setFeatured}>{tx('gallery.featureIt')}</Checkbox>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={onClose} disabled={progress !== null}>{tx('common.cancel')}</Button>
          <Button block loading={progress !== null} onClick={add}>{progress !== null ? tx('gallery.addingN', { done: progress, total: photos.length }) : tx('gallery.addToGallery')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

