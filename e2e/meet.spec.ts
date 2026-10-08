import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36)
const member = `asha.${run}@example.com`
const admin = `treasurer.${run}@example.com`
const shots = 'test-results/screens'
const name = `Asha Rao ${run.slice(-4).toUpperCase()}`

test('alumnus registers, pays by UPI, treasurer verifies, ticket is scanned at the gate', async ({ page, browser }) => {
  // 1. Public event page (no sign-in needed, shareable on WhatsApp)
  await page.goto('/meet')
  await expect(page.getByRole('heading', { name: 'JEC Alumni Meet 2026' })).toBeVisible()
  await expect(page.getByText('Alumnus / Alumna').first()).toBeVisible()
  await page.screenshot({ path: `${shots}/01-meet.png`, fullPage: true })
  await page.getByRole('link', { name: 'Register now' }).filter({ visible: true }).first().click()

  // 2. Sign in with an email code, then the one-time quick profile
  await expect(page).toHaveURL(/\/signin/)
  await page.screenshot({ path: `${shots}/02-signin.png` })
  await signInWithEmail(page, member)
  await onboard(page, name, '2005')

  // 3. Three-step registration
  await expect(page).toHaveURL(/\/meet\/register/)
  await expect(page.getByText('Registering as')).toBeVisible()
  await page.getByRole('button', { name: 'More: Spouse' }).click()
  await page.getByLabel('Spouse 1 name').fill('Rahul Rao')
  await page.screenshot({ path: `${shots}/03-register-step1.png`, fullPage: true })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Vegetarian', { exact: true }).click()
  await page.getByLabel('Your T-shirt size').selectOption('L')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('₹4,000').first()).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page.getByText('Please accept to continue.')).toBeVisible() // terms are required
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.screenshot({ path: `${shots}/04-register-review.png`, fullPage: true })
  await page.getByRole('button', { name: 'Confirm and pay' }).click()

  // 4. Pay by UPI and submit the UTR
  await expect(page).toHaveURL(/\/meet\/my/)
  await expect(page.getByText('Step 1 · Pay by UPI')).toBeVisible()
  const upi = await page.getByRole('link', { name: /with a UPI app/ }).getAttribute('href')
  expect(upi).toContain('am=4000')
  expect(upi).toMatch(/tn=JEC-[A-Z0-9]{6}/)
  await page.screenshot({ path: `${shots}/05-pay.png`, fullPage: true })
  await page.getByLabel('UPI reference number (UTR)').fill('1234')
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText(/12-digit number shown in your payment app/)).toBeVisible()
  const utr = `4${String(Date.now()).slice(-11)}`
  await page.getByLabel('UPI reference number (UTR)').fill(utr)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  await page.screenshot({ path: `${shots}/06-under-review.png`, fullPage: true })
  const code = sql(`select code from event_registrations r join auth.users u on u.id = r.user_id where u.email = '${member}'`)
  expect(code).toMatch(/^JEC-/)

  // 5. Treasurer verifies the payment (desktop)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const desk = await ctx.newPage()
  await desk.goto('/signin?next=/admin')
  await signInWithEmail(desk, admin)
  await onboard(desk, 'Chitra Treasurer', '2004')
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = '${admin}')`)
  await desk.goto('/admin/events/alumni-meet-2026?tab=payments')
  const card = desk.getByRole('listitem').filter({ hasText: utr })
  await expect(card.getByText(name).first()).toBeVisible()
  await desk.screenshot({ path: `${shots}/07-admin-payments.png`, fullPage: true })
  await card.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(desk.getByText(utr)).toHaveCount(0)
  await desk.getByRole('tab', { name: 'Overview' }).click()
  await expect(desk.getByText('Collected (verified)')).toBeVisible()
  await desk.screenshot({ path: `${shots}/08-admin-overview.png`, fullPage: true })

  // 6. The member now has an entry pass and is a verified member
  await page.reload()
  await expect(page.getByText('Entry pass')).toBeVisible()
  await expect(page.getByText(code).first()).toBeVisible()
  await page.screenshot({ path: `${shots}/09-ticket.png`, fullPage: true })
  expect(sql(`select verification from profiles p join auth.users u on u.id = p.id where u.email = '${member}'`)).toBe('verified')

  // 7. Gate check-in by code; a second scan is flagged
  await desk.goto('/admin/events/alumni-meet-2026/check-in')
  await desk.getByLabel('Ticket code').fill(code.replace('JEC-', ''))
  await desk.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(desk.getByText('Welcome! Checked in')).toBeVisible()
  await expect(desk.getByText('admits 2')).toBeVisible()
  await desk.screenshot({ path: `${shots}/10-checkin.png` })
  await desk.waitForTimeout(4200) // same-code debounce
  await desk.getByLabel('Ticket code').fill(code)
  await desk.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(desk.getByText(/Already checked in/)).toBeVisible()
  await ctx.close()
})
