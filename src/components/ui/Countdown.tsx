import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}

/**
 * Days / hrs / min / sec flip tiles counting down to `to`. Seconds can be hidden (`seconds={false}`) for calmer UIs.
 * `variant="glass"` for use on the aurora hero; `default` on page surfaces. Screen readers get one summary label.
 */
export function Countdown({ to, seconds = true, variant = 'default', className }: { to: string | Date; seconds?: boolean; variant?: 'default' | 'glass'; className?: string }) {
  const tx = useT()
  const target = typeof to === 'string' ? new Date(to).getTime() : to.getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), seconds ? 1000 : 30_000)
    return () => window.clearInterval(id)
  }, [seconds])
  const p = parts(target - now)
  const units: { v: number; label: string }[] = [
    { v: p.days, label: tx('ds.countdown.days') },
    { v: p.hours, label: tx('ds.countdown.hours') },
    { v: p.minutes, label: tx('ds.countdown.minutes') },
    ...(seconds ? [{ v: p.seconds, label: tx('ds.countdown.seconds') }] : []),
  ]
  const glass = variant === 'glass'
  return (
    <div
      role="timer"
      aria-label={tx('ds.countdown.aria', { days: p.days, hours: p.hours, minutes: p.minutes })}
      className={cn('grid gap-2', seconds ? 'grid-cols-4' : 'grid-cols-3', className)}
    >
      {units.map((u) => (
        <div
          key={u.label}
          aria-hidden
          className={cn(
            'relative flex flex-col items-center overflow-hidden rounded-2xl px-1 pb-2 pt-2.5',
            glass ? 'glass-dark text-white' : 'border border-border/80 bg-surface shadow-card',
          )}
        >
          {/* the fold line of a flip clock */}
          <span className={cn('pointer-events-none absolute inset-x-0 top-[44%] h-px', glass ? 'bg-black/25' : 'bg-border/80')} />
          <span key={u.v} className="text-stat block text-[2rem] [animation:flip-in_420ms_var(--ease-out)] motion-reduce:animate-none">
            {String(u.v).padStart(2, '0')}
          </span>
          <span className={cn('text-[11px] font-semibold uppercase tracking-[0.12em]', glass ? 'text-white/70' : 'text-muted')}>{u.label}</span>
        </div>
      ))}
    </div>
  )
}
