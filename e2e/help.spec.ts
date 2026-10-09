import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 11) % 26))

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

test('ask for help, the right helper is told and replies by message, asker resolves', async ({ browser }) => {
  const helper = await member(browser, `hhelper.${run}@example.com`, `Helper ${run}`)
  const bystander = await member(browser, `hby.${run}@example.com`, `Bystander ${run}`)
  const asker = await member(browser, `hasker.${run}@example.com`, `Asker ${run}`)
  sql(`update profiles set help_tags = array['Mock interviews'] where id = (select id from auth.users where email = 'hhelper.${run}@example.com')`)
  const question = `Need mock interview practice ${run}`

  // asking is checked first, then goes live
  await asker.page.goto('/help')
  await asker.page.getByRole('button', { name: 'Ask', exact: true }).click()
  const sheet = asker.page.getByRole('dialog', { name: 'Ask for help' })
  await sheet.getByLabel('Topic').selectOption('Mock interviews')
  await sheet.getByLabel('Your question').fill('hi')
  await sheet.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(sheet.getByText(/at least 5 characters/)).toBeVisible()
  await sheet.getByLabel('Your question').fill(question)
  await sheet.getByLabel('More detail').fill('Backend roles, 4 years of experience.')
  await sheet.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(asker.page.getByText('Your question is up.')).toBeVisible()
  await expect(asker.page.getByRole('list', { name: 'Questions' }).getByText(question)).toBeVisible()

  // only the member who offers this help is told (in the app)
  await expect.poll(() => sql(`select count(*) from notifications where kind = 'help_request' and body = '${question}' and user_id = (select id from auth.users where email = 'hhelper.${run}@example.com')`)).toBe('1')
  await helper.page.goto('/notifications')
  await expect(helper.page.getByText(new RegExp(`Asker ${run} asked for help`))).toBeVisible()
  expect(sql(`select count(*) from notifications where kind = 'help_request' and user_id in (select id from auth.users where email in ('hby.${run}@example.com', 'hasker.${run}@example.com'))`)).toBe('0') // not the bystander, never the asker

  // the helper sees "You can help", filters "For me", and replies by message
  await helper.page.goto('/help')
  const card = helper.page.getByRole('list', { name: 'Questions' }).locator('li').filter({ hasText: question })
  await expect(card).toContainText('You can help')
  await helper.page.getByRole('button', { name: 'For me' }).click()
  await expect(card).toBeVisible()
  await bystander.page.goto('/help')
  await bystander.page.getByRole('button', { name: 'Mock interviews' }).click()
  await expect(bystander.page.getByText(question)).toBeVisible() // everyone can read; only the offerers are notified
  await card.getByRole('button', { name: 'Reply by message' }).click()
  await expect(helper.page).toHaveURL(/\/chat\//)
  await helper.page.getByLabel('Message', { exact: true }).fill('Happy to help, free this weekend?')
  await helper.page.getByRole('button', { name: 'Send' }).click()
  await expect(helper.page.getByText('Happy to help, free this weekend?')).toBeVisible()

  // the asker resolves it; it leaves the board unless "Include resolved" is on
  await asker.page.goto('/help')
  const mine = asker.page.getByRole('list', { name: 'Questions' }).locator('li').filter({ hasText: question })
  await expect(mine.getByRole('button', { name: 'Reply by message' })).toHaveCount(0) // not on your own question
  await mine.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(asker.page.getByText('Marked as resolved')).toBeVisible()
  await expect(mine).toHaveCount(0)
  await asker.page.getByRole('button', { name: 'Include resolved' }).click()
  await expect(mine).toContainText('Resolved')

  for (const m of [helper, bystander, asker]) await m.ctx.close()
})
