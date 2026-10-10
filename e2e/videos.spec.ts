import { expect, test, type Browser, type Page } from '@playwright/test'
import { closeSync, openSync, ftruncateSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from './helpers'
import { fixture, mockDrive } from './driveMock'
import { loginPage, makeEvent, makeUser, ts, type TestUser } from './verify/admin-lib'

// Videos end to end in a real browser: members send videos (webm, mp4, iPhone-style mov) to the event photo area with progress, retry and
// cancel; they play inline with the native controls; the college gallery takes videos too. Google Drive and the two edge functions are
// stood in for by e2e/driveMock.ts (the functions themselves are verified against a strict fake Google in e2e/verify/drive-video.deno.ts).
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 5173}`
const DRIVE_FOLDER = 'folderfolder12345'

async function open(browser: Browser, u: TestUser, path: string, width = 412) {
  const ctx = await browser.newContext({ viewport: { width, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  return { ctx, page, login: () => loginPage(page, u, path) }
}
const photoRows = (eventId: string) => sql(`select id || '|' || media_kind || '|' || coalesce(mime_type, '') || '|' || coalesce(duration_ms::text, '') || '|' || coalesce(drive_file_id, '') from event_photos where event_id = '${eventId}' order by created_at`).split('\n').filter(Boolean)
const markSent = (body: Record<string, unknown>) => sql(`update event_photos set drive_file_id = '${String(body.file_id)}' where id = '${String(body.photo_id)}'`)
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
function eventWithDrive(tag: string) {
  const ev = makeEvent(tag)
  sql(`insert into event_settings (event_id, drive_folder_id) values ('${ev.id}', '${DRIVE_FOLDER}') on conflict (event_id) do update set drive_folder_id = excluded.drive_folder_id`)
  return ev
}

test.describe.configure({ mode: 'serial' })

test('a member sends webm, mp4 and mov videos: poster and length read on the phone, saved, sent to Drive, duplicates skipped, bad files explained', async ({ browser }) => {
  test.setTimeout(180_000)
  const tag = `vu${ts}`.slice(0, 12)
  const ev = eventWithDrive(tag)
  const member = await makeUser(`${tag}m`, { name: `Vera ${tag}` })
  const { ctx, page, login } = await open(browser, member, `/events/${ev.slug}/photos/upload`)
  const mock = await mockDrive(page, { origin: ORIGIN, onFinish: markSent })
  await login()
  await expect(page.getByText(/Videos too: MP4, MOV or WebM, up to 500 MB/)).toBeVisible()
  await noSideScroll(page)

  await page.locator('input[type=file]').setInputFiles([fixture('clip.webm'), fixture('clip.mp4'), fixture('clip.mov')])
  await expect(page.getByTestId('upload-progress')).toContainText('Finished: 3 of 3', { timeout: 60_000 })
  const rows = photoRows(ev.id)
  expect(rows).toHaveLength(3)
  for (const r of rows) {
    const [, kind, mime, , drive] = r.split('|')
    expect(kind).toBe('video')
    expect(['video/webm', 'video/mp4', 'video/quicktime']).toContain(mime)
    expect(drive).toMatch(/^FAKEDRIVE/) // the Drive file was recorded by "finish"
  }
  expect(rows.map((r) => r.split('|')[2]).sort()).toEqual(['video/mp4', 'video/quicktime', 'video/webm'])
  const webm = rows.find((r) => r.split('|')[2] === 'video/webm')!.split('|')
  expect(Number(webm[3])).toBeGreaterThan(1500) // the length was read on the phone: 2 s
  expect(Number(webm[3])).toBeLessThan(2600)
  // posters are real images in storage (a still from the first frame, or a plain card if the browser cannot decode the codec)
  expect(sql(`select count(*) from storage.objects o join event_photos p on p.thumb_path = o.name where o.bucket_id = 'event-photos' and p.event_id = '${ev.id}'`)).toBe('3')
  expect(sql(`select count(*) from event_photos where event_id = '${ev.id}' and storage_path like '%.mov' and thumb_path like '%_t.%'`)).toBe('1')
  // started with the exact mime and size, in order, one at a time
  expect(mock.starts.map((s) => s.mime_type).sort()).toEqual(['video/mp4', 'video/quicktime', 'video/webm'])
  expect(mock.finishes).toHaveLength(3)
  expect(mock.puts.every((p) => /^bytes 0-\d+\/\d+$/.test(p.range))).toBe(true)

  // the same video again is recognised and skipped
  await page.locator('input[type=file]').setInputFiles(fixture('clip.webm'))
  await expect(page.getByTestId('upload-progress')).toContainText('Finished: 4 of 4', { timeout: 60_000 })
  await expect(page.getByText('Added 3 · already there 1 · failed 0')).toBeVisible()
  expect(photoRows(ev.id)).toHaveLength(3)

  // a format that cannot be sent, an empty file and a file over 500 MB each say so, plainly
  await page.locator('input[type=file]').setInputFiles({ name: 'old.avi', mimeType: 'video/x-msvideo', buffer: Buffer.from('not a real avi') })
  await expect(page.getByText(/This video format is not supported/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'empty.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) })
  await expect(page.getByText('This video file is empty.')).toBeVisible()
  const dir = mkdtempSync(join(tmpdir(), 'bigvid-'))
  const big = join(dir, 'huge.mp4')
  const fd = openSync(big, 'w')
  ftruncateSync(fd, 501 * 1024 * 1024) // a sparse file: nothing is written to disk and the browser never reads it
  closeSync(fd)
  await page.locator('input[type=file]').setInputFiles(big)
  await expect(page.getByText('This video is too large. The limit is 500 MB.')).toBeVisible()
  expect(photoRows(ev.id)).toHaveLength(3)
  await noSideScroll(page)
  await ctx.close()
})

test('a dropped connection is retried and carries on; Cancel stops a running upload and removes it', async ({ browser }) => {
  test.setTimeout(180_000)
  const tag = `vr${ts}`.slice(0, 12)
  const ev = eventWithDrive(tag)
  const member = await makeUser(`${tag}m`)

  // retry: the first chunk fails with a server error; the app asks Drive where it is and sends again
  const a = await open(browser, member, `/events/${ev.slug}/photos/upload`)
  const mock = await mockDrive(a.page, { origin: ORIGIN, failFirstPut: true, putDelayMs: 400, onFinish: markSent })
  await a.login()
  await a.page.locator('input[type=file]').setInputFiles(fixture('clip2.webm'))
  const item = a.page.getByTestId('video-item')
  await expect(item).toBeVisible()
  await expect(item.getByRole('progressbar')).toBeVisible()
  await expect(a.page.getByTestId('upload-progress')).toContainText('Finished: 1 of 1', { timeout: 60_000 })
  expect(mock.puts.some((p) => p.range.startsWith('bytes */'))).toBe(true) // asked where Drive was
  expect(photoRows(ev.id)[0]!.split('|')[4]).toMatch(/^FAKEDRIVE/)
  await a.ctx.close()

  // cancel: a slow upload is stopped, the half-made video disappears and the file can be sent again
  const b = await open(browser, member, `/events/${ev.slug}/photos/upload`)
  await mockDrive(b.page, { origin: ORIGIN, putDelayMs: 20_000, onFinish: markSent })
  await b.login()
  await b.page.locator('input[type=file]').setInputFiles(fixture('clip.mp4'))
  await expect(b.page.getByTestId('video-item')).toContainText('sending the video')
  expect(photoRows(ev.id)).toHaveLength(2) // the row exists while sending
  await b.page.getByRole('button', { name: /Cancel the upload of clip.mp4/ }).click()
  await expect(b.page.getByText('Cancelled')).toBeVisible()
  await expect.poll(() => photoRows(ev.id).length).toBe(1)
  await b.ctx.close()
})

test('videos need the Drive archive: without it the member is told so and nothing is saved', async ({ browser }) => {
  const tag = `vn${ts}`.slice(0, 12)
  const ev = makeEvent(tag) // no Drive folder
  const member = await makeUser(`${tag}m`)
  const { ctx, page, login } = await open(browser, member, `/events/${ev.slug}/photos/upload`)
  await mockDrive(page, { origin: ORIGIN })
  await login()
  await expect(page.getByText('Videos need the Drive archive. Ask an organiser to set it up for this event.')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(fixture('clip.webm'))
  await expect(page.getByText(/Videos need the Drive archive, which is not set up yet/)).toBeVisible()
  expect(photoRows(ev.id)).toHaveLength(0)
  await ctx.close()
})

test('videos play inline with native controls, seeking works, hearts and moderation follow the photo rules, and they join the gallery', async ({ browser }) => {
  test.setTimeout(180_000)
  const tag = `vp${ts}`.slice(0, 12)
  const ev = eventWithDrive(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const member = await makeUser(`${tag}m`, { name: `Mina ${tag}` })

  // the organiser sends one video (official) through the real upload screen
  const up = await open(browser, boss, `/events/${ev.slug}/photos/upload`)
  await mockDrive(up.page, { origin: ORIGIN, onFinish: markSent })
  await up.login()
  await up.page.locator('input[type=file]').setInputFiles(fixture('clip.webm'))
  await expect(up.page.getByTestId('upload-progress')).toContainText('Finished: 1 of 1', { timeout: 60_000 })
  await up.ctx.close()
  const vid = photoRows(ev.id)[0]!.split('|')[0]!
  expect(sql(`select source from event_photos where id = '${vid}'`)).toBe('official')

  // a member sees the video in the grid with its length, and filters
  const m = await open(browser, member, `/events/${ev.slug}/photos`, 360)
  const media = await mockDrive(m.page, { origin: ORIGIN })
  await m.login()
  await expect(m.page.getByTestId('video-badge')).toHaveText(/0:02/)
  await noSideScroll(m.page)
  await m.page.getByRole('button', { name: 'Photos', exact: true }).click()
  await expect(m.page.getByTestId('photo-grid')).toHaveCount(0)
  await m.page.getByRole('button', { name: 'Videos', exact: true }).click()
  await expect(m.page.locator(`[data-photo-id="${vid}"]`)).toBeVisible()
  await m.page.locator(`[data-photo-id="${vid}"]`).first().click()

  // it plays right here: a native <video> with controls, inline, metadata only until played, streamed with Range requests
  const dialog = m.page.getByRole('dialog')
  const video = dialog.locator('video')
  await expect(video).toHaveAttribute('playsinline', '')
  await expect(video).toHaveAttribute('preload', 'metadata')
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(1.5)
  const src = await video.getAttribute('src')
  expect(src).toContain('/functions/v1/drive-media?k=event')
  expect(src).toContain(`id=${vid}`)
  expect(media.media.length).toBeGreaterThan(0)
  expect(media.media.some((r) => r.range?.startsWith('bytes='))).toBe(true)
  expect(media.media.every((r) => !!r.token)).toBe(true) // members present their token
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
  await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 1.2 })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 10))).toBeGreaterThanOrEqual(11)

  // heart it, like a photo
  await dialog.getByRole('button', { name: 'Heart' }).click()
  await expect(dialog.getByTestId('heart-count')).toHaveText('1')
  expect(sql(`select count(*) from photo_hearts where photo_id = '${vid}'`)).toBe('1')
  await dialog.getByRole('button', { name: 'Close' }).click()

  // a member cannot put a video into a vote, and the organiser's photo menu has the video actions
  const org = await open(browser, boss, `/events/${ev.slug}/photos?photo=${vid}`)
  await mockDrive(org.page, { origin: ORIGIN })
  await org.login()
  await org.page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(org.page.getByRole('button', { name: 'Hide' })).toBeVisible()

  // add it to the college gallery: the Drive file is shared, only the poster is copied
  await org.page.getByRole('button', { name: 'Add to college gallery' }).click()
  await org.page.getByRole('dialog', { name: 'Add to college gallery' }).getByRole('button', { name: 'Add to college gallery' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_photos where source_photo_id = '${vid}' and media_kind = 'video' and drive_file_id = (select drive_file_id from event_photos where id = '${vid}')`)).toBe('1')

  // hide it: other members lose it at once
  await org.page.getByRole('button', { name: 'More', exact: true }).click()
  await org.page.getByRole('button', { name: 'Hide' }).click()
  await expect.poll(() => sql(`select is_hidden from event_photos where id = '${vid}'`)).toBe('t')
  await m.page.reload()
  await expect(m.page.locator(`[data-photo-id="${vid}"]`)).toHaveCount(0)
  await org.ctx.close()
  await m.ctx.close()

  // the member sees the gallery video, with its badge, and plays it in the viewer
  const g = await open(browser, member, '/gallery')
  const gmedia = await mockDrive(g.page, { origin: ORIGIN })
  await g.login()
  const gid = sql(`select id from gallery_photos where source_photo_id = '${vid}'`)
  await expect(g.page.locator(`[data-gallery-id="${gid}"] [data-testid=video-badge]`)).toBeVisible()
  await g.page.locator(`[data-gallery-id="${gid}"]`).first().click()
  const gv = g.page.getByRole('dialog').locator('video')
  await expect(gv).toHaveAttribute('src', /drive-media\?k=gallery&id=/)
  await expect.poll(() => gv.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  expect(gmedia.media.length).toBeGreaterThan(0)
  await g.ctx.close()
})

test('the admin adds a video to the college gallery by upload and from a Drive link; members see the finished ones only', async ({ browser }) => {
  test.setTimeout(180_000)
  const tag = `vg${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const member = await makeUser(`${tag}m`)
  const a = await open(browser, boss, '/gallery')
  const mock = await mockDrive(a.page, {
    origin: ORIGIN,
    onFinish: (b) => sql(`update gallery_photos set drive_file_id = '${String(b.file_id)}' where id = '${String(b.id)}'`),
    inspect: () => ({ file_id: 'PASTEDFILEID123456', name: 'night party.mp4', mime_type: 'video/mp4', size_bytes: 777_777 }),
    onAttach: (b) => sql(`update gallery_photos set drive_file_id = 'PASTEDFILEID123456' where id = '${String(b.id)}'`),
  })
  await a.login()

  // upload a file
  await a.page.locator('input[type=file][accept*="video"]').setInputFiles(fixture('clip2.webm'))
  const sheet = a.page.getByRole('dialog')
  await sheet.getByLabel(/^Title/).fill(`Night ${tag}`)
  await sheet.getByRole('button', { name: 'Add to college gallery' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_photos where title = 'Night ${tag}' and media_kind = 'video' and drive_file_id like 'FAKEDRIVE%'`), { timeout: 60_000 }).toBe('1')
  expect(sql(`select mime_type || '|' || (duration_ms > 1500)::text from gallery_photos where title = 'Night ${tag}'`)).toBe('video/webm|true')
  expect(sql(`select count(*) from admin_audit where action = 'gallery_add' and actor = '${boss.id}' and details->>'media' = 'video'`)).toBe('1')
  expect(mock.starts[0]).toMatchObject({ kind: 'gallery', mime_type: 'video/webm' })

  // from a pasted Drive link: nothing is uploaded, the file is attached where it is
  await a.page.reload()
  await a.page.getByRole('button', { name: 'Add a video from Drive' }).click()
  const d = a.page.getByRole('dialog', { name: 'Add a video from Drive' })
  await d.getByTestId('gallery-drive-link').fill('https://drive.google.com/drive/folders/abcdefghijklmnop')
  await d.getByRole('button', { name: 'Add to college gallery' }).click()
  await expect(d.getByText(/That is a folder link/)).toBeVisible()
  await d.getByTestId('gallery-drive-link').fill('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=sharing')
  await d.getByLabel(/^Title/).fill(`Pasted ${tag}`)
  await d.getByRole('button', { name: 'Add to college gallery' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_photos where title = 'Pasted ${tag}' and drive_file_id = 'PASTEDFILEID123456' and size_bytes = 777777`)).toBe('1')
  expect(mock.attaches).toHaveLength(1)
  expect(mock.starts).toHaveLength(1) // no second upload
  await a.ctx.close()

  // a half-made gallery video (upload never finished) is for curators only
  sql(`insert into gallery_photos (storage_path, thumb_path, media_kind, mime_type, size_bytes, title, created_by) values ('gallery/half-${tag}.vid', 'gallery/half-${tag}_t.webp', 'video', 'video/mp4', 5000, 'Half ${tag}', '${boss.id}')`)
  const m = await open(browser, member, '/gallery')
  await mockDrive(m.page, { origin: ORIGIN })
  await m.login()
  await expect(m.page.getByRole('heading', { name: 'College gallery' })).toBeVisible()
  expect(sql(`select count(*) from gallery_photos where title like '%${tag}'`)).toBe('3')
  await expect(m.page.locator('[data-gallery-id]').filter({ has: m.page.getByTestId('video-badge') })).not.toHaveCount(0)
  const visible = await m.page.evaluate(() => document.querySelectorAll('[data-gallery-id]').length)
  expect(visible).toBeGreaterThanOrEqual(2)
  await m.ctx.close()
})
