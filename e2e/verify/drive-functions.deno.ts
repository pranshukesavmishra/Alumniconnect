// Verifies supabase/functions/drive-upload and nightly-backup END TO END against the real local
// Supabase stack (GoTrue + PostgREST + Postgres with all migrations) and a strict fake Google
// (e2e/verify/drive-fake-google.ts) reached through the GOOGLE_*_URL overrides in _shared/google.ts.
//
// Run (needs `npx supabase start` and Deno 2):
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... deno test -A e2e/verify/drive-functions.deno.ts
// It creates its own users / event / rows (prefix "drvverify") and deletes them afterwards.
import { CLIENT, FakeGoogle, parseCsv } from './drive-fake-google.ts'

const SUPA = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321'
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ORIGIN = 'http://localhost:5184'
const FAKE_PORT = 18990
const RUN = crypto.randomUUID().slice(0, 8)

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}
function eqv(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`)
}

// ------------------------------------------------------------------ fake Google + env, BEFORE importing functions
const google = new FakeGoogle().start(FAKE_PORT)
Deno.env.set('SUPABASE_URL', SUPA)
Deno.env.set('SUPABASE_ANON_KEY', ANON)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
Deno.env.set('GOOGLE_OAUTH_URL', `${google.base}/token`)
Deno.env.set('GOOGLE_API_URL', `${google.base}/drive/v3`)
Deno.env.set('GOOGLE_UPLOAD_URL', `${google.base}/upload/drive/v3`)
Deno.env.set('APP_ORIGINS', `${ORIGIN},https://alumni.example.org`)
Deno.env.set('BACKUP_SECRET', 's3cret-' + RUN)
const setDrive = (on: boolean) => {
  if (on) {
    Deno.env.set('GOOGLE_CLIENT_ID', CLIENT.id)
    Deno.env.set('GOOGLE_CLIENT_SECRET', CLIENT.secret)
    Deno.env.set('GOOGLE_DRIVE_REFRESH_TOKEN', CLIENT.refresh)
  } else Deno.env.delete('GOOGLE_DRIVE_REFRESH_TOKEN')
}

// Capture Deno.serve handlers instead of binding ports.
type Handler = (r: Request) => Response | Promise<Response>
const handlers: Handler[] = []
const realServe = Deno.serve
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (a: unknown, b?: unknown) => {
  handlers.push((typeof a === 'function' ? a : b) as Handler)
  return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'x', port: 0, transport: 'tcp' } }
}
const consoleErrors: unknown[][] = []
const origError = console.error
console.error = (...a: unknown[]) => { consoleErrors.push(a); }
await import('../../supabase/functions/drive-upload/index.ts')
await import('../../supabase/functions/nightly-backup/index.ts')
;(Deno as unknown as { serve: typeof realServe }).serve = realServe
const [driveUpload, nightly] = handlers as [Handler, Handler]

// ------------------------------------------------------------------ Supabase helpers
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
async function makeUser(tag: string): Promise<{ id: string; jwt: string; email: string }> {
  const email = `drvverify-${tag}-${RUN}@example.com`
  const password = `pw-${crypto.randomUUID()}`
  const r = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Drv ${tag} "O'Neil" /x` } }),
  })
  const u = await r.json()
  assert(r.ok, `create user ${JSON.stringify(u)}`)
  const t = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const tj = await t.json()
  assert(t.ok, `sign in ${JSON.stringify(tj)}`)
  return { id: u.id, jwt: tj.access_token, email }
}
async function callDrive(body: unknown, opts: { jwt?: string; origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN
  const res = await driveUpload(new Request('http://fn/drive-upload', { method: opts.method ?? 'POST', headers, body: opts.method === 'GET' || opts.method === 'OPTIONS' ? undefined : JSON.stringify(body) }))
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers }
}
async function callNightly(secret?: string) {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers['x-backup-secret'] = secret
  const res = await nightly(new Request('http://fn/nightly-backup', { method: 'POST', headers }))
  return { status: res.status, text: await res.text() }
}

// ------------------------------------------------------------------ fixtures
const admin = await makeUser('admin')
const member = await makeUser('member')
const other = await makeUser('other')
await rest('PATCH', `profiles?id=eq.${admin.id}`, { is_admin: true, verification: 'verified' })
await rest('PATCH', `profiles?id=eq.${member.id}`, { grad_year: 2005, full_name: `Asha "Rao" / O'Neil` })
const [ev] = await rest('POST', 'events', { slug: `drvverify-${RUN}`, title: `Drive "Verify" O'Brien \\ Meet / 2026: <test>`, is_published: false })
const [ev2] = await rest('POST', 'events', { slug: `drvverify2-${RUN}`, title: 'Drive verify no-folder event', is_published: false })
const mkPhoto = async (owner: string, kind: string, n: number) =>
  (await rest('POST', 'event_photos', { event_id: ev.id, uploaded_by: owner, storage_path: `${owner}/drv-${RUN}-${n}.webp`, thumb_path: `${owner}/drv-${RUN}-${n}-t.webp`, kind }))[0].id as string
const photoEvent = await mkPhoto(member.id, 'event', 1)
const photoThrowback = await mkPhoto(member.id, 'throwback', 2)
const photoOther = await mkPhoto(other.id, 'event', 3)
const [tt] = await rest('POST', 'event_ticket_types', { event_id: ev.id, label: 'Alumnus, "plus" =1', price_paise: 150000, is_primary: true })
const [reg] = await rest('POST', 'event_registrations', {
  event_id: ev.id, user_id: member.id, code: `DRV-${RUN}`, full_name: `Asha "Rao", O'Neil`, phone: '+919800000000', city: '-2+3',
  notes: '=HYPERLINK("http://evil.example","click")', admin_note: "+cmd|' /C calc'!A0", arrival_note: '@SUM(1)\r\nnext, "line"\nतस्वीर 🎉',
  guests: [{ name: 'Guest, "One"' }], amount_paise: 150000, headcount: 1,
})
const [reg2] = await rest('POST', 'event_registrations', { event_id: ev.id, user_id: other.id, code: `DRV2-${RUN}`, full_name: '\tTabbed =1+1', phone: '1' })
await rest('POST', 'event_registration_items', { registration_id: reg.id, ticket_type_id: tt.id, label: tt.label, unit_price_paise: 150000, quantity: 1 })
await rest('POST', 'event_payments', { registration_id: reg.id, amount_paise: 150000, method: 'upi', utr: String(Date.now()).padStart(12, '7').slice(-12), payer_name: '=1+2' })

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

try {
  // ================================================================ drive-upload
  setDrive(true)
  await step('OPTIONS preflight answers with CORS for an allowed origin', async () => {
    const r = await callDrive(undefined, { method: 'OPTIONS' })
    eqv(r.status, 200, 'status')
    eqv(r.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'ACAO')
  })
  await step('GET is rejected (405)', async () => {
    const r = await callDrive(undefined, { method: 'GET', jwt: member.jwt })
    eqv(r.status, 405, 'status')
  })
  await step('no JWT -> 401', async () => {
    const r = await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 })
    eqv(r.status, 401, 'status')
  })
  await step('forged/garbage JWT -> 401', async () => {
    const r = await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 }, { jwt: ANON })
    eqv(r.status, 401, 'status')
  })
  await step('start before the archive folder exists -> {skipped:true}', async () => {
    const r = await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt })
    eqv(r.json, { skipped: true }, 'body')
  })
  await step('create_root by a NON-admin -> 403, nothing created in Drive', async () => {
    const before = google.files.size
    const r = await callDrive({ action: 'create_root', event_id: ev.id }, { jwt: member.jwt })
    eqv(r.status, 403, 'status')
    eqv(google.files.size, before, 'no Drive files created')
    const s = await rest('GET', `event_settings?event_id=eq.${ev.id}`)
    eqv(s.length, 0, 'no event_settings row')
  })
  await step('create_root by admin while Drive NOT configured -> {skipped:true}', async () => {
    setDrive(false)
    const r = await callDrive({ action: 'create_root', event_id: ev.id }, { jwt: admin.jwt })
    setDrive(true)
    eqv(r.json, { skipped: true }, 'body')
  })
  await step('create_root by admin: bad / unknown event id -> 404', async () => {
    eqv((await callDrive({ action: 'create_root', event_id: 'nope' }, { jwt: admin.jwt })).status, 404, 'bad id')
    eqv((await callDrive({ action: 'create_root', event_id: crypto.randomUUID() }, { jwt: admin.jwt })).status, 404, 'unknown id')
  })
  let rootId = ''
  await step('create_root by admin creates "JEC Alumni Connect - <title>" + Then/Now/Backups and stores it', async () => {
    const r = await callDrive({ action: 'create_root', event_id: ev.id }, { jwt: admin.jwt })
    eqv(r.status, 200, `status ${r.text}`)
    rootId = r.json.folder_id as string
    const root = google.files.get(rootId)!
    assert(root, 'root folder exists in fake Drive')
    eqv(root.mimeType, 'application/vnd.google-apps.folder', 'folder mime')
    eqv(root.name, `JEC Alumni Connect - Drive Verify O'Brien  Meet  2026 test`, 'root name (illegal chars stripped)')
    eqv(root.parents, ['root-of-my-drive'], 'created in My Drive root (no parents sent)')
    const kids = [...google.files.values()].filter((f) => f.parents.includes(rootId)).map((f) => `${f.name}|${f.mimeType}`).sort()
    eqv(kids, ['Backups|application/vnd.google-apps.folder', 'Now (at the meet)|application/vnd.google-apps.folder', 'Then (college days)|application/vnd.google-apps.folder'], 'subfolders')
    const [s] = await rest('GET', `event_settings?event_id=eq.${ev.id}&select=drive_folder_id`)
    eqv(s.drive_folder_id, rootId, 'stored in event_settings')
    // The DB check constraint ^[A-Za-z0-9_-]{10,200}$ accepted the id
  })
  await step('create_root is idempotent (second call returns same folder, creates nothing)', async () => {
    const before = google.files.size
    const r = await callDrive({ action: 'create_root', event_id: ev.id }, { jwt: admin.jwt })
    eqv(r.json.folder_id, rootId, 'same id')
    eqv(google.files.size, before, 'nothing new')
  })
  await step('event_settings (drive folder id) is NOT readable by a normal member through RLS', async () => {
    const res = await fetch(`${SUPA}/rest/v1/event_settings?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${member.jwt}` } })
    const rows = await res.json()
    assert(!res.ok || (Array.isArray(rows) && rows.length === 0), `member can read event_settings: ${JSON.stringify(rows)}`)
  })

  await step('start: Origin missing -> 403; disallowed Origin -> 403', async () => {
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt, origin: null })).status, 403, 'missing')
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt, origin: 'https://evil.example' })).status, 403, 'evil')
  })
  await step('start: non-image mime -> 400; size 0 / >40MB / missing -> 400', async () => {
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/gif', size: 10 }, { jwt: member.jwt })).status, 400, 'gif')
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'text/html', size: 10 }, { jwt: member.jwt })).status, 400, 'html')
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 0 }, { jwt: member.jwt })).status, 400, 'size 0')
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 40 * 1024 * 1024 + 1 }, { jwt: member.jwt })).status, 400, '>40MB')
    eqv((await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg' }, { jwt: member.jwt })).status, 400, 'no size')
  })
  await step("start on SOMEONE ELSE's photo -> 404 (no Drive session)", async () => {
    const before = google.sessions.size
    eqv((await callDrive({ action: 'start', photo_id: photoOther, mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt })).status, 404, 'status')
    eqv((await callDrive({ action: 'start', photo_id: 'x', mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt })).status, 404, 'bad id')
    eqv(google.sessions.size, before, 'no session')
  })

  const bytes = crypto.getRandomValues(new Uint8Array(54321))
  let uploadUrl = ''
  await step('start (event photo): resumable session with correct headers, parent=Now, appProperties binding', async () => {
    const r = await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: bytes.length }, { jwt: member.jwt })
    eqv(r.status, 200, `status ${r.text}`)
    uploadUrl = r.json.upload_url as string
    assert(uploadUrl?.startsWith(`${google.base}/upload-session/`), 'upload_url is the Location header')
    const init = google.log.filter((l) => l.path.startsWith('/upload/drive/v3/files?uploadType=resumable')).at(-1)!
    eqv(init.headers['x-upload-content-type'], 'image/jpeg', 'X-Upload-Content-Type')
    eqv(init.headers['x-upload-content-length'], String(bytes.length), 'X-Upload-Content-Length')
    eqv(init.headers['origin'], ORIGIN, 'Origin forwarded (needed for Google CORS on the session URI)')
    const meta = JSON.parse(init.body!)
    const now = [...google.files.values()].find((f) => f.name === 'Now (at the meet)' && f.parents.includes(rootId))!
    eqv(meta.parents, [now.id], 'parent = Now folder (reused, not duplicated)')
    eqv(meta.appProperties, { jec_photo_id: photoEvent }, 'appProperties binding')
    eqv(meta.name, `Asha Rao  O'Neil 2005 - ${photoEvent.slice(0, 8)}.jpg`, 'file name')
    assert(String(meta.description).includes('Drive "Verify"'), 'description mentions event')
    const nowFolders = [...google.files.values()].filter((f) => f.name === 'Now (at the meet)')
    eqv(nowFolders.length, 1, 'no duplicate Now folder')
  })
  await step('start (throwback photo): parent=Then folder, extension mapping png', async () => {
    const r = await callDrive({ action: 'start', photo_id: photoThrowback, mime_type: 'image/png', size: 5 }, { jwt: member.jwt })
    eqv(r.status, 200, r.text)
    const init = google.log.filter((l) => l.path.startsWith('/upload/drive/v3/files?uploadType=resumable')).at(-1)!
    const meta = JSON.parse(init.body!)
    const then = [...google.files.values()].find((f) => f.name === 'Then (college days)')!
    eqv(meta.parents, [then.id], 'parent = Then')
    assert(meta.name.endsWith('.png'), 'png ext')
  })

  let uploadedId = ''
  await step('browser leg: CORS preflight + PUT to session URI (as PhotosPage.tsx does) returns {id}', async () => {
    const pre = await fetch(uploadUrl, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } })
    await pre.body?.cancel()
    eqv(pre.status, 200, 'preflight')
    eqv(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'preflight ACAO')
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Origin: ORIGIN }, body: bytes })
    const j = await put.json()
    eqv(put.status, 200, `put ${JSON.stringify(j)}`)
    uploadedId = j.id
    eqv(Object.keys(j), ['id'], 'fields=id honoured')
    const f = google.files.get(uploadedId)!
    eqv(f.content?.length, bytes.length, 'bytes stored')
    eqv(f.appProperties, { jec_photo_id: photoEvent }, 'file carries binding')
  })
  await step('finish: wrong-format file id -> 400', async () => {
    eqv((await callDrive({ action: 'finish', photo_id: photoEvent, file_id: '../../x' }, { jwt: member.jwt })).status, 400, 'bad chars')
    eqv((await callDrive({ action: 'finish', photo_id: photoEvent }, { jwt: member.jwt })).status, 400, 'missing')
  })
  await step('finish: FORGED id = a real app file bound to a DIFFERENT photo -> 400, DB untouched', async () => {
    // a file the app created for the throwback photo
    const s = await callDrive({ action: 'start', photo_id: photoThrowback, mime_type: 'image/jpeg', size: 3 }, { jwt: member.jwt })
    const put = await fetch(s.json.upload_url as string, { method: 'PUT', headers: { Origin: ORIGIN }, body: new Uint8Array([1, 2, 3]) })
    const otherFile = (await put.json()).id
    const r = await callDrive({ action: 'finish', photo_id: photoEvent, file_id: otherFile }, { jwt: member.jwt })
    eqv(r.status, 400, `status ${r.text}`)
    eqv(r.json.error, 'File does not belong to this photo', 'message')
    const [p] = await rest('GET', `event_photos?id=eq.${photoEvent}&select=drive_file_id`)
    eqv(p.drive_file_id, null, 'not recorded')
  })
  await step('finish: FORGED id = folder id / unknown id / file not created by the app (drive.file 404)', async () => {
    google.files.set('foreignFile_abcdef123', { id: 'foreignFile_abcdef123', name: 'x', mimeType: 'image/jpeg', parents: [], appProperties: { jec_photo_id: photoEvent }, trashed: false, ownedByApp: false })
    const a = await callDrive({ action: 'finish', photo_id: photoEvent, file_id: rootId }, { jwt: member.jwt })
    eqv(a.status, 400, 'folder id rejected')
    const b = await callDrive({ action: 'finish', photo_id: photoEvent, file_id: 'doesNotExist_123456' }, { jwt: member.jwt })
    assert(b.status >= 400, `unknown id rejected (got ${b.status})`)
    const c = await callDrive({ action: 'finish', photo_id: photoEvent, file_id: 'foreignFile_abcdef123' }, { jwt: member.jwt })
    assert(c.status >= 400, `foreign id rejected (got ${c.status})`)
    const [p] = await rest('GET', `event_photos?id=eq.${photoEvent}&select=drive_file_id`)
    eqv(p.drive_file_id, null, 'not recorded')
  })
  await step("finish by a member who does NOT own the photo -> 404", async () => {
    eqv((await callDrive({ action: 'finish', photo_id: photoEvent, file_id: uploadedId }, { jwt: other.jwt })).status, 404, 'status')
  })
  await step('finish: genuine file -> {ok:true}, drive_file_id recorded', async () => {
    const r = await callDrive({ action: 'finish', photo_id: photoEvent, file_id: uploadedId }, { jwt: member.jwt })
    eqv(r.json, { ok: true }, r.text)
    const [p] = await rest('GET', `event_photos?id=eq.${photoEvent}&select=drive_file_id`)
    eqv(p.drive_file_id, uploadedId, 'recorded')
  })
  await step('member cannot write drive_file_id directly through the API (column grant)', async () => {
    const res = await fetch(`${SUPA}/rest/v1/event_photos?id=eq.${photoThrowback}`, { method: 'PATCH', headers: { apikey: ANON, Authorization: `Bearer ${member.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ drive_file_id: 'forgedForged123' }) })
    await res.body?.cancel()
    assert(!res.ok, `direct PATCH allowed (${res.status})`)
  })
  await step('unknown action -> 400', async () => {
    eqv((await callDrive({ action: 'nuke', photo_id: photoEvent }, { jwt: member.jwt })).status, 400, 'status')
  })
  await step('OAuth access token is cached (one refresh for the whole run so far)', async () => {
    eqv(google.tokenCalls, 1, 'token calls')
  })
  await step('Drive not configured -> start returns {skipped:true}', async () => {
    setDrive(false)
    const r = await callDrive({ action: 'start', photo_id: photoEvent, mime_type: 'image/jpeg', size: 10 }, { jwt: member.jwt })
    setDrive(true)
    eqv(r.json, { skipped: true }, 'body')
  })

  // ================================================================ nightly-backup
  await step('nightly-backup: no header -> 403, wrong secret -> 403', async () => {
    eqv((await callNightly()).status, 403, 'none')
    eqv((await callNightly('wrong')).status, 403, 'wrong')
    eqv((await callNightly('')).status, 403, 'empty')
  })
  await step('nightly-backup: BACKUP_SECRET unset on server -> 403 even for empty/"undefined" header', async () => {
    const s = Deno.env.get('BACKUP_SECRET')!
    Deno.env.delete('BACKUP_SECRET')
    const a = await callNightly('')
    const b = await callNightly('undefined')
    const c = await callNightly()
    Deno.env.set('BACKUP_SECRET', s)
    eqv([a.status, b.status, c.status], [403, 403, 403], 'statuses')
  })
  await step('nightly-backup: Drive not configured -> keep-alive only, ok', async () => {
    setDrive(false)
    const r = await callNightly(Deno.env.get('BACKUP_SECRET')!)
    setDrive(true)
    eqv(r.status, 200, r.text)
    eqv(JSON.parse(r.text), { ok: true, backup: 'skipped (Drive not configured)' }, 'body')
  })
  let csvs: ReturnType<FakeGoogle['csvFiles']> = []
  // Other events in the DB may point at folders this Drive account cannot see (deleted/trashed folder,
  // a different Drive account, test data). One such event must not stop every other event's backup.
  const otherFolders: string[] = (await rest('GET', `event_settings?select=drive_folder_id&event_id=neq.${ev.id}&drive_folder_id=not.is.null`)).map((s: { drive_folder_id: string }) => s.drive_folder_id)
  const badId = 'deletedFolder_0123456789'
  const [evBad] = await rest('POST', 'events', { slug: `drvverify3-${RUN}`, title: 'Drive verify: folder deleted in Drive', is_published: false })
  await rest('POST', 'event_settings', { event_id: evBad.id, drive_folder_id: badId })
  await step('nightly-backup: an event whose Drive folder is gone does NOT block the other events (resilience)', async () => {
    const r = await callNightly(Deno.env.get('BACKUP_SECRET')!)
    const ours = google.csvFiles().filter((f) => f.name.startsWith(`drvverify-${RUN} `))
    assert(r.status === 200 && ours.length === 3, `status ${r.status}, our CSVs ${ours.length}; response: ${r.text.slice(0, 200)}`)
  })
  await rest('DELETE', `events?id=eq.${evBad.id}`, undefined, 'return=minimal')
  for (const f of google.csvFiles()) google.files.delete(f.id)
  for (const id of otherFolders) google.files.set(id, { id, name: 'other event root (registered so the run can complete)', mimeType: 'application/vnd.google-apps.folder', parents: [], appProperties: {}, trashed: false, ownedByApp: true })
  await step('nightly-backup: uploads registrations/payments/tickets CSV into the event Backups folder', async () => {
    const r = await callNightly(Deno.env.get('BACKUP_SECRET')!)
    eqv(r.status, 200, r.text)
    const body = JSON.parse(r.text)
    assert(body.backup.includes(`drvverify-${RUN}: 2 registrations, 1 payments`), `summary ${r.text}`)
    assert(!body.backup.some((s: string) => s.startsWith(`drvverify2-${RUN}`)), 'event without folder skipped')
    const backups = [...google.files.values()].find((f) => f.name === 'Backups' && f.parents.includes(rootId))!
    csvs = google.csvFiles().filter((f) => f.parents.includes(backups.id))
    eqv(csvs.length, 3, 'three CSVs')
    for (const k of ['registrations', 'payments', 'tickets']) assert(csvs.some((f) => new RegExp(`^drvverify-${RUN} ${k} \\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}\\.csv$`).test(f.name)), `${k} file name`)
    eqv([...google.files.values()].filter((f) => f.name === 'Backups' && f.parents.includes(rootId)).length, 1, 'Backups folder reused')
  })
  const td = new TextDecoder('utf-8', { ignoreBOM: true })
  const cellOf = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /^[=+\-@]/.test(s) ? `'${s}` : s
  }
  await step('CSV registrations: BOM, header = all columns, every cell round-trips (quotes, commas, CRLF, unicode)', async () => {
    const f = csvs.find((x) => x.name.includes(' registrations '))!
    const raw = td.decode(f.content!)
    assert(raw.startsWith('﻿'), 'BOM')
    const rows = parseCsv(raw.slice(1))
    const db = await rest('GET', `event_registrations?select=*&event_id=eq.${ev.id}&order=created_at`)
    eqv(rows[0], Object.keys(db[0]), 'header')
    eqv(rows.length, db.length + 1, 'row count')
    for (let i = 0; i < db.length; i++) eqv(rows[i + 1], Object.keys(db[0]).map((c) => cellOf(db[i][c])), `row ${i}`)
  })
  await step('CSV formula-injection neutralised (=, +, -, @ get a leading apostrophe)', async () => {
    const f = csvs.find((x) => x.name.includes(' registrations '))!
    const rows = parseCsv(td.decode(f.content!).slice(1))
    const h = rows[0]!
    const r = rows.find((x) => x[h.indexOf('id')] === reg.id)!
    eqv(r[h.indexOf('notes')], `'=HYPERLINK("http://evil.example","click")`, 'notes')
    eqv(r[h.indexOf('admin_note')], `'+cmd|' /C calc'!A0`, 'admin_note')
    eqv(r[h.indexOf('city')], `'-2+3`, 'city')
    assert(r[h.indexOf('arrival_note')]!.startsWith(`'@SUM(1)`), 'arrival_note')
  })
  await step('CSV: leading TAB / CR formula vector (OWASP) is also neutralised', async () => {
    const f = csvs.find((x) => x.name.includes(' registrations '))!
    const rows = parseCsv(td.decode(f.content!).slice(1))
    const h = rows[0]!
    const r = rows.find((x) => x[h.indexOf('id')] === reg2.id)!
    eqv(r[h.indexOf('full_name')], `'\tTabbed =1+1`, 'tab-prefixed value')
  })
  await step('CSV payments: only this event, no embedded event_registrations column, values match', async () => {
    const f = csvs.find((x) => x.name.includes(' payments '))!
    const rows = parseCsv(td.decode(f.content!).slice(1))
    const db = await rest('GET', `event_payments?select=*&registration_id=eq.${reg.id}`)
    eqv(rows[0], Object.keys(db[0]), 'header (no event_registrations)')
    eqv(rows.length, 2, 'one payment row')
    eqv(rows[1], Object.keys(db[0]).map((c) => cellOf(db[0][c])), 'row')
  })
  await step('CSV tickets: items for this event, values match', async () => {
    const f = csvs.find((x) => x.name.includes(' tickets '))!
    const rows = parseCsv(td.decode(f.content!).slice(1))
    const db = await rest('GET', `event_registration_items?select=*&registration_id=eq.${reg.id}`)
    eqv(rows[0], Object.keys(db[0]), 'header')
    eqv(rows.slice(1), db.map((d: Record<string, unknown>) => Object.keys(db[0]).map((c) => cellOf(d[c]))), 'rows')
  })
  await step('multipart upload body is well-formed (metadata JSON + text/csv part, closing boundary)', async () => {
    const m = google.log.filter((l) => l.path.includes('uploadType=multipart') && (l.body ?? '').includes(`drvverify-${RUN} `))
    eqv(m.length, 3, 'three multipart requests')
  })
  await step('Google token refresh failure -> nightly-backup 502 with readable message (no secrets in it)', async () => {
    // fresh process state is not possible here (token cached), so revoke at the fake and expire validity
    google.validTokens.clear()
    const r = await callNightly(Deno.env.get('BACKUP_SECRET')!)
    eqv(r.status, 502, r.text)
    assert(!r.text.includes(CLIENT.secret) && !r.text.includes(CLIENT.refresh), 'no secret leaked')
    results.push(`INFO  token-revoked nightly response: ${r.text.slice(0, 160)}`)
  })
} finally {
  console.error = origError
  results.push(`INFO  console.error calls from functions: ${consoleErrors.length} ${consoleErrors.map((a) => String(a[0]).slice(0, 120)).join(' | ')}`)
  // ------------------------------------------------------------------ cleanup
  try {
    await rest('DELETE', `event_registrations?code=like.*${RUN}`, undefined, 'return=minimal')
    await rest('DELETE', `event_photos?event_id=eq.${ev.id}`, undefined, 'return=minimal')
    await rest('DELETE', `events?slug=like.*${RUN}`, undefined, 'return=minimal')
    for (const u of [admin, member, other]) {
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
