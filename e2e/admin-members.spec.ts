import { expect, test, type Page } from '@playwright/test'
import { promises as fsp, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from './helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts } from './verify/admin-lib'

// Pass 2 of the admin programme: member management at scale, asserted against the database.
// Every member here is created by this run (unique surname), so other tests' data never makes it fail.

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('members: filter, saved view, bulk verify, export, notes, timeline, import, duplicates and merge', async ({ browser }) => {
  const tag = `mm${ts}`.slice(0, 12)
  const sur = `Zq${tag}`
  const uniq = String(Math.floor(Math.random() * 9e5) + 1e5) // phones are unique per run: earlier runs' people must not look like duplicates
  const ph = (n: number) => `+91 9${uniq.slice(0, 3)} ${uniq.slice(3)}${n}`
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${sur}` })
  const w1 = await makeUser(`${tag}w1`, { name: `Waita ${sur}`, verified: false, phone: ph(1) })
  const w2 = await makeUser(`${tag}w2`, { name: `Waitb ${sur}`, verified: false, phone: ph(2) })
  const w3 = await makeUser(`${tag}w3`, { name: `Waitc ${sur}`, verified: false, phone: ph(3) })
  sql(`update profiles set created_at = now() - interval '10 days' where id in ('${w1.id}', '${w2.id}')`)
  // the same person twice: dup2 has a registration and a payment
  const dup1 = await makeUser(`${tag}d1`, { name: `Twin ${sur}`, phone: ph(0), grad: 2003 })
  const dup2 = await makeUser(`${tag}d2`, { name: `Twin ${sur}`, phone: ph(0), grad: 2003 })
  for (const i of [1, 2, 3]) await makeUser(`${tag}x${i}`, { name: `Extra${i} ${sur}` }) // enough hits for "See all"
  const ev = makeEvent(tag)
  const { reg, payment } = await register(dup2, ev, true)

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  const page = await ctx.newPage()
  await loginPage(page, boss, '/admin/members?filter=pending')
  await page.getByLabel('Search members').fill(sur)
  await expect(page.getByTestId('member-total')).toContainText('3 members')
  await expect(page.getByLabel('Filter')).toHaveValue('pending')

  // ---- filter: waiting more than 3 days (two of the three), via the preset view
  await page.getByRole('button', { name: 'Waiting over 3 days', pressed: false }).click()
  await expect(page.getByTestId('member-total')).toContainText('2 members')
  await expect(page.getByText(`Waitc ${sur}`)).toHaveCount(0)
  await noSideScroll(page)

  // ---- save the current filters as a shared view
  await page.getByRole('button', { name: /^Refine the list/ }).click()
  await page.getByLabel('View name').fill(`Old waiters ${tag}`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => sql(`select filter->>'older' from admin_member_views where name = 'Old waiters ${tag}'`)).toBe('3')
  expect(auditCount(`action = 'save_member_view' and actor = '${boss.id}' and details->>'name' = 'Old waiters ${tag}'`)).toBe(1)
  await expect(page.getByRole('button', { name: `Old waiters ${tag}` })).toBeVisible()

  // ---- bulk verify the two: the database changes, one log line each
  await page.getByLabel('Select everyone shown').check()
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('2 selected')
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Verify', exact: true }).click()
  await page.getByLabel('Note for the activity log').fill(`batch register ${tag}`)
  await page.getByRole('button', { name: 'Verify 2' }).click()
  await expect(page.getByTestId('member-total')).toContainText('0 members')
  expect(sql(`select count(*) from profiles where id in ('${w1.id}', '${w2.id}') and verification = 'verified'`)).toBe('2')
  expect(sql(`select verification from profiles where id = '${w3.id}'`)).toBe('pending')
  expect(auditCount(`action = 'set_member_flags' and actor = '${boss.id}' and details->>'bulk' = 'true' and details->>'note' = 'batch register ${tag}'`)).toBe(2)

  // ---- export the three: contact columns only when asked, and then it is logged
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Search members').fill(sur)
  await expect(page.getByTestId('member-total')).toContainText('9 members')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  let [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const plain = await fsp.readFile((await dl.path())!, 'utf8')
  expect(plain).toContain(`Waita ${sur}`)
  expect(plain).not.toContain(ph(1).slice(4))
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByText('Include mobile and e-mail').click()
  ;[dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const withContact = await fsp.readFile((await dl.path())!, 'utf8')
  expect(withContact).toContain(ph(1).slice(4))
  expect(withContact).toContain(w1.email)
  expect(auditCount(`action = 'export_members' and actor = '${boss.id}' and details->>'contact' = 'true'`)).toBe(1)

  // ---- a private note, then the timeline shows it, the bulk verification and the registration history
  await page.getByLabel('Search members').fill(`Waita ${sur}`)
  await page.getByRole('button', { name: new RegExp(`Waita ${sur}`) }).click()
  await page.getByLabel('New private note').fill(`Called on 3 Oct ${tag}`)
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText(`Called on 3 Oct ${tag}`)).toBeVisible()
  expect(sql(`select count(*) from admin_member_notes where member_id = '${w1.id}' and body = 'Called on 3 Oct ${tag}'`)).toBe('1')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/members/${w1.id}`))
  const tl = page.getByTestId('timeline')
  await expect(tl).toContainText(`Called on 3 Oct ${tag}`)
  await expect(tl).toContainText('verification pending → verified')
  await expect(tl).toContainText(`Boss ${sur}`)
  await expect(page.locator('main')).not.toContainText(ph(1).slice(4))
  await page.getByRole('button', { name: 'Notes' }).click()
  await expect(tl.locator('[data-kind]')).toHaveCount(1)
  await noSideScroll(page)

  // ---- search: "See all" shows more than 8, and a hit leads to the member's history
  await page.goto('/admin')
  const search = page.getByLabel('Search everything')
  await search.fill(sur)
  const results = page.getByRole('region', { name: 'Search results' })
  await expect(results.getByRole('link', { name: new RegExp(`^History of`) })).toHaveCount(8)
  await results.getByRole('button', { name: 'See all' }).first().click()
  await expect(results.getByRole('link', { name: new RegExp(`^History of`) })).toHaveCount(9)
  await results.getByRole('link', { name: `History of Waitb ${sur}` }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/members/${w2.id}`))
  await expect(page.getByRole('heading', { name: `Waitb ${sur}` })).toBeVisible()

  // ---- timeline of the registrant shows the registration and the payment, linking to the event
  await page.goto(`/admin/members/${dup2.id}`)
  await expect(page.getByTestId('timeline')).toContainText(reg.code)
  await expect(page.getByTestId('timeline')).toContainText('waiting to be verified')

  // ---- CSV import: dry run first (nothing created), then confirm
  const csv = join(tmpdir(), `members-${tag}.csv`)
  const newEmail = `imp-${ts}-${tag}@test.local`
  writeFileSync(csv, [
    'Name,E-mail ID,Mobile No.,Batch,Dept',
    `Nalini Imported ${tag},${newEmail},${ph(5)},Batch of 2004,CSE`,
    `Already Here,${w1.email.toUpperCase()},,2005,`,
    `Maybe Twin ${tag},maybe-${ts}-${tag}@test.local,${ph(1)},2005,`,
    `Bad Row,not-an-email,,,`,
  ].join('\n'))
  await page.goto('/admin/members/import')
  await page.getByLabel('CSV file').setInputFiles(csv)
  const counts = page.getByTestId('import-counts')
  await expect(counts).toContainText('1 new')
  await expect(counts).toContainText('1 already a member')
  await expect(counts).toContainText('1 possible duplicate')
  await expect(counts).toContainText('1 problem')
  expect(sql(`select count(*) from auth.users where email = '${newEmail}'`)).toBe('0') // a dry run creates nothing
  expect(auditCount(`action = 'import_preview' and actor = '${boss.id}'`)).toBeGreaterThan(0)
  await expect(page.getByTestId('import-rows').locator('[data-status="invalid"]')).toContainText('E-mail address is missing or not valid')
  await noSideScroll(page)
  await page.getByRole('button', { name: 'Add 1 member' }).click()
  await expect(page.getByTestId('import-progress')).toContainText('1 of 1 done')
  await expect.poll(() => sql(`select count(*) from auth.users where email = '${newEmail}'`)).toBe('1')
  expect(sql(`select p.grad_year || '/' || p.branch || '/' || p.verification from profiles p join auth.users u on u.id = p.id where u.email = '${newEmail}'`)).toBe('2004/B.E. in Computer Science & Engineering/verified')
  expect(auditCount(`action = 'create_member' and actor = '${boss.id}' and details->>'email' = '${newEmail}'`)).toBe(1)

  // ---- duplicates: the twins are suggested; merging shows what moves, then moves it
  await page.goto(`/admin/members/duplicates?q=${encodeURIComponent(`Twin ${sur}`)}`)
  const pair = page.getByTestId('duplicates').getByRole('listitem').filter({ hasText: 'Same mobile number' })
  await expect(pair).toHaveCount(1)
  await expect(pair).toContainText('Same name')
  await pair.getByRole('button', { name: /Merge/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Merge profiles' })
  await expect(sheet.getByTestId('merge-moves')).toBeVisible()
  // keep the one that holds the registration so the move is visible either way
  const keepText = await sheet.textContent()
  expect(keepText).toContain('Remove (account is deleted)')
  page.once('dialog', (d) => d.accept())
  await sheet.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Profiles merged')).toBeVisible()
  await expect(pair).toHaveCount(0)
  expect(sql(`select count(*) from auth.users where id in ('${dup1.id}', '${dup2.id}')`)).toBe('1')
  const survivor = sql(`select id from auth.users where id in ('${dup1.id}', '${dup2.id}')`)
  expect(sql(`select user_id from event_registrations where id = '${reg.id}'`)).toBe(survivor)
  expect(sql(`select count(*) from event_payments where id = '${payment!.id}'`)).toBe('1')
  expect(auditCount(`action = 'merge_member' and actor = '${boss.id}' and target_id = '${survivor}'`)).toBe(1)
  await page.goto(`/admin/members/${survivor}`)
  await expect(page.getByTestId('timeline')).toContainText('Merged a duplicate profile')
  await noSideScroll(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/admin/members')
  await noSideScroll(page)
  await ctx.close()

  // ---- members and treasurers cannot reach any of it, in the screen or the database
  const buyer = await makeUser(`${tag}buy`, { name: `Buyer ${sur}` })
  const m = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const mp = await m.newPage()
  await loginPage(mp, buyer, '/admin/members/import')
  await expect(mp).not.toHaveURL(/\/admin\/members/)
  await mp.goto(`/admin/members/${w1.id}`)
  await expect(mp).not.toHaveURL(/\/admin\/members/)
  expect((await buyer.db.rpc('admin_list_members', { p_filter: {} })).error?.code).toBe('42501')
  expect((await buyer.db.rpc('admin_bulk_set_verification', { p_ids: [w3.id], p_verification: 'verified' })).error?.code).toBe('42501')
  expect((await buyer.db.rpc('admin_member_timeline', { p_id: w1.id })).error?.code).toBe('42501')
  expect((await buyer.db.rpc('admin_merge_members', { p_keep: w1.id, p_drop: w2.id })).error?.code).toBe('42501')
  expect((await buyer.db.from('admin_member_notes').select('id')).data).toEqual([])
  expect(sql(`select verification from profiles where id = '${w3.id}'`)).toBe('pending')
  await m.close()
})
