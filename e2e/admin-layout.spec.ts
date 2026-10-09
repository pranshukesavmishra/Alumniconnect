import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { sql } from './helpers'
import { loginPage, makeEvent, makeUser, register, ts } from './verify/admin-lib'

// Admin pass 5: every admin screen at 360px and 412px. No sideways scroll, every control reachable by name and at least
// 44px to tap, no unnamed buttons or fields. Screenshots land in $ADMIN_SHOTS (default /tmp/admin-shots) for a human look.
const tag = `ly${ts}`.slice(0, 10)
const SHOTS = process.env.ADMIN_SHOTS ?? '/tmp/admin-shots'
const WIDTHS = [360, 412]

interface Problem { kind: string; what: string }

async function audit(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { kind: string; what: string }[] = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push({ kind: 'scroll', what: `page is ${document.documentElement.scrollWidth}px wide` })
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('.sr-only, [aria-hidden="true"], [hidden]')
    }
    const name = (el: Element) => {
      const h = el as HTMLElement
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
      if (labelled) return labelled
      if ('labels' in el && (el as HTMLInputElement).labels?.length) return 'label'
      return (h.innerText || '').trim() || el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt') || ''
    }
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], summary'
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue
      const r = el.getBoundingClientRect()
      const desc = `${el.tagName.toLowerCase()} "${(name(el) || el.getAttribute('placeholder') || '').slice(0, 40)}"`
      if (!name(el) && !el.getAttribute('placeholder')) out.push({ kind: 'unnamed', what: desc })
      const inline = el.tagName === 'A' && el.closest('p, li > span, td, dd') && getComputedStyle(el).display === 'inline'
      const box = el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type) ? el.closest('label') ?? el : el
      const br = box.getBoundingClientRect()
      if (!inline && (br.height < 43.5 || br.width < 43.5) && !(el.tagName === 'A' && br.width > 200 && br.height >= 24 && el.closest('nav, footer'))) out.push({ kind: 'tap', what: `${desc} is ${Math.round(br.width)}x${Math.round(br.height)}` })
      // tab rows and chip rows scroll sideways on purpose
      const scroller = el.closest('[role=tablist], .overflow-x-auto, [class*="overflow-x"]')
      if (!scroller && (r.right > window.innerWidth + 1 || r.left < -1)) out.push({ kind: 'offscreen', what: desc })
    }
    for (const img of document.querySelectorAll('img')) if (vis(img) && !img.hasAttribute('alt')) out.push({ kind: 'alt', what: (img.getAttribute('src') ?? '').slice(0, 60) })
    return out
  })
}

test('every admin screen fits 360px and 412px, is named, and has 44px targets', async ({ browser }) => {
  test.setTimeout(420_000)
  mkdirSync(SHOTS, { recursive: true })
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Layout Boss ${tag}` })
  const m1 = await makeUser(`${tag}m1`, { name: `Layout Member ${tag}` })
  const m2 = await makeUser(`${tag}m2`, { name: `Layout Second ${tag}`, verified: false })
  const ev = makeEvent(`${tag}e`)
  const { reg } = await register(m1, ev, true)
  await register(m2, ev, false)
  const group = sql(`insert into groups (kind, slug, name) values ('circle', 'ly-${tag}', 'Layout ${tag}') returning id`).split('\n')[0]!
  const post = sql(`insert into posts (author_id, body) values ('${m1.id}', 'A reported post ${tag}') returning id`).split('\n')[0]!
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${m2.id}', 'post', '${post}', 'layout ${tag}')`)
  sql(`insert into event_messages (event_id, kind, title, body, audience, status, created_by) values ('${ev.id}', 'announcement', 'Big ${tag}', 'Please read this', '{"segment":"registered"}', 'pending_approval', '${m1.id}')`)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${m1.id}', 'checkin')`)
  void group

  const routes: [string, string][] = [
    ['home', '/admin'], ['inbox', '/admin/inbox'], ['members', '/admin/members'], ['import', '/admin/members/import'], ['duplicates', '/admin/members/duplicates'],
    ['timeline', `/admin/members/${m1.id}`], ['view-as', `/admin/members/${m1.id}/preview`], ['activity', '/admin/activity'], ['roles', '/admin/roles'],
    ['reports', '/admin/reports'], ['analytics', '/admin/analytics'], ['community', '/admin/community'], ['health', '/admin/health'], ['new-event', '/admin/events/new'],
    ...['overview', 'payments', 'people', 'responses', 'programme', 'messages', 'finance', 'waitlist', 'dayof', 'settings', 'team'].map((t): [string, string] => [`event-${t}`, `/admin/events/${ev.slug}?tab=${t}`]),
    ['check-in', `/admin/events/${ev.slug}/check-in`], ['badges', `/admin/events/${ev.slug}/badges`],
  ]
  const found: string[] = []
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await loginPage(page, boss, '/admin')
    for (const [name, path] of routes) {
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/${width}-${name}.png`, fullPage: false })
      for (const p of await audit(page)) found.push(`${width}px ${name}: ${p.kind}: ${p.what}`)
    }
    // the open registration sheet and the language switch on one screen
    await page.goto(`/admin/events/${ev.slug}?tab=people`)
    await page.getByLabel('Search registrations').fill(reg.code)
    await page.getByRole('button', { name: new RegExp(reg.code) }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOTS}/${width}-registration-sheet.png` })
    for (const p of await audit(page)) found.push(`${width}px registration-sheet: ${p.kind}: ${p.what}`)
    await ctx.close()
  }
  console.log(`LAYOUT PROBLEMS (${found.length})\n${found.join('\n')}`)
  expect(found).toEqual([])
})
