import { ArrowRight, Globe2, MapPin } from 'lucide-react'
import { useMemo } from 'react'
import { ButtonLink } from '../../components/ui/Button'
import { Marquee } from '../../components/ui/Fx'
import { NumberTicker, Reveal } from '../../components/ui/Motion'
import { useT } from '../../i18n'
import { countLabel, worldTotals, type PublicWorldPlace } from '../world/geo'
import { Globe } from '../world/Globe'
import { usePublicAlumniWorld } from '../world/api'
import { placeName, toGlobePoints } from '../world/places'

/** "JECians across the world": the public globe (places with 3+ alumni, counts rounded down). Lazy-loaded. */
export function LandingWorld() {
  const tx = useT()
  const { data, isLoading } = usePublicAlumniWorld()
  const places = useMemo(() => data ?? [], [data])
  const points = useMemo(() => toGlobePoints(places, (n, place) => tx('world.inPlace', { n, place })), [places, tx])
  const totals = worldTotals(places)
  const top = places.slice(0, 8)
  return (
    <section aria-labelledby="world-title" className="relative isolate overflow-hidden bg-[#041a14] pb-16 pt-6 text-white sm:pb-24" data-theme="dark">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[70%] bg-[radial-gradient(50%_60%_at_70%_40%,rgb(31_145_106/0.30),transparent_70%)]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
        <Reveal className="lg:order-1">
          <p className="text-eyebrow text-accent">{tx('landing.worldEyebrow')}</p>
          <h2 id="world-title" className="text-display mt-3 text-white">{tx('landing.worldTitle')}</h2>
          <p className="text-body-lg mt-4 max-w-md text-white/75">{tx('landing.worldBody')}</p>
          {places.length > 0 && (
            <dl className="mt-6 flex gap-8">
              <div>
                <dt className="text-[13px] text-white/60">{tx('world.cities')}</dt>
                <dd className="text-stat text-[34px] leading-none">
                  <NumberTicker value={totals.cities} />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-white/60">{tx('world.countries')}</dt>
                <dd className="text-stat text-[34px] leading-none">
                  <NumberTicker value={totals.countries} />
                </dd>
              </div>
            </dl>
          )}
          {top.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label={tx('landing.worldTop')} data-testid="landing-world-list">
              {top.map((p) => (
                <li key={`${p.city}-${p.country_code}`} className="fx-liquid-dark inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium">
                  <MapPin className="size-3.5 text-accent" aria-hidden />
                  {tx('world.inPlace', { n: countLabel(p), place: placeName(p) })}
                </li>
              ))}
            </ul>
          )}
          <ButtonLink to="/signin?next=%2Fworld" variant="glass" className="mt-7">
            {tx('landing.worldCta')} <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Reveal>
        <div className="relative mx-auto w-full max-w-[560px] lg:order-2">
          {isLoading ? (
            <div aria-hidden className="mx-auto aspect-square w-full animate-pulse rounded-full bg-[radial-gradient(circle,rgb(31_145_106/0.25),transparent_65%)]" />
          ) : (
            <Globe points={points} labels={5} ariaLabel={tx('world.globeAria')} fallback={<FallbackList places={places} />} />
          )}
          <p className="mt-1 text-center text-xs text-white/50">{tx('landing.worldHint')}</p>
        </div>
      </div>
      {places.length > 2 && (
        <Marquee className="relative mt-10" label={tx('landing.worldTop')} duration={46}>
          {places.slice(0, 24).map((p) => (
            <span key={`${p.city}-${p.country_code}-m`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80">
              <Globe2 className="size-4 text-emerald-300" aria-hidden />
              <span className="font-semibold text-white">{placeName(p)}</span>
              <span className="text-white/55">{p.country}</span>
            </span>
          ))}
        </Marquee>
      )}
    </section>
  )
}

/** No WebGL: the same places as a ranked list with bars. */
function FallbackList({ places }: { places: readonly PublicWorldPlace[] }) {
  const tx = useT()
  const max = places[0]?.alumni_at_least ?? 1
  return (
    <ol className="space-y-2" data-testid="world-fallback">
      {places.slice(0, 10).map((p) => (
        <li key={`${p.city}-${p.country_code}`} className="fx-liquid-dark rounded-2xl px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{placeName(p)}</span>
            <span className="text-sm text-white/70">{tx('world.inPlace', { n: countLabel(p), place: p.country })}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-(image:--grad-gold)" style={{ width: `${Math.max(6, (p.alumni_at_least / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
