import type { BrowserContext, Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A stand-in for Google Drive + the drive-upload / drive-media edge functions, used by the browser tests (the real functions are verified
// against a strict fake Google in e2e/verify/drive-video.deno.ts). It answers in the browser:
//   drive-upload   start -> a same-origin "upload link";  finish / attach -> runs the test's hook (which writes drive_file_id with SQL)
//   the upload link  PUT chunks: 308 until the last chunk, then 200 {id};  can fail the first PUT (503) to prove retry, and can be slowed
//   drive-media    streams a real tiny WebM with Range support, and records every request
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
export const fixture = (name: string) => FIXTURES + name
export const WEBM = readFileSync(fixture('clip.webm'))

export interface DriveMockState {
  starts: Record<string, unknown>[]
  finishes: Record<string, unknown>[]
  inspects: Record<string, unknown>[]
  attaches: Record<string, unknown>[]
  puts: { range: string; size: number }[]
  media: { url: string; range: string | null; token: string | null }[]
}

export interface DriveMockOptions {
  /** the base address of the app, e.g. http://localhost:5291 (the upload link is on the same origin so no CORS is involved) */
  origin: string
  /** the first chunk PUT gets a 503 */
  failFirstPut?: boolean
  /** every chunk PUT waits this long (so progress and Cancel can be seen) */
  putDelayMs?: number
  /** the answer to start when the server says Drive is not set up */
  skipped?: boolean
  /** called on finish: write drive_file_id for the row */
  onFinish?: (body: Record<string, unknown>) => void
  /** inspect answers: return the details or an { status, error } */
  inspect?: (body: Record<string, unknown>) => { file_id: string; name: string; mime_type: string; size_bytes: number } | { status: number; error: string }
  onAttach?: (body: Record<string, unknown>) => void
  /** the bytes drive-media serves (default: the tiny WebM) */
  bytes?: Buffer
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, HEAD, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type' }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function mockDrive(target: Page | BrowserContext, o: DriveMockOptions): Promise<DriveMockState> {
  const state: DriveMockState = { starts: [], finishes: [], inspects: [], attaches: [], puts: [], media: [] }
  const sessions = new Map<string, { total: number; received: number }>()
  let failed = false
  const bytes = o.bytes ?? WEBM

  await target.route('**/functions/v1/drive-upload', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
    if (body.action === 'start') {
      state.starts.push(body)
      if (o.skipped) return json(route, { skipped: true })
      const id = crypto.randomUUID()
      sessions.set(id, { total: Number(body.size), received: 0 })
      return json(route, { upload_url: `${o.origin}/__drive/${id}` })
    }
    if (body.action === 'finish') {
      state.finishes.push(body)
      o.onFinish?.(body)
      return json(route, { ok: true })
    }
    if (body.action === 'inspect') {
      state.inspects.push(body)
      const r = o.inspect?.(body) ?? { status: 422, error: 'The app cannot open that file.' }
      return 'status' in r ? json(route, { error: r.error }, r.status) : json(route, r)
    }
    if (body.action === 'attach') {
      state.attaches.push(body)
      o.onAttach?.(body)
      return json(route, { ok: true })
    }
    return json(route, { error: 'Unknown action' }, 400)
  })

  await target.route('**/__drive/**', async (route) => {
    const req = route.request()
    const id = new URL(req.url()).pathname.split('/').pop()!
    const s = sessions.get(id)
    if (!s) return route.fulfill({ status: 404, body: 'no session' })
    const cr = req.headers()['content-range'] ?? ''
    const size = req.postDataBuffer()?.length ?? 0
    state.puts.push({ range: cr, size })
    const ask = /^bytes \*\//.test(cr)
    if (!ask && o.failFirstPut && !failed) {
      failed = true
      return route.fulfill({ status: 503, body: 'try later' })
    }
    if (!ask) {
      if (o.putDelayMs) await new Promise((r) => setTimeout(r, o.putDelayMs))
      s.received += size
    }
    if (s.received >= s.total) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `FAKEDRIVE${id.replace(/-/g, '').slice(0, 20)}` }) })
    return route.fulfill({ status: 308, headers: s.received > 0 ? { Range: `bytes=0-${s.received - 1}` } : {}, body: '' })
  })

  await target.route('**/functions/v1/drive-media**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    state.media.push({ url: req.url(), range: req.headers()['range'] ?? null, token: url.searchParams.get('t') })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const range = req.headers()['range']
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
    if (!m) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length) }, body: bytes })
    const a = m[1] === '' ? Math.max(bytes.length - Number(m[2]), 0) : Number(m[1])
    const b = m[1] === '' || m[2] === '' ? bytes.length - 1 : Math.min(Number(m[2]), bytes.length - 1)
    if (a >= bytes.length) return route.fulfill({ status: 416, headers: { ...cors, 'Content-Range': `bytes */${bytes.length}` }, body: '' })
    return route.fulfill({ status: 206, headers: { ...cors, 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${bytes.length}`, 'Content-Length': String(b - a + 1) }, body: bytes.subarray(a, b + 1) })
  })

  return state
}
