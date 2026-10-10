import { expect, test, type Page } from '@playwright/test'
import { newMember, rest, run, sql, type User } from './community-helpers'

test.describe.configure({ mode: 'serial' })

let A: User // the member editing their profile (verified)
let B: User // another verified member viewing it
let C: User // a pending (unverified) member

test.beforeAll(async ({ browser }) => {
  A = await newMember(browser, { tag: 'prof-a', name: `Asha Profile ${run.slice(-4)}`, year: '2012' })
  B = await newMember(browser, { tag: 'prof-b', year: '2014' })
  C = await newMember(browser, { tag: 'prof-c', year: '2014', verified: false })
})
test.afterAll(async () => {
  for (const u of [A, B, C]) await u?.ctx.close()
})

async function openEdit(page: Page) {
  await page.goto('/me')
  await page.getByRole('link', { name: 'Edit profile' }).click()
  await expect(page).toHaveURL(/\/me\/edit$/)
  await expect(page.getByLabel('Full name')).toBeVisible()
}

test('edit every profile field: validation, save, DB, display', async () => {
  const p = A.page
  await openEdit(p)
  await p.getByLabel('Full name').fill(`Asha  Profile ${run.slice(-4)}`)
  await p.getByLabel('Current role').fill('Senior Engineer')
  await p.getByLabel('Company / organisation').fill('Tata Steel')
  await p.getByLabel('Headline').fill('Building bridges, literally')
  await p.getByLabel('City').fill('Pune')
  await p.getByLabel('Country').fill('Germany')
  await p.getByLabel('Mobile number').fill('+91 91234 56789')
  await p.getByLabel('Joining year').selectOption('2008')
  await p.getByLabel('About').fill('Line one about me.\nLine two.')
  await p.getByRole('button', { name: 'Referrals' }).click()
  await p.getByRole('button', { name: 'Mock interviews' }).click()
  await expect(p.getByRole('button', { name: 'Referrals' })).toHaveAttribute('aria-pressed', 'true')
  await p.getByLabel('Add skills').fill('Rust, Bridges , Rust')
  await p.getByRole('button', { name: 'Add', exact: true }).first().click()
  await p.getByLabel('Add skills').fill('Concrete')
  await p.getByLabel('Add skills').press('Enter')
  await p.getByRole('button', { name: 'Remove Concrete' }).click()
  await p.getByLabel('Who can message me').selectOption('connections')
  await p.getByLabel('Birthday: day').selectOption('14')
  await p.getByLabel('Month').selectOption('3')

  // validation
  await p.getByLabel('LinkedIn profile').fill('not a link')
  await p.getByRole('button', { name: 'Save profile' }).click()
  await expect(p.getByText('Paste your profile link, e.g. linkedin.com/in/your-name')).toBeVisible()
  await p.getByLabel('LinkedIn profile').fill('linkedin.com/in/asha-profile')
  await p.getByLabel('Website').fill('asha.example.com')
  await p.getByRole('button', { name: 'Save profile' }).click()
  await expect(p.getByText('Profile saved')).toBeVisible()
  await expect(p).toHaveURL(/\/me$/)

  const row = sql(
    `select concat_ws('|', full_name, current_title, current_company, headline, city, country, join_year, about, linkedin_url, website_url,
       array_to_string(help_tags, ','), array_to_string(skills, ','), message_policy, birth_day, birth_month) from profiles where id='${A.id}'`,
  )
  expect(row).toBe(
    `Asha Profile ${run.slice(-4)}|Senior Engineer|Tata Steel|Building bridges, literally|Pune|Germany|2008|Line one about me.\nLine two.|https://www.linkedin.com/in/asha-profile|https://asha.example.com/|Referrals,Mock interviews|Rust,Bridges|connections|14|3`,
  )
  expect(sql(`select phone from profile_private where id='${A.id}'`)).toBe('+919123456789')

  // own profile shows the data
  await expect(p.getByText('Senior Engineer at Tata Steel')).toBeVisible()
  await expect(p.getByText('Pune, Germany')).toBeVisible()
  await expect(p.getByText('Line one about me.')).toBeVisible()
  await expect(p.getByText('Referrals', { exact: true })).toBeVisible()
  await expect(p.getByText('Bridges', { exact: true })).toBeVisible()

  // re-opening the editor shows saved values (no stale prefill)
  await openEdit(p)
  await expect(p.getByLabel('Who can message me')).toHaveValue('connections')
  await expect(p.getByLabel('Birthday: day')).toHaveValue('14')
  await expect(p.getByLabel('Mobile number')).toHaveValue('9123456789')
  // clearing optional fields stores NULL
  await p.getByLabel('Headline').fill('')
  await p.getByLabel('Mobile number').fill('')
  await p.getByRole('button', { name: 'Save profile' }).click()
  await expect(p).toHaveURL(/\/me$/)
  expect(sql(`select coalesce(headline,'NULL') from profiles where id='${A.id}'`)).toBe('NULL')
  expect(sql(`select coalesce(phone,'NULL') from profile_private where id='${A.id}'`)).toBe('NULL')
  expect(A.errors).toEqual([])
})

test('avatar upload: real image -> storage -> profile shows it', async () => {
  const p = A.page
  await openEdit(p)
  await p.locator('input[type=file]').setInputFiles('public/pwa-512.png')
  await expect(p.getByText('Photo updated')).toBeVisible({ timeout: 20_000 })
  const url = sql(`select avatar_url from profiles where id='${A.id}'`)
  expect(url).toMatch(new RegExp(`/storage/v1/object/public/avatars/${A.id}/avatar-\\d+\\.(webp|jpg)$`))
  const res = await fetch(url)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/image\/(webp|jpeg)/)
  const bytes = (await res.arrayBuffer()).byteLength
  expect(bytes).toBeGreaterThan(500)
  expect(sql(`select count(*) from storage.objects where bucket_id='avatars' and name like '${A.id}/avatar-%'`)).toBe('1')
  // shown on the edit page, /me and to another member
  await expect(p.locator(`img[src="${url}"]:visible`).first()).toBeVisible()
  await p.goto('/me')
  const img = p.locator(`img[src="${url}"]:visible`).first()
  await expect(img).toBeVisible()
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100)
  await B.page.goto(`/people/${A.id}`)
  await expect(B.page.locator(`img[src="${url}"]:visible`).first()).toBeVisible()
  // compressed to the avatar size (<= 480px)
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeLessThanOrEqual(480)
})

test('experience editor: add (past + current), shown in order, delete', async () => {
  const p = A.page
  await openEdit(p)
  const addBtn = p.getByRole('button', { name: 'Add', exact: true }).last()
  // empty submit is rejected
  await addBtn.click()
  await p.getByRole('button', { name: 'Add experience' }).click()
  await expect(p.getByText('Please enter both the role and the company.')).toBeVisible()
  await p.getByLabel('Role', { exact: true }).fill('Graduate Engineer')
  await p.getByLabel('Company', { exact: true }).fill('L&T')
  await p.getByLabel(/^Location/).fill('Mumbai')
  await p.getByLabel('From', { exact: true }).fill('2012-07')
  await p.locator('input[type=checkbox]').uncheck()
  await p.getByLabel('To', { exact: true }).fill('2016-03')
  await p.getByRole('button', { name: 'Add experience' }).click()
  await expect(p.getByText('Graduate Engineer')).toBeVisible()
  await addBtn.click()
  await p.getByLabel('Role', { exact: true }).fill('Senior Engineer')
  await p.getByLabel('Company', { exact: true }).fill('Tata Steel')
  await p.getByLabel('From', { exact: true }).fill('2016-04')
  await p.getByRole('button', { name: 'Add experience' }).click()
  await expect(p.getByText('Tata Steel · Current')).toBeVisible()
  expect(sql(`select string_agg(title||'@'||company||'@'||coalesce(start_date::text,'')||'@'||coalesce(end_date::text,'-')||'@'||is_current, ';' order by start_date) from experiences where profile_id='${A.id}'`)).toBe(
    'Graduate Engineer@L&T@2012-07-01@2016-03-01@false;Senior Engineer@Tata Steel@2016-04-01@-@true',
  )
  // public profile: current first, with periods
  await B.page.goto(`/people/${A.id}`)
  const items = B.page.locator('section:has(h2:text("Experience")) li')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Senior Engineer')
  await expect(items.nth(0)).toContainText('Present')
  await expect(items.nth(1)).toContainText('Graduate Engineer')
  await expect(items.nth(1)).toContainText('Mumbai')
  // delete (confirm dialog accepted)
  await p.getByRole('button', { name: 'Remove Graduate Engineer' }).click()
  await expect(p.getByText('Graduate Engineer')).toHaveCount(0)
  expect(sql(`select count(*) from experiences where profile_id='${A.id}'`)).toBe('1')
})

test('experience entries can be edited in place', async () => {
  await openEdit(A.page)
  const before = sql(`select title from experiences where profile_id='${A.id}' order by is_current desc limit 1`)
  await A.page.getByRole('button', { name: `Edit ${before}` }).click()
  await A.page.getByLabel('Role', { exact: true }).fill('Principal Engineer')
  await A.page.getByLabel(/^Description/).fill('Leads the platform team.')
  await A.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(A.page.getByText('Experience updated')).toBeVisible()
  expect(sql(`select title || '|' || coalesce(description, '') from experiences where profile_id='${A.id}' and title = 'Principal Engineer'`)).toBe('Principal Engineer|Leads the platform team.')
  expect(sql(`select count(*) from experiences where profile_id='${A.id}'`)).toBe('1') // edited, not duplicated
})

test('privacy: phone/email never reach other members; pending members see nothing', async () => {
  sql(`update profile_private set phone='+91 90000 11111' where id='${A.id}'`)
  const email = A.email
  await B.page.goto(`/people/${A.id}`)
  await expect(B.page.getByRole('heading', { name: A.name.replace(/\s+/g, ' ') }).first()).toBeVisible()
  const html = await B.page.content()
  expect(html).not.toContain('90000 11111')
  expect(html).not.toContain(email)
  expect((await rest(B.page, `/rest/v1/profile_private?id=eq.${A.id}`)).body).toEqual([])
  const prof = (await rest(B.page, `/rest/v1/profiles?id=eq.${A.id}&select=*`)).body as Record<string, unknown>[]
  expect(prof).toHaveLength(1)
  expect(Object.keys(prof[0]!)).not.toContain('email')
  expect(Object.keys(prof[0]!)).not.toContain('phone')
  // LinkedIn link for others
  await expect(B.page.getByRole('link', { name: 'View on LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/asha-profile')
  // pending member: no profile, no rows
  await C.page.goto(`/people/${A.id}`)
  await expect(C.page.getByText('Profile not available')).toBeVisible()
  expect((await rest(C.page, `/rest/v1/profiles?id=eq.${A.id}`)).body).toEqual([])
  expect((await rest(C.page, `/rest/v1/experiences?profile_id=eq.${A.id}`)).body).toEqual([])
  // members cannot promote themselves
  const self = await rest(C.page, `/rest/v1/profiles?id=eq.${C.id}`, { method: 'PATCH', body: JSON.stringify({ verification: 'verified' }) })
  expect(self.status).toBeGreaterThanOrEqual(400)
  expect(sql(`select verification from profiles where id='${C.id}'`)).toBe('pending')
})

test('the website saved on the profile is never shown to anyone', async () => {
  await B.page.goto(`/people/${A.id}`)
  await expect(B.page.locator('a[href="https://asha.example.com/"]')).toBeVisible({ timeout: 3000 })
})

test('website validation accepts junk like "not a website"', async () => {
  await openEdit(A.page)
  await A.page.getByLabel('Website').fill('not a website')
  await A.page.getByRole('button', { name: 'Save profile' }).click()
  await expect(A.page.getByText('Please enter a valid web address.')).toBeVisible({ timeout: 3000 })
})

test('impossible birthdays (31 Feb) are accepted and then silently never shown', async () => {
  await openEdit(A.page)
  await A.page.getByLabel('Birthday: day').selectOption('31')
  await A.page.getByLabel('Month').selectOption('2')
  await A.page.getByRole('button', { name: 'Save profile' }).click()
  await A.page.waitForTimeout(1500)
  expect(sql(`select birth_day||'/'||birth_month from profiles where id='${A.id}'`)).not.toBe('31/2')
})

test('no self-service data export on the profile', async () => {
  await A.page.goto('/me')
  await expect(A.page.getByRole('button', { name: /download|export/i }).or(A.page.getByRole('link', { name: /download my data|export my data/i }))).toBeVisible({ timeout: 3000 })
})
