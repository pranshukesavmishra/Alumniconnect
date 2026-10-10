import { HeartHandshake } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/Display'
import { useT, type MsgKey } from '../../i18n'
import { tr } from '../../i18n/core'
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

/** The progress bar fills from 0 to its value when it appears. */
export function ProgressBar({ raised, goal, label, tone = 'primary' }: { raised: number; goal: number; label: string; tone?: 'primary' | 'light' }) {
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
      className={tone === 'light' ? 'h-3 overflow-hidden rounded-full bg-white/25' : 'h-3 overflow-hidden rounded-full bg-surface-2'}
    >
      <div className={tone === 'light' ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-primary'} style={{ width: `${w}%`, transition: 'width 1.1s cubic-bezier(.2,.8,.2,1)' }} />
    </div>
  )
}

export function Cover({ c, className = '' }: { c: Pick<CampaignSummary, 'cover_path' | 'title'>; className?: string }) {
  const src = coverUrl(c.cover_path)
  return src ? (
    <img src={src} alt="" loading="lazy" className={`w-full object-cover ${className}`} />
  ) : (
    <div aria-hidden className={`grid w-full place-items-center bg-gradient-to-br from-hero to-hero-2 text-white/80 ${className}`}>
      <HeartHandshake className="size-10" />
    </div>
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
export function PrintArea({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{'@media print{body *{visibility:hidden}.print-area,.print-area *{visibility:visible}.print-area{position:absolute;left:0;top:0;width:100%;border:0!important;box-shadow:none!important}}'}</style>
      <div className="print-area rounded-2xl border border-border bg-white p-6 text-black">{children}</div>
    </>
  )
}
