import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 5) % 26))

async function member(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page }
}

test('admin approves a proposed circle, features a member and sets a batch size', async ({ browser }) => {
  const boss = await member(browser, `cboss.${run}@example.com`, `Boss ${run}`)
  const asha = await member(browser, `casha.${run}@example.com`, `Asha ${run}`)
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = 'cboss.${run}@example.com')`)
  await boss.page.reload()

  // a member proposes a circle: it is hidden from others until approved
  await asha.page.goto('/groups')
  await asha.page.getByRole('button', { name: /New circle/ }).click()
  await asha.page.getByLabel('Circle name').fill(`Pune Techies ${run}`)
  await asha.page.getByLabel('What is it about?').fill('JECians working in Pune')
  await asha.page.getByRole('button', { name: 'Propose' }).click()
  await expect(asha.page.getByText('Circle proposed')).toBeVisible()
  expect(sql(`select is_approved from groups where name = 'Pune Techies ${run}'`)).toBe('f')

  // the admin sees and approves it
  await boss.page.goto('/admin/community')
  const card = boss.page.locator('li').filter({ hasText: `Pune Techies ${run}` })
  await expect(card).toContainText(`Asha ${run}`)
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(boss.page.getByText('Circle approved')).toBeVisible()
  expect(sql(`select is_approved from groups where name = 'Pune Techies ${run}'`)).toBe('t')

  // spotlight appears on Home for members
  await boss.page.getByLabel('Member').fill(`Asha ${run}`)
  await boss.page.getByRole('button', { name: new RegExp(`Asha ${run}`) }).click()
  await boss.page.getByLabel('Headline').fill(`Built a startup from Jabalpur ${run}`)
  await boss.page.getByRole('button', { name: 'Publish spotlight' }).click()
  await expect(boss.page.getByText('Spotlight published')).toBeVisible()
  await asha.page.goto('/')
  await expect(asha.page.getByText(`Built a startup from Jabalpur ${run}`)).toBeVisible()

  // batch size: the invite screen shows progress against it
  await boss.page.getByLabel('Passing-out year').selectOption(year)
  await boss.page.getByLabel('Branch').selectOption('Computer Science & Engineering')
  await boss.page.getByLabel('Students').fill('100')
  await boss.page.getByRole('button', { name: 'Save batch size' }).click()
  await expect(boss.page.getByText(`Batch ${year} · Computer Science & Engineering`)).toBeVisible()
  await asha.page.goto('/invite')
  await expect(asha.page.getByText(/on board · \d+%/)).toBeVisible()

  // all of it is in the activity log
  expect(Number(sql(`select count(*) from admin_audit where action in ('groups_update', 'spotlights_insert', 'batch_sizes_insert')`))).toBeGreaterThanOrEqual(3)
  await boss.ctx.close()
  await asha.ctx.close()
})
