import { expect, test } from '@playwright/test'
import { makeCircle, onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

test('Hindi interface: switch from the profile page, persists on the profile, switch back', async ({ page }) => {
  const email = `hindi.${run}@example.com`
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/signin')
  // English by default, with a small language switch on the sign-in page
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Use my email instead' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'भाषा / Language' })).toBeVisible()

  await signInWithEmail(page, email)
  await onboard(page, `Hindi ${run}`, '2008')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toBeVisible()
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  const dbLang = () => sql(`select language from profiles where id = (select id from auth.users where email = '${email}')`)
  expect(dbLang()).toBe('en')
  makeCircle('hindi', [email])

  // switch from the profile page
  await page.goto('/me')
  await page.getByRole('button', { name: 'हिन्दी' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  const nav = page.getByRole('navigation', { name: 'मुख्य' })
  for (const label of ['होम', 'ग्रुप', 'मीट 2026', 'चैट']) await expect(nav.getByRole('link', { name: label })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'मेनू' })).toBeVisible()
  await expect.poll(dbLang).toBe('hi')

  // Home and Meet headings are Hindi; digits stay Western
  await nav.getByRole('link', { name: 'होम' }).click()
  await expect(page.getByText('आपकी प्रोफ़ाइल', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('% पूरी है').first()).toBeVisible()
  await page.screenshot({ path: '/tmp/hindi-home.png', fullPage: false })

  await nav.getByRole('link', { name: 'मीट 2026' }).click()
  await expect(page.getByText('जबलपुर इंजीनियरिंग कॉलेज')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'पंजीकरण शुल्क' }).or(page.getByText('पंजीकरण शुल्क')).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'अभी पंजीकरण करें' }).first()).toBeVisible()
  await page.screenshot({ path: '/tmp/hindi-meet.png', fullPage: false })
  await page.screenshot({ path: '/tmp/hindi-meet-full.png', fullPage: true })

  await nav.getByRole('link', { name: 'चैट' }).click()
  await expect(page.getByRole('heading', { name: 'चैट' })).toBeVisible()
  await expect(page.getByPlaceholder('चैट खोजें')).toBeVisible()
  await expect(page.getByText('Circle hindi')).toBeVisible()
  await page.screenshot({ path: '/tmp/hindi-chat.png', fullPage: false })

  // reload: stays Hindi; the profile wins over a stale local value
  await page.evaluate(() => localStorage.setItem('jec-lang', 'en'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('navigation', { name: 'मुख्य' }).getByRole('link', { name: 'चैट' })).toBeVisible()
  expect(dbLang()).toBe('hi')

  // no horizontal scrolling at 390px in Hindi
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // back to English from the profile page
  await page.goto('/me')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toBeVisible()
  await expect.poll(dbLang).toBe('en')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Chat' })).toBeVisible()
})

test('Hindi works before signing in, and the sign-in screen is translated', async ({ page }) => {
  await page.goto('/signin')
  await page.getByRole('button', { name: 'हिन्दी' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('heading', { name: 'स्वागत है, JECian' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Google से जारी रखें' })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('heading', { name: 'स्वागत है, JECian' })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, JECian' })).toBeVisible()
})
