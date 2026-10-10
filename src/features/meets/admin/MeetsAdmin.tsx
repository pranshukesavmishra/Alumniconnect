import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Badge, EmptyState, Notice, Skeleton } from '../../../components/ui/Display'
import { Checkbox, Field, Input, Select, Textarea } from '../../../components/ui/Form'
import { Sheet } from '../../../components/ui/Sheet'
import { useLang, useT } from '../../../i18n'
import { compressImageSizes } from '../../../lib/image'
import { supabase } from '../../../lib/supabase'
import { photoError } from '../../photos/api'
import { groupByYear, meetCover, meetTitle, usePastMeets, type PastMeet } from '../api'

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['past-meets'] })
  void qc.invalidateQueries({ queryKey: ['past-meet'] })
  void qc.invalidateQueries({ queryKey: ['meet-event'] })
}

/** Organise > Content > Past meets: create and edit the archive of earlier alumni meets. */
export function MeetsAdmin({ editId }: { editId?: string | null }) {
  const tx = useT()
  const { lang } = useLang()
  const { data, isLoading } = usePastMeets()
  const [sheet, setSheet] = useState<{ meet: PastMeet | null } | null>(null)
  const [opened, setOpened] = useState(false)
  const groups = groupByYear(data ?? [])
  if (editId && !opened && data) {
    const m = data.find((x) => x.id === editId)
    setOpened(true)
    if (m) setSheet({ meet: m })
  }
  return (
    <div className="space-y-4" data-testid="meets-admin">
      <Notice tone="info">{tx('meets.adminHelp')}</Notice>
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setSheet({ meet: null })}>{tx('meets.add')}</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : groups.length === 0 ? (
        <EmptyState title={tx('meets.empty')}>{tx('meets.emptyBody')}</EmptyState>
      ) : (
        groups.map(([year, meets]) => (
          <section key={year} className="space-y-2">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{year}</h3>
            <ul className="space-y-2">
              {meets.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3" data-testid="meet-admin-row" data-meet-slug={m.slug}>
                  {meetCover(m) ? <img src={meetCover(m)!} alt="" className="size-14 shrink-0 rounded-xl object-cover" /> : <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"><ImagePlus className="size-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{meetTitle(m, lang)}</p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <Badge tone={m.is_published ? 'success' : 'warning'}>{m.is_published ? tx('meets.published') : tx('meets.draft')}</Badge>
                      {m.members_can_add && <Badge>{tx('meets.membersAdd')}</Badge>}
                    </div>
                  </div>
                  <Link to={`/meets/${m.slug}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary">{tx('meets.view')}</Link>
                  <Button size="sm" variant="secondary" onClick={() => setSheet({ meet: m })}>{tx('common.edit')}</Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {sheet && <MeetSheet meet={sheet.meet} onClose={() => setSheet(null)} />}
    </div>
  )
}

const empty = (m: PastMeet | null) => ({
  title: m?.title ?? '', title_hi: m?.title_hi ?? '', year: m ? String(m.year) : String(new Date().getFullYear() - 1), held_on: m?.held_on ?? '', venue: m?.venue ?? '',
  description: m?.description ?? '', description_hi: m?.description_hi ?? '', highlights: m?.highlights ?? '', highlights_hi: m?.highlights_hi ?? '',
  attendance: m?.attendance != null ? String(m.attendance) : '', members_can_add: m?.members_can_add ?? false, is_published: m?.is_published ?? false, link_event_id: '',
})

function MeetSheet({ meet, onClose }: { meet: PastMeet | null; onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const [f, setF] = useState(() => empty(meet))
  const [cover, setCover] = useState<{ path: string; url: string } | null>(meet?.cover_path ? { path: meet.cover_path, url: meetCover(meet)! } : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const events = useQuery({
    queryKey: ['meet-link-events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('id, title, slug').order('starts_at', { ascending: false, nullsFirst: false }).limit(60)
      if (error) throw error
      return data as { id: string; title: string; slug: string }[]
    },
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  async function pickCover(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const [img] = await compressImageSizes(file, [{ maxSide: 1400, quality: 0.8 }])
      const path = `gallery/meets/${crypto.randomUUID()}.${img!.ext}`
      const up = await supabase.storage.from('gallery').upload(path, img!.blob, { contentType: img!.type, cacheControl: '31536000' })
      if (up.error) throw up.error
      setCover({ path, url: URL.createObjectURL(img!.blob) })
    } catch (e) {
      setError(photoError(e))
    }
  }

  async function save() {
    setError(null)
    setBusy(true)
    const { data, error: err } = await supabase.rpc('admin_save_past_meet', {
      p: {
        id: meet?.id ?? null, ...f, year: f.year, attendance: f.attendance, cover_path: cover?.path ?? null, link_event_id: f.link_event_id || null,
      },
    } as never)
    setBusy(false)
    if (err) return setError(photoError(err))
    if (meet?.cover_path && meet.cover_path !== cover?.path) void supabase.storage.from('gallery').remove([meet.cover_path])
    toast.success(tx('meets.savedToast'))
    refresh(qc)
    void data
    onClose()
  }

  async function remove() {
    if (!meet || !window.confirm(tx('meets.confirmDelete'))) return
    const { data, error: err } = await supabase.rpc('admin_delete_past_meet', { p_id: meet.id })
    if (err) return setError(photoError(err))
    void supabase.storage.from('gallery').remove((data as string[]) ?? [])
    toast.success(tx('meets.deletedToast'))
    refresh(qc)
    onClose()
  }

  return (
    <Sheet open onClose={() => !busy && onClose()} label={meet ? tx('meets.editTitle') : tx('meets.add')} className="max-h-[92dvh] overflow-y-auto">
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">{meet ? tx('meets.editTitle') : tx('meets.add')}</h2>
        <Field label={tx('meets.fTitle')}>{(p) => <Input {...p} value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}</Field>
        <Field label={tx('meets.fTitleHi')} optional>{(p) => <Input {...p} value={f.title_hi} maxLength={120} lang="hi" onChange={(e) => set('title_hi', e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tx('meets.fYear')}>{(p) => <Input {...p} inputMode="numeric" value={f.year} maxLength={4} onChange={(e) => set('year', e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label={tx('meets.fDate')} optional>{(p) => <Input {...p} type="date" value={f.held_on} onChange={(e) => set('held_on', e.target.value)} />}</Field>
        </div>
        <Field label={tx('meets.fVenue')} optional>{(p) => <Input {...p} value={f.venue} maxLength={200} onChange={(e) => set('venue', e.target.value)} />}</Field>
        <Field label={tx('meets.fAttendance')} optional hint={tx('meets.fAttendanceHint')}>{(p) => <Input {...p} inputMode="numeric" value={f.attendance} maxLength={6} onChange={(e) => set('attendance', e.target.value.replace(/\D/g, ''))} />}</Field>
        <Field label={tx('meets.fDescription')} optional>{(p) => <Textarea {...p} rows={4} value={f.description} maxLength={3000} onChange={(e) => set('description', e.target.value)} />}</Field>
        <Field label={tx('meets.fDescriptionHi')} optional>{(p) => <Textarea {...p} rows={4} value={f.description_hi} maxLength={3000} lang="hi" onChange={(e) => set('description_hi', e.target.value)} />}</Field>
        <Field label={tx('meets.fHighlights')} optional hint={tx('meets.fHighlightsHint')}>{(p) => <Textarea {...p} rows={3} value={f.highlights} maxLength={2000} onChange={(e) => set('highlights', e.target.value)} />}</Field>
        <Field label={tx('meets.fHighlightsHi')} optional>{(p) => <Textarea {...p} rows={3} value={f.highlights_hi} maxLength={2000} lang="hi" onChange={(e) => set('highlights_hi', e.target.value)} />}</Field>
        <Field label={tx('meets.fCover')} optional hint={tx('meets.fCoverHint')}>
          {(p) => <Input {...p} type="file" accept="image/*" onChange={(e) => void pickCover(e.target.files?.[0])} data-testid="meet-cover" />}
        </Field>
        {cover && (
          <div className="flex items-center gap-3">
            <img src={cover.url} alt="" className="h-20 rounded-xl object-cover" />
            <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => setCover(null)}>{tx('meets.removeCover')}</Button>
          </div>
        )}
        <Field label={tx('meets.fLinkEvent')} optional hint={tx('meets.fLinkEventHint')}>
          {(p) => (
            <Select {...p} value={f.link_event_id} onChange={(e) => set('link_event_id', e.target.value)}>
              <option value="">{meet?.event_id ? tx('meets.keepEvent') : tx('meets.makeArchive')}</option>
              {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </Select>
          )}
        </Field>
        <Checkbox checked={f.members_can_add} onChange={(v) => set('members_can_add', v)}>{tx('meets.fMembersAdd')}</Checkbox>
        <Checkbox checked={f.is_published} onChange={(v) => set('is_published', v)}>{tx('meets.fPublished')}</Checkbox>
        {error && <Notice tone="danger" title={error} />}
        <div className="flex gap-2">
          {meet && <Button variant="danger-ghost" icon={<Trash2 className="size-4" />} disabled={busy} onClick={remove}>{tx('common.delete')}</Button>}
          <Button block variant="secondary" disabled={busy} onClick={onClose}>{tx('common.cancel')}</Button>
          <Button block loading={busy} onClick={save}>{tx('common.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}
