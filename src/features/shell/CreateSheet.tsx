import { useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, ChevronRight, CirclePlus, HandHelping, Images, MessageCirclePlus, PenLine, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { IconTile, type TileTone } from '../../components/ui/IconTile'
import { Sheet } from '../../components/ui/Sheet'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { useT, type MsgKey } from '../../i18n'
import { haptic } from '../../lib/haptics'
import { useGroups } from '../community/queries'

const Composer = lazy(() => import('../community/Composer').then((r) => ({ default: r.Composer })))
const StoryComposer = lazy(() => import('../stories/StoryComposer').then((r) => ({ default: r.StoryComposer })))

type Kind = 'post' | 'story' | 'media' | 'job' | 'ask' | 'chat'
interface Action {
  id: Kind
  title: MsgKey
  hint: MsgKey
  icon: LucideIcon
  tone: TileTone
  to?: string
}

export const CREATE_ACTIONS: readonly Action[] = [
  { id: 'post', title: 'shell.c.post', hint: 'shell.c.postHint', icon: PenLine, tone: 'emerald' },
  { id: 'story', title: 'shell.c.story', hint: 'shell.c.storyHint', icon: CirclePlus, tone: 'maroon' },
  { id: 'media', title: 'shell.c.media', hint: 'shell.c.mediaHint', icon: Images, tone: 'teal', to: '/meet/photos/upload' },
  { id: 'job', title: 'shell.c.job', hint: 'shell.c.jobHint', icon: BriefcaseBusiness, tone: 'ink', to: '/jobs/new' },
  { id: 'ask', title: 'shell.c.ask', hint: 'shell.c.askHint', icon: HandHelping, tone: 'gold', to: '/help' },
  { id: 'chat', title: 'shell.c.chat', hint: 'shell.c.chatHint', icon: MessageCirclePlus, tone: 'plum', to: '/people' },
]

/** The post composer in a sheet: opens straight into writing, closes itself once the post is up. */
function PostSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tx = useT()
  const qc = useQueryClient()
  const { data: groups } = useGroups()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    // skip the "Share news…" prompt: open the writing area at once
    let tries = 0
    const t = window.setInterval(() => {
      const prompt = box.current?.querySelector<HTMLButtonElement>('button')
      if (prompt && !box.current?.querySelector('textarea')) prompt.click()
      if (box.current?.querySelector('textarea') || ++tries > 40) window.clearInterval(t)
    }, 50)
    const unsub = qc.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && e.mutation.state.status === 'success') onClose()
    })
    return () => {
      window.clearInterval(t)
      unsub()
    }
  }, [open, qc, onClose])
  return (
    <Sheet open={open} onClose={onClose} label={tx('shell.c.post')}>
      <div className="px-5 pb-3 pt-5">
        <p className="text-eyebrow text-gold-ink">{tx('shell.create')}</p>
        <h2 className="mt-1 text-h2">{tx('shell.c.post')}</h2>
        <p className="mt-1 text-body text-muted">{tx('shell.c.postHint')}</p>
      </div>
      <div ref={box} className="px-3 pb-2 [&>div]:shadow-none">
        <Suspense fallback={<SkeletonCard media={false} />}>{groups && <Composer groups={groups} />}</Suspense>
      </div>
    </Sheet>
  )
}

/** The Create menu: every way to add something, each one line, opened from the centre of the tab bar. */
export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tx = useT()
  const navigate = useNavigate()
  const [post, setPost] = useState(false)
  const [story, setStory] = useState(false)
  const closePost = useCallback(() => setPost(false), [])

  function pick(a: Action) {
    haptic()
    onClose()
    if (a.id === 'post') setPost(true)
    else if (a.id === 'story') setStory(true)
    else if (a.to) navigate(a.to)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} label={tx('shell.create')} className="md:max-w-lg">
        <div className="relative overflow-hidden px-5 pb-4 pt-6">
          <div aria-hidden className="fx-dots pointer-events-none absolute inset-0 opacity-60" />
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[radial-gradient(circle,rgb(228_173_69/0.28),transparent_65%)]" />
          <div className="relative">
            <p className="text-eyebrow text-gold-ink">{tx('shell.c.eyebrow')}</p>
            <h2 className="mt-1.5 text-h1">{tx('shell.c.title')}</h2>
          </div>
        </div>
        <ul className="mx-3 mb-2 overflow-hidden rounded-[24px] border border-border/70 bg-surface shadow-card" data-testid="create-actions">
          {CREATE_ACTIONS.map((a, i) => (
            <li key={a.id} className={i > 0 ? 'border-t border-border/60' : undefined}>
              <button type="button" onClick={() => pick(a)} className="fx-press group flex min-h-[68px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-2">
                <IconTile icon={a.icon} tone={a.tone} variant="solid" size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block text-title">{tx(a.title)}</span>
                  <span className="block text-caption text-muted">{tx(a.hint)}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      <PostSheet open={post} onClose={closePost} />
      {story && (
        <Suspense fallback={null}>
          <StoryComposer open={story} onClose={() => setStory(false)} />
        </Suspense>
      )}
    </>
  )
}
