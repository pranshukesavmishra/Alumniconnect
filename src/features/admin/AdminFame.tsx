import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Pencil, Plus, Trash2, Trophy, UserRound, X } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SkeletonList } from '../../components/ui/Display'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input, Select, Switch, Textarea } from '../../components/ui/Form'
import { BRANCHES, shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { FAME_CATEGORIES, FAME_CATEGORY_LABELS, fameImageUrl, isSafeFameLink, uploadFameImage, useAdminWallOfFame, useFameAdmin, type FameInput, type FameRow } from '../fame/api'
import { FameFrame } from '../fame/FamePage'
import { Portrait } from '../yearbook/Portrait'
import { MemberPicker } from './MemberPicker'

type Draft = FameInput & { member_name?: string | null }

const blank = (): Draft => ({ name: '', title: '', title_hi: '', story: '', story_hi: '', category: 'achiever', image_path: null, link_url: '', grad_year: null, branch: null, is_published: false, is_public: false, starts_at: null, ends_at: null, member_id: null })
const toDraft = (r: FameRow): Draft => ({
  id: r.id,
  member_id: r.member_id,
  name: r.name,
  title: r.title,
  title_hi: r.title_hi ?? '',
  story: r.story ?? '',
  story_hi: r.story_hi ?? '',
  image_path: r.image_path,
  link_url: r.link_url ?? '',
  category: r.category,
  grad_year: r.grad_year,
  branch: r.branch,
  is_published: r.is_published,
  is_public: r.is_public,
  starts_at: r.starts_at,
  ends_at: r.ends_at,
})
// datetime-local <-> ISO (the browser's own time zone)
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

/** Organise > Wall of Fame: curate the alumni spotlight (permission: gallery_manage). */
export function AdminFame() {
  const list = useAdminWallOfFame()
  const { reorder } = useFameAdmin()
  const [edit, setEdit] = useState<Draft | null>(null)
  if (edit) return <FameEditor initial={edit} onDone={() => setEdit(null)} />
  const rows = list.data ?? []
  const move = (i: number, d: -1 | 1) => {
    const ids = rows.map((r) => r.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorder.mutate(ids, { onError: (e) => toast.error(friendlyError(e)) })
  }
  return (
    <div>
      <PageHeader title="Wall of Fame" subtitle="Achievers, founders, public servants and legends of JEC" back="/admin" />
      <Page className="space-y-4">
        <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit(blank())}>
          Add to the wall
        </Button>
        {list.isLoading ? (
          <SkeletonList rows={4} />
        ) : list.error ? (
          <Notice tone="danger" title="Could not load the Wall of Fame">
            {friendlyError(list.error)}
          </Notice>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Trophy />} title="The wall is empty">
            Add the first JECian whose story should inspire everyone.
          </EmptyState>
        ) : (
          <Card className="divide-y divide-border/70 overflow-hidden p-0">
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 p-3">
                <Portrait src={fameImageUrl(r)} name={r.name} className="size-14 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-title" data-no-translate>
                    {r.name}
                  </p>
                  <p className="truncate text-caption text-muted" data-no-translate>
                    {r.title}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="gold">{FAME_CATEGORY_LABELS[r.category].en}</Badge>
                    {r.is_published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge>}
                    {r.is_public && <Badge tone="info">Public</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <IconButton label="Move up" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0 || reorder.isPending}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton label="Move down" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1 || reorder.isPending}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                </div>
                <IconButton label="Edit entry" variant="secondary" onClick={() => setEdit(toDraft(r))}>
                  <Pencil className="size-4" />
                </IconButton>
              </div>
            ))}
          </Card>
        )}
      </Page>
    </div>
  )
}

function FameEditor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const { save, remove } = useFameAdmin()
  const [v, setV] = useState<Draft>(initial)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picking, setPicking] = useState(false)
  const set = (p: Partial<Draft>) => setV((x) => ({ ...x, ...p }))

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploading(true)
    try {
      set({ image_path: await uploadFameImage(f) })
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setUploading(false)
    }
  }

  function submit() {
    const errs: Record<string, string> = {}
    if (!v.member_id && (v.name ?? '').trim().length < 2) errs.name = 'Enter a name.'
    if (v.title.trim().length < 2) errs.title = 'Enter a headline.'
    if (v.link_url && !isSafeFameLink(v.link_url.trim())) errs.link = 'Links must start with https://'
    if (v.starts_at && v.ends_at && new Date(v.ends_at) <= new Date(v.starts_at)) errs.ends = 'The end must be after the start.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const { member_name: _ignored, ...input } = v
    save.mutate(
      { ...input, name: v.name?.trim() ?? '', title: v.title.trim(), link_url: v.link_url?.trim() || null, title_hi: v.title_hi?.trim() || null, story: v.story?.trim() || null, story_hi: v.story_hi?.trim() || null },
      {
        onSuccess: (id) => {
          toast.success('Saved to the Wall of Fame')
          setV((x) => ({ ...x, id }))
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    )
  }

  const preview = {
    id: v.id ?? 'preview',
    member_id: v.member_id ?? null,
    name: v.name || v.member_name || 'Name',
    title: v.title || 'Headline',
    title_hi: v.title_hi ?? null,
    story: v.story ?? null,
    story_hi: v.story_hi ?? null,
    image_path: v.image_path ?? null,
    avatar_url: null,
    link_url: null,
    category: v.category,
    grad_year: v.grad_year ?? null,
    branch: v.branch ?? null,
    is_public: !!v.is_public,
  }

  return (
    <div>
      <PageHeader title={v.id ? 'Edit entry' : 'New entry'} subtitle="Wall of Fame" />
      <Page className="space-y-5">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={onDone}>
          All entries
        </Button>

        <Card className="space-y-3 p-5">
          <h2 className="text-h3">Member on the app</h2>
          {v.member_id ? (
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
              <UserRound className="size-5 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 truncate font-semibold" data-no-translate>
                {v.member_name || v.name}
              </p>
              <IconButton label="Unlink member" onClick={() => set({ member_id: null, member_name: null })}>
                <X className="size-4" />
              </IconButton>
            </div>
          ) : picking ? (
            <MemberPicker actionLabel="Choose" onPick={(id, name) => (set({ member_id: id, member_name: name, name: v.name || name }), setPicking(false))} />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">Optional. Link a member so their profile photo and profile link are used.</p>
              <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                Link a member
              </Button>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <Field label="Name" error={errors.name ?? null}>
            {(p) => <Input {...p} maxLength={120} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Headline (English)" error={errors.title ?? null} hint="For example: Founder of a company, Padma Shri awardee.">
            {(p) => <Input {...p} maxLength={160} value={v.title} onChange={(e) => set({ title: e.target.value })} />}
          </Field>
          <Field label="Headline (Hindi)" optional>
            {(p) => <Input {...p} maxLength={160} value={v.title_hi ?? ''} onChange={(e) => set({ title_hi: e.target.value })} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category">
              {(p) => (
                <Select {...p} value={v.category} onChange={(e) => set({ category: e.target.value as Draft['category'] })}>
                  {FAME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {FAME_CATEGORY_LABELS[c].en}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Batch year" optional>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1947} max={2100} value={v.grad_year ?? ''} onChange={(e) => set({ grad_year: e.target.value ? Number(e.target.value) : null })} />}
            </Field>
            <Field label="Branch" optional>
              {(p) => (
                <Select {...p} value={v.branch ?? ''} onChange={(e) => set({ branch: e.target.value || null })}>
                  <option value="">Not set</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {shortBranch(b)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <Field label="Story (English)" optional>
            {(p) => <Textarea {...p} rows={6} maxLength={2000} value={v.story ?? ''} onChange={(e) => set({ story: e.target.value })} />}
          </Field>
          <Field label="Story (Hindi)" optional>
            {(p) => <Textarea {...p} rows={6} maxLength={2000} value={v.story_hi ?? ''} onChange={(e) => set({ story_hi: e.target.value })} />}
          </Field>
          <Field label="Link to read more" optional error={errors.link ?? null} hint="A news article or their website. Must start with https://">
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={v.link_url ?? ''} onChange={(e) => set({ link_url: e.target.value })} />}
          </Field>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-h3">Portrait</h2>
          <div className="flex items-center gap-4">
            <Portrait src={fameImageUrl({ image_path: v.image_path ?? null })} name={v.name || v.member_name || 'JEC'} className="aspect-[4/5] w-28 shrink-0 rounded-2xl" />
            <div className="space-y-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                <ImagePlus className="size-4" aria-hidden />
                {uploading ? 'Uploading…' : v.image_path ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e)} disabled={uploading} aria-label="Upload portrait photo" />
              </label>
              {v.image_path && (
                <Button variant="danger-ghost" size="sm" onClick={() => set({ image_path: null })}>
                  Remove photo
                </Button>
              )}
              <p className="text-caption text-muted">Without a photo, a linked member’s profile photo is used.</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-2 p-5">
          <Switch checked={!!v.is_published} onChange={(x) => set({ is_published: x })} label="Published" hint="Verified members see it on the Wall of Fame." />
          <Switch checked={!!v.is_public} onChange={(x) => set({ is_public: x })} label="Show on the public landing page" hint="Name, headline, story and photo only." />
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <Field label="Show from" optional>
              {(p) => <Input {...p} type="datetime-local" value={toLocal(v.starts_at)} onChange={(e) => set({ starts_at: fromLocal(e.target.value) })} />}
            </Field>
            <Field label="Show until" optional error={errors.ends ?? null}>
              {(p) => <Input {...p} type="datetime-local" value={toLocal(v.ends_at)} onChange={(e) => set({ ends_at: fromLocal(e.target.value) })} />}
            </Field>
          </div>
        </Card>

        <section className="space-y-2">
          <h2 className="text-h3">Preview</h2>
          <div data-theme="dark" className="rounded-[28px] bg-[#040b08] p-4" data-no-translate>
            <div className="mx-auto max-w-xs">
              <FameFrame e={preview} />
            </div>
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" loading={save.isPending} disabled={uploading} onClick={submit}>
            Save entry
          </Button>
          {v.id && (
            <Button size="lg" variant="danger-ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </Page>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Remove this entry?"
        description="It disappears from the Wall of Fame and the landing page. This cannot be undone."
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(v.id!, {
                  onSuccess: () => {
                    toast.success('Removed from the Wall of Fame')
                    onDone()
                  },
                  onError: (e) => toast.error(friendlyError(e)),
                })
              }
            >
              Remove entry
            </Button>
          </>
        }
      />
    </div>
  )
}
