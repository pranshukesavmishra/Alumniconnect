import { Plus, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Avatar, Skeleton } from '../../components/ui/Display'
import { useT } from '../../i18n'
import { useMyProfile } from '../auth/AuthProvider'
import { storyError, useHighlights, useStoryFeed, useStoryUrls, type HighlightLite } from './api'
import { groupRings, viewerQueue, type FeedRing } from './rules'
import { StoryComposer } from './StoryComposer'
import { RingFrame, type RingState } from './StoryRing'
import { useStoryViewer } from './viewerContext'
import { HighlightCircle } from './Highlights'

const TILE = 'flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-2xl py-1 text-center'

function Tile({ label, children, onClick, aria, testId, state }: { label: string; children: ReactNode; onClick: () => void; aria: string; testId?: string; state?: string }) {
  return (
    <li>
      <button type="button" className={TILE} onClick={onClick} aria-label={aria} data-testid={testId} data-story-state={state}>
        {children}
        <span className="block w-full truncate text-xs font-medium">{label}</span>
      </button>
    </li>
  )
}

/**
 * The row at the top of Home: "Add your story", then yours, the official ring, then the people you are connected with who have a story
 * you may watch (unwatched first). Everyone else's open stories are under "More stories" (the newest 30).
 */
export function StoryRow() {
  const tx = useT()
  const { data: me } = useMyProfile()
  const feed = useStoryFeed()
  const viewer = useStoryViewer()
  const [composer, setComposer] = useState(false)
  const rings = groupRings(feed.data ?? [])
  const sourceOf = (r: FeedRing) => (r.section === 'official' ? ({ type: 'official' } as const) : ({ type: 'owner', id: r.owner_id! } as const))
  const open = (r: FeedRing) => {
    // people after this one in the row play on automatically
    const from = viewerQueue(rings, r)
    viewer.open(from.map(sourceOf))
  }
  const state = (r: FeedRing): RingState => (r.section === 'official' ? 'official' : r.unseen_count > 0 ? 'unseen' : 'seen')

  const ringTile = (r: FeedRing) => {
    const name = r.section === 'official' ? tx('stories.officialName') : (r.owner_name ?? '')
    const st = state(r)
    return (
      <Tile
        key={`${r.section}-${r.owner_id ?? 'official'}`}
        label={r.section === 'official' ? tx('stories.official') : name.split(' ')[0] || name}
        aria={r.section === 'official' ? tx('stories.watchOfficial') : tx(r.unseen_count > 0 ? 'stories.watchUnseen' : 'stories.watchSeen', { name })}
        testId={r.section === 'official' ? 'story-ring-official' : 'story-ring'}
        state={r.section === 'official' ? (r.unseen_count > 0 ? 'unseen' : 'seen') : st}
        onClick={() => open(r)}
      >
        <RingFrame state={st} size={56} className={r.section === 'official' && r.unseen_count === 0 ? 'opacity-80' : undefined}>
          {r.section === 'official' ? (
            <span className="grid size-14 place-items-center rounded-full bg-white"><img src="/jec-logo.png" alt="" className="size-10 object-contain" /></span>
          ) : (
            <Avatar src={r.owner_avatar} name={name} size={56} />
          )}
        </RingFrame>
      </Tile>
    )
  }

  return (
    <section aria-label={tx('stories.rowAria')} data-testid="story-row" className="space-y-1">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <Tile label={tx('stories.add')} aria={tx('stories.addAria')} onClick={() => setComposer(true)} testId="story-add">
          <span className="relative inline-grid" style={{ width: 66, height: 66 }}>
            <span className="grid size-full place-items-center"><Avatar src={me?.avatar_url} name={me?.full_name ?? '?'} size={56} /></span>
            <span className="absolute bottom-0 right-0 grid size-6 place-items-center rounded-full border-2 border-bg bg-primary text-on-primary"><Plus className="size-4" aria-hidden /></span>
          </span>
        </Tile>
        {rings.official && ringTile(rings.official)}
        {rings.mine && (
          <Tile
            label={tx('stories.yours')}
            aria={tx('stories.watchYours')}
            testId="story-ring-mine"
            state={rings.mine.unseen_count > 0 ? 'unseen' : 'seen'}
            onClick={() => viewer.open([{ type: 'owner', id: rings.mine!.owner_id! }])}
          >
            <RingFrame state={rings.mine.unseen_count > 0 ? 'unseen' : 'seen'} size={56}>
              <Avatar src={me?.avatar_url} name={me?.full_name ?? '?'} size={56} />
            </RingFrame>
          </Tile>
        )}
        {rings.connections.map(ringTile)}
        {feed.isLoading && Array.from({ length: 4 }, (_, i) => <li key={i} className={TILE}><Skeleton className="size-16 rounded-full" /><Skeleton className="h-3 w-12" /></li>)}
      </ul>
      {feed.isError && (
        <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm" role="alert" data-testid="story-row-error">
          <span className="min-w-0 flex-1 text-muted">{storyError(feed.error)}</span>
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-primary" onClick={() => void feed.refetch()}>
            <RefreshCw className="size-4" aria-hidden /> {tx('stories.retry')}
          </button>
        </div>
      )}
      {rings.more.length > 0 && (
        <div data-testid="story-more">
          <h2 className="px-0.5 text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('stories.more')}</h2>
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">{rings.more.map(ringTile)}</ul>
        </div>
      )}
      <StoryComposer open={composer} onClose={() => setComposer(false)} />
    </section>
  )
}

/** Official highlights on Home, under the story row. */
export function HighlightsStrip() {
  const tx = useT()
  const viewer = useStoryViewer()
  const q = useHighlights({ official: true })
  const list = (q.data ?? []).filter((h) => h.count > 0 || h.mine)
  const urls = useStoryUrls(list.map((h) => ({ media_path: null, thumb_path: h.cover?.thumb_path ?? null })))
  if (!list.length) return null
  return (
    <section aria-label={tx('highlights.title')} data-testid="highlights-strip">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('highlights.title')}</h2>
        <Link to="/highlights" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">{tx('home.seeAll')}</Link>
      </div>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {list.map((h: HighlightLite) => (
          <li key={h.id}>
            <HighlightCircle h={h} url={h.cover?.thumb_path ? urls.data?.[h.cover.thumb_path] : undefined} onOpen={() => viewer.open([{ type: 'highlight', id: h.id }])} />
          </li>
        ))}
      </ul>
    </section>
  )
}
