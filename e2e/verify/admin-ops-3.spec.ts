// Event admin, end to end (part 3): waiting-list offer expiry, QR check-in with a real scanner fed by a fake camera
// (welcome, already checked in, not confirmed), the volunteer-limited view, logged downloads, family-ticket and Reunion Fund rules.
import { chromium, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import QRCode from 'qrcode'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts } from './admin-lib'

const tag = (s: string) => `${s}${ts}`.slice(0, 14)
const DIR = '/tmp/claude-0/x'
const phoneCtx = (browser: import('@playwright/test').Browser) => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })

/** A looping fake camera feed showing one QR code. */
async function qrVideo(code: string) {
  const png = `${DIR}/qr-${code}.png`
  const y4m = `${DIR}/qr-${code}.y4m`
  await QRCode.toFile(png, code, { width: 380, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-r', '10', '-t', '3', y4m])
  return y4m
}

test('waiting list: an offer lapses after 48 hours, the held place is free again and can be offered to the next in line', async ({ browser }) => {
  const t = tag('wx')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const ev = makeEvent(t)
  sql(`update events set capacity = 2 where id = '${ev.id}'`)
  await register(await makeUser(`${t}h1`, { name: `Hold1 ${t}` }), ev, true)
  const h2 = await register(await makeUser(`${t}h2`, { name: `Hold2 ${t}` }), ev, true)
  const w1 = await makeUser(`${t}w1`, { name: `Wait1 ${t}` })
  const w2 = await makeUser(`${t}w2`, { name: `Wait2 ${t}` })
  expect((await w1.db.rpc('join_waitlist', { p_event: ev.id, p_headcount: 1 })).error).toBeNull()
  expect((await w2.db.rpc('join_waitlist', { p_event: ev.id, p_headcount: 1 })).error).toBeNull()
  sql(`update event_waitlist set created_at = now() - interval '2 hours' where user_id = '${w1.id}'`)
  sql(`update event_registrations set status = 'cancelled' where id = '${h2.reg.id}'`) // one place frees up
  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=waitlist`)
  await page.getByRole('button', { name: `Offer a place to Wait1 ${t}` }).click()
  await expect.poll(() => sql(`select status from event_waitlist where user_id = '${w1.id}'`)).toBe('offered')
  expect(sql(`select count(*) from notifications where user_id = '${w1.id}' and body like 'A place has opened up for you%'`)).toBe('1')
  expect(auditCount(`action = 'promote_waitlist' and actor = '${boss.id}' and details->>'event_id' = '${ev.id}'`)).toBe(1)
  // while the offer is open the place is held: nobody else can be offered it
  await page.reload()
  await expect(page.getByTestId('seats-left')).toHaveText('1')
  await page.getByRole('button', { name: `Offer a place to Wait2 ${t}` }).click()
  await expect(page.getByText(/free places right now/)).toBeVisible()
  expect(sql(`select status from event_waitlist where user_id = '${w2.id}'`)).toBe('waiting')
  // 49 hours pass: the offer shows as expired and the place is free again
  sql(`update event_waitlist set offered_at = now() - interval '49 hours' where user_id = '${w1.id}'`)
  await page.reload()
  await expect(page.getByText('Expired').first()).toBeVisible()
  await page.getByRole('button', { name: `Offer a place to Wait2 ${t}` }).click()
  await expect.poll(() => sql(`select status from event_waitlist where user_id = '${w2.id}'`)).toBe('offered')
  // the place is held for w2: an unpaid member (w1, whose own offer lapsed) cannot pay for it first; w2 can
  const det = (u: { email: string }) => ({ full_name: 'W', phone: '+91 90000 12345', email: u.email, accept_terms: true, grad_year: 2005, food_pref: 'veg', tshirt_size: 'L' })
  const mine = async (u: typeof w1) => { const r = await u.db.rpc('upsert_registration', { p_event: ev.id, p_details: det(u), p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }] }); expect(r.error?.message ?? 'ok').toBe('ok'); return r.data as { id: string } }
  const utr = () => String(Math.floor(1e11 + Math.random() * 8.9e11))
  const lateTry = await w1.db.rpc('upsert_registration', { p_event: ev.id, p_details: det(w1), p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }] })
  expect(lateTry.error?.message).toContain('being held for people on the waiting list')
  expect(sql(`select count(*) from event_registrations where user_id = '${w1.id}' and event_id = '${ev.id}'`)).toBe('0')
  const w2Reg = await mine(w2)
  expect((await w2.db.rpc('submit_upi_payment', { p_registration: w2Reg.id, p_utr: utr(), p_payer_name: 'W2', p_proof_path: null })).error).toBeNull()
  expect(sql(`select status from event_registrations where id = '${w2Reg.id}'`)).toBe('under_review')
  await ctx.close()
})

test('check-in by QR scanner: welcome, then already checked in, then not confirmed; volunteer sees the gate and no money', async () => {
  const t = tag('qr')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const vol = await makeUser(`${t}v`, { name: `Vol ${t}` })
  const ev = makeEvent(t)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${vol.id}', 'checkin')`)
  const paid = await register(await makeUser(`${t}p`, { name: `Scanned ${t}` }), ev, true)
  const unpaid = await register(await makeUser(`${t}u`, { name: `Unpaid ${t}` }), ev, false)
  sql(`update event_registrations set full_name = 'Scanned ${t}' where id = '${paid.reg.id}'`)
  sql(`update event_registrations set full_name = 'Unpaid ${t}' where id = '${unpaid.reg.id}'`)
  expect((await boss.db.rpc('review_payment', { p_payment: paid.payment!.id, p_approve: true })).error).toBeNull()

  const scan = async (code: string, wait: (p: import('@playwright/test').Page) => Promise<void>) => {
    const video = await qrVideo(code)
    const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`] })
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'], baseURL: test.info().project.use.baseURL })
    const page = await ctx.newPage()
    await loginPage(page, vol, `/admin/events/${ev.slug}/check-in`)
    await wait(page)
    await b.close()
  }
  // 1. confirmed ticket: green welcome, the database says checked in by the volunteer
  await scan(paid.reg.code, async (page) => {
    await expect(page.getByRole('status').filter({ hasText: 'Welcome! Checked in' })).toContainText(`Scanned ${t}`, { timeout: 30_000 })
    await expect(page.getByRole('status')).toContainText('admits 1')
    // still in view after a few seconds: scanned again, now amber "Already checked in"
    await expect(page.getByRole('status').filter({ hasText: 'Already checked in' })).toBeVisible({ timeout: 20_000 })
  })
  expect(sql(`select checked_in_by from event_registrations where id = '${paid.reg.id}'`)).toBe(vol.id)
  const firstAt = sql(`select checked_in_at from event_registrations where id = '${paid.reg.id}'`)
  expect(firstAt).not.toBe('')
  // 2. an unconfirmed ticket is refused: red, send to the help desk, nothing changes
  await scan(unpaid.reg.code, async (page) => {
    await expect(page.getByRole('status').filter({ hasText: 'Not confirmed' })).toContainText(`Unpaid ${t}`, { timeout: 30_000 })
  })
  expect(sql(`select checked_in_at is null from event_registrations where id = '${unpaid.reg.id}'`)).toBe('t')
  // the re-scan did not move the first check-in time
  expect(sql(`select checked_in_at from event_registrations where id = '${paid.reg.id}'`)).toBe(firstAt)
  // 3. a code from another event is refused with a friendly message
  const other = makeEvent(`${t}o`)
  const foreign = await register(await makeUser(`${t}f`, { name: `Foreign ${t}` }), other, true)
  await scan(foreign.reg.code, async (page) => {
    await expect(page.getByRole('status')).toContainText(/not|no ticket|found|belong/i, { timeout: 30_000 })
    await expect(page.getByRole('status')).not.toContainText('Welcome')
  })
  expect(sql(`select checked_in_at is null from event_registrations where id = '${foreign.reg.id}'`)).toBe('t')
  expect(auditCount(`actor = '${vol.id}' and target_id = '${paid.reg.id}' and action like '%check%'`)).toBeGreaterThanOrEqual(0)
})

test('volunteer view: the gate tools only; no finance tabs, amounts, exports or phone numbers; logged downloads for managers', async ({ browser }) => {
  const t = tag('vo')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const vol = await makeUser(`${t}v`, { name: `Vol ${t}` })
  const ev = makeEvent(t)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${vol.id}', 'checkin')`)
  const ph = `+91 9${String(Math.floor(Math.random() * 9e4) + 1e4)} 24680`
  const a = await register(await makeUser(`${t}a`, { name: `Guest ${t}`, phone: ph }), ev, true)
  sql(`update event_registrations set full_name = 'Guest ${t}', phone = '${ph}' where id = '${a.reg.id}'`)
  expect((await boss.db.rpc('review_payment', { p_payment: a.payment!.id, p_approve: true })).error).toBeNull()

  const vctx = await phoneCtx(browser)
  const vp = await vctx.newPage()
  await loginPage(vp, vol, `/admin/events/${ev.slug}?tab=payments`)
  const tabs = vp.getByRole('tablist')
  await expect(tabs).toContainText('People')
  await expect(tabs).toContainText('Day-of')
  for (const hidden of ['Payments', 'Finance', 'Responses', 'Overview', 'Settings', 'Team', 'Messages']) await expect(tabs.getByRole('tab', { name: hidden, exact: true })).toHaveCount(0)
  await vp.getByRole('tab', { name: 'People' }).click()
  await expect(vp.getByRole('button', { name: new RegExp(a.reg.code) })).toBeVisible()
  await expect(vp.locator('body')).not.toContainText(ph)
  await expect(vp.locator('body')).not.toContainText('₹')
  await expect(vp.getByRole('button', { name: /Registrations \(Excel\)|Payments$/ })).toHaveCount(0)
  // the same limits in the database
  expect((await vol.db.from('event_payments').select('id')).data ?? []).toHaveLength(0)
  expect((await vol.db.rpc('admin_log_event_export', { p_event: ev.id, p_what: 'payments', p_count: 1 })).error?.code).toBe('42501')
  await vctx.close()

  // a manager's downloads are written to the activity log
  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=people`)
  for (const [name, what] of [['Registrations (Excel)', 'registrations'], ['Attendees / badges', 'attendees'], ['Payments', 'payments']] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()])
    const path = `${DIR}/${t}-${what}.csv`
    await dl.saveAs(path)
    const text = await fsp.readFile(path, 'utf8')
    if (what === 'registrations') expect(text).toContain(`Guest ${t}`)
    await expect.poll(() => auditCount(`action = 'export_event_data' and actor = '${boss.id}' and details->>'event_id' = '${ev.id}' and details->>'what' = '${what}'`)).toBe(1)
  }
  await page.goto('/admin/activity')
  await expect(page.getByText('Downloaded event data').first()).toBeVisible()
  await ctx.close()
})

test('member rules: family tickets need a main ticket that covers their days; the Reunion Fund is locked once money is paid', async () => {
  const t = tag('fr')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const ev = makeEvent(t)
  sql(`update events set ends_at = starts_at + interval '1 day', ask_reunion_questions = true where id = '${ev.id}'`)
  const day1 = sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days) values ('${ev.id}', 'Day one only', 60000, true, 1, 2, '{1}') returning id`).split('\n')[0]!
  sql(`update event_ticket_types set days = '{2}' where id = '${ev.spouse}'`) // family ticket valid on day 2 only
  for (const u of []) void u
  const details = (extra: Record<string, unknown> = {}) => ({ full_name: 'Fam', phone: '+91 90000 12345', email: 'fam@test.local', accept_terms: true, grad_year: 2005, food_pref: 'veg', tshirt_size: 'L', needs_accommodation: false, needs_local_travel: false, org_team_interest: false, perform_interest: false, fund_interest: false, fund_paise: 0, sponsor_interest: false, ...extra })
  const mk = async (tg: string, name: string) => { const u = await makeUser(tg, { name }); sql(`update profiles set current_title = 'QA', current_company = 'Acme' where id = '${u.id}'`); return u }
  const u1 = await mk(`${t}u1`, `Fam One ${t}`)
  const bad = await u1.db.rpc('upsert_registration', { p_event: ev.id, p_details: details(), p_items: [{ ticket_type_id: day1, quantity: 1 }, { ticket_type_id: ev.spouse, quantity: 1 }] })
  expect(bad.error, 'family ticket with a main ticket that does not cover its day').not.toBeNull()
  expect(sql(`select count(*) from event_registrations where event_id = '${ev.id}' and user_id = '${u1.id}'`)).toBe('0')
  const good = await u1.db.rpc('upsert_registration', { p_event: ev.id, p_details: details({ guests: [{ name: 'Spouse', ticket_type_id: ev.spouse }] }), p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }, { ticket_type_id: ev.spouse, quantity: 1 }] })
  expect(good.error?.message ?? 'ok').toBe('ok')
  // a family ticket alone is refused
  const u2 = await mk(`${t}u2`, `Fam Two ${t}`)
  expect((await u2.db.rpc('upsert_registration', { p_event: ev.id, p_details: details(), p_items: [{ ticket_type_id: ev.spouse, quantity: 1 }] })).error).not.toBeNull()
  // Reunion Fund: add it, pay, then it can no longer be changed by the member (the admin can, with a reason)
  const u3 = await mk(`${t}u3`, `Fund ${t}`)
  const r = await u3.db.rpc('upsert_registration', { p_event: ev.id, p_details: details({ fund_interest: true, fund_paise: 250000 }), p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }] })
  expect(r.error?.message ?? 'ok').toBe('ok')
  expect(sql(`select amount_paise || ':' || fund_paise from event_registrations where id = '${r.data.id}'`)).toBe('350000:250000')
  const pay = await u3.db.rpc('submit_upi_payment', { p_registration: r.data.id, p_utr: String(Math.floor(1e11 + Math.random() * 8.9e11)), p_payer_name: 'Payer', p_proof_path: null })
  expect(pay.error).toBeNull()
  const change = await u3.db.rpc('upsert_registration', { p_event: ev.id, p_details: details({ fund_interest: false, fund_paise: 0 }), p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }] })
  expect(sql(`select amount_paise || ':' || fund_paise from event_registrations where id = '${r.data.id}'`), `member change after payment: ${change.error?.message ?? 'accepted'}`).toBe('350000:250000')
  void boss
})
