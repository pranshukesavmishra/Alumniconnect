import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 13) % 26))

async function member(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page }
}

test('mentor offers, mentee requests, accept opens a DM, a full mentor refuses, decline and end work', async ({ browser }) => {
  const mentorName = `Mentor ${run}`
  const mentor = await member(browser, `mentor.${run}@example.com`, mentorName)
  const mentee = await member(browser, `mentee.${run}@example.com`, `Mentee ${run}`)
  const other = await member(browser, `bystander.${run}@example.com`, `Bystander ${run}`)
  const email = (k: string) => `${k}.${run}@example.com`

  // become a mentor: checked first, then listed with one slot
  await mentor.page.goto('/mentors')
  await mentor.page.getByRole('button', { name: 'Become a mentor' }).click()
  const profile = mentor.page.getByRole('dialog', { name: 'Mentor profile' })
  await profile.getByLabel('About you').fill('too short')
  await profile.getByRole('button', { name: 'Become a mentor' }).click()
  await expect(profile.getByText('Choose at least one topic.')).toBeVisible()
  await profile.getByRole('button', { name: 'Startups' }).click()
  await profile.getByRole('button', { name: 'Become a mentor' }).click()
  await expect(profile.getByText(/at least 20 characters/)).toBeVisible()
  await profile.getByLabel('About you').fill('Founder and engineer, happy to talk about building a first product.')
  await profile.getByLabel('Time you can give').fill('2 hours a month')
  await profile.getByLabel('Mentees at a time').selectOption('1')
  await profile.getByRole('button', { name: 'Become a mentor' }).click()
  await expect(mentor.page.getByText('You are now listed as a mentor')).toBeVisible()
  await expect(mentor.page.getByText('Taking new mentees (up to 1)')).toBeVisible()

  // the mentee finds and requests (checked first)
  await mentee.page.goto('/mentors')
  await mentee.page.getByPlaceholder('Name, company or branch').fill(mentorName)
  const card = mentee.page.getByRole('list', { name: 'Mentors' }).locator('li').filter({ hasText: mentorName })
  await expect(card).toContainText('1 slot open')
  await expect(card).toContainText('2 hours a month')
  await card.getByRole('button', { name: 'Request', exact: true }).click()
  const sheet = mentee.page.getByRole('dialog', { name: 'Request a mentor' })
  await sheet.getByLabel('Your message').fill('hi')
  await sheet.getByRole('button', { name: 'Send request' }).click()
  await expect(sheet.getByText(/at least 20 characters/)).toBeVisible()
  await sheet.getByLabel('Your message').fill('I am a final-year student planning to start a company after graduation.')
  await sheet.getByRole('button', { name: 'Send request' }).click()
  await expect(mentee.page.getByText(`Request sent to ${mentorName}`)).toBeVisible()
  await expect(card.getByText('Request sent')).toBeVisible()
  await expect(card.getByRole('button', { name: /Request/ })).toHaveCount(0)

  // the mentor is told, sees the request, accepts
  await expect.poll(() => sql(`select count(*) from notifications where kind = 'mentor_request' and user_id = (select id from auth.users where email = '${email('mentor')}')`)).toBe('1')
  await mentor.page.goto('/notifications')
  await expect(mentor.page.getByText(new RegExp(`Mentee ${run} asked you to be their mentor`))).toBeVisible()
  await mentor.page.goto('/mentors/mine')
  const incoming = mentor.page.locator('li').filter({ hasText: `Mentee ${run}` })
  await expect(incoming).toContainText('start a company after graduation')
  await incoming.getByRole('button', { name: 'Accept' }).click()
  await expect(mentor.page.getByText('Accepted. You can now message them.')).toBeVisible()
  await expect(incoming).toContainText('Active')

  // the slot is full: a second mentee cannot request
  await other.page.goto('/mentors')
  await other.page.getByPlaceholder('Name, company or branch').fill(mentorName)
  const otherCard = other.page.getByRole('list', { name: 'Mentors' }).locator('li').filter({ hasText: mentorName })
  await expect(otherCard).toContainText('No free slots')
  await expect(otherCard.getByRole('button', { name: 'Request', exact: true })).toBeDisabled()

  // the mentee is told, and messages the mentor from My mentorships (no message-request limbo)
  await expect.poll(() => sql(`select count(*) from notifications where kind = 'mentor_accepted' and user_id = (select id from auth.users where email = '${email('mentee')}')`)).toBe('1')
  await mentee.page.goto('/notifications')
  await expect(mentee.page.getByText(new RegExp(`${mentorName} accepted your mentor request`))).toBeVisible()
  await mentee.page.goto('/mentors/mine')
  await mentee.page.locator('li').filter({ hasText: mentorName }).getByRole('button', { name: 'Message' }).click()
  await expect(mentee.page).toHaveURL(/\/chat\//)
  await mentee.page.getByLabel('Message', { exact: true }).fill('Thank you for taking me on!')
  await mentee.page.getByRole('button', { name: 'Send' }).click()
  await expect(mentee.page.getByText('Thank you for taking me on!')).toBeVisible()
  expect(sql(`select is_request from chats where kind = 'dm' and started_by = (select id from auth.users where email = '${email('mentor')}') order by created_at desc limit 1`)).toBe('f')

  // the mentor ends it; the slot frees; the second mentee asks and is declined
  await mentor.page.reload()
  await mentor.page.locator('li').filter({ hasText: `Mentee ${run}` }).getByRole('button', { name: 'End' }).click()
  await expect(mentor.page.getByText('Mentorship ended')).toBeVisible()
  await other.page.reload()
  await other.page.getByPlaceholder('Name, company or branch').fill(mentorName)
  await expect(otherCard).toContainText('1 slot open')
  await otherCard.getByRole('button', { name: 'Request', exact: true }).click()
  await other.page.getByRole('dialog', { name: 'Request a mentor' }).getByLabel('Your message').fill('Could you guide me on my first startup idea please?')
  await other.page.getByRole('dialog', { name: 'Request a mentor' }).getByRole('button', { name: 'Send request' }).click()
  await expect(other.page.getByText(`Request sent to ${mentorName}`)).toBeVisible()

  await mentor.page.goto('/mentors/mine')
  await mentor.page.locator('li').filter({ hasText: `Bystander ${run}` }).getByRole('button', { name: 'Decline' }).click()
  await expect(mentor.page.getByText('Declined', { exact: true }).first()).toBeVisible()
  await expect.poll(() => sql(`select count(*) from notifications where kind = 'mentor_declined' and user_id = (select id from auth.users where email = '${email('bystander')}')`)).toBe('1')
  await other.page.goto('/mentors/mine')
  await expect(other.page.locator('li').filter({ hasText: mentorName })).toContainText('Declined')

  // pausing hides the Request button; the ended mentee still sees the history
  await mentor.page.goto('/mentors')
  await mentor.page.getByRole('button', { name: 'Pause' }).click()
  await expect(mentor.page.getByText('Paused: no new requests')).toBeVisible()
  await mentee.page.goto('/mentors')
  await mentee.page.getByPlaceholder('Name, company or branch').fill(mentorName)
  await expect(mentee.page.locator('li').filter({ hasText: mentorName }).getByRole('button', { name: 'Request again' })).toBeDisabled()

  for (const m of [mentor, mentee, other]) await m.ctx.close()
})
