import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Badge, EmptyState, Skeleton } from '../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useLang, useT } from '../../i18n'
import { supabase } from '../../lib/supabase'
import { addGalleryVideoRow, addToGallery, albumTitle, chipLabel, galleryUrl, photoError, useGalleryAlbums, useGalleryCategories, useGallerySuggestions, type GalleryPhoto, type PhotoRow } from './api'
import { GalleryAddSheet } from './PhotoSheets'
import { sendVideoToDrive, UploadAborted } from './driveUpload'
import { MAX_VIDEO_BYTES, MB, isVideoFile, readVideoInfo, videoMime, videoProblem } from './video'
import { FatalUpload } from './PhotoUpload'

/** One video into the gallery: the poster and the row first, then the file to Drive in chunks. A failure takes the half-made row away again. */
async function addGalleryVideo(f: File, meta: Parameters<typeof addToGallery>[1], onProgress: (pct: number) => void, signal: AbortSignal): Promise<void> {
  const mime = videoMime(f)
  const problem = videoProblem(f)
  if (!mime || problem === 'format') throw new FatalUpload('photos.errVideoFormat')
  if (problem === 'empty') throw new FatalUpload('photos.errVideoEmpty')
  if (problem === 'tooBig') throw new FatalUpload('photos.errVideoBig', { mb: MAX_VIDEO_BYTES / MB })
  const info = await readVideoInfo(f)
  const row = await addGalleryVideoRow(info.poster.blob, info.poster.ext, { ...meta, mime_type: mime, size_bytes: f.size, duration_ms: info.duration_ms, width: info.width, height: info.height })
  try {
    await sendVideoToDrive({ target: { kind: 'gallery', id: row.id }, file: f, mime, signal, onProgress: (s, t) => onProgress((s / t) * 100) })
  } catch (e) {
    await row.remove().catch(() => {})
    throw e
  }
}

const refreshGallery = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ['gallery-photos', 'gallery-categories', 'gallery-albums', 'gallery-featured', 'gallery-on-this-day', 'gallery-suggestions']) void qc.invalidateQueries({ queryKey: [k] })
}

/** Direct upload of one or many pictures into the gallery. */
export function GalleryUploadSheet({ files, onClose }: { files: File[]; onClose: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const cats = useGalleryCategories()
  const albums = useGalleryAlbums()
  const [category, setCategory] = useState('')
  const [album, setAlbum] = useState('')
  const [title, setTitle] = useState('')
  const [featured, setFeatured] = useState(false)
  const [taken, setTaken] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  async function go() {
    let n = 0
    let last: unknown = null
    setDone(0)
    for (const f of files) {
      const meta = { title: files.length === 1 ? title : undefined, category_id: category || null, album_id: album || null, is_featured: featured, taken_on: taken || null }
      try {
        if (isVideoFile(f)) {
          abort.current = new AbortController()
          setPct(0)
          await addGalleryVideo(f, meta, setPct, abort.current.signal)
        } else await addToGallery(f, meta)
        n++
      } catch (e) {
        last = e instanceof FatalUpload ? new Error(e.message) : e instanceof UploadAborted ? new Error(tx('photos.cancelled')) : e
      }
      setPct(null)
      setDone(n)
    }
    setDone(null)
    refreshGallery(qc)
    if (last) toast.error(photoError(last))
    if (n) toast.success(tx('gallery.addedToast', { count: n }))
    if (n === files.length) onClose()
  }
  return (
    <Sheet open onClose={onClose} label={tx('gallery.uploadTitle')}>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.uploadTitle')}</h2>
        <p className="text-sm text-muted">{tx('gallery.uploadCount', { count: files.length })}</p>
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
        {files.length === 1 && <Field label={tx('gallery.titleLabel')} optional>{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>}
        <Field label={tx('gallery.takenOn')} optional hint={tx('gallery.takenOnHint')}>{(p) => <Input {...p} type="date" value={taken} onChange={(e) => setTaken(e.target.value)} />}</Field>
        <Checkbox checked={featured} onChange={setFeatured}>{tx('gallery.featureIt')}</Checkbox>
        {pct !== null && (
          <div className="space-y-1" data-testid="gallery-video-progress">
            <div className="flex items-center justify-between text-sm"><span>{tx('gallery.sendingVideo')}</span><span className="tabular-nums text-muted">{Math.round(pct)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
            <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>{tx('photos.cancelOne')}</Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button block variant="secondary" disabled={done !== null} onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={done !== null} icon={<ImagePlus className="size-4" />} onClick={go}>{done !== null ? tx('gallery.addingN', { done, total: files.length }) : tx('gallery.addToGallery')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Edit, feature, pair or remove one gallery photo. */
export function GalleryEditSheet({ photo, others, onClose }: { photo: GalleryPhoto; others: GalleryPhoto[]; onClose: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const cats = useGalleryCategories()
  const albums = useGalleryAlbums()
  const [f, setF] = useState({
    title: photo.title ?? '', title_hi: photo.title_hi ?? '', alt_text: photo.alt_text ?? '', category_id: photo.category_id ?? '', album_id: photo.album_id ?? '',
    taken_on: photo.taken_on ?? '', is_featured: photo.is_featured, pair_of: photo.pair_of ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('admin_gallery_update', {
      p_id: photo.id,
      p: { title: f.title, title_hi: f.title_hi, alt_text: f.alt_text, category_id: f.category_id || null, album_id: f.album_id || null, taken_on: f.taken_on || null, is_featured: f.is_featured, pair_of: f.pair_of || null },
    })
    setBusy(false)
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.saved'))
    refreshGallery(qc)
    onClose()
  }
  async function remove() {
    if (!window.confirm(tx('gallery.confirmRemove'))) return
    const { data, error } = await supabase.rpc('admin_gallery_remove', { p_id: photo.id })
    if (error) return toast.error(photoError(error))
    void supabase.storage.from('gallery').remove((data as string[]) ?? [])
    toast.success(tx('gallery.removed'))
    refreshGallery(qc)
    onClose()
  }
  return (
    <Sheet open onClose={onClose} label={tx('gallery.editTitle')} className="max-h-[90dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.editTitle')}</h2>
        <img src={galleryUrl(photo.thumb_path)} alt="" className="h-32 rounded-xl object-cover" />
        <Field label={tx('gallery.titleLabel')} optional>{(p) => <Input {...p} value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}</Field>
        <Field label={tx('gallery.titleHi')} optional>{(p) => <Input {...p} value={f.title_hi} maxLength={120} lang="hi" onChange={(e) => set('title_hi', e.target.value)} />}</Field>
        <Field label={tx('photos.altText')} optional hint={tx('photos.altHint')}>{(p) => <Input {...p} value={f.alt_text} maxLength={300} onChange={(e) => set('alt_text', e.target.value)} />}</Field>
        <Field label={tx('gallery.chip')} optional>
          {(p) => (
            <Select {...p} value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">{tx('gallery.noChip')}</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{chipLabel(c, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx('gallery.album')} optional>
          {(p) => (
            <Select {...p} value={f.album_id} onChange={(e) => set('album_id', e.target.value)}>
              <option value="">{tx('gallery.noAlbum')}</option>
              {(albums.data ?? []).map((a) => <option key={a.id} value={a.id}>{albumTitle(a, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx('gallery.takenOn')} optional hint={tx('gallery.takenOnHint')}>{(p) => <Input {...p} type="date" value={f.taken_on} onChange={(e) => set('taken_on', e.target.value)} />}</Field>
        <Field label={tx('gallery.pairWith')} optional hint={tx('gallery.pairHint')}>
          {(p) => (
            <Select {...p} value={f.pair_of} onChange={(e) => set('pair_of', e.target.value)}>
              <option value="">{tx('gallery.noPair')}</option>
              {others.filter((o) => o.id !== photo.id).map((o) => <option key={o.id} value={o.id}>{galleryTitle2(o, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Checkbox checked={f.is_featured} onChange={(v) => set('is_featured', v)}>{tx('gallery.featureIt')}</Checkbox>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={busy} onClick={save}>{tx('common.save')}</Button>
        </div>
        <Button block variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={remove}>{tx('gallery.remove')}</Button>
      </div>
    </Sheet>
  )
}
const galleryTitle2 = (p: GalleryPhoto, lang: string) => (lang === 'hi' ? p.title_hi || p.title : p.title || p.title_hi) || p.id.slice(0, 6)

/** The filter chips: rename, translate, reorder, add, delete. */
export function ChipsSheet({ onClose }: { onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const cats = useGalleryCategories()
  const [draft, setDraft] = useState<Record<string, { label: string; label_hi: string }>>({})
  const [fresh, setFresh] = useState({ label: '', label_hi: '' })
  const list = cats.data ?? []
  const val = (id: string, k: 'label' | 'label_hi', fallback: string | null) => draft[id]?.[k] ?? fallback ?? ''
  const edit = (id: string, k: 'label' | 'label_hi', v: string, c: { label: string; label_hi: string | null }) =>
    setDraft((d) => ({ ...d, [id]: { label: d[id]?.label ?? c.label, label_hi: d[id]?.label_hi ?? c.label_hi ?? '', [k]: v } }))
  async function save(id: string | null, label: string, hi: string) {
    const { error } = await supabase.rpc('admin_gallery_save_category', { p_id: id, p_label: label, p_label_hi: hi })
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.saved'))
    if (id) setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== id)))
    else setFresh({ label: '', label_hi: '' })
    refreshGallery(qc)
  }
  async function del(id: string) {
    if (!window.confirm(tx('gallery.confirmChipDelete'))) return
    const { error } = await supabase.rpc('admin_gallery_delete_category', { p_id: id })
    if (error) return toast.error(photoError(error))
    refreshGallery(qc)
  }
  async function move(i: number, d: -1 | 1) {
    const ids = list.map((c) => c.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    const { error } = await supabase.rpc('admin_gallery_reorder_categories', { p_ids: ids })
    if (error) return toast.error(photoError(error))
    refreshGallery(qc)
  }
  return (
    <Sheet open onClose={onClose} label={tx('gallery.chipsTitle')} className="max-h-[90dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.chipsTitle')}</h2>
        <p className="text-sm text-muted">{tx('gallery.chipsHint')}</p>
        {cats.isLoading ? <Skeleton className="h-24" /> : (
          <ul className="space-y-3">
            {list.map((c, i) => (
              <li key={c.id} className="space-y-2 rounded-2xl border border-border p-3">
                <Input aria-label={tx('gallery.chipName')} value={val(c.id, 'label', c.label)} maxLength={40} onChange={(e) => edit(c.id, 'label', e.target.value, c)} />
                <Input aria-label={tx('gallery.chipNameHi')} placeholder={tx('gallery.chipNameHi')} lang="hi" value={val(c.id, 'label_hi', c.label_hi)} maxLength={40} onChange={(e) => edit(c.id, 'label_hi', e.target.value, c)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!draft[c.id]} onClick={() => save(c.id, draft[c.id]!.label, draft[c.id]!.label_hi)}>{tx('common.save')}</Button>
                  <Button size="sm" variant="secondary" aria-label={tx('gallery.moveUp')} disabled={i === 0} icon={<ArrowUp className="size-4" />} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="secondary" aria-label={tx('gallery.moveDown')} disabled={i === list.length - 1} icon={<ArrowDown className="size-4" />} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => del(c.id)}>{tx('common.delete')}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <p className="text-sm font-semibold">{tx('gallery.newChip')}</p>
          <Input aria-label={tx('gallery.chipName')} placeholder={tx('gallery.chipName')} value={fresh.label} maxLength={40} onChange={(e) => setFresh({ ...fresh, label: e.target.value })} />
          <Input aria-label={tx('gallery.chipNameHi')} placeholder={tx('gallery.chipNameHi')} lang="hi" value={fresh.label_hi} maxLength={40} onChange={(e) => setFresh({ ...fresh, label_hi: e.target.value })} />
          <Button size="sm" disabled={!fresh.label.trim()} onClick={() => save(null, fresh.label, fresh.label_hi)}>{tx('gallery.addChip')}</Button>
        </div>
        <Button block variant="secondary" onClick={onClose}>{tx('common.done')}</Button>
      </div>
    </Sheet>
  )
}

/** Albums are optional groups: create, rename, delete. */
export function AlbumsSheet({ onClose }: { onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const albums = useGalleryAlbums()
  const [f, setF] = useState({ title: '', title_hi: '', description: '' })
  async function create() {
    const { error } = await supabase.rpc('admin_gallery_save_album', { p_id: null, p_title: f.title, p_title_hi: f.title_hi, p_description: f.description })
    if (error) return toast.error(photoError(error))
    toast.success(tx('photos.saved'))
    setF({ title: '', title_hi: '', description: '' })
    refreshGallery(qc)
  }
  async function rename(id: string, title: string, hi: string | null, desc: string | null) {
    const t = window.prompt(tx('gallery.albumName'), title)
    if (!t?.trim()) return
    const { error } = await supabase.rpc('admin_gallery_save_album', { p_id: id, p_title: t, p_title_hi: hi, p_description: desc })
    if (error) return toast.error(photoError(error))
    refreshGallery(qc)
  }
  async function del(id: string) {
    if (!window.confirm(tx('gallery.confirmAlbumDelete'))) return
    const { error } = await supabase.rpc('admin_gallery_delete_album', { p_id: id })
    if (error) return toast.error(photoError(error))
    refreshGallery(qc)
  }
  return (
    <Sheet open onClose={onClose} label={tx('gallery.albumsTitle')} className="max-h-[90dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.albumsTitle')}</h2>
        <p className="text-sm text-muted">{tx('gallery.albumsHint')}</p>
        <ul className="space-y-2">
          {(albums.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-2xl border border-border p-3">
              <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
              <Button size="sm" variant="secondary" onClick={() => rename(a.id, a.title, a.title_hi, a.description)}>{tx('gallery.rename')}</Button>
              <Button size="sm" variant="danger-ghost" aria-label={tx('common.delete')} icon={<Trash2 className="size-4" />} onClick={() => del(a.id)} />
            </li>
          ))}
        </ul>
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <Input aria-label={tx('gallery.albumName')} placeholder={tx('gallery.albumName')} value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Input aria-label={tx('gallery.albumNameHi')} placeholder={tx('gallery.albumNameHi')} lang="hi" value={f.title_hi} maxLength={80} onChange={(e) => setF({ ...f, title_hi: e.target.value })} />
          <Textarea aria-label={tx('gallery.albumDescription')} placeholder={tx('gallery.albumDescription')} rows={2} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Button size="sm" disabled={!f.title.trim()} onClick={create}>{tx('gallery.createAlbum')}</Button>
        </div>
        <Button block variant="secondary" onClick={onClose}>{tx('common.done')}</Button>
      </div>
    </Sheet>
  )
}

/** Photos members suggested: add one to the gallery or decline it. */
export function SuggestionsSheet({ onClose }: { onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const list = useGallerySuggestions(true)
  const [adding, setAdding] = useState<{ photo: PhotoRow; id: string } | null>(null)
  async function decline(id: string) {
    const { error } = await supabase.rpc('admin_gallery_decline_suggestion', { p_id: id })
    if (error) return toast.error(photoError(error))
    toast.success(tx('gallery.declined'))
    refreshGallery(qc)
  }
  return (
    <>
    <Sheet open={!adding} onClose={onClose} label={tx('gallery.suggestionsTitle')} className="max-h-[90dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{tx('gallery.suggestionsTitle')}</h2>
        {list.isLoading ? <Skeleton className="h-24" /> : !list.data?.length ? (
          <EmptyState title={tx('gallery.noSuggestions')} />
        ) : (
          <ul className="space-y-3">
            {list.data.map((s) => (
              <li key={s.id} className="flex gap-3 rounded-2xl border border-border p-3" data-suggestion={s.id}>
                <img src={supabase.storage.from('event-photos').getPublicUrl(s.thumb_path).data.publicUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-semibold">{s.suggester_name}</p>
                  <p className="truncate text-xs text-muted">{s.event_title}</p>
                  {s.note && <p className="line-clamp-2 text-sm">{s.note}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => setAdding({ id: s.id, photo: { id: s.photo_id, event_id: s.event_id, storage_path: s.storage_path, thumb_path: s.thumb_path, caption: s.caption, alt_text: null, media_kind: s.media_kind, width: s.width, height: s.height } as PhotoRow })}>{tx('gallery.addToGallery')}</Button>
                    <Button size="sm" variant="secondary" onClick={() => decline(s.id)}>{tx('gallery.decline')}</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button block variant="secondary" onClick={onClose}>{tx('common.done')}</Button>
      </div>
    </Sheet>
    {adding && <GalleryAddSheet photos={[adding.photo]} suggestionId={adding.id} open onClose={() => setAdding(null)} />}
    </>
  )
}

export function PendingBadge({ n }: { n: number }) {
  return n > 0 ? <Badge tone="warning">{n}</Badge> : null
}
