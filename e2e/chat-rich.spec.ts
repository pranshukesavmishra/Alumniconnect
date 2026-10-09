import { expect, test, type Browser } from '@playwright/test'
import { makeCircle, onboard, signInWithEmail, sql } from './helpers'

// A fake microphone, so voice notes can be recorded without hardware or a permission prompt.
test.use({
  launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 7) % 26))

async function member(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['microphone'] })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page }
}

test('polls and voice notes work between two members', async ({ browser }) => {
  const a = await member(browser, `pia.${run}@example.com`, `Pia ${run}`)
  const b = await member(browser, `rohan.${run}@example.com`, `Rohan ${run}`)
  const chatId = makeCircle('rich', [`pia.${run}@example.com`, `rohan.${run}@example.com`])

  await a.page.goto(`/chat/${chatId}`)
  // poll: needs a question and two different options
  await a.page.getByRole('button', { name: 'Attach photo or file' }).click()
  await a.page.getByRole('button', { name: 'Poll' }).click()
  const sheet = a.page.getByRole('dialog', { name: 'Create a poll' })
  await sheet.getByLabel('Question').fill('Which day for the reunion dinner?')
  await sheet.getByLabel('Option 1').fill('Friday')
  await sheet.getByLabel('Option 2').fill('friday')
  await expect(sheet.getByText('Options must be different.')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Send poll' })).toBeDisabled()
  await sheet.getByLabel('Option 2').fill('Saturday')
  await sheet.getByRole('button', { name: 'Send poll' }).click()
  await expect(a.page.getByText('Which day for the reunion dinner?')).toBeVisible()

  // Rohan votes; Pia sees the count update, then changes her mind
  await b.page.goto(`/chat/${chatId}`)
  await b.page.getByRole('radio', { name: /Saturday/ }).click()
  await expect(b.page.getByText('1 vote', { exact: true })).toBeVisible()
  await expect.poll(() => sql(`select count(*) from poll_votes where chat_id = '${chatId}'`)).toBe('1')
  await expect(a.page.getByText('1 vote', { exact: true })).toBeVisible({ timeout: 15_000 })
  await a.page.getByRole('radio', { name: /Friday/ }).click()
  await expect(a.page.getByText('2 votes', { exact: true })).toBeVisible()
  await a.page.getByRole('radio', { name: /Friday/ }).click() // tap again removes the vote
  await expect(a.page.getByText('1 vote', { exact: true })).toBeVisible()

  // voice note: record ~2s, send, and the other member can play it
  await b.page.getByRole('button', { name: 'Record voice message' }).click()
  await expect(b.page.getByRole('status').filter({ hasText: 'Recording' })).toBeVisible()
  await b.page.waitForTimeout(2200)
  await b.page.getByRole('button', { name: 'Send voice message' }).click()
  await expect(b.page.getByRole('button', { name: 'Play voice message' })).toBeVisible()
  await expect.poll(() => sql(`select count(*) from messages where chat_id = '${chatId}' and kind = 'voice' and (attachments->0->>'duration')::int >= 1`), { timeout: 20_000 }).toBe('1')
  await expect(a.page.getByRole('button', { name: 'Play voice message' })).toBeVisible({ timeout: 20_000 })
  await a.page.getByRole('button', { name: 'Play voice message' }).click()
  await expect(a.page.getByRole('button', { name: 'Pause voice message' })).toBeVisible()
  await expect(a.page.locator('audio').first()).toHaveJSProperty('paused', false)

  await a.ctx.close()
  await b.ctx.close()
})
