import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { onboard, signInWithEmail, sql } from '../helpers'

// Real browser + REAL local edge runtime (drive-upload) + fake Google on :4545.
// Exercises: admin "Create the Drive folder" button, member photo upload in PhotosPage, the
// browser's cross-origin PUT of the ORIGINAL file to the resumable session URL, and "finish".
const API = 'http://127.0.0.1:54321'
const FAKE = 'http://127.0.0.1:4545'
const DIST = process.env.DRIVE_DIST!
const ORIGINAL = process.env.DRIVE_ORIGINAL! // a multi-MB JPEG
const run = Date.now().toString(36)
const memberEmail = `drv.member.${run}@example.com`
const adminEmail = `drv.admin.${run}@example.com`

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

async function serveDist(page: import('@playwright/test').Page) {
  await page.route('http://localhost:5173/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    let f = join(DIST, decodeURIComponent(p))
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html')
    await route.fulfill({ status: 200, body: readFileSync(f), headers: { 'Content-Type': types[extname(f)] ?? 'application/octet-stream' } })
  })
}

type FakeState = { tokenCalls: number; files: { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; size: number }[]; log: { method: string; path: string; origin: string | null }[] }
const fakeState = async () => (await (await fetch(`${FAKE}/__state`)).json()) as FakeState

test('admin creates the Drive folder; a member photo original lands in Drive and is bound to the photo', async ({ page, browser }) => {
  expect(DIST && existsSync(join(DIST, 'index.html')), 'DRIVE_DIST must point at a vite build').toBeTruthy()
  const meet = sql(`select id from public.events where slug = 'alumni-meet-2026'`)
  const hadFolder = sql(`select coalesce(drive_folder_id, '') from public.event_settings where event_id = '${meet}'`)
  expect(hadFolder, 'meet event must not have a Drive folder yet (test would overwrite it)').toBe('')

  try {
    // ---- admin creates the archive folder through the real UI
    const adminCtx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 } })
    const ap = await adminCtx.newPage()
    await serveDist(ap)
    await ap.goto('/signin')
    await signInWithEmail(ap, adminEmail)
    await onboard(ap, `Drive Admin ${run}`, '2004')
    await expect(ap).not.toHaveURL(/welcome/)
    sql(`update public.profiles set is_admin = true, verification = 'verified' where id = (select id from auth.users where email = '${adminEmail}')`)
    await ap.goto('/admin/events/alumni-meet-2026?tab=settings')
    const createBtn = ap.getByRole('button', { name: 'Create the Drive folder' })
    await createBtn.click()
    await expect(ap.getByText('Drive folder created')).toBeVisible()
    await expect(ap.getByRole('link', { name: 'Open the archive folder' })).toBeVisible()
    const folderId = sql(`select drive_folder_id from public.event_settings where event_id = '${meet}'`)
    let st = await fakeState()
    const root = st.files.find((f) => f.id === folderId)!
    expect(root.name).toBe('JEC Alumni Connect - JEC Alumni Meet 2026')
    expect(st.files.filter((f) => f.parents.includes(folderId)).map((f) => f.name).sort()).toEqual(['Backups', 'Now (at the meet)', 'Then (college days)'])
    await adminCtx.close()

    // ---- member uploads a photo in the app
    await serveDist(page)
    const consoleMsgs: string[] = []
    page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`))
    await page.goto('/signin')
    await signInWithEmail(page, memberEmail)
    await onboard(page, `Drive Member ${run}`, '2006')
    sql(`update public.profiles set verification = 'verified' where id = (select id from auth.users where email = '${memberEmail}')`)
    await page.goto('/meet/photos')
    await expect(page.getByRole('tab', { name: 'Then (college days)' })).toBeVisible()
    await page.locator('input[type=file]').first().setInputFiles(ORIGINAL)
    await expect(page.getByText(/photo.? added/)).toBeVisible({ timeout: 60_000 })

    const uid = sql(`select id from auth.users where email = '${memberEmail}'`)
    await expect.poll(() => sql(`select coalesce(drive_file_id, '') from public.event_photos where uploaded_by = '${uid}'`), { timeout: 60_000 }).not.toBe('')
    const [photoId, driveId] = sql(`select id || '|' || drive_file_id from public.event_photos where uploaded_by = '${uid}'`).split('|')
    st = await fakeState()
    const f = st.files.find((x) => x.id === driveId)!
    const then = st.files.find((x) => x.name === 'Then (college days)' && x.parents.includes(folderId))!
    expect(f.parents).toEqual([then.id])
    expect(f.appProperties).toEqual({ jec_photo_id: photoId })
    expect(f.size).toBe(statSync(ORIGINAL).size) // the ORIGINAL bytes, not the compressed copy
    expect(f.mimeType).toBe('image/jpeg')
    expect(f.name).toBe(`Drive Member ${run} 2006 - ${photoId!.slice(0, 8)}.jpg`)
    const put = st.log.find((l) => l.method === 'PUT' && l.path.startsWith('/upload-session/'))!
    expect(put.origin).toBe('http://localhost:5173')
    expect(st.log.some((l) => l.method === 'OPTIONS' && l.path.startsWith('/upload-session/'))).toBe(true) // real CORS preflight happened
    expect(consoleMsgs.filter((m) => m.includes('not archived'))).toEqual([])
    console.log(`fake Google token refreshes: ${st.tokenCalls}; requests: ${st.log.map((l) => `${l.method} ${l.path.split('?')[0]}`).join(', ')}`)
  } finally {
    // ---- cleanup
    const ids = sql(`select string_agg(id::text, ',') from auth.users where email in ('${memberEmail}', '${adminEmail}')`)
    if (ids) {
      const paths = sql(`select coalesce(string_agg(storage_path || ',' || thumb_path, ','), '') from public.event_photos where uploaded_by::text = any(string_to_array('${ids}', ','))`)
      if (paths) {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (key) await fetch(`${API}/storage/v1/object/event-photos`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths.split(',') }) })
      }
      sql(`delete from public.event_photos where uploaded_by::text = any(string_to_array('${ids}', ','))`)
      sql(`delete from public.event_settings where event_id = '${meet}'`)
      sql(`delete from public.admin_audit where actor::text = any(string_to_array('${ids}', ','))`)
      sql(`delete from auth.users where id::text = any(string_to_array('${ids}', ','))`)
    }
  }
})
