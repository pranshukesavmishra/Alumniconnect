// Optional extras priced per person type: the admin ticks 27 Dec as an optional extra day in the alumnus card (650) and the
// child card (350) and leaves it unticked on the spouse card; a member registers alumnus + spouse + child, ticks the tour for the alumnus and the
// child, sees each person's own price, and the server charges exactly what the screen showed.
import { expect, test } from '@playwright/test'
import { createMember, newUtr, signInContext, stamp, sql } from './verify/meet-lib'

const S = stamp()
const tag = S.slice(-4)
const tour = '27 Dec (optional)' // named from the day by the admin screen
const spouse = `Spouse price ${tag}`
const child = `Child price ${tag}`
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`

test.use({ viewport: { width: 390, height: 844 } })

const eventId = () => sql(`select id from events where slug = 'alumni-meet-2026'`)

test.afterAll(() => {
  const ev = eventId()
  sql(`delete from event_registrations where event_id = '${ev}' and email like 'addonp-${S}%'`)
  sql(`delete from event_ticket_types where event_id = '${ev}' and (label in ('${spouse}', '${child}') or (is_addon and label = '${tour}'))`)
})

test('extras by person type: admin sets the child price in the child card, member pays each person their own price', async ({ browser }) => {
  const ev = eventId()
  const mainRow = sql(`select id || '|' || price_paise from event_ticket_types where event_id = '${ev}' and is_primary and days = '{1}' limit 1`).split('|')
  const main = Number(mainRow[1])
  sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days) values
         ('${ev}', '${spouse}', 50000, false, 1, 90, '{1}'), ('${ev}', '${child}', 30000, false, 4, 91, '{1}')`)

  // ---- admin: 27 Dec is an optional extra day: 650 on the alumnus card, 350 on the child card, not offered to the spouse
  const adminEmail = `addonp-admin-${S}@test.local`
  const adminId = createMember({ email: adminEmail, name: `Addonp Admin ${tag}`, admin: true, verified: true })
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await signInContext(actx, adminId, adminEmail)
  const admin = await actx.newPage()
  await admin.goto('/admin/events/alumni-meet-2026?tab=settings')
  const cardOf = (label: string) => admin.getByTestId('ticket-card').filter({ has: admin.locator(`input[value="${label}"]`) })
  const priceField = (c: ReturnType<typeof cardOf>) => c.getByLabel('Extra price for 27 Dec (₹)')
  const optBox = (c: ReturnType<typeof cardOf>) => c.getByRole('checkbox', { name: 'Optional extra day: 27 Dec' })
  const main2 = mainLabel(ev)
  await optBox(cardOf(main2)).check()
  await priceField(cardOf(main2)).fill('650')
  await optBox(cardOf(child)).check()
  await priceField(cardOf(child)).fill('350')
  await expect(optBox(cardOf(spouse))).not.toBeChecked() // unticked = this person type cannot take it
  await admin.getByRole('button', { name: 'Save changes' }).click()
  await expect(admin.getByText('Event saved')).toBeVisible()
  expect(
    sql(`select string_agg(t.label || '=' || coalesce(p.price_paise::text, 'default') || '/' || p.available, ',' order by t.label) from event_addon_prices p join event_ticket_types t on t.id = p.ticket_type_id where p.event_id = '${ev}' and t.label in ('${main2}', '${spouse}', '${child}') and p.addon_id = (select id from event_ticket_types where label = '${tour}' and is_addon and event_id = '${ev}')`),
  ).toBe([`${main2}=65000/true`, `${child}=35000/true`, `${spouse}=default/false`].sort().join(','))
  expect(sql(`select price_paise from event_ticket_types where label = '${tour}' and is_addon and event_id = '${ev}'`)).toBe('65000') // default = the first entered price

  // the saved values come back after a reload
  await admin.reload()
  await expect(priceField(cardOf(child))).toHaveValue('350')
  await expect(priceField(cardOf(main2))).toHaveValue('650')
  await expect(optBox(cardOf(spouse))).not.toBeChecked()

  // the Meet page tells people the different prices
  const pubCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pub = await pubCtx.newPage()
  await pub.goto('/meet')
  await expect(pub.getByTestId('addon-type-prices').filter({ hasText: child })).toContainText(`${child} ₹350`)
  await expect(pub.getByTestId('addon-type-prices').filter({ hasText: spouse })).toContainText(`${spouse} not available`)
  await pubCtx.close()

  // ---- member: alumnus (day 1) + spouse + child; tour for the alumnus and the child
  const email = `addonp-${S}@test.local`
  const uid = createMember({ email, name: `Addonp Alum ${tag}`, year: 2007, verified: true })
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(mctx, uid, email)
  const page = await mctx.newPage()
  await page.goto('/meet/register')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByText('26 Dec only', { exact: false }).first().click()
  await page.getByRole('button', { name: `More: ${spouse}` }).click()
  await page.getByLabel(`${spouse} 1 name`).fill('Meera')
  await page.getByRole('button', { name: `More: ${child}` }).click()
  await page.getByLabel(`${child} 1 name`).fill('Kiran')
  await page.getByRole('radio', { name: 'No meal / fasting' }).check({ force: true })
  await page.getByLabel('Your T-shirt size').selectOption('L')
  await page.getByRole('group', { name: 'Do you need help with accommodation?' }).getByText('No', { exact: true }).click()
  await page.getByRole('group', { name: 'Do you need help with local travel or pickup?' }).getByText('No', { exact: true }).click()

  const extras = page.getByTestId('optional-extras')
  const me = extras.getByRole('checkbox', { name: new RegExp(`Me: also join ${tour.replace(/[()]/g, "\\$&")}`) })
  const childGroup = extras.getByTestId('addon-group').filter({ hasText: child })
  const more = childGroup.getByRole('button', { name: `More: ${tour}: ${child}` })
  await expect(me).toHaveAccessibleName(/\+₹650/)
  await expect(childGroup).toContainText('₹350 each')
  await expect(extras.getByTestId('addon-unavailable')).toContainText(spouse)
  await me.check()
  await more.click()
  await more.click()
  await expect(childGroup).toContainText('2') // 2 children on the 27th, only 1 on the 26th ticket
  const expected = main + 50000 + 30000 + 65000 + 2 * 35000
  await expect(page.getByText(rupees(expected)).first()).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByText('Step 3 of 5 · Get involved')).toBeVisible()
  for (const q of [
    'Would you like to be part of the organising teams?',
    'Would you like to perform at the reunion?',
    'Would you like to contribute to the Reunion Fund?',
    'Would you or your organisation like to sponsor the event?',
  ]) await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Contact name').fill('Ravi')
  await page.getByLabel('Contact number').fill('+91 90000 22222')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByText('Step 5 of 5 · Review & pay')).toBeVisible()
  await expect(page.getByText(`${tour} (${child}) × 2`)).toBeVisible()
  await expect(page.getByText(`${tour} (`, { exact: false }).first()).toBeVisible()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)
  await expect(page.getByText('Fees updated')).toHaveCount(0) // the screen total was already the server total

  const row = JSON.parse(sql(`select row_to_json(r) from event_registrations r where user_id = '${uid}'`)) as Record<string, any>
  expect(row.amount_paise).toBe(expected)
  expect(row.headcount).toBe(3)
  expect(row.day_heads).toEqual({ '1': 3, '2': 3 })
  const lines = sql(`select i.label || ':' || i.unit_price_paise || 'x' || i.quantity from event_registration_items i join event_ticket_types t on t.id = i.ticket_type_id where i.registration_id = '${row.id}' and t.is_addon`).split('\n').sort()
  expect(lines).toEqual([`${tour} (${child}):35000x2`, `${tour} (${mainLabel(ev)}):65000x1`].sort())

  // My registration lists both lines with their own amounts
  await expect(page.getByText(`${tour} (${child}) × 2`)).toBeVisible()

  // re-open the form before paying: the ticks are restored per person
  await page.goto('/meet/register')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByTestId('optional-extras').getByRole('checkbox', { name: new RegExp(`Me: also join ${tour.replace(/[()]/g, "\\$&")}`) })).toBeChecked()
  await expect(page.getByTestId('optional-extras').getByTestId('addon-group').filter({ hasText: child })).toContainText('2')

  // admin People shows the lines
  await admin.goto(`/admin/events/alumni-meet-2026?tab=people&q=${encodeURIComponent(`Addonp Alum ${tag}`)}`)
  await admin.getByText(`Addonp Alum ${tag}`).first().click()
  await expect(admin.getByText(`${tour} (${child}) × 2`)).toBeVisible()

  // pay: locked afterwards and the same ticks are accepted
  await page.goto('/meet/my')
  await page.getByLabel('UPI reference number (UTR)').fill(newUtr())
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  await page.goto('/meet/register')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  // locked after payment: the count is shown, with no + / - buttons
  const lockedRow = page.getByTestId('optional-extras').getByTestId('addon-group').filter({ hasText: child })
  await expect(lockedRow).toContainText('2')
  await expect(lockedRow.getByRole('button')).toHaveCount(0)

  await actx.close()
  await mctx.close()
})

function mainLabel(ev: string): string {
  return sql(`select label from event_ticket_types where event_id = '${ev}' and is_primary and days = '{1}' limit 1`)
}
