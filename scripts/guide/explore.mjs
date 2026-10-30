// Quick look at screens: node scripts/guide/explore.mjs <email> <path...>   (screenshots into $GUIDE/explore)
import { mkdirSync } from 'node:fs'
import { GUIDE, APP, mintSession, newRecorder, sql, sleep } from './lib.mjs'

const [email, ...paths] = process.argv.slice(2)
mkdirSync(`${GUIDE}/explore`, { recursive: true })
const uid = email === 'none' ? null : sql(`select id from auth.users where email = '${email}'`)
const r = await newRecorder({ name: 'x', session: uid ? mintSession(uid, email) : null, record: false })
for (const p of paths) {
  await r.page.goto(APP + p)
  await sleep(2500)
  await r.page.screenshot({ path: `${GUIDE}/explore/${p.replace(/[^a-z0-9]+/gi, '_')}.png` })
  console.log(p)
}
await r.browser.close()
