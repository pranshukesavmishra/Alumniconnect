// Speak instead of type: the browser's own speech recognition (Chrome, Edge, Safari; Android Chrome works well with
// Indian English and Hindi). Where the browser has none, `supported` is false and the mic button is not shown.
import { useCallback, useEffect, useRef, useState } from 'react'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = () => ctor() !== null

/**
 * `start()` listens until the member stops talking or taps again; every finished phrase is passed to `onText`.
 * `error` is 'denied' when the microphone permission was refused, 'failed' for anything else.
 */
export function useSpeech(lang: 'en' | 'hi', onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<'denied' | 'failed' | null>(null)
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(onText)
  useEffect(() => {
    cb.current = onText
  })
  const supported = speechSupported()

  useEffect(() => () => rec.current?.abort(), [])

  const stop = useCallback(() => rec.current?.stop(), [])

  const start = useCallback(() => {
    const C = ctor()
    if (!C) return
    rec.current?.abort()
    const r = new C()
    r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!
        if (res.isFinal) cb.current(res[0].transcript.trim())
        else live += res[0].transcript
      }
      setInterim(live)
    }
    r.onerror = (e) => setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? null : 'failed')
    r.onend = () => {
      setListening(false)
      setInterim('')
    }
    setError(null)
    try {
      r.start()
      rec.current = r
      setListening(true)
    } catch {
      setError('failed')
    }
  }, [lang])

  return { supported, listening, interim, error, start, stop }
}
