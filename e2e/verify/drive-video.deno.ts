// Verifies the VIDEO side of drive-upload and the drive-media function END TO END against the real local Supabase stack (GoTrue + PostgREST +
// Postgres with all migrations) and the strict fake Google (e2e/verify/drive-fake-google.ts): event videos, gallery videos, glimpses,
// "use a file that is already in Drive", and streaming with Range requests for members and for anonymous glimpse viewers.
//
// Run (needs `npx supabase start`, migration 71-73 applied, and Deno 2):
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... deno test -A e2e/verify/drive-video.deno.ts   (or just: deno run -A e2e/verify/drive-video.deno.ts)
// It creates its own users / event / rows (prefix "vidverify") and deletes them afterwards.
import { CLIENT, FakeGoogle } from './drive-fake-google.ts'

const SUPA = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321'
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ORIGIN = 'http://localhost:5184'
const FAKE_PORT = 18991
const RUN = crypto.randomUUID().slice(0, 8)

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}
function eqv(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`)
}

const google = new FakeGoogle().start(FAKE_PORT)
Deno.env.set('SUPABASE_URL', SUPA)
Deno.env.set('SUPABASE_ANON_KEY', ANON)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
Deno.env.set('GOOGLE_OAUTH_URL', `${google.base}/token`)
Deno.env.set('GOOGLE_API_URL', `${google.base}/drive/v3`)
Deno.env.set('GOOGLE_UPLOAD_URL', `${google.base}/upload/drive/v3`)
Deno.env.set('APP_ORIGINS', `${ORIGIN},https://alumni.example.org`)
Deno.env.set('GOOGLE_CLIENT_ID', CLIENT.id)
Deno.env.set('GOOGLE_CLIENT_SECRET', CLIENT.secret)
Deno.env.set('GOOGLE_DRIVE_REFRESH_TOKEN', CLIENT.refresh)

type Handler = (r: Request) => Response | Promise<Response>
const handlers: Handler[] = []
const realServe = Deno.serve
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (a: unknown, b?: unknown) => {
  handlers.push((typeof a === 'function' ? a : b) as Handler)
  return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'x', port: 0, transport: 'tcp' } }
}
await import('../../supabase/functions/drive-upload/index.ts')
await import('../../supabase/functions/drive-media/index.ts')
;(Deno as unknown as { serve: typeof realServe }).serve = realServe
const [driveUpload, driveMedia] = handlers as [Handler, Handler]

async function rest(method: string, path: string, body?: unknown, prefer = 'return=representation') {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${t}`)
  return t ? JSON.parse(t) : null
}
async function makeUser(tag: string, verified = true): Promise<{ id: string; jwt: string }> {
  const email = `vidverify-${tag}-${RUN}@example.com`
  const password = `pw-${crypto.randomUUID()}`
  const r = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Vid ${tag}` } }),
  })
  const u = await r.json()
  assert(r.ok, `create user ${JSON.stringify(u)}`)
  const t = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const tj = await t.json()
  assert(t.ok, `sign in ${JSON.stringify(tj)}`)
  if (verified) await rest('PATCH', `profiles?id=eq.${u.id}`, { onboarded: true, verification: 'verified', member_type: 'alumnus', branch: 'Civil Engineering', city: 'Pune', grad_year: 2001 })
  return { id: u.id, jwt: tj.access_token }
}
async function callUpload(body: unknown, jwt?: string, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  if (origin) headers.Origin = origin
  const res = await driveUpload(new Request('http://fn/drive-upload', { method: 'POST', headers, body: JSON.stringify(body) }))
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text }
}
async function media(q: Record<string, string>, opts: { range?: string; method?: string } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (opts.range) headers.Range = opts.range
  const res = await driveMedia(new Request(`http://fn/drive-media?${new URLSearchParams(q)}`, { method: opts.method ?? 'GET', headers }))
  const body = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, body }
}
/** the browser's PUT of the bytes to the resumable session */
async function putBytes(url: string, bytes: Uint8Array, range?: string) {
  const headers: Record<string, string> = { Origin: ORIGIN, 'Content-Type': 'application/octet-stream' }
  if (range) headers['Content-Range'] = range
  const r = await fetch(url, { method: 'PUT', headers, body: bytes })
  const text = await r.text()
  return { status: r.status, json: text.startsWith('{') ? JSON.parse(text) : null, range: r.headers.get('Range') }
}
const bytesOf = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251)

// ------------------------------------------------------------------ fixtures
const admin = await makeUser('admin')
const member = await makeUser('member')
const other = await makeUser('other')
const stranger = await makeUser('stranger', false)
await rest('PATCH', `profiles?id=eq.${admin.id}`, { is_admin: true })
const [ev] = await rest('POST', 'events', { slug: `vidverify-${RUN}`, title: `Vid verify ${RUN}`, is_published: true })
const folder = google.newId('fold')
google.files.set(folder, { id: folder, name: 'root', mimeType: 'application/vnd.google-apps.folder', parents: ['root-of-my-drive'], appProperties: {}, trashed: false, ownedByApp: true })
await rest('POST', 'event_settings', { event_id: ev.id, drive_folder_id: folder })
const SIZE = 600_000
const mkVideo = async (owner: string, n: number, size = SIZE) =>
  (await rest('POST', 'event_photos', { event_id: ev.id, uploaded_by: owner, storage_path: `${owner}/vid-${RUN}-${n}.mp4`, thumb_path: `${owner}/vid-${RUN}-${n}_t.webp`, media_kind: 'video', mime_type: 'video/mp4', size_bytes: size }))[0].id as string
const v1 = await mkVideo(member.id, 1)
const v2 = await mkVideo(member.id, 2)
const photo = (await rest('POST', 'event_photos', { event_id: ev.id, uploaded_by: member.id, storage_path: `${member.id}/p-${RUN}.webp`, thumb_path: `${member.id}/p-${RUN}_t.webp` }))[0].id as string

let failures = 0
const results: string[] = []
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    results.push(`PASS  ${name}`)
  } catch (e) {
    failures++
    results.push(`FAIL  ${name}\n      ${(e as Error).message.replace(/\n/g, '\n      ')}`)
  }
}

const createdRows: { table: string; id: string }[] = []
try {
  // ================================================================ event videos
  let uploadUrl = ''
  const content = bytesOf(SIZE)
  await step('start: a video of the right size and type gets a one-time upload link and a "Videos from members" folder', async () => {
    const r = await callUpload({ action: 'start', photo_id: v1, mime_type: 'video/mp4', size: SIZE }, member.jwt)
    eqv(r.status, 200, r.text)
    uploadUrl = r.json.upload_url as string
    assert(uploadUrl.startsWith(google.base), 'link points at Google')
    const sub = [...google.files.values()].find((f) => f.name === 'Videos from members' && f.parents.includes(folder))
    assert(sub, 'subfolder made inside the event folder')
  })
  await step('start refuses: a photo mime on a video row, the wrong size, a bad type, too large, someone else\'s video, no origin', async () => {
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'image/jpeg', size: SIZE }, member.jwt)).status, 400, 'photo mime')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/mp4', size: SIZE + 1 }, member.jwt)).status, 400, 'size differs from the saved row')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/x-msvideo', size: SIZE }, member.jwt)).status, 400, 'avi')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/quicktime', size: SIZE }, member.jwt)).status, 400, 'mime differs from the saved row')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/mp4', size: SIZE }, other.jwt)).status, 404, 'not the uploader')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/mp4', size: SIZE }, member.jwt, null)).status, 403, 'origin required')
    eqv((await callUpload({ action: 'start', photo_id: photo, mime_type: 'video/mp4', size: SIZE }, member.jwt)).status, 400, 'a photo row cannot take a video')
  })
  let fileId = ''
  await step('the browser sends the bytes in chunks (308 then 200) and Drive keeps them whole', async () => {
    const chunk = 256 * 1024 * 2
    const first = await putBytes(uploadUrl, content.slice(0, chunk), `bytes 0-${chunk - 1}/${SIZE}`)
    eqv(first.status, 308, 'first chunk is accepted as incomplete')
    eqv(first.range, 'bytes=0-' + (chunk - 1), 'Drive reports how much it kept')
    const last = await putBytes(uploadUrl, content.slice(chunk), `bytes ${chunk}-${SIZE - 1}/${SIZE}`)
    eqv(last.status, 200, 'final chunk completes')
    fileId = last.json.id as string
    eqv(google.files.get(fileId)!.content!.length, SIZE, 'whole file stored')
  })
  await step('before finish the video is not playable: drive-media answers 404', async () => {
    eqv((await media({ k: 'event', id: v1, t: member.jwt })).status, 404, 'unfinished')
  })
  await step('finish: wrong file (not bound to this video) -> 400; right file -> recorded', async () => {
    const wrong = google.newId('x')
    google.files.set(wrong, { id: wrong, name: 'w', mimeType: 'video/mp4', parents: [folder], appProperties: { jec_photo_id: v2 }, content: bytesOf(SIZE), trashed: false, ownedByApp: true })
    eqv((await callUpload({ action: 'finish', photo_id: v1, file_id: wrong }, member.jwt)).status, 400, 'file belongs to another video')
    eqv((await callUpload({ action: 'finish', photo_id: v1, file_id: 'not valid!' }, member.jwt)).status, 400, 'bad id')
    const ok = await callUpload({ action: 'finish', photo_id: v1, file_id: fileId }, member.jwt)
    eqv(ok.status, 200, ok.text)
    const [row] = await rest('GET', `event_photos?id=eq.${v1}&select=drive_file_id`)
    eqv(row.drive_file_id, fileId, 'drive_file_id recorded')
  })
  await step('finish refuses a Drive file of a different size (an incomplete upload)', async () => {
    const half = google.newId('h')
    google.files.set(half, { id: half, name: 'h', mimeType: 'video/mp4', parents: [folder], appProperties: { jec_photo_id: v2 }, content: bytesOf(SIZE - 10), trashed: false, ownedByApp: true })
    eqv((await callUpload({ action: 'finish', photo_id: v2, file_id: half }, member.jwt)).status, 409, 'size mismatch')
    const [row] = await rest('GET', `event_photos?id=eq.${v2}&select=drive_file_id`)
    eqv(row.drive_file_id, null, 'nothing recorded')
  })

  // ================================================================ drive-media for event videos
  await step('drive-media: the owner streams the whole video with the right headers', async () => {
    const r = await media({ k: 'event', id: v1, t: member.jwt })
    eqv(r.status, 200, 'status')
    eqv(r.headers.get('Content-Type'), 'video/mp4', 'type from the database, not Drive')
    eqv(r.headers.get('Accept-Ranges'), 'bytes', 'ranges advertised')
    eqv(r.headers.get('Cache-Control'), 'private, max-age=3600', 'private caching')
    eqv(r.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'CORS for the app')
    eqv(r.body.length, SIZE, 'all bytes')
    eqv(r.body.slice(0, 50), content.slice(0, 50), 'same bytes')
  })
  await step('drive-media: Range requests give 206 with Content-Range (seeking), suffix and open-ended ranges work, bad ones give 416', async () => {
    const a = await media({ k: 'event', id: v1, t: member.jwt }, { range: 'bytes=100-199' })
    eqv(a.status, 206, 'partial')
    eqv(a.headers.get('Content-Range'), `bytes 100-199/${SIZE}`, 'content-range')
    eqv(a.headers.get('Content-Length'), '100', 'length')
    eqv(a.body, content.slice(100, 200), 'the right slice')
    const b = await media({ k: 'event', id: v1, t: member.jwt }, { range: `bytes=${SIZE - 5}-` })
    eqv(b.status, 206, 'open ended')
    eqv(b.body, content.slice(SIZE - 5), 'tail')
    const c = await media({ k: 'event', id: v1, t: member.jwt }, { range: 'bytes=-10' })
    eqv(c.body, content.slice(SIZE - 10), 'suffix')
    eqv((await media({ k: 'event', id: v1, t: member.jwt }, { range: `bytes=${SIZE + 50}-` })).status, 416, 'beyond the end')
    const head = await media({ k: 'event', id: v1, t: member.jwt }, { method: 'HEAD' })
    eqv(head.status, 200, 'HEAD')
    eqv(head.body.length, 0, 'no body')
  })
  await step('drive-media: other verified members may watch; strangers, anonymous visitors and forged tokens may not', async () => {
    eqv((await media({ k: 'event', id: v1, t: other.jwt })).status, 200, 'another verified member')
    eqv((await media({ k: 'event', id: v1, t: stranger.jwt })).status, 404, 'unverified and not registered')
    eqv((await media({ k: 'event', id: v1 })).status, 401, 'no token')
    eqv((await media({ k: 'event', id: v1, t: ANON })).status, 401, 'the anon key is not a member')
    eqv((await media({ k: 'event', id: v1, t: 'garbage' })).status, 401, 'garbage')
  })
  await step('drive-media: a hidden or pending video is invisible to other members but not to its owner; photos are never served', async () => {
    await rest('PATCH', `event_photos?id=eq.${v1}`, { is_hidden: true }, 'return=minimal')
    eqv((await media({ k: 'event', id: v1, t: other.jwt })).status, 404, 'hidden for others')
    eqv((await media({ k: 'event', id: v1, t: member.jwt })).status, 200, 'the owner still sees it')
    await rest('PATCH', `event_photos?id=eq.${v1}`, { is_hidden: false }, 'return=minimal')
    eqv((await media({ k: 'event', id: photo, t: member.jwt })).status, 404, 'a photo row is not a video')
  })
  await step('drive-media: bad requests', async () => {
    eqv((await media({ k: 'event', id: 'nope', t: member.jwt })).status, 404, 'not a uuid')
    eqv((await media({ k: 'nothing', id: v1, t: member.jwt })).status, 400, 'unknown kind')
    eqv((await media({ k: 'event', id: crypto.randomUUID(), t: member.jwt })).status, 404, 'unknown id')
    const res = await driveMedia(new Request(`http://fn/drive-media?k=event&id=${v1}&t=${member.jwt}`, { method: 'POST' }))
    eqv(res.status, 405, 'POST')
    const pre = await driveMedia(new Request('http://fn/drive-media', { method: 'OPTIONS', headers: { Origin: ORIGIN } }))
    eqv(pre.status, 200, 'preflight')
    assert((pre.headers.get('Access-Control-Allow-Headers') ?? '').includes('range'), 'Range allowed')
  })

  // ================================================================ gallery videos and glimpses (gallery_manage)
  const [gal] = await rest('POST', 'gallery_photos', { storage_path: `gallery/vv-${RUN}.vid`, thumb_path: `gallery/vv-${RUN}_t.webp`, media_kind: 'video', mime_type: 'video/mp4', size_bytes: 300_000, created_by: admin.id })
  createdRows.push({ table: 'gallery_photos', id: gal.id })
  const [gl] = await rest('POST', 'glimpses', { poster_path: `glimpses/vv-${RUN}_p.webp`, mime_type: 'video/mp4', size_bytes: 400_000, is_visible: true, sort_order: 99 })
  createdRows.push({ table: 'glimpses', id: gl.id })
  const glContent = bytesOf(400_000, 5)
  let glUrl = ''
  await step('gallery / glimpse start: a member is refused (403), the curator gets a link and the app makes the folders once', async () => {
    eqv((await callUpload({ action: 'start', kind: 'glimpse', id: gl.id, mime_type: 'video/mp4', size: 400_000 }, member.jwt)).status, 403, 'member')
    eqv((await callUpload({ action: 'start', kind: 'glimpse', id: gl.id, mime_type: 'video/mp4', size: 123 }, admin.jwt)).status, 400, 'size must match the saved glimpse')
    eqv((await callUpload({ action: 'start', kind: 'glimpse', id: crypto.randomUUID(), mime_type: 'video/mp4', size: 400_000 }, admin.jwt)).status, 404, 'unknown glimpse')
    const r = await callUpload({ action: 'start', kind: 'glimpse', id: gl.id, mime_type: 'video/mp4', size: 400_000 }, admin.jwt)
    eqv(r.status, 200, r.text)
    glUrl = r.json.upload_url as string
    const g2 = await callUpload({ action: 'start', kind: 'gallery', id: gal.id, mime_type: 'video/mp4', size: 300_000 }, admin.jwt)
    eqv(g2.status, 200, g2.text)
    eqv([...google.files.values()].filter((f) => f.name === 'JEC Alumni Connect - Glimpses').length, 1, 'one glimpses folder')
    const roots = await rest('GET', 'drive_roots?select=key')
    eqv(roots.map((x: { key: string }) => x.key).sort(), ['gallery', 'glimpses'], 'remembered')
    eqv((await callUpload({ action: 'start', kind: 'glimpse', id: gl.id, mime_type: 'video/mp4', size: 400_000 }, admin.jwt)).status, 200, 'again')
    eqv([...google.files.values()].filter((f) => f.name === 'JEC Alumni Connect - Glimpses').length, 1, 'still one folder')
  })
  await step('glimpse: not served until the clip has reached Drive; then anonymous visitors stream it with Range', async () => {
    eqv((await media({ k: 'glimpse', id: gl.id })).status, 404, 'no file yet')
    const sent = await putBytes(glUrl, glContent)
    eqv(sent.status, 200, 'sent')
    eqv((await callUpload({ action: 'finish', kind: 'glimpse', id: gl.id, file_id: 'abcdefghij12345' }, admin.jwt)).status, 502, 'unknown Drive file -> clear failure')
    eqv((await callUpload({ action: 'finish', kind: 'glimpse', id: gl.id, file_id: sent.json.id }, member.jwt)).status, 403, 'member cannot finish')
    eqv((await callUpload({ action: 'finish', kind: 'glimpse', id: gl.id, file_id: sent.json.id }, admin.jwt)).status, 200, 'finish')
    const all = await media({ k: 'glimpse', id: gl.id })
    eqv(all.status, 200, 'anonymous: no token needed')
    eqv(all.headers.get('Cache-Control'), 'public, max-age=86400', 'public caching')
    eqv(all.body.length, 400_000, 'all bytes')
    const part = await media({ k: 'glimpse', id: gl.id }, { range: 'bytes=1000-1999' })
    eqv(part.status, 206, 'range')
    eqv(part.body, glContent.slice(1000, 2000), 'slice')
    eqv(part.headers.get('Content-Range'), 'bytes 1000-1999/400000', 'content-range')
  })
  await step('glimpse: hidden ones are never served to anyone, and the token is ignored for glimpses', async () => {
    await rest('PATCH', `glimpses?id=eq.${gl.id}`, { is_visible: false }, 'return=minimal')
    eqv((await media({ k: 'glimpse', id: gl.id })).status, 404, 'anonymous')
    eqv((await media({ k: 'glimpse', id: gl.id, t: admin.jwt })).status, 404, 'even with a token')
    await rest('PATCH', `glimpses?id=eq.${gl.id}`, { is_visible: true }, 'return=minimal')
    eqv((await media({ k: 'glimpse', id: gl.id })).status, 200, 'visible again')
    eqv((await media({ k: 'glimpse', id: v1 })).status, 404, 'an event video id is not a glimpse')
  })
  await step('gallery video: finish, then verified members stream it; anonymous visitors and strangers cannot', async () => {
    const g = await callUpload({ action: 'start', kind: 'gallery', id: gal.id, mime_type: 'video/mp4', size: 300_000 }, admin.jwt)
    const sent = await putBytes(g.json.upload_url as string, bytesOf(300_000, 9))
    eqv((await media({ k: 'gallery', id: gal.id, t: member.jwt })).status, 404, 'not finished')
    eqv((await callUpload({ action: 'finish', kind: 'gallery', id: gal.id, file_id: sent.json.id }, admin.jwt)).status, 200, 'finish')
    eqv((await media({ k: 'gallery', id: gal.id, t: member.jwt })).status, 200, 'member')
    eqv((await media({ k: 'gallery', id: gal.id })).status, 401, 'anonymous')
    eqv((await media({ k: 'gallery', id: gal.id, t: stranger.jwt })).status, 404, 'unverified')
  })

  // ================================================================ a video that is already in Drive
  const REAL = google.newId('mine')
  const realBytes = bytesOf(250_000, 3)
  google.files.set(REAL, { id: REAL, name: 'night party.mp4', mimeType: 'video/mp4', parents: ['somewhere'], appProperties: {}, content: realBytes, trashed: false, ownedByApp: true })
  const HIDDEN = google.newId('priv')
  google.files.set(HIDDEN, { id: HIDDEN, name: 'private.mp4', mimeType: 'video/mp4', parents: ['somewhere'], appProperties: {}, content: bytesOf(1000), trashed: false, ownedByApp: false })
  const CSV = google.newId('csv')
  google.files.set(CSV, { id: CSV, name: 'members backup.csv', mimeType: 'text/csv', parents: [folder], appProperties: {}, content: new TextEncoder().encode('a,b'), trashed: false, ownedByApp: true })
  const BIN = google.newId('bin')
  google.files.set(BIN, { id: BIN, name: 'old.mp4', mimeType: 'video/mp4', parents: [folder], appProperties: {}, content: bytesOf(500), trashed: true, ownedByApp: true })
  await step('inspect: a pasted link or id of a video the app can open returns its type and size; members are refused', async () => {
    for (const ref of [REAL, `https://drive.google.com/file/d/${REAL}/view?usp=sharing`, `https://drive.google.com/open?id=${REAL}`]) {
      const r = await callUpload({ action: 'inspect', kind: 'glimpse', file_ref: ref }, admin.jwt)
      eqv(r.status, 200, r.text)
      eqv(r.json, { file_id: REAL, name: 'night party.mp4', mime_type: 'video/mp4', size_bytes: 250_000 }, 'details')
    }
    eqv((await callUpload({ action: 'inspect', kind: 'glimpse', file_ref: REAL }, member.jwt)).status, 403, 'member')
  })
  await step('inspect: folders, junk, files the app cannot open, bin, non-videos and too-large files are explained, not attached', async () => {
    const msg = async (ref: string, kind = 'glimpse') => callUpload({ action: 'inspect', kind, file_ref: ref }, admin.jwt)
    eqv((await msg('')).status, 400, 'empty')
    const folderLink = await msg(`https://drive.google.com/drive/folders/${folder}`)
    eqv(folderLink.status, 400, 'folder')
    assert(String(folderLink.json.error).includes('folder'), 'says folder')
    eqv((await msg('https://example.com/x')).status, 400, 'not Drive')
    const hidden = await msg(HIDDEN)
    eqv(hidden.status, 422, 'not visible to the app account')
    assert(String(hidden.json.error).includes('cannot open'), 'explains')
    eqv((await msg(CSV)).status, 422, 'a CSV is not a video')
    eqv((await msg(BIN)).status, 422, 'bin')
    const big = google.newId('big')
    google.files.set(big, { id: big, name: 'big.mp4', mimeType: 'video/mp4', parents: [], appProperties: {}, content: new Uint8Array(61 * 1024 * 1024), trashed: false, ownedByApp: true })
    eqv((await msg(big)).status, 422, 'over 60 MB as a glimpse')
    eqv((await msg(big, 'gallery')).status, 200, 'fine as a gallery video')
  })
  await step('attach: the row must match the file; then the clip plays from where it is (nothing copied)', async () => {
    const before = google.files.size
    const [g1] = await rest('POST', 'glimpses', { poster_path: `glimpses/at-${RUN}_p.webp`, mime_type: 'video/mp4', size_bytes: 250_000, is_visible: true, sort_order: 98 })
    createdRows.push({ table: 'glimpses', id: g1.id })
    const [g2] = await rest('POST', 'glimpses', { poster_path: `glimpses/at2-${RUN}_p.webp`, mime_type: 'video/mp4', size_bytes: 111, is_visible: true, sort_order: 97 })
    createdRows.push({ table: 'glimpses', id: g2.id })
    eqv((await callUpload({ action: 'attach', kind: 'glimpse', id: g2.id, file_ref: REAL }, admin.jwt)).status, 400, 'size differs from the row')
    eqv((await callUpload({ action: 'attach', kind: 'glimpse', id: g1.id, file_ref: HIDDEN }, admin.jwt)).status, 422, 'not accessible')
    eqv((await callUpload({ action: 'attach', kind: 'glimpse', id: g1.id, file_ref: CSV }, admin.jwt)).status, 422, 'not a video')
    eqv((await callUpload({ action: 'attach', kind: 'glimpse', id: g1.id, file_ref: REAL }, member.jwt)).status, 403, 'member')
    eqv((await media({ k: 'glimpse', id: g1.id })).status, 404, 'not attached yet')
    eqv((await callUpload({ action: 'attach', kind: 'glimpse', id: g1.id, file_ref: `https://drive.google.com/file/d/${REAL}/view` }, admin.jwt)).status, 200, 'attached')
    eqv(google.files.size, before, 'no copy was made in Drive')
    const seek = await media({ k: 'glimpse', id: g1.id }, { range: 'bytes=10-19' })
    eqv(seek.status, 206, 'plays with ranges')
    eqv(seek.body, realBytes.slice(10, 20), 'the original file\'s bytes')
    const [g3] = await rest('POST', 'gallery_photos', { storage_path: `gallery/at-${RUN}.vid`, thumb_path: `gallery/at-${RUN}_t.webp`, media_kind: 'video', mime_type: 'video/mp4', size_bytes: 250_000, created_by: admin.id })
    createdRows.push({ table: 'gallery_photos', id: g3.id })
    eqv((await callUpload({ action: 'attach', kind: 'gallery', id: g3.id, file_ref: REAL }, admin.jwt)).status, 200, 'gallery too')
    eqv((await media({ k: 'gallery', id: g3.id, t: member.jwt })).status, 200, 'a member plays it')
  })
  await step('without a Drive connection everything answers {skipped:true} or a clean 503', async () => {
    Deno.env.delete('GOOGLE_DRIVE_REFRESH_TOKEN')
    eqv((await callUpload({ action: 'inspect', kind: 'glimpse', file_ref: REAL }, admin.jwt)).json, { skipped: true }, 'inspect')
    eqv((await callUpload({ action: 'start', photo_id: v2, mime_type: 'video/mp4', size: SIZE }, member.jwt)).json, { skipped: true }, 'start')
    eqv((await media({ k: 'glimpse', id: gl.id })).status, 503, 'media')
    Deno.env.set('GOOGLE_DRIVE_REFRESH_TOKEN', CLIENT.refresh)
  })
} finally {
  try {
    for (const r of createdRows) await rest('DELETE', `${r.table}?id=eq.${r.id}`, undefined, 'return=minimal')
    await rest('DELETE', `event_photos?event_id=eq.${ev.id}`, undefined, 'return=minimal')
    await rest('DELETE', `events?slug=like.vidverify-*`, undefined, 'return=minimal')
    await rest('DELETE', 'drive_roots?key=in.(gallery,glimpses)', undefined, 'return=minimal')
    for (const u of [admin, member, other, stranger]) {
      const r = await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })
      await r.body?.cancel()
    }
    results.push('INFO  cleanup done')
  } catch (e) {
    results.push(`WARN  cleanup failed: ${(e as Error).message}`)
  }
  await google.stop()
  console.log(results.join('\n'))
  console.log(`\n${failures} failure(s)`)
}
Deno.exit(failures ? 1 : 0)
