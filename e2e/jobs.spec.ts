import { expect, test, type Browser } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 9) % 26))

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

test('post a job, find it, save it, apply, message the poster, report it; poster closes it', async ({ browser }) => {
  const asha = await member(browser, `jasha.${run}@example.com`, `Asha ${run}`)
  const bela = await member(browser, `jbela.${run}@example.com`, `Bela ${run}`)
  const newbie = await member(browser, `jnew.${run}@example.com`, `Newbie ${run}`, false)
  const title = `Platform Engineer ${run}`

  // posting is checked on the screen before it is sent
  await asha.page.goto('/jobs/new')
  await asha.page.getByRole('button', { name: 'Post job' }).click()
  await expect(asha.page.getByText('Please enter the job title.')).toBeVisible()
  await asha.page.getByLabel('Job title').fill(title)
  await asha.page.getByLabel('Company', { exact: true }).fill(`Acme ${run}`)
  await asha.page.getByLabel('Location').fill('Pune')
  await asha.page.getByText('Hybrid', { exact: true }).click()
  await asha.page.getByLabel('About the role').fill('Build the payments platform in Go. JEC alumni are very welcome.')
  await asha.page.getByRole('button', { name: 'Post job' }).click()
  await expect(asha.page.getByText('Add a link or an email address so people can apply.')).toBeVisible()
  await asha.page.getByLabel('Apply link').fill('careers.acme.example/platform')
  await asha.page.getByText('I work here and can refer JECians').click()
  await asha.page.getByRole('button', { name: 'Post job' }).click()
  await expect(asha.page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/)
  await expect(asha.page.getByRole('heading', { name: title })).toBeVisible()
  expect(sql(`select apply_url from jobs where title = '${title}'`)).toBe('https://careers.acme.example/platform')

  // a batchmate finds it by search, sees "Can refer", saves and applies
  await bela.page.goto('/')
  await expect(bela.page.getByRole('region', { name: 'Latest jobs' }).getByText(title)).toBeVisible()
  await bela.page.goto('/jobs')
  await bela.page.getByLabel('Search jobs').fill(`platform engineer ${run}`)
  const card = bela.page.getByRole('list', { name: 'Jobs' }).getByRole('link', { name: new RegExp(title) })
  await expect(card).toContainText('Hybrid')
  await expect(card).toContainText('Can refer')
  await expect(card).toContainText(`Asha ${run}`)
  await bela.page.getByRole('button', { name: 'Remote' }).click()
  await expect(bela.page.getByText('No jobs match')).toBeVisible()
  await bela.page.getByRole('button', { name: 'Remote' }).click()
  await card.click()
  await bela.page.getByRole('button', { name: 'Save this job' }).click()
  await expect(bela.page.getByRole('button', { name: 'Remove from saved' })).toBeVisible()
  await expect.poll(() => sql(`select count(*) from job_saves where job_id = (select id from jobs where title = '${title}')`)).toBe('1')
  const apply = bela.page.getByRole('link', { name: /Apply on the company site/ })
  await expect(apply).toHaveAttribute('href', 'https://careers.acme.example/platform')
  await expect(apply).toHaveAttribute('rel', /noopener/)
  await bela.page.goto('/jobs')
  await bela.page.getByRole('button', { name: 'Saved' }).click()
  await expect(bela.page.getByRole('list', { name: 'Jobs' }).getByText(title)).toBeVisible()

  // message the poster straight from the job
  await bela.page.goto(`/jobs/${sql(`select id from jobs where title = '${title}'`)}`)
  await bela.page.getByRole('button', { name: new RegExp(`Message Asha`) }).click()
  await expect(bela.page).toHaveURL(/\/chat\//)

  // reporting reaches the moderators
  await bela.page.goBack()
  await bela.page.getByRole('button', { name: 'Report' }).click()
  await bela.page.getByRole('dialog', { name: 'Report this job' }).getByRole('button', { name: 'Scam or fake job' }).click()
  await expect(bela.page.getByText('Thanks. Our moderators will review this posting.')).toBeVisible()
  expect(sql(`select count(*) from reports where target_type = 'job' and reason = 'Scam or fake job'`)).not.toBe('0')

  // not-yet-verified members can't post or browse
  await newbie.page.goto('/jobs/new')
  await expect(newbie.page.getByText('Posting is for verified members')).toBeVisible()
  await newbie.page.goto('/jobs')
  await expect(newbie.page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0)

  // the poster marks it filled: it leaves the board, and reopens
  await asha.page.goto('/jobs/mine')
  await asha.page.getByRole('link', { name: new RegExp(title) }).click()
  await asha.page.getByRole('button', { name: 'Mark as filled' }).click()
  await expect(asha.page.getByText('This position is closed')).toBeVisible()
  await bela.page.goto('/jobs')
  await bela.page.getByLabel('Search jobs').fill(`platform engineer ${run}`)
  await expect(bela.page.getByText('No jobs match')).toBeVisible()
  await asha.page.getByRole('button', { name: 'Reopen' }).click()
  await expect(asha.page.getByRole('link', { name: /Apply on the company site/ })).toBeVisible()

  // an admin finds the reported posting in Reports and hides it: it disappears for members
  sql(`update profiles set is_admin = true where id = (select id from auth.users where email = 'jnew.${run}@example.com')`)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = 'jnew.${run}@example.com')`)
  await newbie.page.goto('/admin/reports')
  const report = newbie.page.locator('li').filter({ hasText: title })
  await expect(report).toContainText('Job posting')
  await expect(report).toContainText('Scam or fake job')
  newbie.page.once('dialog', (d) => void d.accept())
  await report.getByRole('button', { name: 'Hide' }).click()
  await expect(report).toHaveCount(0)
  await bela.page.goto('/jobs')
  await bela.page.getByLabel('Search jobs').fill(`platform engineer ${run}`)
  await expect(bela.page.getByText('No jobs match')).toBeVisible()
  await asha.page.goto('/jobs/mine')
  await expect(asha.page.getByRole('link', { name: new RegExp(title) })).toContainText('Under review')

  for (const m of [asha, bela, newbie]) await m.ctx.close()
})
