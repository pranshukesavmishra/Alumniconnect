import { APP, mintSession, newRecorder, sql, sleep } from './lib.mjs'
const uid = sql(`select id from auth.users where email='rohan.mehta@example.com'`)
const r = await newRecorder({ name: 'd', session: mintSession(uid, 'rohan.mehta@example.com'), record: false })
const { page } = r
await page.goto(APP + '/'); await sleep(2000)
await page.getByRole('button', { name: /menu/i }).first().click(); await sleep(700)
await page.getByRole('button', { name: /^Community/ }).first().click(); await sleep(800)
const l = page.locator('a:visible', { hasText: 'Find JECians' }).first()
console.log(await l.count(), await l.boundingBox(), await l.getAttribute('href'))
const b = await l.boundingBox()
await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
await sleep(1500)
console.log(page.url())
await r.browser.close()
