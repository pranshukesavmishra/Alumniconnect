// Members screen, end to end: every filter, saved views, bulk verify / reject / unverify (with what the member can then
// see), CSV export, notes, history, adding a member, editing a profile and the admin / verification switches.
import { expect, test, type Page } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import { onboard, signInWithEmail, sql } from '../helpers'
import { auditCount, loginPage, makeUser, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 412, height: 915 } })

const T = `Zk${ts}`.slice(0, 10) // in every test member's surname: the search box narrows to exactly this run's people
const CSE = 'B.E. in Computer Science & Engineering'
let boss: TestUser
let page: Page
let dialogMode: 'accept' | 'dismiss' = 'accept' // what the browser's confirm boxes get
const m: Record<string, TestUser> = {}

const shown = async () => (await page.locator('main ul.divide-y > li button span.block.truncate.font-semibold').allTextContents()).map((s) => s.replace(` ${T}`, ''))
const total = async () => (await page.getByTestId('member-total').textContent())?.match(/^(\d+) member/)?.[1] ?? '…'

/** The list currently on screen, once it has settled. */
async function expectShown(names: string[]) {
  await expect.poll(async () => (await shown()).sort().join(','), { timeout: 20_000 }).toBe([...names].sort().join(','))
  await expect.poll(total).toBe(String(names.length))
}

async function openFilters() {
  await page.getByRole('button', { name: /^Refine the list/ }).click()
  return page.getByRole('dialog', { name: 'Refine members' })
}
async function applyFilters(set: (dlg: ReturnType<Page['getByRole']>) => Promise<void>) {
  const dlg = await openFilters()
  await set(dlg)
  await dlg.getByRole('button', { name: 'Show members' }).click()
  await expect(dlg).toBeHidden()
}

test.beforeAll(async ({ browser }) => {
  boss = await makeUser('ml-boss', { admin: true, name: `Boss ${T}` })
  const mk = async (key: string, o: Parameters<typeof makeUser>[1]) => (m[key] = await makeUser(`ml-${key}`, { name: `${key} ${T}`, ...o }))
  await mk('Alpha', { verified: false, grad: 2001 })
  await mk('Bravo', { grad: 2010 })
  await mk('Charlie', { grad: 2003 })
  await mk('Delta', { grad: 2005, admin: true })
  await mk('Echo', { verified: false, onboarded: false, grad: 2008 })
  sql(`update profiles set grad_year = 2012, city = 'Kolkata', member_type = 'alumnus' where id = '${boss.id}'`)
  const set = (k: string, cols: string) => sql(`update profiles set ${cols} where id = '${m[k]!.id}'`)
  set('Alpha', `member_type = 'alumnus', branch = '${CSE}', city = 'Pune', current_company = 'Initech ${T}', created_at = now() - interval '10 days'`)
  sql(`update auth.users set last_sign_in_at = null where id = '${m.Alpha!.id}'`)
  set('Bravo', `member_type = 'student', branch = 'B.E. in Mechanical Engineering', city = 'Delhi', created_at = now() - interval '5 days'`)
  set('Charlie', `member_type = 'faculty', branch = 'B.E. in Information Technology', city = 'Mumbai', verification = 'rejected'`)
  set('Delta', `member_type = 'alumnus', branch = '${CSE}', city = 'Pune'`)
  set('Echo', `member_type = 'alumnus', branch = '${CSE}', city = 'Nagpur ${T}'`)
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  page = await ctx.newPage()
  page.on('dialog', (d) => void (dialogMode === 'accept' ? d.accept() : d.dismiss()))
  await loginPage(page, boss, `/admin/members?q=${encodeURIComponent(T)}`)
})
test.afterAll(async () => page.context().close())

test('filters: search words, status, profile, sign-in, joined, branch, batch, city, type and order', async () => {
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', `Boss`])
  // search matches name, city, company and branch
  await page.getByLabel('Search members').fill(`Initech ${T}`)
  await expectShown(['Alpha'])
  await page.getByLabel('Search members').fill(`Nagpur ${T}`)
  await expectShown(['Echo'])
  await page.getByLabel('Search members').fill(`alpha ${T}`.toUpperCase())
  await expectShown(['Alpha'])
  await page.getByLabel('Search members').fill(T)
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])

  // status select
  const status = page.getByLabel('Filter', { exact: true })
  for (const [v, want] of [['pending', ['Alpha', 'Echo']], ['verified', ['Bravo', 'Delta', 'Boss']], ['rejected', ['Charlie']], ['admins', ['Delta', 'Boss']], ['all', ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss']]] as const) {
    await status.selectOption(v)
    await expectShown([...want])
  }
  await expect(page).toHaveURL(/q=Zk/)

  // each extra filter on its own, then cleared
  const cases: [string, (dlg: ReturnType<Page['getByRole']>) => Promise<void>, string[]][] = [
    ['profile completed', async (d) => { await d.getByLabel('Profile').selectOption('yes') }, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Boss']],
    ['profile not completed', async (d) => { await d.getByLabel('Profile').selectOption('no') }, ['Echo']],
    ['never signed in', async (d) => { await d.getByLabel('Signed in').selectOption('never') }, ['Alpha']],
    ['has signed in', async (d) => { await d.getByLabel('Signed in').selectOption('yes') }, ['Bravo', 'Charlie', 'Delta', 'Echo', 'Boss']],
    ['joined over 7 days ago', async (d) => { await d.getByLabel(/Joined more than/).fill('7') }, ['Alpha']],
    ['joined over 3 days ago', async (d) => { await d.getByLabel(/Joined more than/).fill('3') }, ['Alpha', 'Bravo']],
    ['branch', async (d) => { await d.getByLabel('Branch').selectOption(CSE) }, ['Alpha', 'Delta', 'Echo']],
    ['batch 2003 to 2008', async (d) => { await d.getByLabel('Batch from').selectOption('2003'); await d.getByLabel('Batch to').selectOption('2008') }, ['Charlie', 'Delta', 'Echo']],
    ['batch 2005 or later', async (d) => { await d.getByLabel('Batch from').selectOption('2005') }, ['Bravo', 'Delta', 'Echo', 'Boss']],
    ['batch 2003 or earlier', async (d) => { await d.getByLabel('Batch to').selectOption('2003') }, ['Alpha', 'Charlie']],
    ['city (part of the word, any case)', async (d) => { await d.getByLabel('City').fill('PUN') }, ['Alpha', 'Delta']],
    ['member type student', async (d) => { await d.getByLabel('Member type').selectOption('student') }, ['Bravo']],
    ['member type faculty', async (d) => { await d.getByLabel('Member type').selectOption('faculty') }, ['Charlie']],
    ['member type alumnus', async (d) => { await d.getByLabel('Member type').selectOption('alumnus') }, ['Alpha', 'Delta', 'Echo', 'Boss']],
  ]
  for (const [name, set, want] of cases) {
    await applyFilters(set)
    await expectShown(want)
    expect(await page.getByTestId('member-total').textContent(), name).toContain('·') // the active filter is described in words
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByLabel('Search members').fill(T)
    await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])
  }

  // combined: not yet verified AND finished profile AND waiting more than 3 days
  await page.getByLabel('Filter', { exact: true }).selectOption('pending')
  await expectShown(['Alpha', 'Echo'])
  await applyFilters(async (d) => { await d.getByLabel('Profile').selectOption('yes'); await d.getByLabel(/Joined more than/).fill('3') })
  await expectShown(['Alpha'])
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Search members').fill(T)
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])

  // order: by name, by batch (newest batch first), oldest first, newest first
  const order = async (value: string) => {
    await applyFilters(async (d) => { await d.getByLabel('Order').selectOption(value) })
    await expect.poll(async () => (await shown()).join(',')).not.toBe('')
  }
  await order('name')
  await expect.poll(async () => (await shown()).join(',')).toBe('Alpha,Boss,Bravo,Charlie,Delta,Echo')
  await order('batch')
  await expect.poll(async () => (await shown()).filter((n) => n !== 'Boss').join(',')).toBe('Bravo,Echo,Delta,Charlie,Alpha')
  await order('oldest')
  await expect.poll(async () => (await shown()).slice(0, 2).join(',')).toBe('Alpha,Bravo')
  await order('newest')
  await expect.poll(async () => (await shown()).slice(-2).join(',')).toBe('Bravo,Alpha')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Search members').fill(T)

  // the server refuses nonsense and says so in words
  const bad = await boss.db.rpc('admin_list_members', { p_filter: { status: 'banana' } })
  expect(bad.error?.message).toContain('Unknown status filter')
  const nonAdmin = await m.Bravo!.db.rpc('admin_list_members', { p_filter: {} })
  expect(nonAdmin.error?.code).toBe('42501')
})

test('"Select all" reaches members beyond the first page; the page limit is respected', async () => {
  // 40 per page: more than one page when the list is not narrowed
  await page.goto('/admin/members')
  await expect.poll(async () => Number(await total()) > 0 || (await total()) === '0').toBe(true)
  const n = Number(await total())
  if (n > 40) {
    expect(await page.locator('main ul.divide-y > li').count()).toBe(40)
    await page.getByRole('button', { name: 'Show more' }).click()
    await expect.poll(() => page.locator('main ul.divide-y > li').count()).toBeGreaterThan(40)
    await page.getByRole('button', { name: /^Select all \d+/ }).click()
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText(`${Math.min(n, 2000)} selected`)
    await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Clear' }).click()
  }
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])
})

test('saved views: create from the filters, apply by one tap, appear for another admin, delete with confirmation; all logged', async () => {
  const name = `Pune pending ${T}`
  await page.getByLabel('Filter', { exact: true }).selectOption('pending')
  await expectShown(['Alpha', 'Echo'])
  await applyFilters(async (d) => { await d.getByLabel('City').fill('Pune') })
  await expectShown(['Alpha'])
  const dlg = await openFilters()
  await dlg.getByLabel('View name').fill(name)
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(`Saved “${name}” for every admin`)).toBeVisible()
  const row = sql(`select filter::text from admin_member_views where name = '${name}'`)
  expect(JSON.parse(row)).toMatchObject({ status: 'pending', city: 'Pune' })
  expect(auditCount(`action = 'save_member_view' and actor = '${boss.id}' and details->>'name' = '${name}'`)).toBe(1)

  // apply it from a clean list
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Search members').fill(T)
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])
  await page.getByRole('button', { name: name }).click()
  await expect(page.getByRole('button', { name: name })).toHaveAttribute('aria-pressed', 'true')
  await expectShown(['Alpha'])
  // tapping it again turns it off
  await page.getByRole('button', { name: name }).click()
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss'])

  // another admin sees the same view
  const other = await makeUser('ml-other', { admin: true })
  const seen = await other.db.from('admin_member_views').select('name').eq('name', name)
  expect(seen.data).toHaveLength(1)
  // a plain member sees none of them
  expect((await m.Bravo!.db.from('admin_member_views').select('name')).data).toEqual([])
  // saving under the same name replaces it instead of failing
  const again = await boss.db.rpc('admin_save_member_view', { p_name: name, p_filter: { status: 'verified' } })
  expect(again.error).toBeNull()
  expect(sql(`select count(*) from admin_member_views where name = '${name}'`)).toBe('1')
  expect(sql(`select filter->>'status' from admin_member_views where name = '${name}'`)).toBe('verified')
  // invalid filters are refused with words
  expect((await boss.db.rpc('admin_save_member_view', { p_name: 'x', p_filter: { status: 'nonsense' } })).error?.message).toContain('Unknown status filter')

  // delete from the filters sheet (a confirmation first)
  const d2 = await openFilters()
  dialogMode = 'dismiss'
  await d2.getByRole('button', { name: `Remove view ${name}` }).click()
  dialogMode = 'accept'
  expect(sql(`select count(*) from admin_member_views where name = '${name}'`)).toBe('1')
  await d2.getByRole('button', { name: `Remove view ${name}` }).click()
  await expect.poll(() => sql(`select count(*) from admin_member_views where name = '${name}'`)).toBe('0')
  expect(auditCount(`action = 'delete_member_view' and actor = '${boss.id}' and details->>'name' = '${name}'`)).toBe(1)
  await d2.getByRole('button', { name: 'Clear these' }).click()
  await expect(page.getByRole('button', { name })).toHaveCount(0)
})

test('bulk verify / reject / unverify: confirmation, per-member log lines, and what the members can then see', async () => {
  const b: TestUser[] = []
  for (const i of [1, 2, 3]) b.push(await makeUser(`ml-b${i}`, { name: `Bulk${i} ${T}`, verified: false }))
  const already = await makeUser('ml-b4', { name: `Bulk4 ${T}` })
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
  await expect(page.getByLabel(`Select Bulk4 ${T}`)).toBeVisible()
  const seesDirectory = async (u: TestUser) => ((await u.db.from('profiles').select('id').eq('id', boss.id)).data ?? []).length === 1
  expect(await seesDirectory(b[0]!)).toBe(false) // an unverified member cannot read other profiles
  expect(await seesDirectory(already)).toBe(true)

  const bulk = page.getByRole('region', { name: 'Bulk actions' })
  for (const i of [1, 2, 3, 4]) await page.getByLabel(`Select Bulk${i} ${T}`).check()
  await expect(bulk).toContainText('4 selected')

  // cancel: nothing happens
  await bulk.getByRole('button', { name: 'Verify', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Verify members' })
  await expect(sheet).toContainText('Verify 4 members?')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  expect(sql(`select count(*) from profiles where id in ('${b.map((x) => x.id).join("','")}') and verification = 'verified'`)).toBe('0')

  // confirm with a note: three change, one already was
  await bulk.getByRole('button', { name: 'Verify', exact: true }).click()
  await sheet.getByLabel('Note for the activity log').fill(`register checked ${T}`)
  await sheet.getByRole('button', { name: 'Verify 4' }).click()
  await expect(page.getByText('3 members verified (1 already were)')).toBeVisible()
  expect(sql(`select count(*) from profiles where id in ('${b.map((x) => x.id).join("','")}') and verification = 'verified'`)).toBe('3')
  expect(auditCount(`action = 'set_member_flags' and actor = '${boss.id}' and details->>'bulk' = 'true' and details->>'note' = 'register checked ${T}'`)).toBe(3)
  for (const x of b) expect(auditCount(`action = 'set_member_flags' and target_id = '${x.id}' and details->'verification'->>'to' = 'verified'`)).toBe(1)
  expect(auditCount(`action = 'set_member_flags' and target_id = '${already.id}' and details->>'bulk' = 'true'`)).toBe(0)
  expect(await seesDirectory(b[0]!)).toBe(true) // the verified member now sees the directory
  await expect(bulk).toHaveCount(0) // the selection is cleared after the action

  // reject two, with a different note
  await page.getByLabel(`Select Bulk1 ${T}`).check()
  await page.getByLabel(`Select Bulk2 ${T}`).check()
  await bulk.getByRole('button', { name: 'Reject', exact: true }).click()
  const rej = page.getByRole('dialog', { name: 'Reject members' })
  await expect(rej).toContainText('NOT JECians')
  await rej.getByRole('button', { name: 'Reject 2' }).click()
  await expect(page.getByText('2 members rejected')).toBeVisible()
  expect(sql(`select string_agg(verification::text, ',' order by full_name) from profiles where id in ('${b[0]!.id}', '${b[1]!.id}')`)).toBe('rejected,rejected')
  expect(await seesDirectory(b[0]!)).toBe(false)
  expect(auditCount(`action = 'set_member_flags' and target_id = '${b[0]!.id}' and details->'verification'->>'to' = 'rejected'`)).toBe(1)

  // unverify one verified and one rejected
  await page.getByLabel(`Select Bulk3 ${T}`).check()
  await page.getByLabel(`Select Bulk1 ${T}`).check()
  await bulk.getByRole('button', { name: 'Unverify', exact: true }).click()
  await page.getByRole('dialog', { name: 'Unverify members' }).getByRole('button', { name: 'Unverify 2' }).click()
  await expect(page.getByText(/2 members moved back to “not yet verified”/)).toBeVisible()
  expect(sql(`select string_agg(verification::text, ',' order by full_name) from profiles where id in ('${b[0]!.id}', '${b[2]!.id}')`)).toBe('pending,pending')

  // the same request sent twice changes nothing more (a double tap or a dropped connection)
  const rq = crypto.randomUUID()
  const first = await boss.db.rpc('admin_bulk_set_verification', { p_ids: [b[0]!.id], p_verification: 'verified', p_note: null, p_request: rq })
  const second = await boss.db.rpc('admin_bulk_set_verification', { p_ids: [b[0]!.id], p_verification: 'verified', p_note: null, p_request: rq })
  expect(first.data).toMatchObject({ changed: 1 })
  expect(second.data).toMatchObject({ changed: 1, repeated: true })
  expect(auditCount(`action = 'set_member_flags' and target_id = '${b[0]!.id}' and details->'verification'->>'to' = 'verified'`)).toBe(2) // once by the bulk verify, once here
  // limits and permissions
  expect((await boss.db.rpc('admin_bulk_set_verification', { p_ids: [], p_verification: 'verified' })).error?.message).toContain('Select at least one member')
  expect((await b[0]!.db.rpc('admin_bulk_set_verification', { p_ids: [b[1]!.id], p_verification: 'verified' })).error?.code).toBe('42501')

  // history of one of them lists every change with the admin's name and the note
  await page.goto(`/admin/members/${b[1]!.id}`)
  const tl = page.getByTestId('timeline')
  await expect(tl).toContainText('Changed verification / admin access')
  await expect(tl).toContainText('verification pending → verified')
  await expect(tl).toContainText('verification verified → rejected')
  await expect(tl).toContainText(`Boss ${T}`)
  await expect(tl).toContainText(`register checked ${T}`)
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
})

test('export: the selection or the filter, contact columns only when asked (and then logged)', async () => {
  await expectShown(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Boss', 'Bulk1', 'Bulk2', 'Bulk3', 'Bulk4'])
  // no selection: everyone who matches the filter
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Export members' })
  await expect(dlg).toContainText('Export 10 members')
  await expect(dlg).toContainText('Everyone matching the current filters')
  const exportsBefore = auditCount(`action = 'export_members' and actor = '${boss.id}'`)
  let [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download CSV' }).click()])
  const plain = await fsp.readFile((await dl.path())!, 'utf8')
  expect(plain.split('\n').filter((l) => l.includes(T)).length).toBe(10)
  expect(plain).not.toContain('Mobile')
  expect(plain).not.toContain('@test.local')
  expect(plain).not.toContain(sql(`select phone from profile_private where id = '${m.Alpha!.id}'`).replace(/\D/g, '').slice(-6))
  expect(auditCount(`action = 'export_members' and actor = '${boss.id}' and details->>'contact' = 'false'`)).toBe(exportsBefore + 1)
  expect(auditCount(`action = 'export_members' and actor = '${boss.id}' and (details->>'count')::int = 10`)).toBeGreaterThanOrEqual(1)

  // a selection of two, with contact details
  await page.getByLabel(`Select Alpha ${T}`).check()
  await page.getByLabel(`Select Bravo ${T}`).check()
  await page.getByRole('button', { name: 'Export 2' }).click()
  await expect(dlg).toContainText('Export 2 members')
  await expect(dlg).toContainText('The members you selected')
  await dlg.getByText('Include mobile and e-mail').click()
  await expect(dlg).toContainText('Contact details are private')
  ;[dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download CSV' }).click()])
  const withContact = await fsp.readFile((await dl.path())!, 'utf8')
  const lines = withContact.split('\n').filter((l) => l.includes(T))
  expect(lines).toHaveLength(2)
  expect(withContact).toContain('Mobile')
  expect(withContact).toContain(m.Alpha!.email.toLowerCase())
  expect(withContact).toContain(m.Bravo!.email.toLowerCase())
  expect(withContact).toContain(sql(`select phone from profile_private where id = '${m.Bravo!.id}'`))
  expect(withContact).not.toContain(m.Charlie!.email.toLowerCase())
  expect(auditCount(`action = 'export_members' and actor = '${boss.id}' and details->>'contact' = 'true' and (details->>'count')::int = 2`)).toBe(1)
  // the activity log says so in words
  await page.goto('/admin/activity')
  await page.getByRole('button', { name: 'Members', exact: true }).click()
  await expect(page.getByTestId('audit-rows').locator('[data-action="export_members"]').first()).toContainText('with phone and e-mail')
  // not an admin, no export
  expect((await m.Bravo!.db.rpc('admin_export_members', { p_ids: [m.Alpha!.id], p_contact: true })).error?.code).toBe('42501')
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
})

test('private notes: add and delete, logged, invisible to the member, shown in the history', async () => {
  await page.getByLabel('Search members').fill(`Echo ${T}`)
  await page.getByRole('button', { name: new RegExp(`Echo ${T}`) }).click()
  const ed = page.getByRole('dialog', { name: 'Edit member' })
  await ed.getByLabel('New private note').fill(`Rang twice, no answer ${T}`)
  await ed.getByRole('button', { name: 'Add note' }).click()
  await expect(ed.getByText(`Rang twice, no answer ${T}`)).toBeVisible()
  await ed.getByLabel('New private note').fill(`Second note ${T}`)
  await ed.getByRole('button', { name: 'Add note' }).click()
  await expect(ed.getByText(`Second note ${T}`)).toBeVisible()
  expect(sql(`select count(*) from admin_member_notes where member_id = '${m.Echo!.id}'`)).toBe('2')
  expect(auditCount(`action = 'add_member_note' and actor = '${boss.id}' and target_id = '${m.Echo!.id}'`)).toBe(2)
  expect(sql(`select author from admin_member_notes where body = 'Second note ${T}'`)).toBe(boss.id)
  // the member cannot read it, by any route
  expect((await m.Echo!.db.from('admin_member_notes').select('body')).data).toEqual([])
  expect((await m.Echo!.db.rpc('admin_add_member_note', { p_member: m.Echo!.id, p_body: 'hi' })).error?.code).toBe('42501')
  expect((await m.Echo!.db.rpc('admin_member_timeline', { p_id: m.Echo!.id })).error?.code).toBe('42501')
  // an empty note is not sent; a too-long one is refused with words
  await expect(ed.getByRole('button', { name: 'Add note' })).toBeDisabled()
  expect((await boss.db.rpc('admin_add_member_note', { p_member: m.Echo!.id, p_body: 'x'.repeat(2001) })).error?.message).toContain('at most 2000')
  // the list shows the note count
  await ed.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`Echo ${T}`) })).toContainText('2 notes')
  // delete one with a confirmation
  await page.getByRole('button', { name: new RegExp(`Echo ${T}`) }).click()
  dialogMode = 'dismiss'
  await ed.getByRole('button', { name: 'Remove note' }).first().click()
  dialogMode = 'accept'
  expect(sql(`select count(*) from admin_member_notes where member_id = '${m.Echo!.id}'`)).toBe('2')
  await ed.getByRole('button', { name: 'Remove note' }).first().click()
  await expect.poll(() => sql(`select count(*) from admin_member_notes where member_id = '${m.Echo!.id}'`)).toBe('1')
  expect(auditCount(`action = 'delete_member_note' and actor = '${boss.id}' and target_id = '${m.Echo!.id}'`)).toBe(1)
  // history: the remaining note, the removal and who did it
  await ed.getByRole('link', { name: 'History', exact: true }).click()
  const tl = page.getByTestId('timeline')
  await expect(tl).toContainText(`Rang twice, no answer ${T}`)
  await expect(tl).toContainText('Removed a private note')
  await expect(tl).toContainText('Added a private note')
  await expect(tl).toContainText('Joined the app')
  await page.getByRole('button', { name: 'Notes' }).click()
  await expect(tl.locator('[data-kind]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Admin actions' }).click()
  await expect(tl.locator('[data-kind]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Everything' }).click()
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
})

test('add a member: validation, the new profile, the log, a duplicate e-mail, and the person claiming it by signing in', async ({ browser }) => {
  const email = `new-${ts}-ml@test.local`
  const name = `Newcomer ${T}`
  await page.getByRole('button', { name: 'Add member' }).click()
  const dlg = page.getByRole('dialog', { name: 'Add a member' })
  // validation in words
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(dlg).toContainText('Please enter the member’s full name.')
  await dlg.getByLabel('Full name').fill(name)
  await dlg.getByLabel('Email', { exact: true }).fill('not-an-email')
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(dlg).toContainText('Please enter a valid email address.')
  await dlg.getByLabel('Email', { exact: true }).fill(email.toUpperCase())
  await dlg.getByLabel('Mobile (private)').fill('12')
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(dlg).toContainText('Numbers in India have 10 digits')
  expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe('0')
  // a good one
  await dlg.getByLabel('Mobile (private)').fill('+91 98765 11122')
  await dlg.getByLabel('Branch').selectOption(CSE)
  await dlg.getByLabel('Passing-out year').selectOption('1999')
  await dlg.getByLabel('Current role').fill('Engineer')
  await dlg.getByLabel('Company').fill('Globex')
  await dlg.getByLabel('City').fill('Nagpur')
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit member' })).toContainText(name)
  const id = sql(`select id from auth.users where email = '${email}'`)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`select concat_ws('|', full_name, member_type, branch, grad_year, current_title, current_company, city, verification, onboarded) from profiles where id = '${id}'`))
    .toBe(`${name}|alumnus|${CSE}|1999|Engineer|Globex|Nagpur|verified|f`)
  expect(sql(`select phone from profile_private where id = '${id}'`)).toBe('+919876511122')
  expect(sql(`select raw_app_meta_data->>'created_by_admin' from auth.users where id = '${id}'`)).toBe(boss.id)
  expect(auditCount(`action = 'create_member' and actor = '${boss.id}' and target_id = '${id}' and details->>'email' = '${email}'`)).toBe(1)
  expect(auditCount(`action = 'update_member' and actor = '${boss.id}' and target_id = '${id}'`)).toBeGreaterThanOrEqual(1)
  await page.getByRole('dialog', { name: 'Edit member' }).getByRole('button', { name: 'Close' }).click()
  // adding the same e-mail again is refused with words (any case)
  await page.getByRole('button', { name: 'Add member' }).click()
  await dlg.getByLabel('Full name').fill(`Copy ${T}`)
  await dlg.getByLabel('Email', { exact: true }).fill(email)
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(dlg).toContainText('A member with this email already exists')
  expect(sql(`select count(*) from auth.users where lower(email) = '${email}'`)).toBe('1')
  // a "not verified" one stays unverified
  await page.keyboard.press('Escape')
  const e2 = `new2-${ts}-ml@test.local`
  await page.getByRole('button', { name: 'Add member' }).click()
  await dlg.getByLabel('Full name').fill(`Unchecked ${T}`)
  await dlg.getByLabel('Email', { exact: true }).fill(e2)
  await dlg.getByLabel('Mark as a verified JECian').uncheck()
  await dlg.getByRole('button', { name: 'Add member' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit member' })).toContainText(`Unchecked ${T}`)
  expect(sql(`select verification from profiles p join auth.users u on u.id = p.id where u.email = '${e2}'`)).toBe('pending')
  // only an admin may call it
  const { data: mem } = await m.Bravo!.db.functions.invoke('admin-create-member', { body: { email: `x-${ts}@test.local`, full_name: 'Nope Nope' } }).then((r) => ({ data: r.error }))
  expect(mem).toBeTruthy()
  expect(sql(`select count(*) from auth.users where email = 'x-${ts}@test.local'`)).toBe('0')

  // the person signs in with that address and lands in the profile the admin made
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const p2 = await ctx.newPage()
  await p2.goto('/signin')
  await signInWithEmail(p2, email)
  await expect(p2.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await expect(p2.getByLabel('Full name')).toHaveValue(name)
  await onboard(p2, name, '1999').catch(() => undefined)
  expect(sql(`select count(*) from auth.users where lower(email) = '${email}'`)).toBe('1')
  expect(sql(`select id from auth.users where lower(email) = '${email}'`)).toBe(id)
  await ctx.close()
  await page.goto(`/admin/members?q=${encodeURIComponent(T)}`)
})

test('edit a member: every field saved, phone and e-mail handled privately, errors in words, all logged', async () => {
  await page.getByLabel('Search members').fill(`Charlie ${T}`)
  await page.getByRole('button', { name: new RegExp(`Charlie ${T}`) }).click()
  const ed = page.getByRole('dialog', { name: 'Edit member' })
  await expect(ed.getByLabel('Full name')).toHaveValue(`Charlie ${T}`)
  // an empty name and a bad phone are refused in words, nothing saved
  await ed.getByLabel('Full name').fill('')
  await ed.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Name cannot be empty')).toBeVisible()
  await ed.getByLabel('Full name').fill(`Charles ${T}`)
  await ed.getByLabel('Mobile (private)').fill('12')
  await ed.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Numbers in India have 10 digits')).toBeVisible()
  expect(sql(`select full_name from profiles where id = '${m.Charlie!.id}'`)).toBe(`Charlie ${T}`)

  await ed.getByRole('radio', { name: 'Alumnus' }).check({ force: true }).catch(async () => { await ed.getByText('Alumnus', { exact: true }).click() })
  await ed.getByLabel('Branch').selectOption('B.E. in Civil Engineering')
  await ed.getByLabel('Passing-out year').selectOption('2004')
  await ed.getByLabel('Joining year').selectOption('2000')
  await ed.getByLabel('Current role').fill('Architect')
  await ed.getByLabel('Company').fill('Wayne Corp')
  await ed.getByLabel('City').fill('Chennai')
  await ed.getByLabel('Country').fill('India')
  await ed.getByLabel('Mobile (private)').fill('+91 99887 76655')
  await ed.getByLabel('Headline').fill('Builds bridges')
  await ed.getByLabel('About').fill('Twenty years of bridges.')
  await ed.getByLabel('LinkedIn profile link').fill('https://www.linkedin.com/in/charles-test')
  await ed.getByLabel('Website').fill('https://charles.example.com')
  await ed.getByLabel('Skills').fill('Steel, Concrete , ,Surveying')
  await ed.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile updated')).toBeVisible()
  expect(sql(`select concat_ws('|', full_name, member_type, branch, grad_year, join_year, current_title, current_company, city, country, headline, about, linkedin_url, website_url, array_to_string(skills, ',')) from profiles where id = '${m.Charlie!.id}'`))
    .toBe(`Charles ${T}|alumnus|B.E. in Civil Engineering|2004|2000|Architect|Wayne Corp|Chennai|India|Builds bridges|Twenty years of bridges.|https://www.linkedin.com/in/charles-test|https://charles.example.com|Steel,Concrete,Surveying`)
  expect(sql(`select phone from profile_private where id = '${m.Charlie!.id}'`)).toBe('+919988776655')
  const logged = sql(`select details::text from admin_audit where action = 'update_member' and target_id = '${m.Charlie!.id}' and actor = '${boss.id}' order by id desc limit 1`)
  expect(logged).toContain('"city"')
  expect(logged).toContain('Chennai')
  // what the member sees of their own profile
  const mine = await m.Charlie!.db.from('profiles').select('city, headline, current_company').eq('id', m.Charlie!.id).single()
  expect(mine.data).toEqual({ city: 'Chennai', headline: 'Builds bridges', current_company: 'Wayne Corp' })

  // the e-mail is hidden until asked for; asking is logged
  await expect(ed).not.toContainText(m.Charlie!.email.toLowerCase())
  const lookups = auditCount(`action = 'view_member_email' and actor = '${boss.id}' and target_id = '${m.Charlie!.id}'`)
  await ed.getByRole('button', { name: 'Show email (logged)' }).click()
  await expect(ed).toContainText(m.Charlie!.email.toLowerCase())
  expect(auditCount(`action = 'view_member_email' and actor = '${boss.id}' and target_id = '${m.Charlie!.id}'`)).toBe(lookups + 1)
  expect((await m.Bravo!.db.rpc('admin_member_email', { p_id: m.Charlie!.id })).error?.code).toBe('42501')
  expect((await m.Bravo!.db.rpc('admin_update_member', { p_id: m.Charlie!.id, p_fields: { city: 'X' } })).error?.code).toBe('42501')

  // an unknown field is refused by the server
  expect((await boss.db.rpc('admin_update_member', { p_id: m.Charlie!.id, p_fields: { is_admin: true } })).error?.message).toContain('cannot be changed')
  await ed.getByRole('button', { name: 'Close' }).click()
})

test('switches: verify, remove verification, reject; confirmations, log, and what changes for the member; admin access is not here', async () => {
  const target = m.Echo!
  await page.getByLabel('Search members').fill(`Echo ${T}`)
  await page.getByRole('button', { name: new RegExp(`Echo ${T}`) }).click()
  const ed = page.getByRole('dialog', { name: 'Edit member' })
  const flags = () => sql(`select concat_ws('|', verification, is_admin) from profiles where id = '${target.id}'`)
  const logged = (to: string) => auditCount(`action = 'set_member_flags' and actor = '${boss.id}' and target_id = '${target.id}' and details->'verification'->>'to' = '${to}'`)

  // declining a confirmation changes nothing
  dialogMode = 'dismiss'
  await ed.getByRole('button', { name: 'Verify member' }).click()
  dialogMode = 'accept'
  expect(flags()).toBe('pending|f')

  await ed.getByRole('button', { name: 'Verify member' }).click()
  await expect.poll(flags).toBe('verified|f')
  await expect(ed.getByRole('button', { name: 'Remove verification' })).toBeVisible()
  const seen = async () => ((await target.db.from('profiles').select('id').eq('id', boss.id)).data ?? []).length
  expect(await seen()).toBe(1)

  await ed.getByRole('button', { name: 'Reject' }).click()
  await expect.poll(flags).toBe('rejected|f')
  expect(await seen()).toBe(0)
  await ed.getByRole('button', { name: 'Verify member' }).click()
  await expect.poll(flags).toBe('verified|f')
  await ed.getByRole('button', { name: 'Remove verification' }).click()
  await expect.poll(flags).toBe('pending|f')
  expect(logged('verified')).toBe(2)
  expect(logged('rejected')).toBe(1)
  expect(logged('pending')).toBe(1)

  // admin access is a super admin's job (Roles page): no switch here, and the old function refuses to flip it
  await expect(ed.getByRole('button', { name: /^(Make|Remove) admin/ })).toHaveCount(0)
  expect((await boss.db.rpc('admin_set_member', { p_id: target.id, p_is_admin: true, p_verification: null })).error?.code).toBe('42501')
  expect(flags()).toBe('pending|f')
  expect((await target.db.rpc('admin_list_members', { p_filter: {} })).error?.code).toBe('42501')
  await ed.getByRole('button', { name: 'Close' }).dispatchEvent('click') // a toast may still sit over the button

  // one's own row has no "remove admin" button, and the server refuses it too
  await page.getByLabel('Search members').fill(`Boss ${T}`)
  await page.getByRole('button', { name: new RegExp(`Boss ${T}`) }).click()
  await expect(ed.getByRole('button', { name: 'Make admin' })).toHaveCount(0)
  await expect(ed.getByRole('button', { name: /Remove admin/ })).toHaveCount(0)
  expect((await boss.db.rpc('admin_set_member', { p_id: boss.id, p_is_admin: false, p_verification: null })).error?.message).toContain('cannot remove your own admin access')
  expect(sql(`select is_admin from profiles where id = '${boss.id}'`)).toBe('t')
  await ed.getByRole('button', { name: 'Close' }).click()
  // the log reads in words
  await page.goto('/admin/activity')
  await page.getByLabel('Search the activity log').fill(`Echo ${T}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const rows = page.getByTestId('audit-rows')
  await expect(rows.locator('[data-action="set_member_flags"]').first()).toContainText(`Echo ${T}`)
  await expect(rows.locator('[data-action="set_member_flags"]').first()).toContainText(`Boss ${T}`)
})

test('the screens at 360px: no sideways scroll on the list, filters, history', async () => {
  await page.setViewportSize({ width: 360, height: 800 })
  for (const p of [`/admin/members?q=${T}`, `/admin/members/${m.Alpha!.id}`, '/admin/members/import', '/admin/members/duplicates']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), p).toBeLessThanOrEqual(0)
  }
  await page.goto(`/admin/members?q=${T}`)
  await page.getByLabel('Select everyone shown').check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 412, height: 915 })
})
