import { Building2, FlaskConical, GraduationCap, HandCoins, Megaphone, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/Display'
import { useReducedMotion } from '../../components/ui/Motion'
import { useT, type MsgKey } from '../../i18n'
import { tr } from '../../i18n/core'
import { cn } from '../../lib/cn'
import { formatPaise } from '../../lib/money'
import { coverUrl, type CampaignSummary } from './api'
import { barWidth, percentOf } from './helpers'

export const TYPE_KEY: Record<string, MsgKey> = {
  project: 'give.type.project',
  scholarship: 'give.type.scholarship',
  adopt: 'give.type.adopt',
  alumni_fund: 'give.type.alumni_fund',
  drive: 'give.type.drive',
}

/** Category icon and tile tone for each kind of appeal. */
export const TYPE_ICON: Record<string, { icon: LucideIcon; tone: 'emerald' | 'gold' | 'teal' | 'plum' | 'ink' }> = {
  project: { icon: Building2, tone: 'emerald' },
  scholarship: { icon: GraduationCap, tone: 'gold' },
  adopt: { icon: FlaskConical, tone: 'teal' },
  alumni_fund: { icon: HandCoins, tone: 'plum' },
  drive: { icon: Megaphone, tone: 'ink' },
}

// designed poster backgrounds per kind (used when an appeal has no cover photo)
const POSTER: Record<string, string> = {
  project: 'radial-gradient(120% 90% at 100% 0%, #e4ad45 0%, transparent 45%), linear-gradient(150deg, #0f7a57, #084434 55%, #041a14)',
  scholarship: 'radial-gradient(120% 90% at 0% 0%, #f4dc9e 0%, transparent 45%), linear-gradient(150deg, #b5741c, #74451a 55%, #361d09)',
  adopt: 'radial-gradient(120% 90% at 100% 100%, #4fd1a1 0%, transparent 50%), linear-gradient(150deg, #2a9d96, #12534f 55%, #082a28)',
  alumni_fund: 'radial-gradient(120% 90% at 0% 100%, #e39aa2 0%, transparent 45%), linear-gradient(150deg, #8a5aa8, #4d2a66 55%, #24112f)',
  drive: 'radial-gradient(120% 90% at 100% 0%, #a7c4f0 0%, transparent 45%), linear-gradient(150deg, #4f6fb5, #24356b 55%, #101a36)',
}

/** The progress bar fills from 0 to its value when it appears. */
export function ProgressBar({ raised, goal, label, tone = 'primary', size = 'md' }: { raised: number; goal: number; label: string; tone?: 'primary' | 'light' | 'gold'; size?: 'sm' | 'md' | 'lg' }) {
  const [w, setW] = useState(0)
  const target = barWidth(raised, goal)
  useEffect(() => {
    const t = setTimeout(() => setW(target), 60)
    return () => clearTimeout(t)
  }, [target])
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(100, percentOf(raised, goal))}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('overflow-hidden rounded-full', { sm: 'h-2', md: 'h-3', lg: 'h-4' }[size], tone === 'light' ? 'bg-white/20' : 'bg-surface-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)]')}
    >
      <div
        className={cn(
          'relative h-full rounded-full transition-[width] duration-[1100ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none',
          tone === 'primary' ? 'bg-[linear-gradient(90deg,var(--emerald-400),var(--primary))] shadow-[0_0_14px_-2px_var(--primary-glow)]' : 'bg-(image:--grad-gold) shadow-[0_0_14px_-2px_rgb(228_173_69/0.7)]',
        )}
        style={{ width: `${w}%`, minWidth: target > 0 ? '0.75rem' : 0 }}
      >
        <span aria-hidden className="absolute inset-x-1 top-0.5 h-1/3 rounded-full bg-white/30" />
      </div>
    </div>
  )
}

/** A big gradient ring with the percentage in the middle (the label sits below, never squeezed inside). */
export function GoalRing({ raised, goal, size = 132, label, tone = 'brand', children, className }: { raised: number; goal: number; size?: number; label: string; tone?: 'brand' | 'gold' | 'light'; children?: ReactNode; className?: string }) {
  const stroke = Math.round(size / 11)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.min(1, barWidth(raised, goal) / 100)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setShown(pct), 80)
    return () => clearTimeout(t)
  }, [pct])
  const id = useId()
  const stops = tone === 'gold' ? ['#f6d98c', '#d4922a'] : ['#4fd1a1', '#e4ad45']
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.min(100, percentOf(raised, goal))} aria-valuemin={0} aria-valuemax={100} className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 drop-shadow-[0_0_18px_rgb(79_209_161/0.25)]" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={stops[0]} />
            <stop offset="1" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone === 'light' ? 'rgb(255 255 255 / 0.14)' : 'var(--border)'} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(shown, pct > 0 ? 0.012 : 0))}
          className="transition-[stroke-dashoffset] duration-[1400ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  )
}

/** Money that counts up once (reduced motion: shows the final figure). The text always ends as formatPaise(value). */
export function TickerMoney({ paise, className, testId }: { paise: number; className?: string; testId?: string }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(reduced ? paise : 0)
  useEffect(() => {
    if (reduced) {
      setN(paise)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100)
      setN(p < 1 ? Math.round((paise * (1 - Math.pow(1 - p, 4))) / 100) * 100 : paise)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paise, reduced])
  return (
    <span className={cn('tabular-nums', className)} data-testid={testId}>
      {formatPaise(n, { zeroAsFree: false })}
    </span>
  )
}

/** A designed poster for an appeal without a photo: the category's gradient, a large faint icon and a dotted texture. */
export function TypePoster({ type, className }: { type: string; className?: string }) {
  const Icon = (TYPE_ICON[type] ?? TYPE_ICON.project!).icon
  return (
    <div aria-hidden className={cn('relative isolate w-full overflow-hidden text-white', className)} style={{ backgroundImage: POSTER[type] ?? POSTER.project }}>
      <div className="fx-dots-light absolute inset-0 -z-10 opacity-30" />
      <Icon className="absolute -bottom-6 -right-4 size-40 rotate-[-12deg] text-white/[0.13]" strokeWidth={1.2} />
    </div>
  )
}

export function Cover({ c, className = '' }: { c: Pick<CampaignSummary, 'cover_path' | 'title'> & { type?: string }; className?: string }) {
  const src = coverUrl(c.cover_path)
  const [ok, setOk] = useState(true)
  return src && ok ? (
    <img src={src} alt="" loading="lazy" onError={() => setOk(false)} className={`w-full object-cover ${className}`} />
  ) : (
    <TypePoster type={c.type ?? 'project'} className={className} />
  )
}

export function StatusBadge({ c }: { c: Pick<CampaignSummary, 'status' | 'ends_at'> }) {
  const tx = useT()
  if (c.status === 'completed') return <Badge tone="success">{tx('give.completed')}</Badge>
  if (c.status === 'paused') return <Badge tone="warning">{tx('give.paused')}</Badge>
  if (c.status === 'draft') return <Badge>{tx('give.draft')}</Badge>
  if (c.ends_at && new Date(c.ends_at).getTime() <= Date.now()) return <Badge>{tx('give.ended')}</Badge>
  return null
}

export function Money({ paise, className }: { paise: number; className?: string }) {
  return <span className={className ?? 'tabular-nums'}>{formatPaise(paise, { zeroAsFree: false })}</span>
}

export function copyText(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(tr('my.copied', { what })),
    () => toast.error(tr('my.copyFailed')),
  )
}

/** Printable area: on paper only this block is shown. */
export function PrintArea({ children, className = 'p-6' }: { children: ReactNode; className?: string }) {
  return (
    <>
      <style>{'@media print{body *{visibility:hidden}.print-area,.print-area *{visibility:visible}.print-area{position:absolute;left:0;top:0;width:100%;border:0!important;box-shadow:none!important;border-radius:0!important}}'}</style>
      <div className={cn('print-area relative overflow-hidden rounded-[1.75rem] border border-border bg-white text-[#14201a] shadow-e3', className)}>{children}</div>
    </>
  )
}

