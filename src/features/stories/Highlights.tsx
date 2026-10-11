import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState, Skeleton } from '../../components/ui/Display'
import { Field, Input, Select } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { relativeTime } from '../../lib/format'
import { moveItem } from '../glimpses/api'
import { useUserId } from '../auth/AuthProvider'
import {
  storyError, useAdminStories, useDeleteHighlight, useDeleteStory, useHighlights, useMyStories, useSaveHighlight, useSetHighlightItems, useSourceStories, useStoryUrls,
  type HighlightLite, type StoryCard,
} from './api'
import { bgStyle, MAX_TITLE } from './rules'
import { HighlightPickerSheet } from './StorySheets'
import { useStoryViewer } from './viewerContext'

/** A small picture of a story: the photo or poster, or the coloured card for a text story. */
export function StoryThumb({ card, url, className }: { card: Pick<StoryCard, 'kind' | 'bg_key' | 'text_body'>; url?: string; className?: string }) {
  if (card.kind === 'text') {
    return (
      <span className={clsx('grid place-items-center overflow-hidden p-1 text-center text-[10px] font-bold leading-tight text-white', className)} style={{ background: bgStyle(card.bg_key) }} aria-hidden>
        <span className="line-clamp-3 break-words">{card.text_body}</span>
      </span>
    )
  }
  return url ? <img src={url} alt="" className={clsx('object-cover', className)} loading="lazy" /> : <span className={clsx('bg-surface-2', className)} aria-hidden />
}

/** A round highlight with its cover and name, like Instagram's. */
export function HighlightCircle({ h, url, onOpen, big }: { h: HighlightLite; url?: string; onOpen: () => void; big?: boolean }) {
  const tx = useT()
  const size = big ? 76 : 60
  return (
    <button type="button" onClick={onOpen} className="flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-2xl py-1 text-center" aria-label={tx('highlights.open', { title: h.title })} data-testid="highlight-circle" data-highlight-id={h.id}>
      <span className={clsx('grid place-items-center rounded-full p-[3px]', h.is_official ? 'bg-gradient-to-tr from-amber-300 via-amber-500 to-yellow-300' : 'bg-border')} style={{ width: size + 10, height: size + 10 }}>
        <span className="grid place-items-center overflow-hidden rounded-full bg-bg p-[2px]" style={{ width: size + 4, height: size + 4 }}>
          {h.cover ? (
            <StoryThumb card={h.cover} url={url} className="size-full rounded-full" />
          ) : (
            <span className="grid size-full place-items-center rounded-full bg-surface-2 text-muted"><Sparkles className="size-5" aria-hidden /></span>
          )}
        </span>
      </span>
      <span className="block w-full truncate text-xs font-medium">{h.title}</span>
    </button>
  )
}

function useCovers(list: readonly HighlightLite[]) {
  const urls = useStoryUrls(list.map((h) => ({ media_path: null, thumb_path: h.cover?.thumb_path ?? null })))
  return (h: HighlightLite) => (h.cover?.thumb_path ? urls.data?.[h.cover.thumb_path] : undefined)
}

/** /highlights: the official highlights (Reunion 2025, Scholarships, Campus drives, ...) and your own. */
export function HighlightsPage() {
  const tx = useT()
  const uid = useUserId()
  const viewer = useStoryViewer()
  const official = useHighlights({ official: true })
  const mine = useHighlights(uid ? { owner: uid } : null)
  const offList = official.data ?? []
  const myList = (mine.data ?? []).filter((h) => h.count > 0)
  const coverOf = useCovers([...offList, ...myList])
  const [editor, setEditor] = useState<{ id: string | null } | null>(null)
  return (
    <div>
      <PageHeader title={tx('highlights.title')} subtitle={tx('highlights.subtitle')} />
      <Page className="space-y-6" >
        <section aria-label={tx('highlights.official')} data-testid="highlights-official">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('highlights.official')}</h2>
          {official.isLoading ? (
            <Skeleton className="h-24 rounded-2xl" />
          ) : official.isError ? (
            <p className="text-danger" role="alert">{storyError(official.error)} <button type="button" className="min-h-11 font-semibold text-primary" onClick={() => void official.refetch()}>{tx('stories.retry')}</button></p>
          ) : offList.filter((h) => h.count > 0).length === 0 ? (
            <EmptyState icon={<Sparkles />} title={tx('highlights.noneOfficial')}>{tx('highlights.noneOfficialBody')}</EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-x-2 gap-y-3">
              {offList.filter((h) => h.count > 0).map((h) => (
                <li key={h.id}><HighlightCircle h={h} url={coverOf(h)} big onOpen={() => viewer.open([{ type: 'highlight', id: h.id }])} /></li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label={tx('highlights.yours')} data-testid="highlights-mine">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('highlights.yours')}</h2>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditor({ id: null })}>{tx('highlights.new')}</Button>
          </div>
          {myList.length === 0 ? (
            <p className="text-muted">{tx('highlights.noneMine')}</p>
          ) : (
            <ul className="flex flex-wrap gap-x-2 gap-y-3">
              {myList.map((h) => (
                <li key={h.id}><HighlightCircle h={h} url={coverOf(h)} big onOpen={() => viewer.open([{ type: 'highlight', id: h.id }])} /></li>
              ))}
            </ul>
          )}
        </section>
      </Page>
      {editor && <HighlightEditor open id={editor.id} official={false} onClose={() => setEditor(null)} />}
    </div>
  )
}

/** A member's highlights on their profile (and, on your own profile, the buttons to make and change them). */
export function ProfileHighlights({ userId, isMe }: { userId: string; isMe: boolean }) {
  const tx = useT()
  const viewer = useStoryViewer()
  const q = useHighlights({ owner: userId })
  const list = (q.data ?? []).filter((h) => isMe || h.count > 0)
  const coverOf = useCovers(list)
  const [editor, setEditor] = useState<{ id: string | null } | null>(null)
  if (!isMe && !list.length) return null
  return (
    <section aria-label={tx('highlights.title')} data-testid="profile-highlights">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('highlights.title')}</h2>
        {isMe && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditor({ id: null })} data-testid="highlight-new">
            {tx('highlights.new')}
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted">{tx('highlights.noneMine')}</p>
      ) : (
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {list.map((h) => (
            <li key={h.id} className="flex flex-col items-center">
              <HighlightCircle h={h} url={coverOf(h)} onOpen={() => (h.count > 0 ? viewer.open([{ type: 'highlight', id: h.id }]) : isMe && setEditor({ id: h.id }))} />
              {isMe && (
                <button type="button" className="min-h-11 px-2 text-xs font-semibold text-primary" onClick={() => setEditor({ id: h.id })} aria-label={tx('highlights.edit', { title: h.title })}>
                  {tx('common.edit')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editor && <HighlightEditor open id={editor.id} official={false} onClose={() => setEditor(null)} />}
    </section>
  )
}

/** Your stories, newest first, including the ones that have expired, so they can be saved into a highlight or deleted. */
export function MyStoriesPanel({ onAdd }: { onAdd: () => void }) {
  const tx = useT()
  const q = useMyStories()
  const urls = useStoryUrls(q.data ?? [])
  const viewer = useStoryViewer()
  const [picker, setPicker] = useState<StoryCard | null>(null)
  const del = useDeleteStory()
  const list = q.data ?? []
  return (
    <section aria-label={tx('stories.mineTitle')} data-testid="my-stories">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('stories.mineTitle')}</h2>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={onAdd}>{tx('stories.add')}</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : q.isError ? (
        <p className="text-danger" role="alert">{storyError(q.error)} <button type="button" className="min-h-11 font-semibold text-primary" onClick={() => void q.refetch()}>{tx('stories.retry')}</button></p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">{tx('stories.mineNone')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((s) => {
            const live = new Date(s.expires_at).getTime() > Date.now()
            const url = s.thumb_path ? urls.data?.[s.thumb_path] : undefined
            return (
              <li key={s.id} className="overflow-hidden rounded-2xl border border-border bg-surface" data-testid="my-story" data-story-id={s.id}>
                <button
                  type="button"
                  className="relative block aspect-[3/4] w-full"
                  onClick={() => (live ? viewer.open([{ type: 'owner', id: s.owner_id }], { startStoryId: s.id }) : setPicker(s))}
                  aria-label={tx(live ? 'stories.openMine' : 'stories.openExpired', { when: relativeTime(s.created_at) })}
                >
                  <StoryThumb card={s} url={url} className="size-full" />
                  <span className={clsx('absolute left-1 top-1 rounded-full px-2 py-0.5 text-[10px] font-bold', live ? 'bg-emerald-500 text-white' : 'bg-black/60 text-white')}>{tx(live ? 'stories.live' : 'stories.expiredTag')}</span>
                </button>
                <div className="flex items-center justify-between gap-1 px-2 py-1 text-xs text-muted">
                  <span>{s.views ?? 0} · {s.hearts ?? 0}</span>
                  <button type="button" className="min-h-11 px-1 font-semibold text-primary" onClick={() => setPicker(s)} aria-label={tx('stories.saveToHighlight')} data-testid="my-story-save">
                    {tx('stories.save')}
                  </button>
                  <button
                    type="button"
                    className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                    aria-label={tx('stories.delete')}
                    data-testid="my-story-delete"
                    onClick={async () => {
                      if (!window.confirm(tx('stories.confirmDelete'))) return
                      try {
                        await del.mutateAsync(s.id)
                        toast.success(tx('stories.deleted'))
                      } catch (e) {
                        toast.error(storyError(e))
                      }
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {picker && <HighlightPickerSheet open onClose={() => setPicker(null)} story={picker} />}
    </section>
  )
}

// ------------------------------------------------------------------ make / change a highlight
interface EditorProps {
  open: boolean
  /** null = a new highlight */
  id: string | null
  official: boolean
  onClose: () => void
}

/** Name, who sees it, which stories (in which order) and the cover; or delete it. Members use it for their own, the story team for official ones. */
export function HighlightEditor({ open, id, official, onClose }: EditorProps) {
  const tx = useT()
  const uid = useUserId()
  const detail = useSourceStories(id ? { type: 'highlight', id } : null)
  const mineStories = useMyStories()
  const adminStories = useAdminStories('all')
  const save = useSaveHighlight(official)
  const setItems = useSetHighlightItems(official)
  const del = useDeleteHighlight(official)
  const list = useHighlights(official ? { official: true } : uid ? { owner: uid } : null)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<'inherit' | 'all' | 'connections'>('inherit')
  const [ids, setIds] = useState<string[]>([])
  const [cover, setCover] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!id)
  const candidates: StoryCard[] = (official ? (adminStories.data ?? []) : (mineStories.data ?? [])).filter((s) => s.ready)
  const known = new Map<string, StoryCard>([...candidates, ...(detail.data?.stories ?? [])].map((s) => [s.id, s]))
  const urls = useStoryUrls([...known.values()])

  useEffect(() => {
    if (!id) return
    const h = list.data?.find((x) => x.id === id)
    if (h && detail.data && !loaded) {
      setTitle(h.title)
      setAudience(h.audience)
      setCover(h.cover_story_id)
      setIds(detail.data.stories.map((s) => s.id))
      setLoaded(true)
    }
  }, [id, list.data, detail.data, loaded])

  const busy = save.isPending || setItems.isPending || del.isPending
  const canSave = title.trim().length > 0 && !busy && loaded

  async function onSave() {
    try {
      const hid = await save.mutateAsync({ id, title: title.trim(), audience })
      await setItems.mutateAsync({ id: hid, ids })
      if (cover && ids.includes(cover)) await save.mutateAsync({ id: hid, title: title.trim(), audience, cover })
      toast.success(tx('highlights.saved'))
      onClose()
    } catch (e) {
      toast.error(storyError(e))
    }
  }
  async function onDelete() {
    if (!id || !window.confirm(tx('highlights.confirmDelete'))) return
    try {
      await del.mutateAsync(id)
      toast.success(tx('highlights.deleted'))
      onClose()
    } catch (e) {
      toast.error(storyError(e))
    }
  }

  const thumbOf = (s: StoryCard | undefined) => (s?.thumb_path ? urls.data?.[s.thumb_path] : undefined)
  const addable = candidates.filter((s) => !ids.includes(s.id))

  return (
    <Sheet open={open} onClose={() => (busy ? undefined : onClose())} label={tx(id ? 'highlights.editTitle' : 'highlights.newTitle')} className="md:max-w-lg">
      <div className="space-y-4 px-5 pb-3 pt-1" data-testid="highlight-editor">
        <h2 className="text-lg font-bold">{tx(id ? 'highlights.editTitle' : 'highlights.newTitle')}</h2>
        {!loaded ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (
          <>
            <Field label={tx('highlights.name')}>
              {(p) => <Input {...p} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder={tx('stories.highlightName')} disabled={busy} data-testid="highlight-title" />}
            </Field>
            <Field label={tx('highlights.audience')} hint={tx(audience === 'inherit' ? 'highlights.audInheritHint' : audience === 'all' ? (official ? 'highlights.audPublicHintOfficial' : 'highlights.audAllHint') : 'highlights.audConnectionsHint')}>
              {(p) => (
                <Select {...p} value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} disabled={busy} data-testid="highlight-audience">
                  <option value="inherit">{tx(official ? 'highlights.audInheritOfficial' : 'highlights.audInherit')}</option>
                  <option value="all">{tx(official ? 'highlights.audPublic' : 'highlights.audAll')}</option>
                  {!official && <option value="connections">{tx('highlights.audConnections')}</option>}
                </Select>
              )}
            </Field>

            <div>
              <h3 className="mb-1 text-sm font-semibold">{tx('highlights.inThis', { count: ids.length })}</h3>
              {ids.length === 0 ? (
                <p className="text-sm text-muted">{tx('highlights.emptyItems')}</p>
              ) : (
                <ul className="space-y-2" data-testid="highlight-items">
                  {ids.map((sid, i) => {
                    const s = known.get(sid)
                    return (
                      <li key={sid} className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2">
                        {s ? <StoryThumb card={s} url={thumbOf(s)} className="size-12 shrink-0 rounded-xl" /> : <span className="size-12 shrink-0 rounded-xl bg-surface-2" />}
                        <span className="min-w-0 flex-1 truncate text-sm">{s?.caption || s?.text_body || (s ? relativeTime(s.created_at) : '…')}</span>
                        <button type="button" className={clsx('grid size-11 place-items-center rounded-full', cover === sid ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2')} aria-pressed={cover === sid} aria-label={tx('highlights.makeCover')} onClick={() => setCover(cover === sid ? null : sid)}>
                          <Check className="size-4" aria-hidden />
                        </button>
                        <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-40" disabled={i === 0} aria-label={tx('highlights.moveUp')} onClick={() => setIds(moveItem(ids, i, -1))}><ArrowUp className="size-4" aria-hidden /></button>
                        <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-40" disabled={i === ids.length - 1} aria-label={tx('highlights.moveDown')} onClick={() => setIds(moveItem(ids, i, 1))}><ArrowDown className="size-4" aria-hidden /></button>
                        <button type="button" className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft" aria-label={tx('highlights.removeItem')} onClick={() => { setIds(ids.filter((x) => x !== sid)); if (cover === sid) setCover(null) }}><X className="size-4" aria-hidden /></button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-1 text-sm font-semibold">{tx('highlights.addStories')}</h3>
              {addable.length === 0 ? (
                <p className="text-sm text-muted">{tx('highlights.nothingToAdd')}</p>
              ) : (
                <ul className="flex gap-2 overflow-x-auto pb-1" data-testid="highlight-candidates">
                  {addable.map((s) => (
                    <li key={s.id} className="shrink-0">
                      <button type="button" className="relative block h-24 w-[4.5rem] overflow-hidden rounded-xl border border-border" onClick={() => setIds([...ids, s.id])} aria-label={tx('highlights.addOne', { when: relativeTime(s.created_at) })} data-testid="highlight-add-story">
                        <StoryThumb card={s} url={thumbOf(s)} className="size-full" />
                        <span className="absolute bottom-1 right-1 grid size-6 place-items-center rounded-full bg-primary text-on-primary"><Plus className="size-4" aria-hidden /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <div className="flex gap-2">
          {id && <Button type="button" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => void onDelete()} disabled={busy} data-testid="highlight-delete">{tx('highlights.delete')}</Button>}
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{tx('common.cancel')}</Button>
          <Button type="button" className="flex-1" onClick={() => void onSave()} disabled={!canSave} loading={busy} data-testid="highlight-save">{tx('common.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

