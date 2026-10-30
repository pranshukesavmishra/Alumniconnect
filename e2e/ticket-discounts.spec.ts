// Ticket discounts: the admin sets an original price + percent off; the Meet page shows it crossed out with "Save X%".
import { expect, test } from '@playwright/test'
import { loginPage, makeEvent, makeUser } from './verify/admin-lib'
import { sql } from './verify/meet-lib'

test.use({ viewport: { width: 390, height: 844 } })

test('admin adds a discount to a ticket: percent drives the price, preview shows the saving, DB keeps the real price', async ({ page }) => {
  const admin = await makeUser('disc-admin', { admin: true })
  const ev = makeEvent('disc')
  await loginPage(page, admin, `/admin/events/${ev.slug}?tab=settings`)
  await page.getByRole('button', { name: '+ Add a discount' }).first().click()
  await page.getByLabel('Original price (₹)').first().fill('2000')
  await page.getByLabel('Percent off').first().fill('25')
  await expect(page.getByLabel('Price (₹)').first()).toHaveValue('1500')
  await page.getByLabel('Offer name').first().fill('Early bird')
  await expect(page.getByTestId('discount-preview').first()).toContainText('Save 25%')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved')).toBeVisible()
  expect(sql(`select price_paise || '/' || list_price_paise || '/' || discount_label from event_ticket_types where id = '${ev.alumnus}'`)).toBe('150000/200000/Early bird')

  // an original price at or below the price now is refused with a clear message, nothing saved
  await page.getByLabel('Original price (₹)').first().fill('1000')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/original price must be higher/i)).toBeVisible()
  expect(sql(`select list_price_paise from event_ticket_types where id = '${ev.alumnus}'`)).toBe('200000')

  // removing the discount clears it
  await page.getByRole('button', { name: 'Remove discount' }).first().click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Event saved').first()).toBeVisible()
  expect(sql(`select coalesce(list_price_paise::text, 'none') || '/' || price_paise from event_ticket_types where id = '${ev.alumnus}'`)).toBe('none/150000')
})

test('Meet page: original crossed out, price now, Save X% and the offer name; undiscounted tickets stay plain', async ({ page }) => {
  const evId = sql(`select id from events where slug = 'alumni-meet-2026'`)
  const t = sql(`select id || '|' || price_paise from event_ticket_types where event_id = '${evId}' and is_primary order by sort limit 1`).split('|')
  const id = t[0]!
  const price = Number(t[1])
  sql(`update event_ticket_types set list_price_paise = ${price + 50000}, discount_label = 'Early bird' where id = '${id}'`)
  try {
    await page.goto('/meet')
    const tag = page.getByTestId('price-tag').first()
    await expect(tag).toBeVisible()
    await expect(tag.getByTestId('price-was')).toBeVisible()
    await expect(tag.getByTestId('price-percent')).toContainText(/Save \d+%/)
    await expect(tag).toContainText('Early bird')
    // screen readers get the full sentence
    await expect(tag.locator('.sr-only')).toContainText(/was .*% off/)
    expect(await page.getByTestId('price-tag').count()).toBe(1)
  } finally {
    sql(`update event_ticket_types set list_price_paise = null, discount_label = null where id = '${id}'`)
  }
})
