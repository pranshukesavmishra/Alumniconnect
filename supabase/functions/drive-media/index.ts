// Plays videos that live in the committee's Google Drive, inside the app (a plain <video src=...>), with seeking:
// it checks who may see the row, then streams the Drive file and passes HTTP Range requests on (200 / 206 / 416).
//
//   GET /drive-media?k=event&id=<photo id>&t=<member access token>     a member who may see that event photo / video
//   GET /drive-media?k=gallery&id=<gallery id>&t=<access token>        a verified member (the college gallery)
//   GET /drive-media?k=glimpse&id=<glimpse id>                         anyone: ONLY a glimpse an admin has made visible
//
// A <video> element cannot send an Authorization header, so members pass their access token in the query (it is short lived and only
// ever sent to this function over HTTPS). The rows are read with that token, so row-level security decides, exactly as for the lists.
// Only files named by a visible database row are ever served, never an arbitrary Drive id. Needs verify_jwt = false (config.toml).
import { asService, asUser, currentUser, eq } from '../_shared/db.ts'
import { driveConfigured, driveMedia } from '../_shared/google.ts'
import { corsHeaders } from '../_shared/http.ts'

const UUID = /^[0-9a-f-]{36}$/
const EXPOSE = 'Content-Range, Content-Length, Accept-Ranges, Content-Type'

function headers(req: Request, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...corsHeaders(req),
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range, authorization, apikey, content-type',
    'Access-Control-Expose-Headers': EXPOSE,
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  }
}
const fail = (req: Request, status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: headers(req, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) })

type Row = { drive_file_id: string | null; mime_type: string | null; media_kind?: string }

async function lookup(k: string, id: string, token: string | null): Promise<{ row: Row | null; status: number }> {
  if (k === 'glimpse') {
    const [row] = await asService().select<Row>('glimpses', `select=drive_file_id,mime_type&id=${eq(id)}&is_visible=eq.true&drive_file_id=not.is.null`)
    return { row: row ?? null, status: row ? 200 : 404 }
  }
  if (k !== 'event' && k !== 'gallery') return { row: null, status: 400 }
  const auth = token ? `Bearer ${token}` : ''
  if (!(await currentUser(auth))) return { row: null, status: 401 }
  const [row] = await asUser(auth).select<Row>(k === 'event' ? 'event_photos' : 'gallery_photos', `select=drive_file_id,mime_type,media_kind&id=${eq(id)}`)
  const ok = !!row && row.media_kind === 'video' && !!row.drive_file_id
  return { row: ok ? row : null, status: ok ? 200 : 404 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: headers(req) })
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(req, 405, 'Method not allowed')
  const url = new URL(req.url)
  const k = url.searchParams.get('k') ?? ''
  const id = url.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return fail(req, 404, 'Video not found')
  if (!driveConfigured()) return fail(req, 503, 'Video playback is not set up yet')

  const { row, status } = await lookup(k, id, url.searchParams.get('t'))
  if (!row?.drive_file_id) return fail(req, status === 200 ? 404 : status, status === 401 ? 'Please sign in again.' : 'Video not found')

  let res: Response
  try {
    res = await driveMedia(row.drive_file_id, req.headers.get('Range'))
  } catch (e) {
    console.error(e)
    return fail(req, 502, 'Could not reach the video')
  }
  if (res.status !== 200 && res.status !== 206 && res.status !== 416) {
    await res.body?.cancel()
    return fail(req, res.status === 404 ? 404 : 502, 'Could not load the video')
  }
  const out: Record<string, string> = {
    'Content-Type': row.mime_type ?? res.headers.get('Content-Type') ?? 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': url.searchParams.get('dl') === '1' ? `attachment; filename="jec-video.${(row.mime_type ?? '').includes('webm') ? 'webm' : (row.mime_type ?? '').includes('quicktime') ? 'mov' : 'mp4'}"` : 'inline',
    // glimpses are public and the same for everyone: browsers and shared caches may keep them; member videos stay private to the browser
    'Cache-Control': k === 'glimpse' ? 'public, max-age=86400' : 'private, max-age=3600',
  }
  for (const h of ['Content-Length', 'Content-Range']) {
    const v = res.headers.get(h)
    if (v) out[h] = v
  }
  return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: headers(req, out) })
})
