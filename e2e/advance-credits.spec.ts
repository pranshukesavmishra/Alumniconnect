// Advance paid before the app: the admin imports a 2-row advance list (fake people), a member whose mobile number is on it
// registers and sees "Advance already paid −₹500" and "To pay", the UPI link asks for the amount due, the treasurer verifies
// that amount and the registration is confirmed. A member who is not on the list sees no advance.
import { expect, test } from '@playwright/test'
import { createMember, newUtr, signInContext, stamp, sql } from './verify/meet-lib'

const S = stamp()
const tag = S.slice(-6)
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`
// made-up Indian mobile numbers, unique per run (never a real person's)
const fakePhone = (n: number) => `+91 9${String(Date.now()).slice(-7)}${n}${n}`
const phoneMatch = fakePhone(1)
const note = `e2e-advance-${S}`

test.use({ viewport: { width: 390, height: 844 } })

const eventId = () => sql(`select id from events where slug = 'alumni-meet-2026'`)

test.afterAll(() => {
  const ev = eventId()
  sql(`delete from event_registrations where event_id = '${ev}' and email like 'adv-${S}%'`)
  sql(`delete from event_advance_credits where event_id = '${ev}' and note = '${note}'`)
})

async function fillUntilReview(page: import('@playwright/test').Page) {
  const cont = () => page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.goto('/meet/register')
  await expect(page.getByRole('heading', { name: 'Your details (from your profile)' })).toBeVisible()
  await cont()
  await page.getByText(/Both days/).first().click()
  await page.locator('label').filter({ hasText: /^Vegetarian$/ }).click()
  await page.getByLabel('Your T-shirt size').selectOption('L')
  for (const q of ['Do you need help with accommodation?', 'Do you need help with local travel or pickup?']) {
    await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
  }
  await cont()
  for (const q of ['Would you like to be part of the organising teams?', 'Would you like to perform at the reunion?', 'Would you like to contribute to the Reunion Fund?', 'Would you or your organisation like to sponsor the event?']) {
    await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
  }
  await cont()
  await cont()
  await expect(page.getByText(/Step 5 of 5/)).toBeVisible()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
}

test('advance list import -> matching member pays only the rest -> treasurer verifies -> confirmed; others see no advance', async ({ browser }) => {
  const ev = eventId()
  const price = Number(sql(`select price_paise from event_ticket_types where event_id = '${ev}' and is_primary and label like 'Both days%' order by sort limit 1`))
  const due = price - 50000
  expect(due).toBeGreaterThan(0)

  // ---- admin imports the advance list (CSV, the organisers' column names)
  const adminEmail = `adv-${S}-admin@example.com`
  const adminId = createMember({ email: adminEmail, name: `Adv Admin ${tag}`, admin: true, verified: true, phone: fakePhone(0) })
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await signInContext(actx, adminId, adminEmail)
  const admin = await actx.newPage()
  await admin.goto('/admin/events/alumni-meet-2026?tab=advances')
  await expect(admin.getByText('Import the advance list')).toBeVisible()
  const csv = [
    'Name,JEC Graduation Year,Branch,Contact Number,Email Id,Advance amount,Note',
    `Advance Match ${tag},2007,B.E. in Electronics & Telecommunications,${phoneMatch.replace('+91 ', '')},,Paid,${note}`,
    `Advance Other ${tag},2008,CSE,,adv-${S}-other@example.com,500,${note}`,
  ].join('\n')
  await admin.getByLabel('Advance list file').setInputFiles({ name: 'advance-list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(admin.getByTestId('advance-parsed')).toContainText('2 people ready to import')
  await admin.getByRole('button', { name: 'Import 2 advances' }).click()
  await expect(admin.getByText(/2 advances added/)).toBeVisible()
  expect(sql(`select count(*) || '/' || sum(amount_paise) from event_advance_credits where event_id = '${ev}' and note = '${note}' and status = 'open'`)).toBe('2/100000')

  // ---- a member on the list (same mobile number, written differently) registers
  const email = `adv-${S}-match@example.com`
  const uid = createMember({ email, name: `Advance Matching ${tag}`, year: 2007, verified: true, phone: phoneMatch })
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(mctx, uid, email)
  const page = await mctx.newPage()
  await fillUntilReview(page)
  await expect(page.getByTestId('reg-advance')).toHaveText(`−${rupees(50000)}`)
  await expect(page.getByTestId('reg-to-pay')).toHaveText(rupees(due))
  await expect(page.getByTestId('bar-advance')).toContainText('Advance already paid')
  await expect(page.getByTestId('bar-advance')).toContainText(`To pay ${rupees(due)}`)
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)

  const row = JSON.parse(sql(`select row_to_json(r) from event_registrations r where user_id = '${uid}'`)) as Record<string, number | string | boolean>
  expect(row.amount_paise).toBe(price) // the ticket total stays the full price
  expect(row.advance_paise).toBe(50000)
  expect(row.status).toBe('pending_payment')
  expect(sql(`select match_reason || '/' || claimed_by from event_advance_credits where claimed_registration_id = '${row.id}'`)).toBe('phone/auto')

  // the payment step asks for the amount due, and the UPI link carries it
  await expect(page.getByText('Step 1 · Pay by UPI')).toBeVisible()
  await expect(page.getByTestId('pay-advance')).toContainText(`Advance already paid −${rupees(50000)}`)
  const upi = await page.getByRole('link', { name: /with a UPI app/ }).getAttribute('href')
  expect(upi).toContain(`am=${due / 100}&`)
  const utr = newUtr()
  await page.getByLabel('UPI reference number (UTR)').fill(utr)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  expect(sql(`select amount_paise from event_payments where utr = '${utr}'`)).toBe(String(due))

  // ---- the treasurer verifies the due amount: confirmed
  await admin.goto('/admin/events/alumni-meet-2026?tab=payments')
  const card = admin.getByRole('listitem').filter({ hasText: utr })
  await expect(card.getByTestId('payment-advance')).toContainText(`Advance (offline) ${rupees(50000)} already paid`)
  await expect(card.getByText(/Partial payment/)).toHaveCount(0)
  await card.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(admin.getByText(utr)).toHaveCount(0)
  await expect.poll(() => sql(`select status from event_registrations where id = '${row.id}'`)).toBe('confirmed')

  // the Advances tab shows the credit as applied, linked to the registration
  await admin.goto('/admin/events/alumni-meet-2026?tab=advances')
  const applied = admin.getByTestId('advance-list').locator('[data-status="claimed"]').filter({ hasText: `Advance Match ${tag}` })
  await expect(applied).toContainText(String(row.code))
  await expect(applied).toContainText('Matched by mobile number')

  // ---- a member who is not on the list sees no advance
  const email2 = `adv-${S}-nomatch@example.com`
  const uid2 = createMember({ email: email2, name: `Advance Nobody ${tag}`, year: 2007, verified: true, phone: fakePhone(2) })
  const nctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(nctx, uid2, email2)
  const p2 = await nctx.newPage()
  await fillUntilReview(p2)
  await expect(p2.getByText(/Step 5 of 5/)).toBeVisible()
  await expect(p2.getByTestId('reg-advance')).toHaveCount(0)
  await expect(p2.getByTestId('bar-advance')).toHaveCount(0)
  await p2.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(p2).toHaveURL(/\/meet\/my/)
  const upi2 = await p2.getByRole('link', { name: /with a UPI app/ }).getAttribute('href')
  expect(upi2).toContain(`am=${price / 100}&`)
  expect(sql(`select advance_paise from event_registrations where user_id = '${uid2}'`)).toBe('0')
  expect(sql(`select status from event_advance_credits where event_id = '${ev}' and note = '${note}' and full_name = 'Advance Other ${tag}'`)).toBe('open')

  await actx.close()
  await mctx.close()
  await nctx.close()
})
