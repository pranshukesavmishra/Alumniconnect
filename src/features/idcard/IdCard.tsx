import { useMemo } from 'react'
import { TiltCard } from '../../components/ui/Fx'
import { QrCode } from '../../components/ui/QrCode'
import { useLang, useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { shortBranch } from '../../lib/constants'
import { formatDate } from '../../lib/format'
import { initials } from '../share/canvasText'
import { CARD_ROLE_LABELS, cardRoles } from './card'
import './idcard.css'

/** Banknote-style rosette (the same maths as the canvas renderer). */
function rosette(cx: number, cy: number, radius: number, rings = 14): string[] {
  const out: string[] = []
  for (let k = 0; k < rings; k++) {
    const r = radius * (0.35 + k * 0.05)
    let d = ''
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2
      const rr = r + Math.sin(a * 12 + k * 0.5) * radius * 0.04 + Math.cos(a * 5) * radius * 0.02
      d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`
    }
    out.push(d)
  }
  return out
}
function waves(w: number, h: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const oy = (h / count) * i
    let d = ''
    for (let x = 0; x <= w; x += 8) d += `${x ? 'L' : 'M'}${x} ${(oy + Math.sin(x / (w / 7) + i * 0.45) * (h / count) * 1.6).toFixed(1)}`
    return d
  })
}

function CardPattern({ variant }: { variant: 'front' | 'back' }) {
  const paths = useMemo(() => ({ ros: rosette(850, 180, 330), wav: waves(1012, 260, 16) }), [])
  return (
    <svg viewBox="0 0 1012 638" preserveAspectRatio="none" className="idc-pattern inset-0 size-full" aria-hidden>
      <g fill="none" stroke={variant === 'front' ? 'rgb(244 220 158 / 0.13)' : 'rgb(244 220 158 / 0.09)'} strokeWidth="1">
        {paths.ros.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth="1" transform="translate(0 395)">
        {paths.wav.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}

export interface CardView {
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  membership_no: string | null
  member_since: string | null
  roles: string[]
}

/** The line under the name: "CSE · Class of 2008". */
export function useCardLine() {
  const tx = useT()
  return (c: Pick<CardView, 'branch' | 'grad_year'>) =>
    [shortBranch(c.branch), c.grad_year ? tx('wow.card.classOf', { year: c.grad_year }) : null].filter(Boolean).join(' · ')
}

/**
 * The wallet-style ID card: emerald metal with gold foil, guilloche security lines, a holographic sheen that follows the
 * tilt, and a back with a large QR code. `flipped` turns it over (a cross-fade under reduced motion).
 */
export function IdCard({ card, verifyUrl, flipped, specimen, className }: { card: CardView; verifyUrl: string | null; flipped: boolean; specimen?: boolean; className?: string }) {
  const tx = useT()
  const { lang } = useLang()
  const line = useCardLine()(card)
  const roles = cardRoles(card.roles).map((r) => CARD_ROLE_LABELS[r][lang === 'hi' ? 'hi' : 'en'])
  const since = card.member_since ? formatDate(card.member_since, { month: 'short', year: 'numeric' }) : '—'
  return (
    <TiltCard max={9} className={cn('idc', className)} data-flipped={flipped ? 'true' : 'false'} data-testid="id-card">
      <div className="idc-flipper">
        {/* ------------------------------------------------ front */}
        <div className="idc-face idc-front idc-shine" aria-hidden={flipped}>
          <CardPattern variant="front" />
          <div className="idc-holo" />
          <div className="idc-frame" />
          <div className="absolute inset-0 flex flex-col p-[4.7cqw]">
            <div className="flex items-center gap-[1.8cqw]">
              <img src="/jec-logo.png" alt="" className="h-[8.6cqw] w-auto drop-shadow-[0_0.4cqw_0.8cqw_rgb(0_0_0/0.4)]" />
              <div className="min-w-0 flex-1">
                <p className="idc-cap idc-gold">{tx('wow.card.college')}</p>
                <p className="mt-[0.4cqw] text-[2cqw] font-medium text-white/80">{tx('wow.card.collegeSub')}</p>
              </div>
              <p className="idc-cap idc-gold self-start pt-[0.6cqw]">{tx('wow.card.alumniId')}</p>
            </div>
            <div className="mt-[3.8cqw] flex gap-[3.2cqw]">
              <div className="idc-photo h-[21cqw] w-[17cqw] shrink-0">
                {card.avatar_url ? (
                  <img src={card.avatar_url} alt="" className="size-full rounded-[1.9cqw] object-cover" />
                ) : (
                  <div className="grid size-full place-items-center rounded-[1.9cqw] bg-[linear-gradient(135deg,#1f916a,#062a20)] font-display text-[7cqw] font-semibold text-[#f4dc9e]">
                    {initials(card.full_name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 pt-[0.6cqw]">
                <p className={cn('idc-name line-clamp-2', card.full_name.length > 22 ? 'text-[4.4cqw]' : 'text-[5.4cqw]')}>{card.full_name}</p>
                <p className="mt-[1cqw] text-[2.5cqw] font-medium leading-snug text-white/90">{line}</p>
                {roles.length > 0 && (
                  <div className="mt-[1.4cqw] flex flex-wrap gap-[0.8cqw]">
                    {roles.slice(0, 3).map((r) => (
                      <span key={r} className="idc-chip">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-auto flex items-end justify-between gap-[3cqw]">
              <div className="min-w-0">
                <p className="idc-cap text-[#f4dc9e]/85">{tx('wow.card.membershipNo')}</p>
                <p className="idc-mono mt-[0.5cqw] text-[3.5cqw] font-semibold" data-testid="membership-no">
                  {card.membership_no ?? '—'}
                </p>
                <p className="idc-cap mt-[1.6cqw] text-[#f4dc9e]/85">{tx('wow.card.memberSince')}</p>
                <p className="mt-[0.4cqw] text-[2.4cqw] font-semibold text-white/95">{since}</p>
              </div>
              <div className="idc-qr size-[19.4cqw] shrink-0 drop-shadow-[0_0.8cqw_1.6cqw_rgb(0_0_0/0.45)]">
                {verifyUrl && !specimen ? (
                  <QrCode value={verifyUrl} size={120} label={tx('wow.card.qrLabel')} />
                ) : (
                  <div className="grid size-full place-items-center rounded-[1.6cqw] border border-white/20 bg-white/8 p-[1.5cqw] text-center text-[1.9cqw] font-semibold leading-tight text-white/80">
                    {specimen ? tx('wow.card.specimen') : tx('wow.card.noQr')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* ------------------------------------------------ back */}
        <div className="idc-face idc-back" aria-hidden={!flipped}>
          <CardPattern variant="back" />
          <div className="idc-frame" />
          <div className="absolute inset-0 flex gap-[4cqw] p-[4.7cqw]">
            <div className="idc-qr aspect-square h-full shrink-0">
              {verifyUrl && !specimen ? (
                <QrCode value={verifyUrl} size={260} label={tx('wow.card.qrLabel')} />
              ) : (
                <div className="grid size-full place-items-center rounded-[1.6cqw] border border-white/20 bg-white/8 p-[3cqw] text-center text-[2.6cqw] font-semibold text-white/80">
                  {specimen ? tx('wow.card.specimen') : tx('wow.card.noQr')}
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="idc-cap idc-gold">{tx('wow.card.alumniId')}</p>
              <p className="idc-name mt-[1.2cqw] text-[4.4cqw]">{tx('wow.card.scanToVerify')}</p>
              <p className="mt-[1cqw] text-[2.2cqw] leading-snug text-white/80">{tx('wow.card.scanHint')}</p>
              {verifyUrl && !specimen && <p className="idc-mono mt-[1.4cqw] break-all text-[1.75cqw] leading-snug text-[#f4dc9e]/90">{verifyUrl.replace(/^https?:\/\//, '')}</p>}
              <p className="mt-auto text-[1.7cqw] leading-snug text-white/60">{tx('wow.card.disclaimer')}</p>
            </div>
          </div>
        </div>
      </div>
    </TiltCard>
  )
}
