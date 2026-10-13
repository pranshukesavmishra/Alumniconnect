import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type CardVariant = 'default' | 'elevated' | 'glass' | 'gradient-border' | 'interactive' | 'sunken' | 'hero'

const cardVariants: Record<CardVariant, string> = {
  default: 'border border-border/80 bg-surface shadow-card',
  elevated: 'border border-border/60 bg-elevated shadow-e3',
  glass: 'glass',
  'gradient-border': 'hairline-gradient bg-surface shadow-e2',
  interactive: 'border border-border/80 bg-surface shadow-card lift hover:border-border-strong cursor-pointer',
  sunken: 'bg-surface-2 border border-border/60',
  hero: 'aurora text-white shadow-e4 overflow-hidden',
}

/**
 * The base container. 24px radius, hairline border, soft elevation.
 * `variant="interactive"` lifts on hover (desktop) and presses on tap; `glass` for over imagery/aurora; `hero` for dark brand panels.
 */
export function Card({ className, variant = 'default', ...rest }: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return <div className={cn('rounded-3xl', cardVariants[variant], className)} {...rest} />
}

export function cardClass(variant: CardVariant = 'default', extra?: string) {
  return cn('rounded-3xl', cardVariants[variant], extra)
}

/** Glass surface (translucent + blur + inner highlight). `tone="dark"` for use over the aurora. */
export function GlassPanel({ className, tone = 'auto', ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: 'auto' | 'dark' }) {
  return <div className={cn('rounded-3xl', tone === 'dark' ? 'glass-dark text-white' : 'glass', className)} {...rest} />
}

/** Section header: small eyebrow + serif title + optional action (e.g. "See all"). */
export function SectionHeader({
  eyebrow,
  title,
  action,
  description,
  className,
  as: H = 'h2',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  action?: ReactNode
  description?: ReactNode
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-1 text-gold-ink">{eyebrow}</p>}
        <H className="text-h2 text-text">{title}</H>
        {description && <p className="text-body mt-1 text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** A thin rule, optionally with a centred label ("or", "Earlier"). */
export function Divider({ label, className }: { label?: ReactNode; className?: string }) {
  if (!label) return <hr className={cn('border-0 border-t border-border', className)} />
  return (
    <div className={cn('flex items-center gap-3 text-caption font-semibold text-muted', className)} role="separator">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
      {label}
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
    </div>
  )
}
