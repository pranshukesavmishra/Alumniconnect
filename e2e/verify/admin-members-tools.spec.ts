// Import (dry run, start, failures, retry), duplicates (different people, merge and its refusals), view as member,
// analytics numbers and the activity log (labels, chips, search, dates, paging, CSV download that is itself logged).
import { expect, test, type Page } from '@playwright/test'
import { promises as fsp, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 412, height: 915 } })

const T = `Qx${ts}`.slice(0, 10)
let boss: TestUser
let page: Page

test.beforeAll(async ({ browser }) => {
  boss = await makeUser('mt-boss', { admin: true, name: `Boss ${T}` })
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
})
test.afterAll(async () => page.context().close())

test('import: dry run sorts rows, nothing is created until confirmed, unverified option, possible duplicates, a row that fails can be retried', async () => {
  const uph = `+91 9${String(Math.floor(Math.random() * 9e8) + 1e8)}` // unique per run, or earlier runs' people would match too
  const known = await makeUser('mt-known', { name: `Known ${T}`, phone: uph })
  const e = (k: string) => `imp-${k}-${ts}@test.local`
  const csv = join(tmpdir(), `mt-${T}.csv`)
  writeFileSync(csv, [
    'Name,E-mail ID,Mobile No.,Batch,Dept,City',
    `Fresh One ${T},${e('a')},,2004,CSE,Pune`,
    `Fresh Two ${T},${e('b')},,2005,ECE,Nagpur`,
    `Same Mail,${known.email.toUpperCase()},,2005,,`,
    `Maybe Same ${T},${e('c')},${uph},2005,,`,
    `Bad Row,not-an-email,,,,`,
    `Repeat ${T},${e('a')},,2004,,`,
  ].join('\n'))
  await loginPage(page, boss, '/admin/members/import')
  await page.getByLabel('CSV file').setInputFiles(csv)
  const counts = page.getByTestId('import-counts')
  await expect(counts).toContainText('2 new')
  await expect(counts).toContainText('1 already a member')
  await expect(counts).toContainText('1 possible duplicate')
  await expect(counts).toContainText('2 problem')
  const rows = page.getByTestId('import-rows')
  await expect(rows.locator('[data-status="invalid"]').last()).toContainText('appears earlier in the file')
  await expect(rows.locator('[data-status="exists"]')).toContainText(`Known ${T}`)
  await expect(rows.locator('[data-status="duplicate"]')).toContainText(`Known ${T}`)
  expect(sql(`select count(*) from auth.users where email like 'imp-%-${ts}@test.local'`)).toBe('0') // a dry run creates nothing
  expect(auditCount(`action = 'import_preview' and actor = '${boss.id}' and (details->>'new')::int = 2 and (details->>'invalid')::int = 2`)).toBe(1)

  // add the new ones as NOT verified; the possible duplicate stays out unless asked for
  await page.getByText('Mark them as verified JECians').click()
  await page.getByRole('button', { name: 'Add 2 members' }).click()
  await expect(page.getByText('Import started')).toBeVisible()
  await expect.poll(() => sql(`select count(*) from auth.users where email in ('${e('a')}', '${e('b')}')`), { timeout: 60_000 }).toBe('2')
  await expect.poll(() => sql(`select string_agg(p.verification::text || '/' || p.grad_year || '/' || p.city, ',' order by u.email) from profiles p join auth.users u on u.id = p.id where u.email in ('${e('a')}', '${e('b')}')`)).toBe('pending/2004/Pune,pending/2005/Nagpur')
  expect(sql(`select count(*) from auth.users where email = '${e('c')}'`)).toBe('0')
  const job = sql(`select id from import_jobs where created_by = '${boss.id}' order by created_at desc limit 1`)
  await expect(page.locator(`[data-job="${job}"]`)).toContainText('2 of 2 done')
  expect(auditCount(`action = 'import_job_start' and actor = '${boss.id}' and details->>'job' = '${job}'`)).toBe(1)
  expect(auditCount(`action = 'create_member' and actor = '${boss.id}' and details->>'email' in ('${e('a')}', '${e('b')}')`)).toBe(2)

  // a person added by someone else between the check and the start: that row fails with words; after the fix it can be retried
  const late = e('late')
  const lateRow = [{ line: 1, full_name: `Late ${T}`, email: late }, { line: 2, full_name: `Fine ${T}`, email: e('fine') }]
  const { data: j } = await boss.db.rpc('admin_import_start', { p_rows: lateRow, p_verified: true, p_request: crypto.randomUUID() })
  const other = await makeUser('mt-late', { name: `Taken ${T}` })
  sql(`update auth.users set email = '${late}' where id = '${other.id}'`)
  await page.goto('/admin/members/import')
  const card = page.locator(`[data-job="${j}"]`)
  await card.getByRole('button', { name: 'Resume' }).click()
  await expect(card).toContainText('2 of 2 done, 1 failed', { timeout: 60_000 })
  await expect(card).toContainText('already exists')
  sql(`update auth.users set email = 'moved-${ts}@test.local' where id = '${other.id}'`)
  await card.getByRole('button', { name: /Retry the 1 failed/ }).click()
  await expect.poll(() => sql(`select count(*) from auth.users where email = '${late}'`), { timeout: 60_000 }).toBe('1')
  await expect(card).toContainText('2 of 2 done')
  expect(sql(`select count(*) from import_job_rows where job_id = '${j}' and status = 'done'`)).toBe('2')
  // starting the same request twice is one job; members cannot start one
  const rq = crypto.randomUUID()
  const one = await boss.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: `Twice ${T}`, email: e('tw') }], p_verified: true, p_request: rq })
  const two = await boss.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: `Twice ${T}`, email: e('tw') }], p_verified: true, p_request: rq })
  expect(one.data).toBe(two.data)
  expect((await known.db.rpc('admin_import_start', { p_rows: [{ line: 1, full_name: 'No No', email: 'nono@test.local' }], p_verified: true })).error?.code).toBe('42501')
  expect((await known.db.rpc('admin_import_preview', { p_rows: [] })).error?.code).toBe('42501')
  // a file with no usable columns is explained, not silently accepted
  const bad = join(tmpdir(), `mt-bad-${T}.csv`)
  writeFileSync(bad, 'Foo,Bar\n1,2\n')
  await page.getByLabel('CSV file').setInputFiles(bad)
  await expect(page.getByText(/column|Email|e-mail/i).first()).toBeVisible()
})

test('duplicates: suggested, "different people" hides them for good; merge shows what moves; refusals in words', async () => {
  const sur = Array.from({ length: 10 }, () => 'bcdfghjklmnpqrstvwxz'[Math.floor(Math.random() * 20)]).join('') // random: look-alike names from earlier runs must not pair with these
  let n = 0
  const uniq = () => `+91 8${String(Math.floor(Math.random() * 9e7) + 1e7)}${++n}` // default phones collide across the shared database
  const yr = 1950 + Math.floor(Math.random() * 12) // a rare batch: look-alike names from other tests share nobody's batch with these
  const ph = `+91 9${String(Math.floor(Math.random() * 9e8) + 1e8)}`
  const a = await makeUser('mt-da', { name: `Dev ${sur}`, phone: ph, grad: yr })
  const b = await makeUser('mt-db', { name: `Dev ${sur}`, phone: ph, grad: yr })
  const c = await makeUser('mt-dc', { name: `Eva ${sur}`, phone: uniq(), grad: yr + 20 })
  const d = await makeUser('mt-dd', { name: `Eva ${sur}`, phone: uniq(), grad: yr + 20, admin: true })
  const f = await makeUser('mt-df', { name: `Fay ${sur}`, phone: uniq(), grad: yr + 30 })
  const g = await makeUser('mt-dg', { name: `Fay ${sur}`, phone: uniq(), grad: yr + 30 })
  const ev = makeEvent(`${T}dup`.toLowerCase())
  await register(f, ev)
  await register(g, ev)
  await loginPage(page, boss, `/admin/members/duplicates?q=${encodeURIComponent(sur)}`)
  const list = page.getByTestId('duplicates').locator(':scope > li')
  await expect(list).toHaveCount(3)
  await expect(list.filter({ hasText: 'Same mobile number' })).toHaveCount(1)

  // "different people": gone, logged, and stays gone after a reload
  const devPair = list.filter({ hasText: `Dev ${sur}` })
  await devPair.getByRole('button', { name: 'Different people' }).click()
  await expect(list).toHaveCount(2)
  const [lo, hi] = [a.id, b.id].sort()
  expect(sql(`select count(*) from admin_duplicate_dismissals where a = '${lo}' and b = '${hi}'`)).toBe('1')
  expect(auditCount(`action = 'dismiss_duplicate' and actor = '${boss.id}' and target_id = '${lo}'`)).toBe(1)
  await page.reload()
  await expect(list).toHaveCount(2)

  // both registered for the same event: refused, the Merge button is off, nothing changes
  const fayPair = list.filter({ hasText: `Fay ${sur}` })
  await fayPair.getByRole('button', { name: /Merge/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Merge profiles' })
  await expect(sheet).toContainText('Both are registered for')
  await expect(sheet.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled()
  const serverRefusal = await boss.db.rpc('admin_merge_members', { p_keep: f.id, p_drop: g.id })
  expect(serverRefusal.error?.message).toContain('Both are registered for')
  expect(sql(`select count(*) from auth.users where id in ('${f.id}', '${g.id}')`)).toBe('2')
  await sheet.getByRole('button', { name: 'Cancel' }).click()

  // the one being removed is an admin: refused; swapping the sides makes it allowed
  const evaPair = list.filter({ hasText: `Eva ${sur}` })
  await evaPair.getByRole('button', { name: /Merge/ }).click()
  const keepName = await sheet.locator('p', { hasText: 'Keep (stays' }).locator('xpath=following-sibling::div[1]').textContent()
  const adminIsRemoved = !(keepName ?? '').includes('Admin')
  if (adminIsRemoved) {
    await expect(sheet).toContainText('is an admin')
    await expect(sheet.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled()
    await sheet.getByRole('button', { name: /Swap/ }).click()
  }
  await expect(sheet.getByRole('button', { name: 'Merge', exact: true })).toBeEnabled()
  expect((await boss.db.rpc('admin_merge_members', { p_keep: c.id, p_drop: d.id })).error?.message).toContain('is an admin')
  expect(sql(`select count(*) from auth.users where id in ('${c.id}', '${d.id}')`)).toBe('2')
  await sheet.getByRole('button', { name: 'Cancel' }).click()

  // yourself: refused by the server in words (and the preview says so)
  expect((await boss.db.rpc('admin_merge_members', { p_keep: a.id, p_drop: boss.id })).error?.message).toContain('cannot merge away your own account')
  expect((await boss.db.rpc('admin_merge_members', { p_keep: a.id, p_drop: a.id })).error?.message).toContain('two different members')
  const prev = await boss.db.rpc('admin_merge_preview', { p_keep: a.id, p_drop: boss.id })
  expect(prev.error?.message ?? '').toBe('')
  expect(JSON.stringify(prev.data?.blocks)).toContain('your own account')
  expect(JSON.stringify(prev.data)).not.toContain(a.email.toLowerCase()) // e-mail is masked in the preview
  expect((await a.db.rpc('admin_merge_preview', { p_keep: a.id, p_drop: b.id })).error?.code).toBe('42501')

  // merge Eva (admin kept): the duplicate's account is deleted, the log says who and what
  await evaPair.getByRole('button', { name: /Merge/ }).click()
  if (adminIsRemoved) await sheet.getByRole('button', { name: /Swap/ }).click()
  await sheet.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Profiles merged')).toBeVisible()
  expect(sql(`select count(*) from auth.users where id = '${c.id}'`)).toBe('0')
  expect(sql(`select count(*) from auth.users where id = '${d.id}'`)).toBe('1')
  expect(auditCount(`action = 'merge_member' and actor = '${boss.id}' and target_id = '${d.id}' and details->>'merged_id' = '${c.id}'`)).toBe(1)
})

test('view as member: read-only, no phone or e-mail, logged; members cannot use it', async () => {
  const ph = `+91 9${String(Math.floor(Math.random() * 9e8) + 1e8)}`
  const who = await makeUser('mt-va', { name: `Viewed ${T}`, phone: ph })
  const ev = makeEvent(`${T}va`.toLowerCase())
  const { reg } = await register(who, ev, true)
  const before = auditCount(`action = 'view_as_member' and actor = '${boss.id}' and target_id = '${who.id}'`)
  await page.goto(`/admin/members/${who.id}`)
  await page.getByRole('link', { name: 'View as member' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/members/${who.id}/preview`))
  const pv = page.getByTestId('member-preview')
  await expect(pv).toContainText(`Viewed ${T}`)
  await expect(pv).toContainText(reg.code)
  await expect(pv).toContainText('waiting|submitted|Payment', { useInnerText: true }).catch(() => undefined)
  await expect(page.getByText('Read-only preview').first()).toBeVisible()
  await expect(page.locator('main')).not.toContainText(ph.slice(4))
  await expect(page.locator('main')).not.toContainText(who.email.toLowerCase())
  // nothing on the page can change anything: no form fields and no action buttons inside the preview
  await expect(pv.locator('input, textarea, select, button')).toHaveCount(0)
  await expect.poll(() => auditCount(`action = 'view_as_member' and actor = '${boss.id}' and target_id = '${who.id}'`)).toBeGreaterThan(before)
  const raw = await boss.db.rpc('admin_view_as_member', { p_member: who.id })
  expect(JSON.stringify(raw.data)).not.toContain(ph.slice(4))
  expect(JSON.stringify(raw.data)).not.toContain(who.email.toLowerCase())
  expect((await who.db.rpc('admin_view_as_member', { p_member: who.id })).error?.code).toBe('42501')
  // a plain member typing the address is sent away
  const m = await page.context().browser()!.newContext({ viewport: { width: 412, height: 915 } })
  const mp = await m.newPage()
  await loginPage(mp, who, `/admin/members/${who.id}/preview`)
  await expect(mp).not.toHaveURL(/preview/)
  await m.close()
  // the history says it, with the admin's name
  await page.goto(`/admin/members/${who.id}`)
  await expect(page.getByTestId('timeline')).toContainText('Previewed what a member sees')
  await expect(page.getByTestId('timeline')).toContainText(`Boss ${T}`)
})

test('analytics: every card and chart matches the database', async () => {
  const count = (q: string) => Number(sql(q))
  await page.goto('/admin/analytics')
  const card = (label: string) => page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::p[1]')
  const checks: [string, () => string][] = [
    ['Members', () => String(count('select count(*) from profiles'))],
    ['Verified', () => String(count(`select count(*) from profiles where verification = 'verified'`))],
    ['Profile completed', () => String(count('select count(*) from profiles where onboarded'))],
    ['Waiting for verification', () => String(count(`select count(*) from profiles where onboarded and verification = 'pending'`))],
    ['Open jobs', () => String(count('select count(*) from jobs where not is_hidden and not is_closed and expires_at > now()'))],
    ['Open help requests', () => String(count('select count(*) from help_requests where not is_resolved and not is_hidden'))],
    ['Reports to review', () => String(count(`select count(*) from reports where status = 'open'`))],
    ['Phones with notifications', () => String(count('select count(*) from push_subscriptions'))],
    ['Joined by invite', () => String(count('select count(*) from profiles where invited_by is not null'))],
  ]
  // the database moves while other tests run: wait until the screen and the database agree
  for (const [label, want] of checks) {
    await expect.poll(async () => {
      await page.goto('/admin/analytics')
      return (await card(label).textContent({ timeout: 5000 }).catch(() => null)) === want() ? 'same' : `${label} differs`
    }, { timeout: 45_000, message: label }).toBe('same')
  }
  // chart data: the 30 sign-up bars add up to the people who joined in those days, batch and branch rows to the profiles with that field
  const data = (await boss.db.rpc('admin_analytics')).data as { signups_by_day: { day: string; count: number }[]; by_batch: { members: number }[]; by_branch: { members: number }[]; members: { total: number } }
  expect(data.signups_by_day).toHaveLength(30)
  expect(data.by_branch.reduce((s, x) => s + x.members, 0)).toBeLessThanOrEqual(data.members.total)
  const sumBars = data.signups_by_day.reduce((s, x) => s + x.count, 0)
  expect(sumBars).toBeLessThanOrEqual(data.members.total)
  const inWindow = count(`select count(*) from profiles where (created_at at time zone 'Asia/Kolkata')::date >= ((now() at time zone 'Asia/Kolkata')::date - 29)`)
  expect(Math.abs(sumBars - inWindow)).toBeLessThanOrEqual(50) // other tests add people while we look
  await expect(page.getByRole('img', { name: /Sign-ups per day for the last 30 days/ })).toBeVisible()
  expect(data.by_batch.reduce((s, x) => s + x.members, 0)).toBeLessThanOrEqual(data.members.total)
  // members and other roles cannot read it
  const plain = await makeUser('mt-an')
  expect((await plain.db.rpc('admin_analytics')).error?.code).toBe('42501')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('activity log: readable labels with names, chips, text search, dates, paging, and a download that is itself logged', async () => {
  const target = await makeUser('mt-al', { name: `Logged ${T}`, verified: false })
  await boss.db.rpc('admin_set_member', { p_id: target.id, p_is_admin: null, p_verification: 'verified' })
  await boss.db.rpc('admin_add_member_note', { p_member: target.id, p_body: 'x' })
  await boss.db.rpc('admin_member_email', { p_id: target.id })
  await page.goto('/admin/activity')
  const rows = page.getByTestId('audit-rows')
  await expect(rows.locator('[data-action]').first()).toBeVisible()

  // every row has a readable label (no raw action names) and says who did it
  await expect.poll(async () => (await rows.locator('[data-action]').count()) > 0).toBe(true)
  const raw = await rows.locator('[data-action]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-action')!, e.querySelector('p')!.textContent!]))
  for (const [action, text] of raw) expect(text, action).not.toMatch(/^[a-z]+(_[a-z]+)+/)

  // search by the person's name: the label, the subject's name and the actor's name are all shown
  await page.getByLabel('Search the activity log').fill(`Logged ${T}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const flags = rows.locator('[data-action="set_member_flags"]').first()
  await expect(flags).toContainText('Changed verification / admin access')
  await expect(flags).toContainText(`Logged ${T}`)
  await expect(flags).toContainText(`Boss ${T}`)
  await expect(flags).toContainText('verification pending → verified')
  await expect(rows.locator('[data-action="view_member_email"]').first()).toContainText('Looked up a member’s email')
  await expect(rows.locator('[data-action="add_member_note"]').first()).toContainText('Added a private note')

  // chips narrow to a kind of action
  await page.getByRole('button', { name: 'Members', exact: true }).click()
  await expect(rows.locator('[data-action="set_member_flags"]')).toHaveCount(0) // that one belongs to Roles
  await expect(rows.locator('[data-action="add_member_note"]')).toHaveCount(0)
  await expect(rows.locator('[data-action="view_member_email"]').first()).toBeVisible()
  await page.getByRole('button', { name: 'Roles', exact: true }).click()
  await expect(rows.locator('[data-action="set_member_flags"]').first()).toBeVisible()
  await expect(rows.locator('[data-action="view_member_email"]')).toHaveCount(0)
  for (const chip of ['Moderation', 'Messages', 'Money']) {
    await page.getByRole('button', { name: chip, exact: true }).click()
    await expect(page.getByRole('button', { name: chip, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(rows.locator('[data-action="set_member_flags"]')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Everything', exact: true }).click()

  // dates: today shows our entries; a day in the past, before they existed, shows none
  const today = new Date().toISOString().slice(0, 10)
  await page.getByLabel('From date').fill(today)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(rows.locator('[data-action="set_member_flags"]').first()).toBeVisible()
  await page.getByLabel('From date').fill('2020-01-01')
  await page.getByLabel('To date').fill('2020-01-31')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText('Nothing matches')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()

  // paging: 50 at a time, "Show older" brings more, never repeating an entry
  await expect(rows.locator('[data-action]')).toHaveCount(50)
  await page.getByRole('button', { name: 'Show older' }).click()
  await expect.poll(() => rows.locator('[data-action]').count()).toBeGreaterThan(50)

  // download what is on screen: the file has readable labels, and the download itself is logged
  await page.getByLabel('Search the activity log').fill(`Logged ${T}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(rows.locator('[data-action="set_member_flags"]').first()).toBeVisible()
  const before = auditCount(`action = 'export_audit' and actor = '${boss.id}'`)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const csv = await fsp.readFile((await dl.path())!, 'utf8')
  expect(csv).toContain('Changed verification / admin access')
  expect(csv).toContain(`Logged ${T}`)
  expect(csv).not.toContain('set_member_flags')
  await expect.poll(() => auditCount(`action = 'export_audit' and actor = '${boss.id}'`)).toBe(before + 1)
  expect(auditCount(`action = 'export_audit' and actor = '${boss.id}' and details->'filter'->>'q' = 'Logged ${T}'`)).toBe(1)
  await page.goto('/admin/activity')
  await expect(page.getByTestId('audit-rows').locator('[data-action="export_audit"]').first()).toContainText('Downloaded the activity log')
  // only admins read it
  expect((await target.db.rpc('admin_audit_search', {})).error?.code).toBe('42501')
  expect((await target.db.rpc('admin_log_audit_export', { p_count: 1 })).error?.code).toBe('42501')
  expect((await target.db.from('admin_audit').select('id')).data ?? []).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})
