import { expect, test, type Browser, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { sql } from './helpers'
import { fixture, mockDrive, WEBM } from './driveMock'
import { loginPage, makeUser, serviceClient, ts, type TestUser } from './verify/admin-lib'

// Glimpses (autoplaying clips for everyone, managed by an admin) and the past-meets archive, in a real browser. Google Drive and the edge
// functions are stood in for by e2e/driveMock.ts; the functions are verified separately against a strict fake Google.
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 5173}`
const WEBP_1PX = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  let c = 0xffffffff
  for (const x of td) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, td, crc])
}
function png(r: number, g: number, b: number, w = 64, h = 48): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

async function open(browser: Browser, u: TestUser | null, path: string, o: { width?: number; reducedMotion?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 412, height: 915 }, isMobile: true, hasTouch: true, reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  return { ctx, page, go: async () => (u ? loginPage(page, u, path) : page.goto(path)) }
}
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
/** a live glimpse row with a real poster in the public bucket */
async function seedGlimpse(n: number, o: { caption?: string; hi?: string; year?: number; visible?: boolean; sent?: boolean; meet?: string } = {}): Promise<string> {
  const path = `glimpses/e2e-${ts}-${n}_p.webp`
  const up = await serviceClient().storage.from('glimpses').upload(path, WEBP_1PX, { contentType: 'image/webp', upsert: true })
  if (up.error) throw up.error
  return sql(`insert into glimpses (caption, caption_hi, year, poster_path, mime_type, size_bytes, duration_ms, drive_file_id, sort_order, is_visible, meet_id)
              values (${o.caption ? `'${o.caption}'` : 'null'}, ${o.hi ? `'${o.hi}'` : 'null'}, ${o.year ?? 'null'}, '${path}', 'video/webm', ${WEBM.length}, 2000,
                      ${o.sent === false ? 'null' : `'SEEDDRIVEFILE${ts}${n}'`}, ${n}, ${o.visible ?? true}, ${o.meet ? `'${o.meet}'` : 'null'}) returning id`).split('\n')[0]!
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => {
  sql('delete from glimpses')
})

test('the admin manages glimpses: upload, a pasted Drive link, the 4-shown rule, reorder, hide, edit, replace, remove', async ({ browser }) => {
  test.setTimeout(240_000)
  const tag = `ga${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const { ctx, page, go } = await open(browser, boss, '/admin/content')
  const mock = await mockDrive(page, {
    origin: ORIGIN,
    onFinish: (b) => sql(`update glimpses set drive_file_id = '${String(b.file_id)}' where id = '${String(b.id)}'`),
    inspect: (b) => (String(b.file_ref).includes('FOLDERLINK') ? { status: 400, error: 'That is a folder link.' } : { file_id: 'PASTEDGLIMPSE12345', name: 'final reunion video .mp4', mime_type: 'video/mp4', size_bytes: 3_000_000 }),
    onAttach: (b) => sql(`update glimpses set drive_file_id = 'PASTEDGLIMPSE12345' where id = '${String(b.id)}'`),
  })
  await go()
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByTestId('glimpses-admin')).toContainText('Up to 4 are shown')
  await noSideScroll(page)

  const add = async (file: string, caption: string, year: string) => {
    await page.getByRole('button', { name: 'Add a glimpse' }).click()
    const d = page.getByRole('dialog')
    await d.getByTestId('glimpse-file').setInputFiles(fixture(file))
    await d.getByLabel(/^Caption(?! in)/).fill(caption)
    await d.getByLabel('Year of the meet').fill(year)
    await d.getByRole('button', { name: 'Save' }).click()
    await expect(d).toBeHidden({ timeout: 60_000 })
  }
  await add('clip.webm', 'Night party', '2024')
  await add('clip2.webm', 'Reunion lunch', '2023')
  await expect(page.getByTestId('glimpse-row')).toHaveCount(2)
  expect(sql(`select count(*) from glimpses where drive_file_id like 'FAKEDRIVE%' and is_visible`)).toBe('2')
  expect(mock.starts.every((s) => s.kind === 'glimpse')).toBe(true)
  expect(sql(`select count(*) from storage.objects where bucket_id = 'glimpses'`)).not.toBe('0')

  // a video that is already in Drive: validated by the server, attached where it is, no upload
  await page.getByRole('button', { name: 'Add a glimpse' }).click()
  let d = page.getByRole('dialog')
  await d.getByRole('tab', { name: 'Use a file in Drive' }).click()
  await d.getByTestId('glimpse-drive-link').fill('not a link')
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d.getByText('That does not look like a Google Drive link or file id.')).toBeVisible()
  await d.getByTestId('glimpse-drive-link').fill('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx')
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d.getByText(/That is a folder link/)).toBeVisible()
  await d.getByTestId('glimpse-drive-link').fill('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=sharing')
  await d.getByLabel(/^Caption(?! in)/).fill('Final reunion')
  await d.getByLabel('Year of the meet').fill('2025')
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d).toBeHidden({ timeout: 30_000 })
  expect(mock.attaches).toHaveLength(1)
  expect(mock.starts).toHaveLength(2) // the two uploads only
  expect(sql(`select drive_file_id || '|' || mime_type || '|' || size_bytes from glimpses where caption = 'Final reunion'`)).toBe('PASTEDGLIMPSE12345|video/mp4|3000000')

  // a fourth and a fifth: the fifth starts hidden (at most 4 are shown) and cannot be shown until another is hidden
  await add('clip.webm', 'Fourth', '2022')
  await add('clip2.webm', 'Fifth', '2021')
  await expect(page.getByTestId('glimpse-row')).toHaveCount(5)
  await expect(page.getByTestId('glimpse-count')).toHaveText('4 of 4 shown')
  const fifth = page.getByTestId('glimpse-row').filter({ hasText: 'Fifth' })
  await expect(fifth).toContainText('Hidden')
  await fifth.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByText('Show at most 4 glimpses. Hide one first.')).toBeVisible()
  const nightRow = page.getByTestId('glimpse-row').filter({ hasText: 'Night party' })
  await nightRow.getByRole('button', { name: 'Hide' }).click()
  await expect(page.getByTestId('glimpse-count')).toHaveText('3 of 4 shown')
  await fifth.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByTestId('glimpse-count')).toHaveText('4 of 4 shown')
  expect(sql(`select count(*) from glimpses where is_visible`)).toBe('4')

  // reorder: move the fifth to the top
  const order = () => sql(`select string_agg(coalesce(caption, '-'), ',' order by sort_order, created_at) from glimpses`)
  expect(order().split(',')[0]).toBe('Night party')
  const fifthRow = page.getByTestId('glimpse-row').filter({ hasText: 'Fifth' })
  for (let i = 0; i < 4; i++) await fifthRow.getByRole('button', { name: 'Move up' }).click()
  await expect.poll(order).toMatch(/^Fifth,/)

  // edit caption, year, Hindi caption; replace the clip (shows "not sent" until it arrives)
  await page.getByTestId('glimpse-row').filter({ hasText: 'Reunion lunch' }).getByRole('button', { name: 'Edit' }).click()
  d = page.getByRole('dialog')
  await d.getByLabel(/^Caption(?! in)/).fill('Reunion lunch 2023')
  await d.getByLabel('Caption in Hindi').fill('पुनर्मिलन भोज')
  await d.getByLabel('Year of the meet').fill('2020')
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d).toBeHidden()
  expect(sql(`select caption || '|' || caption_hi || '|' || year from glimpses where caption like 'Reunion lunch%'`)).toBe('Reunion lunch 2023|पुनर्मिलन भोज|2020')
  const oldPoster = sql(`select poster_path from glimpses where caption = 'Reunion lunch 2023'`)
  await page.getByTestId('glimpse-row').filter({ hasText: 'Reunion lunch 2023' }).getByRole('button', { name: 'Edit' }).click()
  d = page.getByRole('dialog')
  await d.getByTestId('glimpse-file').setInputFiles(fixture('clip.webm'))
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d).toBeHidden({ timeout: 60_000 })
  expect(sql(`select (poster_path <> '${oldPoster}')::text || '|' || (drive_file_id like 'FAKEDRIVE%')::text from glimpses where caption = 'Reunion lunch 2023'`)).toBe('true|true')
  await expect.poll(() => sql(`select count(*) from storage.objects where bucket_id = 'glimpses' and name = '${oldPoster}'`)).toBe('0') // the old poster was deleted

  // an oversized or wrong file is refused before anything is sent
  await page.getByRole('button', { name: 'Add a glimpse' }).click()
  d = page.getByRole('dialog')
  await d.getByTestId('glimpse-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(d.getByText(/This video format is not supported/)).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()

  // remove one
  page.once('dialog', (x) => void x.accept())
  await page.getByTestId('glimpse-row').filter({ hasText: 'Fourth' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('glimpse-row')).toHaveCount(4)
  expect(sql(`select count(*) from admin_audit where actor = '${boss.id}' and action like 'glimpse_%'`)).not.toBe('0')
  await ctx.close()
})

test('everyone sees the glimpses: one video plays at a time, muted and inline; tap for sound and full screen; reduced motion, Data Saver, off-screen and hidden tabs stop it', async ({ browser }) => {
  test.setTimeout(240_000)
  sql('delete from glimpses')
  await seedGlimpse(1, { caption: 'Night party', hi: 'नाइट पार्टी', year: 2024 })
  await seedGlimpse(2, { caption: 'Reunion lunch', year: 2023 })
  await seedGlimpse(3, { caption: 'Final reunion', year: 2025 })
  await seedGlimpse(4, { caption: 'Hidden one', visible: false })
  await seedGlimpse(5, { caption: 'Not sent yet', sent: false })

  // a logged-out visitor opens the app
  const v = await open(browser, null, '/')
  const media = await mockDrive(v.page, { origin: ORIGIN })
  await v.go()
  const carousel = v.page.getByTestId('glimpse-carousel')
  await expect(carousel).toBeVisible()
  await expect(carousel.getByTestId('glimpse-caption')).toHaveText('Night party')
  await expect(carousel.getByLabel(/Show glimpse/)).toHaveCount(3) // the hidden and the unsent ones are not offered
  const video = carousel.locator('video')
  await expect(video).toHaveCount(1)
  await expect(video).toHaveAttribute('playsinline', '')
  await expect(video).toHaveAttribute('autoplay', '')
  expect(await video.evaluate((x: HTMLVideoElement) => x.muted)).toBe(true)
  expect(await video.evaluate((x: HTMLVideoElement) => x.controls)).toBe(false)
  await expect.poll(() => video.evaluate((x: HTMLVideoElement) => x.currentTime)).toBeGreaterThan(0.1)
  expect(await video.evaluate((x: HTMLVideoElement) => x.paused)).toBe(false)
  const src = await video.getAttribute('src')
  expect(src).toContain('drive-media?k=glimpse&id=')
  expect(src).not.toContain('&t=') // anonymous: no token
  expect(media.media.every((m) => m.token === null)).toBe(true)
  // lazy: only the slide on screen is fetched
  expect(new Set(media.media.map((m) => new URL(m.url).searchParams.get('id'))).size).toBe(1)
  await noSideScroll(v.page)

  // when it ends, the next one starts (never two videos at once)
  await expect(carousel.getByTestId('glimpse-caption')).toHaveText('Reunion lunch', { timeout: 20_000 })
  await expect(carousel.locator('video')).toHaveCount(1)
  // dots and arrows
  await carousel.getByRole('button', { name: 'Show glimpse 3' }).click()
  await expect(carousel.getByTestId('glimpse-caption')).toHaveText('Final reunion')
  await carousel.getByRole('button', { name: 'Next' }).click()
  await expect(carousel.getByTestId('glimpse-caption')).toHaveText('Night party')

  // the speaker button turns the sound on in place
  const mute = carousel.getByTestId('glimpse-mute')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  expect(await carousel.locator('video').evaluate((x: HTMLVideoElement) => x.muted)).toBe(false)
  await mute.click()

  // tapping the picture opens it with sound and the browser's controls; the carousel stops meanwhile
  await carousel.locator('video').click({ position: { x: 100, y: 80 } })
  const viewer = v.page.getByTestId('glimpse-viewer')
  await expect(viewer).toBeVisible()
  const big = viewer.locator('video')
  expect(await big.evaluate((x: HTMLVideoElement) => x.controls)).toBe(true)
  expect(await big.evaluate((x: HTMLVideoElement) => x.muted)).toBe(false)
  await expect(carousel.getByTestId('glimpse-video')).toHaveCount(0)
  await v.page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(carousel.locator('video')).toHaveCount(1)

  // scrolled out of view: it stops (and stops downloading); back in view: it plays again
  await v.page.evaluate(() => {
    const el = document.querySelector('[data-testid=glimpse-carousel]') as HTMLElement
    el.style.marginTop = '3500px'
    window.scrollTo(0, 0)
  })
  await expect(carousel.locator('video')).toHaveCount(0)
  await carousel.scrollIntoViewIfNeeded()
  await expect(carousel.locator('video')).toHaveCount(1)

  // a hidden tab pauses it
  await v.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(carousel.locator('video')).toHaveCount(0)
  await v.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(carousel.locator('video')).toHaveCount(1)
  await v.ctx.close()

  // the same clips on the Meet page and the sign-in page
  for (const path of ['/meet', '/signin']) {
    const p = await open(browser, null, path)
    await mockDrive(p.page, { origin: ORIGIN })
    await p.go()
    await expect(p.page.getByTestId('glimpse-carousel')).toBeVisible()
    await expect(p.page.getByTestId('glimpse-carousel').locator('video')).toHaveCount(1)
    await noSideScroll(p.page)
    await p.ctx.close()
  }

  // reduced motion: the poster only, nothing is fetched; a tap plays it with controls
  const r = await open(browser, null, '/', { reducedMotion: true })
  const rm = await mockDrive(r.page, { origin: ORIGIN })
  await r.go()
  const rc = r.page.getByTestId('glimpse-carousel')
  await expect(rc.getByTestId('glimpse-poster')).toBeVisible()
  await expect(rc.locator('video')).toHaveCount(0)
  expect(rm.media).toHaveLength(0)
  await rc.getByRole('button', { name: /Watch: Night party/ }).click()
  await expect(r.page.getByTestId('glimpse-viewer').locator('video')).toHaveAttribute('controls', '')
  await r.ctx.close()

  // Data Saver and a slow connection: poster only as well
  for (const conn of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: '3g' }]) {
    const s = await open(browser, null, '/')
    await s.page.addInitScript((c) => Object.defineProperty(navigator, 'connection', { value: c, configurable: true }), conn)
    const sm = await mockDrive(s.page, { origin: ORIGIN })
    await s.go()
    await expect(s.page.getByTestId('glimpse-carousel').getByTestId('glimpse-poster')).toBeVisible()
    await expect(s.page.getByTestId('glimpse-carousel').locator('video')).toHaveCount(0)
    expect(sm.media).toHaveLength(0)
    await s.ctx.close()
  }

  // Hindi
  const h = await open(browser, null, '/')
  await h.page.addInitScript(() => localStorage.setItem('jec-lang', 'hi'))
  await mockDrive(h.page, { origin: ORIGIN })
  await h.go()
  await expect(h.page.getByTestId('glimpse-carousel').getByTestId('glimpse-caption')).toHaveText('नाइट पार्टी')
  await h.ctx.close()

  // signed-in members: at the top of Home and of the registration page
  const member = await makeUser(`gm${ts}`.slice(0, 12), { name: `Mina ${ts}` })
  for (const path of ['/', '/meet/register']) {
    const m = await open(browser, member, path)
    await mockDrive(m.page, { origin: ORIGIN })
    await m.go()
    const c = m.page.getByTestId('glimpse-carousel')
    await expect(c).toBeVisible()
    const top = await c.evaluate((el: HTMLElement) => el.getBoundingClientRect().top)
    expect(top).toBeLessThan(430) // near the top: above the cards and the form
    await m.ctx.close()
  }
  expect(sql(`select count(*) from glimpses`)).toBe('5')
})

test('past meets: a draft Alumni Meet 2025 placeholder, admin creates a meet, everyone reads it, members see and add photos and videos, Hindi, menu and links', async ({ browser }) => {
  test.setTimeout(240_000)
  const tag = `pm${ts}`.slice(0, 12)
  sql("delete from past_meets where slug <> 'alumni-meet-2025'") // earlier runs of this test
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const member = await makeUser(`${tag}m`, { name: `Mina ${tag}` })

  // the seeded placeholder is a draft with nothing invented
  expect(sql(`select title || '|' || year || '|' || is_published || '|' || coalesce(venue, '-') || '|' || coalesce(description, '-') from past_meets where slug = 'alumni-meet-2025'`)).toBe('Alumni Meet 2025|2025|false|-|-')

  // the admin creates Alumni Meet 2024
  const a = await open(browser, boss, '/admin/content?tab=meets')
  await mockDrive(a.page, { origin: ORIGIN })
  await a.go()
  await expect(a.page.getByTestId('meet-admin-row').filter({ hasText: 'Alumni Meet 2025' })).toContainText('Draft')
  await noSideScroll(a.page)
  await a.page.getByRole('button', { name: 'Add a past meet' }).click()
  const d = a.page.getByRole('dialog')
  await d.getByLabel(/^Title(?! in)/).fill(`Alumni Meet 2024 ${tag}`)
  await d.getByLabel('Title in Hindi').fill('पूर्व छात्र सम्मेलन 2024')
  await d.getByLabel(/^Year/).fill('2024')
  await d.getByLabel(/^Date/).fill('2024-12-28')
  await d.getByLabel('Venue').fill('The old campus lawns')
  await d.getByLabel('How many attended').fill('140')
  await d.getByLabel(/^Description(?! in)/).fill('A day of reunions and tea.')
  await d.getByLabel(/^Highlights(?! in)/).fill('Batch photo\nCampus walk')
  await d.getByTestId('meet-cover').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png(30, 90, 160, 640, 280) })
  await expect(d.locator('img').first()).toBeVisible()
  await d.getByRole('checkbox', { name: /Members can add their photos and videos/ }).check()
  await d.getByRole('checkbox', { name: /Published: visible to everyone/ }).check()
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(d).toBeHidden()
  const row = `select m.id || '|' || m.slug || '|' || m.is_published || '|' || m.members_can_add || '|' || (m.cover_path like 'gallery/meets/%') || '|' || m.attendance || '|' || m.archive_event || '|' || (select member_uploads from event_photo_settings s where s.event_id = m.event_id) from past_meets m where m.title = 'Alumni Meet 2024 ${tag}'`
  const [id, slug, pub, add, cover, att, arch, mode] = sql(row).split('|') as string[]
  expect([pub, add, cover, att, arch, mode]).toEqual(['true', 'true', 'true', '140', 'true', 'approval'])
  expect(slug).toBe(`alumni-meet-2024-${tag}`.slice(0, 50))
  const eventId = sql(`select event_id from past_meets where id = '${id}'`)
  expect(sql(`select slug from events where id = '${eventId}' and is_published`)).toMatch(/^meet-archive-/)
  expect(sql(`select count(*) from storage.objects where bucket_id = 'gallery' and name = (select cover_path from past_meets where id = '${id}')`)).toBe('1')
  // the archive event holds videos too once it has a Drive folder (the committee sets it up like for any event)
  sql(`insert into event_settings (event_id, drive_folder_id) values ('${eventId}', 'folderfolder12345') on conflict (event_id) do update set drive_folder_id = excluded.drive_folder_id`)
  // a glimpse that belongs to this meet
  const gl = await seedGlimpse(9, { caption: 'Campus walk clip', meet: id })

  // everyone (not signed in) can read the archive; drafts stay hidden
  const v = await open(browser, null, '/meets')
  await mockDrive(v.page, { origin: ORIGIN })
  await v.go()
  await expect(v.page.getByRole('heading', { name: 'Past meets' })).toBeVisible()
  await expect(v.page.getByTestId('meets-year-2024').getByTestId('meet-card').filter({ hasText: `Alumni Meet 2024 ${tag}` })).toBeVisible()
  await expect(v.page.getByText('Alumni Meet 2025', { exact: true })).toHaveCount(0)
  await noSideScroll(v.page)
  await v.page.getByTestId('meet-card').filter({ hasText: `Alumni Meet 2024 ${tag}` }).click()
  await expect(v.page).toHaveURL(new RegExp(`/meets/${slug}`))
  await expect(v.page.getByRole('heading', { name: `Alumni Meet 2024 ${tag}` })).toBeVisible()
  await expect(v.page.getByTestId('meet-description')).toHaveText('A day of reunions and tea.')
  await expect(v.page.getByText('The old campus lawns')).toBeVisible()
  await expect(v.page.getByText('140 alumni attended')).toBeVisible()
  await expect(v.page.getByText('Batch photo')).toBeVisible()
  await expect(v.page.getByTestId('meet-glimpse')).toHaveCount(1)
  await expect(v.page.getByText('Sign in to see the photos and videos')).toBeVisible() // photos are for members
  await v.page.getByTestId('meet-glimpse').click()
  await expect(v.page.getByTestId('glimpse-viewer').locator('video')).toHaveAttribute('controls', '')
  await v.page.keyboard.press('Escape')
  await noSideScroll(v.page)
  await v.ctx.close()
  void gl

  // Hindi
  const hi = await open(browser, null, `/meets/${slug}`)
  await hi.page.addInitScript(() => localStorage.setItem('jec-lang', 'hi'))
  await mockDrive(hi.page, { origin: ORIGIN })
  await hi.go()
  await expect(hi.page.getByRole('heading', { name: 'पूर्व छात्र सम्मेलन 2024' })).toBeVisible()
  await expect(hi.page.getByText('140 पूर्व छात्र शामिल हुए')).toBeVisible()
  await hi.ctx.close()

  // the admin sees the draft placeholder's page without anything made up
  const dr = await open(browser, boss, '/meets/alumni-meet-2025')
  await mockDrive(dr.page, { origin: ORIGIN })
  await dr.go()
  await expect(dr.page.getByText('Draft: only organisers can see this page.')).toBeVisible()
  await expect(dr.page.getByText('More about this meet is coming soon.')).toBeVisible()
  await dr.ctx.close()
  const dm = await open(browser, member, '/meets/alumni-meet-2025')
  await dm.go()
  await expect(dm.page.getByText('Meet not found')).toBeVisible()
  await dm.ctx.close()

  // an organiser adds an official photo and a video to the archive; members see them in the meet page and can add their own (approval)
  const up = await open(browser, boss, `/events/${sql(`select slug from events where id = '${eventId}'`)}/photos/upload`)
  await mockDrive(up.page, { origin: ORIGIN, onFinish: (b) => sql(`update event_photos set drive_file_id = '${String(b.file_id)}' where id = '${String(b.photo_id)}'`) })
  await up.go()
  await up.page.locator('input[type=file]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: png(200, 20, 20) }, { name: 'c.webm', mimeType: 'video/webm', buffer: WEBM }])
  await expect(up.page.getByTestId('upload-progress')).toContainText('Finished: 2 of 2', { timeout: 60_000 })
  await up.ctx.close()
  expect(sql(`select count(*) from event_photos where event_id = '${eventId}' and source = 'official' and status = 'approved'`)).toBe('2')

  const mm = await open(browser, member, `/meets/${slug}`)
  const mmock = await mockDrive(mm.page, { origin: ORIGIN })
  await mm.go()
  await expect(mm.page.getByTestId('meet-media-grid').locator('button')).toHaveCount(2)
  await expect(mm.page.getByTestId('meet-media-grid').getByText('0:02')).toBeVisible()
  await mm.page.getByTestId('meet-media-grid').locator('button').filter({ has: mm.page.getByText('0:02') }).click()
  const pv = mm.page.getByRole('dialog').locator('video')
  await expect(pv).toHaveAttribute('src', /drive-media\?k=event/)
  await expect.poll(() => pv.evaluate((x: HTMLVideoElement) => x.readyState)).toBeGreaterThanOrEqual(1)
  expect(mmock.media.length).toBeGreaterThan(0)
  await mm.page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await mm.page.getByRole('link', { name: 'Add yours' }).click()
  await expect(mm.page.getByText(/Photos from members are checked by the organisers/)).toBeVisible()
  await mm.page.locator('input[type=file]').setInputFiles({ name: 'm.png', mimeType: 'image/png', buffer: png(10, 200, 10) })
  await expect(mm.page.getByTestId('upload-progress')).toContainText('Finished: 1 of 1', { timeout: 60_000 })
  expect(sql(`select status || '|' || source from event_photos where event_id = '${eventId}' and uploaded_by = '${member.id}'`)).toBe('pending|member')
  await mm.ctx.close()

  // the admin turns member contributions off: members can no longer add, the database refuses too
  const ed = await open(browser, boss, `/admin/content?tab=meets&edit=${id}`)
  await mockDrive(ed.page, { origin: ORIGIN })
  await ed.go()
  const ed1 = ed.page.getByRole('dialog')
  await expect(ed1.getByLabel(/^Title(?! in)/)).toHaveValue(`Alumni Meet 2024 ${tag}`)
  await ed1.getByRole('checkbox', { name: /Members can add their photos and videos/ }).uncheck()
  await ed1.getByRole('button', { name: 'Save' }).click()
  await expect(ed1).toBeHidden()
  expect(sql(`select member_uploads from event_photo_settings where event_id = '${eventId}'`)).toBe('off')
  const m2 = await open(browser, member, `/events/${sql(`select slug from events where id = '${eventId}'`)}/photos/upload`)
  await m2.go()
  await expect(m2.page.getByText('Only the organising team adds photos and videos here.').first()).toBeVisible()
  await m2.page.locator('input[type=file]').setInputFiles({ name: 'n.png', mimeType: 'image/png', buffer: png(10, 10, 200) })
  await expect(m2.page.getByText('Only the organising team adds photos and videos here.').last()).toBeVisible()
  expect(sql(`select count(*) from event_photos where event_id = '${eventId}' and uploaded_by = '${member.id}'`)).toBe('1')
  await m2.ctx.close()

  // links and the menu: Home strip, the Meet page card, and the menu entry under Events & memories
  const home = await open(browser, member, '/')
  await mockDrive(home.page, { origin: ORIGIN })
  await home.go()
  await expect(home.page.getByTestId('home-past-meets')).toContainText(`Alumni Meet 2024 ${tag}`)
  await home.page.getByTestId('home-past-meets').getByRole('link', { name: `Alumni Meet 2024 ${tag}` }).click()
  await expect(home.page).toHaveURL(new RegExp(`/meets/${slug}`))
  await home.page.goto('/meet')
  await home.page.getByTestId('meet-past-link').click()
  await expect(home.page).toHaveURL(/\/meets$/)
  await home.ctx.close()
  expect(sql(`select count(*) from admin_audit where action = 'meet_save' and actor = '${boss.id}'`)).toBe('2')

  // delete: the page goes, the photos stay
  const del = await open(browser, boss, '/admin/content?tab=meets')
  await mockDrive(del.page, { origin: ORIGIN })
  await del.go()
  await del.page.getByTestId('meet-admin-row').filter({ hasText: `Alumni Meet 2024 ${tag}` }).getByRole('button', { name: 'Edit' }).click()
  del.page.once('dialog', (x) => void x.accept())
  await del.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect.poll(() => sql(`select count(*) from past_meets where id = '${id}'`)).toBe('0')
  expect(sql(`select count(*) from event_photos where event_id = '${eventId}'`)).toBe('3')
  await del.ctx.close()
})

