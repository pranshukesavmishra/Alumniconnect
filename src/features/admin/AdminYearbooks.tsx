import { ArrowLeft, ArrowRight, BookOpenText, ExternalLink, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge, Card, EmptyState, Notice, SkeletonList } from '../../components/ui/Display'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input, Select, Switch, Textarea } from '../../components/ui/Form'
import { ProgressBar } from '../../components/ui/Progress'
import { BRANCHES, shortBranch } from '../../lib/constants'
import { friendlyError } from '../../lib/errors'
import { uploadYearbookImage, useAdminYearbooks, useYearbookAdmin, yearbookImageUrl, type Yearbook, type YearbookInput } from '../yearbook/api'

const MAX_PHOTOS = 12
const blank = (): YearbookInput => ({ grad_year: new Date().getFullYear() - 25, branch: null, cover_path: null, class_photo_paths: [], quote: '', quote_hi: '', memories: '', memories_hi: '', is_published: false })
const toInput = (y: Yearbook): YearbookInput => ({
  id: y.id,
  grad_year: y.grad_year,
  branch: y.branch,
  cover_path: y.cover_path,
  class_photo_paths: y.class_photo_paths ?? [],
  quote: y.quote ?? '',
  quote_hi: y.quote_hi ?? '',
  memories: y.memories ?? '',
  memories_hi: y.memories_hi ?? '',
  is_published: y.is_published,
})
const previewUrl = (y: { grad_year: number; branch?: string | null }) => `/yearbook/${y.grad_year}${y.branch ? `?branch=${encodeURIComponent(y.branch)}` : ''}`

/** Organise > Yearbooks: curate each batch's yearbook (permission: gallery_manage). */
export function AdminYearbooks() {
  const list = useAdminYearbooks()
  const [edit, setEdit] = useState<YearbookInput | null>(null)
  if (edit) return <YearbookEditor initial={edit} onDone={() => setEdit(null)} />
  return (
    <div>
      <PageHeader title="Yearbooks" subtitle="Cover, motto, class photos and memories for each batch" back="/admin" />
      <Page className="space-y-4">
        <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit(blank())}>
          New yearbook
        </Button>
        {list.isLoading ? (
          <SkeletonList rows={3} />
        ) : list.error ? (
          <Notice tone="danger" title="Could not load the yearbooks">
            {friendlyError(list.error)}
          </Notice>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={<BookOpenText />} title="No yearbooks yet">
            Start with your own batch: add a cover photo, a motto and a few class photos.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.data!.map((y) => {
              const cover = yearbookImageUrl(y.cover_path)
              return (
                <li key={y.id}>
                  <Card className="fx-lift flex items-center gap-4 overflow-hidden p-3">
                    <div className="aurora relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl">
                      {cover && <img src={cover} alt="" className="absolute inset-0 size-full object-cover opacity-80" />}
                      <span className="relative font-display text-[22px] font-semibold text-white drop-shadow">{y.grad_year}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-title">
                        <span data-no-translate>{y.grad_year}</span> · {y.branch ? shortBranch(y.branch) : 'Whole year'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {y.is_published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge>}
                        <Badge>{`${y.class_photo_paths.length} photos`}</Badge>
                      </div>
                    </div>
                    <IconButton label="Edit yearbook" variant="secondary" onClick={() => setEdit(toInput(y))}>
                      <Pencil className="size-4" />
                    </IconButton>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </Page>
    </div>
  )
}

function YearbookEditor({ initial, onDone }: { initial: YearbookInput; onDone: () => void }) {
  const { save, remove } = useYearbookAdmin()
  const [v, setV] = useState<YearbookInput>(initial)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [yearError, setYearError] = useState<string | null>(null)
  const set = (p: Partial<YearbookInput>) => setV((x) => ({ ...x, ...p }))
  const photos = v.class_photo_paths ?? []

  async function upload(files: File[], kind: 'cover' | 'photos') {
    const list = kind === 'cover' ? files.slice(0, 1) : files.slice(0, MAX_PHOTOS - photos.length)
    if (!list.length) return
    setUploading({ done: 0, total: list.length })
    const added: string[] = []
    try {
      for (const f of list) {
        added.push(await uploadYearbookImage(f))
        setUploading({ done: added.length, total: list.length })
      }
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      if (kind === 'cover' && added[0]) set({ cover_path: added[0] })
      if (kind === 'photos' && added.length) setV((x) => ({ ...x, class_photo_paths: [...(x.class_photo_paths ?? []), ...added].slice(0, MAX_PHOTOS) }))
      setUploading(null)
    }
  }
  const onFiles = (kind: 'cover' | 'photos') => (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    void upload(files, kind)
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...photos]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    set({ class_photo_paths: next })
  }

  function submit() {
    if (!Number.isInteger(v.grad_year) || v.grad_year < 1947 || v.grad_year > 2100) {
      setYearError('Enter a passing-out year between 1947 and 2100.')
      return
    }
    setYearError(null)
    save.mutate(
      { ...v, quote: v.quote?.trim() || null, quote_hi: v.quote_hi?.trim() || null, memories: v.memories?.trim() || null, memories_hi: v.memories_hi?.trim() || null },
      {
        onSuccess: (id) => {
          toast.success('Yearbook saved')
          setV((x) => ({ ...x, id }))
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    )
  }

  const cover = yearbookImageUrl(v.cover_path)
  return (
    <div>
      <PageHeader title={v.id ? 'Edit yearbook' : 'New yearbook'} subtitle={`Class of ${v.grad_year}`} />
      <Page className="space-y-5">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={onDone}>
          All yearbooks
        </Button>
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Passing-out year" error={yearError}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1947} max={2100} value={Number.isFinite(v.grad_year) ? v.grad_year : ''} onChange={(e) => set({ grad_year: Number(e.target.value) })} />}
            </Field>
            <Field label="Branch" hint="Whole year: shown for every branch that has no yearbook of its own.">
              {(p) => (
                <Select {...p} value={v.branch ?? ''} onChange={(e) => set({ branch: e.target.value || null })}>
                  <option value="">Whole year</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-h3">Cover photo</h2>
          <div className="aurora relative grid aspect-[16/9] place-items-center overflow-hidden rounded-2xl">
            {cover ? <img src={cover} alt="Cover photo" className="absolute inset-0 size-full object-cover" /> : <span className="relative font-display text-[56px] font-semibold text-white/90">{v.grad_year}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
              <ImagePlus className="size-4" aria-hidden />
              {cover ? 'Change cover' : 'Upload cover'}
              <input type="file" accept="image/*" className="sr-only" onChange={onFiles('cover')} disabled={!!uploading} aria-label="Upload cover photo" />
            </label>
            {cover && (
              <Button variant="danger-ghost" size="sm" onClick={() => set({ cover_path: null })}>
                Remove cover
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <Field label="Motto or quote (English)" optional>
            {(p) => <Textarea {...p} rows={2} maxLength={300} value={v.quote ?? ''} onChange={(e) => set({ quote: e.target.value })} />}
          </Field>
          <Field label="Motto or quote (Hindi)" optional>
            {(p) => <Textarea {...p} rows={2} maxLength={300} value={v.quote_hi ?? ''} onChange={(e) => set({ quote_hi: e.target.value })} />}
          </Field>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-h3">Class photos</h2>
            <span className="text-caption text-muted">{`${photos.length} of ${MAX_PHOTOS}`}</span>
          </div>
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((p, i) => (
                <li key={p} className="relative overflow-hidden rounded-2xl bg-surface-2">
                  <img src={yearbookImageUrl(p) ?? ''} alt={`Class photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                    <span className="flex gap-1">
                      <IconButton label="Move earlier" variant="glass" onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowLeft className="size-4" />
                      </IconButton>
                      <IconButton label="Move later" variant="glass" onClick={() => move(i, 1)} disabled={i === photos.length - 1}>
                        <ArrowRight className="size-4" />
                      </IconButton>
                    </span>
                    <IconButton label="Remove photo" variant="glass" onClick={() => set({ class_photo_paths: photos.filter((x) => x !== p) })}>
                      <X className="size-4" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {uploading && (
            <div className="space-y-1.5" role="status">
              <p className="text-sm font-medium">{`Uploading ${uploading.done} of ${uploading.total}`}</p>
              <ProgressBar value={uploading.done} max={uploading.total} label="Upload progress" />
            </div>
          )}
          {photos.length < MAX_PHOTOS && (
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border-strong p-4 text-center hover:bg-surface-2">
              <ImagePlus className="size-6 text-primary" aria-hidden />
              <span className="text-[15px] font-semibold">Add class photos</span>
              <span className="text-caption text-muted">You can choose several at once.</span>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={onFiles('photos')} disabled={!!uploading} aria-label="Add class photos" />
            </label>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <Field label="Memories (English)" optional hint="A few paragraphs: the hostel, the teachers, the festivals.">
            {(p) => <Textarea {...p} rows={6} maxLength={5000} value={v.memories ?? ''} onChange={(e) => set({ memories: e.target.value })} />}
          </Field>
          <Field label="Memories (Hindi)" optional>
            {(p) => <Textarea {...p} rows={6} maxLength={5000} value={v.memories_hi ?? ''} onChange={(e) => set({ memories_hi: e.target.value })} />}
          </Field>
        </Card>

        <Card className="p-5">
          <Switch checked={!!v.is_published} onChange={(x) => set({ is_published: x })} label="Published" hint="Verified members of the batch can see it. Drafts are visible to curators only." />
        </Card>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button size="lg" loading={save.isPending} disabled={!!uploading} onClick={submit}>
            Save yearbook
          </Button>
          <a href={previewUrl(v)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 font-semibold hover:bg-surface-2">
            <ExternalLink className="size-4" aria-hidden />
            Preview
          </a>
          {v.id && (
            <Button size="lg" variant="danger-ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
        {!v.id && <p className="text-center text-caption text-muted">Save first, then preview shows your draft.</p>}
      </Page>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this yearbook?"
        description="Its cover and class photos are removed too. This cannot be undone."
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
                    toast.success('Yearbook deleted')
                    onDone()
                  },
                  onError: (e) => toast.error(friendlyError(e)),
                })
              }
            >
              Delete yearbook
            </Button>
          </>
        }
      />
    </div>
  )
}
