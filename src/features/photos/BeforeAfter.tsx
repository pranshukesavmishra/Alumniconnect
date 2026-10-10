import { useState } from 'react'
import { useT } from '../../i18n'

/** Then & Now: drag (or use the arrow keys on) the slider to wipe between the old photo and the new one. */
export function BeforeAfter({ before, after, alt, className = '' }: { before: string; after: string; alt: string; className?: string }) {
  const tx = useT()
  const [pos, setPos] = useState(50)
  return (
    <div className={`relative aspect-[4/3] select-none overflow-hidden rounded-2xl bg-surface-2 focus-within:ring-2 focus-within:ring-ring ${className}`} data-testid="before-after">
      <img src={after} alt={alt} className="absolute inset-0 size-full object-cover" draggable={false} />
      <img src={before} alt="" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white">{tx('gallery.then')}</span>
      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white">{tx('gallery.now')}</span>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-black shadow-md">⇆</span>
      </div>
      <input type="range" min={0} max={100} step={1} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={tx('gallery.sliderLabel')} className="absolute inset-0 size-full cursor-ew-resize opacity-0" />
    </div>
  )
}
