import type { LucideIcon } from 'lucide-react'
import { isValidElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type TileTone = 'emerald' | 'gold' | 'maroon' | 'teal' | 'ink' | 'plum' | 'neutral'
export type TileStyle = 'soft' | 'solid' | 'glass'
export type TileSize = 'sm' | 'md' | 'lg' | 'xl'

// soft: tinted chip with a coloured glyph (works on surfaces in both themes)
const SOFT: Record<TileTone, string> = {
  emerald: 'bg-primary-soft text-primary',
  gold: 'bg-accent-soft text-gold-ink',
  maroon: 'bg-official-soft text-official',
  teal: 'bg-[#e0f2f1] text-[#12635e] dark:bg-[#0e2c2b] dark:text-[#7fd6cf]',
  ink: 'bg-info-soft text-info',
  plum: 'bg-[#f1e7f5] text-[#6b2b78] dark:bg-[#2a1832] dark:text-[#dcaee6]',
  neutral: 'bg-surface-2 text-muted',
}
// solid: brand gradient with a white glyph and inner highlight (hero quick actions, empty states)
const SOLID: Record<TileTone, string> = {
  emerald: 'bg-[linear-gradient(135deg,#1f916a,#0a5540)]',
  gold: 'bg-[linear-gradient(135deg,#e4ad45,#a8661b)]',
  maroon: 'bg-[linear-gradient(135deg,#b9434f,#621925)]',
  teal: 'bg-[linear-gradient(135deg,#2a9d96,#12534f)]',
  ink: 'bg-[linear-gradient(135deg,#4f6fb5,#24356b)]',
  plum: 'bg-[linear-gradient(135deg,#8a5aa8,#4d2a66)]',
  neutral: 'bg-[linear-gradient(135deg,#6b685b,#393832)]',
}
const SIZES: Record<TileSize, { box: string; icon: string; child: string }> = {
  sm: { box: 'size-9 rounded-[10px]', icon: 'size-[18px]', child: '[&_svg]:size-[18px]' },
  md: { box: 'size-11 rounded-[13px]', icon: 'size-5', child: '[&_svg]:size-5' },
  lg: { box: 'size-14 rounded-2xl', icon: 'size-6', child: '[&_svg]:size-6' },
  xl: { box: 'size-20 rounded-[26px]', icon: 'size-9', child: '[&_svg]:size-9' },
}

/**
 * An icon sitting in a rounded tile — the house style for quick actions, menu rows, settings and empty states.
 * Pass a lucide component (`icon={Users}`) or an element (`icon={<Users />}`). Decorative: aria-hidden.
 */
export function IconTile({
  icon: Icon,
  tone = 'emerald',
  variant = 'soft',
  size = 'md',
  className,
}: {
  icon: LucideIcon | ReactNode
  tone?: TileTone
  variant?: TileStyle
  size?: TileSize
  className?: string
}) {
  const s = SIZES[size]
  const isComponent = !isValidElement(Icon) && (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null && '$$typeof' in Icon))
  const C = Icon as LucideIcon
  const glyph = isComponent ? <C className={s.icon} strokeWidth={1.9} aria-hidden /> : (Icon as ReactNode)
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-grid shrink-0 place-items-center [&_svg]:shrink-0',
        s.box,
        !isComponent && s.child,
        variant === 'soft' && SOFT[tone],
        variant === 'solid' && [SOLID[tone], 'text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_6px_16px_-8px_rgb(0_0_0/0.45)]'],
        variant === 'glass' && 'glass-dark text-white',
        className,
      )}
    >
      {glyph}
    </span>
  )
}
