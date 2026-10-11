import { expect, test, type Browser, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { sql } from './helpers'
import { fixture, mockDrive } from './driveMock'
import { loginPage, makeEvent, makeUser, register, ts, type TestUser } from './verify/admin-lib'

// Stories and highlights, end to end in a real browser (phone-sized): the admin posts official stories (text, photo, video) and the members
// watch them (ring first, auto-advance, tap, hold, hearts); event-only stories; personal stories for connections or everyone; expiry;
// highlights that outlive a story; report, mute, delete; Hindi; 360 px. Google Drive and the edge functions are stood in for by
// e2e/driveMock.ts. The database rules themselves are tested in supabase/tests/99_stories.sql.
const ORIGIN = `http://localhost:${process.env.PW_PORT ?? 5173}`

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
/** a tiny solid-colour PNG, made here so no fixture file is needed */
function png(r: number, g: number, b: number, w = 90, h = 160): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
const photo = (n = 0) => ({ name: `photo${n}.png`, mimeType: 'image/png', buffer: png(40 + n * 30, 120, 200 - n * 20) })

async function open(browser: Browser, u: TestUser, path = '/', o: { width?: number; reducedMotion?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 412, height: 860 }, isMobile: true, hasTouch: true, reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  const mock = await mockDrive(ctx, {
    origin: ORIGIN,
    onFinish: (b) => sql(`update stories set drive_file_id = '${String(b.file_id)}' where id = '${String(b.id)}'`),
  })
  await loginPage(page, u, path)
  return { ctx, page, mock }
}
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
const viewer = (page: Page) => page.getByTestId('story-viewer')
const rowItems = (page: Page) => page.locator('[data-testid=story-row] > ul > li')

let boss: TestUser
let anil: TestUser // owner of personal stories
let bela: TestUser // connected with Anil
let chetan: TestUser // a stranger
let veena: TestUser // registered for the event
let ev: { id: string; slug: string; alumnus: string }
const names: Record<string, string> = {}
let official: { text: string; photo: string; video: string; eventText: string }

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const tag = `st${ts}`.slice(0, 12)
  boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  sql(`insert into admin_grants (user_id, permissions) values ('${boss.id}', array['stories_post'])`)
  anil = await makeUser(`${tag}anil`, { name: `Anil ${tag}` })
  bela = await makeUser(`${tag}bela`, { name: `Bela ${tag}` })
  chetan = await makeUser(`${tag}chet`, { name: `Chetan ${tag}` })
  veena = await makeUser(`${tag}veen`, { name: `Veena ${tag}` })
  names.anil = `Anil ${tag}`
  names.bela = `Bela ${tag}`
  names.chetan = `Chetan ${tag}`
  sql(`insert into connections (requester, addressee, status, accepted_at) values ('${anil.id}', '${bela.id}', 'accepted', now())`)
  ev = makeEvent(`st${tag}`)
  await register(veena, ev)
  sql(`update event_registrations set status = 'confirmed' where user_id = '${veena.id}' and event_id = '${ev.id}'`)
  // a clean slate: no other stories on this database while the spec runs
  sql('delete from story_highlights')
  sql('delete from stories')
})

test('the story team posts official stories: a text card, a photo and a short video', async ({ browser }) => {
  test.setTimeout(180_000)
  const { ctx, page, mock } = await open(browser, boss, '/admin/stories')
  await expect(page.getByRole('heading', { name: 'Stories' })).toBeVisible()
  await expect(page.getByTestId('admin-stories')).toBeVisible()
  await noSideScroll(page)

  // text
  await page.getByTestId('admin-new-story').click()
  const d = page.getByRole('dialog')
  await d.getByTestId('story-kind-text').click()
  await d.getByTestId('story-text').fill('Alumni Meet registrations are open!')
  await d.getByTestId('story-caption-input').fill('Register before 20 December')
  await d.getByTestId('story-link-input').fill('javascript:alert(1)')
  await expect(d.getByText('Please enter a plain web address that starts with https://')).toBeVisible()
  await expect(d.getByTestId('story-post')).toBeDisabled()
  await d.getByTestId('story-link-input').fill('jecjabalpur.ac.in/news')
  await expect(d.getByTestId('story-post')).toBeEnabled()
  await d.getByTestId('story-link-label').fill('Register now')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 30_000 })
  expect(sql(`select link_url || '|' || link_label from stories where is_official and text_body like 'Alumni Meet%'`)).toBe('https://jecjabalpur.ac.in/news|Register now')
  official = { text: sql(`select id from stories where is_official and text_body like 'Alumni Meet%'`), photo: '', video: '', eventText: '' }

  // a photo (compressed on the phone, kept in the private bucket)
  await page.getByTestId('admin-new-story').click()
  await d.getByTestId('story-kind-photo').click()
  await d.getByTestId('story-file-gallery').setInputFiles(photo(1))
  await expect(d.getByTestId('story-preview')).toBeVisible()
  await d.getByTestId('story-caption-input').fill('Golden jubilee batch')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 60_000 })
  official.photo = sql(`select id from stories where is_official and kind = 'photo'`)
  expect(sql(`select count(*) from storage.objects where bucket_id = 'stories' and name like '${boss.id}/${official.photo}-%'`)).toBe('2')
  expect(sql(`select (select count(*) from storage.buckets where id = 'stories' and not public)`)).toBe('1')

  // a video: the file goes to (the fake) Drive, the row waits until Drive has it
  await page.getByTestId('admin-new-story').click()
  await d.getByTestId('story-kind-video').click()
  await expect(d.getByText(/keep clips short/i)).toBeVisible()
  await d.getByTestId('story-file-gallery').setInputFiles(fixture('clip.webm'))
  await expect(d.getByTestId('story-video-facts')).toContainText('0:02')
  await d.getByTestId('story-caption-input').fill('Campus tour')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 90_000 })
  official.video = sql(`select id from stories where is_official and kind = 'video'`)
  expect(sql(`select drive_file_id like 'FAKEDRIVE%' from stories where id = '${official.video}'`)).toBe('t')
  expect(sql(`select duration_ms between 1500 and 2600 from stories where id = '${official.video}'`)).toBe('t')
  expect(mock.starts.some((s) => s.kind === 'story' && s.id === official.video)).toBe(true)
  expect(mock.finishes.some((f) => f.kind === 'story' && f.id === official.video)).toBe(true)

  await page.reload()
  await expect(page.getByTestId('admin-story')).toHaveCount(3)
  await expect(page.getByTestId('admin-story').first()).toContainText('All verified members')
  expect(sql(`select count(*) from admin_audit where action = 'story_post' and actor = '${boss.id}'`)).toBe('3')
  await noSideScroll(page)
  await ctx.close()
})

test('a member sees the official ring first, watches it (auto-advance, tap, hold), hears the video and sends a heart', async ({ browser }) => {
  test.setTimeout(180_000)
  const { ctx, page } = await open(browser, chetan)
  await expect(page.getByTestId('story-row')).toBeVisible()
  // order: "Add your story", then the official ring
  await expect(rowItems(page).nth(0).getByTestId('story-add')).toBeVisible()
  await expect(rowItems(page).nth(1).getByTestId('story-ring-official')).toBeVisible()
  await expect(rowItems(page).nth(1).getByTestId('story-ring-official')).toHaveAttribute('data-story-state', 'unseen')
  await noSideScroll(page)

  await rowItems(page).nth(1).getByTestId('story-ring-official').click()
  await expect(viewer(page)).toBeVisible()
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'text')
  await expect(page.getByTestId('story-official-badge')).toBeVisible()
  await expect(page.getByTestId('story-text')).toContainText('Alumni Meet registrations are open!')
  await expect(page.getByTestId('story-caption')).toHaveText('Register before 20 December')
  const link = page.getByTestId('story-link')
  await expect(link).toHaveAttribute('href', 'https://jecjabalpur.ac.in/news')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toContainText('Register now')
  await expect(page.getByTestId('story-bar')).toHaveCount(3)
  // a viewer never sees the view counts
  await expect(page.getByTestId('story-views')).toHaveCount(0)

  // auto-advance: a text card plays for 6 seconds, then the photo follows
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'photo', { timeout: 12_000 })
  await expect(page.getByTestId('story-photo')).toBeVisible()
  await expect(page.getByTestId('story-bar').nth(0)).toHaveAttribute('data-fill', '1.00')

  // hold = pause; let go = play on
  const stage = page.getByTestId('story-stage')
  const box = (await stage.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5)
  await page.mouse.down()
  await expect(viewer(page)).toHaveAttribute('data-paused', 'true', { timeout: 3000 })
  const held = await page.getByTestId('story-bar').nth(1).getAttribute('data-fill')
  await page.waitForTimeout(700)
  expect(await page.getByTestId('story-bar').nth(1).getAttribute('data-fill')).toBe(held)
  await page.mouse.up()
  await expect(viewer(page)).toHaveAttribute('data-paused', 'false')
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'photo')

  // the pause button
  await page.getByTestId('story-pause').click()
  await expect(viewer(page)).toHaveAttribute('data-paused', 'true')
  await page.getByTestId('story-pause').click()
  await expect(viewer(page)).toHaveAttribute('data-paused', 'false')

  // heart (one per viewer; the button toggles)
  await page.getByTestId('story-heart').click()
  await expect(page.getByTestId('story-heart')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => sql(`select count(*) from story_hearts where user_id = '${chetan.id}' and story_id = '${official.photo}'`)).toBe('1')

  // tap on the left goes back, tap on the right goes on
  await stage.click({ position: { x: 20, y: box.height / 2 } })
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'text')
  await stage.click({ position: { x: box.width - 30, y: box.height / 2 } })
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'photo')
  await page.keyboard.press('ArrowRight')
  await expect(viewer(page)).toHaveAttribute('data-story-kind', 'video', { timeout: 10_000 })

  // the video starts muted; the sound button toggles; it is streamed through drive-media with the member's token
  await expect(page.getByTestId('story-video')).toBeVisible()
  await expect(page.getByTestId('story-mute')).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('story-mute').click()
  await expect(page.getByTestId('story-mute')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByTestId('story-video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false)
  await page.getByTestId('story-mute').click()
  expect(await page.getByTestId('story-video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)
  // the clip is 2 s long: when it ends there is nothing after it, so the viewer closes by itself
  await expect(viewer(page)).toBeHidden({ timeout: 20_000 })
  await expect(rowItems(page).nth(1).getByTestId('story-ring-official')).toHaveAttribute('data-story-state', 'seen')
  expect(sql(`select count(*) from story_views where viewer_id = '${chetan.id}'`)).toBe('3')

  // Esc closes, and so does the phone's Back button
  await rowItems(page).nth(1).getByTestId('story-ring-official').click()
  await expect(viewer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toBeHidden()
  await rowItems(page).nth(1).getByTestId('story-ring-official').click()
  await expect(viewer(page)).toBeVisible()
  await page.goBack()
  await expect(viewer(page)).toBeHidden()
  await expect(page).toHaveURL(`${ORIGIN}/`)

  // swipe down closes
  await rowItems(page).nth(1).getByTestId('story-ring-official').click()
  const b2 = (await page.getByTestId('story-stage').boundingBox())!
  await page.mouse.move(b2.x + b2.width / 2, b2.y + 200)
  await page.mouse.down()
  await page.mouse.move(b2.x + b2.width / 2, b2.y + 330, { steps: 6 })
  await page.mouse.up()
  await expect(viewer(page)).toBeHidden()
  await ctx.close()
})

test('the admin sees the views and hearts, and an event-only story is invisible to people who are not registered', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = await open(browser, boss, '/admin/stories')
  await expect(a.page.getByTestId('admin-story')).toHaveCount(3)
  const row = a.page.locator(`[data-testid=admin-story][data-story-id="${official.photo}"]`)
  await expect(row.getByTestId('admin-story-views')).toHaveText('1')
  await expect(row.getByTestId('admin-story-hearts')).toHaveText('1')

  // an event-only story from the composer, with the lock note
  await a.page.getByTestId('admin-new-story').click()
  const d = a.page.getByRole('dialog')
  await d.getByTestId('story-kind-text').click()
  await d.getByTestId('story-text').fill('Registered people: bring your pass!')
  await d.getByTestId('story-audience-event').check()
  await expect(d.getByTestId('story-lock-note')).toContainText('Choose the event')
  await d.getByTestId('story-event').selectOption(ev.id)
  await expect(d.getByTestId('story-lock-note')).toContainText('Only members registered for')
  await expect(d.getByTestId('story-lock-note')).toContainText('1 person can see it')
  await d.getByTestId('story-notify').check()
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 30_000 })
  official.eventText = sql(`select id from stories where is_official and audience = 'event'`)
  expect(sql(`select event_id = '${ev.id}' from stories where id = '${official.eventText}'`)).toBe('t')
  expect(sql(`select count(*) from notifications where kind = 'story' and target_id = '${official.eventText}'`)).toBe('1')
  expect(sql(`select user_id = '${veena.id}' from notifications where kind = 'story' and target_id = '${official.eventText}'`)).toBe('t')
  await expect(a.page.getByTestId('admin-story').first()).toContainText('Registered for')
  await expect(a.page.getByTestId('admin-story').first()).toContainText('Told 1 person')
  await a.ctx.close()

  // a stranger: the official ring holds only the three open stories; the database refuses the rest
  expect(sql(`select count(*) from stories where is_official`)).toBe('4')
  const c = await open(browser, chetan)
  await rowItems(c.page).nth(1).getByTestId('story-ring-official').click()
  await expect(page_bars(c.page)).toHaveCount(3)
  await c.page.keyboard.press('Escape')
  const stranger = await chetan.db.rpc('stories_of', { p_official: true })
  expect((stranger.data as unknown[]).length).toBe(3)
  expect((await chetan.db.from('stories').select('id').eq('id', official.eventText)).data).toEqual([])
  expect((await chetan.db.rpc('story_media_ref', { p_story: official.video })).data).toHaveLength(1) // an "everyone" video is fine
  const eventPhoto = sql(`select id from stories where id = '${official.photo}'`)
  expect(eventPhoto).toBe(official.photo)
  await c.ctx.close()

  // the registered member sees four, and gets the notification
  const v = await open(browser, veena, '/notifications')
  await expect(v.page.getByText(/JEC shared a new story: Registered people/)).toBeVisible()
  await v.page.goto('/')
  await rowItems(v.page).nth(1).getByTestId('story-ring-official').click()
  await expect(page_bars(v.page)).toHaveCount(4)
  await expect(v.page.getByTestId('story-text')).toContainText('Alumni Meet registrations')
  await v.page.getByTestId('story-stage').click({ position: { x: 380, y: 300 } })
  await v.page.getByTestId('story-stage').click({ position: { x: 380, y: 300 } })
  await v.page.getByTestId('story-stage').click({ position: { x: 380, y: 300 } })
  await expect(v.page.getByTestId('story-text')).toContainText('Registered people: bring your pass!')
  await v.ctx.close()
})
const page_bars = (page: Page) => page.getByTestId('story-bar')

test('a second notification within the hour is refused', async ({ browser }) => {
  const a = await open(browser, boss, '/admin/stories')
  const row = a.page.locator(`[data-testid=admin-story][data-story-id="${official.text}"]`)
  a.page.once('dialog', (d) => void d.accept())
  await row.getByTestId('admin-notify').click()
  await expect(a.page.getByText('Only one notification an hour can be sent. Please try again later.')).toBeVisible()
  await a.ctx.close()
})

test('a member posts a connections-only story and an "everyone" story: who sees them, in the row and from the profile', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await open(browser, anil)
  await a.page.getByTestId('story-add').click()
  const d = a.page.getByRole('dialog')
  // the default is connections only, and a member has just two choices
  await expect(d.getByTestId('story-audience-connections')).toBeChecked()
  await expect(d.getByTestId('story-audience-all')).toBeVisible()
  await expect(d.getByTestId('story-audience-event')).toHaveCount(0)
  await expect(d.getByTestId('story-link-input')).toHaveCount(0)
  await d.getByTestId('story-kind-text').click()
  await d.getByTestId('story-text').fill('<b>Friends</b> only 💛')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 30_000 })
  expect(sql(`select audience || '|' || text_body from stories where owner_id = '${anil.id}'`)).toBe('connections|<b>Friends</b> only 💛')

  await a.page.getByTestId('story-add').click()
  await d.getByTestId('story-kind-photo').click()
  await d.getByTestId('story-file-gallery').setInputFiles(photo(2))
  await d.getByTestId('story-audience-all').check()
  await d.getByTestId('story-caption-input').fill('Pune meetup')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 60_000 })
  expect(sql(`select count(*) from stories where owner_id = '${anil.id}'`)).toBe('2')
  // "your story" ring shows on your own Home
  await a.page.reload()
  await expect(a.page.getByTestId('story-ring-mine')).toBeVisible()
  await a.ctx.close()

  // Bela (connected): Anil's ring in the row, two stories, the text is shown as plain text (no HTML)
  const b = await open(browser, bela)
  const ring = b.page.locator('[data-testid=story-row] > ul > li').filter({ hasText: 'Anil' }).getByTestId('story-ring')
  await expect(ring).toBeVisible()
  await ring.click()
  await expect(page_bars(b.page)).toHaveCount(2)
  await expect(b.page.getByTestId('story-text')).toHaveText('<b>Friends</b> only 💛')
  await expect(b.page.locator('[data-testid=story-text] b')).toHaveCount(0)
  await b.page.keyboard.press('Escape')
  // ... and from Anil's profile
  await b.page.goto(`/people/${anil.id}`)
  await expect(b.page.getByTestId('story-avatar')).toHaveAttribute('data-story-state', /unseen|seen/)
  await b.page.getByTestId('story-avatar').click()
  await expect(viewer(b.page)).toBeVisible()
  await b.page.keyboard.press('Escape')
  await b.ctx.close()

  // Chetan (a stranger): not in his row's connections; Anil is under "More stories" with the one "everyone" story only
  const c = await open(browser, chetan)
  await expect(c.page.getByTestId('story-more')).toBeVisible()
  const more = c.page.getByTestId('story-more').getByTestId('story-ring').filter({ hasText: 'Anil' })
  await expect(more).toBeVisible()
  await more.click()
  await expect(page_bars(c.page)).toHaveCount(1)
  await expect(viewer(c.page)).toHaveAttribute('data-story-kind', 'photo')
  await expect(c.page.getByTestId('story-caption')).toHaveText('Pune meetup')
  await c.page.keyboard.press('Escape')
  // from the profile and from the directory search too
  await c.page.goto(`/people/${anil.id}`)
  await expect(c.page.getByTestId('story-avatar')).toBeVisible()
  await c.page.goto('/people')
  await c.page.getByRole('searchbox').first().fill(names.anil).catch(() => undefined)
  await expect(c.page.getByRole('link', { name: new RegExp(names.anil) })).toBeVisible({ timeout: 20_000 })
  await expect(c.page.getByTestId('story-avatar').first()).toBeVisible()
  await noSideScroll(c.page)
  expect((await chetan.db.from('stories').select('id').eq('owner_id', anil.id)).data).toHaveLength(1)
  await c.ctx.close()
})

test('a block hides stories in both directions; mute and report work', async ({ browser }) => {
  test.setTimeout(180_000)
  // report and mute from the viewer
  const c = await open(browser, chetan)
  await c.page.getByTestId('story-more').getByTestId('story-ring').filter({ hasText: 'Anil' }).click()
  await c.page.getByTestId('story-options').click()
  await c.page.getByRole('button', { name: 'Report this story' }).click()
  await c.page.getByTestId('story-report-reason').fill('This looks like spam')
  await c.page.getByTestId('story-report-send').click()
  await expect.poll(() => sql(`select count(*) from reports where target_type = 'story' and reporter = '${chetan.id}'`)).toBe('1')
  await c.page.getByTestId('story-options').click()
  await c.page.getByRole('button', { name: new RegExp(`Mute stories from ${names.anil}`) }).click()
  await expect(viewer(c.page)).toBeHidden()
  await expect(c.page.getByTestId('story-more')).toHaveCount(0)
  expect(sql(`select count(*) from story_mutes where user_id = '${chetan.id}'`)).toBe('1')
  // reachable from the profile still; unmute from there is via the database in this test
  sql(`delete from story_mutes where user_id = '${chetan.id}'`)
  await c.ctx.close()

  // the moderation queue lists the story
  const m = await makeUser(`mod${ts}`, { admin: true, name: `Mod ${ts}` })
  const mp = await open(browser, m, '/admin/reports')
  await expect(mp.page.getByText('Story', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  await mp.ctx.close()
  sql(`delete from reports where target_type = 'story'`)

  // Anil blocks Chetan: Chetan sees nothing of Anil's any more
  sql(`insert into blocks (blocker, blocked) values ('${anil.id}', '${chetan.id}')`)
  const c2 = await open(browser, chetan)
  await expect(c2.page.getByTestId('story-row')).toBeVisible()
  await expect(c2.page.getByTestId('story-more')).toHaveCount(0)
  expect((await chetan.db.rpc('story_rings', { p_ids: [anil.id] })).data).toEqual([])
  await c2.ctx.close()
  sql(`delete from blocks where blocker = '${anil.id}'`)
})

test('after 24 hours a story is gone from the row; a highlight keeps it, even after the cleanup; the owner can delete', async ({ browser }) => {
  test.setTimeout(240_000)
  const friends = sql(`select id from stories where owner_id = '${anil.id}' and audience = 'connections'`)
  const everyone = sql(`select id from stories where owner_id = '${anil.id}' and audience = 'all'`)
  // time passes
  sql(`update stories set expires_at = now() - interval '2 hours' where id = '${friends}'`)
  const b0 = await open(browser, bela)
  const anilRing = b0.page.locator('[data-testid=story-row] > ul > li').filter({ hasText: 'Anil' })
  await expect(anilRing.getByTestId('story-ring')).toBeVisible() // the "everyone" one is still live
  await anilRing.getByTestId('story-ring').click()
  await expect(page_bars(b0.page)).toHaveCount(1)
  await b0.page.keyboard.press('Escape')
  await b0.ctx.close()
  sql(`update stories set expires_at = now() - interval '1 minute' where id = '${everyone}'`)
  const b1 = await open(browser, bela)
  await expect(b1.page.getByTestId('story-row')).toBeVisible()
  await expect(b1.page.locator('[data-testid=story-row] > ul > li').filter({ hasText: 'Anil' })).toHaveCount(0)
  await b1.ctx.close()

  // Anil keeps the old friends-only story in a highlight
  const a = await open(browser, anil, '/me')
  await expect(a.page.getByTestId('my-stories')).toBeVisible()
  await expect(a.page.getByTestId('my-story')).toHaveCount(2)
  await expect(a.page.getByTestId('my-stories').getByText('Expired').first()).toBeVisible()
  await a.page.locator(`[data-testid=my-story][data-story-id="${friends}"]`).getByTestId('my-story-save').click()
  await a.page.getByTestId('story-new-highlight').fill('Campus days')
  await a.page.getByTestId('story-new-highlight').press('Enter')
  await expect(a.page.getByText('Saved to the highlight.')).toBeVisible()
  await expect(a.page.getByTestId('profile-highlights').getByText('Campus days')).toBeVisible()
  expect(sql(`select count(*) from story_highlight_items where story_id = '${friends}'`)).toBe('1')
  await a.ctx.close()

  // the cleanup removes the loose expired story but never one in a highlight
  sql(`update stories set expires_at = now() - interval '10 days' where id in ('${friends}', '${everyone}')`)
  expect(Number(sql('select public.stories_cleanup()'))).toBeGreaterThanOrEqual(1)
  expect(sql(`select count(*) from stories where id = '${friends}'`)).toBe('1')
  expect(sql(`select count(*) from stories where id = '${everyone}'`)).toBe('0')

  // Bela (connected) opens the highlight on Anil's profile and watches the expired story; Chetan (stranger) does not see the highlight
  const b = await open(browser, bela, `/people/${anil.id}`)
  const circle = b.page.getByTestId('profile-highlights').getByTestId('highlight-circle')
  await expect(circle).toHaveCount(1)
  await circle.click()
  await expect(viewer(b.page)).toBeVisible()
  await expect(b.page.getByTestId('story-text')).toHaveText('<b>Friends</b> only 💛')
  await b.page.keyboard.press('Escape')
  await b.ctx.close()
  const c = await open(browser, chetan, `/people/${anil.id}`)
  await expect(c.page.getByTestId('profile-highlights')).toHaveCount(0)
  await c.ctx.close()

  // Anil shares the highlight with everyone: now Chetan sees it
  const a2 = await open(browser, anil, '/me')
  await a2.page.getByTestId('profile-highlights').getByRole('button', { name: /Edit/ }).click()
  await a2.page.getByTestId('highlight-audience').selectOption('all')
  await a2.page.getByTestId('highlight-save').click()
  await expect(a2.page.getByText('Highlight saved.')).toBeVisible()
  await a2.ctx.close()
  const c2 = await open(browser, chetan, `/people/${anil.id}`)
  await expect(c2.page.getByTestId('profile-highlights').getByTestId('highlight-circle')).toHaveCount(1)
  await c2.ctx.close()

  // delete: the owner removes a live story from the viewer
  const a3 = await open(browser, anil)
  await a3.page.getByTestId('story-add').click()
  const d = a3.page.getByRole('dialog')
  await d.getByTestId('story-kind-text').click()
  await d.getByTestId('story-text').fill('Delete me')
  await d.getByTestId('story-post').click()
  await expect(d).toBeHidden({ timeout: 30_000 })
  await a3.page.getByTestId('story-ring-mine').click()
  await expect(viewer(a3.page)).toBeVisible()
  await expect(page_bars(a3.page)).toHaveCount(1)
  // the owner sees the counts and the viewers button
  await expect(a3.page.getByTestId('story-views')).toHaveText('0')
  a3.page.once('dialog', (dlg) => void dlg.accept())
  await a3.page.getByTestId('story-options').click()
  await a3.page.getByRole('button', { name: 'Delete story' }).click()
  await expect(viewer(a3.page)).toBeHidden({ timeout: 15_000 })
  expect(sql(`select count(*) from stories where text_body = 'Delete me'`)).toBe('0')
  await a3.ctx.close()
})

test('official highlights: the admin builds one, members see it on Home and on the Highlights page', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = await open(browser, boss, '/admin/stories?tab=highlights')
  await a.page.getByTestId('admin-new-highlight').click()
  const d = a.page.getByRole('dialog')
  await d.getByTestId('highlight-title').fill('Reunion 2025')
  await d.getByTestId('highlight-audience').selectOption('all')
  await d.getByTestId('highlight-add-story').first().click()
  await d.getByTestId('highlight-add-story').first().click()
  await expect(d.getByTestId('highlight-items').locator('li')).toHaveCount(2)
  await d.getByTestId('highlight-save').click()
  await expect(a.page.getByText('Highlight saved.')).toBeVisible()
  await expect(a.page.getByTestId('admin-highlight')).toHaveCount(1)
  await a.ctx.close()

  const c = await open(browser, chetan)
  await expect(c.page.getByTestId('highlights-strip')).toContainText('Reunion 2025')
  await c.page.getByTestId('highlights-strip').getByTestId('highlight-circle').click()
  await expect(viewer(c.page)).toBeVisible()
  await expect(page_bars(c.page)).toHaveCount(2)
  await c.page.keyboard.press('Escape')
  await c.page.goto('/highlights')
  await expect(c.page.getByTestId('highlights-official')).toContainText('Reunion 2025')
  await noSideScroll(c.page)
  await c.ctx.close()
})

test('Hindi and a 360 px phone: the row, the viewer and the composer fit without sideways scrolling', async ({ browser }) => {
  test.setTimeout(120_000)
  sql(`update profiles set language = 'hi' where id = '${chetan.id}'`)
  const c = await open(browser, chetan, '/', { width: 360 })
  await expect(c.page.getByTestId('story-add')).toContainText('अपनी स्टोरी जोड़ें')
  await expect(c.page.getByTestId('story-ring-official')).toContainText('आधिकारिक')
  await noSideScroll(c.page)
  await c.page.getByTestId('story-ring-official').click()
  await expect(viewer(c.page)).toBeVisible()
  await expect(c.page.getByTestId('story-official-badge')).toContainText('आधिकारिक')
  await noSideScroll(c.page)
  const vb = (await viewer(c.page).boundingBox())!
  expect(vb.width).toBeLessThanOrEqual(360)
  for (const id of ['story-close', 'story-pause', 'story-options']) {
    const b = (await c.page.getByTestId(id).boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(44)
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
  await c.page.keyboard.press('Escape')
  await c.page.getByTestId('story-add').click()
  await expect(c.page.getByRole('dialog')).toContainText('आपकी स्टोरी 24 घंटे बाद हट जाएगी')
  await noSideScroll(c.page)
  const box = (await c.page.getByRole('dialog').boundingBox())!
  expect(box.width).toBeLessThanOrEqual(360)
  await c.ctx.close()
  sql(`update profiles set language = 'en' where id = '${chetan.id}'`)
})

test('reduced motion: the viewer still plays on its own and has a pause button', async ({ browser }) => {
  test.setTimeout(90_000)
  const c = await open(browser, veena, '/', { reducedMotion: true })
  await c.page.getByTestId('story-ring-official').click()
  await expect(viewer(c.page)).toBeVisible()
  await expect(viewer(c.page)).toHaveAttribute('data-story-kind', 'text')
  await expect(viewer(c.page)).toHaveAttribute('data-story-kind', 'photo', { timeout: 14_000 })
  await expect(c.page.getByTestId('story-pause')).toBeVisible()
  await c.ctx.close()
})

test('the data download carries your stories', async ({ browser }) => {
  const a = await open(browser, anil, '/me')
  const dl = a.page.waitForEvent('download')
  await a.page.getByRole('button', { name: 'Download my data' }).click()
  const file = await (await dl).path()
  const json = JSON.parse((await import('node:fs')).readFileSync(file!, 'utf8')) as Record<string, unknown[]>
  expect(Array.isArray(json.stories)).toBe(true)
  expect(json.stories.length).toBeGreaterThanOrEqual(1)
  expect(Array.isArray(json.story_highlights)).toBe(true)
  expect(json.story_highlights.length).toBe(1)
  await a.ctx.close()
})
