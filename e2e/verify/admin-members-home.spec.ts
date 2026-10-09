// Admin home: every "needs your attention" item deep-links to where the work is done and drops when it is resolved;
// global search finds people, tickets, UTRs, phones and e-mails, and contact look-ups are logged.
// Counts are global, so the tests compare the screen with the database at the same moment instead of assuming numbers.
import { expect, test, type Page } from '@playwright/test'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 412, height: 915 } })

const tag = `hm${ts}`.slice(0, 12)
let boss: TestUser
let other: TestUser
let page: Page

const badge = (id: string) => page.locator(`[data-queue="${id}"] >> span`).first()
const openReports = () => sql(`select count(*) from (select 1 from reports where status = 'open' group by target_type, target_id) g`)
const pendingMembers = () => sql(`select count(*) from profiles where onboarded and verification = 'pending'`)
const circlesWaiting = () => sql(`select count(*) from groups where kind = 'circle' and not is_approved`)
const jobsExpiring = () => sql(`select count(*) from jobs where not is_closed and not is_hidden and expires_at > now() and expires_at <= now() + interval '7 days'`)
const toApprove = (uid: string) => sql(`select count(*) from event_messages where status = 'pending_approval' and created_by is distinct from '${uid}'`)

/** The screen shows what the database says right now (other agents write to the same database, so retry until they agree). */
async function expectQueueCount(id: string, db: () => string) {
  await expect
    .poll(async () => {
      await page.goto('/admin')
      await expect(page.getByTestId('queue').or(page.getByTestId('queue-empty'))).toBeVisible()
      const want = Number(db())
      if (want === 0) return (await page.locator(`[data-queue="${id}"]`).count()) === 0 ? 'gone' : 'still there'
      const got = await badge(id).textContent({ timeout: 2000 }).catch(() => null)
      return got === String(want) ? 'match' : `screen ${got} database ${want}`
    }, { timeout: 40_000 })
    .toMatch(/match|gone/)
}

test.beforeAll(async ({ browser }) => {
  boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  other = await makeUser(`${tag}other`, { admin: true, name: `Other Boss ${tag}` })
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
  await loginPage(page, boss, '/admin')
})
test.afterAll(async () => page.context().close())

test('payments to verify: shows the event, opens the payments tab, leaves the queue when verified', async () => {
  const buyer = await makeUser(`${tag}pb`, { name: `Payer ${tag}` })
  const ev = makeEvent(`${tag}p`)
  const { payment } = await register(buyer, ev, true)
  await page.goto('/admin')
  const item = page.locator(`[data-queue="pay-${ev.id}"]`)
  await expect(item).toContainText('1 payment to verify')
  await item.click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=payments`))
  const bossReview = await boss.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })
  expect(bossReview.error).toBeNull()
  await page.goto('/admin')
  await expect(page.getByTestId('queue').or(page.getByTestId('queue-empty'))).toBeVisible()
  await expect(page.locator(`[data-queue="pay-${ev.id}"]`)).toHaveCount(0)
})

test('event warnings: no UPI id, still a draft, almost full, registration closing; each opens the right tab and clears when fixed', async () => {
  // published with a paid ticket and no UPI id
  const ev = makeEvent(`${tag}w`)
  sql(`update events set upi_id = null, capacity = 10, registration_closes_at = now() + interval '3 days' where id = '${ev.id}'`)
  // nine of ten seats taken: needs confirmed registrations, built through the real registration function
  const people: TestUser[] = []
  for (let i = 0; i < 9; i++) people.push(await makeUser(`${tag}w${i}`, { name: `Seat ${i} ${tag}` }))
  sql(`update events set upi_id = 'jecalumni@okicici' where id = '${ev.id}'`)
  for (const p of people) await register(p, ev, false)
  sql(`update event_registrations set status = 'confirmed' where event_id = '${ev.id}'`)
  sql(`update events set upi_id = null where id = '${ev.id}'`)
  const draft = makeEvent(`${tag}d`, false)
  sql(`update events set starts_at = now() + interval '10 days' where id = '${draft.id}'`)

  await page.goto('/admin')
  const upi = page.locator(`[data-queue="upi-${ev.id}"]`)
  await expect(upi).toContainText('No UPI ID set')
  await expect(page.locator(`[data-queue="cap-${ev.id}"]`)).toContainText('Almost full')
  await expect(page.locator(`[data-queue="cap-${ev.id}"]`)).toContainText('9 of 10 seats taken')
  await expect(page.locator(`[data-queue="close-${ev.id}"]`)).toContainText('Registration closes')
  await expect(page.locator(`[data-queue="draft-${draft.id}"]`)).toContainText('Still a draft')

  await upi.click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=settings`))
  await page.goBack()
  await page.locator(`[data-queue="cap-${ev.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=people`))
  await page.goBack()
  await page.locator(`[data-queue="close-${ev.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=people`))
  await page.goBack()
  await page.locator(`[data-queue="draft-${draft.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${draft.slug}\\?tab=settings`))

  // fix them: set the UPI id, publish the draft, make room
  sql(`update events set upi_id = 'jecalumni@okicici', capacity = 100 where id = '${ev.id}'`)
  sql(`update events set is_published = true where id = '${draft.id}'`)
  await page.goto('/admin')
  await expect(page.getByTestId('queue').or(page.getByTestId('queue-empty'))).toBeVisible()
  await expect(page.locator(`[data-queue="upi-${ev.id}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-queue="cap-${ev.id}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-queue="draft-${draft.id}"]`)).toHaveCount(0)
})

test('members to verify: the count is the list people land on, and drops when one is verified', async () => {
  const done = await makeUser(`${tag}m1`, { name: `Waiter One ${tag}`, verified: false })
  await makeUser(`${tag}m2`, { name: `Waiter Two ${tag}`, verified: false })
  const unfinished = await makeUser(`${tag}m3`, { name: `Unfinished ${tag}`, verified: false, onboarded: false })
  await expectQueueCount('members', pendingMembers)
  const before = Number(pendingMembers())
  await page.locator('[data-queue="members"]').click()
  await expect(page).toHaveURL(/\/admin\/members\?filter=pending/)
  // the list shows exactly the people the number counted: the one who has not finished their profile is not in it
  await expect(page.getByTestId('member-total')).toContainText(`${before} member`)
  await page.getByLabel('Search members').fill(tag)
  await expect(page.getByRole('button', { name: new RegExp(`Waiter One ${tag}`) })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`Unfinished ${tag}`) })).toHaveCount(0)
  expect(sql(`select verification from profiles where id = '${unfinished.id}'`)).toBe('pending')
  // verify one from the list itself
  await page.getByLabel(`Select Waiter One ${tag}`).check()
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Verify', exact: true }).click()
  await page.getByRole('button', { name: 'Verify 1', exact: true }).click()
  await expect.poll(() => sql(`select verification from profiles where id = '${done.id}'`)).toBe('verified')
  await expectQueueCount('members', pendingMembers)
})

test('reports to review: opens the reports screen and drops when the reports are dismissed', async () => {
  const author = await makeUser(`${tag}ra`, { name: `Author ${tag}` })
  const reporter = await makeUser(`${tag}rr`, { name: `Reporter ${tag}` })
  const post = sql(`insert into posts (author_id, body) values ('${author.id}', 'questionable post ${tag}') returning id`).split('\n')[0]!
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${reporter.id}', 'post', '${post}', 'spam ${tag}')`)
  await expectQueueCount('reports', openReports)
  await page.locator('[data-queue="reports"]').click()
  await expect(page).toHaveURL(/\/admin\/reports/)
  const before = Number(openReports())
  const r = await boss.db.rpc('admin_dismiss_reports', { p_type: 'post', p_id: post })
  expect(r.error).toBeNull()
  expect(Number(openReports())).toBe(before - 1)
  await expectQueueCount('reports', openReports)
})

test('circles waiting: opens community and drops when approved there', async () => {
  const maker = await makeUser(`${tag}cm`, { name: `Maker ${tag}` })
  const slug = `circle-${tag}`.toLowerCase()
  const gid = sql(`insert into groups (kind, slug, name, description, is_approved, created_by) values ('circle', '${slug}', 'Proposed ${tag}', 'for tests', false, '${maker.id}') returning id`).split('\n')[0]!
  await expectQueueCount('circles', circlesWaiting)
  await page.locator('[data-queue="circles"]').click()
  await expect(page).toHaveURL(/\/admin\/community/)
  await expect(page.getByText(`Proposed ${tag}`)).toBeVisible()
  const card = page.getByRole('listitem').filter({ hasText: `Proposed ${tag}` })
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(() => sql(`select is_approved from groups where id = '${gid}'`)).toBe('t')
  await expectQueueCount('circles', circlesWaiting)
})

test('jobs expiring this week: counted from the database and cleared when the job is closed', async () => {
  const poster = await makeUser(`${tag}jp`, { name: `Poster ${tag}` })
  const job = sql(`insert into jobs (posted_by, title, company, description, expires_at) values ('${poster.id}', 'Soon gone ${tag}', 'Acme', 'x', now() + interval '3 days') returning id`).split('\n')[0]!
  await expectQueueCount('jobs', jobsExpiring)
  await expect(page.locator('[data-queue="jobs"]')).toHaveAttribute('href', '/jobs')
  sql(`update jobs set is_closed = true where id = '${job}'`)
  await expectQueueCount('jobs', jobsExpiring)
})

test('messages to approve: only another admin sees them, the item opens the inbox and leaves once approved', async () => {
  const ev = makeEvent(`${tag}ap`)
  const msg = sql(`insert into event_messages (event_id, kind, title, body, status, created_by) values ('${ev.id}', 'announcement', 'Big news ${tag}', 'hello', 'pending_approval', '${other.id}') returning id`).split('\n')[0]!
  await expectQueueCount('approvals', () => toApprove(boss.id))
  await page.locator('[data-queue="approvals"]').click()
  await expect(page).toHaveURL(/\/admin\/inbox/)
  await expect(page.getByText(`Message to approve: Big news ${tag}`)).toBeVisible()
  // the author does not see it as something for them to approve
  expect(Number(toApprove(other.id))).toBeLessThan(Number(toApprove(boss.id)) + 1)
  const r = await boss.db.rpc('admin_review_event_message', { p_id: msg, p_approve: false, p_note: 'no' })
  expect(r.error).toBeNull()
  await expectQueueCount('approvals', () => toApprove(boss.id))
})

test('search: name, ticket code, UTR, phone, e-mail; contact look-ups are logged; See all shows more', async () => {
  const n = String(Math.floor(Math.random() * 9e4) + 1e4)
  const ev = makeEvent(`${tag}s`)
  const buyer = await makeUser(`${tag}sb`, { name: `Searchable Buyer ${tag}`, phone: `+91 91236 ${n}` })
  const { reg, payment } = await register(buyer, ev, true)
  const utr = sql(`select utr from event_payments where id = '${payment!.id}'`)
  for (let i = 0; i < 9; i++) await makeUser(`${tag}sx${i}`, { name: `Crowd${i} ${tag}` })
  await page.goto('/admin')
  const search = page.getByLabel('Search everything')
  const results = page.getByRole('region', { name: 'Search results' })

  // by name, case-insensitively and by a fragment
  await search.fill(`searchable buyer ${tag}`.toUpperCase())
  await expect(results.getByRole('link', { name: new RegExp(`History of Searchable Buyer ${tag}`) })).toBeVisible()
  await expect(results).toContainText('matched name')

  // by ticket code, lower case
  await search.fill(reg.code.toLowerCase())
  await expect(results.getByRole('link', { name: new RegExp(reg.code) }).first()).toBeVisible()
  await expect(results).toContainText('matched ticket code')

  // by UTR: opens the event's payments tab while the payment waits for review
  await search.fill(utr)
  const pay = results.getByRole('link', { name: new RegExp(utr) })
  await expect(pay).toBeVisible()
  await pay.click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=payments&q=${reg.code}`))
  await page.goto('/admin')

  // by phone: matched on the server, never echoed, and the look-up is logged
  const phoneBefore = auditCount(`action = 'search_contact' and actor = '${boss.id}' and details->>'kind' = 'phone'`)
  await page.getByLabel('Search everything').fill(`91236 ${n}`)
  await expect(results).toContainText(`Searchable Buyer ${tag}`)
  await expect(results).toContainText('matched phone')
  await expect(page.locator('main')).not.toContainText(`91236 ${n}`)
  await expect.poll(() => auditCount(`action = 'search_contact' and actor = '${boss.id}' and details->>'kind' = 'phone'`)).toBeGreaterThan(phoneBefore)

  // by e-mail (the start of the address)
  const mailBefore = auditCount(`action = 'search_contact' and actor = '${boss.id}' and details->>'kind' = 'email'`)
  await page.getByLabel('Search everything').fill(buyer.email)
  await expect(results).toContainText(`Searchable Buyer ${tag}`)
  await expect(results).toContainText('matched email')
  await expect(page.locator('main')).not.toContainText(buyer.email)
  await expect.poll(() => auditCount(`action = 'search_contact' and actor = '${boss.id}' and details->>'kind' = 'email'`)).toBeGreaterThan(mailBefore)

  // a plain name search is not a contact look-up
  const plainBefore = auditCount(`action = 'search_contact' and actor = '${boss.id}'`)
  await page.getByLabel('Search everything').fill(`Crowd`)
  await expect(results.getByRole('link', { name: /^History of Crowd/ })).toHaveCount(8)
  expect(auditCount(`action = 'search_contact' and actor = '${boss.id}'`)).toBe(plainBefore)

  // See all: more than the first 8
  await page.getByLabel('Search everything').fill(`Crowd`)
  await results.getByRole('button', { name: 'See all' }).first().click()
  await expect.poll(() => results.getByRole('link', { name: /^History of Crowd/ }).count()).toBeGreaterThanOrEqual(9)
  // a member hit opens the editor, the history icon opens the timeline
  await results.getByRole('link', { name: new RegExp(`^History of Crowd3 ${tag}`) }).click()
  await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: `Crowd3 ${tag}` })).toBeVisible()

  // nothing found, and one letter is not enough
  await page.goto('/admin')
  await page.getByLabel('Search everything').fill(`zzzznomatch${ts}`)
  await expect(results).toContainText('Nothing found')
  await page.getByLabel('Search everything').fill('z')
  await expect(results).toHaveCount(0)
})
