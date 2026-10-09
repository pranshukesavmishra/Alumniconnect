import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()
console.log(await p.evaluate(() => ['https://ht tp://bad url','https://not a website','https://a b','https://foo','https://x..y'].map(s => { try { return s+' -> '+new URL(s).toString() } catch { return s+' THROWS' } })))
await b.close()
