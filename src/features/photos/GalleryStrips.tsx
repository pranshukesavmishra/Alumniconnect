import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { SectionTitle } from '../../components/ui/Display'
import { useLang, useT } from '../../i18n'
import { galleryTitle, galleryUrl, useFeaturedGallery, useOnThisDay, type GalleryPhoto } from './api'

function Strip({ label, photos, yearBadge }: { label: string; photos: GalleryPhoto[]; yearBadge?: boolean }) {
  const { lang } = useLang()
  return (
    <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1" aria-label={label}>
      {photos.map((p) => (
        <li key={p.id} className="shrink-0">
          <Link to={`/gallery?photo=${p.id}`} className="relative block size-36 overflow-hidden rounded-2xl bg-surface-2">
            <img src={galleryUrl(p.thumb_path)} alt={p.alt_text ?? galleryTitle(p, lang) ?? ''} loading="lazy" className="size-full object-cover" />
            {yearBadge && p.taken_on && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white">{p.taken_on.slice(0, 4)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Home: the gallery's featured photos, and "On this day" when the gallery has photos taken on today's date in earlier years. */
export function GalleryStrips({ verified }: { verified: boolean }) {
  const tx = useT()
  const featured = useFeaturedGallery(verified)
  const today = useOnThisDay(verified)
  if (!verified) return null
  return (
    <>
      {!!today.data?.length && (
        <section aria-label={tx('gallery.onThisDay')} className="space-y-2">
          <SectionTitle>{tx('gallery.onThisDay')}</SectionTitle>
          <Strip label={tx('gallery.onThisDay')} photos={today.data} yearBadge />
        </section>
      )}
      {!!featured.data?.length && (
        <section aria-label={tx('gallery.featured')} className="space-y-2">
          <SectionTitle action={<Link to="/gallery" className="inline-flex min-h-11 items-center gap-0.5 text-sm font-semibold text-primary">{tx('gallery.seeAll')}<ChevronRight className="size-4" aria-hidden /></Link>}>{tx('gallery.title')}</SectionTitle>
          <Strip label={tx('gallery.featured')} photos={featured.data} />
        </section>
      )}
    </>
  )
}
