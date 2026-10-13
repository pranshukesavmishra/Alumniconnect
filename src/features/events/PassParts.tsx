// The Apple-Wallet-style entry pass, the "you're registered" celebration and the share-card button.
import clsx from 'clsx'
import { CheckCircle2, Clock3, Share2, Smartphone, Sparkles, Sun, WifiOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Confetti } from '../../components/ui/Confetti'
import { TiltCard } from '../../components/ui/Fx'
import { CelebrationArt } from '../../components/ui/Illustrations'
import { useReducedMotion } from '../../components/ui/Motion'
import { QrCode } from '../../components/ui/QrCode'
import { useT } from '../../i18n'
import { haptic } from '../../lib/haptics'
import { renderShareCard, shareOrDownload } from './shareCard'
import './events.css'

export type PassStatus = 'confirmed' | 'under_review' | 'pending_payment' | 'offline'

export interface PassData {
  title: string
  when: string
  venue?: string | null
  code: string
  name: string
  headcount: number
  days?: string | null
  guests?: string[]
  status: PassStatus
  checkedIn?: string | null
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/**
 * Emerald and gold pass with the crest, a holographic foil that follows the tilt (pointer on desktop, the phone's
 * motion on phones; iOS asks permission on tap) and a large QR code on a white panel. Static under reduced motion.
 */
export function EntryPass({ pass, footer }: { pass: PassData; footer?: ReactNode }) {
  const tx = useT()
  const reduced = useReducedMotion()
  const [needsPermission, setNeedsPermission] = useState(false)
  useEffect(() => {
    const C = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as OrientationCtor | undefined
    setNeedsPermission(!reduced && typeof C?.requestPermission === 'function')
  }, [reduced])
  const askMotion = async () => {
    const C = window.DeviceOrientationEvent as OrientationCtor
    try {
      await C.requestPermission?.()
    } catch {
      /* the pass still works without motion */
    }
    setNeedsPermission(false)
  }
  const chip = {
    confirmed: { text: tx('evx.passConfirmed'), cls: 'bg-emerald-300/20 text-emerald-100 ring-emerald-200/40', icon: <CheckCircle2 className="size-3.5" aria-hidden /> },
    offline: { text: tx('evx.passConfirmed'), cls: 'bg-emerald-300/20 text-emerald-100 ring-emerald-200/40', icon: <CheckCircle2 className="size-3.5" aria-hidden /> },
    under_review: { text: tx('evx.passReview'), cls: 'bg-gold-300/20 text-gold-100 ring-gold-200/40', icon: <Clock3 className="size-3.5" aria-hidden /> },
    pending_payment: { text: tx('evx.passAwaiting'), cls: 'bg-gold-300/20 text-gold-100 ring-gold-200/40', icon: <Clock3 className="size-3.5" aria-hidden /> },
  }[pass.status]

  const card = (
    <div
      className="fx-hairline relative isolate overflow-hidden rounded-[2rem] text-white shadow-[0_30px_60px_-24px_rgb(6_42_32/0.7),0_8px_20px_-8px_rgb(0_0_0/0.35)]"
      data-testid="entry-pass"
      data-holo={reduced ? 'static' : 'live'}
    >
      {/* base: deep emerald with a gold dawn in the corner */}
      <div aria-hidden className="absolute inset-0 -z-20 bg-[radial-gradient(120%_70%_at_100%_0%,rgb(228_173_69/0.55),transparent_60%),radial-gradient(90%_60%_at_0%_100%,rgb(31_145_106/0.7),transparent_70%),linear-gradient(160deg,#0f7a57_0%,#084434_45%,#041a14_100%)]" />
      <div aria-hidden className="fx-dots-light absolute inset-0 -z-10 opacity-25" />
      <div className="relative p-5 pb-4 sm:p-6">
        {/* holographic foil: moves with --fx-gx / --fx-gy set by the tilt */}
        {!reduced && (
          <div
            aria-hidden
            data-testid="pass-holo"
            className="pointer-events-none absolute inset-0 z-0 opacity-40 mix-blend-color-dodge"
            style={{
              backgroundImage:
                'linear-gradient(115deg, transparent 20%, rgb(255 236 179 / 0.55) 36%, rgb(160 255 220 / 0.45) 44%, rgb(255 190 240 / 0.35) 52%, rgb(170 210 255 / 0.4) 60%, transparent 76%)',
              backgroundSize: '260% 260%',
              backgroundPosition: 'var(--fx-gx, 50%) var(--fx-gy, 30%)',
              transition: 'background-position 120ms linear',
            }}
          />
        )}
        <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/95 p-1.5 shadow-[inset_0_1px_0_#fff,0_6px_16px_-6px_rgb(0_0_0/0.5)]">
              <img src="/jec-logo.png" alt="" className="size-full object-contain" />
            </span>
            <div className="min-w-0">
              <p className="text-eyebrow text-gold-200">{tx('my.pass')}</p>
              <p className="text-caption text-white/75">{tx('brand.college')}</p>
            </div>
          </div>
          <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1', chip.cls)}>
            {chip.icon}
            {chip.text}
          </span>
        </div>
        <p className="text-h1 mt-5 text-balance text-white">{pass.title}</p>
        <p className="text-body mt-1 text-hero-text">{[pass.when, pass.venue?.split(',')[0]].filter(Boolean).join(' · ')}</p>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
          <PassField label={tx('evx.passHolder')} wide>
            {pass.name}
          </PassField>
          <PassField label={tx('evx.passAdmits')}>{pass.headcount}</PassField>
          <PassField label={tx('evx.passDays')}>{pass.days || tx('evx.allDays')}</PassField>
          {!!pass.guests?.length && (
            <PassField label={tx('evx.passGuests')} wide>
              {pass.guests.join(', ')}
            </PassField>
          )}
        </dl>
        </div>
      </div>

      {/* perforation */}
      <div aria-hidden className="relative h-6">
        <span className="absolute -left-3 top-0 size-6 rounded-full bg-bg" />
        <span className="absolute -right-3 top-0 size-6 rounded-full bg-bg" />
        <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-white/25" />
      </div>

      <div className="relative flex flex-col items-center gap-3 px-5 pb-6 pt-2">
        <div className="rounded-[1.6rem] bg-white p-3 shadow-[0_12px_30px_-12px_rgb(0_0_0/0.6)]">
          <QrCode value={pass.code} size={232} label={tx('my.qrLabel', { code: pass.code })} />
        </div>
        <p className="font-mono text-[1.65rem] font-bold tracking-[0.18em] text-white">{pass.code}</p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/85 ring-1 ring-white/15" data-testid="pass-offline-badge">
          <WifiOff className="size-3.5" aria-hidden /> {tx('evx.passOfflineReady')}
        </p>
        {footer}
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {reduced ? card : <TiltCard className="rounded-[2rem]" max={8} glare={false}>{card}</TiltCard>}
      {needsPermission && (
        <button type="button" onClick={askMotion} className="fx-press mx-auto flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-primary">
          <Sparkles className="size-4" aria-hidden /> {tx('evx.tiltHint')}
        </button>
      )}
    </div>
  )
}

function PassField({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx('min-w-0', wide && 'col-span-2')}>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-200/90">{label}</dt>
      <dd className="text-title mt-0.5 text-white [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Two quiet tips under the pass. */
export function PassTips() {
  const tx = useT()
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <p className="text-caption flex items-center gap-2.5 rounded-2xl bg-surface-2 p-3 text-muted">
        <Sun className="size-5 shrink-0 text-gold-ink" aria-hidden /> {tx('evx.brightness')}
      </p>
      <p className="text-caption flex items-center gap-2.5 rounded-2xl bg-surface-2 p-3 text-muted">
        <Smartphone className="size-5 shrink-0 text-primary" aria-hidden /> {tx('evx.homeHint')}
      </p>
    </div>
  )
}

/** Makes the story card and shares it (or downloads it). */
export function ShareCardButton({ name, batch, url, eventTitle, variant = 'gold', className }: { name: string; batch: number | null; url: string; eventTitle: string; variant?: 'gold' | 'secondary'; className?: string }) {
  const tx = useT()
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    haptic()
    try {
      const blob = await renderShareCard({
        name,
        batch: batch ? tx('evx.shareCardBatch', { year: batch }) : null,
        line: tx('evx.shareCardLine'),
        title: 'JEC Alumni Meet 2026',
        dates: tx('evx.shareCardDates'),
        scan: tx('evx.shareCardScan'),
        footer: tx('evx.shareCardFooter'),
        url,
      })
      const how = await shareOrDownload(blob, 'jec-alumni-meet-2026.png', tx('evx.shareText', { title: eventTitle, url }))
      if (how === 'downloaded') toast.success(tx('evx.shareSaved'))
    } catch {
      toast.error(tx('evx.shareFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant={variant} size="lg" block loading={busy} onClick={go} icon={<Share2 className="size-5" />} className={clsx(variant === 'gold' && 'fx-shine', className)} data-testid="share-card-btn">
      {busy ? tx('evx.sharing') : tx('evx.share')}
    </Button>
  )
}

/** Right after registering: confetti once, the code, what happens next, and the share card. */
export function RegisteredCelebration({ code, steps, share }: { code: string; steps: string[]; share: ReactNode }) {
  const tx = useT()
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setBurst(1), 250)
    haptic([10, 40, 10])
    return () => window.clearTimeout(t)
  }, [])
  return (
    <section className="aurora relative isolate overflow-hidden rounded-[2rem] p-6 text-center text-white shadow-pop" data-testid="registered-celebration">
      <Confetti trigger={burst} />
      <div aria-hidden className="fx-dots-light absolute inset-0 -z-10 opacity-30" />
      <div className="mx-auto w-40 [animation:evx-pop_700ms_var(--ease-spring)_both] motion-reduce:animate-none">
        <CelebrationArt className="h-auto w-full" />
      </div>
      <p className="text-eyebrow mt-2 text-accent">{tx('evx.successEyebrow')}</p>
      <h2 className="text-display mt-2 text-white">{tx('rr.doneTitle')}</h2>
      <p className="text-body-lg mt-1 text-hero-text">{tx('evx.successTitle')}</p>
      <p className="mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm ring-1 ring-white/15">
        {tx('rr.doneCode')} <span className="font-mono text-base font-bold tracking-wider">{code}</span>
      </p>
      <ol className="mx-auto mt-5 max-w-md space-y-2 text-left text-[15px] text-hero-text">
        {steps.map((s) => (
          <li key={s} className="rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
            {s}
          </li>
        ))}
      </ol>
      <div className="mx-auto mt-5 max-w-sm">{share}</div>
    </section>
  )
}

