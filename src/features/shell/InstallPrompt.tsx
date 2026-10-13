import { Download, Plus, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const KEY = 'jec-install-dismissed'
const SNOOZE_DAYS = 30

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  // captured as early as possible: the browser fires it once, often before the shell mounts
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    listeners.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((f) => f())
  })
}

function standalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}
function isIos() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)
}
function snoozed() {
  try {
    const t = Number(localStorage.getItem(KEY) ?? 0)
    return Date.now() - t < SNOOZE_DAYS * 86400_000
  } catch {
    return false
  }
}

/**
 * A quiet "Install the app" card, a few seconds after a signed-in member arrives. Android/desktop use the browser's own
 * install prompt; iPhone gets a short how-to sheet. Not now hides it for 30 days on this device.
 */
export function InstallPrompt({ enabled, delay = 6000 }: { enabled: boolean; delay?: number }) {
  const tx = useT()
  const [can, setCan] = useState<'prompt' | 'ios' | null>(null)
  const [show, setShow] = useState(false)
  const [howTo, setHowTo] = useState(false)

  useEffect(() => {
    const update = () => setCan(standalone() || snoozed() ? null : deferred ? 'prompt' : isIos() ? 'ios' : null)
    update()
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  useEffect(() => {
    if (!enabled || !can) return setShow(false)
    const t = setTimeout(() => setShow(true), delay)
    return () => clearTimeout(t)
  }, [enabled, can, delay])

  function dismiss() {
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
    setShow(false)
    setCan(null)
  }
  async function install() {
    if (can === 'ios') return setHowTo(true)
    if (!deferred) return
    await deferred.prompt()
    const r = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
    deferred = null
    if (r.outcome === 'accepted') setCan(null)
    else dismiss()
    setShow(false)
  }

  return (
    <>
      {show && (
        <div
          role="region"
          aria-label={tx('shell.install.title')}
          data-testid="install-prompt"
          className={cn(
            'fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md animate-[rise-in_420ms_var(--ease-out)]',
            'md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]',
          )}
        >
          <div className="fx-liquid fx-hairline flex items-center gap-3 rounded-[24px] p-3 pr-2">
            <span className="aurora grid size-14 shrink-0 place-items-center rounded-[16px] shadow-e2">
              <img src="/jec-logo.png" alt="" className="relative h-9 w-auto" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold leading-tight">{tx('shell.install.title')}</span>
              <span className="mt-0.5 block text-caption text-muted">{tx('shell.install.body')}</span>
            </span>
            <Button size="sm" onClick={install} icon={<Download className="size-4" aria-hidden />} className="shrink-0">
              {tx('shell.install.cta')}
            </Button>
            <button type="button" onClick={dismiss} aria-label={tx('shell.install.later')} className="fx-press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2">
              <X className="size-[18px]" aria-hidden />
            </button>
          </div>
        </div>
      )}
      <Sheet open={howTo} onClose={() => setHowTo(false)} label={tx('shell.install.iosTitle')}>
        <div className="px-5 pb-4 pt-6">
          <p className="text-eyebrow text-gold-ink">{tx('shell.install.eyebrow')}</p>
          <h2 className="mt-1 text-h1">{tx('shell.install.iosTitle')}</h2>
          <ol className="mt-5 space-y-3">
            {[
              { icon: Share, text: tx('shell.install.ios1') },
              { icon: SquarePlus, text: tx('shell.install.ios2') },
              { icon: Plus, text: tx('shell.install.ios3') },
            ].map((s, i) => (
              <li key={i} className="flex items-center gap-3.5 rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-e1">
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="text-[15px]">
                  <span className="mr-1.5 font-display font-semibold text-gold-ink">{i + 1}.</span>
                  {s.text}
                </span>
              </li>
            ))}
          </ol>
          <Button block size="lg" className="mt-5" onClick={() => (setHowTo(false), dismiss())}>
            {tx('shell.install.done')}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
