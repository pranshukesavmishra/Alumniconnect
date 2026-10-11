import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Avatar } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { useStoryViewer } from './viewerContext'
import { useStoryRing } from './api'

export type RingState = 'unseen' | 'seen' | 'official'

/** A coloured ring around a picture: bright for stories you have not watched, dim for ones you have, gold for official ones. */
export function RingFrame({ state, size, children, className, bleed }: { state: RingState; size: number; children: ReactNode; className?: string; bleed?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full p-[3px]',
        state === 'unseen' && 'bg-gradient-to-tr from-amber-400 via-rose-500 to-primary',
        state === 'official' && 'bg-gradient-to-tr from-amber-300 via-amber-500 to-yellow-300',
        state === 'seen' && 'bg-border opacity-80',
        className,
      )}
      style={{ width: size + 10, height: size + 10, margin: bleed ? -5 : undefined }}
      data-ring={state}
    >
      <span className="grid place-items-center rounded-full bg-bg p-[2px]">{children}</span>
    </span>
  )
}

/**
 * A member's picture that carries a story ring when they have an active story the viewer may watch. With `interactive` it is a button
 * that opens the story viewer (use it where the picture is not inside a link); otherwise it only shows the ring and the page around it
 * provides the tap (see `StoryRingOverlay`).
 */
export function StoryAvatar({ userId, name, src, size = 48, interactive = true, className, bleed }: { userId: string; name: string; src?: string | null; size?: number; className?: string; interactive?: boolean; bleed?: boolean }) {
  const tx = useT()
  const viewer = useStoryViewer()
  const { data: ring } = useStoryRing(userId)
  const avatar = <Avatar src={src} name={name} size={size} className={className} />
  if (!ring) return avatar
  const state: RingState = ring.unseen_count > 0 ? 'unseen' : 'seen'
  const frame = <RingFrame state={state} size={size} bleed={bleed}>{avatar}</RingFrame>
  if (!interactive) return frame
  return (
    <button
      type="button"
      className="rounded-full"
      aria-label={tx(state === 'unseen' ? 'stories.watchUnseen' : 'stories.watchSeen', { name })}
      data-testid="story-avatar"
      data-story-state={state}
      onClick={() => viewer.open([{ type: 'owner', id: userId }])}
    >
      {frame}
    </button>
  )
}

/** A transparent button laid over a picture inside a link (a list row), so tapping the ringed picture opens the story and the rest of the row still opens the profile. */
export function StoryRingOverlay({ userId, name, size, className }: { userId: string; name: string; size: number; className?: string }) {
  const tx = useT()
  const viewer = useStoryViewer()
  const { data: ring } = useStoryRing(userId)
  if (!ring) return null
  return (
    <button
      type="button"
      className={clsx('absolute z-10 rounded-full', className)}
      style={{ width: size + 10, height: size + 10 }}
      aria-label={tx(ring.unseen_count > 0 ? 'stories.watchUnseen' : 'stories.watchSeen', { name })}
      data-testid="story-avatar"
      data-story-state={ring.unseen_count > 0 ? 'unseen' : 'seen'}
      onClick={() => viewer.open([{ type: 'owner', id: userId }])}
    />
  )
}
