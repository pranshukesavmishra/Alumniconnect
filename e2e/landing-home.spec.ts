import { expect, test, type Browser, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 7) % 26))
const city = `Zephyrtown${run}`

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function member(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page, email }
}

test('landing: hero, stats, countdown, globe or fallback, CTA to sign-in, no sideways scroll', async ({ browser }) => {
  for (const width of [360, 390, 412]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Where every JECian')
    await expect(page.getByTestId('landing-stats')).toBeVisible()
    await expect(page.getByRole('timer').first()).toBeVisible()
    await page.getByTestId('landing').evaluate((el) => el.scrollIntoView())
    await page.locator('#world').scrollIntoViewIfNeeded()
    // the globe canvas (WebGL) or, without WebGL, the list fallback
    await expect(page.getByTestId('world-globe').or(page.getByTestId('world-fallback')).first()).toBeVisible({ timeout: 20_000 })
    expect(await noHScroll(page), `landing at ${width}`).toBe(true)
    if (width === 360) {
      await page.getByRole('link', { name: 'Join your batch' }).first().click()
      await expect(page).toHaveURL(/\/signin/)
    }
    await ctx.close()
  }
})

test('landing with reduced motion still shows everything', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 800 } })
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('comes home.')
  await expect(page.getByRole('link', { name: 'Explore Alumni Meet 2026' })).toBeVisible()
  await ctx.close()
})

test('/world sends visitors to the landing globe', async ({ page }) => {
  await page.goto('/world')
  await expect(page).toHaveURL(/\/#world$|\/$/)
  await expect(page.getByTestId('landing')).toBeVisible()
})

test('home sections, quick actions, anniversary; JEC World lists a city, opens members and honours the privacy switch', async ({ browser }) => {
  const a = await member(browser, `land.a.${run}@example.com`, `Landa ${run}`)
  const b = await member(browser, `land.b.${run}@example.com`, `Landb ${run}`)
  const aid = sql(`select id from auth.users where email = 'land.a.${run}@example.com'`)
  const bid = sql(`select id from auth.users where email = 'land.b.${run}@example.com'`)
  // a seeded city (Pune is in the bundled table; use it for both) and a plain graduation anniversary
  sql(`update profiles set city = 'Pune', country = 'India' where id in ('${aid}', '${bid}')`)

  await a.page.goto('/')
  await expect(a.page.getByRole('heading', { level: 1 })).toContainText('Landa')
  await expect(a.page.getByTestId('home-next-up')).toBeVisible()
  await expect(a.page.getByTestId('home-batch')).toBeVisible()
  const quick = a.page.getByRole('region', { name: 'Quick actions' })
  await expect(quick.getByRole('link', { name: 'Groups' })).toBeVisible()
  await expect(quick.getByRole('link', { name: 'Jobs' })).toBeVisible()
  await expect(a.page.getByTestId('home-anniversary')).toBeVisible()
  expect(await noHScroll(a.page)).toBe(true)

  // JEC World: the list view groups by country and lists Pune
  await a.page.goto('/world')
  await expect(a.page.getByTestId('world-totals')).toBeVisible()
  await a.page.getByRole('tab', { name: 'List' }).click()
  const pune = a.page.getByTestId('world-places').getByRole('button', { name: /Pune/ })
  await expect(pune).toBeVisible()
  await pune.click()
  const members = a.page.getByTestId('world-members')
  await expect(members.getByRole('link', { name: new RegExp(`Landb ${run}`) })).toBeVisible()

  // hiding myself removes me from the city list others see
  await a.page.keyboard.press('Escape')
  await a.page.getByRole('switch', { name: /Show me on the map/ }).click()
  await expect.poll(() => sql(`select show_on_world_map from member_showcase_prefs where user_id = '${aid}'`)).toBe('f')
  await b.page.goto('/world')
  await b.page.getByRole('tab', { name: 'List' }).click()
  await b.page.getByTestId('world-places').getByRole('button', { name: /Pune/ }).click()
  await expect(b.page.getByTestId('world-members').getByRole('link', { name: new RegExp(`Landb ${run}`) })).toBeVisible()
  await expect(b.page.getByTestId('world-members').getByRole('link', { name: new RegExp(`Landa ${run}`) })).toHaveCount(0)
  void city
  await a.ctx.close()
  await b.ctx.close()
})
