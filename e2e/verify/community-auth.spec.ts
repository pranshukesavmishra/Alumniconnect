import { expect, test } from '@playwright/test'
import { latestCode } from '../helpers'
import { collectErrors, email, newContext, newMember, sql } from './community-helpers'

test.describe.configure({ mode: 'serial' })

test('email code sign-in from a protected page, onboarding validation, next redirect, DB rows', async ({ browser }) => {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  const errors: string[] = []
  collectErrors(page, errors)
  const mail = email('auth')

  // protected route -> sign-in with next
  await page.goto('/people?q=abc')
  await expect(page).toHaveURL(/\/signin\?next=%2Fpeople%3Fq%3Dabc/)

  // invalid email is rejected client side
  await page.getByRole('button', { name: 'Use my email instead' }).click()
  await page.getByLabel('Email address').fill('not-an-email')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Please enter a valid email address.')).toBeVisible()

  // send code, then a wrong code is rejected
  await page.getByLabel('Email address').fill(mail.toUpperCase()) // normalised to lower case
  const sentAt = Date.now()
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await expect(page.getByText(mail)).toBeVisible()
  const code = await latestCode(mail, sentAt)
  const wrong = code === '000000' ? '111111' : '000000'
  await page.getByLabel('6-digit code').fill(wrong)
  await expect(page.getByText(/That code is wrong or has expired/)).toBeVisible()
  // resend is throttled in the UI
  await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled()
  await page.getByLabel('6-digit code').fill(code)

  // not onboarded -> welcome, keeping the destination
  await expect(page).toHaveURL(/\/welcome\?next=%2Fpeople%3Fq%3Dabc/)
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()

  // validation: everything empty
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Please enter your full name.')).toBeVisible()
  await expect(page.getByText('Please choose one.')).toBeVisible()
  await expect(page.getByText('Please choose your branch.')).toBeVisible()
  await expect(page.getByText('Please choose your passing-out year.')).toBeVisible()
  await expect(page.getByText('Please enter the city you live in.')).toBeVisible()
  await expect(page.getByText(/Please enter a valid mobile number/)).toBeVisible()
  expect(sql(`select onboarded from profiles where id = (select id from auth.users where email = '${mail}')`)).toBe('f')

  // faculty hides branch/year and does not require them
  await page.getByText('Faculty or staff').click()
  await expect(page.getByLabel('Branch')).toHaveCount(0)
  await page.getByText('Alumnus / Alumna').click()

  // bad phone
  await page.getByLabel('Full name').fill('  Auth   Tester  ')
  await page.getByLabel('Branch').selectOption('B.E. in Mechanical Engineering')
  await page.getByLabel('Passing-out year', { exact: true }).selectOption('2009')
  await page.getByLabel('Joining year').selectOption('2005')
  await page.getByLabel('City you live in').fill('Indore')
  await page.getByLabel('Mobile number').fill('12345')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/Please enter a valid mobile number/)).toBeVisible()
  await page.getByLabel('Mobile number').fill('+91 99887 76655')
  await page.getByRole('button', { name: 'Continue' }).click()

  // lands on the original destination (pending members see the directory gate)
  await expect(page).toHaveURL(/\/people\?q=abc$/)
  await expect(page.getByText('The directory is for verified members')).toBeVisible()

  const uid = sql(`select id from auth.users where email = '${mail}'`)
  expect(sql(`select full_name||'|'||member_type||'|'||branch||'|'||grad_year||'|'||join_year||'|'||city||'|'||onboarded||'|'||verification from profiles where id='${uid}'`)).toBe(
    'Auth Tester|alumnus|B.E. in Mechanical Engineering|2009|2005|Indore|true|pending',
  )
  expect(sql(`select phone from profile_private where id='${uid}'`)).toBe('+91 99887 76655')
  // auto batch + year groups
  expect(sql(`select string_agg(g.slug, ',' order by g.slug) from group_members m join groups g on g.id=m.group_id where m.user_id='${uid}'`)).toBe(
    'b-e-in-mechanical-engineering-2009,jec-2009',
  )

  // session persists across reload and a new tab
  await page.reload()
  await expect(page.getByText('The directory is for verified members')).toBeVisible()
  const tab2 = await ctx.newPage()
  await tab2.goto('/me')
  await expect(tab2.getByRole('heading', { name: 'Auth Tester' })).toBeVisible()
  await tab2.close()

  // /welcome after onboarding goes straight on
  await page.goto('/welcome?next=/me')
  await expect(page).toHaveURL(/\/me$/)

  // sign out
  await page.getByRole('button', { name: 'Sign out' }).click()
  // KNOWN (low): ProfilePage calls navigate('/') after signOut(), but RequireMember on /me redirects first,
  // so the member lands on /signin?next=%2Fme instead of the landing page. Signed out either way.
  await expect(page.getByRole('heading', { name: 'Welcome, JECian' })).toBeVisible()
  test.info().annotations.push({ type: 'after-sign-out-url', description: page.url() })
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('auth-token')))
  expect(keys).toEqual([])
  await page.goto('/me')
  await expect(page).toHaveURL(/\/signin\?next=%2Fme/)
  // the one expected failure: the deliberately wrong code
  expect(errors.filter((e) => !e.includes('[http 403] POST /auth/v1/verify'))).toEqual([])
  await ctx.close()
})

test('next parameter can never redirect off-site', async ({ browser }) => {
  const u = await newMember(browser, { tag: 'redir', verified: false })
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '%2F%2Fevil.example', 'javascript:alert(1)']) {
    await u.page.goto(`/signin?next=${bad}`)
    await expect(u.page).toHaveURL(/^http:\/\/localhost:5185\//)
    await u.page.goto(`/auth/callback?next=${bad}`)
    await expect(u.page).toHaveURL(/^http:\/\/localhost:5185\//)
    await u.page.goto(`/welcome?next=${bad}`)
    await expect(u.page).toHaveURL(/^http:\/\/localhost:5185\//)
  }
  // a good same-site next is honoured
  await u.page.goto('/signin?next=/invite')
  await expect(u.page).toHaveURL(/\/invite$/)
  expect(u.errors).toEqual([])
  await u.ctx.close()
})
