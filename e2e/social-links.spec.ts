import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

test('a member adds Instagram and Facebook; another member sees working buttons; hidden hides them; bad input is rejected', async ({ browser }) => {
  const mk = async (email: string, name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/signin')
    await signInWithEmail(page, email)
    await onboard(page, name, '2012')
    sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
    await page.reload()
    return { ctx, page }
  }
  const a = await mk(`sl.anil.${run}@example.com`, `Anil ${run}`)
  const b = await mk(`sl.bela.${run}@example.com`, `Bela ${run}`)
  const aId = sql(`select id from auth.users where email = 'sl.anil.${run}@example.com'`)

  // A: invalid input is rejected inline and nothing is saved
  await a.page.goto('/me/edit')
  await a.page.getByTestId('social-input-instagram').fill('https://instagram.com.evil.com/anil')
  await a.page.getByTestId('social-input-facebook').fill('javascript:alert(1)')
  await a.page.getByTestId('social-input-facebook').blur()
  await expect(a.page.getByText(/doesn’t look like an Instagram username/)).toBeVisible()
  await expect(a.page.getByText(/doesn’t look like a Facebook profile link/)).toBeVisible()
  await expect(a.page.getByTestId('social-test-instagram')).toHaveCount(0)
  await a.page.getByRole('button', { name: 'Save profile' }).click()
  await expect(a.page).toHaveURL(/\/me\/edit/)
  expect(sql(`select count(*) from profile_social_links where user_id = '${aId}'`)).toBe('0')

  // A: a handle and a messy URL are accepted, normalised, and the preview button points at the right place
  await a.page.getByTestId('social-input-instagram').fill('@anil.k_' + run)
  await a.page.getByTestId('social-input-facebook').fill('https://m.facebook.com/anil.k.' + run + '?ref=bookmarks&fbclid=zzz')
  const test44 = await a.page.getByTestId('social-test-instagram').boundingBox()
  expect(test44!.height).toBeGreaterThanOrEqual(44)
  await expect(a.page.getByTestId('social-test-instagram')).toHaveAttribute('href', `https://www.instagram.com/anil.k_${run}/`)
  await expect(a.page.getByTestId('social-test-instagram')).toHaveAttribute('target', '_blank')
  await expect(a.page.getByTestId('social-test-facebook')).toHaveAttribute('href', `https://www.facebook.com/anil.k.${run}`)
  await a.page.getByRole('button', { name: 'Save profile' }).click()
  await expect(a.page).toHaveURL(/\/me$/)
  expect(sql(`select instagram_url || ' ' || facebook_url || ' ' || instagram_visibility from profile_social_links where user_id = '${aId}'`))
    .toBe(`https://www.instagram.com/anil.k_${run}/ https://www.facebook.com/anil.k.${run} verified`)

  // B sees both buttons on A's profile, opening in a new tab with safe rel
  await b.page.goto(`/people/${aId}`)
  const ig = b.page.getByTestId('social-instagram')
  const fb = b.page.getByTestId('social-facebook')
  await expect(ig).toHaveAttribute('href', `https://www.instagram.com/anil.k_${run}/`)
  await expect(ig).toHaveAttribute('target', '_blank')
  await expect(ig).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(fb).toHaveAttribute('href', `https://www.facebook.com/anil.k.${run}`)
  await expect(fb).toHaveAttribute('target', '_blank')
  await expect(fb).toHaveAttribute('rel', 'noopener noreferrer')
  expect((await ig.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // ...and in the directory row
  await b.page.goto('/people')
  await b.page.getByLabel('Search people').fill(`Anil ${run}`)
  await expect(b.page.getByTestId('social-instagram').first()).toHaveAttribute('href', `https://www.instagram.com/anil.k_${run}/`)

  // A hides Instagram, shows Facebook to connections only: B sees neither
  await a.page.goto('/me/edit')
  await a.page.getByTestId('social-vis-instagram').selectOption('hidden')
  await a.page.getByTestId('social-vis-facebook').selectOption('connections')
  await a.page.getByRole('button', { name: 'Save profile' }).click()
  await expect(a.page).toHaveURL(/\/me$/)
  await b.page.goto(`/people/${aId}`)
  await expect(b.page.getByRole('heading', { name: `Anil ${run}` }).last()).toBeVisible()
  await b.page.waitForLoadState('networkidle')
  await expect(b.page.getByTestId('social-links')).toHaveCount(0)
  // A still sees their own on their profile
  await expect(a.page.getByTestId('social-instagram')).toBeVisible()

  // Back to everyone: visible again; blocked users lose it
  sql(`update profile_social_links set instagram_visibility = 'verified' where user_id = '${aId}'`)
  await b.page.goto(`/people/${aId}`)
  await expect(b.page.getByTestId('social-instagram')).toBeVisible()
  sql(`insert into blocks (blocker, blocked) select '${aId}', id from auth.users where email = 'sl.bela.${run}@example.com'`)
  await b.page.goto(`/people/${aId}`)
  await b.page.waitForLoadState('networkidle')
  await expect(b.page.getByTestId('social-links')).toHaveCount(0)

  await a.ctx.close()
  await b.ctx.close()
})
