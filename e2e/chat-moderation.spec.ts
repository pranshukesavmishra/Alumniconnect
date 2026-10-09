import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 13) % 26))

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

test('slow mode limits members; reported messages reach admins who can remove them', async ({ browser }) => {
  const boss = await member(browser, `boss.${run}@example.com`, `Boss ${run}`)
  const talker = await member(browser, `talker.${run}@example.com`, `Talker ${run}`)
  const reporter = await member(browser, `reporter.${run}@example.com`, `Reporter ${run}`)
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = 'boss.${run}@example.com')`)
  await boss.page.reload()
  const chatId = sql(`select c.id from chats c join groups g on g.id = c.group_id where g.slug = 'computer-science-engineering-${year}'`)

  // admin turns on slow mode (1 minute)
  await boss.page.goto(`/chat/${chatId}`)
  await boss.page.getByRole('button', { name: 'Slow mode' }).click()
  await boss.page.getByRole('dialog', { name: 'Slow mode' }).getByRole('button', { name: '1 minute' }).click()
  await expect(boss.page.getByText('Slow mode on')).toBeVisible()
  expect(sql(`select slow_mode_seconds from groups where slug = 'computer-science-engineering-${year}'`)).toBe('60')

  // a member can send one message, then has to wait; the box says so and Send is disabled
  await talker.page.goto(`/chat/${chatId}`)
  const box = talker.page.getByLabel('Message', { exact: true })
  await box.fill(`Buy my course now ${run}`)
  await talker.page.getByRole('button', { name: 'Send' }).click()
  await expect(talker.page.getByText(`Buy my course now ${run}`)).toBeVisible()
  await box.fill('another one')
  await expect(talker.page.getByRole('status').filter({ hasText: 'Slow mode: you can send again in' })).toBeVisible()
  await expect(talker.page.getByRole('button', { name: 'Send' })).toBeDisabled()
  // the server enforces it too, not just the screen
  expect(sql(`select count(*) from messages where chat_id = '${chatId}' and sender_id = (select id from auth.users where email = 'talker.${run}@example.com')`)).toBe('1')

  // another member reports it
  await reporter.page.goto(`/chat/${chatId}`)
  await reporter.page.getByText(`Buy my course now ${run}`).click({ button: 'right' })
  await reporter.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Report' }).click()
  await reporter.page.getByRole('dialog', { name: 'Report message' }).getByRole('button', { name: 'Spam or scam' }).click()
  await expect(reporter.page.getByText('Thanks. Our moderators will review this message.')).toBeVisible()

  // the admin finds it in Reports and removes it for everyone
  await boss.page.goto('/admin')
  await boss.page.getByRole('link', { name: /Reports/ }).click()
  const card = boss.page.locator('li').filter({ hasText: `Buy my course now ${run}` })
  await expect(card).toContainText('Spam or scam')
  await expect(card).toContainText(`Talker ${run}`)
  boss.page.once('dialog', (d) => void d.accept())
  await card.getByRole('button', { name: 'Remove message' }).click()
  await expect(boss.page.getByText('Nothing to review')).toBeVisible()
  await talker.page.reload()
  await expect(talker.page.getByText('This message was deleted')).toBeVisible()
  await expect(talker.page.getByText(`Buy my course now ${run}`)).toHaveCount(0)

  for (const m of [boss, talker, reporter]) await m.ctx.close()
})
