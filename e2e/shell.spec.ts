import { expect, test, type Browser, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function member(browser: Browser, tag: string, size: { width: number; height: number }, mobile: boolean, colorScheme: 'light' | 'dark' = 'light') {
  const email = `${tag}.${run}@example.com`
  const name = `Shell ${tag} ${run}`
  const ctx = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile, colorScheme })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, '2008')
  const id = sql(`select id from auth.users where email = '${email}'`)
  sql(`update profiles set verification = 'verified' where id = '${id}'`)
  await page.reload()
  return { ctx, page, id, name }
}

test('phone: Create sheet, notifications centre, command search, drawer profile card, 360 fit', async ({ browser }) => {
  const a = await member(browser, 'ph', { width: 360, height: 800 }, true)
  const { page } = a
  const other = sql(`select id from profiles where id <> '${a.id}' and full_name <> '' limit 1`)
  sql(`insert into notifications (user_id, actor_id, kind, created_at) values ('${a.id}', '${other}', 'like', now()), ('${a.id}', '${other}', 'connection_request', now() - interval '3 days')`)
  await page.reload()

  // Create
  await page.getByRole('button', { name: 'Create' }).click()
  const sheet = page.getByRole('dialog', { name: 'Create' })
  for (const t of ['Post to feed', 'Add story', 'Share photos and videos', 'Post a job', 'Ask JEC', 'Start a chat']) await expect(sheet.getByRole('button', { name: new RegExp(t) })).toBeVisible()
  expect(await noHScroll(page)).toBe(true)
  await sheet.getByRole('button', { name: /Post a job/ }).click()
  await expect(page).toHaveURL(/\/jobs\/new$/)
  await page.goto('/')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('dialog', { name: 'Create' }).getByRole('button', { name: /Post to feed/ }).click()
  await expect(page.getByRole('textbox', { name: 'Post text' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Notifications
  const bell = page.getByTestId('topbar-bell')
  await expect(bell).toHaveAccessibleName(/2 unread/)
  await bell.click()
  const centre = page.getByRole('dialog', { name: 'Notifications' })
  await expect(centre.getByText('Today', { exact: true })).toBeVisible()
  await expect(centre.getByText('Earlier', { exact: true })).toBeVisible()
  await centre.getByRole('button', { name: 'Mark all read' }).click()
  await expect(centre.getByRole('button', { name: 'Mark all read' })).toHaveCount(0)
  expect(sql(`select count(*) from notifications where user_id = '${a.id}' and read_at is null`)).toBe('0')
  await centre.locator('li button').last().click()
  await expect(page).toHaveURL(/\/me\/connections$/)

  // Command search: a member and a page, by keyboard
  await page.getByTestId('topbar').getByRole('button', { name: 'Search' }).click()
  const palette = page.getByRole('dialog', { name: 'Search' })
  const box = palette.getByRole('combobox')
  await expect(box).toBeFocused()
  await box.fill(`Shell ph ${run}`)
  await expect(palette.getByRole('option', { name: new RegExp(`Shell ph ${run}`) })).toBeVisible()
  await box.fill('badges')
  await expect(palette.getByRole('option', { name: /My badges/ })).toBeVisible()
  await box.press('ArrowDown')
  await box.press('ArrowUp')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/me\/badges$/)
  await page.getByTestId('topbar').getByRole('button', { name: 'Search' }).click()
  await page.getByRole('combobox').fill('zzqqxxzz')
  await expect(page.getByText(/Nothing for/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)

  // Drawer profile card
  await page.goto('/')
  await page.getByTestId('topbar').getByRole('button', { name: 'Menu' }).click()
  const card = page.getByTestId('drawer-profile')
  await expect(card).toContainText(a.name)
  await expect(card).toContainText('Batch 2008')
  await expect(card.getByRole('link', { name: 'View profile' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Digital ID card' })).toBeVisible()
  expect(await noHScroll(page)).toBe(true)
  await page.keyboard.press('Escape')
  for (const p of ['/', '/groups', '/me', '/meet']) {
    await page.goto(p)
    expect(await noHScroll(page), p).toBe(true)
  }
  await a.ctx.close()
})

test('desktop: Ctrl+K search, sidebar collapses to a rail and remembers it; dark mode', async ({ browser }) => {
  const a = await member(browser, 'dk', { width: 1440, height: 900 }, false, 'dark')
  const { page } = a
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('sidebar-user')).toBeVisible()
  await page.keyboard.press('Control+k')
  const box = page.getByRole('dialog', { name: 'Search' }).getByRole('combobox')
  await expect(box).toBeFocused()
  await box.fill('jobs')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/jobs$/)

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar-rail')).toBeVisible()
  await expect(page.getByTestId('sidebar-menu')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('sidebar-rail')).toBeVisible()
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar-menu')).toBeVisible()
  await expect(page.getByTestId('sidebar-user')).toContainText(a.name)
  await a.ctx.close()
})
