import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 11) % 26))

async function member(browser: Browser, email: string, name: string, verified = true) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  if (verified) sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page }
}

test('list a business, find it, contact it, report it; owner edits and deletes; admin hides', async ({ browser }) => {
  const asha = await member(browser, `basha.${run}@example.com`, `Asha ${run}`)
  const bela = await member(browser, `bbela.${run}@example.com`, `Bela ${run}`)
  const newbie = await member(browser, `bnew.${run}@example.com`, `Newbie ${run}`, false)
  const name = `Studio ${run}`

  // listing is checked on the screen before it is sent
  await asha.page.goto('/businesses/new')
  await asha.page.getByRole('button', { name: 'List business' }).click()
  await expect(asha.page.getByText('Please enter the business name.')).toBeVisible()
  await expect(asha.page.getByText('Please choose a category.')).toBeVisible()
  await asha.page.getByLabel('Business name').fill(name)
  await asha.page.getByLabel('Category').selectOption('Media & Design')
  await asha.page.getByLabel('City').fill('Jabalpur')
  await asha.page.getByLabel('What you do').fill('Logos, posters and wedding invitations designed by a JEC batchmate.')
  await asha.page.getByRole('button', { name: 'List business' }).click()
  await expect(asha.page.getByText('Add a website, phone or email so people can reach you.')).toBeVisible()
  await asha.page.getByLabel('Offer for JECians').fill('10% off for JECians')
  await asha.page.getByLabel('Website').fill('studio.example.com')
  await asha.page.getByLabel('Phone').fill('+91 98765 43210')
  await asha.page.getByText('This number is on WhatsApp').click()
  await asha.page.getByLabel(/^Email/).fill(`hello.${run}@studio.example.com`)
  await asha.page.getByRole('button', { name: 'List business' }).click()
  await expect(asha.page).toHaveURL(/\/businesses\/[0-9a-f-]{36}$/)
  await expect(asha.page.getByRole('heading', { name })).toBeVisible()
  expect(sql(`select website_url || '|' || phone || '|' || whatsapp from businesses where name = '${name}'`)).toBe('https://studio.example.com/|+919876543210|true')
  const id = sql(`select id from businesses where name = '${name}'`)

  // a batchmate finds it by search and by category, with the offer visible
  await bela.page.goto('/businesses')
  await bela.page.getByLabel('Search businesses').fill(name.toLowerCase())
  const card = bela.page.getByRole('list', { name: 'Businesses' }).getByRole('link', { name: new RegExp(name) })
  await expect(card).toContainText('Media & Design')
  await expect(card).toContainText('10% off for JECians')
  await expect(card).toContainText(`Asha ${run}`)
  await bela.page.getByRole('button', { name: 'Travel' }).click()
  await expect(bela.page.getByText('No businesses match')).toBeVisible()
  await bela.page.getByRole('button', { name: 'Travel' }).click()
  await bela.page.getByRole('button', { name: 'Media & Design' }).click()
  await card.click()

  // contact actions
  await expect(bela.page).toHaveURL(new RegExp(`/businesses/${id}$`))
  const visit = bela.page.getByRole('link', { name: 'Visit website' })
  await expect(visit).toHaveAttribute('href', 'https://studio.example.com/')
  await expect(visit).toHaveAttribute('rel', /noopener/)
  await expect(bela.page.getByRole('link', { name: /^Call/ })).toHaveAttribute('href', 'tel:+919876543210')
  await expect(bela.page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919876543210')
  await expect(bela.page.getByRole('link', { name: /^Email/ })).toHaveAttribute('href', new RegExp(`^mailto:hello\\.${run}@studio\\.example\\.com`))

  // message the owner
  await bela.page.getByRole('button', { name: `Message Asha` }).click()
  await expect(bela.page).toHaveURL(/\/chat\//)

  // report it
  await bela.page.goBack()
  await bela.page.getByRole('button', { name: 'Report' }).click()
  await bela.page.getByRole('dialog', { name: 'Report this listing' }).getByRole('button', { name: 'Fake or misleading' }).click()
  await expect(bela.page.getByText('Thanks. Our moderators will review this listing.')).toBeVisible()
  expect(sql(`select count(*) from reports where target_type = 'business' and target_id = '${id}'`)).toBe('1')

  // unverified members can't list or browse
  await newbie.page.goto('/businesses/new')
  await expect(newbie.page.getByText('Listing is for verified members')).toBeVisible()
  await newbie.page.goto('/businesses')
  await expect(newbie.page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0)

  // the owner edits the listing with the prefilled form; no report button on your own listing
  await asha.page.getByRole('link', { name: 'Edit' }).click()
  await expect(asha.page.getByLabel('Business name')).toHaveValue(name)
  await asha.page.getByLabel('Offer for JECians').fill('15% off for JECians')
  await asha.page.getByLabel('Phone').fill('1234')
  await asha.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(asha.page.getByText(/Numbers in India have 10 digits/)).toBeVisible()
  await asha.page.getByLabel('Phone').fill('98765 43210')
  await asha.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(asha.page).toHaveURL(new RegExp(`/businesses/${id}$`))
  await expect(asha.page.getByText('15% off for JECians')).toBeVisible()
  await expect(asha.page.getByRole('button', { name: 'Report' })).toHaveCount(0)
  await expect(asha.page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919876543210')

  // an admin finds the report in the queue and hides the listing: it disappears for members
  sql(`update profiles set is_admin = true, verification = 'verified' where id = (select id from auth.users where email = 'bnew.${run}@example.com')`)
  await newbie.page.goto('/admin/reports')
  const report = newbie.page.locator('li').filter({ hasText: name })
  await expect(report).toContainText('Business listing')
  await expect(report).toContainText('Fake or misleading')
  newbie.page.once('dialog', (d) => void d.accept())
  await report.getByRole('button', { name: 'Hide' }).click()
  await expect(report).toHaveCount(0)
  await bela.page.goto('/businesses')
  await bela.page.getByLabel('Search businesses').fill(name)
  await expect(bela.page.getByText('No businesses match')).toBeVisible()
  await asha.page.reload()
  await expect(asha.page.getByText('This listing is hidden pending review')).toBeVisible()

  // the owner deletes it for good
  asha.page.once('dialog', (d) => void d.accept())
  await asha.page.getByRole('button', { name: 'Delete' }).click()
  await expect(asha.page).toHaveURL(/\/businesses$/)
  await expect.poll(() => sql(`select count(*) from businesses where name = '${name}'`)).toBe('0')

  for (const m of [asha, bela, newbie]) await m.ctx.close()
})
