import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useInViewOnce } from './Motion'

type ProgressTone = 'primary' | 'gold' | 'brand'
const BAR: Record<ProgressTone, string> = {
  primary: 'bg-[linear-gradient(90deg,var(--emerald-400),var(--primary))]',
  gold: 'bg-(image:--grad-gold)',
  brand: 'bg-(image:--grad-brand)',
}

/** Linear progress with a gradient fill that grows in when first seen. `label` names it for screen readers. */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'primary',
  size = 'md',
  className,
}: {
  value: number
  max?: number
  label?: string
  tone?: ProgressTone
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>()
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)]', { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' }[size], className)}
    >
      <div
        className={cn('relative h-full rounded-full transition-[width] duration-[900ms] ease-[var(--ease-out)] motion-reduce:transition-none', BAR[tone])}
        style={{ width: `${seen ? pct : 0}%` }}
      >
        <span className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/25" aria-hidden />
      </div>
    </div>
  )
}

/** Circular progress (profile completeness, goals). Children render in the centre. */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  stroke = 6,
  label,
  tone = 'primary',
  children,
  className,
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  label?: string
  tone?: ProgressTone
  children?: ReactNode
  className?: string
}) {
  const id = useId()
  const [ref, seen] = useInViewOnce<HTMLDivElement>()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value / (max || 1)))
  const stops =
    tone === 'gold' ? ['#f6d98c', '#d4922a'] : tone === 'brand' ? ['var(--emerald-400)', 'var(--accent)'] : ['var(--emerald-300)', 'var(--primary)']
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={stops[0]} />
            <stop offset="1" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={seen ? c * (1 - pct) : c}
          className="transition-[stroke-dashoffset] duration-[1100ms] ease-[var(--ease-out)] motion-reduce:transition-none"
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  )
}
