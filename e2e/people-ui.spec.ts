import { expect, test, type Page } from '@playwright/test'
import { makeCircle, onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 5) % 26))

async function member(page: Page, email: string, name: string) {
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('profile, directory, groups and chat render the premium layer without overflow at 360px, light and dark', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const email = `ui.${run}@example.com`
  await member(page, email, `Uma ${run}`)
  const uid = sql(`select id from auth.users where email = '${email}'`)
  sql(`insert into experiences (profile_id, title, company, is_current, start_date) values ('${uid}', 'Engineer', 'Acme Corp', true, '2019-01-01')`)

  // profile: cover banner, stats, badges strip, timeline, privacy switches
  await page.goto('/me')
  await expect(page.getByTestId('profile-cover')).toBeVisible()
  await expect(page.getByTestId('profile-stats')).toBeVisible()
  await expect(page.getByTestId('profile-badges')).toBeVisible()
  await expect(page.getByTestId('timeline-item')).toHaveCount(1)
  await expect(page.getByRole('switch').first()).toBeVisible()
  expect(await noOverflow(page)).toBe(true)
  await page.getByTestId('profile-badges').getByRole('button').first().click()
  await expect(page.getByTestId('badge-sheet')).toBeVisible()
  await page.keyboard.press('Escape')

  // directory: filters + grid toggle
  await page.goto('/people')
  await expect(page.getByTestId('people-filters')).toBeVisible()
  await page.getByRole('tab', { name: 'Grid' }).click()
  await expect(page.getByTestId('member-card').first()).toBeVisible()
  await page.getByRole('tab', { name: 'List' }).click()
  await expect(page.getByTestId('member-row').first()).toBeVisible()
  await page.getByRole('button', { name: 'My batch' }).click()
  await expect(page.getByTestId('people-count')).toBeVisible()
  expect(await noOverflow(page)).toBe(true)

  // groups: sections and cover tiles
  await page.goto('/groups')
  await expect(page.locator('[data-section="Official"]')).toBeVisible()
  await expect(page.getByTestId('group-tile').first()).toBeVisible()
  expect(await noOverflow(page)).toBe(true)

  // chat: own bubble, then dark mode
  const chatId = makeCircle('ui', [email])
  await page.goto(`/chat/${chatId}`)
  await page.getByLabel('Message', { exact: true }).fill(`Hello ${run}`)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(`Hello ${run}`)).toBeVisible()
  await page.evaluate(() => localStorage.setItem('jec-theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await noOverflow(page)).toBe(true)
  await ctx.close()
})
