// Optional extras (add-on tickets): the admin ticks 27 Dec as an optional extra day in the ticket cards, a member with a day-1 main ticket ticks it for
// themselves and their spouse, pays, and the day counts show 2 people on day 2 and 2 (not 4) on day 1.
import { expect, test } from '@playwright/test'
import { createMember, newUtr, signInContext, stamp, sql } from './verify/meet-lib'

const S = stamp()
const extraName = '27 Dec (optional)' // named from the day by the admin screen
const spouseLabel = `Spouse test ${S.slice(-4)}`
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`

test.use({ viewport: { width: 390, height: 844 } })

const eventId = () => sql(`select id from events where slug = 'alumni-meet-2026'`)

test.afterAll(() => {
  const ev = eventId()
  sql(`delete from event_registrations where event_id = '${ev}' and email like 'addon-${S}%'`)
  sql(`delete from event_ticket_types where event_id = '${ev}' and (label = '${spouseLabel}' or (is_addon and label = '${extraName}'))`)
})

test('optional extras: admin adds the 27 Dec tour, a day-1 member ticks it for self and spouse, totals and day counts are right', async ({ browser }) => {
  const ev = eventId()
  const mainRow = sql(`select id || '|' || price_paise from event_ticket_types where event_id = '${ev}' and is_primary and days = '{1}' limit 1`).split('|')
  const main = Number(mainRow[1])
  sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days) values ('${ev}', '${spouseLabel}', 50000, false, 1, 90, '{1}')`)

  // ---- admin: Settings → Fees, on the 26 Dec alumnus card and the spouse card, 27 Dec is an optional extra day at 650
  const adminEmail = `addon-admin-${S}@test.local`
  const adminId = createMember({ email: adminEmail, name: `Addon Admin ${S.slice(-4)}`, admin: true, verified: true })
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await signInContext(actx, adminId, adminEmail)
  const admin = await actx.newPage()
  await admin.goto('/admin/events/alumni-meet-2026?tab=settings')
  const mainLabel = sql(`select label from event_ticket_types where id = '${mainRow[0]}'`)
  const cardOf = (label: string) => admin.getByTestId('ticket-card').filter({ has: admin.locator(`input[value="${label}"]`) })
  for (const label of [mainLabel, spouseLabel]) {
    const c = cardOf(label)
    await expect(c.getByRole('checkbox', { name: 'Included: 26 Dec' })).toBeChecked()
    await c.getByRole('checkbox', { name: 'Optional extra day: 27 Dec' }).check()
    await c.getByLabel('Extra price for 27 Dec (₹)').fill('650')
  }
  // included wins: the included day offers no optional box
  await expect(cardOf(mainLabel).getByRole('checkbox', { name: 'Optional extra day: 26 Dec' })).toHaveCount(0)
  await admin.getByRole('button', { name: 'Save changes' }).click()
  await expect(admin.getByText('Event saved')).toBeVisible()
  expect(sql(`select is_addon || '|' || is_primary || '|' || price_paise || '|' || max_per_registration || '|' || days::text from event_ticket_types where event_id = '${ev}' and is_addon and label = '${extraName}'`)).toBe('true|false|65000|10|{2}')
  expect(sql(`select days::text from event_ticket_types where id = '${mainRow[0]}'`)).toBe('{1}') // the main ticket stays a normal 26 Dec ticket
  // the same values come back after a reload; the extra shows in the advanced section
  await admin.reload()
  await expect(cardOf(mainLabel).getByLabel('Extra price for 27 Dec (₹)')).toHaveValue('650')
  await expect(cardOf(spouseLabel).getByLabel('Extra price for 27 Dec (₹)')).toHaveValue('650')
  await expect(admin.getByTestId('addon-card').locator(`input[value="${extraName}"]`)).toBeVisible()

  // it is not a normal ticket card and the Meet page shows it under its own heading
  const mctxPublic = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pub = await mctxPublic.newPage()
  await pub.goto('/meet')
  await expect(pub.getByTestId('addon-tiers')).toContainText(extraName)
  await expect(pub.getByTestId('addon-tiers')).toContainText('Optional')
  await mctxPublic.close()

  // ---- member with a day-1 main ticket
  const email = `addon-${S}@test.local`
  const uid = createMember({ email, name: `Addon Alum ${S.slice(-4)}`, year: 2007, verified: true })
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(mctx, uid, email)
  const page = await mctx.newPage()
  await page.goto('/meet/register')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Step 2 of 5 · Days & family')).toBeVisible()
  await expect(page.getByTestId('optional-extras')).toHaveCount(0) // nothing before a main ticket is chosen
  await page.getByText('26 Dec only', { exact: false }).first().click()
  await expect(page.getByTestId('optional-extras')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Optional extras' })).toBeVisible()
  await page.getByRole('button', { name: `More: ${spouseLabel}` }).click()
  await page.getByLabel(`${spouseLabel} 1 name`).fill('Meera')
  await page.getByRole('radio', { name: 'No meal / fasting' }).check({ force: true })
  await page.getByLabel('Your T-shirt size').selectOption('L')
  await page.getByRole('group', { name: 'Do you need help with accommodation?' }).getByText('No', { exact: true }).click()
  await page.getByRole('group', { name: 'Do you need help with local travel or pickup?' }).getByText('No', { exact: true }).click()

  // the extra has its own counts: it starts at zero and is NOT limited by the one spouse on the 26 Dec ticket
  const extras = page.getByTestId('optional-extras')
  const me = extras.getByRole('checkbox', { name: new RegExp(`Me: also join ${extraName.replace(/[()]/g, "\\$&")}`) })
  const spouseGroup = extras.getByTestId('addon-group').filter({ hasText: spouseLabel })
  const more = spouseGroup.getByRole('button', { name: `More: ${extraName}: ${spouseLabel}` })
  await expect(extras).toContainText("they don't need to be on a 26 Dec ticket")
  await expect(me).not.toBeChecked()
  await expect(extras.getByRole('button', { name: /for all/ })).toHaveCount(0)
  await expect(spouseGroup.getByTestId('addon-names')).toHaveCount(0)
  await me.check()
  await more.click()
  await more.click()
  await expect(spouseGroup).toContainText('2') // 2 on the 27th with 1 spouse on the 26th
  await expect(spouseGroup.getByTestId('addon-names').getByRole('textbox')).toHaveCount(2) // optional names, one per counted person
  await spouseGroup.getByTestId('addon-names').getByRole('textbox').first().fill('Day Two Guest')

  // a ticket that already includes 27 Dec offers no extra for it
  await page.getByText('Both days', { exact: false }).first().click()
  await expect(page.getByTestId('optional-extras').getByRole('checkbox', { name: new RegExp(`Me: also join`) })).toHaveCount(0)
  await page.getByText('26 Dec only', { exact: false }).first().click()
  await me.check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // involved: all "No"
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

  const expected = main + 50000 + 3 * 65000
  await expect(page.getByText('Step 5 of 5 · Review & pay')).toBeVisible()
  await expect(page.getByText(`${extraName} (`, { exact: false })).toHaveCount(2) // one line per person type
  await expect(page.getByText(rupees(expected)).first()).toBeVisible()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)

  const row = JSON.parse(sql(`select row_to_json(r) from event_registrations r where user_id = '${uid}'`)) as Record<string, any>
  expect(row.amount_paise).toBe(expected)
  expect(row.headcount).toBe(3) // 2 on the tickets + 1 who joins only the extra
  expect(row.day_heads).toEqual({ '1': 2, '2': 3 })
  expect(row.days).toEqual([1])
  expect(sql(`select sum(quantity) from event_registration_items i join event_ticket_types t on t.id = i.ticket_type_id where i.registration_id = '${row.id}' and t.label = '${extraName}'`)).toBe('3')
  expect(sql(`select names::text from event_registration_items i join event_ticket_types t on t.id = i.ticket_type_id where i.registration_id = '${row.id}' and t.label = '${extraName}' and i.names <> '[]'::jsonb`)).toContain('Day Two Guest')

  // reload the form: the extras stay ticked, and after payment they are locked
  const utr = newUtr()
  await page.getByLabel('UPI reference number (UTR)').fill(utr)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  await page.goto('/meet/register')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByTestId('optional-extras').getByRole('checkbox', { name: new RegExp(`Me: also join`) })).toBeChecked()
  await expect(page.getByTestId('optional-extras').getByRole('checkbox', { name: new RegExp(`Me: also join`) })).toBeDisabled()

  // ---- admin People: 2 on day 1, 3 on day 2
  await admin.goto('/admin/events/alumni-meet-2026?tab=responses')
  await expect(admin.getByText(/27 Dec/).first()).toBeVisible()
  const perDay = sql(`select (day_heads ->> '1') || '/' || (day_heads ->> '2') from event_registrations where user_id = '${uid}'`)
  expect(perDay).toBe('2/3')
  await actx.close()
  await mctx.close()
})
