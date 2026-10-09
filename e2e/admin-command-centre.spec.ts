import { expect, test, type Page } from '@playwright/test'
import { sql } from './helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts } from './verify/admin-lib'

// Pass 1 of the admin programme: the "needs your attention" queue, global search and roles clarity, asserted against the database.
// Everything here is created by this run (unique names, own event); other tests' data never makes it fail.

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('admin home: attention queue, search and roles work end to end, and each role sees only its own', async ({ browser }) => {
  const tag = `cc${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const treasurer = await makeUser(`${tag}tre`, { name: `Treasurer ${tag}` })
  const volunteer = await makeUser(`${tag}vol`, { name: `Volunteer ${tag}` })
  const waiting = await makeUser(`${tag}wait`, { name: `Quillwaiter ${tag}`, verified: false, phone: '+91 91234 55501' })
  const buyer = await makeUser(`${tag}buy`, { name: `Buyer ${tag}`, phone: '+91 91234 55502' })
  const ev = makeEvent(tag)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${treasurer.id}', 'manager'), ('${ev.id}', '${volunteer.id}', 'checkin')`)
  const { reg, payment } = await register(buyer, ev, true)
  const utr = sql(`select utr from event_payments where id = '${payment!.id}'`)

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await loginPage(page, boss, '/admin')

  // ---- the queue shows real counts and links to where the work is done
  const queue = page.getByTestId('queue')
  await expect(queue).toBeVisible()
  const payItem = queue.locator(`[data-queue="pay-${ev.id}"]`)
  await expect(payItem).toContainText('1 payment to verify')
  await expect(payItem).toContainText(`Verify ${tag}`)
  const pendingMembers = Number(sql(`select count(*) from profiles where onboarded and verification = 'pending'`))
  expect(pendingMembers).toBeGreaterThanOrEqual(1)
  await expect(queue.locator('[data-queue="members"] >> span').first()).toHaveText(String(pendingMembers))
  await noSideScroll(page)

  // ---- verify the payment from the queue: the database changes and the item leaves the queue
  await payItem.click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=payments`))
  const card = page.getByRole('listitem').filter({ hasText: utr })
  await card.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(page.getByText(utr)).toHaveCount(0)
  expect(sql(`select status from event_payments where id = '${payment!.id}'`)).toBe('verified')
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('confirmed')
  await page.goto('/admin')
  await expect(page.getByTestId('queue').or(page.getByTestId('queue-empty'))).toBeVisible()
  await expect(page.locator(`[data-queue="pay-${ev.id}"]`)).toHaveCount(0)

  // ---- the members item deep-links to the filtered list and drops by one when a member is verified
  await page.locator('[data-queue="members"]').click()
  await expect(page).toHaveURL(/\/admin\/members\?filter=pending/)
  await expect(page.getByLabel('Filter')).toHaveValue('pending')
  await expect(page.getByText(`Quillwaiter ${tag}`).first()).toBeVisible()
  sql(`update profiles set verification = 'verified' where id = '${waiting.id}'`)
  await page.goto('/admin')
  await expect(page.locator('[data-queue="members"] >> span').first()).toHaveText(String(pendingMembers - 1))

  // ---- search: UTR, ticket code, phone (logged, never echoed), member name
  const search = page.getByLabel('Search everything')
  await search.fill(utr)
  const results = page.getByRole('region', { name: 'Search results' })
  await expect(results.getByText('Payments and UTRs')).toBeVisible()
  await expect(results).toContainText(reg.code)
  await search.fill(reg.code.toLowerCase())
  await expect(results.getByText('Registrations')).toBeVisible()
  await expect(results).toContainText(`Verify ${tag}`)

  const lookups = auditCount(`action = 'search_contact' and actor = '${boss.id}'`)
  await search.fill('91234 55502')
  await expect(results).toContainText(`Buyer ${tag}`.slice(0, 20))
  await expect(results).toContainText('matched phone')
  await expect(results).toContainText('recorded in the activity log')
  await expect(page.locator('main')).not.toContainText('91234 55502') // matched, never echoed
  await expect.poll(() => auditCount(`action = 'search_contact' and actor = '${boss.id}'`)).toBeGreaterThan(lookups)

  await search.fill(`Quillwaiter ${tag}`)
  await results.getByRole('link', { name: new RegExp(`Quillwaiter ${tag}`) }).click()
  await expect(page).toHaveURL(/\/admin\/members/)
  await expect(page.getByRole('dialog', { name: 'Edit member' })).toContainText(`Quillwaiter ${tag}`)

  // a registration result opens that registration
  await page.goto('/admin')
  await page.getByLabel('Search everything').fill(reg.code)
  await page.getByRole('region', { name: 'Search results' }).getByRole('link', { name: new RegExp(reg.code) }).first().click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=people`))
  await expect(page.getByText(`Reg ${buyer.email}`).first()).toBeVisible()
  await expect(page.getByLabel('Search registrations')).toHaveValue(reg.code)

  // ---- roles page: admin sees the matrix, the admins and the event team
  await page.goto('/admin/roles')
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('Verify payments and record cash')
  await expect(page.getByTestId('admins-list')).toContainText(`Boss ${tag}`)
  const team = page.getByTestId('event-team').filter({ hasText: `Verify ${tag}` })
  await expect(team).toContainText(`Treasurer ${tag}`)
  await expect(team).toContainText('Treasurer / manager')
  await expect(team).toContainText(`Volunteer ${tag}`)
  await expect(team).toContainText('Check-in volunteer')
  await noSideScroll(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await noSideScroll(page)
  await page.goto('/admin')
  await noSideScroll(page)
  await expect(page.getByTestId('my-access')).toContainText('Admin')
  await ctx.close()

  // ---- the treasurer: only their event, no member list, no roles page
  const t = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const tp = await t.newPage()
  const quillBefore = auditCount(`action = 'search_contact' and actor = '${treasurer.id}'`)
  await loginPage(tp, treasurer, '/admin')
  await expect(tp.getByTestId('my-access')).toContainText('Treasurer / manager')
  await expect(tp.getByTestId('my-access')).not.toContainText('Admin')
  await expect(tp.getByRole('link', { name: /Members/ })).toHaveCount(0)
  await expect(tp.locator('[data-queue="members"]')).toHaveCount(0)
  await expect(tp.locator('[data-queue="reports"]')).toHaveCount(0)
  await tp.getByLabel('Search everything').fill(`Quillwaiter ${tag}`)
  await expect(tp.getByRole('region', { name: 'Search results' })).toContainText('Nothing found')
  await tp.getByLabel('Search everything').fill(reg.code)
  await expect(tp.getByRole('region', { name: 'Search results' })).toContainText(`Verify ${tag}`)
  expect(auditCount(`action = 'search_contact' and actor = '${treasurer.id}'`)).toBe(quillBefore)
  await tp.goto('/admin/roles')
  await expect(tp).toHaveURL(/\/admin$/)
  // the database says no as well, whatever the screen does
  const direct = await treasurer.db.rpc('admin_roles_overview')
  expect(direct.error?.code).toBe('42501')
  const members = await treasurer.db.rpc('admin_search', { p_q: `Quillwaiter ${tag}` })
  expect(members.data.members).toHaveLength(0)
  await t.close()

  // ---- a check-in volunteer is sent straight to their event and cannot use either function
  const v = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const vp = await v.newPage()
  await loginPage(vp, volunteer, '/admin')
  await expect(vp).toHaveURL(new RegExp(`/admin/events/${ev.slug}`))
  expect((await volunteer.db.rpc('admin_attention')).error?.code).toBe('42501')
  expect((await volunteer.db.rpc('admin_search', { p_q: reg.code })).error?.code).toBe('42501')
  expect((await buyer.db.rpc('admin_attention')).error?.code).toBe('42501')
  await v.close()
})
