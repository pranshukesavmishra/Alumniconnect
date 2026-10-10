import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { useLang, useT } from '../../i18n'
import { meetTitle, sortMeets, usePastMeets } from './api'

/** Home: a way into the archive of earlier alumni meets (newest few by year). Hidden until a meet is published. */
export function PastMeetsStrip() {
  const tx = useT()
  const { lang } = useLang()
  const { data } = usePastMeets()
  const meets = sortMeets((data ?? []).filter((m) => m.is_published)).slice(0, 3)
  if (!meets.length) return null
  return (
    <section aria-label={tx('meets.title')} className="rounded-2xl border border-border bg-surface p-4" data-testid="home-past-meets">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-semibold"><Archive className="size-5 text-primary" aria-hidden />{tx('meets.title')}</h2>
        <Link to="/meets" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">{tx('home.seeAll')}</Link>
      </div>
      <ul className="mt-1 flex flex-wrap gap-2">
        {meets.map((m) => (
          <li key={m.id}>
            <Link to={`/meets/${m.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold hover:border-primary/50">{meetTitle(m, lang)}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
