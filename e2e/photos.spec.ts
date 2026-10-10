import { expect, test, type Browser, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { sql } from './helpers'
import { auditCount, loginPage, makeEvent, makeUser, ts, type TestUser } from './verify/admin-lib'

// The photo system end to end: the event photo area (official bulk upload with retries and duplicates, member uploads with approval on
// and off, tags, hearts, reports, votes, ZIP, slideshow, QR page) and the college gallery (add with chips, member view, suggestions,
// Then & Now). Everything is created by this run and asserted in the database as well as on the screen.

// ------------------------------------------------------------------ tiny generated PNGs
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc = (b: Buffer) => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
/** A w x h solid-colour PNG. */
function png(r: number, g: number, b: number, w = 64, h = 48): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const file = (name: string, r: number, g: number, b: number) => ({ name, mimeType: 'image/png', buffer: png(r, g, b) })
const palette = (n: number, seed: number) => Array.from({ length: n }, (_, i) => file(`p${seed}-${i}.png`, (seed * 40 + i * 37) % 256, (i * 71 + seed * 13) % 256, (i * 29 + 90) % 256))

const phoneContext = (browser: Browser, width = 412) => browser.newContext({ viewport: { width, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
async function open(browser: Browser, u: TestUser, path: string, width = 412) {
  const ctx = await phoneContext(browser, width)
  const page = await ctx.newPage()
  await loginPage(page, u, path)
  return { ctx, page }
}
const photoIds = (eventId: string) => sql(`select id from event_photos where event_id = '${eventId}' order by created_at`).split('\n').filter(Boolean)
/** a photo row without a file behind it (for tests that only need the row) */
function seedPhoto(eventId: string, by: string, o: { source?: string; status?: string; kind?: string; caption?: string } = {}): string {
  const id = crypto.randomUUID()
  sql(`insert into event_photos (id, event_id, uploaded_by, storage_path, thumb_path, caption, kind) values ('${id}', '${eventId}', '${by}', '${by}/${eventId}/${id}.webp', '${by}/${eventId}/${id}_t.webp', ${o.caption ? `'${o.caption}'` : 'null'}, '${o.kind ?? 'event'}')`)
  if (o.source || o.status) sql(`update event_photos set source = '${o.source ?? 'member'}', status = '${o.status ?? 'approved'}' where id = '${id}'`)
  return id
}

test('official bulk upload: progress, duplicate skipped, a failing file is retried by hand, ZIP download is logged', async ({ browser }) => {
  const tag = `pb${ts}`.slice(0, 12)
  const ev = makeEvent(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const { ctx, page } = await open(browser, boss, `/events/${ev.slug}/photos/upload`, 360)
  await expect(page.getByText('You are uploading as Official')).toBeVisible()
  await noSideScroll(page)

  // one file keeps failing until we let it through: automatic retries run out, then "Retry" works by hand
  let blocked: string | null = null
  let block = true
  await page.route('**/storage/v1/object/event-photos/**', async (route) => {
    const id = route.request().url().split('/').pop()!.replace(/(_t)?\.\w+$/, '')
    if (block) {
      blocked ??= id
      if (id === blocked) return route.abort('failed')
    }
    return route.continue()
  })
  const files = [...palette(6, 1), { ...file('same-as-first.png', 0, 0, 0), buffer: palette(6, 1)[0]!.buffer }]
  await page.locator('input[type=file]').setInputFiles(files)
  await expect(page.getByTestId('upload-progress')).toContainText(/Uploading \d+ of 7|Finished/)
  await expect(page.getByText('1 photo could not be added', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('upload-progress')).toContainText('Finished: 6 of 7')
  await noSideScroll(page)
  expect(photoIds(ev.id)).toHaveLength(5)
  block = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('upload-progress')).toContainText('Finished: 7 of 7', { timeout: 30_000 })
  await expect(page.getByText(/already there 1/)).toBeVisible()

  // the database: six official, approved photos with a hash each; files exist in storage; no member rate limit applied
  expect(sql(`select count(*) from event_photos where event_id = '${ev.id}' and source = 'official' and status = 'approved' and content_hash is not null and uploaded_by = '${boss.id}'`)).toBe('6')
  expect(sql(`select count(*) from storage.objects where bucket_id = 'event-photos' and name like '${boss.id}/${ev.id}/%'`)).toBe('12')

  // the photo area shows them, marked Official, and the manager's panel works
  await page.getByRole('link', { name: 'View the photos' }).click()
  await expect(page.getByTestId('photo-grid').locator('[data-photo-id]')).toHaveCount(6)
  await page.getByRole('button', { name: 'Manage photos' }).click()
  await expect(page.getByTestId('upload-link')).toContainText(`/events/${ev.slug}/photos/upload`)
  await expect(page.getByRole('img', { name: 'QR code to add photos to this event' })).toBeVisible()
  await noSideScroll(page)
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download all photos/ }).click()
  const download = await dl
  expect(download.suggestedFilename()).toBe(`${ev.slug}-photos.zip`)
  await expect.poll(() => auditCount(`action = 'photo_export' and actor = '${boss.id}' and target_id = '${ev.id}' and (details->>'photos')::int = 6`)).toBe(1)
  await ctx.close()
})

test('members: uploads wait for approval or show at once, tags notify and can be removed, hearts, reports, Find my photos', async ({ browser }) => {
  const tag = `pm${ts}`.slice(0, 12)
  const ev = makeEvent(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const asha = await makeUser(`${tag}a`, { name: `Asha ${tag}`, grad: 2001 })
  const bala = await makeUser(`${tag}b`, { name: `Bala ${tag}`, grad: 2005 })

  // the organiser asks for approval
  const adm = await open(browser, boss, `/events/${ev.slug}/photos`)
  await adm.page.getByRole('button', { name: 'Manage photos' }).click()
  await adm.page.getByText('Need approval', { exact: true }).click()
  await expect.poll(() => sql(`select member_uploads from event_photo_settings where event_id = '${ev.id}'`)).toBe('approval')

  // Asha adds a photo with a caption: it waits
  const a = await open(browser, asha, `/events/${ev.slug}/photos/upload`)
  await expect(a.page.getByText(/checked by the organisers/)).toBeVisible()
  await a.page.getByLabel('Caption').fill('Batch of 2001')
  await a.page.locator('input[type=file]').setInputFiles(palette(1, 5))
  await expect(a.page.getByTestId('upload-progress')).toContainText('Finished: 1 of 1')
  const pending = photoIds(ev.id)[0]!
  expect(sql(`select source || '/' || status || '/' || coalesce(caption, '') from event_photos where id = '${pending}'`)).toBe('member/pending/Batch of 2001')
  await a.page.goto(`/events/${ev.slug}/photos?view=mine`)
  await expect(a.page.locator(`[data-photo-id="${pending}"]`)).toBeVisible()
  await expect(a.page.locator(`[data-photo-id="${pending}"]`)).toHaveAttribute('aria-label', 'Batch of 2001')

  // Bala does not see it yet
  const b = await open(browser, bala, `/events/${ev.slug}/photos`)
  await expect(b.page.getByText('No photos yet')).toBeVisible()
  expect(sql(`select count(*) from event_photos where id = '${pending}'`)).toBe('1') // exists, but hidden from Bala by row security

  // the organiser approves it from "Waiting for approval"
  await adm.page.reload()
  await adm.page.getByRole('tab', { name: 'Waiting for approval' }).click()
  await adm.page.getByRole('button', { name: 'Select', exact: true }).click()
  await adm.page.locator(`[data-photo-id="${pending}"]`).click()
  await adm.page.getByRole('toolbar').getByRole('button', { name: 'Approve' }).click()
  await expect.poll(() => sql(`select status from event_photos where id = '${pending}'`)).toBe('approved')
  expect(auditCount(`action = 'photo_approve' and actor = '${boss.id}'`)).toBeGreaterThan(0)
  expect(sql(`select count(*) from notifications where user_id = '${asha.id}' and kind = 'photo_approved' and target_id = '${pending}'`)).toBe('1')

  // Bala sees it now, hearts it, tags Asha, reports... (reports are for other people's photos)
  await b.page.reload()
  await b.page.locator(`[data-photo-id="${pending}"]`).click()
  await expect(b.page.getByRole('dialog', { name: 'Photo' })).toContainText('Batch of 2001')
  await b.page.getByRole('button', { name: 'Heart this photo' }).click()
  await expect(b.page.getByTestId('heart-count')).toHaveText('1')
  expect(sql(`select count(*) from photo_hearts where photo_id = '${pending}' and user_id = '${bala.id}'`)).toBe('1')
  await b.page.getByRole('button', { name: 'Tag people' }).click()
  await b.page.getByLabel('Find a member').fill(`Asha ${tag}`)
  await b.page.getByRole('listitem').filter({ hasText: `Asha ${tag}` }).getByRole('button', { name: 'Tag', exact: true }).click()
  await expect.poll(() => sql(`select count(*) from photo_tags where photo_id = '${pending}' and tagged_user = '${asha.id}' and tagged_by = '${bala.id}'`)).toBe('1')
  await b.page.getByRole('button', { name: 'Done' }).click()
  await b.page.getByRole('button', { name: 'More', exact: true }).click()
  await b.page.getByRole('button', { name: 'Report this photo' }).click()
  await b.page.getByLabel('What is wrong?').fill('Not from our batch')
  await b.page.getByRole('button', { name: 'Send report' }).click()
  await expect.poll(() => sql(`select count(*) from reports where target_type = 'photo' and target_id = '${pending}' and reporter = '${bala.id}'`)).toBe('1')

  // Asha is told, finds the photo under "Find my photos", and removes the tag
  expect(sql(`select count(*) from notifications where user_id = '${asha.id}' and kind = 'photo_tag' and target_id = '${pending}'`)).toBe('1')
  await a.page.goto('/notifications')
  await expect(a.page.getByText(/tagged you in a photo from/)).toBeVisible()
  await a.page.goto(`/events/${ev.slug}/photos`)
  await a.page.getByRole('tab', { name: 'Find my photos' }).click()
  await expect(a.page.locator(`[data-photo-id="${pending}"]`)).toBeVisible()
  // batch filter: photos with someone of that batch tagged (Asha is 2001)
  await a.page.getByLabel('Batch', { exact: true }).selectOption('2005')
  await expect(a.page.locator(`[data-photo-id="${pending}"]`)).toHaveCount(0)
  await a.page.getByLabel('Batch', { exact: true }).selectOption('2001')
  await expect(a.page.locator(`[data-photo-id="${pending}"]`)).toBeVisible()
  await a.page.goto(`/events/${ev.slug}/photos?view=tagged&photo=${pending}`)
  await a.page.getByRole('button', { name: 'Tag people' }).click()
  await a.page.getByRole('button', { name: new RegExp(`Remove the tag of Asha ${tag}`) }).click()
  await expect.poll(() => sql(`select count(*) from photo_tags where photo_id = '${pending}'`)).toBe('0')

  // the report is in the moderation inbox for the organiser; the organiser hides the photo from there
  expect(sql(`select count(*) from reports where target_type = 'photo' and target_id = '${pending}' and status = 'open'`)).toBe('1')

  // approval off: the next upload shows at once
  await adm.page.getByRole('tab', { name: 'All photos' }).click()
  await adm.page.getByRole('button', { name: 'Manage photos' }).click()
  await adm.page.getByText('Show immediately', { exact: true }).click()
  await expect.poll(() => sql(`select member_uploads from event_photo_settings where event_id = '${ev.id}'`)).toBe('immediate')
  await b.page.goto(`/events/${ev.slug}/photos/upload`)
  await b.page.locator('input[type=file]').setInputFiles(palette(1, 9))
  await expect(b.page.getByTestId('upload-progress')).toContainText('Finished: 1 of 1')
  expect(sql(`select count(*) from event_photos where event_id = '${ev.id}' and uploaded_by = '${bala.id}' and status = 'approved' and source = 'member'`)).toBe('1')
  await a.page.goto(`/events/${ev.slug}/photos`)
  await expect(a.page.getByTestId('photo-grid').locator('[data-photo-id]')).toHaveCount(2)
  await noSideScroll(a.page)
  for (const c of [adm, a, b]) await c.ctx.close()
})

test('gallery: add to the college gallery with a chip, members see it, suggestions, Then & Now, unverified note', async ({ browser }) => {
  const tag = `pg${ts}`.slice(0, 12)
  const ev = makeEvent(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const member = await makeUser(`${tag}m`, { name: `Mina ${tag}` })
  const stranger = await makeUser(`${tag}s`, { name: `Stranger ${tag}`, verified: false })

  // two real photos in the event area
  const up = await open(browser, boss, `/events/${ev.slug}/photos/upload`)
  await up.page.locator('input[type=file]').setInputFiles(palette(2, 3))
  await expect(up.page.getByTestId('upload-progress')).toContainText('Finished: 2 of 2')
  const [first, second] = photoIds(ev.id)
  await up.ctx.close()

  // the organiser adds the first to the gallery from the photo's menu
  const adm = await open(browser, boss, `/events/${ev.slug}/photos?photo=${first}`)
  await adm.page.getByRole('button', { name: 'More', exact: true }).click()
  await adm.page.getByRole('button', { name: 'Add to college gallery' }).click()
  await adm.page.getByLabel('Filter chip').selectOption({ label: 'Campus' })
  await adm.page.getByLabel(/^Title/).fill('The main gate')
  await adm.page.getByRole('checkbox', { name: /Feature this photo/ }).check()
  await adm.page.getByRole('dialog', { name: 'Add to college gallery' }).getByRole('button', { name: 'Add to college gallery' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_photos where source_photo_id = '${first}' and event_id = '${ev.id}' and is_featured and title = 'The main gate' and category_id = (select id from gallery_categories where slug = 'campus')`)).toBe('1')
  expect(sql(`select count(*) from storage.objects where bucket_id = 'gallery' and name in (select storage_path from gallery_photos where source_photo_id = '${first}')`)).toBe('1')
  expect(auditCount(`action = 'gallery_add' and actor = '${boss.id}'`)).toBe(1)
  // event photos do NOT appear in the gallery by themselves
  expect(sql(`select count(*) from gallery_photos where event_id = '${ev.id}'`)).toBe('1')

  // a member sees it: chips filter, featured, and the link back to the event
  const m = await open(browser, member, '/gallery', 360)
  await expect(m.page.getByRole('heading', { name: 'College gallery' })).toBeVisible()
  await expect(m.page.getByTestId('gallery-grid').locator('[data-gallery-id]')).not.toHaveCount(0)
  await m.page.getByRole('tab', { name: 'Sports' }).click()
  await expect(m.page.getByText('Nothing here yet')).toBeVisible()
  await m.page.getByRole('tab', { name: 'Campus' }).click()
  const gid = sql(`select id from gallery_photos where source_photo_id = '${first}'`)
  await m.page.locator(`[data-gallery-id="${gid}"]`).click()
  await expect(m.page.getByTestId('from-event')).toContainText('Verify')
  await m.page.getByTestId('from-event').click()
  await expect(m.page).toHaveURL(new RegExp(`/events/${ev.slug}/photos`))
  await noSideScroll(m.page)

  // unverified members see only the short note, and the database agrees
  const s = await open(browser, stranger, '/gallery')
  await expect(s.page.getByText('Verify to see the gallery')).toBeVisible()
  expect(sql(`select count(*) from gallery_photos`)).not.toBe('0')
  await s.ctx.close()

  // the member suggests the second photo; the organiser adds it from Suggestions
  await m.page.goto(`/events/${ev.slug}/photos?photo=${second}`)
  await m.page.getByRole('button', { name: 'More', exact: true }).click()
  await m.page.getByRole('button', { name: 'Suggest for the college gallery' }).click()
  await m.page.getByLabel('Why this photo?').fill('Great light')
  await m.page.getByRole('button', { name: 'Send suggestion' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_suggestions where photo_id = '${second}' and suggested_by = '${member.id}' and status = 'pending'`)).toBe('1')
  await adm.page.goto('/gallery')
  await adm.page.getByRole('button', { name: /Suggestions/ }).click()
  await expect(adm.page.getByText(`Mina ${tag}`)).toBeVisible()
  await adm.page.getByRole('button', { name: 'Add to college gallery' }).first().click()
  await adm.page.getByRole('dialog', { name: 'Add to college gallery' }).getByRole('button', { name: 'Add to college gallery' }).click()
  await expect.poll(() => sql(`select status from gallery_suggestions where photo_id = '${second}'`)).toBe('approved')
  expect(sql(`select count(*) from notifications where user_id = '${member.id}' and kind = 'gallery_approved'`)).toBe('1')
  expect(sql(`select count(*) from gallery_photos where event_id = '${ev.id}'`)).toBe('2')

  // chips are admin-editable
  await adm.page.goto('/gallery')
  await adm.page.getByRole('button', { name: 'Filter chips' }).click()
  await adm.page.getByPlaceholder('Chip name', { exact: true }).fill(`Visits ${tag}`)
  await adm.page.getByRole('button', { name: 'Add chip' }).click()
  await expect.poll(() => sql(`select count(*) from gallery_categories where label = 'Visits ${tag}'`)).toBe('1')
  await adm.page.getByRole('button', { name: 'Done' }).click()
  await expect(adm.page.getByRole('tab', { name: `Visits ${tag}` })).toBeVisible()

  // Then & Now: the second photo is the "now" of the first
  const g2 = sql(`select id from gallery_photos where source_photo_id = '${second}'`)
  sql(`update gallery_photos set pair_of = '${gid}', category_id = (select id from gallery_categories where slug = 'then-now') where id = '${g2}'`)
  await m.page.goto('/gallery')
  await m.page.getByRole('tab', { name: 'Then & Now' }).click()
  const pair = m.page.locator(`[data-gallery-id="${g2}"]`)
  await expect(pair.getByTestId('before-after')).toBeVisible()
  await pair.getByLabel('Slide between then and now').fill('80')
  await noSideScroll(m.page)

  // only gallery_manage curates: a plain member cannot add
  const denied = await member.db.rpc('admin_gallery_add', { p: { storage_path: 'gallery/x.webp', thumb_path: 'gallery/x_t.webp' } })
  expect(denied.error?.code).toBe('42501')
  await m.ctx.close()
  await adm.ctx.close()
})

test('slideshow shows new photos as they arrive; the QR upload page opens for a member; layouts have no sideways scroll', async ({ browser }) => {
  const tag = `ps${ts}`.slice(0, 12)
  const ev = makeEvent(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const member = await makeUser(`${tag}m`, { name: `Mina ${tag}` })
  const p1 = seedPhoto(ev.id, member.id, { caption: 'First one' })

  const s = await open(browser, boss, `/events/${ev.slug}/photos/slideshow`, 412)
  await expect(s.page.getByTestId('slideshow')).toBeVisible()
  await expect(s.page.getByTestId('slide')).toHaveAttribute('data-photo-id', p1)
  await expect(s.page.getByRole('img', { name: 'QR code to add photos to this event' })).toBeVisible()
  // a new approved photo arrives while the projector runs
  const p2 = seedPhoto(ev.id, member.id, { caption: 'Just arrived' })
  await expect(s.page.getByTestId('slide')).toHaveAttribute('data-photo-id', p2, { timeout: 30_000 })
  await expect(s.page.getByText('Just added')).toBeVisible()
  // a photo that still waits for approval never reaches the screen
  const p3 = seedPhoto(ev.id, member.id, { status: 'pending' })
  await s.page.waitForTimeout(7000)
  expect(await s.page.locator(`[data-photo-id="${p3}"]`).count()).toBe(0)
  await s.page.keyboard.press('Escape')
  await expect(s.page).toHaveURL(new RegExp(`/events/${ev.slug}/photos$`))

  // the QR leads members to the upload page (after sign-in)
  const m = await open(browser, member, `/events/${ev.slug}/photos/upload`, 360)
  await expect(m.page.getByRole('heading', { name: 'Add photos' })).toBeVisible()
  await expect(m.page.getByText('Your photos appear straight away')).toBeVisible()
  await noSideScroll(m.page)
  for (const path of [`/events/${ev.slug}/photos`, '/gallery']) {
    for (const w of [360, 412]) {
      const c = await phoneContext(browser, w)
      const pg = await c.newPage()
      await loginPage(pg, boss, path)
      await expect(pg.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await noSideScroll(pg)
      await c.close()
    }
  }
  await s.ctx.close()
  await m.ctx.close()
})

test('best-photo vote: opened by the organiser, one vote per member, winner announced', async ({ browser }) => {
  const tag = `pv${ts}`.slice(0, 12)
  const ev = makeEvent(tag)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const m1 = await makeUser(`${tag}a`, { name: `Asha ${tag}` })
  const m2 = await makeUser(`${tag}b`, { name: `Bala ${tag}` })
  const ids = [seedPhoto(ev.id, m1.id), seedPhoto(ev.id, m2.id), seedPhoto(ev.id, m1.id)]

  const adm = await open(browser, boss, `/events/${ev.slug}/photos`)
  await adm.page.getByRole('button', { name: 'Select', exact: true }).click()
  await adm.page.locator(`[data-photo-id="${ids[0]}"]`).click()
  await adm.page.locator(`[data-photo-id="${ids[1]}"]`).click()
  await adm.page.getByRole('toolbar').getByRole('button', { name: 'Start a vote' }).click()
  await adm.page.getByLabel('Title of the vote').fill('Best of the day')
  await adm.page.getByRole('dialog').getByRole('button', { name: 'Start a vote' }).click()
  await expect.poll(() => sql(`select count(*) from photo_votes where event_id = '${ev.id}' and closed_at is null`)).toBe('1')
  expect(auditCount(`action = 'photo_vote_open' and actor = '${boss.id}'`)).toBe(1)

  const vote = async (u: TestUser, pick: string) => {
    const c = await open(browser, u, `/events/${ev.slug}/photos`)
    await expect(c.page.getByText('Best of the day')).toBeVisible()
    await c.page.getByRole('button', { name: 'Vote now' }).click()
    await c.page.locator(`[data-candidate="${pick}"]`).click()
    await c.page.getByRole('button', { name: 'Cast my vote' }).click()
    await expect(c.page.getByText(/You have voted/)).toBeVisible()
    await c.page.reload()
    await expect(c.page.getByRole('button', { name: 'Vote now' })).toHaveCount(0) // one vote per member
    await c.ctx.close()
  }
  await vote(m1, ids[1]!)
  await vote(m2, ids[1]!)
  expect(sql(`select count(*) from photo_vote_ballots where photo_id = '${ids[1]}'`)).toBe('2')
  const again = await m1.db.rpc('cast_photo_vote', { p_vote: sql(`select id from photo_votes where event_id = '${ev.id}'`), p_photo: ids[0] })
  expect(again.error?.hint).toBe('photos.errVoted')

  await adm.page.reload()
  adm.page.once('dialog', (d) => void d.accept())
  await adm.page.getByRole('button', { name: 'Close the vote' }).click()
  await expect(adm.page.getByText('Winner')).toBeVisible()
  expect(sql(`select winner_photo from photo_votes where event_id = '${ev.id}'`)).toBe(ids[1])
  expect(sql(`select count(*) from notifications where user_id = '${m2.id}' and kind = 'photo_winner' and target_id = '${ids[1]}'`)).toBe('1')
  await adm.ctx.close()
})
