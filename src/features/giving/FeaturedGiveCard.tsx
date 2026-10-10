import { ArrowRight, HeartHandshake } from 'lucide-react'
import { Link } from 'react-router'
import { useT } from '../../i18n'
import { formatPaise } from '../../lib/money'
import { useFeatured } from './api'
import { daysLeft } from './helpers'
import { Money, ProgressBar } from './parts'

/** Home: the featured appeal. Shows nothing when nothing is live. */
export function FeaturedGiveCard() {
  const tx = useT()
  const { data: c } = useFeatured()
  if (!c) return null
  const d = daysLeft(c.ends_at)
  return (
    <Link to={`/give/${c.slug}`} data-testid="home-give-card" className="block rounded-3xl border border-border/80 bg-surface p-4 shadow-card hover:border-primary/40">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><HeartHandshake className="size-4" aria-hidden /> {tx('give.giveBack')}</span>
      <p className="mt-1.5 text-lg font-bold leading-snug">{c.title}</p>
      <div className="mt-3"><ProgressBar raised={c.raised_paise} goal={c.goal_paise} label={tx('give.progress')} /></div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span><b className="tabular-nums"><Money paise={c.raised_paise} /></b> <span className="text-muted">{tx('give.ofGoal', { goal: formatPaise(c.goal_paise, { zeroAsFree: false }) })}</span></span>
        {d !== null && <span className="text-muted">{d === 0 ? tx('give.ended') : tx('give.daysLeft', { count: d })}</span>}
      </div>
      <p className="mt-2 inline-flex min-h-6 items-center gap-1 font-semibold text-primary">{tx('give.giveNow')} <ArrowRight className="size-4" aria-hidden /></p>
    </Link>
  )
}
