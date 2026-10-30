// Layer 3b visuals: Meet page, registration celebration + share card, entry pass, Give hub, no sideways scroll, dark mode.
import { expect, test, type Page } from '@playwright/test'
import { createMember, signInContext, sql, stamp } from './verify/meet-lib'

const S = stamp()
const noSideScroll = async (page: Page) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  expect(sw).toBeLessThanOrEqual(cw + 1)
}

test.use({ viewport: { width: 390, height: 844 } })

test('meet page: hero, countdown, timeline, tier cards, dark mode, 360px', async ({ page }) => {
  const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)
  const marker = `Welcome desk ${S.slice(-4)}`
  sql(`insert into event_programme (event_id, starts_at, title) values ('${ev}', '2026-12-26 10:00+05:30', '${marker}'), ('${ev}', '2026-12-27 10:00+05:30', 'Outdoor day ${S.slice(-4)}')`)
  try {
    await page.addInitScript(() => localStorage.setItem('jec-theme', 'dark'))
    await page.goto('/meet')
    await expect(page.getByTestId('meet-hero')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Alumni Connect Grand Reunion 2026' })).toBeVisible()
    await expect(page.getByRole('timer')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Programme' }).getByText(marker)).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Day 2' })).toBeVisible()
    await expect(page.getByTestId('tier-card').first()).toBeVisible()
    expect(await page.getByTestId('tier-card').count()).toBeGreaterThanOrEqual(2)
    await expect(page.getByText(/registered|Be first/i)).toHaveCount(0) // no public counts
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    await noSideScroll(page)
    await page.setViewportSize({ width: 360, height: 740 })
    await noSideScroll(page)
  } finally {
    sql(`delete from event_programme where title in ('${marker}', 'Outdoor day ${S.slice(-4)}')`)
  }
})

test('entry pass: QR + code, shimmer off under reduced motion; share card downloads', async ({ browser }) => {
  const email = `evui-${S}@test.local`
  const uid = createMember({ email, name: `Pass Holder ${S.slice(-4)}`, year: 2008, verified: true })
  const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)
  const code = `JEC-U${S.slice(-5).toUpperCase().replace(/[01OI]/g, '7')}`
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values ('${ev}', '${uid}', '${code}', 'Pass Holder ${S.slice(-4)}', '+91 98765 43210', 'confirmed', 2, 250000)`)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await signInContext(ctx, uid, email)
  const page = await ctx.newPage()
  await page.goto('/meet/my')
  await expect(page.getByTestId('entry-pass')).toBeVisible()
  await expect(page.getByText(code).first()).toBeVisible()
  await expect(page.getByRole('img', { name: new RegExp(`Entry QR code ${code}`) })).toBeVisible()
  await expect(page.getByTestId('pass-holo')).toHaveCount(0)
  await expect(page.getByTestId('entry-pass')).toHaveAttribute('data-holo', 'static')
  await expect(page.getByTestId('pass-offline-badge')).toBeVisible()
  await noSideScroll(page)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-card-btn').click()])
  expect(dl.suggestedFilename()).toBe('jec-alumni-meet-2026.png')
  await ctx.close()
})

test('registration success screen shows the celebration and the share button', async ({ browser }) => {
  const email = `evui2-${S}@test.local`
  const uid = createMember({ email, name: `New Reg ${S.slice(-4)}`, year: 2009, verified: true })
  const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values ('${ev}', '${uid}', 'JEC-UQ${S.slice(-4).toUpperCase().replace(/[01OI]/g, '7')}', 'New Reg', '+91 98765 43210', 'pending_payment', 1, 250000)`)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await signInContext(ctx, uid, email)
  const page = await ctx.newPage()
  await page.goto('/meet/my')
  await page.evaluate(() => history.replaceState({ usr: { justRegistered: true }, key: 'k', idx: 0 }, ''))
  await page.reload()
  await expect(page.getByTestId('registered-celebration')).toBeVisible()
  await expect(page.getByText('You are registered!')).toBeVisible()
  await expect(page.getByTestId('share-card-btn')).toBeVisible()
  await noSideScroll(page)
  await ctx.close()
})

test('give hub: hero, featured progress, no sideways scroll', async ({ browser }) => {
  const slug = `evui-${S}`
  const id = sql(`insert into giving_campaigns (slug, type, title, goal_paise, status, is_featured, published_at) values ('${slug}', 'project', 'UI Hall ${S.slice(-4)}', 100000000, 'live', true, now()) returning id`).split('\n')[0]
  sql(`update giving_campaigns set is_featured = false where id <> '${id}'`)
  try {
    const email = `evui3-${S}@test.local`
    const uid = createMember({ email, name: 'Give Viewer', verified: true })
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } })
    await ctx.addInitScript(() => localStorage.setItem('jec-theme', 'dark'))
    await signInContext(ctx, uid, email)
    const page = await ctx.newPage()
    await page.goto('/give')
    await expect(page.getByRole('heading', { name: 'Give back to the place that made you' })).toBeVisible()
    await expect(page.getByTestId('give-hero')).toContainText(`UI Hall ${S.slice(-4)}`)
    await expect(page.getByRole('progressbar').first()).toBeVisible()
    await noSideScroll(page)
    await ctx.close()
  } finally {
    sql(`delete from giving_campaigns where id = '${id}'`)
  }
})
