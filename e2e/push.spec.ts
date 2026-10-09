import { expect, test } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

// Needs the production build (service worker) on 5190: npm run build && npx vite preview --port 5190 --strictPort
test.use({ baseURL: 'http://localhost:5190' })

const run = Date.now().toString(36).slice(-5)

test('notifications: turn on/off, sign-out removes the device, a real push shows on the phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow', permissions: ['notifications'] })
  // The browser's real push service (Google) is out of reach from the test machine, so only the final
  // "give me a push address" call is stubbed; everything else (permission, service worker, database) is real.
  await ctx.addInitScript(() => {
    const KEY = 'e2e-push-endpoint'
    const fake = (endpoint: string) => ({
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: `B${'x'.repeat(86)}`, auth: 'a'.repeat(22) } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY)
        return true
      },
    })
    PushManager.prototype.subscribe = async function () {
      const e = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(KEY, e)
      return fake(e) as unknown as PushSubscription
    }
    PushManager.prototype.getSubscription = async function () {
      const e = localStorage.getItem(KEY)
      return (e ? fake(e) : null) as unknown as PushSubscription | null
    }
  })
  const page = await ctx.newPage()
  const email = `push.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `Push ${run}`, '2009')
  const uid = sql(`select id from auth.users where email = '${email}'`)
  const devices = () => sql(`select count(*) from push_subscriptions where user_id = '${uid}'`)

  await page.goto('/notifications')
  await expect(page.getByText('Notifications on this phone')).toBeVisible()
  await page.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(page.getByText('Notifications are on for this phone.')).toBeVisible()
  await expect.poll(devices).toBe('1')
  await page.reload()
  await page.getByRole('button', { name: 'Turn off' }).click()
  await expect.poll(devices).toBe('0')

  // a real push message through Chromium's push pipeline shows a notification from our service worker
  const cdp = await ctx.newCDPSession(page)
  let registrationId: string | undefined
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    for (const r of e.registrations) if (r.scopeURL.startsWith('http://localhost:5190')) registrationId = r.registrationId
  })
  await cdp.send('ServiceWorker.enable')
  await expect.poll(() => registrationId).toBeTruthy()
  // deliver once the worker is active; retry while it settles (a push to a worker that isn't ready yet is dropped)
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated')
  const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}|${n.body}|${n.tag}`))
  await expect
    .poll(async () => {
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: 'http://localhost:5190',
        registrationId: registrationId!,
        data: JSON.stringify({ title: `Asha ${run}`, body: 'See you at JEC!', url: '/chat/abc', tag: 'chat:abc' }),
      })
      return shown()
    }, { timeout: 20_000, intervals: [500, 1000, 1500] })
    .toContain(`Asha ${run}|See you at JEC!|chat:abc`)

  // signing out on a shared phone removes the device, so the next person never sees this member's messages
  await page.goto('/notifications')
  await page.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect.poll(devices).toBe('1')
  await page.goto('/me')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect.poll(devices).toBe('0')
  await ctx.close()
})
