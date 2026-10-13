import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

// Brand-harmonious gradients for initials. Picked deterministically from the name so a person always gets the same one.
const GRADIENTS = [
  'linear-gradient(135deg, #1f916a 0%, #0b5a43 100%)', // emerald
  'linear-gradient(135deg, #b5741c 0%, #74451a 100%)', // gold
  'linear-gradient(135deg, #b9434f 0%, #731a27 100%)', // crest maroon
  'linear-gradient(135deg, #2a8f8a 0%, #12534f 100%)', // teal
  'linear-gradient(135deg, #5a6fb0 0%, #2e3b72 100%)', // ink blue
  'linear-gradient(135deg, #8a5aa8 0%, #4d2a66 100%)', // plum
  'linear-gradient(135deg, #c46a3a 0%, #7a3517 100%)', // terracotta
  'linear-gradient(135deg, #6d8a3a 0%, #3c5418 100%)', // olive
]

export function nameHash(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => [...p][0]?.toUpperCase())
      .join('') || '?'
  )
}

export function avatarGradient(name: string): string {
  return GRADIENTS[nameHash(name) % GRADIENTS.length]!
}

export type AvatarRing = 'none' | 'story' | 'seen' | 'verified' | 'official'
const RINGS: Record<Exclude<AvatarRing, 'none'>, string> = {
  story: 'conic-gradient(from 210deg, #3fae85, #e4ad45, #b9434f, #3fae85)',
  seen: 'linear-gradient(var(--border-strong), var(--border-strong))',
  verified: 'linear-gradient(135deg, #f6d98c, #d4922a 60%, #915719)',
  official: 'linear-gradient(135deg, #d16a77, #8b1e2d)',
}

/**
 * Photo or initials on a brand gradient. `ring` adds a story / verified / official ring; `presence` a status dot.
 * The bare form (no ring, no presence) renders one <span>, exactly like before.
 */
export function Avatar({
  src,
  name,
  size = 48,
  className,
  ring = 'none',
  presence,
  badge,
}: {
  src?: string | null
  name: string
  size?: number
  className?: string
  ring?: AvatarRing
  presence?: 'online' | 'away' | null
  /** a tiny element pinned bottom-right (e.g. an "add" plus) */
  badge?: ReactNode
}) {
  const core = (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-black/5 select-none',
        ring === 'none' && !presence && !badge && className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.38),
        backgroundImage: src ? undefined : avatarGradient(name),
        letterSpacing: '0.01em',
        textShadow: src ? undefined : '0 1px 1px rgb(0 0 0 / 0.18)',
      }}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : initialsOf(name)}
    </span>
  )
  if (ring === 'none' && !presence && !badge) return core
  const pad = ring === 'none' ? 0 : Math.max(2, Math.round(size * 0.05))
  const dot = Math.max(10, Math.round(size * 0.26))
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center rounded-full', className)} style={{ padding: pad, backgroundImage: ring === 'none' ? undefined : RINGS[ring] }}>
      {ring !== 'none' ? <span className="grid rounded-full bg-bg p-[2px]">{core}</span> : core}
      {presence && (
        <span
          aria-hidden
          className={cn('absolute bottom-[4%] right-[4%] rounded-full border-2 border-bg', presence === 'online' ? 'bg-success' : 'bg-accent')}
          style={{ width: dot, height: dot }}
        />
      )}
      {badge && <span className="absolute -bottom-0.5 -right-0.5">{badge}</span>}
    </span>
  )
}

/** Overlapping avatars with a "+N" chip. */
export function AvatarStack({ people, max = 4, size = 32, className, label }: { people: { name: string; src?: string | null }[]; max?: number; size?: number; className?: string; label?: string }) {
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span className={cn('inline-flex items-center', className)} role={label ? 'img' : undefined} aria-label={label}>
      {shown.map((p, i) => (
        <span key={`${p.name}-${i}`} className="-ml-2 rounded-full ring-2 ring-bg first:ml-0">
          <Avatar name={p.name} src={p.src} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="-ml-2 inline-grid place-items-center rounded-full bg-surface-2 font-semibold text-muted ring-2 ring-bg tabular-nums"
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}
