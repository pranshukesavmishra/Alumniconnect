import { Tag } from 'lucide-react'
import { clsx } from 'clsx'
import { formatPaise } from '../../lib/money'
import { discountInfo } from './ticketPricing'

/**
 * A ticket's price. With a discount: the original crossed out, the price now, and a "Save X%" badge (plus the offer name).
 * Without one it is just the price. The screen-reader text spells it out ("₹1,500, was ₹2,000, 25% off").
 */
export function PriceTag({
  t,
  tone = 'light',
  size = 'md',
  perPerson,
  className,
}: {
  t: { price_paise: number; list_price_paise?: number | null; discount_label?: string | null }
  tone?: 'light' | 'dark'
  size?: 'sm' | 'md' | 'lg'
  perPerson?: string
  className?: string
}) {
  const d = discountInfo(t)
  const dark = tone === 'dark'
  const now = clsx('text-stat leading-none', size === 'lg' ? 'text-[2rem]' : size === 'md' ? 'text-xl' : 'text-base', dark ? 'text-white' : 'text-text')
  if (!d) {
    return (
      <span className={clsx('inline-flex items-baseline gap-1', className)}>
        <span className={now}>{formatPaise(t.price_paise)}</span>
        {perPerson && t.price_paise > 0 && <span className={clsx('font-sans text-caption font-medium', dark ? 'text-white/70' : 'text-muted')}>{perPerson}</span>}
      </span>
    )
  }
  return (
    <span className={clsx('inline-flex flex-col items-start gap-1', className)} data-testid="price-tag">
      <span className="sr-only">{`${formatPaise(d.pricePaise)}, was ${formatPaise(d.listPaise)}, ${d.percent}% off`}</span>
      <span aria-hidden className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <s className={clsx('text-sm font-medium', dark ? 'text-white/60' : 'text-muted')} data-testid="price-was">{formatPaise(d.listPaise)}</s>
        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', dark ? 'bg-gold-400 text-[#2b1a05]' : 'bg-success-soft text-success')} data-testid="price-percent">
          <Tag className="size-3" aria-hidden /> Save {d.percent}%
        </span>
      </span>
      <span aria-hidden className="inline-flex items-baseline gap-1">
        <span className={now} data-testid="price-now">{formatPaise(d.pricePaise)}</span>
        {perPerson && d.pricePaise > 0 && <span className={clsx('font-sans text-caption font-medium', dark ? 'text-white/70' : 'text-muted')}>{perPerson}</span>}
      </span>
      {t.discount_label && <span aria-hidden className={clsx('text-xs font-semibold', dark ? 'text-gold-300' : 'text-gold-ink')}>{t.discount_label}</span>}
    </span>
  )
}
