import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The signature hero surface: deep forest with emerald / teal / gold glows, grain, and (optionally) a slow drift.
 * Text inside is white; use `text-hero-text` for secondary lines and `text-accent` for eyebrows.
 * Reduced motion: the drift stops (CSS).
 */
export function AuroraBackground({
  children,
  className,
  animate = true,
  art,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { animate?: boolean; art?: ReactNode }) {
  return (
    <div className={cn('aurora overflow-hidden text-white', animate && 'aurora-drift', className)} {...rest}>
      {art && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-0 text-white/[0.09] [&_svg]:h-auto [&_svg]:w-full">
          {art}
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

/** Brand gradient text (emerald → gold → maroon) or gold foil. Keep to display sizes (≥ 24px). */
export function GradientText({ children, tone = 'brand', className }: { children: ReactNode; tone?: 'brand' | 'gold'; className?: string }) {
  return <span className={cn(tone === 'gold' ? 'text-gradient-gold' : 'text-gradient-brand', className)}>{children}</span>
}

/** A gold light sweeps across the text (e.g. "Registrations open"). Static with reduced motion. */
export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('shimmer-text', className)}>{children}</span>
}
