import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const shots = 'test-results/screens'

test('two batchmates post, like, comment, connect and chat', async ({ browser }) => {
  const mk = async (email: string, name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/signin')
    await signInWithEmail(page, email)
    await onboard(page, name, '2012')
    sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
    await page.reload() // pick up the new verified status
    return { ctx, page }
  }
  const a = await mk(`ravi.${run}@example.com`, `Ravi ${run}`)
  const b = await mk(`meera.${run}@example.com`, `Meera ${run}`)

  // Ravi posts to his batch group (auto-joined)
  await a.page.goto('/groups')
  await expect(a.page.getByText('Computer Science & Engineering 2012')).toBeVisible()
  await a.page.screenshot({ path: `${shots}/20-groups.png`, fullPage: true })
  await a.page.getByText('Computer Science & Engineering 2012').click()
  await a.page.getByRole('button', { name: /Post in/ }).click()
  await a.page.getByLabel('Post text').fill(`Who is coming to the meet? ${run}`)
  await a.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(a.page.getByText(`Who is coming to the meet? ${run}`)).toBeVisible()

  // Meera sees it on Home, likes and comments
  await b.page.goto('/')
  const post = b.page.locator('div').filter({ hasText: `Who is coming to the meet? ${run}` }).last()
  await expect(b.page.getByText(`Who is coming to the meet? ${run}`)).toBeVisible()
  await b.page.screenshot({ path: `${shots}/21-feed.png`, fullPage: true })
  await b.page.getByRole('button', { name: 'Like' }).first().click()
  await b.page.getByRole('button', { name: 'Comment' }).first().click()
  await b.page.getByLabel('Write a comment').fill('Count me in!')
  await b.page.getByRole('button', { name: 'Send comment' }).click()
  await expect(b.page.getByText('Count me in!')).toBeVisible()
  void post

  // Meera messages Ravi from his profile
  const raviId = sql(`select id from auth.users where email = 'ravi.${run}@example.com'`)
  await b.page.goto(`/people/${raviId}`)
  await b.page.getByRole('button', { name: 'Connect' }).click()
  await expect(b.page.getByRole('button', { name: 'Request sent' })).toBeVisible()
  await b.page.getByRole('button', { name: 'Message' }).click()
  await expect(b.page).toHaveURL(/\/chat\//)
  await b.page.getByLabel('Message', { exact: true }).fill('Hi Ravi! See you at the meet.')
  await b.page.getByRole('button', { name: 'Send' }).click()
  await expect(b.page.getByText('Hi Ravi! See you at the meet.')).toBeVisible()
  await b.page.screenshot({ path: `${shots}/22-chat.png` })

  // Ravi: notifications, accepts connection, replies
  await a.page.goto('/notifications')
  await expect(a.page.getByText(/liked your post/)).toBeVisible()
  await expect(a.page.getByText(/commented: “Count me in!”/)).toBeVisible()
  await expect(a.page.getByText(/wants to connect/)).toBeVisible()
  await a.page.screenshot({ path: `${shots}/23-notifications.png` })
  await a.page.goto('/me/connections')
  await a.page.getByRole('button', { name: 'Accept' }).click()
  // connecting turned the message request into a normal chat; it shows as unread
  await a.page.goto('/chat')
  const row = a.page.getByRole('link', { name: new RegExp(`Meera ${run}`) })
  await expect(row.getByLabel('1 unread')).toBeVisible()
  await expect(a.page.getByRole('navigation', { name: 'Main' }).getByLabel('1 unread')).toBeVisible() // tab badge
  await row.click()
  await expect(a.page.getByText('Hi Ravi! See you at the meet.')).toBeVisible()
  await expect(a.page.getByRole('navigation', { name: 'Main' })).toBeHidden() // full-screen chat on phones
  await a.page.getByLabel('Message', { exact: true }).fill('Yes! Booked my ticket.')
  await a.page.getByRole('button', { name: 'Send' }).click()
  await expect(b.page.getByText('Yes! Booked my ticket.')).toBeVisible({ timeout: 15_000 }) // arrives without reload
  // Meera's own message shows "Seen" once Ravi has read it
  await expect(b.page.getByText('Seen', { exact: true })).toBeVisible({ timeout: 30_000 })

  // Batch group chat: Ravi writes; Meera (same batch) sees the history and the unread count
  await a.page.goto('/groups')
  await a.page.getByText('Computer Science & Engineering 2012').click()
  await a.page.getByRole('link', { name: /Group chat/ }).click()
  await a.page.getByLabel('Message', { exact: true }).fill(`Batch 2012 dinner on Friday? ${run}`)
  await a.page.getByRole('button', { name: 'Send' }).click()
  await expect(a.page.getByText(`Batch 2012 dinner on Friday? ${run}`)).toBeVisible()
  await b.page.goto('/chat')
  const groupRow = b.page.getByRole('link', { name: /Computer Science & Engineering 2012/ })
  await expect(groupRow).toContainText(`Ravi: Batch 2012 dinner on Friday? ${run}`)
  await groupRow.click()
  await expect(b.page.getByText(`Batch 2012 dinner on Friday? ${run}`)).toBeVisible()
  await expect(b.page.getByText(`Ravi ${run}`).first()).toBeVisible() // sender name in groups
  await b.page.screenshot({ path: `${shots}/24-group-chat.png` })

  await a.ctx.close()
  await b.ctx.close()
})
