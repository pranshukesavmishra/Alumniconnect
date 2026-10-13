/*
 * Original spot illustrations in brand colours (each well under 4 KB). They read theme tokens, so they adapt to
 * light and dark automatically. Decorative: always aria-hidden. Use inside <EmptyState illustration={<NoResultsArt />} />.
 * ViewBox 200×160 (spot) or 400×120 (CampusArchArt, a wide line-art band for heroes; colour = currentColor).
 */
type P = { className?: string }

const Backdrop = () => (
  <>
    <ellipse cx="100" cy="146" rx="62" ry="6" fill="var(--text)" opacity=".07" />
    <circle cx="100" cy="78" r="62" fill="var(--primary-soft)" />
    <circle cx="38" cy="34" r="3" fill="var(--accent)" />
    <circle cx="168" cy="52" r="4" fill="var(--accent)" opacity=".7" />
    <path d="M160 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--accent)" />
  </>
)

export function EmptyInboxArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect x="44" y="40" width="88" height="56" rx="18" fill="var(--primary)" />
      <path d="M62 96l-6 16 22-16z" fill="var(--primary)" />
      <circle cx="72" cy="68" r="5" fill="var(--on-primary)" />
      <circle cx="88" cy="68" r="5" fill="var(--on-primary)" opacity=".75" />
      <circle cx="104" cy="68" r="5" fill="var(--on-primary)" opacity=".5" />
      <rect x="96" y="80" width="68" height="44" rx="15" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3" />
      <path d="M146 124l6 12-18-12z" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
      <rect x="110" y="94" width="40" height="5" rx="2.5" fill="var(--accent)" opacity=".7" />
      <rect x="110" y="105" width="26" height="5" rx="2.5" fill="var(--accent)" opacity=".4" />
    </svg>
  )
}

export function NoResultsArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect x="48" y="34" width="84" height="100" rx="14" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <circle cx="68" cy="56" r="8" fill="var(--primary-soft)" stroke="var(--primary)" strokeWidth="2" />
      <rect x="82" y="51" width="38" height="5" rx="2.5" fill="var(--border-strong)" />
      <rect x="82" y="60" width="24" height="4" rx="2" fill="var(--border)" />
      <rect x="60" y="78" width="60" height="5" rx="2.5" fill="var(--border)" />
      <rect x="60" y="90" width="48" height="5" rx="2.5" fill="var(--border)" />
      <rect x="60" y="102" width="54" height="5" rx="2.5" fill="var(--border)" />
      <circle cx="128" cy="96" r="24" fill="var(--surface)" fillOpacity=".55" stroke="var(--primary)" strokeWidth="7" />
      <path d="M145 113l18 18" stroke="var(--primary)" strokeWidth="9" strokeLinecap="round" />
      <path d="M120 88q8-6 16 0" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function NoEventsArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect x="50" y="40" width="100" height="92" rx="16" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M50 56a16 16 0 0 1 16-16h68a16 16 0 0 1 16 16v10H50z" fill="var(--primary)" />
      <rect x="70" y="30" width="7" height="20" rx="3.5" fill="var(--text)" opacity=".75" />
      <rect x="123" y="30" width="7" height="20" rx="3.5" fill="var(--text)" opacity=".75" />
      <g fill="var(--border)">
        <rect x="64" y="78" width="14" height="12" rx="3" /><rect x="86" y="78" width="14" height="12" rx="3" /><rect x="122" y="78" width="14" height="12" rx="3" />
        <rect x="64" y="98" width="14" height="12" rx="3" /><rect x="86" y="98" width="14" height="12" rx="3" /><rect x="108" y="98" width="14" height="12" rx="3" />
      </g>
      <rect x="106" y="76" width="18" height="16" rx="4" fill="var(--accent)" />
      <path d="M150 104l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill="var(--accent)" stroke="var(--surface)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

export function NoPhotosArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect x="58" y="44" width="92" height="74" rx="12" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" transform="rotate(8 104 81)" />
      <rect x="46" y="40" width="96" height="78" rx="12" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <rect x="54" y="48" width="80" height="54" rx="7" fill="var(--primary-soft)" />
      <circle cx="116" cy="62" r="7" fill="var(--accent)" />
      <path d="M54 95l24-26 16 16 12-10 28 22v0a7 7 0 0 1-7 5H61a7 7 0 0 1-7-7z" fill="var(--primary)" />
      <circle cx="146" cy="116" r="16" fill="var(--primary)" />
      <path d="M146 109v14M139 116h14" stroke="var(--on-primary)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export function OfflineArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <Backdrop />
      <path d="M62 112a24 24 0 0 1 2-48 32 32 0 0 1 62-6 26 26 0 0 1 12 54z" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M78 86a32 32 0 0 1 44 0M88 96a17 17 0 0 1 24 0" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="106" r="5" fill="var(--primary)" />
      <path d="M70 66l60 52" stroke="var(--official)" strokeWidth="6" strokeLinecap="round" />
      <path d="M70 66l60 52" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" transform="translate(3 -3)" />
    </svg>
  )
}

export function CelebrationArt({ className }: P) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden fill="none">
      <ellipse cx="100" cy="146" rx="50" ry="5" fill="var(--text)" opacity=".07" />
      <circle cx="100" cy="80" r="62" fill="var(--accent-soft)" />
      <g strokeLinecap="round" strokeWidth="4">
        <path d="M100 10v12M150 28l-8 9M50 28l8 9M172 80h-12M28 80h12M160 130l-8-8M40 130l8-8" stroke="var(--accent)" />
      </g>
      <g>
        <rect x="34" y="52" width="9" height="5" rx="1.5" fill="var(--primary)" transform="rotate(-30 38 54)" />
        <rect x="160" y="100" width="9" height="5" rx="1.5" fill="var(--official)" transform="rotate(25 164 102)" />
        <rect x="150" y="48" width="8" height="4" rx="1.5" fill="var(--primary)" transform="rotate(40 154 50)" />
        <circle cx="50" cy="110" r="4" fill="var(--official)" />
        <circle cx="138" cy="20" r="3.5" fill="var(--primary)" />
        <circle cx="64" cy="22" r="3" fill="var(--official)" />
      </g>
      <path d="M100 38l9 6 11-1 4 10 9 6-3 11 3 11-9 6-4 10-11-1-9 6-9-6-11 1-4-10-9-6 3-11-3-11 9-6 4-10 11 1z" fill="var(--primary)" />
      <circle cx="100" cy="80" r="27" fill="none" stroke="var(--on-primary)" strokeOpacity=".35" strokeWidth="2" />
      <path d="M87 80l9 9 18-19" stroke="var(--on-primary)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M82 118l-8 26 13-6 7 11 6-24M118 118l8 26-13-6-7 11-6-24" fill="var(--accent)" />
    </svg>
  )
}

/** Wide line-art of a heritage campus facade (arches, colonnade, central dome). Inherits currentColor; place low-opacity in heroes. */
export function CampusArchArt({ className }: P) {
  const arches = [40, 80, 120, 160, 240, 280, 320, 360]
  return (
    <svg viewBox="0 0 400 120" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 119h400" />
      <path d="M20 119V64h360v55M14 64h372M20 58h360v6" />
      {arches.map((x) => (
        <path key={x} d={`M${x - 13} 119V88a13 13 0 0 1 26 0v31`} />
      ))}
      <path d="M170 119V40h60v79M164 40h72M176 34h48v6" />
      <path d="M186 119V82a14 14 0 0 1 28 0v37" />
      <path d="M180 34c0-20 40-20 40 0M200 6v8M196 10h8M190 20c6-4 14-4 20 0" />
      <path d="M182 54h36M182 62h36" strokeOpacity=".6" />
      <path d="M60 64V50h20v14M320 64V50h20v14M56 50h28M316 50h28" />
      <path d="M8 119v-30M392 119v-30M2 96c4-10 8-10 12 0M386 96c4-10 8-10 12 0" strokeOpacity=".7" />
    </svg>
  )
}
