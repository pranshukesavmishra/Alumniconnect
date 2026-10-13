import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { NumberTicker } from './Motion'

/**
 * A KPI tile: serif tabular number that counts up, a label, optional delta/hint and icon.
 * `variant="glass"` sits on an AuroraBackground (white text); `default` sits on the page.
 */
export function StatTile({
  value,
  label,
  hint,
  icon,
  format,
  prefix,
  suffix,
  variant = 'default',
  className,
}: {
  value: number
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  format?: (n: number) => string
  prefix?: ReactNode
  suffix?: ReactNode
  variant?: 'default' | 'glass' | 'plain'
  className?: string
}) {
  const onDark = variant === 'glass'
  // long figures (₹12,50,000) step down a size so they never overflow a half-width tile
  const len = (format ? format(value) : Math.round(value).toLocaleString('en-IN')).length + (prefix ? 1 : 0) + (suffix ? 1 : 0)
  const fs = len > 9 ? 'text-[1.375rem]' : len > 6 ? 'text-[1.625rem]' : 'text-[2rem]'
  return (
    <div
      className={cn(
        'min-w-0 rounded-[20px] p-4',
        variant === 'default' && 'border border-border/80 bg-surface shadow-card',
        onDark && 'glass-dark text-white',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-caption font-semibold', onDark ? 'text-white/75' : 'text-muted')}>{label}</p>
        {icon && <span className={cn('[&_svg]:size-4', onDark ? 'text-accent' : 'text-gold-ink')} aria-hidden>{icon}</span>}
      </div>
      <p className={cn('text-stat mt-2 whitespace-nowrap', fs)}>
        {prefix}
        <NumberTicker value={value} format={format} />
        {suffix}
      </p>
      {hint && <p className={cn('text-caption mt-1', onDark ? 'text-white/70' : 'text-muted')}>{hint}</p>}
    </div>
  )
}

/** Alias kept for readability in dashboards. */
export const Kpi = StatTile
