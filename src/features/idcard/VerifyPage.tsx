import { Ban, CameraOff, Clock, HelpCircle, Keyboard, ScanLine, ShieldAlert, UserX } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Display'
import { Input } from '../../components/ui/Form'
import { GlowOrbs } from '../../components/ui/Fx'
import { useT, type MsgKey } from '../../i18n'
import { shortBranch } from '../../lib/constants'
import { formatDateTime } from '../../lib/format'
import { haptic } from '../../lib/haptics'
import { useVerifyIdCard, type CardCheckStatus } from './api'
import { tokenFromScan } from './card'

/** The page frame for both verify screens: a slim aurora band with the crest, content on the page background. */
function Frame({ children, title }: { children: ReactNode; title: string }) {
  const tx = useT()
  return (
    <div className="min-h-dvh bg-bg pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <header className="aurora relative overflow-hidden px-4 pb-24 pt-[calc(env(safe-area-inset-top)+1.25rem)] text-white">
        <GlowOrbs />
        <div aria-hidden className="fx-dots fx-dots-light pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex max-w-lg items-center gap-3">
          <Link to="/" className="flex min-h-11 items-center gap-3 rounded-2xl">
            <img src="/jec-logo.png" alt="" className="h-11 w-auto drop-shadow-lg" />
            <span>
              <span className="block text-eyebrow text-accent">{tx('wow.card.college')}</span>
              <span className="block text-caption text-hero-text">{tx('wow.verify.association')}</span>
            </span>
          </Link>
        </div>
        <h1 className="relative mx-auto mt-6 max-w-lg text-h1 text-white">{title}</h1>
      </header>
      <main className="relative mx-auto -mt-16 max-w-lg space-y-4 px-4">{children}</main>
    </div>
  )
}

/** Green rosette seal with a check: the "verified" mark. */
function Seal({ className }: { className?: string }) {
  const pts = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2
    const r = i % 2 ? 44 : 48
    return `${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id="seal-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.45" stopColor="#e4ad45" />
          <stop offset="1" stopColor="#915719" />
        </linearGradient>
        <radialGradient id="seal-face" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#3fae85" />
          <stop offset="0.6" stopColor="#0b6b4f" />
          <stop offset="1" stopColor="#062a20" />
        </radialGradient>
      </defs>
      <polygon points={pts} fill="url(#seal-rim)" />
      <circle cx="50" cy="50" r="38" fill="url(#seal-face)" />
      <circle cx="50" cy="50" r="34.5" fill="none" stroke="#f4dc9e" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="2 2.4" />
      <path d="M34 51.5 45 62 67 39" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="50" cy="32" rx="24" ry="12" fill="#fff" opacity="0.14" />
    </svg>
  )
}

const BAD: Record<Exclude<CardCheckStatus, 'valid'>, { icon: typeof Ban; tone: string; title: MsgKey; body: MsgKey }> = {
  revoked: { icon: Ban, tone: 'bg-danger-soft text-danger', title: 'wow.verify.revokedTitle', body: 'wow.verify.revokedBody' },
  not_found: { icon: HelpCircle, tone: 'bg-warning-soft text-warning', title: 'wow.verify.notFoundTitle', body: 'wow.verify.notFoundBody' },
  inactive: { icon: UserX, tone: 'bg-danger-soft text-danger', title: 'wow.verify.inactiveTitle', body: 'wow.verify.inactiveBody' },
  rate_limited: { icon: Clock, tone: 'bg-info-soft text-info', title: 'wow.verify.rateTitle', body: 'wow.verify.rateBody' },
}

export function VerifyPage() {
  const tx = useT()
  const { token } = useParams()
  const q = useVerifyIdCard(token ?? null)
  const [checkedAt] = useState(() => new Date().toISOString())
  const status = q.data?.status
  useEffect(() => {
    if (status) haptic(status === 'valid' ? 30 : [60, 50, 60])
  }, [status])

  let body: ReactNode
  if (q.isLoading) {
    body = (
      <div className="rounded-[28px] border border-border/70 bg-surface p-6 shadow-pop" aria-busy="true" aria-label={tx('wow.verify.checking')}>
        <Skeleton className="mx-auto size-28 rounded-full" />
        <Skeleton className="mx-auto mt-5 h-8 w-2/3 rounded-xl" />
        <Skeleton className="mx-auto mt-3 h-5 w-1/2 rounded-xl" />
      </div>
    )
  } else if (q.error || !q.data) {
    body = <Result icon={ShieldAlert} tone="bg-danger-soft text-danger" title={tx('wow.verify.errorTitle')} body={tx('wow.verify.errorBody')} />
  } else if (q.data.status === 'valid') {
    const d = q.data
    const memberType = d.member_type === 'alumnus' || d.member_type === 'student' || d.member_type === 'faculty' ? tx(`member.${d.member_type}` as MsgKey) : null
    body = (
      <section
        role="status"
        aria-live="polite"
        data-testid="verify-result"
        data-status="valid"
        className="fx-hairline relative overflow-hidden rounded-[28px] border border-border/70 bg-surface px-6 pb-6 pt-8 text-center shadow-pop"
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--success)_22%,transparent),transparent)]" />
        <div className="relative mx-auto w-fit">
          {d.avatar_url ? (
            <img src={d.avatar_url} alt={tx('wow.verify.photoAlt', { name: d.full_name ?? '' })} className="size-32 rounded-full border-4 border-surface object-cover shadow-e3" data-testid="verify-photo" />
          ) : (
            <Avatar name={d.full_name ?? '?'} size={128} className="border-4 border-surface shadow-e3" />
          )}
          <Seal className="absolute -bottom-2 -right-3 size-14 drop-shadow-lg" />
        </div>
        <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-caption font-bold uppercase tracking-[0.12em] text-success">
          {tx('wow.verify.verified')}
        </p>
        <h2 className="text-display mt-3 break-words">{d.full_name}</h2>
        <p className="mt-2 text-body-lg text-muted">
          {[d.grad_year ? tx('wow.card.classOf', { year: d.grad_year }) : null, shortBranch(d.branch)].filter(Boolean).join(' · ')}
        </p>
        {memberType && <p className="mt-1 text-caption text-muted">{memberType}</p>}
        <div className="mt-6 rounded-2xl bg-surface-2 px-4 py-3 text-caption text-muted">
          {tx('wow.verify.checkedAt', { time: formatDateTime(checkedAt) })}
          <br />
          {tx('wow.verify.liveRegister')}
        </div>
      </section>
    )
  } else {
    const b = BAD[q.data.status]
    body = <Result icon={b.icon} tone={b.tone} title={tx(b.title)} body={tx(b.body)} status={q.data.status} />
  }

  return (
    <Frame title={tx('wow.verify.title')}>
      {body}
      <div className="grid gap-2">
        <ButtonLink to="/verify" variant="primary" size="lg" icon={<ScanLine className="size-5" aria-hidden />} block>
          {tx('wow.verify.scanAnother')}
        </ButtonLink>
        <ButtonLink to="/" variant="ghost" block>
          {tx('wow.verify.aboutApp')}
        </ButtonLink>
      </div>
      <p className="px-2 text-center text-caption text-muted">{tx('wow.verify.privacy')}</p>
    </Frame>
  )
}

function Result({ icon: Icon, tone, title, body, status }: { icon: typeof Ban; tone: string; title: string; body: string; status?: string }) {
  return (
    <section role="status" aria-live="polite" data-testid="verify-result" data-status={status ?? 'error'} className="rounded-[28px] border border-border/70 bg-surface p-6 text-center shadow-pop">
      <span className={`mx-auto grid size-20 place-items-center rounded-full ${tone}`}>
        <Icon className="size-9" aria-hidden />
      </span>
      <h2 className="text-h1 mt-5">{title}</h2>
      <p className="mt-2 text-body-lg text-muted">{body}</p>
    </section>
  )
}

/** Organisers: scan a member's card with the camera (or paste the link) to open the check. */
export function ScanCardPage() {
  const tx = useT()
  const navigate = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let cancelled = false
    let scanner: { stop: () => void; destroy: () => void } | null = null
    void import('qr-scanner')
      .then(async (mod) => {
        const QrScanner = mod.default
        if (cancelled || !video.current) return
        const s = new QrScanner(
          video.current,
          (r) => {
            const t = tokenFromScan(r.data)
            if (t) {
              haptic(30)
              navigate(`/verify/${t}`)
            } else setBad(true)
          },
          { highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 4, preferredCamera: 'environment' },
        )
        scanner = s
        try {
          await s.start()
        } catch {
          if (!cancelled) setCamError(tx('wow.verify.noCamera'))
        }
      })
      .catch(() => !cancelled && setCamError(tx('wow.verify.scannerLoad')))
    return () => {
      cancelled = true
      scanner?.stop()
      scanner?.destroy()
    }
  }, [navigate, tx])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = tokenFromScan(manual)
    if (t) navigate(`/verify/${t}`)
    else setBad(true)
  }

  return (
    <Frame title={tx('wow.verify.scanTitle')}>
      <div className="relative aspect-square overflow-hidden rounded-[28px] bg-black shadow-pop ring-1 ring-white/10">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {!camError && (
          <div aria-hidden className="pointer-events-none absolute inset-[14%] rounded-[24px] border-2 border-white/70 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]" />
        )}
        {camError && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div>
              <CameraOff className="mx-auto mb-3 size-10 opacity-70" aria-hidden />
              <p className="text-body">{camError}</p>
            </div>
          </div>
        )}
      </div>
      <p className="text-center text-body text-muted">{tx('wow.verify.scanHint')}</p>
      {bad && (
        <p role="alert" className="rounded-2xl bg-warning-soft px-4 py-3 text-center text-[15px] font-medium text-warning">
          {tx('wow.verify.notACard')}
        </p>
      )}
      <form onSubmit={submit} className="space-y-2 rounded-[24px] border border-border/70 bg-surface p-4 shadow-card">
        <label htmlFor="verify-manual" className="flex items-center gap-2 text-[15px] font-semibold">
          <Keyboard className="size-4 text-muted" aria-hidden />
          {tx('wow.verify.manualLabel')}
        </label>
        <Input id="verify-manual" value={manual} onChange={(e) => (setManual(e.target.value), setBad(false))} placeholder={tx('wow.verify.manualPh')} autoComplete="off" />
        <Button type="submit" variant="secondary" block disabled={!manual.trim()}>
          {tx('wow.verify.check')}
        </Button>
      </form>
    </Frame>
  )
}
