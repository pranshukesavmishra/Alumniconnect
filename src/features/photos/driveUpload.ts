// Sends a video from the phone straight to Google Drive with a RESUMABLE upload: the drive-upload edge function hands out the one-time
// upload link, the file goes up in 8 MB chunks (so progress is real, a dropped connection costs one chunk, and Cancel stops at once),
// and the function is told when it is done so it can check the file and mark the video playable.
import { supabase } from '../../lib/supabase'

/** Drive wants chunks that are multiples of 256 KiB. */
export const CHUNK_BYTES = 8 * 1024 * 1024

export interface ChunkResponse {
  status: number
  /** the "Range" response header ("bytes=0-8388607") when Google lets the page read it */
  range: string | null
  body: string
}

export interface ChunkTransport {
  /** PUT one piece. Rejects on a network failure; resolves with any HTTP status. onProgress gets the bytes of THIS piece sent so far. */
  put(url: string, body: Blob, headers: Record<string, string>, onProgress: (sent: number) => void, signal: AbortSignal): Promise<ChunkResponse>
}

export class UploadAborted extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'AbortError'
  }
}

/** A refusal retrying cannot fix. */
export class UploadRefused extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ResumableOptions {
  url: string
  file: Blob
  mime: string
  transport?: ChunkTransport
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  chunk?: number
  /** consecutive failures tolerated before giving up */
  retries?: number
  sleep?: (ms: number) => Promise<void>
  /** called when the page is offline: resolves when it is back */
  online?: () => Promise<void>
  /** where an earlier attempt got to (kept by the caller so a manual retry does not start again) */
  resumeFrom?: number
  onOffset?: (offset: number) => void
}

/** "bytes=0-8388607" -> 8388608 (the next byte Google expects). null if there is no usable range. */
export function nextOffset(range: string | null): number | null {
  const m = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null
  return m ? Number(m[1]) + 1 : null
}

export function chunkPlan(size: number, offset: number, chunk = CHUNK_BYTES): { start: number; end: number } {
  const start = offset
  const end = Math.min(start + chunk, size) - 1
  return { start, end }
}

const retryable = (status: number) => status === 408 || status === 429 || status >= 500

/** Sends the whole file. Resolves with the Drive file id. Throws UploadAborted on cancel and UploadRefused on a hard refusal. */
export async function resumableUpload(o: ResumableOptions): Promise<{ fileId: string }> {
  const transport = o.transport ?? xhrTransport
  const size = o.file.size
  const chunk = o.chunk ?? CHUNK_BYTES
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxFails = o.retries ?? 6
  const signal = o.signal ?? new AbortController().signal
  let offset = o.resumeFrom ?? 0
  let fails = 0

  const idOf = (r: ChunkResponse): string => {
    try {
      const id = (JSON.parse(r.body) as { id?: string }).id
      if (id) return id
    } catch {
      /* not JSON */
    }
    throw new UploadRefused(r.status, 'Drive did not return the file')
  }

  // asks Drive how much it has: a finished upload answers with the file, an unfinished one with a Range
  const ask = async (): Promise<{ done: string } | { offset: number }> => {
    const r = await transport.put(o.url, new Blob([]), { 'Content-Range': `bytes */${size}` }, () => {}, signal)
    if (r.status === 200 || r.status === 201) return { done: idOf(r) }
    if (r.status === 308) return { offset: nextOffset(r.range) ?? 0 }
    throw new UploadRefused(r.status, `Drive answered ${r.status}`)
  }

  if (offset > 0) {
    const a = await ask().catch(() => ({ offset }))
    if ('done' in a) return { fileId: a.done }
    offset = a.offset
  }

  while (offset < size) {
    if (signal.aborted) throw new UploadAborted()
    const { start, end } = chunkPlan(size, offset, chunk)
    try {
      const r = await transport.put(
        o.url,
        o.file.slice(start, end + 1),
        { 'Content-Range': `bytes ${start}-${end}/${size}` },
        (sent) => o.onProgress?.(Math.min(size, start + sent), size),
        signal,
      )
      if (r.status === 200 || r.status === 201) {
        o.onProgress?.(size, size)
        return { fileId: idOf(r) }
      }
      if (r.status === 308) {
        // Google may keep less than was sent; when the page cannot read the Range header, believe the chunk arrived whole
        offset = nextOffset(r.range) ?? end + 1
        fails = 0
        o.onOffset?.(offset)
        o.onProgress?.(offset, size)
        continue
      }
      if (retryable(r.status)) throw new Error(`Drive answered ${r.status}`)
      throw new UploadRefused(r.status, r.status === 404 || r.status === 410 ? 'The upload link has expired. Please try again.' : `Drive refused the upload (${r.status})`)
    } catch (e) {
      if (signal.aborted || (e as Error)?.name === 'AbortError') throw new UploadAborted()
      if (e instanceof UploadRefused) throw e
      if (++fails > maxFails) throw e
      await sleep(Math.min(1000 * 2 ** (fails - 1), 15_000))
      await o.online?.()
      if (signal.aborted) throw new UploadAborted()
      try {
        const a = await ask()
        if ('done' in a) return { fileId: a.done }
        offset = a.offset
        o.onOffset?.(offset)
      } catch (e2) {
        if (e2 instanceof UploadRefused) throw e2
        // still offline: the next loop sends the same chunk again
      }
    }
  }
  // everything was acknowledged but no 200 yet (an exact multiple of the chunk size): ask for the result
  const last = await ask()
  if ('done' in last) return { fileId: last.done }
  throw new UploadRefused(308, 'Drive did not finish the upload')
}

/** The real transport: XMLHttpRequest, because fetch cannot report upload progress. */
export const xhrTransport: ChunkTransport = {
  put(url, body, headers, onProgress, signal) {
    return new Promise<ChunkResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
      xhr.upload.onprogress = (e) => onProgress(e.loaded)
      xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), body: xhr.responseText })
      xhr.onerror = () => reject(new TypeError('Network error'))
      xhr.ontimeout = () => reject(new TypeError('Timed out'))
      xhr.onabort = () => reject(new UploadAborted())
      if (signal.aborted) return reject(new UploadAborted())
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.send(body)
    })
  },
}

// ------------------------------------------------------------------ the whole round trip with the edge function
export type DriveTarget = { kind: 'event'; photoId: string } | { kind: 'gallery' | 'glimpse'; id: string }

/** The message an edge function sent back with an error status, else the error's own text. */
export async function functionMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = (await ctx.clone().json()) as { error?: string }
      if (j.error) return j.error
    } catch {
      /* not JSON */
    }
  }
  return error instanceof Error ? error.message : String(error)
}

const targetBody = (t: DriveTarget) => (t.kind === 'event' ? { photo_id: t.photoId } : { kind: t.kind, id: t.id })

export interface SendOptions {
  target: DriveTarget
  file: File
  mime: string
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  /** remembered between attempts of the same file */
  session?: { url?: string; offset?: number }
  transport?: ChunkTransport
  online?: () => Promise<void>
}

/** start -> chunked upload -> finish. Throws UploadRefused('drive') when Drive is not set up. */
export async function sendVideoToDrive(o: SendOptions): Promise<void> {
  const session = o.session ?? {}
  if (!session.url) {
    const start = await supabase.functions.invoke('drive-upload', { body: { action: 'start', ...targetBody(o.target), mime_type: o.mime, size: o.file.size } })
    if (start.error) throw new UploadRefused(Number((start.error as { context?: Response }).context?.status ?? 502), await functionMessage(start.error))
    const data = start.data as { upload_url?: string; skipped?: boolean } | null
    if (data?.skipped || !data?.upload_url) throw new UploadRefused(503, 'drive-not-set-up')
    session.url = data.upload_url
    session.offset = 0
  }
  const { fileId } = await resumableUpload({
    url: session.url,
    file: o.file,
    mime: o.mime,
    onProgress: o.onProgress,
    signal: o.signal,
    transport: o.transport,
    online: o.online,
    resumeFrom: session.offset,
    onOffset: (n) => (session.offset = n),
  })
  let lastError: unknown = null
  for (let i = 0; i < 3; i++) {
    const fin = await supabase.functions.invoke('drive-upload', { body: { action: 'finish', ...targetBody(o.target), file_id: fileId } })
    if (!fin.error) return
    lastError = fin.error
    const status = Number((fin.error as { context?: Response }).context?.status ?? 0)
    if (status >= 400 && status < 500) break
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
  }
  throw new UploadRefused(502, await functionMessage(lastError))
}

// ------------------------------------------------------------------ a video that is already in Drive (pasted link or id)
export interface DriveVideoInfo {
  file_id: string
  name: string
  mime_type: string
  size_bytes: number
}

async function curatedCall<T>(body: Record<string, unknown>): Promise<T> {
  const r = await supabase.functions.invoke('drive-upload', { body })
  if (r.error) throw new UploadRefused(Number((r.error as { context?: Response }).context?.status ?? 502), await functionMessage(r.error))
  const data = r.data as (T & { skipped?: boolean }) | null
  if (!data || data.skipped) throw new UploadRefused(503, 'drive-not-set-up')
  return data
}

/** Asks the edge function whether the app can open this Drive video (link or id); nothing is changed. */
export function inspectDriveVideo(kind: 'gallery' | 'glimpse', ref: string): Promise<DriveVideoInfo> {
  return curatedCall<DriveVideoInfo>({ action: 'inspect', kind, file_ref: ref })
}

/** Points a saved gallery / glimpse row at that Drive video (the file is used where it is). */
export async function attachDriveVideo(kind: 'gallery' | 'glimpse', id: string, ref: string): Promise<void> {
  await curatedCall<{ ok: boolean }>({ action: 'attach', kind, id, file_ref: ref })
}
