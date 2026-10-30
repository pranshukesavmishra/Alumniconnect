// Records the guide scenes as phone-screen clips: node scripts/guide/scenes.mjs s1 s2 ... (GUIDE=<scratch dir>, vite dev server on APP_URL).
// Order matters for the story: s1+s2 create the on-camera member Rohan Mehta (a real sign-in + welcome), s3 registers and pays, then the
// payment is approved (below) so s4 shows the entry pass; s5..s8 use the same member.
import { readFileSync } from 'node:fs'
import { GUIDE, APP, inView, callout, latestCode, mintSession, newRecorder, q, sleep, smoothScroll, sql, tap, typeSlow, uncall } from './lib.mjs'

const EMAIL = 'rohan.mehta@example.com'
const DEMO_UTR = '412345678901'
const LINKEDIN_TEXT = `Rohan Mehta
Senior Manager, Operations at Nimbus Industries | Lean | Supply chain
Pune, Maharashtra, India
Contact info
500+ connections
Nimbus Industries
Nimbus Industries
Jabalpur Engineering College
Jabalpur Engineering College
About
Operations leader with 14 years in manufacturing. Proud JECian, Electronics and Telecommunications, batch of 2008.
Experience
Senior Manager, Operations
Nimbus Industries · Full-time
Jan 2018 - Present · 8 yrs 10 mos
Pune, Maharashtra, India
Manager
Kinetic Components · Full-time
Jul 2012 - Dec 2017 · 5 yrs 6 mos
Education
Jabalpur Engineering College
Bachelor of Engineering - BE, Electronics and Telecommunications
2004 - 2008
Skills
Lean Manufacturing · Operations Management · Supply Chain`

const me = () => sql(`select id from auth.users where email = '${EMAIL}'`)
const ev = () => sql(`select id from events where slug = 'alumni-meet-2026'`)
const sessionOf = () => mintSession(me(), EMAIL)
const SHOTS = process.env.SHOTS === '1'
const shot = (r, n) => (SHOTS ? r.page.screenshot({ path: `${GUIDE}/explore/${n}.png` }) : Promise.resolve())

/** a member is also needed for the phone number: unique per run */
const PHONE = '+91 98765 43210'

const SCENES = {
  // 1. open the link, sign in with an e-mail code
  async s1() {
    sql(`delete from auth.users where email = '${EMAIL}'`)
    const r = await newRecorder({ name: 's1' })
    const { page } = r
    await page.goto(APP + '/signin')
    await sleep(1200)
    await r.start()
    await sleep(700)
    await smoothScroll(page, 480, 800)
    await sleep(300)
    await tap(page, page.getByRole('button', { name: 'Continue with LinkedIn' }), { label: 'LinkedIn', look: 700, pause: 0, scroll: false, ring: true }).catch(() => {})
    await sleep(300)
    r.pause()
    await page.goto(APP + '/signin')
    await sleep(900)
    await smoothScroll(page, 480, 10)
    r.resume()
    await sleep(200)
    await tap(page, page.getByRole('button', { name: 'Use my email instead' }), { label: 'Email code', look: 600, pause: 300, scroll: false })
    await typeSlow(page, page.getByLabel('Email address'), EMAIL, { delay: 26 })
    const at = Date.now()
    await tap(page, page.getByRole('button', { name: 'Send code' }), { look: 450, pause: 300, scroll: false })
    await page.getByLabel('6-digit code').waitFor()
    r.pause()
    const code = await latestCode(EMAIL, at)
    await sleep(400)
    r.resume()
    await shot(r, 's1_code')
    await callout(page, page.getByLabel('6-digit code'), 'Code from your email')
    await sleep(500)
    await page.getByLabel('6-digit code').pressSequentially(code, { delay: 70 })
    await uncall(page)
    await page.waitForURL(/welcome/)
    await sleep(900)
    return r.finish()
  },

  // 2. welcome: batch and branch, paste LinkedIn text, preview, save
  async s2() {
    const uid = me()
    const r = await newRecorder({ name: 's2', session: mintSession(uid, EMAIL) })
    const { page } = r
    await page.goto(APP + '/welcome')
    await page.getByLabel('Full name').waitFor()
    await sleep(600)
    await r.start()
    await sleep(500)
    await typeSlow(page, page.getByLabel('Full name'), 'Rohan Mehta', { delay: 30, label: 'Your name' })
    await tap(page, page.getByText('Alumnus / Alumna'), { pause: 200, look: 450 })
    await tap(page, page.getByRole('button', { name: 'Electronics & Telecom' }), { label: 'Your branch', look: 650, pause: 250 })
    await page.getByLabel('Passing-out year', { exact: true }).scrollIntoViewIfNeeded()
    await callout(page, page.getByLabel('Passing-out year', { exact: true }), 'Your batch')
    await sleep(500)
    await page.getByLabel('Passing-out year', { exact: true }).selectOption('2008')
    await sleep(700)
    await uncall(page)
    r.pause()
    await page.getByLabel('City you live in').fill('Pune')
    await page.getByLabel('Mobile number').fill(PHONE)
    await page.getByRole('button', { name: 'Continue' }).scrollIntoViewIfNeeded()
    r.resume()
    await sleep(150)
    await tap(page, page.getByRole('button', { name: 'Continue' }), { look: 400, pause: 0, scroll: false })
    await page.getByRole('heading', { name: 'What do you do?' }).waitFor()
    await sleep(700)
    const box = page.getByLabel('Open your LinkedIn profile, select all, copy, paste here')
    await callout(page, box, 'Paste your LinkedIn text')
    await sleep(600)
    await box.fill(LINKEDIN_TEXT)
    await sleep(600)
    await uncall(page)
    await tap(page, page.getByRole('button', { name: 'Read my profile' }), { look: 500, pause: 700 })
    const preview = page.getByTestId('qp-preview')
    await preview.waitFor()
    await sleep(900)
    await shot(r, 's2_preview')
    await tap(page, preview.getByRole('button', { name: 'Save to my profile' }), { look: 600, pause: 0 })
    await page.getByTestId('welcome-done').waitFor()
    await sleep(1100)
    await shot(r, 's2_done')
    return r.finish()
  },

  // 3. register for the Grand Reunion and pay by UPI
  async s3() {
    const id = me()
    sql(`delete from event_registrations where user_id = '${id}' and event_id = '${ev()}'`)
    const r = await newRecorder({ name: 's3', session: mintSession(id, EMAIL) })
    const { page } = r
    await page.goto(APP + '/meet')
    await sleep(1800)
    await r.start()
    await sleep(500)
    const reg = page.getByRole('link', { name: 'Register now' }).or(page.getByRole('button', { name: 'Register now' })).first()
    await tap(page, reg, { label: 'Register', look: 900, pause: 0, scroll: false })
    await page.getByRole('heading', { name: 'Your details (from your profile)' }).waitFor()
    await sleep(700)
    await shot(r, 's3_details')
    await tap(page, page.getByRole('button', { name: 'Continue', exact: true }), { look: 300, pause: 600 })
    // ticket
    await page.getByText(/Both days/).first().waitFor()
    await tap(page, page.getByText(/Both days/).first(), { label: 'Choose your ticket', look: 700, pause: 500 })
    const more = page.getByRole('button', { name: 'More: Family adult · 27 Dec' })
    await tap(page, more, { label: 'Add family', look: 600, pause: 400 })
    await page.getByLabel('Family adult · 27 Dec 1 name').fill('Sunita Mehta')
    await sleep(500)
    const tourBox = page.getByTestId('optional-extras').getByRole('checkbox').first()
    await page.getByTestId('optional-extras').scrollIntoViewIfNeeded()
    await smoothScroll(page, 60, 400)
    await tap(page, page.getByTestId('optional-extras').locator('label').first(), { label: 'Optional 27 Dec tour', look: 900, pause: 700, scroll: false })
    await shot(r, 's3_tour')
    r.pause()
    await page.locator('label').filter({ hasText: /^Vegetarian$/ }).click()
    await page.getByLabel('Your T-shirt size').selectOption('L')
    for (const qn of ['Do you need help with accommodation?', 'Do you need help with local travel or pickup?']) await page.getByRole('group', { name: qn }).getByText('No', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    for (const qn of ['Would you like to be part of the organising teams?', 'Would you like to perform at the reunion?', 'Would you like to contribute to the Reunion Fund?', 'Would you or your organisation like to sponsor the event?']) await page.getByRole('group', { name: qn }).getByText('No', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('checkbox', { name: /My details are correct/ }).check()
    await page.getByRole('button', { name: /Confirm and pay|Confirm registration/ }).click()
    await page.getByLabel('UPI reference number (UTR)').waitFor()
    await sleep(1500)
    await page.evaluate(() => window.scrollTo(0, 0))
    r.resume()
    await sleep(800)
    await shot(r, 's3_pay')
    await smoothScroll(page, 300, 700)
    const utr = page.getByLabel('UPI reference number (UTR)')
    await utr.scrollIntoViewIfNeeded()
    await smoothScroll(page, 120, 400)
    await callout(page, utr, '12-digit reference')
    await sleep(600)
    await tap(page, utr, { ring: false, pause: 100, scroll: false })
    await utr.pressSequentially(DEMO_UTR, { delay: 75 })
    await uncall(page)
    await sleep(400)
    await shot(r, 's3_utr')
    await tap(page, page.getByRole('button', { name: 'Submit payment details' }), { look: 500, pause: 1200 })
    await shot(r, 's3_done')
    return r.finish()
  },

  // 4. the QR entry pass (the treasurer has approved the payment off camera)
  async s4() {
    const id = me()
    const pay = sql(`select p.id from event_payments p join event_registrations r on r.id = p.registration_id where r.user_id = '${id}' order by p.created_at desc limit 1`)
    const admin = sql(`select id from auth.users where email = 'guide.priya@example.com'`)
    if (pay) {
      sql(`update profiles set is_admin = true where id = '${admin}'`)
      const claims = JSON.stringify({ sub: admin, role: 'authenticated' })
      try { sql(`set local role authenticated; select set_config('request.jwt.claims', ${q(claims)}, true); select review_payment('${pay}', true, null)`) } catch (e) { console.log('review failed', String(e).slice(0, 200)) }
      sql(`update profiles set is_admin = false where id = '${admin}'`)
    }
    const r = await newRecorder({ name: 's4', session: mintSession(id, EMAIL) })
    const { page } = r
    await page.goto(APP + '/meet/my')
    await sleep(2500)
    await r.start()
    await sleep(1000)
    await shot(r, 's4_pass')
    await smoothScroll(page, 280, 900)
    await sleep(1300)
    return r.finish()
  },
  // 5. Menu > Find JECians, search, open a profile, chat
  async s5() {
    const r = await newRecorder({ name: 's5', session: sessionOf() })
    const { page } = r
    await page.goto(APP + '/')
    await sleep(2200)
    await r.start()
    await sleep(400)
    await tap(page, page.getByRole('button', { name: /menu/i }).first(), { label: 'Menu', look: 700, pause: 900, scroll: false })
    await shot(r, 's5_menu')
    await tap(page, page.getByRole('button', { name: /^Community/ }).first(), { look: 500, pause: 700, scroll: false })
    await tap(page, await inView(page, 'Find JECians'), { label: 'Find JECians', look: 800, pause: 1000, scroll: false })
    await shot(r, 's5_people')
    const search = page.getByPlaceholder(/Name, company/).first()
    await search.waitFor()
    await typeSlow(page, search, 'Dubey', { delay: 90, label: 'Name, batch or city' })
    await sleep(1200)
    await shot(r, 's5_results')
    await tap(page, page.getByText('Kavita Dubey').first(), { look: 700, pause: 1400, scroll: false })
    await shot(r, 's5_profile')
    await tap(page, page.getByRole('button', { name: /Message|Chat/ }).or(page.getByRole('link', { name: /Message|Chat/ })).first(), { label: 'Tap to chat', look: 700, pause: 1500, scroll: false })
    await shot(r, 's5_chat')
    return r.finish()
  },

  // 6. Menu > Reunion photos & videos > Add photos & videos
  async s6() {
    const r = await newRecorder({ name: 's6', session: sessionOf() })
    const { page } = r
    await page.route('**/rpc/photo_caps', async (route) => {
      const res = await route.fetch()
      const j = await res.json()
      await route.fulfill({ response: res, json: { ...j, drive: true } })
    })
    await page.goto(APP + '/')
    await sleep(2200)
    await r.start()
    await sleep(300)
    await tap(page, page.getByRole('button', { name: /menu/i }).first(), { label: 'Menu', look: 600, pause: 800, scroll: false })
    await tap(page, page.getByRole('button', { name: /^Events/ }).first(), { look: 500, pause: 700, scroll: false })
    await tap(page, await inView(page, /Reunion photos/), { label: 'Reunion photos & videos', look: 800, pause: 1500, scroll: false })
    await shot(r, 's6_photos')
    await tap(page, page.getByRole('link', { name: /Add photos & videos/ }).or(page.getByRole('button', { name: /Add photos & videos/ })).first(), { label: 'Add photos & videos', look: 800, pause: 1500, scroll: false })
    await shot(r, 's6_upload')
    await callout(page, page.getByRole('button', { name: /Add photos & videos/ }).first(), 'Pick from your phone')
    await sleep(1400)
    return r.finish()
  },

  // 7. Create > Story, then Home
  async s7() {
    const r = await newRecorder({ name: 's7', session: sessionOf() })
    const { page } = r
    await page.goto(APP + '/')
    await sleep(2200)
    await r.start()
    await sleep(300)
    await tap(page, page.getByRole('button', { name: /Create/ }).first(), { label: 'Create', look: 700, pause: 900, scroll: false })
    await shot(r, 's7_sheet')
    await tap(page, page.getByRole('button', { name: /Add story/ }).first(), { label: 'Story', look: 700, pause: 1200, scroll: false })
    await shot(r, 's7_composer')
    await sleep(1300)
    r.pause()
    await page.goto(APP + '/')
    await sleep(2000)
    r.resume()
    await sleep(300)
    await smoothScroll(page, 330, 700)
    await sleep(1400)
    await shot(r, 's7_home')
    return r.finish()
  },

  // 8. Add to home screen
  async s8() {
    const r = await newRecorder({ name: 's8', session: sessionOf() })
    const { page } = r
    await page.goto(APP + '/install')
    await sleep(1800)
    await r.start()
    await sleep(500)
    await callout(page, page.getByText('Android (Chrome)').locator('xpath=ancestor::*[contains(@class,"rounded")][1]'), 'Add to Home screen')
    await sleep(2200)
    await shot(r, 's8_install')
    return r.finish()
  },
}

for (const name of process.argv.slice(2)) {
  console.log('scene', name)
  await SCENES[name]()
}
void readFileSync, uncall, typeSlow
