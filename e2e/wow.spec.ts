import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { loginPage, makeUser, ts } from './verify/admin-lib'
import { sql } from './helpers'

// Signature features: ID card, public card check, badges, yearbook, Wall of Fame (+ their admin screens).
const YEAR = 1990 + (Number.parseInt(ts.slice(-3), 36) % 9)

test('ID card, verify page, badges, yearbook, fame', async ({ page, browser }) => {
  const me = await makeUser('wowme', { name: `Wow Member ${ts}`, grad: YEAR })
  const mate = await makeUser('wowmate', { name: `Wow Mate ${ts}`, grad: YEAR })
  const hidden = await makeUser('wowhid', { name: `Wow Hidden ${ts}`, grad: YEAR })
  sql(`insert into member_showcase_prefs (user_id, show_in_yearbook) values ('${hidden.id}', false) on conflict (user_id) do update set show_in_yearbook=false`)

  // ---------- ID card
  await loginPage(page, me, '/id-card')
  await expect(page.getByTestId('membership-no')).toContainText(`JEC-${YEAR}-`)
  await expect(page.locator('[role=img][aria-label*="QR"]').first()).toBeVisible()
  const card = page.getByTestId('id-card')
  await page.getByRole('button', { name: 'Flip card' }).click()
  await expect(card).toHaveAttribute('data-flipped', 'true')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()])
  expect(dl.suggestedFilename()).toMatch(/\.png$/)
  const png = readFileSync(await dl.path())
  expect(png.subarray(1, 4).toString()).toBe('PNG')

  // ---------- public verify: valid, photo hidden unless allowed, then revoked
  const token = sql(`select token from member_card_tokens where user_id='${me.id}' and revoked_at is null`)
  sql(`update profiles set avatar_url='http://127.0.0.1:54321/storage/v1/object/public/avatars/none.png' where id='${me.id}'`)
  const anon = await (await browser.newContext()).newPage()
  await anon.goto(`/verify/${token}`)
  await expect(anon.getByText('Verified JEC alumnus')).toBeVisible()
  await expect(anon.getByText(`Wow Member ${ts}`)).toBeVisible()
  await expect(anon.getByTestId('verify-photo')).toHaveCount(0)
  sql(`insert into member_showcase_prefs (user_id, card_show_photo) values ('${me.id}', true) on conflict (user_id) do update set card_show_photo=true`)
  await anon.goto(`/verify/${token}`)
  await expect(anon.getByTestId('verify-photo')).toBeVisible()
  await anon.goto('/verify/00000000000000000000000000000000')
  await expect(anon.getByText('We could not find this card')).toBeVisible()
  await page.goto('/id-card')
  await page.getByRole('button', { name: 'Switch off QR code' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click()
  await expect(page.getByText('QR code switched off').first()).toBeVisible()
  await anon.goto(`/verify/${token}`)
  await expect(anon.getByText('This card was revoked')).toBeVisible()

  // ---------- badges
  await page.goto('/me/badges')
  await expect(page.getByTestId('earned-count')).toBeVisible()
  await expect(page.getByTestId('badge-verified_jecian')).toBeVisible()
  await expect(page.getByTestId('locked-connector')).toContainText('0/10')

  // ---------- yearbook: hidden member is not listed to others
  await loginPage(page, mate, `/yearbook/${YEAR}`)
  await expect(page.getByTestId('yb-year')).toHaveText(String(YEAR))
  await expect(page.getByTestId('yb-members-stat')).toBeVisible()
  await expect(page.getByText(`Wow Member ${ts}`)).toBeVisible()
  await expect(page.getByText(`Wow Hidden ${ts}`)).toHaveCount(0)
  await loginPage(page, hidden, `/yearbook/${YEAR}`)
  await expect(page.getByText('Only you can see yourself here')).toBeVisible()

  // ---------- admin creates a yearbook and a fame entry; a member sees them
  const admin = await makeUser('wowadm', { name: `Wow Admin ${ts}`, admin: true, grad: 1985 })
  sql(`update profiles set is_super_admin=true where id='${admin.id}'`)
  await loginPage(page, admin, '/admin/yearbooks')
  await page.getByRole('button', { name: 'New yearbook' }).click()
  await page.getByLabel('Passing-out year').fill(String(YEAR))
  await page.getByLabel('Motto or quote (English)').fill(`Together ${ts}`)
  await page.getByRole('switch', { name: /Published/ }).click()
  await page.getByRole('button', { name: 'Save yearbook' }).click()
  await expect(page.getByText('Yearbook saved')).toBeVisible()
  await page.goto('/admin/fame')
  await page.getByRole('button', { name: 'Add to the wall' }).click()
  await page.getByLabel('Name', { exact: true }).fill(`Hall Person ${ts}`)
  await page.getByLabel('Headline (English)').fill('Built bridges across the Narmada')
  await page.getByRole('switch', { name: /^Published/ }).click()
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByText('Saved to the Wall of Fame')).toBeVisible()

  await loginPage(page, mate, `/yearbook/${YEAR}`)
  await expect(page.getByText(`Together ${ts}`)).toBeVisible()
  await page.goto('/fame')
  await expect(page.getByText(`Hall Person ${ts}`)).toBeVisible()
  await page.getByText(`Hall Person ${ts}`).first().click()
  await expect(page.getByRole('dialog')).toContainText('Built bridges across the Narmada')
})

test('no sideways scroll at 360px and dark mode renders', async ({ page }) => {
  const me = await makeUser('wowmob', { name: `Wow Mobile ${ts}`, grad: YEAR })
  await page.setViewportSize({ width: 360, height: 780 })
  for (const path of ['/id-card', '/me/badges', `/yearbook/${YEAR}`, '/fame']) {
    await loginPage(page, me, path)
    await page.evaluate(() => localStorage.setItem('jec-theme', 'dark'))
    await page.reload()
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), path).toBe(true)
  }
})
