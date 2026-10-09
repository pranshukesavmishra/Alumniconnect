// Grand Reunion registration end to end: a member with a partial profile completes it inline, chooses both days + family,
// gives the Reunion Fund, volunteers, sponsors, performs, adds extras, answers an admin-added question; the admin sees all
// of it in Responses and the CSV; after payment, feedback is editable but the fund is not.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createMember, newUtr, signInContext, stamp, sql } from './verify/meet-lib'

const S = stamp()
const shots = 'test-results/screens'
const questionLabel = `Which sessions interest you? ${S.slice(-4)}`

test.use({ viewport: { width: 390, height: 844 } })

test.afterAll(() => {
  sql(`delete from event_questions where label = '${questionLabel}'`)
})

test('reunion registration: profile card, days and family, fund, teams, sponsor, performance, extras, custom question, Responses, CSV, locked after payment', async ({ browser }) => {
  const eventId = sql(`select id from events where slug = 'alumni-meet-2026'`)
  const price = (label: string) => Number(sql(`select price_paise from event_ticket_types where event_id = '${eventId}' and label like '${label}%'`))
  const both = price('Both days')
  const adult = price('Family adult')
  const expectedTotal = both + 2 * adult + 250000
  const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`

  // ---- admin adds a question without code
  const adminEmail = `reunion-admin-${S}@test.local`
  const adminId = createMember({ email: adminEmail, name: `Reunion Admin ${S.slice(-4)}`, admin: true, verified: true })
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await signInContext(actx, adminId, adminEmail)
  const admin = await actx.newPage()
  await admin.goto('/admin/events/alumni-meet-2026?tab=settings')
  await admin.getByRole('button', { name: 'Add question' }).first().click()
  await admin.getByText('Choose several', { exact: true }).click()
  await admin.getByLabel('Question', { exact: true }).fill(questionLabel)
  await admin.getByLabel('Options').fill('Panel talk\nCampus walk\nCricket match')
  await admin.getByRole('button', { name: 'Add question' }).last().click()
  await expect(admin.getByText('Question added')).toBeVisible()
  expect(sql(`select kind || '|' || array_to_string(options, ',') || '|' || required from event_questions where label = '${questionLabel}'`)).toBe('multi|Panel talk,Campus walk,Cricket match|false')

  // ---- member with a partial profile: no designation, company or country yet
  const email = `reunion-${S}@test.local`
  const name = `Reunion Alum ${S.slice(-4)}`
  const uid = createMember({ email, name, year: 2007, verified: true })
  sql(`update profiles set country = null, current_title = null, current_company = null where id = '${uid}'`)
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(mctx, uid, email)
  const page = await mctx.newPage()
  await page.goto('/meet/register')

  // step 1: welcome, profile card, inline mini-form
  await expect(page.getByRole('heading', { name: 'Alumni Connect Grand Reunion 2026' })).toBeVisible()
  await expect(page.getByText('Batches 2003–2012 · A Decade of JECians')).toBeVisible()
  await expect(page.getByText('about 2 minutes')).toBeVisible()
  await expect(page.getByText('Step 1 of 5 · Your details')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your details (from your profile)' })).toBeVisible()
  await expect(page.getByText('Verified JECian')).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('+91 98765 43210').first()).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Please save the missing details above first.')).toBeVisible() // cannot skip
  await page.screenshot({ path: `${shots}/reunion-1-details.png`, fullPage: true })
  await page.getByLabel('Current designation').fill('Engineering Manager')
  await page.getByLabel('Company', { exact: true }).fill('Infosys')
  await page.getByLabel('Country').fill('India')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Saved to your profile')).toBeVisible()
  expect(sql(`select current_title || '|' || current_company || '|' || country from profiles where id = '${uid}'`)).toBe('Engineering Manager|Infosys|India')
  await expect(page.getByText('A few details are missing from your profile')).toHaveCount(0)
  // past jobs, typed here: saved to the profile's experience
  await page.getByRole('button', { name: 'Add past jobs' }).click()
  await page.getByLabel('Job title 1').fill('Senior Engineer')
  await page.getByLabel('Company 1').fill('Wipro')
  await page.getByRole('button', { name: 'Save to my profile' }).click()
  await expect(page.getByText('Senior Engineer at Wipro')).toBeVisible()
  expect(sql(`select count(*) from experiences where profile_id = '${uid}' and title = 'Senior Engineer' and company = 'Wipro' and not is_current`)).toBe('1')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // step 2: days and family; family is only for the 27th
  await expect(page.getByText('Step 2 of 5 · Days & family')).toBeVisible()
  await page.getByText('26 Dec only', { exact: false }).first().click()
  await expect(page.getByText('Family can join on 27 Dec only')).toBeVisible()
  await expect(page.getByRole('button', { name: 'More: Family adult · 27 Dec' })).toHaveCount(0)
  await page.getByText('Both days', { exact: false }).first().click()
  await page.getByRole('button', { name: 'More: Family adult · 27 Dec' }).click()
  await page.getByRole('button', { name: 'More: Family adult · 27 Dec' }).click()
  await page.getByLabel('Family adult · 27 Dec 1 name').fill('Meera Alum')
  await page.getByLabel('Family adult · 27 Dec 2 name').fill('Dad Alum')
  await page.getByLabel('Family adult · 27 Dec 1 food').selectOption('jain')
  await page.getByLabel('Family adult · 27 Dec 2 food').selectOption('veg')
  await page.getByRole('radio', { name: 'No meal / fasting' }).check({ force: true })
  await page.getByLabel('Your T-shirt size').selectOption('L')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Please choose yes or no.').first()).toBeVisible() // help questions are required
  await page.getByText('We can share vendor details').waitFor()
  await page.screenshot({ path: `${shots}/reunion-2-days.png`, fullPage: true })
  await page.getByRole('group', { name: 'Do you need help with accommodation?' }).getByText('Yes', { exact: true }).click()
  await page.getByRole('group', { name: 'Do you need help with local travel or pickup?' }).getByText('No', { exact: true }).click()
  await page.getByLabel('Arriving from (city)').fill('Pune')
  await page.getByLabel('Arrival date').fill('2026-12-25')
  await page.getByLabel('How are you arriving?').selectOption('train')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // step 3: get involved
  await expect(page.getByText('Step 3 of 5 · Get involved')).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Please choose yes or no.').first()).toBeVisible() // all four are required
  const ask = (q: string, a: string) => page.getByRole('group', { name: q }).getByText(a, { exact: true }).click()
  await ask('Would you like to be part of the organising teams?', 'Yes')
  await page.getByRole('checkbox', { name: 'Core Team' }).check()
  await page.getByRole('checkbox', { name: 'Hospitality Team' }).check()
  await ask('Would you like to perform at the reunion?', 'Yes')
  await page.getByRole('checkbox', { name: 'Singing' }).check()
  await page.getByText('Solo', { exact: true }).click()
  await page.getByLabel('Time needed (minutes)').fill('45')
  await ask('Would you like to contribute to the Reunion Fund?', 'Yes')
  await page.getByText('₹2,500', { exact: true }).click()
  await expect(page.getByText(`incl. ₹2,500 fund`)).toBeVisible()
  await expect(page.getByText(rupees(expectedTotal)).first()).toBeVisible()
  await ask('Would you or your organisation like to sponsor the event?', 'Yes')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Please enter between 1 and 30 minutes.')).toBeVisible()
  await expect(page.getByText('Please choose a level.')).toBeVisible()
  await page.getByLabel('Time needed (minutes)').fill('5')
  await page.getByText('Co-sponsor', { exact: true }).click()
  await page.getByLabel('Organisation name').fill('Acme Pvt Ltd')
  await page.screenshot({ path: `${shots}/reunion-3-involved.png`, fullPage: true })
  // the draft survives a reload
  await page.waitForTimeout(600)
  await page.reload()
  await expect(page.getByText('Step 1 of 5')).toBeVisible()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Organisation name')).toHaveValue('Acme Pvt Ltd')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // step 4: make it memorable (all optional) + the organisers' own question
  await expect(page.getByText('Step 4 of 5 · Make it memorable')).toBeVisible()
  await expect(page.getByText('You chose 27 Dec, the outdoor day. Please add an emergency contact.')).toBeVisible()
  await page.getByLabel('Name for your badge').fill('Ashu')
  await page.getByLabel('Hostel during college').fill('Hostel 3')
  await page.getByLabel('Song 1').fill('Yaaron Dosti')
  await page.getByLabel('A memory or shout-out').fill('Samosas at the canteen')
  await page.getByRole('checkbox', { name: /memory wall/ }).check()
  await page.getByLabel('Contact name').fill('Ravi Alum')
  await page.getByLabel('Contact number').fill('+91 90000 22222')
  await page.getByLabel('Accessibility or medical needs').fill('Needs ground-floor seating')
  await page.getByRole('checkbox', { name: 'Panel talk' }).check()
  await page.getByRole('checkbox', { name: 'Cricket match' }).check()
  await page.getByLabel('Any feedback or suggestions').fill(`Please start the main event on time. ${S}`)
  await page.screenshot({ path: `${shots}/reunion-4-memorable.png`, fullPage: true })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // step 5: review, grouped, with Edit links
  await expect(page.getByText('Step 5 of 5 · Review & pay')).toBeVisible()
  await expect(page.getByText('Reunion Fund contribution')).toBeVisible()
  await expect(page.getByText(rupees(expectedTotal)).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Get involved' })).toBeVisible()
  await page.screenshot({ path: `${shots}/reunion-5-review.png`, fullPage: true })
  await page.getByRole('button', { name: 'Confirm and pay' }).click()
  await expect(page.getByText('Please accept to continue.')).toBeVisible()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await page.getByRole('button', { name: 'Confirm and pay' }).click()

  // confirmation
  await expect(page).toHaveURL(/\/meet\/my/)
  await expect(page.getByText('You are registered!')).toBeVisible()
  await expect(page.getByText(`Tickets ${rupees(both + 2 * adult)} + Reunion Fund ₹2,500`)).toBeVisible()
  await expect(page.getByText('Bring your batch')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add photos' })).toBeVisible()
  await page.screenshot({ path: `${shots}/reunion-6-confirmation.png`, fullPage: true })

  // the database has every typed answer
  const row = JSON.parse(sql(`select row_to_json(r) from event_registrations r where user_id = '${uid}'`)) as Record<string, any>
  expect(row).toMatchObject({
    status: 'pending_payment', amount_paise: expectedTotal, fund_paise: 250000, fund_interest: true, headcount: 3,
    country: 'India', designation: 'Engineering Manager', company: 'Infosys', past_experience: 'Senior Engineer at Wipro',
    org_team_interest: true, org_teams: ['core', 'hospitality'], sponsor_interest: true, sponsor_level: 'co', sponsor_org: 'Acme Pvt Ltd',
    perform_interest: true, perform_types: ['singing'], perform_group: false, perform_minutes: 5,
    needs_accommodation: true, needs_local_travel: false, arrival_from: 'Pune', arrival_date: '2026-12-25', arrival_mode: 'train',
    nickname: 'Ashu', hostel: 'Hostel 3', song_requests: ['Yaaron Dosti'], memory_wall_consent: true, emergency_name: 'Ravi Alum',
    emergency_phone: '+91 90000 22222', medical_notes: 'Needs ground-floor seating', feedback: `Please start the main event on time. ${S}`,
    food_pref: 'none', tshirt_size: 'L', branch: 'B.E. in Computer Science & Engineering', grad_year: 2007, email,
  })
  expect(row.day_heads).toEqual({ '1': 1, '2': 3 })
  expect(row.guests.map((g: any) => `${g.name}:${g.food}`)).toEqual(['Meera Alum:jain', 'Dad Alum:veg'])
  expect(Object.values(row.custom_answers)).toEqual([['Panel talk', 'Cricket match']])

  // ---- admin: Responses tab shows it, CSV has the row
  await admin.goto('/admin/events/alumni-meet-2026?tab=responses')
  const mine = (region: RegExp) => admin.getByRole('region', { name: region }).getByRole('listitem').filter({ hasText: name })
  const fundBox = admin.getByRole('region', { name: /Reunion Fund/ })
  await expect(fundBox.getByText(name)).toBeVisible()
  await expect(fundBox.getByRole('listitem').filter({ hasText: name }).getByText('₹2,500 · not paid yet')).toBeVisible()
  await expect(mine(/Volunteers by team/).first()).toBeVisible()
  await expect(mine(/Sponsor leads/).getByText('Co-sponsor · Acme Pvt Ltd')).toBeVisible()
  await expect(mine(/Performers/).getByText(/Singing · solo · 5 min/)).toBeVisible()
  await expect(mine(/Needs help with accommodation/)).toBeVisible()
  await expect(admin.getByRole('region', { name: /Feedback and suggestions/ }).getByText(`Please start the main event on time. ${S}`)).toBeVisible()
  await expect(admin.getByRole('region', { name: /Your own questions/ }).getByText(questionLabel)).toBeVisible()
  await expect(mine(/Emergency contacts/).getByText(/Ravi Alum \+91 90000 22222/)).toBeVisible()
  await expect(admin.getByRole('region', { name: /Make it memorable/ }).getByText(/Yaaron Dosti/)).toBeVisible()
  await admin.screenshot({ path: `${shots}/reunion-7-responses.png`, fullPage: true })
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'All responses (CSV)' }).click()])
  const csv = readFileSync(await dl.path(), 'utf8')
  expect(csv).toContain('Any feedback or suggestions')
  const line = csv.split('\n').find((l) => l.includes(name))!
  expect(line).toContain('Engineering Manager at Infosys')
  expect(line).toContain('Senior Engineer at Wipro')
  expect(line).toContain('2500.00')
  expect(line).toContain('Acme Pvt Ltd')
  expect(line).toContain('Ashu')
  expect(csv).toContain(`Q: ${questionLabel}`)
  expect(line).toContain('Panel talk, Cricket match')
  // admin person view
  await admin.goto('/admin/events/alumni-meet-2026?tab=people')
  await admin.getByRole('button', { name: new RegExp(name) }).click()
  await expect(admin.getByLabel('Reunion answers').getByText('Needs ground-floor seating')).toBeVisible()

  // ---- member pays; admin verifies
  const utr = newUtr()
  await page.getByLabel('UPI reference number (UTR)').fill(utr)
  await page.getByRole('button', { name: 'Submit payment details' }).click()
  await expect(page.getByText('Payment received. The treasurer is verifying it.')).toBeVisible()
  expect(sql(`select amount_paise from event_payments where utr = '${utr}'`)).toBe(String(expectedTotal))
  await admin.goto('/admin/events/alumni-meet-2026?tab=payments')
  const card = admin.getByRole('listitem').filter({ hasText: utr })
  await expect(card.getByText('incl. ₹2,500 Reunion Fund')).toBeVisible()
  await card.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(admin.getByText(utr)).toHaveCount(0)
  expect(sql(`select status from event_registrations where user_id = '${uid}'`)).toBe('confirmed')

  // ---- after payment: feedback is editable, the fund is not
  await page.reload()
  await expect(page.getByText('Entry pass', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Edit answers' }).click()
  await expect(page.getByText('Your payment is already submitted')).toBeVisible()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  // the fund question is locked: trying to switch it off changes nothing
  await expect(page.getByText('so the fund amount is fixed')).toBeVisible()
  await page.getByRole('group', { name: 'Would you like to contribute to the Reunion Fund?' }).getByText('No', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Any feedback or suggestions').fill('Edited after paying: add a quiet room.')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(/\/meet\/my/)
  expect(sql(`select feedback || '|' || fund_paise || '|' || amount_paise || '|' || status from event_registrations where user_id = '${uid}'`)).toBe(`Edited after paying: add a quiet room.|250000|${expectedTotal}|confirmed`)

  await actx.close()
  await mctx.close()
})
