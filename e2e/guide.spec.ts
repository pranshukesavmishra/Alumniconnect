// The "How to use" guide: public route with the one-minute video, chapters that seek it, the language toggle, the menu entry,
// the dismissible Home card, and 360 px. The video files are static (public/guide).
//   PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/guide.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'
import { CHAPTERS } from '../src/features/guide/chapters'

const run = Date.now().toString(36).slice(-5)
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const video = (page: Page) => page.getByTestId('guide-video')

test('signed out: the guide opens, with the video, eight chapters, written steps and a help line', async ({ page }) => {
  await page.goto('/guide')
  await expect(page.getByRole('heading', { name: 'How to use' }).first()).toBeVisible()
  await expect(video(page)).toBeVisible()
  await expect(video(page)).toHaveAttribute('preload', 'metadata')
  await expect(video(page)).toHaveAttribute('poster', '/guide/poster-en.webp')
  await expect(video(page).locator('source')).toHaveAttribute('src', '/guide/guide-en.mp4')
  await expect(video(page).locator('track')).toHaveAttribute('src', '/guide/guide-en.vtt')
  await expect(page.getByTestId('guide-chapters').getByRole('button')).toHaveCount(8)
  await expect(page.getByRole('heading', { name: 'Register and pay' })).toBeVisible()
  await expect(page.getByTestId('guide-help')).toBeVisible()
  // the static files exist
  for (const f of ['guide-en.mp4', 'guide-hi.mp4', 'guide-en.vtt', 'guide-hi.vtt', 'poster-en.webp', 'poster-hi.webp']) {
    const r = await page.request.get(`/guide/${f}`, { headers: { Range: 'bytes=0-99' } })
    expect([200, 206], f).toContain(r.status())
  }
  const vtt = await (await page.request.get('/guide/guide-en.vtt')).text()
  expect(vtt.startsWith('WEBVTT')).toBe(true)
})

test('tapping a chapter seeks the video to that step', async ({ page }) => {
  await page.goto('/guide')
  const playable = await video(page).evaluate((v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '')
  await page.getByTestId('guide-chapters').getByRole('button', { name: /Play step 3/ }).click()
  if (!playable) {
    test.info().annotations.push({ type: 'note', description: 'this Chromium build has no H.264: the seek itself is covered by the helper unit test' })
    return
  }
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThanOrEqual(CHAPTERS.en[2]!.start)
  await expect(page.getByTestId('guide-chapters').getByRole('button', { name: /Play step 3/ })).toHaveAttribute('aria-current', 'true')
})

test('the language toggle switches the video, captions and chapter titles', async ({ page }) => {
  await page.goto('/guide')
  const en = page.getByRole('button', { name: 'English', exact: true })
  const hi = page.getByRole('button', { name: 'हिन्दी', exact: true })
  await expect(en).toHaveAttribute('aria-pressed', 'true')
  await hi.click()
  await expect(hi).toHaveAttribute('aria-pressed', 'true')
  await expect(video(page).locator('source')).toHaveAttribute('src', '/guide/guide-hi.mp4')
  await expect(video(page).locator('track')).toHaveAttribute('src', '/guide/guide-hi.vtt')
  await expect(video(page)).toHaveAttribute('poster', '/guide/poster-hi.webp')
  await en.click()
  await expect(video(page).locator('source')).toHaveAttribute('src', '/guide/guide-en.mp4')
})

test('the app language picks the video language', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('jec-lang', 'hi'))
  const page = await ctx.newPage()
  await page.goto('/guide')
  await expect(video(page).locator('source')).toHaveAttribute('src', '/guide/guide-hi.mp4')
  await ctx.close()
})

test('360px: nothing overflows, targets are 44px, signed out', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/guide')
  await expect(video(page)).toBeVisible()
  expect(await noHScroll(page)).toBe(true)
  for (const b of await page.getByTestId('guide-chapters').getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  for (const name of ['English', 'हिन्दी']) expect((await page.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await ctx.close()
})

test('the sign-in page links to the guide', async ({ page }) => {
  await page.goto('/signin')
  await page.getByTestId('signin-guide-link').click()
  await expect(page).toHaveURL(/\/guide$/)
})

test('a member finds How to use in the menu and a dismissible card on Home', async ({ browser }) => {
  const email = `guide.${run}@example.com`
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `Guide ${run}`, '2006')
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.goto('/')
  const card = page.getByTestId('home-guide-card')
  await expect(card).toBeVisible()
  // menu entry
  await page.getByRole('button', { name: /menu/i }).first().click()
  await page.getByRole('button', { name: /^Me/ }).first().click()
  await page.getByRole('link', { name: 'How to use' }).filter({ visible: true }).first().click()
  await expect(page).toHaveURL(/\/guide$/)
  await expect(page.getByTestId('guide-help').getByRole('link', { name: 'Ask JEC' })).toBeVisible()
  // the card goes away for good once dismissed
  await page.goto('/')
  await page.getByTestId('home-guide-card').getByRole('button', { name: 'Hide this card' }).click()
  await expect(page.getByTestId('home-guide-card')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('home-guide-card')).toHaveCount(0)
  await ctx.close()
})
