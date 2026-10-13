import { cn } from '../../lib/cn'

/** Shimmering placeholder block. Size it with classes (`h-5 w-40`). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} aria-hidden />
}

/** Avatar + two lines: a person / chat / notification row. */
export function SkeletonRow({ className, avatar = 44 }: { className?: string; avatar?: number }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)} aria-hidden>
      <div className="skeleton shrink-0 rounded-full" style={{ width: avatar, height: avatar }} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-4 w-2/5 rounded-md" />
        <div className="skeleton h-3.5 w-3/4 rounded-md" />
      </div>
    </div>
  )
}

/** A card with a media area and text lines. */
export function SkeletonCard({ className, media = true }: { className?: string; media?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-3xl border border-border/70 bg-surface p-4 shadow-card', className)} aria-hidden>
      {media && <div className="skeleton -mx-4 -mt-4 mb-4 aspect-[16/9]" />}
      <div className="skeleton h-5 w-3/5 rounded-md" />
      <div className="skeleton mt-2.5 h-3.5 w-full rounded-md" />
      <div className="skeleton mt-2 h-3.5 w-4/5 rounded-md" />
    </div>
  )
}

/** Profile header: big avatar, name, headline, two buttons. */
export function SkeletonProfile({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-6', className)} aria-hidden>
      <div className="skeleton size-24 rounded-full" />
      <div className="skeleton h-6 w-48 rounded-lg" />
      <div className="skeleton h-4 w-64 rounded-md" />
      <div className="mt-2 flex gap-2">
        <div className="skeleton h-11 w-32 rounded-full" />
        <div className="skeleton h-11 w-32 rounded-full" />
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-border/70', className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
