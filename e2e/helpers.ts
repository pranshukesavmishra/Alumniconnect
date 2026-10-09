import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function sql(query: string): string {
  return execFileSync('psql', [DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim()
}

/** Reads the newest 6-digit sign-in code sent to this address from the local mail catcher. */
export async function latestCode(email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const list = (await res.json()) as { messages: { ID: string; Created: string }[] }
    const fresh = list.messages.find((m) => new Date(m.Created).getTime() >= after - 2000)
    if (fresh) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { Text: string; HTML: string }
      const code = (msg.Text || msg.HTML).match(/\b(\d{6})\b/)?.[1]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No sign-in code for ${email}`)
}

export async function signInWithEmail(page: Page, email: string) {
  await page.getByRole('button', { name: 'Use my email instead' }).click()
  await page.getByLabel('Email address').fill(email)
  const sentAt = Date.now()
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.getByLabel('6-digit code').fill(await latestCode(email, sentAt))
}

export async function onboard(page: Page, name: string, year: string) {
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await page.getByLabel('Full name').fill(name)
  await page.getByText('Alumnus / Alumna').click()
  await page.getByLabel('Branch').selectOption('B.E. in Computer Science & Engineering')
  await page.getByLabel('Passing-out year', { exact: true }).selectOption(year)
  await page.getByLabel('City you live in').fill('Pune')
  await page.getByLabel('Mobile number').fill('+91 98765 43210')
  await page.getByRole('button', { name: 'Continue' }).click()
}

/** A fresh, approved circle (with its group chat) holding exactly these members: keeps chat tests isolated from each other. */
export function makeCircle(tag: string, emails: string[]): string {
  const slug = `e2e-${tag}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 70)
  const gid = sql(`insert into groups (kind, slug, name, is_approved) values ('circle', '${slug}', 'Circle ${tag}', true) returning id`).split('\n')[0]!
  sql(`insert into group_members (group_id, user_id) select '${gid}', id from auth.users where email in (${emails.map((e) => `'${e}'`).join(',')})`)
  return sql(`select id from chats where group_id = '${gid}'`)
}

/**
 * Drives the five-step reunion registration from step 1 with the fewest answers: completes missing profile details
 * inline, picks both days (+ optional family adults), answers every required question with "No" and confirms.
 * Works for a member who just finished onboarding (no designation or company yet).
 */
export async function registerForReunion(page: Page, opts: { adults?: number; adultName?: string; days?: RegExp; shots?: string; size?: string; photoConsent?: boolean } = {}) {
  const cont = () => page.getByRole('button', { name: 'Continue', exact: true }).click()
  const shot = (n: string) => (opts.shots ? page.screenshot({ path: `${opts.shots}-${n}.png`, fullPage: true }) : Promise.resolve())
  await expect(page.getByRole('heading', { name: 'Your details (from your profile)' })).toBeVisible()
  if (await page.getByLabel('Current designation').isVisible()) {
    await page.getByLabel('Current designation').fill('Engineer')
    await page.getByLabel('Company', { exact: true }).fill('Acme')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.getByText('Saved to your profile')).toBeVisible()
  }
  await shot('1-details')
  await cont()
  await page.getByText(opts.days ?? /Both days/).first().click()
  for (let i = 1; i <= (opts.adults ?? 0); i++) {
    await page.getByRole('button', { name: 'More: Family adult · 27 Dec' }).click()
    await page.getByLabel(`Family adult · 27 Dec ${i} name`).fill(opts.adultName ?? `Guest ${i}`)
  }
  await page.locator('label').filter({ hasText: /^Vegetarian$/ }).click()
  await page.getByLabel('Your T-shirt size').selectOption(opts.size ?? 'L')
  for (const q of ['Do you need help with accommodation?', 'Do you need help with local travel or pickup?']) {
    await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
  }
  await shot('2-days')
  await cont()
  for (const q of ['Would you like to be part of the organising teams?', 'Would you like to perform at the reunion?', 'Would you like to contribute to the Reunion Fund?', 'Would you or your organisation like to sponsor the event?']) {
    await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
  }
  await shot('3-involved')
  await cont()
  await shot('4-memorable')
  await cont()
  if (opts.photoConsent === false) await page.getByRole('checkbox', { name: /Photos and videos of me/ }).uncheck()
  await page.getByRole('checkbox', { name: /My details are correct/ }).check()
  await shot('5-review')
  await page.getByRole('button', { name: /Confirm and pay|Confirm registration/ }).click()
}
