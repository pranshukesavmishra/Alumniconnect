// Event admin, end to end: Overview numbers, bank-statement upload, People search, refund + cancel, Settings (fields, valid-on days,
// UPI, publish toggle) and what members see afterwards. Each step is asserted in the database and in the activity log.
import { expect, test, type Page } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts } from './admin-lib'

const phoneCtx = (browser: import('@playwright/test').Browser) => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
const tag = (s: string) => `${s}${ts}`.slice(0, 14)

test('overview: every number matches the database (registrations, confirmed, collected, awaiting, unpaid)', async ({ browser }) => {
  const t = tag('o1')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const ev = makeEvent(t)
  const unpaid = await register(await makeUser(`${t}a`, { name: `Unpaid ${t}` }), ev, false)
  const review = await register(await makeUser(`${t}c`, { name: `Review ${t}` }), ev, true)
  const paid = await register(await makeUser(`${t}d`, { name: `Paid ${t}` }), ev, true)
  const gone = await register(await makeUser(`${t}e`, { name: `Gone ${t}` }), ev, false)
  expect((await boss.db.rpc('review_payment', { p_payment: paid.payment!.id, p_approve: true })).error).toBeNull()
  expect((await boss.db.rpc('admin_set_registration_status', { p_registration: gone.reg.id, p_cancel: true, p_reason: 'test' })).error).toBeNull()
  void unpaid; void review

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=overview`)
  const card = (label: string) => page.locator('p', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }).locator('xpath=..')
  // 3 live registrations (one cancelled is not counted), 1 confirmed, 1 unpaid, 1 under review
  await expect(card('Registrations')).toContainText('3')
  await expect(card('Registrations')).toContainText('1 unpaid · 1 being verified')
  await expect(card('Confirmed')).toContainText('1')
  await expect(card('Collected (verified)')).toContainText('1,000')
  await expect(card('Awaiting verification')).toContainText('1,000')
  await expect(card('Awaiting verification')).toContainText('1 payment')
  expect(sql(`select count(*) from event_registrations where event_id = '${ev.id}' and status <> 'cancelled'`)).toBe('3')
  expect(sql(`select coalesce(sum(p.amount_paise),0) from event_payments p join event_registrations r on r.id = p.registration_id where r.event_id = '${ev.id}' and p.status = 'verified'`)).toBe('100000')
  await noSideScroll(page)
  await ctx.close()
})

test('payments: upload a bank statement, only exact UTR + amount credits are verified together, the rest stay for a human', async ({ browser }) => {
  const t = tag('p1')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const ev = makeEvent(t)
  const users = [] as { reg: { id: string; code: string }; payment: { id: string } | null }[]
  for (const i of [1, 2, 3]) users.push(await register(await makeUser(`${t}u${i}`, { name: `Stmt${i} ${t}` }), ev, true))
  const utr = (i: number) => sql(`select utr from event_payments where id = '${users[i]!.payment!.id}'`)
  const csv = [
    'Account Statement,,,,',
    ',,,,',
    'Txn Date,Description,Ref No,Debit,Credit',
    `01 Oct 2026,"UPI/CR/${utr(0)}/ASHA/JEC",x,,"1,000.00"`, // exact -> matched
    `02 Oct 2026,"UPI/CR/${utr(1)}/BHARAT/JEC",x,,"999.50"`, // short -> needs a look
    // the third UTR is absent -> not in statement
  ].join('\n')
  const file = `/tmp/claude-0/x/stmt-${t}.csv`
  await fsp.writeFile(file, csv)

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=payments`)
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByText('1 of 3 payments matched the statement')).toBeVisible()
  await expect(page.getByText(/1 matched · 1 need a look · 1 not in statement/)).toBeVisible()
  // nothing changes until the admin presses the button
  expect(sql(`select count(*) from event_payments where id in ('${users.map((u) => u.payment!.id).join("','")}') and status = 'verified'`)).toBe('0')
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Verify 1 matched' }).click()
  await expect(page.getByText('1 payments verified')).toBeVisible()
  expect(sql(`select status from event_payments where id = '${users[0]!.payment!.id}'`)).toBe('verified')
  expect(sql(`select status from event_payments where id = '${users[1]!.payment!.id}'`)).toBe('submitted')
  expect(sql(`select status from event_payments where id = '${users[2]!.payment!.id}'`)).toBe('submitted')
  expect(sql(`select status from event_registrations where id = '${users[0]!.reg.id}'`)).toBe('confirmed')
  expect(auditCount(`action = 'verify_payment' and actor = '${boss.id}' and details->>'note' like 'Matched bank statement stmt-${t}.csv%'`)).toBe(1)
  await noSideScroll(page)
  await ctx.close()
})

test('people: search by name, code and phone; refund and cancel from the drawer frees the member to register again', async ({ browser }) => {
  const t = tag('pe')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const ev = makeEvent(t)
  const ph = `+91 9${String(Math.floor(Math.random() * 9e4) + 1e4)} 13579`
  const m = await makeUser(`${t}m`, { name: `Searchable ${t}`, phone: ph })
  const { reg, payment } = await register(m, ev, true)
  sql(`update event_registrations set phone = '${ph}', full_name = 'Searchable ${t}' where id = '${reg.id}'`)
  expect((await boss.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true })).error).toBeNull()
  const other = await register(await makeUser(`${t}n`, { name: `Other ${t}` }), ev, false)
  sql(`update event_registrations set full_name = 'Other ${t}' where id = '${other.reg.id}'`)

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=people`)
  const search = page.getByLabel('Search registrations')
  await expect(page.getByRole('button', { name: /Other /})).toBeVisible()
  for (const q of [`Searchable ${t}`, reg.code, '13579']) {
    await search.fill(q)
    await expect(page.getByRole('button', { name: new RegExp(reg.code) })).toBeVisible()
    await expect(page.getByRole('button', { name: /Other /})).toHaveCount(0)
  }
  await search.fill('zzzz-nobody')
  await expect(page.getByText('No registrations here')).toBeVisible()
  await search.fill(reg.code)
  await page.getByRole('button', { name: new RegExp(reg.code) }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Record a refund' }).click()
  await drawer.getByLabel('Amount (₹)').last().fill('1000')
  await drawer.getByLabel('Reason').last().fill('Cannot travel')
  const cancelBox = drawer.getByRole('checkbox', { name: /cancel/i })
  if (await cancelBox.count()) await cancelBox.first().check()
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: 'Record refund' }).click()
  await expect.poll(() => sql(`select count(*) from event_refunds where payment_id = '${payment!.id}'`)).toBe('1')
  expect(sql(`select amount_paise from event_refunds where payment_id = '${payment!.id}'`)).toBe('100000')
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('cancelled')
  expect(auditCount(`action = 'record_refund' and actor = '${boss.id}' and target_id = '${reg.id}' or (action = 'record_refund' and details->>'registration_id' = '${reg.id}')`)).toBeGreaterThan(0)
  // the member sees the cancelled ticket go and can register again (a fresh unpaid registration under the same code)
  const again = await m.db.rpc('upsert_registration', { p_event: ev.id, p_details: { full_name: 'Searchable', phone: ph, email: m.email, accept_terms: true, grad_year: 2005, food_pref: 'veg', tshirt_size: 'L' }, p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }] })
  expect(again.error).toBeNull()
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('pending_payment')
  await ctx.close()
})

test('settings: change event fields, ticket valid-on days, UPI and the publish switch; members see exactly that', async ({ browser }) => {
  const t = tag('se')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const mem = await makeUser(`${t}m`, { name: `Member ${t}` })
  const ev = makeEvent(t, false)
  sql(`update events set ends_at = starts_at + interval '1 day' where id = '${ev.id}'`)
  const visibleToMember = async () => (await mem.db.from('events').select('id').eq('id', ev.id)).data?.length === 1

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=settings`)
  expect(await visibleToMember()).toBe(false) // draft: hidden from members
  await page.getByLabel('Title').fill(`Renamed ${t}`)
  await page.getByLabel('Venue').fill('Hall Seven')
  await page.getByLabel('Max people').fill('321')
  await page.getByLabel('UPI ID').fill('newupi@okhdfc')
  await page.getByLabel('Payee name (as shown in UPI apps)').fill('JEC Fund')
  await page.getByLabel('Phone for questions').fill('+91 99999 11111')
  // the Spouse ticket is valid on the second day only
  const valid = page.getByLabel('Ticket name').nth(1).locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]').locator('fieldset').first()
  await expect(valid).toContainText('Valid on')
  await valid.getByRole('checkbox').nth(1).check()
  await page.getByRole('checkbox', { name: /Published/ }).check()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved')).toBeVisible()
  expect(sql(`select concat_ws('|', title, venue, capacity, upi_id, upi_payee_name, contact_phone, is_published) from events where id = '${ev.id}'`)).toBe(`Renamed ${t}|Hall Seven|321|newupi@okhdfc|JEC Fund|+919999911111|t`)
  expect(sql(`select coalesce(days::text, 'all') from event_ticket_types where id = '${ev.spouse}'`)).toBe('{2}')
  expect(sql(`select coalesce(days::text, 'all') from event_ticket_types where id = '${ev.alumnus}'`)).toBe('all')
  expect(auditCount(`target_id = '${ev.id}' and actor = '${boss.id}'`)).toBeGreaterThan(0)
  expect(await visibleToMember()).toBe(true)
  // unpublish again: hidden from members, still there for admins
  await page.getByRole('checkbox', { name: /Published/ }).uncheck()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved').last()).toBeVisible()
  expect(sql(`select is_published from events where id = '${ev.id}'`)).toBe('f')
  await expect.poll(visibleToMember).toBe(false)
  // validation: a paid event cannot be published without a UPI ID
  await page.getByLabel('UPI ID').fill('')
  await page.getByRole('checkbox', { name: /Published/ }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Add the UPI ID before publishing')).toBeVisible()
  expect(sql(`select is_published from events where id = '${ev.id}'`)).toBe('f')
  await noSideScroll(page)
  await ctx.close()
})
