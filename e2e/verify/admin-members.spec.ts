// Admin console: home, Members (search, edit, verify, admin flags), Activity log. Browser + database checks.
import { expect, test, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from '../helpers'
import { ANON, auditCount, email, loginPage, makeUser, OWNER_EMAIL, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })

let page: Page
let adminId: string
let target: TestUser
const responses: string[] = []

test.beforeAll(async ({ browser }) => {
  target = await makeUser('mem-target', { name: `Target Person ${ts}`, verified: false })
  await makeUser('mem-special', { name: `Dr. Anne-Marie O'Neil ${ts}` })
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  page = await ctx.newPage()
  // collect every API response body the admin UI receives, to look for the Drive owner's address later
  page.on('response', async (r) => {
    if (!r.url().includes(':54321/')) return
    try {
      responses.push(await r.text())
    } catch {
      /* ignore bodies that are gone */
    }
  })
  page.on('dialog', (d) => void d.accept())
  // real sign-in with an emailed code, then onboarding, then promoted to admin in SQL
  const e = email('mem-admin')
  await page.goto('/signin')
  await signInWithEmail(page, e)
  await onboard(page, `Admin Verify ${ts}`, '2004')
  adminId = sql(`select id from auth.users where email = '${e}'`)
  sql(`update profiles set is_admin = true, verification = 'verified' where id = '${adminId}'`)
  await page.goto('/me')
})

test.afterAll(async () => page.context().close())

test('admin home is reachable from Me on a phone and every card works', async () => {
  await page.reload()
  const organise = page.getByRole('link', { name: /Organise/ })
  await expect(organise).toBeVisible()
  await organise.click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Organise' })).toBeVisible()
  for (const [name, url, heading] of [
    [/Members/, /\/admin\/members$/, 'Members'],
    [/Activity log/, /\/admin\/activity$/, 'Activity log'],
  ] as const) {
    await page.getByRole('link', { name }).click()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/admin$/)
  }
  await page.getByRole('link', { name: 'New event' }).click()
  await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible()
  // phone layout: nothing wider than the screen
  for (const p of ['/admin', '/admin/members', '/admin/activity', '/admin/events/new']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `horizontal overflow on ${p}`).toBeLessThanOrEqual(0)
  }
})

test('members: search and filters find the right people', async () => {
  await page.goto('/admin/members')
  const search = page.getByLabel('Search members')
  await search.fill(`Target Person ${ts}`)
  await expect(page.getByRole('button', { name: new RegExp(`Target Person ${ts}`) })).toBeVisible()
  await expect(page.locator('main ul.divide-y > li')).toHaveCount(1)
  // names with dots, dashes and apostrophes
  await search.fill(`Dr. Anne-Marie O'Neil ${ts}`)
  await expect(page.getByRole('button', { name: new RegExp(`Anne-Marie O'Neil ${ts}`) })).toBeVisible()
  await expect(page.getByText(/could not|error|failed/i)).toHaveCount(0)
  // filters
  await search.fill(String(ts))
  await page.getByLabel('Filter').selectOption('pending')
  await expect(page.getByRole('button', { name: new RegExp(`Target Person ${ts}`) })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`O'Neil ${ts}`) })).toHaveCount(0)
  await page.getByLabel('Filter').selectOption('verified')
  await expect(page.getByRole('button', { name: new RegExp(`O'Neil ${ts}`) })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`Target Person ${ts}`) })).toHaveCount(0)
  await page.getByLabel('Filter').selectOption('all')
})

test('members: edit every field in the editor; saved in DB and audited', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Target Person ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Target Person ${ts}`) }).click()
  const dlg = page.getByRole('dialog', { name: 'Edit member' })
  await expect(dlg.getByLabel('Full name')).toHaveValue(`Target Person ${ts}`)
  await dlg.getByLabel('Full name').fill(`Target Edited ${ts}`)
  await dlg.getByText('Faculty or staff', { exact: true }).click()
  await dlg.getByLabel('Branch').selectOption('Mechanical Engineering')
  await dlg.getByLabel('Passing-out year').selectOption('2008')
  await dlg.getByLabel('Joining year').selectOption('2004')
  await dlg.getByLabel('Current role').fill('Principal Engineer')
  await dlg.getByLabel('Company').fill('Acme')
  await dlg.getByLabel('City').fill('Indore')
  await dlg.getByLabel('Mobile (private)').fill('+91 98111 22333')
  const before = auditCount(`action = 'update_member' and target_id = '${target.id}'`)
  await dlg.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile updated')).toBeVisible()
  expect(sql(`select concat_ws('|', full_name, member_type, branch, grad_year, join_year, current_title, current_company, city) from profiles where id = '${target.id}'`)).toBe(
    `Target Edited ${ts}|faculty|Mechanical Engineering|2008|2004|Principal Engineer|Acme|Indore`,
  )
  expect(sql(`select phone from profile_private where id = '${target.id}'`)).toBe('+91 98111 22333')
  expect(auditCount(`action = 'update_member' and target_id = '${target.id}' and actor = '${adminId}'`)).toBe(before + 1)
  const changed = sql(`select details->'changed' from admin_audit where action = 'update_member' and target_id = '${target.id}' order by id desc limit 1`)
  for (const k of ['full_name', 'member_type', 'branch', 'grad_year', 'join_year', 'current_title', 'current_company', 'city']) expect(changed).toContain(k)
  // list reflects the change after closing
  await dlg.getByRole('button', { name: 'Close' }).click()
  await page.getByLabel('Search members').fill(`Target Edited ${ts}`)
  await expect(page.getByRole('button', { name: new RegExp(`Target Edited ${ts}`) })).toBeVisible()
})

test('members: friendly errors for an empty name and a bad phone', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Target Edited ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Target Edited ${ts}`) }).click()
  const dlg = page.getByRole('dialog', { name: 'Edit member' })
  await dlg.getByLabel('Full name').fill('  ')
  await dlg.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Name cannot be empty')).toBeVisible()
  await dlg.getByLabel('Full name').fill(`Target Edited ${ts}`)
  await dlg.getByLabel('Mobile (private)').fill('call me')
  await dlg.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Please enter a valid mobile number')).toBeVisible()
  expect(sql(`select phone from profile_private where id = '${target.id}'`)).toBe('+91 98111 22333')
  await dlg.getByRole('button', { name: 'Close' }).click()
})

test('members: verify, unverify, reject, make admin, remove admin; all audited', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Target Edited ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Target Edited ${ts}`) }).click()
  const dlg = page.getByRole('dialog', { name: 'Edit member' })
  const flags = () => sql(`select verification || ':' || is_admin from profiles where id = '${target.id}'`)
  const n = () => auditCount(`action = 'set_member_flags' and target_id = '${target.id}' and actor = '${adminId}'`)
  const start = n()

  await dlg.getByRole('button', { name: 'Verify member' }).click()
  await expect(dlg.getByRole('button', { name: 'Remove verification' })).toBeVisible()
  expect(flags()).toBe('verified:false')
  await dlg.getByRole('button', { name: 'Remove verification' }).click()
  await expect(dlg.getByRole('button', { name: 'Verify member' })).toBeVisible()
  expect(flags()).toBe('pending:false')
  await dlg.getByRole('button', { name: 'Reject' }).click()
  await expect(dlg.getByRole('button', { name: 'Reject' })).toHaveCount(0)
  expect(flags()).toBe('rejected:false')
  await dlg.getByRole('button', { name: 'Verify member' }).click()
  await expect(dlg.getByRole('button', { name: 'Remove verification' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Make admin' }).click()
  await expect(dlg.getByRole('button', { name: 'Remove admin' })).toBeVisible()
  expect(flags()).toBe('verified:true')
  await dlg.getByRole('button', { name: 'Remove admin' }).click()
  await expect(dlg.getByRole('button', { name: 'Make admin' })).toBeVisible()
  expect(flags()).toBe('verified:false')
  expect(n()).toBe(start + 6)
  await dlg.getByRole('button', { name: 'Close' }).click()
})

test('members: an admin cannot remove their own admin access (UI and API)', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Admin Verify ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Admin Verify ${ts}`) }).click()
  const dlg = page.getByRole('dialog', { name: 'Edit member' })
  await expect(dlg.getByLabel('Full name')).toBeVisible()
  await expect(dlg.getByRole('button', { name: /admin/i })).toHaveCount(0)
  // API, with this admin's own session from the page
  const err = await page.evaluate(async ([id, anon]) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
    const token = JSON.parse(localStorage.getItem(key)!).access_token
    const res = await fetch('http://127.0.0.1:54321/rest/v1/rpc/admin_set_member', {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_is_admin: false, p_verification: null }),
    })
    return { status: res.status, body: await res.text() }
  }, [adminId, ANON] as const)
  expect(err.status).toBeGreaterThanOrEqual(400)
  expect(sql(`select is_admin from profiles where id = '${adminId}'`)).toBe('t')
})

test('activity log lists every admin action with actor', async () => {
  await page.goto('/admin/activity')
  await expect(page.getByText('Edited a member profile').first()).toBeVisible()
  await expect(page.getByText('Changed verification / admin access').first()).toBeVisible()
  await expect(page.getByText(/made admin/).first()).toBeVisible()
  await expect(page.getByText(/admin removed/).first()).toBeVisible()
  await expect(page.locator('main').getByText(new RegExp(`Admin Verify ${ts} ·`)).first()).toBeVisible()
})

// The audit rows store only target_id; the page never resolves it, so an entry reads
// "Edited a member profile · changed: city" without saying WHOSE profile was edited.
test('activity log says which member / registration each entry is about', async () => {
  await page.goto('/admin/activity')
  await expect(page.getByText(new RegExp(`Target Edited ${ts}`)).first()).toBeVisible({ timeout: 5000 })
})

// Owner asked: "admin can add profiles, update data".
test('admin can add a new member profile (someone not yet signed up)', async () => {
  await page.goto('/admin/members')
  await expect(page.getByRole('button', { name: /add (a )?member|new member|invite member/i })).toBeVisible({ timeout: 5000 })
})

test('admin can edit every profile field (headline, about, LinkedIn, website, country, skills)', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Target Edited ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Target Edited ${ts}`) }).click()
  const dlg = page.getByRole('dialog', { name: 'Edit member' })
  for (const l of ['Headline', 'About', 'LinkedIn', 'Website', 'Country', 'Skills']) await expect(dlg.getByLabel(new RegExp(l))).toBeVisible({ timeout: 3000 })
})

test('admin sees a member\'s email address (to contact them)', async () => {
  await page.goto('/admin/members')
  await page.getByLabel('Search members').fill(`Target Edited ${ts}`)
  await page.getByRole('button', { name: new RegExp(`Target Edited ${ts}`) }).click()
  // shown on request (the lookup is written to the activity log)
  await page.getByRole('dialog').getByRole('button', { name: /Show email/ }).click()
  await expect(page.getByRole('dialog').getByText(target.email)).toBeVisible({ timeout: 3000 })
})

test('no admin API response contains the Drive owner address', async () => {
  expect(responses.length).toBeGreaterThan(5)
  expect(responses.filter((b) => b.includes(OWNER_EMAIL))).toEqual([])
})

test('a removed admin loses the console immediately on reload', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })
  const p2 = await ctx.newPage()
  const ex = await makeUser('mem-exadmin', { admin: true })
  await loginPage(p2, ex, '/admin/members')
  await expect(p2.getByRole('heading', { name: 'Members' })).toBeVisible()
  sql(`update profiles set is_admin = false where id = '${ex.id}'`)
  await p2.reload()
  await expect(p2).toHaveURL(/\/$/)
  // and the server agrees
  expect((await ex.db.rpc('admin_update_member', { p_id: target.id, p_fields: { city: 'x' }, p_phone: null })).error?.code).toBe('42501')
  await ctx.close()
})
