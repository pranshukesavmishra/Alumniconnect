import {
  Award,
  BadgeCheck,
  BookOpen,
  Camera,
  ClipboardList,
  Crown,
  Flag,
  Gem,
  Gift,
  GraduationCap,
  HandHeart,
  HeartHandshake,
  Link as LinkIcon,
  Lock,
  Network,
  PartyPopper,
  Star,
  type LucideIcon,
} from 'lucide-react'
import { useId } from 'react'
import { cn } from '../../lib/cn'
import type { BadgeTier } from './catalog'
import { MEDAL, medalToneOf, type MedalTone } from './medal'
import './medallion.css'

/** lucide icons by the names used in the catalogue */
export const BADGE_ICONS: Record<string, LucideIcon> = {
  BadgeCheck,
  Crown,
  Star,
  Link: LinkIcon,
  Network,
  GraduationCap,
  HandHeart,
  BookOpen,
  Camera,
  PartyPopper,
  HeartHandshake,
  Gift,
  Gem,
  ClipboardList,
  Flag,
}
export const badgeIcon = (name: string): LucideIcon => BADGE_ICONS[name] ?? Award

// 32-tooth scalloped rim around (60, 60)
const RIM = (() => {
  const pts: string[] = []
  const teeth = 32
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 57 : 53.6
    pts.push(`${(60 + Math.cos(a) * r).toFixed(2)},${(60 + Math.sin(a) * r).toFixed(2)}`)
  }
  return pts.join(' ')
})()

/**
 * A glossy, minted medallion for a badge: metallic scalloped rim, enamel face with fine engraving, a gloss highlight,
 * the badge icon and (when earned) a slow light sweep. Locked badges are matte grey with a small lock.
 * Decorative: give the surrounding control the accessible name.
 */
export function BadgeMedallion({
  badge,
  size = 96,
  shine = true,
  className,
}: {
  badge: { key: string; tier: BadgeTier; icon: string; earned: boolean }
  size?: number
  shine?: boolean
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const tone: MedalTone = medalToneOf(badge)
  const f = MEDAL[tone]
  const Icon = badgeIcon(badge.icon)
  const locked = !badge.earned
  return (
    <span
      aria-hidden
      data-medal={tone}
      className={cn('medal relative inline-grid shrink-0 place-items-center', locked && 'medal-locked', className)}
      style={{ width: size, height: size, ['--medal-glow' as string]: f.glow }}
    >
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
            {f.rim.map((c, i) => (
              <stop key={i} offset={i / (f.rim.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
          <radialGradient id={`${id}-face`} cx="0.38" cy="0.32" r="0.75">
            {f.face.map((c, i) => (
              <stop key={i} offset={i / (f.face.length - 1)} stopColor={c} />
            ))}
          </radialGradient>
          <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <polygon points={RIM} />
          </clipPath>
        </defs>
        <polygon points={RIM} fill={`url(#${id}-rim)`} />
        <circle cx="60" cy="60" r="49.5" fill="none" stroke="rgb(0 0 0 / 0.28)" strokeWidth="1.2" />
        <circle cx="60" cy="60" r="47" fill={`url(#${id}-face)`} />
        <g fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="0.6">
          {[18, 22, 26, 30, 34, 38, 42].map((r) => (
            <circle key={r} cx="60" cy="60" r={r} />
          ))}
        </g>
        <circle cx="60" cy="60" r="44.5" fill="none" stroke={f.bevel} strokeOpacity="0.8" strokeWidth="1.1" />
        <ellipse cx="60" cy="36" rx="32" ry="17" fill={`url(#${id}-gloss)`} />
        {shine && !locked && (
          <g clipPath={`url(#${id}-clip)`}>
            <rect className="medal-sweep" x="-60" y="-10" width="40" height="140" fill={`url(#${id}-sweep)`} transform="skewX(-18)" />
          </g>
        )}
      </svg>
      <span data-medal-icon className="relative grid place-items-center" style={{ color: f.ink, width: size * 0.4, height: size * 0.4 }}>
        <Icon className="size-full drop-shadow-[0_1.5px_1px_rgb(0_0_0/0.45)]" strokeWidth={2.1} />
      </span>
      {locked && (
        <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border border-border bg-surface text-muted shadow-e2" style={{ width: Math.max(22, size * 0.28), height: Math.max(22, size * 0.28) }}>
          <Lock className="size-[55%]" strokeWidth={2.2} />
        </span>
      )}
    </span>
  )
}
