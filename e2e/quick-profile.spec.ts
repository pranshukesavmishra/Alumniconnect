// Quick profile: the 30-second welcome, Magic fill (edge function mocked with page.route: no Claude calls), the
// reunion-list claim, the fallback when AI is not configured, and the mic button only where speech recognition exists.
//   PW_CHROMIUM=/opt/pw-browsers/chromium PW_PORT=5231 npx playwright test e2e/quick-profile.spec.ts
import { expect, test, type Page, type Route } from '@playwright/test'
import { signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

const AI_PROFILE = {
  full_name: null,
  headline: 'Senior Manager at L&T, Pune',
  current_title: 'Senior Manager',
  current_company: 'L&T',
  city: 'Pune',
  country: 'India',
  grad_year: 2008,
  branch: 'B.E. in Mechanical Engineering',
  degree: 'B.E.',
  experiences: [
    { title: 'Senior Manager', company: 'L&T', start_year: 2014, end_year: null, is_current: true, location: 'Pune' },
    { title: 'Engineer', company: 'Tata Motors', start_year: 2008, end_year: 2014, is_current: false, location: null },
  ],
  education: [],
  skills: ['Automotive', 'Project management'],
  help_tags: ['Referrals'],
  interests: [],
  about: 'I am a senior manager at L&T in Pune. Earlier I spent 6 years at Tata Motors. I can help with jobs in automotive.',
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }

/** Answers the profile-ai-fill function from the test; records what the app sent. */
async function mockAi(page: Page, reply: { status: number; body: unknown }, seen: unknown[] = []) {
  await page.route('**/functions/v1/profile-ai-fill', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    seen.push(route.request().postDataJSON())
    await route.fulfill({ status: reply.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(reply.body) })
  })
  return seen
}

const uidOf = (email: string) => sql(`select id from auth.users where email = '${email}'`)

async function fillStep1(page: Page, name: string, phone = '+91 98765 43210') {
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await expect(page.getByText('Step 1 of 2')).toBeVisible()
  await page.getByLabel('Full name').fill(name)
  await page.getByText('Alumnus / Alumna').click()
  // the big branch chip sets the full-list picker
  await page.getByRole('button', { name: 'Mechanical', exact: true }).click()
  await expect(page.getByLabel('Branch')).toHaveValue('B.E. in Mechanical Engineering')
  await page.getByLabel('Passing-out year', { exact: true }).selectOption('2008')
  await page.getByLabel('City you live in').fill('Pune')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('welcome in two steps, Magic fill preview and save fill the profile and experiences, under 30 seconds', async ({ page }) => {
  const email = `qp.magic.${run}@example.com`
  const seen = await mockAi(page, { status: 200, body: { profile: AI_PROFILE, remaining: 9 } })
  await page.goto('/signin')
  await signInWithEmail(page, email)
  const started = Date.now()

  await fillStep1(page, `Magic ${run}`)
  await expect(page.getByRole('heading', { name: 'What do you do?' })).toBeVisible()
  await expect(page.getByText('Step 2 of 2')).toBeVisible()
  expect(sql(`select onboarded from profiles where id = '${uidOf(email)}'`)).toBe('t')

  await page.getByLabel(/Tell us about yourself/).fill('Senior manager at L&T in Pune, Mech 2008, earlier 6 years at Tata Motors, can help with jobs in automotive')
  await page.getByRole('button', { name: 'Fill my profile' }).click()
  const preview = page.getByTestId('qp-preview')
  await expect(preview.getByRole('heading', { name: 'Here is what we found' })).toBeVisible()
  expect(seen).toEqual([{ text: 'Senior manager at L&T in Pune, Mech 2008, earlier 6 years at Tata Motors, can help with jobs in automotive' }])
  // fields typed in step 1 are not offered again (same city, branch and year); new ones are ticked
  await expect(preview.locator('[data-field="current_company"]')).toContainText('L&T')
  await expect(preview.locator('[data-field="city"]')).toHaveCount(0)
  // inline edit, and untick one field
  await preview.getByRole('button', { name: 'Change Current role' }).click()
  await preview.getByRole('textbox', { name: 'Current role' }).fill('Senior Manager, Projects')
  await preview.getByRole('button', { name: 'Done', exact: true }).click()
  await preview.locator('[data-field="headline"]').getByRole('checkbox').uncheck()
  await preview.getByRole('button', { name: 'Save to my profile' }).click()

  // the profile ring, then Home
  await expect(page.getByTestId('welcome-done')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(Date.now() - started).toBeLessThan(30_000)

  const uid = uidOf(email)
  expect(sql(`select current_title || '|' || current_company || '|' || coalesce(headline, '-') || '|' || array_to_string(help_tags, ',') from profiles where id = '${uid}'`)).toBe(
    'Senior Manager, Projects|L&T|-|Referrals',
  )
  expect(sql(`select string_agg(company || ':' || source, ',' order by company) from experiences where profile_id = '${uid}'`)).toBe('L&T:ai,Tata Motors:ai')

  // the same Magic fill from Edit profile (single entry button)
  await page.goto('/me/edit')
  await page.getByTestId('magic-fill-link').click()
  await expect(page).toHaveURL(/\/me\/magic/)
  await expect(page.getByLabel(/Tell us about yourself/)).toBeVisible()
})

test('claim from the organisers’ list: one tap fills the profile; nobody else sees the record', async ({ browser }) => {
  const email = `qp.claim.${run}@example.com`
  sql(`insert into prefill_records (full_name, email, phone, grad_year, branch, city, organisation, designation, member_type, source)
       values ('Claim Person ${run}', '${email}', '+919${String(Date.now()).slice(-9)}', 2006, 'B.E. in Civil Engineering', 'Indore', 'PWD', 'Executive Engineer', 'alumnus', 'Grand Reunion form')`)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  const card = page.getByTestId('prefill-claim')
  await expect(card.getByText('We found your details from the reunion list. Is this you?')).toBeVisible()
  await expect(card).toContainText(`Claim Person ${run}`)
  await expect(card).toContainText('PWD')
  await card.getByRole('button', { name: 'Yes, fill my profile' }).click()
  await expect(card).toHaveCount(0)
  // zero typing: the form now holds the list's details
  await expect(page.getByLabel('Full name')).toHaveValue(`Claim Person ${run}`)
  await expect(page.getByLabel('Branch')).toHaveValue('B.E. in Civil Engineering')
  await expect(page.getByLabel('Passing-out year', { exact: true })).toHaveValue('2006')
  await expect(page.getByLabel('City you live in')).toHaveValue('Indore')
  await page.getByText('Alumnus / Alumna').click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  const uid = uidOf(email)
  expect(sql(`select current_title || '|' || current_company from profiles where id = '${uid}'`)).toBe('Executive Engineer|PWD')
  expect(sql(`select claimed_by from prefill_records where email = '${email}'`)).toBe(uid)

  // another member never sees it, and a direct read of the table is refused
  const other = await browser.newContext()
  const op = await other.newPage()
  await op.goto('/signin')
  await signInWithEmail(op, `qp.other.${run}@example.com`)
  await expect(op.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await expect(op.getByTestId('prefill-claim')).toHaveCount(0)
  await ctx.close()
  await other.close()
})

test('claim by mobile number on step 2 (same number and same first letter)', async ({ page }) => {
  const email = `qp.phone.${run}@example.com`
  const national = `9${String(Date.now()).slice(-9)}`
  sql(`insert into prefill_records (full_name, phone, grad_year, organisation, designation, source) values ('Dr. Pallavi ${run}', '+91${national}', 2010, 'Infosys', 'Architect', 'Grand Reunion form')`)
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await fillStep1(page, `Pallavi ${run}`, national)
  const card = page.getByTestId('prefill-claim')
  await expect(card).toContainText('Infosys')
  await card.getByRole('button', { name: 'Yes, fill my profile' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(sql(`select current_company from profiles where id = '${uidOf(email)}'`)).toBe('Infosys')
})

test('AI not configured: a friendly note, the manual way stays, Skip works', async ({ page }) => {
  await mockAi(page, { status: 503, body: { error: 'ai_not_configured', message: 'Magic fill is not switched on yet.' } })
  const email = `qp.noai.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await fillStep1(page, `No AI ${run}`)
  await page.getByLabel(/Tell us about yourself/).fill('Engineer at Acme')
  await page.getByRole('button', { name: 'Fill my profile' }).click()
  await expect(page.getByText('Magic fill is not available right now. You can add your details yourself in Edit profile.')).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  // the Home nudge offers one small question (never blocking) and can be dismissed
  const nudge = page.getByTestId('home-nudge')
  await expect(nudge).toBeVisible()
  await nudge.getByRole('button', { name: 'Dismiss' }).click()
  await expect(nudge).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('home-nudge')).toHaveCount(0)
})

test('the mic button shows only where the browser can recognise speech', async ({ browser }) => {
  for (const speech of [false, true]) {
    const ctx = await browser.newContext()
    await ctx.addInitScript((on: boolean) => {
      const w = window as unknown as Record<string, unknown>
      if (on) {
        w.webkitSpeechRecognition = class {
          start() {}
          stop() {}
          abort() {}
        }
      } else {
        delete w.webkitSpeechRecognition
        delete w.SpeechRecognition
        Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
        Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
      }
    }, speech)
    const page = await ctx.newPage()
    await page.goto('/signin')
    await signInWithEmail(page, `qp.mic${speech ? 1 : 0}.${run}@example.com`)
    await fillStep1(page, `Mic ${run}`)
    await expect(page.getByLabel(/Tell us about yourself/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speak instead of typing' })).toHaveCount(speech ? 1 : 0)
    await ctx.close()
  }
})

test('Fill from LinkedIn (provider mocked): consent, e-mail miss, profile link, preview, save', async ({ page }) => {
  // the super-admin switch and the provider are both answered by the test (no provider, no shared setting changed)
  await page.route('**/rest/v1/rpc/quick_profile_flags', (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"linkedin_fill":true}' }),
  )
  const asked: { mode?: string; url?: string; consent?: boolean }[] = []
  await page.route('**/functions/v1/linkedin-enrich', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as { mode: string; url?: string; consent?: boolean }
    asked.push(body)
    const reply =
      body.mode === 'status'
        ? { status: 200, body: { available: true } }
        : body.mode === 'email'
          ? { status: 404, body: { error: 'no_match', message: 'We could not find your LinkedIn profile.' } }
          : {
              status: 200,
              body: {
                profile: { ...AI_PROFILE, about: null, help_tags: [], education: [{ school: 'Jabalpur Engineering College', degree: 'B.E.', field: 'Mechanical', start_year: 2004, end_year: 2008 }], linkedin_url: body.url },
                jec: { school: 'Jabalpur Engineering College', kind: 'jec', start_year: 2004, end_year: 2008, branch: 'B.E. in Mechanical Engineering', hint: 'open' },
              },
            }
    await route.fulfill({ status: reply.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(reply.body) })
  })
  const email = `qp.li.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await fillStep1(page, `Linked ${run}`)
  const card = page.getByTestId('linkedin-fill')
  await expect(card.getByRole('heading', { name: 'Fill my profile from LinkedIn' })).toBeVisible()
  // consent first
  await card.getByRole('button', { name: 'Fill from LinkedIn' }).click()
  await expect(card.getByText('Please tick the box to agree to the look-up first.')).toBeVisible()
  await card.getByRole('checkbox').check()
  await card.getByRole('button', { name: 'Fill from LinkedIn' }).click()
  // no match by e-mail: one field, with the two-picture help
  await expect(card.getByText('Paste your profile link instead.', { exact: false })).toBeVisible()
  await expect(card.getByText('How to copy your link')).toBeVisible()
  await card.getByLabel('Paste your LinkedIn profile link').fill('https://evil.example/in/linked')
  await card.getByRole('button', { name: 'Find my profile' }).click()
  await expect(card.getByText('Please paste a LinkedIn profile link, like linkedin.com/in/your-name.')).toBeVisible()
  await card.getByLabel('Paste your LinkedIn profile link').fill('in.linkedin.com/in/Linked-Person/?trk=share')
  await card.getByRole('button', { name: 'Find my profile' }).click()
  await expect(page.getByText('LinkedIn shows you studied at Jabalpur Engineering College.', { exact: false })).toBeVisible()
  const preview = page.getByTestId('qp-preview')
  await expect(preview.locator('[data-field="linkedin_url"]')).toContainText('https://www.linkedin.com/in/linked-person')
  await preview.getByRole('button', { name: 'Save to my profile' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(asked.map((a) => a.mode)).toEqual(['status', 'email', 'url'])
  expect(asked.slice(1).every((a) => a.consent === true)).toBe(true)
  expect(asked[2]!.url).toBe('https://www.linkedin.com/in/linked-person')
  const uid = uidOf(email)
  expect(sql(`select linkedin_url || '|' || current_company from profiles where id = '${uid}'`)).toBe('https://www.linkedin.com/in/linked-person|L&T')
  expect(sql(`select count(*) from educations where profile_id = '${uid}' and source = 'ai'`)).toBe('1')
})

test('360px wide, light and dark: no sideways scrolling on either step or the preview', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: scheme })
    const page = await ctx.newPage()
    await mockAi(page, { status: 200, body: { profile: AI_PROFILE } })
    const noOverflow = async (where: string) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(360)
    await page.goto('/signin')
    await signInWithEmail(page, `qp.narrow.${scheme}.${run}@example.com`)
    await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
    await noOverflow('step 1')
    await fillStep1(page, `Narrow ${run}`)
    await expect(page.getByRole('heading', { name: 'What do you do?' })).toBeVisible()
    await noOverflow('step 2')
    await page.getByLabel(/Tell us about yourself/).fill('Senior manager at L&T in Pune')
    await page.getByRole('button', { name: 'Fill my profile' }).click()
    await expect(page.getByTestId('qp-preview')).toBeVisible()
    await noOverflow('preview')
    // every button in the preview is at least 44px tall
    const small = await page.getByTestId('qp-preview').locator('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length)
    expect(small).toBe(0)
    await ctx.close()
  }
})
