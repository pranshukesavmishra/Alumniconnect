import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

// Needs the production build (service worker): npm run build && npx vite preview --port 5190 --strictPort
test.use({ baseURL: 'http://localhost:5190' })

const run = Date.now().toString(36).slice(-5)

test('the entry pass opens with no network at all, after the app was opened once online', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  const email = `gate.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `Gate ${run}`, '2006')
  // a confirmed registration for the seeded sample event
  const uid = sql(`select id from auth.users where email = '${email}'`)
  sql(`update profiles set verification = 'verified' where id = '${uid}'`)
  const ev = sql(`select id from events where slug = (select slug from events order by created_at limit 1)`)
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values ('${ev}', '${uid}', 'JEC-GATE${run.toUpperCase().slice(0, 2)}', 'Gate ${run}', '+91 98765 43210', 'confirmed', 2, 250000)`)
  const code = sql(`select code from event_registrations where user_id = '${uid}'`)

  // online: open the pass (it is saved on the phone) and let the service worker install
  await page.goto('/meet/my')
  await expect(page.getByText(code).first()).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect(page.getByText(code).first()).toBeVisible()

  // at the gate: no signal. Cold open of the pass must still show the code and a QR.
  await ctx.setOffline(true)
  await page.goto('/meet/my')
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('img', { name: new RegExp('Entry QR code ' + code) })).toBeVisible()
  await expect(page.getByText(/offline|saved on this phone/i).first()).toBeVisible()
  await ctx.close()
})
