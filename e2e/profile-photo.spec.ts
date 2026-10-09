import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)

test('profile photo: LinkedIn option asks to connect when needed; upload and remove work', async ({ page }) => {
  const email = `photo.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `Photo ${run}`, '2008')
  await page.goto('/me/edit')

  // signed in by email: the LinkedIn option offers to connect LinkedIn (never silently fails)
  let asked = ''
  page.once('dialog', (d) => {
    asked = d.message()
    void d.dismiss()
  })
  await page.getByRole('button', { name: 'Use my LinkedIn photo' }).click()
  await expect.poll(() => asked).toContain('Connect your LinkedIn account')
  expect(sql(`select coalesce(avatar_url, '') from profiles where id = (select id from auth.users where email = '${email}')`)).toBe('')

  // upload a photo, then remove it
  await page.locator('input[type=file]').setInputFiles('public/pwa-512.png')
  await expect(page.getByText('Photo updated')).toBeVisible()
  await expect.poll(() => sql(`select avatar_url from profiles where id = (select id from auth.users where email = '${email}')`)).toContain('/storage/v1/object/public/avatars/')
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Photo removed')).toBeVisible()
  await expect.poll(() => sql(`select coalesce(avatar_url, '-') from profiles where id = (select id from auth.users where email = '${email}')`)).toBe('-')
})
