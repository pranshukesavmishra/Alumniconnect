import { Heart, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Avatar, Skeleton } from '../../components/ui/Display'
import { Field, Input, Textarea } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { relativeTime } from '../../lib/format'
import { useUserId } from '../auth/AuthProvider'
import { storyError, useAddToHighlight, useHighlights, useReportStory, useSaveHighlight, useStoryViewers, type StoryCard } from './api'
import { MAX_TITLE } from './rules'

interface SheetProps {
  open: boolean
  onClose: () => void
  story: StoryCard
}

/** Names only: who watched, newest first, and who sent a heart. (The owner of a story, or an official-story admin, sees this.) */
export function ViewersSheet({ open, onClose, story }: SheetProps) {
  const tx = useT()
  const q = useStoryViewers(open ? story.id : null)
  return (
    <Sheet open={open} onClose={onClose} label={tx('stories.seenBy')}>
      <div className="px-5 pb-3 pt-1" data-testid="story-viewers">
        <h2 className="text-lg font-bold">{tx('stories.seenBy')}</h2>
        <p className="text-sm text-muted">{tx('stories.viewsHearts', { views: story.views ?? 0, hearts: story.hearts ?? 0 })}</p>
        {q.isLoading ? (
          <Skeleton className="mt-3 h-16 rounded-2xl" />
        ) : q.isError ? (
          <div className="mt-3 space-y-2" role="alert">
            <p className="text-sm text-danger">{storyError(q.error)}</p>
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{tx('stories.retry')}</Button>
          </div>
        ) : !q.data?.length ? (
          <p className="mt-4 text-muted">{tx('stories.noViewers')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {q.data.map((v) => (
              <li key={v.viewer_id} className="flex min-h-14 items-center gap-3 py-2" data-testid="story-viewer-row">
                <Avatar src={v.avatar_url} name={v.full_name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{v.full_name}</p>
                  <p className="text-xs text-muted">{relativeTime(v.viewed_at)}</p>
                </div>
                {v.hearted && <Heart className="size-5 shrink-0 fill-rose-500 text-rose-500" aria-label={tx('stories.heartedIt')} />}
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-4" block variant="secondary" onClick={onClose}>{tx('common.close')}</Button>
      </div>
    </Sheet>
  )
}

export function ReportSheet({ open, onClose, story }: SheetProps) {
  const tx = useT()
  const [reason, setReason] = useState('')
  const report = useReportStory()
  return (
    <Sheet open={open} onClose={onClose} label={tx('stories.report')}>
      <form
        className="space-y-3 px-5 pb-3 pt-1"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await report.mutateAsync({ id: story.id, reason: reason.trim() })
            toast.success(tx('stories.reported'))
            setReason('')
            onClose()
          } catch (err) {
            toast.error(storyError(err))
          }
        }}
      >
        <h2 className="text-lg font-bold">{tx('stories.report')}</h2>
        <p className="text-sm text-muted">{tx('stories.reportHelp')}</p>
        <Field label={tx('stories.reportWhy')}>
          {(p) => <Textarea {...p} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="story-report-reason" />}
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>{tx('common.cancel')}</Button>
          <Button type="submit" className="flex-1" loading={report.isPending} disabled={reason.trim().length < 3} data-testid="story-report-send">{tx('stories.reportSend')}</Button>
        </div>
      </form>
    </Sheet>
  )
}

/** Choose a highlight (or start one) to keep this story in after it has expired. */
export function HighlightPickerSheet({ open, onClose, story }: SheetProps) {
  const tx = useT()
  const uid = useUserId()
  const official = story.is_official
  const list = useHighlights(open ? (official ? { official: true } : uid ? { owner: uid } : null) : null)
  const add = useAddToHighlight()
  const save = useSaveHighlight(official)
  const [title, setTitle] = useState('')
  const mine = (list.data ?? []).filter((h) => h.mine || official)

  async function addTo(id: string) {
    try {
      await add.mutateAsync({ highlight: id, story: story.id })
      toast.success(tx('stories.savedToHighlight'))
      onClose()
    } catch (e) {
      toast.error(storyError(e))
    }
  }
  async function create() {
    try {
      const id = await save.mutateAsync({ title: title.trim() })
      setTitle('')
      await addTo(id)
    } catch (e) {
      toast.error(storyError(e))
    }
  }
  return (
    <Sheet open={open} onClose={onClose} label={tx('stories.saveToHighlight')}>
      <div className="space-y-3 px-5 pb-3 pt-1" data-testid="story-highlight-picker">
        <h2 className="text-lg font-bold">{tx('stories.saveToHighlight')}</h2>
        <p className="text-sm text-muted">{tx('stories.highlightHelp')}</p>
        {list.isLoading ? (
          <Skeleton className="h-14 rounded-2xl" />
        ) : (
          <ul className="space-y-2">
            {mine.map((h) => (
              <li key={h.id}>
                <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 text-left font-semibold hover:bg-surface-2" onClick={() => void addTo(h.id)}>
                  <span className="truncate">{h.title}</span>
                  <span className="text-sm font-normal text-muted">{tx('stories.itemCount', { count: h.count })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) void create()
          }}
        >
          <Field label={tx('stories.newHighlight')} className="flex-1">
            {(p) => <Input {...p} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder={tx('stories.highlightName')} data-testid="story-new-highlight" />}
          </Field>
          <Button type="submit" icon={<Plus className="size-4" />} disabled={!title.trim()} loading={save.isPending} aria-label={tx('stories.createHighlight')}>
            {tx('stories.createHighlight')}
          </Button>
        </form>
      </div>
    </Sheet>
  )
}
