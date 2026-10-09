// Alumni Meet UI, end to end in the browser (phone viewport unless noted), with a DB check after each step.
import { expect, test, devices, type Page } from '@playwright/test'
import { onboard, registerForReunion, signInWithEmail } from '../helpers'
import { as, createEvent, createMember, newUtr, q, register, sql, SEEDED_EVENT, signInContext, stamp } from './meet-lib'

const S = stamp()
const mail = (x: string) => `meet-${S}-${x}@test.local`
const shots = 'test-results/meet-verify/screens'

function myReg(email: string) {
  const out = sql(`select row_to_json(r) from event_registrations r join auth.users u on u.id = r.user_id
                   where u.email = '${email}' and r.event_id = (select id from events where slug = 'alumni-meet-2026')`)
  return out ? (JSON.parse(out) as Record<string, any>) : null
}

function upiParams(href: string) {
  expect(href.startsWith('upi://pay?') || /^(gpay:\/\/upi\/pay|phonepe:\/\/pay|paytmmp:\/\/pay)\?/.test(href), href).toBe(true)
  const query = href.slice(href.indexOf('?') + 1)
  expect(query, 'spaces must be %20, never +').not.toContain('+')
  return Object.fromEntries(query.split('&').map((kv) => kv.split('=').map(decodeURIComponent))) as Record<string, string>
}


const price = (label: string) =>
  Number(sql(`select price_paise from event_ticket_types where event_id = (select id from events where slug = 'alumni-meet-2026') and label like '${label}%'`))
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`

test('registration: days, family names, draft survives reload, preferences, paise total, consent, cancel and re-register', async ({ page }) => {
  const email = mail('reg')
  const cont = () => page.getByRole('button', { name: 'Continue', exact: true }).click()
  const both = price('Both days')
  const adult = price('Family adult')
  const kid = price('Child 5–12')
  await page.goto('/meet')
  await page.getByRole('link', { name: 'Register now' }).filter({ visible: true }).first().click()
  await signInWithEmail(page, email)
  await onboard(page, `Reg Tester ${S.slice(-4)}`, '2006')
  await expect(page).toHaveURL(/\/meet\/register/)

  // step 1: profile card; the missing designation and company are completed right here
  await page.getByLabel('Current designation').fill('QA Lead')
  await page.getByLabel('Company', { exact: true }).fill('Acme')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Saved to your profile')).toBeVisible()
  await cont()

  // step 2: family tickets appear only once the days include the 27th
  await expect(page.getByRole('button', { name: 'More: Family adult · 27 Dec' })).toHaveCount(0)
  await page.getByText(/26 Dec only/).first().click()
  await expect(page.getByText('Family can join on 27 Dec only')).toBeVisible()
  await expect(page.getByRole('button', { name: 'More: Family adult · 27 Dec' })).toHaveCount(0)
  await page.getByText(/Both days/).first().click()
  await page.getByRole('button', { name: 'More: Family adult · 27 Dec' }).click()
  await page.getByRole('button', { name: 'More: Child 5–12 years · 27 Dec' }).click()
  await page.getByRole('button', { name: 'More: Child 5–12 years · 27 Dec' }).click()
  await page.getByRole('button', { name: 'More: Child under 5 · 27 Dec' }).click()
  await page.getByLabel('Family adult · 27 Dec 1 name').fill('Meera Tester')
  await page.getByLabel('Child 5–12 years · 27 Dec 1 name').fill('Kid One')
  await page.getByLabel('Child 5–12 years · 27 Dec 2 name').fill('Kid Two')
  await page.getByLabel('Child under 5 · 27 Dec 1 name').fill('Baby Tester')
  const total1 = both + adult + 2 * kid
  await expect(page.getByText('5 people')).toBeVisible()
  await expect(page.getByText(rupees(total1)).first()).toBeVisible()

  // draft persistence across a reload (e.g. the phone evicting the tab)
  await page.waitForTimeout(600) // draft is saved after 300 ms
  await page.reload()
  await cont()
  await expect(page.getByLabel('Child 5–12 years · 27 Dec 2 name')).toHaveValue('Kid Two')
  await expect(page.getByLabel('Family adult · 27 Dec 1 name')).toHaveValue('Meera Tester')
  await expect(page.getByText(rupees(total1)).first()).toBeVisible()

  // step 2 answers are required
  await cont()
  await expect(page.getByText('Please choose a food preference.')).toBeVisible()
  await expect(page.getByText('Please choose your T-shirt size.')).toBeVisible()
  await expect(page.getByText('Please choose yes or no.').first()).toBeVisible()
  await page.locator('label').filter({ hasText: /^Jain$/ }).click()
  await page.getByLabel('Your T-shirt size').selectOption('XXL')
  await page.getByRole('group', { name: 'Do you need help with accommodation?' }).getByText('Yes', { exact: true }).click()
  await page.getByRole('group', { name: 'Do you need help with local travel or pickup?' }).getByText('No', { exact: true }).click()
  await page.getByLabel('Arrival plan').fill('Arriving 25 Dec by train')
  await cont()
  for (const question of ['Would you like to be part of the organising teams?', 'Would you like to perform at the reunion?', 'Would you like to contribute to the Reunion Fund?', 'Would you or your organisation like to sponsor the event?']) {
    await page.getByRole('group', { name: question }).getByText('No', { exact: true }).click()
  }
  await cont()
  await cont()

  // review: grouped, photo consent off, terms required
  await expect(page.getByText('Total · 5 people')).toBeVisible()
  await expect(page.getByText('Child 5–12 years · 27 Dec × 2')).toBeVisible()
  await page.getByRole('checkbox', { name: /Photos and videos of me/ }).uncheck()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page.getByText('Please accept to continue.')).toBeVisible()
  expect(myReg(email)).toBeNull() // nothing saved without terms
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.screenshot({ path: `${shots}/reg-review.png`, fullPage: true })
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)

  let r = myReg(email)!
  expect(r).toMatchObject({ status: 'pending_payment', amount_paise: total1, headcount: 5, food_pref: 'jain', tshirt_size: 'XXL', needs_accommodation: true, photo_consent: false, grad_year: 2006, arrival_note: 'Arriving 25 Dec by train', designation: 'QA Lead', company: 'Acme' })
  expect((r.guests as { name: string }[]).map((g) => g.name)).toEqual(['Meera Tester', 'Kid One', 'Kid Two', 'Baby Tester'])
  expect(r.terms_accepted_at).not.toBeNull()
  expect(sql(`select count(*) from event_registration_items where registration_id = '${r.id}'`)).toBe('4')
  // the draft is cleared after saving
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('reg-draft:')).length)).toBe(0)

  // payment panel: UPI deep link (Android) carries pa, pn, am, cu=INR and the ticket code as the note
  await expect(page.getByText('Step 1 · Pay by UPI')).toBeVisible()
  await expect(page.getByText(rupees(total1)).first()).toBeVisible()
  const href = (await page.getByRole('link', { name: /with a UPI app/ }).getAttribute('href'))!
  expect(upiParams(href)).toEqual({ pa: 'sample.do-not-pay@upi', pn: 'SAMPLE - DO NOT PAY', am: String(total1 / 100), cu: 'INR', tn: r.code })
  await page.getByRole('button', { name: /Show QR code/ }).click()
  await expect(page.getByRole('img', { name: new RegExp(`UPI QR code to pay ${rupees(total1)}`) })).toBeVisible()

  // edit before payment: drop the family adult; the total is re-priced on the server
  await page.getByRole('link', { name: 'Edit preferences' }).click()
  await cont()
  await expect(page.getByLabel('Family adult · 27 Dec 1 name')).toHaveValue('Meera Tester') // prefilled from the saved registration
  await page.getByRole('button', { name: 'Fewer: Family adult · 27 Dec' }).click()
  for (let i = 0; i < 3; i++) await cont()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)
  r = myReg(email)!
  expect(r).toMatchObject({ amount_paise: both + 2 * kid, headcount: 4, status: 'pending_payment' })
  expect((r.guests as { name: string }[]).map((g) => g.name)).toEqual(['Kid One', 'Kid Two', 'Baby Tester'])

  // cancel, then register again
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Cancel registration' }).click()
  await expect(page).toHaveURL(/\/meet$/)
  expect(myReg(email)!.status).toBe('cancelled')
  await page.getByRole('link', { name: 'Register now' }).filter({ visible: true }).first().click()
  await registerForReunion(page, { size: 'M' })
  await expect(page).toHaveURL(/\/meet\/my/)
  const again = myReg(email)!
  expect(again).toMatchObject({ id: r.id, code: r.code, status: 'pending_payment', amount_paise: both, headcount: 1, food_pref: 'veg' })
})

// A member who declined photo consent and later edits e.g. the T-shirt size must not silently re-grant consent.
test('editing a registration keeps the member’s photo-consent choice', async ({ browser }) => {
  const email = mail('consent')
  const uid = createMember({ email, name: 'Consent Keeper', year: 2004 })
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  await signInContext(ctx, uid, email)
  const page = await ctx.newPage()
  await page.goto('/meet/register')
  await registerForReunion(page, { photoConsent: false })
  await expect(page).toHaveURL(/\/meet\/my/)
  expect(myReg(email)!.photo_consent).toBe(false)
  // later: change only the T-shirt size
  await page.getByRole('link', { name: 'Edit preferences' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Your T-shirt size').selectOption('XL')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)
  expect(myReg(email)!.tshirt_size).toBe('XL')
  expect(myReg(email)!.photo_consent, 'photo consent flipped back to true').toBe(false)
  await ctx.close()
})

async function registerViaApi(email: string, name: string, year = 2005, list?: [string, number][]) {
  const uid = createMember({ email, name, year })
  const ev = SEEDED_EVENT()
  const primary = sql(`select id from event_ticket_types where event_id = '${ev}' and is_primary and label like 'Both days%'`)
  const lines = (list ?? [[primary, 1]]).map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity }))
  const answers = { needs_accommodation: false, needs_local_travel: false, org_team_interest: false, fund_interest: false, sponsor_interest: false, perform_interest: false }
  as(uid, `select upsert_registration('${ev}', ${q(JSON.stringify({ full_name: name, phone: '+91 98765 43210', accept_terms: true, grad_year: String(year), food_pref: 'veg', tshirt_size: 'M', email, ...answers }))}::jsonb, ${q(JSON.stringify(lines))}::jsonb)`)
  return uid
}

async function adminPage(browser: import('@playwright/test').Browser, tag: string) {
  const email = mail(tag)
  const uid = createMember({ email, name: `Treasurer ${tag}`, admin: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await signInContext(ctx, uid, email)
  return { ctx, page: await ctx.newPage(), uid }
}

test('payment: UTR validation & reuse, treasurer rejects with reason, member resubmits, verify -> ticket + verified member', async ({ browser }) => {
  const email = mail('pay')
  const name = `Payer ${S.slice(-4)}`
  const uid = await registerViaApi(email, name)
  const other = await registerViaApi(mail('pay2'), 'Other Payer')
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  await signInContext(ctx, uid, email)
  const page = await ctx.newPage()
  await page.goto('/meet/my')
  await expect(page.getByText('Step 1 · Pay by UPI')).toBeVisible()

  // a UTR already claimed by another member
  const taken = newUtr()
  const otherReg = sql(`select id from event_registrations where user_id = '${other}'`)
  as(other, `select submit_upi_payment('${otherReg}', '${taken}', null, null)`)
  for (const bad of ['12345', '1234567890123']) {
    await page.getByLabel('UPI reference number (UTR)').fill(bad)
    await page.getByRole('button', { name: 'Submit payment details' }).click()
    await expect(page.getByText(/12-digit number shown in your payment app/)).toBeVisible()
  }
  await page.getByLabel('UPI reference number (UTR)').fill('abc')
  await expect(page.getByLabel('UPI reference number (UTR)')).toHaveValue('') // letters are filtered out
  await page.getByLabel('UPI reference number (UTR)').fill(taken)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('This UPI reference has already been used')).toBeVisible()
  expect(sql(`select count(*) from event_payments p join event_registrations r on r.id = p.registration_id where r.user_id = '${uid}'`)).toBe('0')

  const utr1 = newUtr()
  await page.getByLabel('UPI reference number (UTR)').fill(`${utr1.slice(0, 6)} ${utr1.slice(6)}`)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  expect(myReg(email)!.status).toBe('under_review')
  expect(sql(`select amount_paise || '|' || status || '|' || utr from event_payments where utr = '${utr1}'`)).toBe(`${price('Both days')}|submitted|${utr1}`)

  // treasurer: "Not received" with a reason
  const admin = await adminPage(browser, 'paytreas')
  await admin.page.goto('/admin/events/alumni-meet-2026?tab=payments')
  let card = admin.page.getByRole('listitem').filter({ hasText: utr1 })
  await expect(card.getByText(name).first()).toBeVisible()
  await card.getByRole('button', { name: 'Not received' }).click()
  await admin.page.getByLabel('Message to the member').fill('Amount not in our statement yet, please recheck the UTR.')
  await admin.page.getByRole('button', { name: 'Mark as not received' }).click()
  await expect(admin.page.getByText(utr1)).toHaveCount(0)
  expect(sql(`select status || '|' || review_note from event_payments where utr = '${utr1}'`)).toBe('rejected|Amount not in our statement yet, please recheck the UTR.')
  expect(myReg(email)!.status).toBe('pending_payment')

  // member sees the reason and pays again
  await page.reload()
  await expect(page.getByText('We couldn’t verify your last payment')).toBeVisible()
  await expect(page.getByText('Amount not in our statement yet, please recheck the UTR.')).toBeVisible()
  const utr2 = newUtr()
  await page.getByLabel('UPI reference number (UTR)').fill(utr2)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()

  await admin.page.reload()
  card = admin.page.getByRole('listitem').filter({ hasText: utr2 })
  await card.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(admin.page.getByText(utr2)).toHaveCount(0)
  expect(myReg(email)!.status).toBe('confirmed')
  expect(sql(`select verification from profiles where id = '${uid}'`)).toBe('verified')

  await page.reload()
  await expect(page.getByText('Entry pass', { exact: true })).toBeVisible()
  const code = myReg(email)!.code as string
  await expect(page.getByRole('img', { name: `Entry QR code ${code}` })).toBeVisible()
  // the QR encodes exactly the ticket code (decode it in the page with the app's own scanner library)
  const svg = await page.getByRole('img', { name: `Entry QR code ${code}` }).innerHTML()
  expect(svg).toContain('<svg')
  const decoded = await page.evaluate(async (markup) => {
    const QrScanner = (await import('/node_modules/qr-scanner/qr-scanner.min.js' as string)).default
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + btoa(markup)
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 400
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 400, 400)
    g.drawImage(img, 20, 20, 360, 360)
    return (await QrScanner.scanImage(c, { returnDetailedScanResult: true })).data as string
  }, svg)
  expect(decoded).toBe(code)
  await page.screenshot({ path: `${shots}/ticket.png`, fullPage: true })
  await admin.ctx.close()
  await ctx.close()
})

test('iPhone: per-app UPI links (GPay, PhonePe, Paytm) carry the same parameters', async ({ browser }) => {
  const email = mail('ios')
  const uid = await registerViaApi(email, 'Iphone User')
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 14']
  const ctx = await browser.newContext(iphone)
  await signInContext(ctx, uid, email)
  const page = await ctx.newPage()
  await page.goto('/meet/my')
  const code = myReg(email)!.code
  const expected = { pa: 'sample.do-not-pay@upi', pn: 'SAMPLE - DO NOT PAY', am: String(price('Both days') / 100), cu: 'INR', tn: code }
  for (const [app, prefix] of [['Google Pay', 'gpay://upi/pay?'], ['PhonePe', 'phonepe://pay?'], ['Paytm', 'paytmmp://pay?']] as const) {
    const href = (await page.getByRole('link', { name: app, exact: true }).getAttribute('href'))!
    expect(href.startsWith(prefix), href).toBe(true)
    expect(upiParams(href)).toEqual(expected)
  }
  await expect(page.getByRole('link', { name: /with a UPI app/ })).toHaveCount(0)
  await ctx.close()
})
