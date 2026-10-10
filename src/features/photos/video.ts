// Everything about video files that does not need a screen: which files are accepted, the size rules, a quick fingerprint to spot the
// same video picked twice, a poster image and the duration read on the phone, and how a video is played back (the drive-media function).
import { compressImageSizes, THUMB_SIZE, type CompressedImage } from '../../lib/image'

export const MB = 1024 * 1024
/** Videos for events and the gallery: Drive has the room, the phone's data plan is the limit. */
export const MAX_VIDEO_BYTES = 500 * MB
/** Glimpses are played for every visitor, so they stay small (the bytes pass through the app's bandwidth). */
export const MAX_GLIMPSE_BYTES = 60 * MB
export const MAX_GLIMPSE_MS = 90_000
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export type VideoMime = (typeof VIDEO_MIMES)[number]

const EXT_MIME: Record<string, VideoMime> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm' }

/** The mime type to store for a picked file: from the browser, or (iOS and some Android pickers leave it empty or odd) from the file name. */
export function videoMime(file: Pick<File, 'name' | 'type'>): VideoMime | null {
  const t = (file.type || '').toLowerCase()
  if ((VIDEO_MIMES as readonly string[]).includes(t)) return t as VideoMime
  if (t === 'video/x-m4v') return 'video/mp4'
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  if (ext && EXT_MIME[ext] && (!t || t.startsWith('video/') || t === 'application/octet-stream')) return EXT_MIME[ext]
  return null
}

/** Is this file (by type or name) meant as a video? Unsupported video formats still count, so they get a clear message, not a photo error. */
export function isVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return (file.type || '').toLowerCase().startsWith('video/') || /\.(mp4|m4v|mov|qt|webm|avi|mkv|3gp|wmv|mpg|mpeg)$/i.test(file.name)
}

export type VideoProblem = 'format' | 'empty' | 'tooBig'
/** What is wrong with this file, or null. `max` is the size limit in bytes. */
export function videoProblem(file: Pick<File, 'name' | 'type' | 'size'>, max = MAX_VIDEO_BYTES): VideoProblem | null {
  if (!videoMime(file)) return 'format'
  if (file.size <= 0) return 'empty'
  if (file.size > max) return 'tooBig'
  return null
}

export function extOf(mime: VideoMime): 'mp4' | 'mov' | 'webm' {
  return mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4'
}

/** 0:07, 1:05, 1:02:03 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  return bytes >= 10 * MB ? `${Math.round(bytes / MB)} MB` : bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * A quick fingerprint of a (possibly huge) video: SHA-256 of its size plus its first, middle and last 1 MB. Reading all of a 500 MB file
 * just to spot a duplicate would stall a phone; two different videos never share size AND these three slices. null if the browser cannot hash.
 */
export async function videoFingerprint(file: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const slice = MB
    const parts: ArrayBuffer[] = []
    const offsets = file.size <= 3 * slice ? [0] : [0, Math.floor((file.size - slice) / 2), file.size - slice]
    for (const o of offsets) parts.push(await file.slice(o, file.size <= 3 * slice ? file.size : o + slice).arrayBuffer())
    const head = new TextEncoder().encode(`video:${file.size}:`)
    const all = new Uint8Array(head.length + parts.reduce((n, p) => n + p.byteLength, 0))
    all.set(head, 0)
    let at = head.length
    for (const p of parts) {
      all.set(new Uint8Array(p), at)
      at += p.byteLength
    }
    const digest = await subtle.digest('SHA-256', all)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export interface VideoInfo {
  duration_ms: number | null
  width: number | null
  height: number | null
  poster: CompressedImage
  /** the phone could not decode a frame (a codec this browser lacks, e.g. HEVC on desktop Chrome): the poster is a plain placeholder */
  placeholder: boolean
}

function waitFor(target: EventTarget, ok: string[], ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      clearTimeout(timer)
      for (const n of [...ok, 'error']) target.removeEventListener(n, onEvent)
      resolve(v)
    }
    const onEvent = (e: Event) => done(e.type === 'error' ? null : e.type)
    const timer = setTimeout(() => done(null), ms)
    for (const n of [...ok, 'error']) target.addEventListener(n, onEvent)
  })
}

/** A dark 16:9 card with a play triangle: the poster when no frame can be read. */
function placeholderCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 480
  c.height = 270
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#1f2937'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = 'rgba(255,255,255,0.85)'
    g.beginPath()
    g.moveTo(210, 100)
    g.lineTo(210, 170)
    g.lineTo(272, 135)
    g.closePath()
    g.fill()
  }
  return c
}

async function posterFrom(canvas: HTMLCanvasElement): Promise<CompressedImage> {
  const png: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster'))), 'image/png'))
  const [img] = await compressImageSizes(png, [{ maxSide: THUMB_SIZE, quality: 0.75 }])
  return img!
}

/**
 * Reads the length and size of a video on the phone and draws a poster from its first frame. Never throws: a video the browser cannot
 * decode (HEVC .mov on a desktop, say) still uploads, with a plain poster and no duration. Gives up after `timeout` ms (iOS Safari
 * sometimes never fires "seeked" for a muted, unattached video).
 */
export async function readVideoInfo(file: Blob, timeout = 8000): Promise<VideoInfo> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = url
  let duration: number | null = null
  let width: number | null = null
  let height: number | null = null
  let canvas: HTMLCanvasElement | null = null
  try {
    if ((await waitFor(v, ['loadedmetadata'], timeout)) === 'loadedmetadata') {
      duration = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null
      width = v.videoWidth || null
      height = v.videoHeight || null
      if (width && height) {
        // the first frame is often black: take it a moment in (but still near the start)
        const at = duration && duration > 600 ? 0.1 : 0
        if (at > 0) {
          v.currentTime = at
          await waitFor(v, ['seeked'], timeout)
        } else if (v.readyState < 2) {
          await waitFor(v, ['loadeddata'], timeout)
        }
        if (v.readyState >= 2) {
          const c = document.createElement('canvas')
          const scale = Math.min(1, 960 / Math.max(width, height))
          c.width = Math.max(1, Math.round(width * scale))
          c.height = Math.max(1, Math.round(height * scale))
          c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
          canvas = c
        }
      }
    }
  } catch {
    /* fall through to the placeholder */
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
  const placeholder = !canvas
  const poster = await posterFrom(canvas ?? placeholderCanvas())
  if (placeholder) {
    width = null
    height = null
  }
  return { duration_ms: duration, width, height, poster, placeholder }
}

// ------------------------------------------------------------------ playback
export type MediaKind = 'event' | 'gallery' | 'glimpse'

/** The address of the drive-media function that streams a video (the browser's <video> adds Range requests itself). */
export function mediaUrl(kind: MediaKind, id: string, token?: string | null, opts: { download?: boolean; base?: string } = {}): string {
  const base = opts.base ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  const q = new URLSearchParams({ k: kind, id })
  if (kind !== 'glimpse' && token) q.set('t', token)
  if (opts.download) q.set('dl', '1')
  return `${base.replace(/\/$/, '')}/functions/v1/drive-media?${q}`
}

/**
 * Should a glimpse autoplay? Not when the visitor asked for reduced motion or Data Saver, nor on a very slow connection:
 * then only the poster shows and a tap plays it.
 */
export function glimpseAutoplays(env: { reducedMotion: boolean; saveData?: boolean; effectiveType?: string }): boolean {
  if (env.reducedMotion || env.saveData) return false
  return !(env.effectiveType === 'slow-2g' || env.effectiveType === '2g' || env.effectiveType === '3g')
}
