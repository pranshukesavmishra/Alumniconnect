import clsx from 'clsx'
import { CameraOff, CheckCircle2, Keyboard, TriangleAlert, Undo2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Form'
import { PageSkeleton } from '../../components/ui/Display'
import './../events/events.css'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Registration } from '../../lib/types'
import { ArrivalsCounter, GateSearch } from './CheckInTools'
import { useAdminEvent, useEventCaps } from './queries'

type Result =
  | { kind: 'ok'; reg: Registration }
  | { kind: 'again'; reg: Registration }
  | { kind: 'unpaid'; reg: Registration }
  | { kind: 'error'; message: string }

export function CheckInPage() {
  const { slug = '' } = useParams()
  const { data, isLoading } = useAdminEvent(slug)
  const role = useEventCaps(data?.event.id)
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<{ stop: () => void; destroy: () => void } | null>(null)
  const last = useRef<{ code: string; at: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [flashKey, setFlashKey] = useState(0)
  const qc = useQueryClient()

  const eventId = data?.event.id
  const check = useCallback(
    async (raw: string, undo = false) => {
      const code = raw.trim().toUpperCase().replace(/^.*(JEC-[2-9A-HJ-NP-Z]{6}).*$/, '$1')
      if (!eventId || !code) return
      const now = Date.now()
      if (!undo && last.current && last.current.code === code && now - last.current.at < 4000) return // same QR still in view
      last.current = { code, at: now }
      setBusy(true)
      const { data: rows, error } = await supabase.rpc('check_in', { p_event: eventId, p_code: code, p_undo: undo })
      setBusy(false)
      void qc.invalidateQueries({ queryKey: ['event-arrivals', eventId] })
      if (error) {
        setResult({ kind: 'error', message: friendlyError(error) })
        setFlashKey((k) => k + 1)
        navigator.vibrate?.([80, 60, 80])
        return
      }
      const row = (rows as { registration: Registration; already_checked_in: boolean }[])[0]!
      const reg = row.registration
      if (undo) return setResult(null)
      if (reg.status !== 'confirmed') setResult({ kind: 'unpaid', reg })
      else if (row.already_checked_in) setResult({ kind: 'again', reg })
      else {
        setResult({ kind: 'ok', reg })
        setCount((c) => c + reg.headcount)
      }
      setFlashKey((k) => k + 1)
      navigator.vibrate?.(reg.status === 'confirmed' && !row.already_checked_in ? 60 : [80, 60, 80])
    },
    [eventId, qc],
  )

  useEffect(() => {
    if (!eventId || !video.current) return
    let cancelled = false
    void import('qr-scanner')
      .catch(() => {
        setCamError('The scanner couldn’t load (weak network?). Type the code below, or reload when the signal is better.')
        return null
      })
      .then(async (mod) => {
      if (!mod) return
      const QrScanner = mod.default
      if (cancelled || !video.current) return
      const s = new QrScanner(video.current, (r) => void check(r.data), { highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 5, preferredCamera: 'environment' })
      scanner.current = s
      try {
        await s.start()
      } catch {
        setCamError('Camera not available. Allow camera access in your browser settings, or type the code below.')
      }
    })
    return () => {
      cancelled = true
      scanner.current?.stop()
      scanner.current?.destroy()
    }
  }, [eventId, check])

  if (isLoading) return <PageSkeleton />
  if (!data || !role) return <Navigate to="/admin" replace />

  function submitManual(e: FormEvent) {
    e.preventDefault()
    const code = manual.trim().toUpperCase()
    void check(code.startsWith('JEC-') ? code : `JEC-${code}`)
    setManual('')
  }

  const tone = result?.kind === 'ok' ? 'bg-success text-white' : result?.kind === 'again' ? 'bg-accent text-[#1d2433]' : result ? 'bg-danger text-white' : ''
  return (
    <div className="min-h-dvh">
      <PageHeader title="Check-in" subtitle={`${data.event.title} · ${count} people this session`} back={`/admin/events/${slug}`} />
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden bg-black text-white sm:mt-4 sm:rounded-3xl">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {/* scan frame with corner brackets and a sweeping line */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative size-[68%] [--evx-frame:220px]">
            {['left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl'].map((c) => (
              <span key={c} className={clsx('absolute size-10 border-white/90', c)} />
            ))}
            {!camError && <span className="absolute inset-x-3 top-1 h-0.5 rounded-full bg-accent shadow-[0_0_14px_var(--accent)] [animation:evx-scanline_2.4s_ease-in-out_infinite] motion-reduce:hidden" />}
          </div>
        </div>
        {/* colour flash on every result: green welcome, amber duplicate, red help desk */}
        {result && (
          <div
            key={flashKey}
            aria-hidden
            className={clsx('pointer-events-none absolute inset-0 [animation:evx-flash_900ms_ease-out_forwards] motion-reduce:hidden', result.kind === 'ok' ? 'bg-success' : result.kind === 'again' ? 'bg-accent' : 'bg-danger')}
          />
        )}
        {!result && !camError && <p className="absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white/85 drop-shadow">Hold the QR code inside the frame</p>}
        {camError && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <CameraOff className="mx-auto mb-2 size-10 opacity-70" aria-hidden />
              <p>{camError}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-md space-y-4 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {result && (
          <div role="status" aria-live="assertive" className={clsx('rounded-[1.75rem] p-5 shadow-pop [animation:pop-in_260ms_var(--ease-out)] motion-reduce:animate-none', tone)}>
            {result.kind === 'error' ? (
              <p className="flex items-center gap-2 text-lg font-bold">
                <XCircle className="size-6" aria-hidden /> {result.message}
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                  {result.kind === 'ok' && <><CheckCircle2 className="size-5" aria-hidden /> Welcome! Checked in</>}
                  {result.kind === 'again' && <><TriangleAlert className="size-5" aria-hidden /> Already checked in {formatDateTime(result.reg.checked_in_at)}</>}
                  {result.kind === 'unpaid' && <><XCircle className="size-5" aria-hidden /> Not confirmed: send to the help desk</>}
                </p>
                <p className="text-display mt-2">{result.reg.full_name}</p>
                <p className="opacity-90">
                  {[result.reg.branch, result.reg.grad_year].filter(Boolean).join(' ')} · admits <strong>{result.reg.headcount}</strong>
                </p>
                {result.reg.guests.length > 0 && <p className="mt-1 text-sm opacity-90">With: {result.reg.guests.map((g) => g.name || g.relation).join(', ')}</p>}
                <p className="mt-1 font-mono text-sm opacity-80">{result.reg.code}</p>
                {result.kind === 'ok' && (
                  <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/20 px-4 text-sm font-semibold" onClick={() => check(result.reg.code, true)}>
                    <Undo2 className="size-4" aria-hidden /> Undo
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <form onSubmit={submitManual} className="flex gap-2">
          <div className="relative flex-1">
            <Keyboard className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Ticket code" placeholder="Code, e.g. 7KQ4M2" className="pl-11 font-mono uppercase" value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" />
          </div>
          <Button type="submit" loading={busy}>
            Check
          </Button>
        </form>
        <GateSearch eventId={data.event.id} onPick={(code) => check(code)} />
        <ArrivalsCounter eventId={data.event.id} compact />
        <p className="text-center text-sm text-muted">Point the camera at the attendee’s QR code. Green = welcome, amber = already in, red = help desk.</p>
      </div>
    </div>
  )
}
