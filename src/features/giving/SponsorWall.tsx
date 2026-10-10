import { useT } from '../../i18n'
import { publicUrl } from '../../lib/supabase'
import { useSponsorWall, type WallTier } from './api'
import { safeWebsite } from './helpers'

function Logo({ s, h }: { s: WallTier['sponsors'][number]; h: string }) {
  const src = publicUrl('giving', s.logo_path)
  const web = safeWebsite(s.website)
  const inner = src ? (
    <img src={src} alt={s.name} loading="lazy" className={`${h} w-auto max-w-[9rem] object-contain`} />
  ) : (
    <span className="px-2 text-sm font-semibold">{s.name}</span>
  )
  const box = 'grid min-h-12 place-items-center rounded-xl border border-border bg-white px-3 py-2 text-black'
  // no tracking, no redirects: a plain link to the sponsor's own address
  return web ? (
    <a href={web} target="_blank" rel="noopener noreferrer" className={box} data-testid="sponsor-logo" aria-label={s.name}>{inner}</a>
  ) : (
    <span className={box} data-testid="sponsor-logo">{inner}</span>
  )
}

/** "Sponsored by" strip, grouped by tier. Renders nothing when there are no sponsors. */
export function SponsorStrip({ event, campaign }: { event?: string; campaign?: string }) {
  const tx = useT()
  const { data } = useSponsorWall({ event, campaign })
  if (!data?.length) return null
  return (
    <section aria-label={tx('give.sponsoredBy')} data-testid="sponsor-wall" className="space-y-3 rounded-3xl border border-border/80 bg-surface p-4 shadow-card">
      <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{tx('give.sponsoredBy')}</p>
      {data.map((t, i) => (
        <div key={t.tier}>
          <p className="mb-1.5 text-sm font-semibold text-muted">{t.tier}</p>
          <div className="flex flex-wrap gap-2">{t.sponsors.map((s) => <Logo key={s.id} s={s} h={i === 0 ? 'h-14' : i === 1 ? 'h-11' : 'h-9'} />)}</div>
        </div>
      ))}
    </section>
  )
}

/** Small row of logos for a corner of the live photo slideshow. */
export function SponsorCorner({ event }: { event: string | undefined }) {
  const { data } = useSponsorWall({ event })
  const all = (data ?? []).flatMap((t) => t.sponsors).filter((s) => s.logo_path).slice(0, 6)
  if (!all.length) return null
  return (
    <div data-testid="slideshow-sponsors" className="pointer-events-none absolute bottom-28 left-4 flex max-w-[60%] flex-wrap items-center gap-2 rounded-2xl bg-white/90 p-2 shadow-lg">
      {all.map((s) => (
        <img key={s.id} src={publicUrl('giving', s.logo_path) ?? ''} alt={s.name} className="h-8 w-auto max-w-[6rem] object-contain" />
      ))}
    </div>
  )
}
