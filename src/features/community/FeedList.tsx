import { Newspaper } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { EmptyState, Notice, Skeleton } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { PostCard } from './PostCard'
import { useFeed } from './queries'

/** Infinite feed: the next page loads before you reach the bottom, so scrolling never stalls. */
export function FeedList({ scope, showGroup = true, empty }: { scope: string; showGroup?: boolean; empty?: string }) {
  const feed = useFeed(scope)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
      },
      { rootMargin: '1200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [feed])

  if (feed.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    )
  }
  if (feed.error) return <Notice tone="danger" title={friendlyError(feed.error)} />
  const posts = feed.data?.pages.flat() ?? []
  if (!posts.length) return <EmptyState icon={<Newspaper />} title="Nothing here yet">{empty ?? 'Be the first to post.'}</EmptyState>
  return (
    <div className="space-y-3">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} showGroup={showGroup} />
      ))}
      <div ref={sentinel} />
      {feed.isFetchingNextPage && <Skeleton className="h-44" />}
      {!feed.hasNextPage && posts.length > 5 && <p className="py-4 text-center text-sm text-muted">You’re all caught up.</p>}
    </div>
  )
}
