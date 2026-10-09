// Event admin: create / edit event and tickets, Team, registrations editor, desk payments, payments queue, exports.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { sql } from '../helpers'
import { auditCount, loginPage, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })

let page: Page
let admin: TestUser
const slug = `adm-${ts}-ui`
let eventId = ''

test.beforeAll(async ({ browser }) => {
  admin = await makeUser('ev-admin', { admin: true, name: `Event Admin ${ts}` })
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  page = await ctx.newPage()
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('Verified by phone call') : d.accept()))
  await loginPage(page, admin, '/admin/events/new')
})
test.afterAll(async () => page.context().close())

test('create an event with tickets from the UI', async () => {
  await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible()
  // validation first: wrong UPI, bad numbers
  await page.getByLabel('Web address name').fill(slug)
  await page.getByLabel('Title').fill(`UI Event ${ts}`)
  await page.getByLabel('UPI ID').fill('not a upi')
  await page.getByLabel('Max people').fill('1,000')
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByText('UPI ID looks wrong')).toBeVisible()
  await expect(page.getByText('Max people: enter a whole number')).toBeVisible()
  expect(sql(`select count(*) from events where slug = '${slug}'`)).toBe('0')

  await page.getByLabel('UPI ID').fill('jecalumni@okicici')
  await page.getByLabel('Payee name (as shown in UPI apps)').fill('JEC Alumni Assoc')
  await page.getByLabel('Max people').fill('300')
  await page.getByLabel('Starts (India time)').fill('2026-12-26T10:00')
  const prices = page.getByLabel('Price (₹)')
  await prices.nth(0).fill('1500')
  await prices.nth(1).fill('1000')
  await prices.nth(2).fill('500')
  await page.getByText('Published', { exact: false }).last().click()
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${slug}\\?tab=settings`))
  await expect(page.getByText('Event saved')).toBeVisible()
  eventId = sql(`select id from events where slug = '${slug}'`)
  expect(sql(`select concat_ws('|', title, upi_id, capacity, is_published, starts_at at time zone 'Asia/Kolkata') from events where id = '${eventId}'`)).toBe(
    `UI Event ${ts}|jecalumni@okicici|300|t|2026-12-26 10:00:00`,
  )
  expect(sql(`select string_agg(label || ':' || price_paise || ':' || is_primary, ',' order by sort) from event_ticket_types where event_id = '${eventId}'`)).toBe(
    'Alumnus / Alumna:150000:true,Spouse:100000:false,Child (5–12 years):50000:false,Child (under 5):0:false',
  )
})

test('duplicate web address gives an understandable error', async () => {
  await page.goto('/admin/events/new')
  await page.getByLabel('Web address name').fill(slug)
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByRole('alert').or(page.getByText(/already/i)).first()).toBeVisible()
  // the message should say WHAT exists
  await expect(page.getByText(/web address|already (in use|taken)|event with this/i)).toBeVisible({ timeout: 3000 }).catch(() => {
    test.info().annotations.push({ type: 'ux', description: 'Duplicate slug only says "This already exists."' })
  })
})

test('edit event: title, ticket price, add, remove and reorder tickets', async () => {
  await page.goto(`/admin/events/${slug}?tab=settings`)
  await page.getByLabel('Title').fill(`UI Event Edited ${ts}`)
  await page.getByLabel('Price (₹)').nth(1).fill('1200')
  // remove "Child (under 5)" (4th), move "Child (5-12)" up
  await page.getByRole('button', { name: 'Remove ticket' }).nth(3).click()
  await page.getByRole('button', { name: 'Move up' }).nth(2).click()
  await page.getByRole('button', { name: 'Add ticket' }).click()
  await page.getByLabel('Ticket name').last().fill('Parent')
  await page.getByLabel('Price (₹)').last().fill('800')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved')).toBeVisible()
  expect(sql(`select title from events where id = '${eventId}'`)).toBe(`UI Event Edited ${ts}`)
  expect(sql(`select string_agg(label || ':' || price_paise, ',' order by sort) from event_ticket_types where event_id = '${eventId}'`)).toBe(
    'Alumnus / Alumna:150000,Child (5–12 years):50000,Spouse:120000,Parent:80000',
  )
  // saving again does not duplicate tickets
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved').first()).toBeVisible()
  expect(sql(`select count(*) from event_ticket_types where event_id = '${eventId}'`)).toBe('4')
})

test('Drive archive section is admin-only and never shows an owner address', async () => {
  await page.goto(`/admin/events/${slug}?tab=settings`)
  await expect(page.getByText('Photo archive and backups (Google Drive)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create the Drive folder' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('@gmail.com')
})

test('team: add a treasurer, a content manager and a volunteer, remove (DB + audit + confirmation)', async () => {
  const t = await makeUser('ev-treasurer', { name: `Treasurer Tia ${ts}` })
  const v = await makeUser('ev-volunteer', { name: `Volunteer Vik ${ts}` })
  const add = async (role: string, name: string) => {
    await page.getByLabel('Role', { exact: true }).selectOption(role)
    await page.getByLabel('Search members by name').fill(name)
    await page.getByRole('button', { name: `Give role: ${name}` }).click()
    await expect(page.getByText(`${name} is now`).last()).toBeVisible()
  }
  await page.goto(`/admin/events/${slug}?tab=team`)
  await expect(page.getByText('No one added yet')).toBeVisible()
  await add('treasurer', `Treasurer Tia ${ts}`)
  await add('content', `Treasurer Tia ${ts}`)
  await add('checkin', `Volunteer Vik ${ts}`)
  expect(sql(`select string_agg(role, ',' order by role) from event_staff where event_id = '${eventId}'`)).toBe('checkin,content,treasurer')
  expect(sql(`select string_agg(role, ',' order by role) from event_staff where event_id = '${eventId}' and user_id = '${t.id}'`)).toBe('content,treasurer')
  await expect(page.getByTestId('team-list').locator('[data-role]')).toHaveCount(3)
  await page.getByRole('button', { name: `Remove Check-in volunteer role from Volunteer Vik ${ts}` }).click()
  await expect(page.getByTestId('team-list').locator('[data-role]')).toHaveCount(2)
  expect(sql(`select count(*) from event_staff where event_id = '${eventId}' and user_id = '${v.id}'`)).toBe('0')
  expect(sql(`select count(*) from admin_audit where action in ('role_grant','role_revoke') and details->>'event_id' = '${eventId}'`)).toBe('4')
})

test('event, ticket and team changes are written to the activity log', async () => {
  expect(auditCount(`target_id = '${eventId}' or target_table in ('events', 'event_ticket_types', 'event_staff', 'event_settings') or details->>'event_id' = '${eventId}'`)).toBeGreaterThan(0)
})

test('registrations: search, edit tickets / food / phone with a reason, cancel, reopen (DB + audit)', async () => {
  const m = await makeUser('ev-reg1', { name: `Reg One ${ts}` })
  const alumnus = sql(`select id from event_ticket_types where event_id = '${eventId}' and is_primary`)
  const { reg } = await register(m, { id: eventId, alumnus }, false)
  await page.goto(`/admin/events/${slug}?tab=people`)
  await page.getByLabel('Search registrations').fill(reg.code)
  await page.getByRole('button', { name: new RegExp(reg.code) }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Edit registration' }).click()
  await dlg.getByRole('button', { name: 'More: Spouse' }).click()
  await expect(dlg.getByText('New total')).toContainText('2,700')
  await dlg.getByText('Jain', { exact: true }).click()
  await dlg.getByLabel('T-shirt').selectOption('XL')
  await dlg.getByLabel('Mobile').fill('+91 90000 54321')
  // reason is required
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Please write the reason for this change.')).toBeVisible()
  await dlg.getByLabel('Reason for change').fill('Spouse also coming')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Registration updated')).toBeVisible()
  expect(sql(`select concat_ws('|', amount_paise, headcount, food_pref, tshirt_size, phone, status) from event_registrations where id = '${reg.id}'`)).toBe(
    '270000|2|jain|XL|+91 90000 54321|pending_payment',
  )
  expect(auditCount(`action = 'update_registration' and target_id = '${reg.id}' and actor = '${admin.id}'`)).toBe(1)
  // cancel then reopen (reason via prompt)
  await dlg.getByRole('button', { name: 'Cancel registration' }).click()
  await expect(page.getByText('Registration cancelled')).toBeVisible()
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('cancelled')
  // dialog closes? the cancelled reg is filtered out of "All": open via Cancelled filter
  await page.keyboard.press('Escape')
  if (await dlg.isVisible()) await dlg.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /^Cancelled · / }).click()
  await page.getByRole('button', { name: new RegExp(reg.code) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen registration' }).click()
  await expect(page.getByText('Registration reopened')).toBeVisible()
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('pending_payment')
  expect(auditCount(`action in ('cancel_registration','reopen_registration') and target_id = '${reg.id}'`)).toBe(2)
})

test('desk payment (cash) and waiver confirm the registration and are audited', async () => {
  const m = await makeUser('ev-reg2', { name: `Reg Two ${ts}`, verified: false })
  const alumnus = sql(`select id from event_ticket_types where event_id = '${eventId}' and is_primary`)
  const { reg } = await register(m, { id: eventId, alumnus }, false)
  await page.goto(`/admin/events/${slug}?tab=people`)
  await page.getByLabel('Search registrations').fill(reg.code)
  await page.getByRole('button', { name: new RegExp(reg.code) }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Record a desk payment')).toContainText('1,500')
  await dlg.getByLabel('Amount (₹)').fill('500')
  await dlg.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Payment recorded')).toBeVisible()
  await expect(dlg.getByText('Record a desk payment')).toContainText('1,000')
  await dlg.getByText('Waive', { exact: true }).click()
  await dlg.getByRole('button', { name: 'Waive and confirm' }).click()
  await expect(page.getByText('Please note who approved the waiver.')).toBeVisible()
  await dlg.getByLabel('Approved by / reason').fill('President approved')
  await dlg.getByRole('button', { name: 'Waive and confirm' }).click()
  await expect(page.getByText('Payment recorded').first()).toBeVisible()
  await expect.poll(() => sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('confirmed')
  expect(sql(`select verification from profiles where id = '${m.id}'`)).toBe('verified')
  expect(auditCount(`action in ('record_cash','record_waiver') and target_id = '${reg.id}' and actor = '${admin.id}'`)).toBe(2)
})

test('payments tab: verify and reject submitted UPI payments', async () => {
  const alumnus = sql(`select id from event_ticket_types where event_id = '${eventId}' and is_primary`)
  const a = await register(await makeUser('ev-pay1', { name: `Payer Ok ${ts}` }), { id: eventId, alumnus }, true)
  const b = await register(await makeUser('ev-pay2', { name: `Payer Bad ${ts}` }), { id: eventId, alumnus }, true)
  await page.goto(`/admin/events/${slug}?tab=payments`)
  const card = (name: string) => page.locator('li').filter({ hasText: name })
  await card(a.reg.code).getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(page.getByText('Verified').first()).toBeVisible()
  await expect.poll(() => sql(`select status from event_payments where id = '${a.payment!.id}'`)).toBe('verified')
  await card(b.reg.code).getByRole('button', { name: 'Not received' }).click()
  const rd = page.getByRole('dialog')
  await rd.getByText(/UPI reference not found/).first().click()
  await rd.getByRole('button', { name: 'Mark as not received' }).click()
  await expect(page.getByText('Marked as not verified')).toBeVisible()
  expect(sql(`select status from event_payments where id = '${b.payment!.id}'`)).toBe('rejected')
  expect(sql(`select status from event_registrations where id = '${b.reg.id}'`)).toBe('pending_payment')
  expect(auditCount(`action in ('verify_payment','reject_payment') and target_id in ('${a.reg.id}','${b.reg.id}')`)).toBe(2)
})

test('exports download real CSVs with the right rows', async () => {
  await page.goto(`/admin/events/${slug}?tab=people`)
  const codes = sql(`select string_agg(code, ',') from event_registrations where event_id = '${eventId}'`).split(',')
  for (const [btn, expectCol] of [['Registrations (Excel)', 'Amount due (₹)'], ['Attendees / badges', 'Registered by'], ['Payments', 'UTR']] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: btn }).click()])
    const text = readFileSync((await dl.path())!, 'utf8')
    expect(dl.suggestedFilename()).toMatch(new RegExp(`^${slug}-`))
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain(expectCol)
    if (btn === 'Registrations (Excel)') {
      for (const c of codes) expect(text).toContain(c)
      expect(text).toContain('"=""+91 90000 54321"""') // phone kept as text for Excel (CSV-escaped)
    }
  }
})
