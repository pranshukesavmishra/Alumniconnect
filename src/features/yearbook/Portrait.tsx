import { useState } from 'react'
import { avatarGradient, initialsOf } from '../../components/ui/Avatar'
import { cn } from '../../lib/cn'

/**
 * A portrait-shaped photo; when there is no photo (or it fails to load) a designed poster with the person's initials in
 * the serif on their brand gradient, with a fine engraved ring, so a grid never shows an empty grey box.
 */
export function Portrait({ src, name, className, imgClassName }: { src: string | null | undefined; name: string; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false)
  const show = src && !failed
  return (
    <div className={cn('relative overflow-hidden [container-type:inline-size]', className)} style={show ? undefined : { backgroundImage: avatarGradient(name) }}>
      {show ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn('size-full object-cover', imgClassName)} />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 100 100" aria-hidden className="absolute size-[86%] opacity-20">
            {[46, 40, 34].map((r) => (
              <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#fff" strokeWidth="0.6" strokeDasharray={r === 46 ? '1 2' : undefined} />
            ))}
          </svg>
          <span className="font-display text-[clamp(1.5rem,32cqw,3.5rem)] font-semibold text-white/95 drop-shadow-[0_2px_6px_rgb(0_0_0/0.3)]">{initialsOf(name)}</span>
        </div>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_30%_0%,rgb(255_255_255/0.22),transparent_55%)]" />
    </div>
  )
}
