// Paste your profile: welcome step 2 -> paste LinkedIn text -> preview -> save; on-device reading with no AI, the AI path with
// silent fallback, the clipboard button, Suggest my profile, batch invite prefill, and 360px width.
// The profile-ai-fill function is mocked with page.route: no Google or Claude calls.
//   PW_CHROMIUM=/opt/pw-browsers/chromium PW_PORT=5232 npx playwright test e2e/paste-profile.spec.ts
import { expect, test, type Page, type Route } from '@playwright/test'
import { FIXTURES } from '../src/features/quickprofile/pasteFixtures'
import { signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const ASHA = FIXTURES[0]!.text
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }

const AI_PROFILE = {
  full_name: null, headline: 'Lead Data Engineer at Wipro', current_title: 'Lead Data Engineer', current_company: 'Wipro', city: 'Pune', country: 'India', grad_year: 2016,
  branch: 'B.E. in Computer Science & Engineering', degree: 'B.E.',
  experiences: [{ title: 'Lead Data Engineer', company: 'Wipro', start_year: 2020, end_year: null, is_current: true, location: 'Pune' }],
  education: [{ school: 'Jabalpur Engineering College', degree: 'Bachelor of Engineering - BE', field: 'Computer Science', start_year: 2012, end_year: 2016 }],
  skills: ['Spark'], help_tags: [], interests: [], about: null,
}

interface Mode {
  status: { available: boolean; provider?: string; suggest?: boolean }
  text?: { status: number; body: unknown }
  suggest?: { status: number; body: unknown }
}
/** Answers the profile-ai-fill function; records the requests that are not status checks. */
async function mockFn(page: Page, mode: Mode, seen: unknown[] = []) {
  await page.route('**/functions/v1/profile-ai-fill', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().postDataJSON() as { status?: boolean; suggest?: boolean; text?: string }
    const reply = body.status ? { status: 200, body: mode.status } : body.suggest ? mode.suggest ?? { status: 503, body: { error: 'ai_not_configured' } } : mode.text ?? { status: 503, body: { error: 'ai_not_configured' } }
    if (!body.status) seen.push(body)
    await route.fulfill({ status: reply.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(reply.body) })
  })
  return seen
}

let phoneN = Number(Date.now().toString().slice(-7))
/** A different valid mobile number each time (numbers are unique per member). */
const phone = () => `+91 98${String(++phoneN).padStart(8, '0')}`

const uidOf = (email: string) => sql(`select id from auth.users where email = '${email}'`)

async function step1(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await page.getByLabel('Full name').fill(name)
  await page.getByText('Alumnus / Alumna').click()
  await page.getByRole('button', { name: 'Computer Science' }).first().click().catch(() => undefined)
  await page.getByLabel('Branch').selectOption('B.E. in Computer Science & Engineering')
  await page.getByLabel('Passing-out year', { exact: true }).selectOption('2016')
  await page.getByLabel('City you live in').fill('Pune')
  await page.getByLabel('Mobile number').fill(phone())
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'What do you do?' })).toBeVisible()
}

test('no AI configured: paste on step 2, read on the device, preview, save fills profile, experiences, education and an admin hint', async ({ page }) => {
  const email = `paste.dev.${run}@example.com`
  const seen = await mockFn(page, { status: { available: false } })
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await step1(page, `Asha Paste ${run}`)

  await expect(page.getByTestId('suggest-box')).toHaveCount(0)
  await expect(page.getByTestId('magic-fill')).toHaveCount(0)
  const box = page.getByLabel('Open your LinkedIn profile, select all, copy, paste here')
  await expect(box).toBeVisible()
  await expect(page.getByText('Your text is read on your device. It is not sent or stored anywhere.')).toBeVisible()
  await box.fill(ASHA)
  await expect(page.getByTestId('paste-count')).toContainText(`${ASHA.length.toLocaleString('en-IN')} / 20,000`)
  await page.getByRole('button', { name: 'Read my profile' }).click()

  const preview = page.getByTestId('qp-preview')
  await expect(preview.getByRole('heading', { name: 'Here is what we found' })).toBeVisible()
  await expect(preview.locator('[data-field="experiences"]')).toContainText('Senior Software Engineer')
  await expect(preview.locator('[data-field="experiences"]')).toContainText('Tech Mahindra')
  await expect(preview.locator('[data-field="education"]')).toContainText('Jabalpur Engineering College')
  await expect(preview.locator('[data-field="current_company"]')).toContainText('Infosys')
  await preview.getByRole('button', { name: 'Save to my profile' }).click()
  await expect(page.getByTestId('welcome-done')).toBeVisible()

  expect(seen).toEqual([]) // nothing was sent anywhere
  const uid = uidOf(email)
  expect(sql(`select current_title || '|' || current_company from profiles where id = '${uid}'`)).toBe('Senior Software Engineer|Infosys')
  expect(sql(`select string_agg(company || ':' || source, ',' order by company) from experiences where profile_id = '${uid}'`)).toBe('Infosys:ai,Tech Mahindra:ai')
  expect(sql(`select count(*) from educations where profile_id = '${uid}' and school = 'Jabalpur Engineering College'`)).toBe('1')
  expect(sql(`select source || ':' || end_year from verification_hints where user_id = '${uid}'`)).toBe('paste:2016')
})

test('AI available: the pasted text goes to the function; a failure falls back to the on-device reading without an error', async ({ page }) => {
  const email = `paste.ai.${run}@example.com`
  const seen = await mockFn(page, { status: { available: true, provider: 'gemini' }, text: { status: 200, body: { profile: AI_PROFILE, remaining: 9 } } })
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await step1(page, `Ai Paste ${run}`)
  await expect(page.getByText('Google’s free AI reads this text; nothing is stored by us.')).toBeVisible()
  await page.getByLabel('Open your LinkedIn profile, select all, copy, paste here').fill(ASHA)
  await page.getByRole('button', { name: 'Read my profile' }).click()
  const preview = page.getByTestId('qp-preview')
  await expect(preview.locator('[data-field="experiences"]')).toContainText('Wipro')
  expect(seen).toHaveLength(1)
  expect((seen[0] as { text: string }).text).toBe(ASHA.trim())

  // now the function fails: same text, on-device reading, no error shown
  await preview.getByRole('button', { name: 'Start over' }).click()
  await page.unroute('**/functions/v1/profile-ai-fill')
  await mockFn(page, { status: { available: true, provider: 'gemini' }, text: { status: 503, body: { error: 'ai_busy', message: 'busy' } } })
  await page.getByLabel('Open your LinkedIn profile, select all, copy, paste here').fill(ASHA)
  await page.getByRole('button', { name: 'Read my profile' }).click()
  await expect(page.getByTestId('qp-preview').locator('[data-field="experiences"]')).toContainText('Tech Mahindra')
  await expect(page.getByText('busy')).toHaveCount(0)
})

test('Paste from clipboard button fills the box; junk text gives a kind message', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await mockFn(page, { status: { available: false } })
  await page.goto('/signin')
  await signInWithEmail(page, `paste.clip.${run}@example.com`)
  await step1(page, `Clip ${run}`)
  await page.evaluate((t) => navigator.clipboard.writeText(t), ASHA)
  await page.getByRole('button', { name: 'Paste from clipboard' }).click()
  await expect(page.getByLabel('Open your LinkedIn profile, select all, copy, paste here')).toHaveValue(ASHA)
  await page.getByLabel('Open your LinkedIn profile, select all, copy, paste here').fill('hello there, this is not a profile')
  await page.getByRole('button', { name: 'Read my profile' }).click()
  await expect(page.getByText(/could not find your details in that text/)).toBeVisible()
  await ctx.close()
})

test('Suggest my profile: shown only when on; yes opens the preview, not me is remembered', async ({ page }) => {
  const email = `paste.sg.${run}@example.com`
  await mockFn(page, {
    status: { available: true, provider: 'gemini', suggest: true },
    suggest: { status: 200, body: { found: true, profile: AI_PROFILE, sources: [{ title: 'wipro.com' }, { title: 'jec.example.org' }] } },
  })
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await step1(page, `Suggest ${run}`)
  await expect(page.getByText('We search public web pages for your name and Jabalpur Engineering College. Nothing is saved until you confirm.')).toBeVisible()
  await page.getByRole('button', { name: 'Suggest my profile' }).click()
  const card = page.getByTestId('suggest-card')
  await expect(card.getByText('Suggested from public information — check it’s you')).toBeVisible()
  await expect(card).toContainText('Lead Data Engineer at Wipro')
  await expect(card).toContainText('wipro.com, jec.example.org')
  expect(sql(`select count(*) from experiences where profile_id = '${uidOf(email)}'`)).toBe('0') // nothing saved yet
  await card.getByRole('button', { name: 'Yes, this is me' }).click()
  const preview = page.getByTestId('qp-preview')
  await expect(preview.locator('[data-field="experiences"]')).toContainText('Wipro')
  await preview.getByRole('button', { name: 'Save to my profile' }).click()
  await expect(page.getByTestId('welcome-done')).toBeVisible()
  expect(sql(`select count(*) from experiences where profile_id = '${uidOf(email)}' and company = 'Wipro'`)).toBe('1')
  expect(sql(`select source from verification_hints where user_id = '${uidOf(email)}'`)).toBe('ai_suggest')

  // "Not me" is remembered
  await page.goto('/me/magic')
  await page.getByRole('button', { name: 'Suggest my profile' }).click()
  await page.getByTestId('suggest-card').getByRole('button', { name: 'Not me' }).click()
  await expect(page.getByTestId('suggest-card')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('paste-profile')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suggest my profile' })).toHaveCount(0)
})

test('Suggest my profile: nothing found is said kindly and the paste box stays', async ({ page }) => {
  await mockFn(page, { status: { available: true, provider: 'gemini', suggest: true }, suggest: { status: 200, body: { found: false, profile: null, sources: [] } } })
  await page.goto('/signin')
  await signInWithEmail(page, `paste.sg0.${run}@example.com`)
  await step1(page, `Nobody ${run}`)
  await page.getByRole('button', { name: 'Suggest my profile' }).click()
  await expect(page.getByText(/could not find anything reliable about you online/)).toBeVisible()
  await expect(page.getByTestId('paste-box')).toBeVisible()
})

test('a batch invite link prefills the batch on the welcome page; Home offers the invite message', async ({ page }) => {
  await mockFn(page, { status: { available: false } })
  await page.goto('/?batch=1993')
  await page.goto('/signin')
  await signInWithEmail(page, `paste.batch.${run}@example.com`)
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await expect(page.getByLabel('Passing-out year', { exact: true })).toHaveValue('1993')
  await page.getByLabel('Full name').fill(`Batch ${run}`)
  await page.getByText('Alumnus / Alumna').click()
  await page.getByLabel('Branch').selectOption('B.E. in Mechanical Engineering')
  await page.getByLabel('City you live in').fill('Bhopal')
  await page.getByLabel('Mobile number').fill(phone())
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  const wa = page.getByTestId('invite-whatsapp')
  await expect(wa).toBeVisible()
  const href = (await wa.getAttribute('href')) ?? ''
  expect(href.startsWith('https://wa.me/?text=')).toBe(true)
  const text = decodeURIComponent(href.split('text=')[1]!)
  expect(text).toContain('Batch 1993 JECians')
  expect(text).toContain('Grand Reunion 26–27 Dec 2026')
  expect(text).toContain('/?batch=1993')
})

test('360px: the import page leads with the paste box, nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await mockFn(page, { status: { available: true, provider: 'gemini', suggest: true } })
  await page.goto('/signin')
  await signInWithEmail(page, `paste.w.${run}@example.com`)
  await step1(page, `Narrow ${run}`)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.goto('/me/import')
  await expect(page.getByTestId('paste-profile')).toBeVisible()
  const order = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="paste-profile"]')!.getBoundingClientRect().top
    const other = [...document.querySelectorAll('h2')].find((h) => /Other ways to import/.test(h.textContent ?? ''))!.getBoundingClientRect().top
    return other > p
  })
  expect(order).toBe(true)
  await page.getByText('How do I copy my profile?').click()
  await expect(page.getByText('Press and hold on any text, tap Select all, then Copy.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  for (const name of ['Read my profile', 'Suggest my profile']) {
    const b = (await page.getByRole('button', { name }).first().boundingBox())!
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
})
