import clsx from 'clsx'
import { ArrowDown, ArrowUp, Bell, Eye, Heart, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Badge, EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { Select } from '../../components/ui/Form'
import { useT } from '../../i18n'
import { relativeTime } from '../../lib/format'
import { moveItem } from '../glimpses/api'
import {
  storyError, useAdminStories, useCleanupStories, useDeleteStory, useHighlights, useNotifyStory, useReorderHighlights, useStoryUrls, type AdminStoryCard,
} from './api'
import { HighlightEditor, StoryThumb } from './Highlights'
import { timeLeft } from './rules'
import { StoryComposer } from './StoryComposer'
import { HighlightPickerSheet } from './StorySheets'

/** Organise > Stories (permission stories_post): post official stories, see who watched, notify, manage official highlights. */
export function AdminStories() {
  const tx = useT()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'highlights' ? 'highlights' : 'stories'
  const [composer, setComposer] = useState(false)
  const cleanup = useCleanupStories()
  return (
    <div>
      <PageHeader
        title={tx('stories.adminTitle')}
        subtitle={tx('stories.adminSubtitle')}
        back="/admin"
        action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setComposer(true)} data-testid="admin-new-story">{tx('stories.adminNew')}</Button>}
      />
      <Page className="space-y-4">
        <div role="tablist" aria-label={tx('stories.adminTitle')} className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {(['stories', 'highlights'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`admin-tab-${id}`}
              onClick={() => setSp(id === 'stories' ? {} : { tab: id }, { replace: true })}
              className={clsx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold', tab === id ? 'bg-surface text-primary shadow-sm' : 'text-muted')}
            >
              {tx(id === 'stories' ? 'stories.adminTabStories' : 'highlights.title')}
            </button>
          ))}
        </div>
        {tab === 'stories' ? <OfficialStories onNew={() => setComposer(true)} /> : <OfficialHighlights />}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="font-semibold">{tx('stories.cleanupTitle')}</p>
          <p className="text-sm text-muted">{tx('stories.cleanupHelp')}</p>
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            loading={cleanup.isPending}
            data-testid="admin-cleanup"
            onClick={async () => {
              try {
                const r = await cleanup.mutateAsync()
                toast.success(tx('stories.cleanupDone', { count: r.deleted }))
              } catch (e) {
                toast.error(storyError(e))
              }
            }}
          >
            {tx('stories.cleanupRun')}
          </Button>
        </div>
      </Page>
      <StoryComposer open={composer} onClose={() => setComposer(false)} official />
    </div>
  )
}

function OfficialStories({ onNew }: { onNew: () => void }) {
  const tx = useT()
  const [scope, setScope] = useState<'all' | 'active' | 'expired'>('all')
  const q = useAdminStories(scope)
  const urls = useStoryUrls(q.data ?? [])
  const notify = useNotifyStory()
  const del = useDeleteStory()
  const [picker, setPicker] = useState<AdminStoryCard | null>(null)
  const list = q.data ?? []

  async function onNotify(s: AdminStoryCard) {
    if (!window.confirm(tx('stories.confirmNotify'))) return
    try {
      const n = await notify.mutateAsync(s.id)
      toast.success(tx('stories.notified', { count: n }))
    } catch (e) {
      toast.error(storyError(e))
    }
  }
  async function onDelete(s: AdminStoryCard) {
    if (!window.confirm(tx('stories.confirmDelete'))) return
    try {
      await del.mutateAsync(s.id)
      toast.success(tx('stories.deleted'))
    } catch (e) {
      toast.error(storyError(e))
    }
  }

  const audienceText = (s: AdminStoryCard) =>
    s.audience === 'event' ? tx('stories.audTagEvent', { event: s.event_title ?? '…' }) : s.audience === 'group' ? tx('stories.audTagGroup', { group: s.group_name ?? '…' }) : tx('stories.audTagAll')

  return (
    <div className="space-y-3" data-testid="admin-stories">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <span>{tx('stories.adminShow')}</span>
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="!min-h-11 w-auto" aria-label={tx('stories.adminShow')} data-testid="admin-scope">
            <option value="all">{tx('stories.scopeAll')}</option>
            <option value="active">{tx('stories.scopeActive')}</option>
            <option value="expired">{tx('stories.scopeExpired')}</option>
          </Select>
        </label>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : q.isError ? (
        <Notice tone="danger" title={storyError(q.error)}><Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{tx('stories.retry')}</Button></Notice>
      ) : list.length === 0 ? (
        <EmptyState icon={<Sparkles />} title={tx('stories.adminNone')} action={<Button onClick={onNew}>{tx('stories.adminNew')}</Button>}>{tx('stories.adminNoneBody')}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((s) => {
            const left = timeLeft(s.expires_at)
            return (
              <li key={s.id} className="rounded-2xl border border-border bg-surface p-3" data-testid="admin-story" data-story-id={s.id}>
                <div className="flex gap-3">
                  <StoryThumb card={s} url={s.thumb_path ? urls.data?.[s.thumb_path] : undefined} className="h-24 w-[4.5rem] shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="line-clamp-2 break-words font-semibold">{s.caption || s.text_body || tx(`stories.kind_${s.kind}`)}</p>
                    <p className="text-sm text-muted">{relativeTime(s.created_at)} · {tx(`stories.kind_${s.kind}`)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="primary" className="max-w-full truncate">{audienceText(s)}</Badge>
                      {s.is_hidden ? <Badge tone="danger">{tx('stories.tagHidden')}</Badge> : !s.ready ? <Badge tone="warning">{tx('stories.tagUploading')}</Badge> : s.active && left ? <Badge tone="success">{left.hours > 0 ? tx('stories.leftHM', { h: left.hours, m: left.minutes }) : tx('stories.leftM', { m: left.minutes })}</Badge> : <Badge>{tx('stories.expiredTag')}</Badge>}
                      {s.notified_at && <Badge tone="accent"><Bell className="size-3" aria-hidden /> {tx('stories.tagNotified', { count: s.notified_count ?? 0 })}</Badge>}
                      {s.highlights > 0 && <Badge><Sparkles className="size-3" aria-hidden /> {s.highlights}</Badge>}
                    </div>
                    <p className="flex gap-4 text-sm font-medium">
                      <span className="inline-flex items-center gap-1" aria-label={tx('stories.views', { count: s.views ?? 0 })}><Eye className="size-4" aria-hidden /> <span data-testid="admin-story-views">{s.views ?? 0}</span></span>
                      <span className="inline-flex items-center gap-1" aria-label={tx('stories.hearts', { count: s.hearts ?? 0 })}><Heart className="size-4" aria-hidden /> <span data-testid="admin-story-hearts">{s.hearts ?? 0}</span></span>
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.active && !s.notified_at && s.ready && (
                    <Button size="sm" variant="secondary" icon={<Bell className="size-4" />} onClick={() => void onNotify(s)} data-testid="admin-notify">{tx('stories.notifyMembers')}</Button>
                  )}
                  {s.ready && <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => setPicker(s)} data-testid="admin-add-highlight">{tx('stories.saveToHighlight')}</Button>}
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => void onDelete(s)} data-testid="admin-delete-story">{tx('stories.delete')}</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {picker && <HighlightPickerSheet open onClose={() => setPicker(null)} story={picker} />}
    </div>
  )
}

function OfficialHighlights() {
  const tx = useT()
  const q = useHighlights({ official: true })
  const reorder = useReorderHighlights(true)
  const [editor, setEditor] = useState<{ id: string | null } | null>(null)
  const list = q.data ?? []
  const urls = useStoryUrls(list.map((h) => ({ media_path: null, thumb_path: h.cover?.thumb_path ?? null })))

  async function move(i: number, by: -1 | 1) {
    try {
      await reorder.mutateAsync(moveItem(list, i, by).map((h) => h.id))
    } catch (e) {
      toast.error(storyError(e))
    }
  }

  return (
    <div className="space-y-3" data-testid="admin-highlights">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{tx('highlights.adminHelp')}</p>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditor({ id: null })} data-testid="admin-new-highlight">{tx('highlights.new')}</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : list.length === 0 ? (
        <EmptyState icon={<Sparkles />} title={tx('highlights.adminNone')}>{tx('highlights.adminNoneBody')}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.map((h, i) => (
            <li key={h.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3" data-testid="admin-highlight" data-highlight-id={h.id}>
              {h.cover ? <StoryThumb card={h.cover} url={h.cover.thumb_path ? urls.data?.[h.cover.thumb_path] : undefined} className="size-14 shrink-0 rounded-full" /> : <span className="size-14 shrink-0 rounded-full bg-surface-2" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{h.title}</p>
                <p className="text-sm text-muted">{tx('stories.itemCount', { count: h.count })} · {tx(h.audience === 'all' ? 'highlights.audPublic' : 'highlights.audInheritOfficial')}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditor({ id: h.id })} data-testid="admin-edit-highlight">{tx('common.edit')}</Button>
              <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-40" disabled={i === 0} aria-label={tx('highlights.moveUp')} onClick={() => void move(i, -1)}><ArrowUp className="size-4" aria-hidden /></button>
              <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-40" disabled={i === list.length - 1} aria-label={tx('highlights.moveDown')} onClick={() => void move(i, 1)}><ArrowDown className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {editor && <HighlightEditor open id={editor.id} official onClose={() => setEditor(null)} />}
    </div>
  )
}
