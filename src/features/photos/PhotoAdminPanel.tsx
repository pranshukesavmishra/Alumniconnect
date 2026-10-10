import { useQueryClient } from '@tanstack/react-query'
import { Archive, Copy, ExternalLink, Images, MonitorPlay, QrCode as QrIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Card, Notice } from '../../components/ui/Display'
import { ChoiceGroup } from '../../components/ui/Form'
import { QrCode } from '../../components/ui/QrCode'
import { useT } from '../../i18n'
import { supabase } from '../../lib/supabase'
import { ZipBuilder } from '../../lib/zip'
import type { EventRow } from '../../lib/types'
import { fetchPhotos, photoError, photoUrl, useCurrentVote, usePhotoSummary, type PhotoCaps, type PhotoScope } from './api'

export const uploadLink = (slug: string) => `${window.location.origin}/events/${slug}/photos/upload`

/** Everything an event's photo managers need in one place: counts, who may upload, the QR, the slideshow, the ZIP and the vote. */
export function PhotoAdminPanel({ event, caps, onView }: { event: EventRow; caps: PhotoCaps; onView?: (s: PhotoScope) => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const summary = usePhotoSummary(event.id)
  const vote = useCurrentVote(event.id)
  const [mode, setMode] = useState<'immediate' | 'approval' | 'off'>(caps.member_uploads)
  const [zip, setZip] = useState<{ done: number; total: number } | null>(null)
  const s = summary.data
  const link = uploadLink(event.slug)

  async function changeMode(m: 'immediate' | 'approval' | 'off') {
    const before = mode
    setMode(m)
    const { error } = await supabase.rpc('admin_set_photo_settings', { p_event: event.id, p_member_uploads: m })
    if (error) {
      setMode(before)
      return toast.error(photoError(error))
    }
    toast.success(tx('photos.settingSaved'))
    void qc.invalidateQueries({ queryKey: ['photo-caps', event.id] })
  }

  async function downloadZip() {
    setZip({ done: 0, total: s?.total ?? 0 })
    try {
      const all = []
      for (let off = 0; ; off += 200) {
        const page = await fetchPhotos(event.id, { scope: 'approved', order: 'new', media: 'photo' }, off, 200)
        all.push(...page)
        if (page.length < 200) break
      }
      const z = new ZipBuilder()
      let skipped = 0
      for (const [i, p] of all.entries()) {
        try {
          const res = await fetch(photoUrl(p))
          if (!res.ok) throw new Error(String(res.status))
          const ext = p.storage_path.split('.').pop() ?? 'jpg'
          z.add(`${String(i + 1).padStart(4, '0')}-${p.source}-${p.id.slice(0, 8)}.${ext}`, new Uint8Array(await res.arrayBuffer()))
        } catch {
          skipped++
        }
        setZip({ done: i + 1, total: all.length })
      }
      if (!z.count) throw new Error(tx('photos.zipNone'))
      const { error } = await supabase.rpc('admin_log_photo_export', { p_event: event.id, p_count: z.count })
      if (error) throw error
      const a = document.createElement('a')
      a.href = URL.createObjectURL(z.finish())
      a.download = `${event.slug}-photos.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
      toast.success(skipped ? tx('photos.zipDonePartial', { count: z.count, skipped }) : tx('photos.zipDone', { count: z.count }))
    } catch (e) {
      toast.error(photoError(e))
    } finally {
      setZip(null)
    }
  }

  const chip = (label: string, n: number | null | undefined, scope: PhotoScope) => (
    <button key={scope} type="button" onClick={() => onView?.(scope)} className="min-h-11 rounded-full border border-border bg-surface px-3.5 text-sm font-semibold hover:border-primary/50">
      {label} <span className="tabular-nums text-primary">{n ?? 0}</span>
    </button>
  )

  return (
    <Card className="space-y-5 p-4" aria-label={tx('photos.manage')}>
      <div>
        <h2 className="text-base font-bold">{tx('photos.manage')}</h2>
        <p className="text-sm text-muted">{tx('photos.manageHint')}</p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label={tx('photos.counts')}>
        {chip(tx('photos.countWaiting'), s?.pending, 'pending')}
        {chip(tx('photos.countHidden'), s?.hidden, 'hidden')}
        {chip(tx('photos.countReported'), s?.reported, 'reported')}
        <span className="inline-flex min-h-11 items-center px-1 text-sm text-muted">{tx('photos.countTotals', { total: s?.total ?? 0, official: s?.official ?? 0, members: s?.members ?? 0 })}</span>
      </div>

      <ChoiceGroup
        label={tx('photos.memberUploads')}
        value={mode}
        onChange={changeMode}
        options={[
          { value: 'immediate', label: tx('photos.modeImmediate'), hint: tx('photos.modeImmediateHint') },
          { value: 'approval', label: tx('photos.modeApproval'), hint: tx('photos.modeApprovalHint') },
          { value: 'off', label: tx('photos.modeOff'), hint: tx('photos.modeOffHint') },
        ]}
      />

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><QrIcon className="size-4" aria-hidden />{tx('photos.qrTitle')}</p>
        <p className="text-sm text-muted">{tx('photos.qrHint')}</p>
        <div className="flex flex-wrap items-center gap-4">
          <QrCode value={link} size={168} label={tx('photos.qrLabel')} />
          <div className="flex min-w-0 flex-col gap-2">
            <code className="max-w-full truncate rounded-lg bg-surface-2 px-2 py-1 text-xs" data-testid="upload-link">{link}</code>
            <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(tx('photos.linkCopied')))}>{tx('photos.copyLink')}</Button>
            <ButtonLink size="sm" variant="secondary" to={`/events/${event.slug}/photos/upload`} icon={<ExternalLink className="size-4" />}>{tx('photos.openUploadPage')}</ButtonLink>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ButtonLink to={`/events/${event.slug}/photos/slideshow`} icon={<MonitorPlay className="size-4" />}>{tx('photos.startSlideshow')}</ButtonLink>
        <Button variant="secondary" loading={!!zip} icon={<Archive className="size-4" />} onClick={downloadZip}>
          {zip ? tx('photos.zipProgress', { done: zip.done, total: zip.total }) : tx('photos.downloadZip')}
        </Button>
        {caps.gallery && <ButtonLink variant="secondary" to="/gallery" icon={<Images className="size-4" />}>{tx('gallery.openGallery')}</ButtonLink>}
      </div>
      <p className="text-sm text-muted">{tx('photos.zipNote')}</p>

      {vote.data && !vote.data.closed ? (
        <Notice tone="info">{tx('photos.voteOpenNote', { title: vote.data.title })}</Notice>
      ) : (
        <Notice tone="info">{tx('photos.voteHowTo')}</Notice>
      )}
    </Card>
  )
}
