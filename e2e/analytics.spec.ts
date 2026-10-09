import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

test('admins see the community numbers; members cannot open analytics', async ({ browser }) => {
  const mk = async (email: string, name: string, admin: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/signin')
    await signInWithEmail(page, email)
    await onboard(page, name, '2007')
    sql(`update profiles set verification = 'verified'${admin ? ', is_admin = true' : ''} where id = (select id from auth.users where email = '${email}')`)
    await page.reload()
    return { ctx, page }
  }
  const boss = await mk(`aboss.${run}@example.com`, `Boss ${run}`, true)
  const plain = await mk(`aplain.${run}@example.com`, `Plain ${run}`, false)

  await boss.page.goto('/admin')
  await boss.page.getByRole('link', { name: /Analytics/ }).click()
  await expect(boss.page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
  // the headline numbers match the database
  const total = sql('select count(*) from profiles')
  const verified = sql("select count(*) from profiles where verification = 'verified'")
  const members = boss.page.getByRole('region', { name: 'Members' })
  await expect(members.locator('p', { hasText: /^Members$/ }).locator('xpath=following-sibling::p[1]')).toHaveText(total)
  await expect(members.locator('p', { hasText: /^Verified$/ }).locator('xpath=following-sibling::p[1]')).toHaveText(verified)
  await expect(boss.page.getByRole('img', { name: /Sign-ups per day for the last 30 days/ })).toBeVisible()
  await expect(boss.page.locator('main').getByText('Batch 2007').first()).toBeVisible()

  // members are sent away
  await plain.page.goto('/admin/analytics')
  await expect(plain.page.getByRole('heading', { name: 'Analytics' })).toHaveCount(0)
  await boss.ctx.close()
  await plain.ctx.close()
})
