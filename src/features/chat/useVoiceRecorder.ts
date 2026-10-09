import { useCallback, useEffect, useRef, useState } from 'react'

export const MAX_VOICE_SECONDS = 300

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

export function voiceSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export interface Recording {
  file: File
  seconds: number
}

/**
 * Records a voice note from the microphone. start() asks for permission; stop() resolves with the file
 * (or null if cancelled / too short). The mic is always released, including on unmount.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const done = useRef<((r: Recording | null) => void) | null>(null)
  const keep = useRef(true)

  const release = useCallback(() => {
    if (tick.current) clearInterval(tick.current)
    tick.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    rec.current = null
    setRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async () => {
    if (rec.current) return
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = (e as DOMException).name
      throw new Error(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it in your browser settings to send voice messages.'
          : name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : 'Couldn’t start the microphone.',
      )
    }
    stream.current = s
    const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    keep.current = true
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onstop = () => {
      const secs = (Date.now() - startedAt.current) / 1000
      const type = (r.mimeType || mime || 'audio/webm').split(';')[0]!
      const blob = new Blob(chunks.current, { type })
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      const ok = keep.current && secs >= 1 && blob.size > 0
      release()
      done.current?.(ok ? { file: new File([blob], `voice-${Date.now()}.${ext}`, { type }), seconds: Math.round(secs) } : null)
      done.current = null
    }
    rec.current = r
    startedAt.current = Date.now()
    r.start(250)
    setRecording(true)
    tick.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(secs)
      if (secs >= MAX_VOICE_SECONDS) rec.current?.stop()
    }, 250)
  }, [release])

  const finish = useCallback((save: boolean) => {
    const r = rec.current
    if (!r || r.state === 'inactive') return Promise.resolve(null)
    keep.current = save
    return new Promise<Recording | null>((resolve) => {
      done.current = resolve
      r.stop()
    })
  }, [])

  useEffect(
    () => () => {
      keep.current = false
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
      else release()
    },
    [release],
  )

  return { recording, seconds, start, stop: () => finish(true), cancel: () => finish(false) }
}
