import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from './helpers'
import { API, ANON, loginPage, makeEvent, makeUser, register, ts } from './verify/admin-lib'

// Admin pass 5: import jobs that survive closing the tab, retries, idempotent bulk actions, edit conflicts, health page.
const tag = `rb${ts}`.slice(0, 10)
test.use({ viewport: { width: 412, height: 915 } })

async function runJob(token: string, job: string) {
  const res = await fetch(`${API}/functions/v1/admin-create-member`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: job }) })
  return res.status
}

test('import: closing the tab does not stop it; failed rows can be fixed and retried; resume works from a fresh page', async ({ browser }) => {
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Importer ${tag}` })
  const e1 = `imp1-${ts}-${tag}@test.local`
  const e2 = `imp2-${ts}-${tag}@test.local`
  const csv = join(tmpdir(), `members-${tag}.csv`)
  writeFileSync(csv, ['Name,E-mail ID,Batch,Dept', `Iris One ${tag},${e1},2004,CSE`, `Ivan Two ${tag},${e2},2005,CSE`].join('\n'))

  // start from the screen, then close the page straight away
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const page = await ctx.newPage()
  await loginPage(page, boss, '/admin/members/import')
  await page.getByLabel('CSV file').setInputFiles(csv)
  await page.getByRole('button', { name: 'Add 2 members' }).click()
  await expect(page.getByText('Import started')).toBeVisible()
  await ctx.close()
  await expect.poll(() => sql(`select count(*) from auth.users where email in ('${e1}', '${e2}')`), { timeout: 60_000 }).toBe('2')
  const job = sql(`select id from import_jobs where created_by = '${boss.id}' order by created_at desc limit 1`)
  await expect.poll(() => sql(`select count(*) from import_job_rows where job_id = '${job}' and status = 'done'`)).toBe('2')

  // a job with a bad mobile number: that row fails, the others are fine
  const e3 = `imp3-${ts}-${tag}@test.local`
  const e4 = `imp4-${ts}-${tag}@test.local`
  const { data: j2, error } = await boss.db.rpc('admin_import_start', {
    p_rows: [{ line: 1, full_name: `Good Row ${tag}`, email: e3 }, { line: 2, full_name: `Bad Phone ${tag}`, email: e4, phone: 'abc' }],
    p_verified: true,
    p_request: crypto.randomUUID(),
  })
  expect(error).toBeNull()
  expect(await runJob(boss.session.access_token, j2 as string)).toBe(202)
  await expect.poll(() => sql(`select string_agg(status, ',' order by line) from import_job_rows where job_id = '${j2}'`), { timeout: 60_000 }).toBe('done,failed')
  expect(sql(`select count(*) from auth.users where email = '${e4}'`)).toBe('0')

  const page2 = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage()
  await loginPage(page2, boss, '/admin/members/import')
  const card = page2.locator(`[data-job="${j2}"]`)
  await expect(card).toContainText('2 of 2 done, 1 failed')
  await expect(card).toContainText('Bad Phone')
  // fix the data, retry only the failed row
  sql(`update import_job_rows set payload = payload - 'phone' where job_id = '${j2}' and status = 'failed'`)
  await card.getByRole('button', { name: /Retry the 1 failed/ }).click()
  await expect.poll(() => sql(`select count(*) from auth.users where email = '${e4}'`), { timeout: 60_000 }).toBe('1')
  await expect(card).toContainText('2 of 2 done')
  expect(sql(`select count(*) from admin_audit where action = 'import_job_retry' and actor = '${boss.id}'`)).toBe('1')

  // a job nobody is working on (browser closed before it started) is picked up with Resume
  const e5 = `imp5-${ts}-${tag}@test.local`
  const { data: j3 } = await boss.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: `Late Row ${tag}`, email: e5 }], p_verified: true, p_request: crypto.randomUUID() })
  await page2.goto('/admin/members/import')
  await page2.locator(`[data-job="${j3}"]`).getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => sql(`select count(*) from auth.users where email = '${e5}'`), { timeout: 60_000 }).toBe('1')
  // the same start request twice is one job
  const rq = crypto.randomUUID()
  const a = await boss.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: 'Twice Tester', email: `twice-${ts}-${tag}@test.local` }], p_verified: true, p_request: rq })
  const b = await boss.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: 'Twice Tester', email: `twice-${ts}-${tag}@test.local` }], p_verified: true, p_request: rq })
  expect(a.data).toBe(b.data)
  // a non-admin cannot start or run one
  const plain = await makeUser(`${tag}plain`)
  expect((await plain.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: 'X Y', email: 'xy@test.local' }], p_verified: true, p_request: null })).error?.code).toBe('42501')
  expect(await runJob(plain.session.access_token, j3 as string)).toBe(403)
})

test('bulk actions are idempotent; two admins editing one registration get a clear conflict message', async ({ browser }) => {
  const boss = await makeUser(`${tag}b2`, { admin: true })
  const ev = makeEvent(`${tag}c`)
  const buyer = await makeUser(`${tag}by`, { name: `Buyer ${tag}` })
  const { reg, payment } = await register(buyer, ev, true)
  const rq = crypto.randomUUID()
  const first = await boss.db.rpc('admin_bulk_review_payments', { p_ids: [payment!.id], p_approve: true, p_note: null, p_request: rq })
  expect(first.data).toMatchObject({ done: 1, unchanged: 0 })
  const again = await boss.db.rpc('admin_bulk_review_payments', { p_ids: [payment!.id], p_approve: true, p_note: null, p_request: rq })
  expect(again.data).toMatchObject({ done: 1, repeated: true })
  const fresh = await boss.db.rpc('admin_bulk_review_payments', { p_ids: [payment!.id], p_approve: true, p_note: null })
  expect(fresh.data).toMatchObject({ done: 0, unchanged: 1, failed: [] })
  expect(sql(`select count(*) from admin_audit where action = 'verify_payment' and details->>'payment_id' = '${payment!.id}'`)).toBe('1')

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=people`)
  await page.getByLabel('Search registrations').fill(reg.code)
  await page.getByRole('button', { name: new RegExp(reg.code) }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Edit registration' }).click()
  // meanwhile another admin changes the same registration
  sql(`update event_registrations set food_pref = 'jain' where id = '${reg.id}'`)
  await dlg.getByLabel('T-shirt').selectOption('XL')
  await dlg.getByLabel('Reason for change').fill('Size change')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/Someone else changed this registration/)).toBeVisible()
  expect(sql(`select concat_ws('|', food_pref, tshirt_size) from event_registrations where id = '${reg.id}'`)).toBe('jain|L')
  await ctx.close()
})

test('health page shows backups, push, storage and imports to admins only', async ({ browser }) => {
  const boss = await makeUser(`${tag}hb`, { admin: true })
  const plain = await makeUser(`${tag}hp`)
  sql(`insert into system_events (kind, ok, detail) values ('backup', true, 'Health test ${tag}')`)
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await ctx.newPage()
  await loginPage(page, boss, '/admin/health')
  const h = page.getByTestId('health')
  await expect(h).toContainText('Nightly backup')
  await expect(h).toContainText(`Health test ${tag}`)
  await expect(h).toContainText('Storage')
  await expect(h).toContainText('Push notifications')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect((await plain.db.rpc('admin_health')).error?.code).toBe('42501')
  expect((await plain.db.from('system_events').select('id')).error?.code).toBe('42501')
  await ctx.close()
})

test('admin screens in Hindi: home, roles, event tabs, confirmation text; switching back restores English', async ({ browser }) => {
  const boss = await makeUser(`${tag}hi`, { admin: true, name: `Hindi Boss ${tag}` })
  const ev = makeEvent(`${tag}h`)
  const buyer = await makeUser(`${tag}hb2`)
  await register(buyer, ev, true)
  sql(`update profiles set language = 'hi' where id = '${boss.id}'`)
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const page = await ctx.newPage()
  await loginPage(page, boss, '/admin')
  await expect(page.getByText('आपके ध्यान की ज़रूरत')).toBeVisible()
  await expect(page.getByRole('link', { name: /इनबॉक्स/ })).toBeVisible()
  await expect(page.getByText('Needs your attention')).toHaveCount(0)
  await page.goto('/admin/roles')
  await expect(page.getByText('हर भूमिका क्या कर सकती है')).toBeVisible()
  await expect(page.getByLabel('भूमिका', { exact: true })).toBeVisible()
  await page.goto(`/admin/events/${ev.slug}?tab=payments`)
  await expect(page.getByRole('tab', { name: 'भुगतान' }).or(page.getByRole('tab', { name: /भुगतान/ }))).toBeVisible()
  await page.goto(`/admin/events/${ev.slug}?tab=messages`)
  await expect(page.getByText('नया संदेश')).toBeVisible()
  await page.getByLabel('शीर्षक').fill('नमस्ते सब')
  await page.getByLabel('संदेश', { exact: true }).fill('मिलते हैं')
  await expect(page.getByTestId('message-preview')).toContainText('यह ऐसा दिखेगा')
  // the native confirmation box is Hindi too
  let asked = ''
  page.once('dialog', (d) => { asked = d.message(); void d.dismiss() })
  await page.getByRole('button', { name: /भेजें/ }).last().click()
  await expect.poll(() => asked).toContain('वापस नहीं')
  // back to English
  sql(`update profiles set language = 'en' where id = '${boss.id}'`)
  await page.goto('/me')
  await page.getByRole('button', { name: 'English' }).click()
  await page.goto('/admin')
  await expect(page.getByText('Needs your attention')).toBeVisible()
  await ctx.close()
})
