import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

test('organiser builds the programme and announces; registered members see both, others only the programme', async ({ browser }) => {
  const mk = async (email: string, name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/signin')
    await signInWithEmail(page, email)
    await onboard(page, name, '2004')
    sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
    await page.reload()
    return { ctx, page }
  }
  const boss = await mk(`pboss.${run}@example.com`, `Boss ${run}`)
  const going = await mk(`pgo.${run}@example.com`, `Going ${run}`)
  const outsider = await mk(`pout.${run}@example.com`, `Outsider ${run}`)
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = 'pboss.${run}@example.com')`)
  await boss.page.reload()
  const slug = sql(`select slug from events where is_published order by created_at limit 1`)
  const ev = sql(`select id from events where slug = '${slug}'`)
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values ('${ev}', (select id from auth.users where email = 'pgo.${run}@example.com'), 'JEC-PG${run.toUpperCase().slice(0, 3)}', 'Going ${run}', '+91 98765 43210', 'confirmed', 1, 250000)`)

  // organiser: programme (Indian time) and an announcement
  await boss.page.goto(`/admin/events/${slug}?tab=programme`)
  await boss.page.getByRole('button', { name: 'Add session' }).first().click()
  await boss.page.getByLabel('Session').fill(`Tea and registration ${run}`)
  await boss.page.getByLabel('Starts').fill('2031-12-26T10:00')
  await boss.page.getByLabel('Ends').fill('2031-12-26T09:00')
  await boss.page.getByRole('button', { name: 'Add session' }).last().click()
  await expect(boss.page.getByText('The end time must be after the start.')).toBeVisible()
  await boss.page.getByLabel('Ends').fill('2031-12-26T11:30')
  await boss.page.getByLabel('Venue').fill('Main gate')
  await boss.page.getByRole('button', { name: 'Add session' }).last().click()
  await expect(boss.page.getByText('Session added')).toBeVisible()
  expect(sql(`select starts_at at time zone 'Asia/Kolkata' from event_programme where title = 'Tea and registration ${run}'`)).toBe('2031-12-26 10:00:00')

  await boss.page.getByLabel('Title').fill(`Parking ${run}`)
  await boss.page.getByLabel('Message').fill('Please use gate 2 for parking.')
  await boss.page.getByLabel('Pin to the top of the Meet page').check()
  await boss.page.getByRole('button', { name: 'Send announcement' }).click()
  await expect(boss.page.getByText(/^Sent to \d+ people\./)).toBeVisible()

  // a registered member sees both, and was notified
  await going.page.goto('/meet')
  await expect(going.page.getByRole('region', { name: 'Announcements' }).getByText(`Parking ${run}`)).toBeVisible()
  const prog = going.page.getByRole('region', { name: 'Programme' })
  await expect(prog.getByText(`Tea and registration ${run}`)).toBeVisible()
  await expect(prog.getByText('10:00 am')).toBeVisible()
  await expect(prog.getByText(/Main gate · until 11:30 am/)).toBeVisible()
  await going.page.goto('/notifications')
  await expect(going.page.getByText(`Alumni Meet announcement: Parking ${run}`)).toBeVisible()

  // someone who is not registered sees the public programme but no announcements
  await outsider.page.goto('/meet')
  await expect(outsider.page.getByRole('region', { name: 'Programme' }).getByText(`Tea and registration ${run}`)).toBeVisible()
  await expect(outsider.page.getByRole('region', { name: 'Announcements' })).toHaveCount(0)
  expect(sql(`select count(*) from notifications where kind = 'announcement' and user_id = (select id from auth.users where email = 'pout.${run}@example.com')`)).toBe('0')

  // editing and removing
  await boss.page.getByRole('button', { name: `Edit Tea and registration ${run}` }).click()
  await boss.page.getByLabel('Session').fill(`Tea and welcome ${run}`)
  await boss.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(boss.page.getByText(`Tea and welcome ${run}`)).toBeVisible()
  boss.page.once('dialog', (d) => void d.accept())
  await boss.page.getByRole('button', { name: `Delete Tea and welcome ${run}` }).click()
  await expect(boss.page.getByText(`Tea and welcome ${run}`)).toHaveCount(0)
  for (const m of [boss, going, outsider]) await m.ctx.close()
})
