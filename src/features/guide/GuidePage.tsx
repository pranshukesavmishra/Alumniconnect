// "How to use": the one-minute video (native player, static files from /guide, captions as a WebVTT track), a tappable chapter list that
// seeks the video, the same eight steps in writing, and a Need-help line. Open to everyone, signed in or not.
import clsx from 'clsx'
import { CirclePlus, Images, LogIn, Play, QrCode, Search, Smartphone, Ticket, UserRound, type LucideIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Card, SectionTitle } from '../../components/ui/Display'
import { IconTile, type TileTone } from '../../components/ui/IconTile'
import { useLang, useT, type MsgKey } from '../../i18n'
import { useAuth } from '../auth/AuthProvider'
import { CHAPTERS, chapterAt, guideAssets, guideLangFor, seekTime, type GuideLang } from './chapters'

const STEPS: { icon: LucideIcon; tone: TileTone }[] = [
  { icon: LogIn, tone: 'emerald' },
  { icon: UserRound, tone: 'teal' },
  { icon: Ticket, tone: 'gold' },
  { icon: QrCode, tone: 'ink' },
  { icon: Search, tone: 'plum' },
  { icon: Images, tone: 'maroon' },
  { icon: CirclePlus, tone: 'gold' },
  { icon: Smartphone, tone: 'emerald' },
]
const key = (n: number, part: 't' | 'b') => `guide.s${n}.${part}` as MsgKey
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function GuidePage() {
  const tx = useT()
  const { lang: appLang } = useLang()
  const { session } = useAuth()
  const [picked, setPicked] = useState<GuideLang | null>(null)
  const lang = picked ?? guideLangFor(appLang)
  const [active, setActive] = useState<number | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const resume = useRef<{ time: number; play: boolean } | null>(null)
  const chapters = CHAPTERS[lang]
  const assets = guideAssets(lang)

  const pick = (l: GuideLang) => {
    if (l === lang) return
    const v = video.current
    resume.current = v ? { time: v.currentTime, play: !v.paused } : null
    setPicked(l)
  }
  // after the other language's file has its metadata, carry on from the same moment
  const onLoaded = useCallback(() => {
    const v = video.current
    const r = resume.current
    if (!v || !r) return
    resume.current = null
    try {
      v.currentTime = Math.min(r.time, Math.max(0, (v.duration || r.time) - 0.1))
      if (r.play) void v.play().catch(() => undefined)
    } catch {
      /* the browser may refuse a seek this early; the video simply starts from the top */
    }
  }, [])

  const go = (step: number) => {
    const v = video.current
    if (!v) return
    try {
      v.currentTime = seekTime(chapters, step)
      void v.play().catch(() => undefined)
      v.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <PageHeader title={tx('guide.title')} back="/" />
      <Page className="space-y-6">
        <p className="text-muted">{tx('guide.intro')}</p>

        <div className="flex flex-wrap items-center gap-3">
          <span id="guide-lang" className="text-sm font-semibold">{tx('guide.language')}</span>
          <div role="group" aria-labelledby="guide-lang" className="inline-flex rounded-full border border-border bg-surface p-1">
            {(['en', 'hi'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                lang={l}
                onClick={() => pick(l)}
                className={clsx(
                  'min-h-11 min-w-24 rounded-full px-4 text-[15px] font-semibold transition-colors motion-reduce:transition-none',
                  lang === l ? 'bg-primary text-white' : 'text-muted hover:text-text',
                )}
              >
                {tx(l === 'en' ? 'guide.langEn' : 'guide.langHi')}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl bg-black shadow-lg">
          <video
            key={lang}
            ref={video}
            controls
            playsInline
            preload="metadata"
            poster={assets.poster}
            aria-label={tx('guide.videoLabel')}
            data-testid="guide-video"
            className="block aspect-[9/16] w-full bg-black"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={(e) => setActive(chapterAt(chapters, e.currentTarget.currentTime)?.step ?? null)}
          >
            <source src={assets.video} type="video/mp4" />
            <track kind="captions" srcLang={lang} label={tx(lang === 'en' ? 'guide.langEn' : 'guide.langHi')} src={assets.captions} default />
            {tx('guide.noVideo')}
          </video>
        </div>

        <section aria-labelledby="guide-chapters" className="space-y-3">
          <SectionTitle><span id="guide-chapters">{tx('guide.chaptersTitle')}</span></SectionTitle>
          <ol className="grid gap-2" data-testid="guide-chapters">
            {chapters.map((c) => (
              <li key={c.step}>
                <button
                  type="button"
                  onClick={() => go(c.step)}
                  aria-label={tx('guide.chapterGo', { n: c.step, title: tx(key(c.step, 't')) })}
                  aria-current={active === c.step ? 'true' : undefined}
                  className={clsx(
                    'flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors motion-reduce:transition-none',
                    active === c.step ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-white" aria-hidden>{c.step}</span>
                  <span className="min-w-0 flex-1 font-semibold">{tx(key(c.step, 't'))}</span>
                  <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted" aria-hidden>
                    <Play className="size-4" />
                    {clock(c.start)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="guide-steps" className="space-y-3">
          <SectionTitle><span id="guide-steps">{tx('guide.stepsTitle')}</span></SectionTitle>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={i}>
                <Card className="flex items-start gap-4 p-4">
                  <IconTile icon={s.icon} tone={s.tone} size="lg" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">{tx('guide.stepN', { n: i + 1 })}</p>
                    <h2 className="text-lg font-bold leading-snug">{tx(key(i + 1, 't'))}</h2>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{tx(key(i + 1, 'b'))}</p>
                    {i === 7 && <a className="mt-1 inline-flex min-h-11 items-center text-primary underline" href="/install">{tx('guide.installLink')}</a>}
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <Card className="space-y-3 p-4" data-testid="guide-help">
          <h2 className="text-lg font-bold">{tx('guide.helpTitle')}</h2>
          <p className="text-muted">{tx('guide.helpBody')}</p>
          <div className="flex flex-wrap gap-3">
            {session && <ButtonLink to="/help">{tx('guide.helpAsk')}</ButtonLink>}
            <ButtonLink to="/about" variant="secondary">{tx('guide.helpAbout')}</ButtonLink>
          </div>
        </Card>
      </Page>
    </div>
  )
}
