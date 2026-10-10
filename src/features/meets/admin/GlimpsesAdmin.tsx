import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, EyeOff, Film, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Badge, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { Field, Input, Select } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { useLang, useT } from '../../../i18n'
import { supabase } from '../../../lib/supabase'
import { glimpseCaption, glimpsePoster, isLive, moveItem, useGlimpses, type Glimpse } from '../../glimpses/api'
import { attachDriveVideo, inspectDriveVideo, sendVideoToDrive, UploadAborted, UploadRefused } from '../../photos/driveUpload'
import { parseDriveRef } from '../../photos/driveRef'
import { compressImageSizes, THUMB_SIZE } from '../../../lib/image'
import { photoError } from '../../photos/api'
import { MAX_GLIMPSE_BYTES, MAX_GLIMPSE_MS, MB, formatDuration, formatSize, placeholderPoster, readVideoInfo, videoMime, videoProblem } from '../../photos/video'
import { meetTitle, usePastMeets } from '../api'

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['glimpses'] })
}

/** Organise > Content > Glimpses: the short clips that autoplay on Home and the public landing page. */
export function GlimpsesAdmin() {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const { data, isLoading } = useGlimpses()
  const meets = usePastMeets()
  const [sheet, setSheet] = useState<{ glimpse: Glimpse | null } | null>(null)
  const list = data ?? []
  const shown = list.filter((g) => g.is_visible).length

  async function move(i: number, by: -1 | 1) {
    const next = moveItem(list, i, by)
    const { error } = await supabase.rpc('admin_glimpse_reorder', { p_ids: next.map((g) => g.id) })
    if (error) return toast.error(photoError(error))
    refresh(qc)
  }
  async function toggle(g: Glimpse) {
    const { error } = await supabase.rpc('admin_glimpse_update', { p_id: g.id, p: { is_visible: !g.is_visible } } as never)
    if (error) return toast.error(photoError(error))
    toast.success(g.is_visible ? tx('glimpse.hiddenToast') : tx('glimpse.shownToast'))
    refresh(qc)
  }
  async function remove(g: Glimpse) {
    if (!window.confirm(tx('glimpse.confirmRemove'))) return
    const { data: paths, error } = await supabase.rpc('admin_glimpse_remove', { p_id: g.id })
    if (error) return toast.error(photoError(error))
    void supabase.storage.from('glimpses').remove((paths as string[]) ?? [])
    toast.success(tx('glimpse.removedToast'))
    refresh(qc)
  }

  return (
    <div className="space-y-4" data-testid="glimpses-admin">
      <Notice tone="info">{tx('glimpse.adminHelp', { max: 4, mb: MAX_GLIMPSE_BYTES / MB, sec: MAX_GLIMPSE_MS / 1000 })}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" data-testid="glimpse-count">{tx('glimpse.shownCount', { shown, max: 4 })}</p>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setSheet({ glimpse: null })}>{tx('glimpse.add')}</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : list.length === 0 ? (
        <EmptyState icon={<Film />} title={tx('glimpse.none')}>{tx('glimpse.noneBody')}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((g, i) => {
            const meet = meets.data?.find((m) => m.id === g.meet_id)
            return (
              <li key={g.id} className="rounded-2xl border border-border bg-surface p-3" data-testid="glimpse-row" data-glimpse-id={g.id}>
                <div className="flex gap-3">
                  <img src={glimpsePoster(g)} alt="" className="h-20 w-32 shrink-0 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-semibold">{glimpseCaption(g, lang) ?? tx('glimpse.noCaption')}</p>
                    <p className="text-sm text-muted">{[g.year, g.duration_ms ? formatDuration(g.duration_ms) : null, formatSize(g.size_bytes)].filter(Boolean).join(' · ')}</p>
                    {meet && <p className="truncate text-sm text-muted">{tx('glimpse.ofMeet', { meet: meetTitle(meet, lang) })}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {isLive(g) ? <Badge tone="success">{tx('glimpse.live')}</Badge> : !g.drive_file_id ? <Badge tone="warning">{tx('glimpse.notSent')}</Badge> : <Badge>{tx('glimpse.hidden')}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<ArrowUp className="size-4" />} aria-label={tx('glimpse.moveUp')} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="secondary" icon={<ArrowDown className="size-4" />} aria-label={tx('glimpse.moveDown')} disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="secondary" icon={g.is_visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => toggle(g)}>{g.is_visible ? tx('glimpse.hide') : tx('glimpse.show')}</Button>
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setSheet({ glimpse: g })}>{tx('common.edit')}</Button>
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => remove(g)}>{tx('glimpse.remove')}</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {sheet && <GlimpseSheet glimpse={sheet.glimpse} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Add a glimpse (a video file is needed) or edit one (a new video file replaces the clip). */
function GlimpseSheet({ glimpse, onClose }: { glimpse: Glimpse | null; onClose: () => void }) {
  const tx = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const meets = usePastMeets()
  const [f, setF] = useState({ caption: glimpse?.caption ?? '', caption_hi: glimpse?.caption_hi ?? '', year: glimpse?.year ? String(glimpse.year) : '', meet: glimpse?.meet_id ?? '' })
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<'upload' | 'drive'>('upload')
  const [driveLink, setDriveLink] = useState('')
  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  function pick(picked: File | undefined) {
    setError(null)
    setFile(null)
    if (!picked) return
    const problem = videoProblem(picked, MAX_GLIMPSE_BYTES)
    if (problem === 'format') return setError(tx('photos.errVideoFormat'))
    if (problem === 'empty') return setError(tx('photos.errVideoEmpty'))
    if (problem === 'tooBig') return setError(tx('glimpse.errBig', { mb: MAX_GLIMPSE_BYTES / MB }))
    setFile(picked)
  }

  async function save() {
    setError(null)
    const year = f.year.trim() ? Number(f.year) : null
    if (year !== null && (!Number.isInteger(year) || year < 1980 || year > 2100)) return setError(tx('glimpse.errYear'))
    const ref = source === 'drive' ? driveLink.trim() : ''
    if (source === 'drive' && ref) {
      const parsed = parseDriveRef(ref)
      if ('error' in parsed) return setError(tx(parsed.error === 'folder' ? 'glimpse.errFolder' : 'glimpse.errLink'))
    }
    if (!glimpse && !file && !ref) return setError(tx(source === 'drive' ? 'glimpse.errNoLink' : 'glimpse.errNoFile'))
    setBusy(true)
    let posterPath: string | null = null
    let newId: string | null = null
    try {
      const fields = { caption: f.caption, caption_hi: f.caption_hi, year }
      let id = glimpse?.id ?? null
      if (file || ref) {
        let mime: string
        let size: number
        let info: { duration_ms: number | null; width: number | null; height: number | null; poster: { blob: Blob; ext: string; type: string } }
        if (file) {
          mime = videoMime(file)!
          size = file.size
          const read = await readVideoInfo(file)
          if (read.duration_ms && read.duration_ms > MAX_GLIMPSE_MS) throw new Error(tx('glimpse.errLong', { sec: MAX_GLIMPSE_MS / 1000 }))
          info = read
        } else {
          // a video already in Drive: the app checks it can open it; the poster is the picture given, or a plain card
          const found = await inspectDriveVideo('glimpse', ref)
          mime = found.mime_type
          size = found.size_bytes
          const [img] = posterFile ? await compressImageSizes(posterFile, [{ maxSide: THUMB_SIZE, quality: 0.75 }]) : [await placeholderPoster()]
          info = { duration_ms: null, width: null, height: null, poster: img! }
        }
        posterPath = `glimpses/${crypto.randomUUID()}_p.${info.poster.ext}`
        const up = await supabase.storage.from('glimpses').upload(posterPath, info.poster.blob, { contentType: info.poster.type, cacheControl: '31536000' })
        if (up.error) throw up.error
        const media = { poster_path: posterPath, mime_type: mime, size_bytes: size, duration_ms: info.duration_ms, width: info.width, height: info.height }
        if (id) {
          const r = await supabase.rpc('admin_glimpse_update', { p_id: id, p: { ...fields, ...media } } as never)
          if (r.error) throw r.error
          void supabase.storage.from('glimpses').remove((r.data as string[]) ?? [])
        } else {
          const r = await supabase.rpc('admin_glimpse_add', { p: { ...fields, ...media } } as never)
          if (r.error) throw r.error
          id = newId = r.data as unknown as string
        }
        refresh(qc)
        abort.current = new AbortController()
        try {
          if (file) {
            setPct(0)
            await sendVideoToDrive({ target: { kind: 'glimpse', id: id! }, file, mime, signal: abort.current.signal, onProgress: (s, t) => setPct((s / t) * 100) })
          } else await attachDriveVideo('glimpse', id!, ref)
        } catch (e) {
          if (newId) {
            // a brand new glimpse that never arrived is taken away again; a replacement stays "not sent" so it can be retried
            const rm = await supabase.rpc('admin_glimpse_remove', { p_id: newId })
            void supabase.storage.from('glimpses').remove((rm.data as string[]) ?? [posterPath])
            newId = null
          }
          throw e
        }
      } else if (id) {
        const r = await supabase.rpc('admin_glimpse_update', { p_id: id, p: fields } as never)
        if (r.error) throw r.error
      }
      if (id && (f.meet || glimpse?.meet_id)) {
        const m = await supabase.rpc('admin_glimpse_set_meet', { p_id: id, p_meet: f.meet || null } as never)
        if (m.error) throw m.error
      }
      toast.success(tx('glimpse.savedToast'))
      refresh(qc)
      onClose()
    } catch (e) {
      const msg = e instanceof UploadAborted ? tx('photos.cancelled') : e instanceof UploadRefused ? (e.message === 'drive-not-set-up' ? tx('glimpse.errNoDrive') : e.message) : e instanceof Error && !('code' in e) ? e.message : photoError(e)
      setError(msg)
      refresh(qc)
    } finally {
      setBusy(false)
      setPct(null)
    }
  }

  return (
    <Sheet open onClose={() => !busy && onClose()} label={glimpse ? tx('glimpse.editTitle') : tx('glimpse.add')} className="max-h-[92dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{glimpse ? tx('glimpse.editTitle') : tx('glimpse.add')}</h2>
        {glimpse && <img src={glimpsePoster(glimpse)} alt="" className="h-28 rounded-xl object-cover" />}
        <div role="tablist" aria-label={tx('glimpse.source')} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {([['upload', tx('glimpse.srcUpload')], ['drive', tx('glimpse.srcDrive')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={source === k} disabled={busy} onClick={() => { setSource(k); if (k === 'drive') setFile(null); else setDriveLink('') }} className={source === k ? 'min-h-11 rounded-full bg-surface text-sm font-semibold text-primary shadow-sm' : 'min-h-11 rounded-full text-sm font-semibold text-muted'}>{label}</button>
          ))}
        </div>
        {source === 'upload' ? (
          <>
            <Field label={glimpse ? tx('glimpse.replaceFile') : tx('glimpse.file')} optional={!!glimpse} hint={tx('glimpse.fileHint', { mb: MAX_GLIMPSE_BYTES / MB, sec: MAX_GLIMPSE_MS / 1000 })}>
              {(p) => <Input {...p} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} data-testid="glimpse-file" />}
            </Field>
            {file && <p className="text-sm text-muted">{file.name} · {formatSize(file.size)}</p>}
          </>
        ) : (
          <>
            <Field label={tx('glimpse.driveLink')} optional={!!glimpse} hint={tx('glimpse.driveLinkHint')}>
              {(p) => <Input {...p} value={driveLink} disabled={busy} autoComplete="off" placeholder="https://drive.google.com/file/d/…" onChange={(e) => setDriveLink(e.target.value)} data-testid="glimpse-drive-link" />}
            </Field>
            <Field label={tx('glimpse.posterFile')} optional hint={tx('glimpse.posterHint')}>
              {(p) => <Input {...p} type="file" accept="image/*" disabled={busy} onChange={(e) => setPosterFile(e.target.files?.[0] ?? null)} data-testid="glimpse-poster-file" />}
            </Field>
          </>
        )}
        <Field label={tx('glimpse.caption')} optional>{(p) => <Input {...p} value={f.caption} maxLength={140} disabled={busy} onChange={(e) => set('caption', e.target.value)} />}</Field>
        <Field label={tx('glimpse.captionHi')} optional>{(p) => <Input {...p} value={f.caption_hi} maxLength={140} lang="hi" disabled={busy} onChange={(e) => set('caption_hi', e.target.value)} />}</Field>
        <Field label={tx('glimpse.year')} optional>{(p) => <Input {...p} inputMode="numeric" value={f.year} maxLength={4} disabled={busy} onChange={(e) => set('year', e.target.value.replace(/\D/g, ''))} />}</Field>
        <Field label={tx('glimpse.meet')} optional>
          {(p) => (
            <Select {...p} value={f.meet} disabled={busy} onChange={(e) => set('meet', e.target.value)}>
              <option value="">{tx('glimpse.noMeet')}</option>
              {(meets.data ?? []).map((m) => <option key={m.id} value={m.id}>{meetTitle(m, lang)}</option>)}
            </Select>
          )}
        </Field>
        {pct !== null && (
          <div className="space-y-1" data-testid="glimpse-progress">
            <div className="flex justify-between text-sm"><span>{tx('gallery.sendingVideo')}</span><span className="tabular-nums text-muted">{Math.round(pct)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
            <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>{tx('photos.cancelOne')}</Button>
          </div>
        )}
        {error && <Notice tone="danger" title={error} />}
        <div className="flex gap-2">
          <Button block variant="secondary" disabled={busy} onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={busy} onClick={save}>{tx('common.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}
