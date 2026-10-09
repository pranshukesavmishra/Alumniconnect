import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
// each run gets its own batch (and so its own empty batch chat)
const year = String(1995 + (Date.now() % 26))

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

test('group chat: react, reply, edit, photo, delete — seen by the other member', async ({ browser }) => {
  const a = await member(browser, `asha.${run}@example.com`, `Asha ${run}`)
  const b = await member(browser, `vikram.${run}@example.com`, `Vikram ${run}`)
  const chatId = sql(`select c.id from chats c join groups g on g.id = c.group_id where g.slug = 'computer-science-engineering-${year}'`)

  // Asha writes in the batch chat
  await a.page.goto(`/chat/${chatId}`)
  await a.page.getByLabel('Message', { exact: true }).fill(`Reunion plan ${run}`)
  await a.page.getByRole('button', { name: 'Send' }).click()
  await expect(a.page.getByText(`Reunion plan ${run}`)).toBeVisible()

  // Vikram reacts and replies (options open with right-click / long-press)
  await b.page.goto(`/chat/${chatId}`)
  const msg = b.page.getByText(`Reunion plan ${run}`)
  const msgRow = (p: typeof b.page) => p.locator('li').filter({ hasText: `Reunion plan ${run}` }).filter({ hasNotText: 'Count me in' })
  await expect(msg).toBeVisible()
  await msg.click({ button: 'right' })
  await b.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'React 👍' }).click()
  await expect(msgRow(b.page).getByRole('button', { name: /Reactions: 👍 1/ })).toBeVisible()
  await msg.click({ button: 'right' })
  await b.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Reply' }).click()
  await expect(b.page.getByText(`Replying to Asha ${run}`)).toBeVisible()
  await b.page.getByLabel('Message', { exact: true }).fill('Count me in')
  await b.page.getByRole('button', { name: 'Send' }).click()
  const reply = b.page.locator('li').filter({ hasText: 'Count me in' })
  await expect(reply.getByRole('button', { name: new RegExp(`Asha ${run}.*Reunion plan`) })).toBeVisible() // quote

  // Asha sees the reaction and the reply live, then edits her message
  await expect(msgRow(a.page).getByRole('button', { name: /Reactions: 👍 1/ })).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByText('Count me in')).toBeVisible({ timeout: 15_000 })
  await msgRow(a.page).getByText(`Reunion plan ${run}`).click({ button: 'right' })
  await a.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Edit' }).click()
  await a.page.getByLabel('Message', { exact: true }).fill(`Reunion plan ${run} — 20 Dec, JEC campus`)
  await a.page.getByRole('button', { name: 'Save edit' }).click()
  await expect(a.page.getByText(`Reunion plan ${run} — 20 Dec, JEC campus`).first()).toBeVisible()
  await expect(b.page.getByText(`Reunion plan ${run} — 20 Dec, JEC campus`).first()).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByText('edited ·').first()).toBeVisible()

  // Asha sends a photo with a caption; Vikram sees it and can open it full screen
  await a.page.getByRole('button', { name: 'Attach photo or file' }).click()
  await a.page.locator('input[type=file][accept="image/*"]:not([capture])').setInputFiles('public/pwa-512.png')
  await a.page.getByLabel('Message', { exact: true }).fill('Our venue')
  await a.page.getByRole('button', { name: 'Send' }).click()
  await expect(b.page.getByText('Our venue')).toBeVisible({ timeout: 20_000 })
  await b.page.getByRole('button', { name: 'Open photo 1 of 1' }).click()
  await expect(b.page.getByRole('dialog', { name: 'Photo viewer' }).locator('img')).toBeVisible()
  await b.page.getByRole('button', { name: 'Close' }).click()
  expect(Number(sql(`select count(*) from storage.objects where bucket_id = 'chat-media' and name like '%/${chatId}/%'`))).toBe(2) // full + thumbnail

  // Asha deletes the photo for everyone; the files are removed too
  await a.page.getByText('Our venue').click({ button: 'right' })
  a.page.once('dialog', (d) => void d.accept())
  await a.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Delete for everyone' }).click()
  await expect(b.page.getByText('This message was deleted')).toBeVisible({ timeout: 15_000 })
  expect(Number(sql(`select count(*) from storage.objects where bucket_id = 'chat-media' and name like '%/${chatId}/%'`))).toBe(0)

  // @mention: suggestions appear, picking inserts the name, and the member gets a notification
  await a.page.getByLabel('Message', { exact: true }).fill('Welcome @Vik')
  await a.page.getByRole('option', { name: new RegExp(`Vikram ${run}`) }).click()
  await expect(a.page.getByLabel('Message', { exact: true })).toHaveValue('Welcome @Vikram ')
  await a.page.getByLabel('Message', { exact: true }).press('End')
  await a.page.getByLabel('Message', { exact: true }).type('see you there')
  await a.page.getByRole('button', { name: 'Send' }).click()
  await expect(a.page.getByText('@Vikram', { exact: true })).toBeVisible()
  await expect.poll(() => sql(`select count(*) from notifications where kind = 'mention' and target_id = '${chatId}'`)).toBe('1')

  // Pin a message (group admin or platform admin only), then find messages by search
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = 'asha.${run}@example.com')`)
  await a.page.reload()
  await a.page.getByText('Welcome').first().click({ button: 'right' })
  await a.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Pin to top' }).click()
  await expect(a.page.getByRole('button', { name: 'Go to pinned message' })).toContainText('Welcome @Vikram')
  await a.page.getByRole('button', { name: 'Search in chat' }).click()
  await a.page.getByLabel('Search in this chat').fill('Count me')
  await expect(a.page.getByRole('list', { name: 'Search results' }).getByText('Count me in')).toBeVisible()
  await a.page.getByRole('list', { name: 'Search results' }).getByText('Count me in').click()
  await expect(a.page.getByRole('list', { name: 'Search results' })).toBeHidden()

  await a.ctx.close()
  await b.ctx.close()
})
