import { expect, test, type Page } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import { sql } from './helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './verify/admin-lib'

// Pass 3 of the admin programme: event operations (messages and reminders, finance ledger and refunds, payment queue,
// waiting list and capacity, adjustments, day-of tools and badges), asserted against the database.
// Everything is created by this run (own events and members), so other tests' data never makes it fail.

const phone = () => `+91 9${String(Math.floor(Math.random() * 9e4) + 1e4)} ${String(Math.floor(Math.random() * 9e4) + 1e4)}`

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

const phoneContext = (browser: import('@playwright/test').Browser) => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })

/** A registered (not yet paid) member with a known batch and city on the registration. */
async function unpaid(tag: string, ev: ReturnType<typeof makeEvent>, o: { batch: number; city: string; name: string }) {
  const u = await makeUser(tag, { name: o.name, phone: phone() })
  const { reg } = await register(u, ev, false)
  sql(`update event_registrations set grad_year = ${o.batch}, city = '${o.city}' where id = '${reg.id}'`)
  return { u, reg }
}

test('messages: a payment reminder reaches only the people it should, a scheduled one re-checks who is still unpaid', async ({ browser }) => {
  const tag = `om${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  const a = await unpaid(`${tag}a`, ev, { batch: 2001, city: 'Pune', name: `Asha ${tag}` })
  const b = await unpaid(`${tag}b`, ev, { batch: 2008, city: 'Indore', name: `Bela ${tag}` })
  const c = await makeUser(`${tag}c`, { name: `Chitra ${tag}` })
  const { reg: cReg } = await register(c, ev, true) // paid, waiting for the treasurer
  void cReg

  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=messages`)
  await expect(page.getByRole('heading', { name: 'New message' })).toBeVisible()

  // the reminder template fills in the audience and the text; the preview counts the real people
  await page.getByRole('button', { name: 'Payment reminder' }).click()
  await expect(page.getByLabel('Who should get it?')).toHaveValue('unpaid')
  await expect(page.getByLabel('Title')).toHaveValue('Complete your payment')
  await expect(page.getByTestId('audience-preview')).toContainText('This will reach 2 people')
  // narrowing by batch narrows the count
  await page.getByLabel('Batch from').fill('2001')
  await page.getByLabel('Batch to').fill('2005')
  await expect(page.getByTestId('audience-preview')).toContainText('This will reach 1 person')
  await expect(page.getByTestId('audience-preview')).toContainText(`Asha ${tag}`)
  // a bad year is rejected on screen before anything is sent
  await page.getByLabel('Batch to').fill('20x5')
  await expect(page.getByTestId('audience-preview')).toContainText('Batch years look like 2005')
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled()
  await page.getByLabel('Batch to').fill('2005')
  await expect(page.getByTestId('audience-preview')).toContainText('This will reach 1 person')
  await noSideScroll(page)

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Send to 1 person' }).click()
  await expect(page.getByText('Sent to 1 person.')).toBeVisible()
  await expect.poll(() => sql(`select count(*) from notifications where user_id = '${a.u.id}' and kind = 'announcement' and body like 'Complete your payment:%'`)).toBe('1')
  expect(sql(`select count(*) from notifications where user_id in ('${b.u.id}', '${c.id}') and body like 'Complete your payment:%'`)).toBe('0')
  expect(sql(`select count(*) from event_messages where event_id = '${ev.id}' and status = 'sent' and recipient_count = 1 and created_by = '${boss.id}'`)).toBe('1')
  expect(auditCount(`action = 'send_event_message' and actor = '${boss.id}' and details->>'event_id' = '${ev.id}' and (details->>'count')::int = 1`)).toBe(1)
  await expect(page.getByRole('listitem').filter({ hasText: 'Complete your payment' })).toContainText('Sent to 1')

  // the member really sees it, in their own notifications
  const mctx = await phoneContext(browser)
  const mp = await mctx.newPage()
  await loginPage(mp, a.u, '/notifications')
  await expect(mp.getByText('Complete your payment: Your Alumni Meet seat is not confirmed', { exact: false })).toBeVisible()
  await mctx.close()

  // schedule a reminder for later (everyone unpaid): nothing is sent yet
  await page.getByLabel('Title').fill('Last call')
  await page.getByLabel('Message').fill('Registration closes soon, please pay today.')
  await page.getByLabel('Batch from').fill('')
  await page.getByLabel('Batch to').fill('')
  await expect(page.getByTestId('audience-preview')).toContainText('This will reach 2 people')
  await page.getByText('Schedule', { exact: true }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Schedule message' }).click()
  await expect(page.getByText(/^Scheduled for/)).toBeVisible()
  const sched = sql(`select id from event_messages where event_id = '${ev.id}' and title = 'Last call' and status = 'scheduled'`)
  expect(sched).not.toBe('')
  expect(sql(`select count(*) from notifications where body like 'Last call:%' and user_id in ('${a.u.id}', '${b.u.id}')`)).toBe('0')

  // Bela pays before it goes out; then the time comes
  sql(`update event_registrations set status = 'under_review' where id = '${b.reg.id}'`)
  sql(`update event_messages set scheduled_for = now() - interval '1 minute' where id = '${sched}'`)
  await page.reload()
  await expect.poll(() => sql(`select status || ':' || coalesce(recipient_count::text, '') from event_messages where id = '${sched}'`), { timeout: 70_000 }).toBe('sent:1')
  expect(sql(`select count(*) from notifications where body like 'Last call:%' and user_id = '${a.u.id}'`)).toBe('1')
  expect(sql(`select count(*) from notifications where body like 'Last call:%' and user_id = '${b.u.id}'`)).toBe('0') // paid in the meantime: left alone

  // a scheduled message can be cancelled, and then never goes out
  await page.getByLabel('Title').fill('Cancel me')
  await page.getByLabel('Message').fill('This one should never be sent.')
  await page.getByText('Schedule', { exact: true }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Schedule message' }).click()
  await expect(page.getByRole('button', { name: 'Cancel Cancel me' })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Cancel Cancel me' }).click()
  await expect.poll(() => sql(`select status from event_messages where event_id = '${ev.id}' and title = 'Cancel me'`)).toBe('cancelled')
  expect(auditCount(`action = 'cancel_event_message' and actor = '${boss.id}'`)).toBe(1)

  // a treasurer of this event can message too; a plain member cannot, in the database either
  const direct = await a.u.db.rpc('admin_send_event_message', { p_event: ev.id, p_kind: 'announcement', p_title: 'Spam spam', p_body: 'Not allowed', p_audience: { segment: 'registered' }, p_send_at: null })
  expect(direct.error?.code).toBe('42501')
  await ctx.close()
})

test('finance: ledger numbers, discrepancy flags, a recorded refund and the CSV, all match the database', async ({ browser }) => {
  const tag = `of${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  const p1 = await makeUser(`${tag}p1`, { name: `Payer1 ${tag}` })
  const p2 = await makeUser(`${tag}p2`, { name: `Payer2 ${tag}` })
  const r1 = await register(p1, ev, true)
  await register(p2, ev, true)
  expect((await boss.db.rpc('review_payment', { p_payment: r1.payment!.id, p_approve: true })).error).toBeNull()
  // p1's price drops to ₹600 while ₹1000 is verified: an overpayment to sort out
  sql(`update event_registrations set amount_paise = 60000 where id = '${r1.reg.id}'`)

  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=finance`)
  const totals = page.getByTestId('ledger-totals')
  await expect(totals).toContainText('Verified (collected)')
  await expect(totals).toContainText('₹1,000')
  await expect(totals).toContainText('Awaiting verification')
  expect(sql(`select coalesce(sum(p.amount_paise),0) from event_payments p join event_registrations r on r.id = p.registration_id where r.event_id = '${ev.id}' and p.status = 'verified'`)).toBe('100000')
  expect(sql(`select coalesce(sum(p.amount_paise),0) from event_payments p join event_registrations r on r.id = p.registration_id where r.event_id = '${ev.id}' and p.status = 'submitted'`)).toBe('100000')
  // the discrepancy flag names the registration and links to it
  const flag = page.getByRole('region', { name: 'Discrepancies' })
  await expect(flag).toContainText('Paid more than the price')
  await expect(flag).toContainText(r1.reg.code)
  await expect(flag).toContainText('₹400')
  await noSideScroll(page)

  // record the refund of the excess from the registration's card
  await flag.getByRole('link', { name: new RegExp(r1.reg.code) }).click()
  await expect(page).toHaveURL(/tab=people/)
  const drawer = page.getByRole('dialog', { name: new RegExp(`Reg ${p1.email}`) }) // the link opens the registration
  await drawer.getByRole('button', { name: 'Record a refund' }).click()
  await drawer.getByLabel('Amount (₹)').fill('400')
  await drawer.getByText('UPI', { exact: true }).click()
  await drawer.getByLabel('Reference').fill('REFUTR123')
  await drawer.getByLabel('Reason').fill('Ticket price was reduced')
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: 'Record refund' }).click()
  await expect(page.getByText('Refund recorded')).toBeVisible()
  const payId = r1.payment!.id
  expect(sql(`select amount_paise || ':' || method || ':' || reference from event_refunds where payment_id = '${payId}'`)).toBe('40000:upi:REFUTR123')
  expect(sql(`select status from event_payments where id = '${payId}'`)).toBe('verified') // partial: the payment stays verified
  expect(auditCount(`action = 'record_refund' and actor = '${boss.id}' and (details->>'amount')::int = 40000 and details->>'reason' = 'Ticket price was reduced'`)).toBe(1)
  await expect(drawer).toContainText('Refunded ₹400')

  // the ledger shows the refund and the flag is gone
  await page.goto(`/admin/events/${ev.slug}?tab=finance`)
  await expect(page.getByTestId('ledger-totals')).toContainText('Refunded')
  await expect(page.getByTestId('ledger-totals')).toContainText('₹400')
  await expect(page.getByRole('region', { name: 'Discrepancies' })).toContainText('Everything adds up')

  // the CSV has every payment and the refund (negative), and the download is logged
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download every payment and refund/ }).click()])
  const csv = await fsp.readFile((await dl.path())!, 'utf8')
  expect(csv).toContain('Refund (money out)')
  expect(csv).toContain('-400.00')
  expect(csv).toContain('REFUTR123')
  expect(csv).toContain(r1.reg.code)
  expect(csv.trim().split('\n').length).toBe(1 + 3) // header + 2 payments + 1 refund
  expect(auditCount(`action = 'export_ledger' and actor = '${boss.id}' and details->>'event_id' = '${ev.id}'`)).toBe(1)

  // the period filter: a day in the past has no money, the booked figures stay
  await page.getByLabel('From').fill('2020-01-01')
  await page.getByLabel(/^To \(/).fill('2020-01-02')
  await expect(page.getByTestId('ledger-totals')).toContainText('₹0')
  await ctx.close()
})

test('payments: select many and verify in bulk, then go one by one with the keyboard', async ({ browser }) => {
  const tag = `oq${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  for (const i of [1, 2, 3, 4, 5]) await register(await makeUser(`${tag}u${i}`, { name: `Queue${i} ${tag}` }), ev, true)
  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=payments`)

  // tick two and verify them together
  await expect(page.getByText('Select all 5')).toBeVisible()
  await page.getByRole('checkbox', { name: /^Select Reg / }).nth(0).check()
  await page.getByRole('checkbox', { name: /^Select Reg / }).nth(1).check()
  const bar = page.getByRole('region', { name: 'Bulk payment actions' })
  await expect(bar).toContainText('2 selected')
  page.once('dialog', (d) => void d.accept())
  await bar.getByRole('button', { name: 'Verify 2' }).click()
  await expect(page.getByText('2 payments verified')).toBeVisible()
  expect(sql(`select count(*) from event_payments p join event_registrations r on r.id = p.registration_id where r.event_id = '${ev.id}' and p.status = 'verified'`)).toBe('2')
  expect(auditCount(`action = 'verify_payment' and actor = '${boss.id}' and details->>'note' = 'Verified in bulk'`)).toBe(2)

  // one by one: V verifies and moves on, S skips, R asks why
  await page.getByRole('button', { name: 'Review one by one' }).click()
  const focus = page.getByTestId('focus-review')
  await expect(focus).toContainText('Payment 1 of 3')
  const firstUtr = (await focus.locator('dd.font-mono').first().innerText()).trim()
  await page.keyboard.press('v')
  await expect(page.getByText(/^Verified JEC-/)).toBeVisible()
  await expect.poll(() => sql(`select status from event_payments where utr = '${firstUtr}'`)).toBe('verified')
  await expect(focus).toContainText('Payment 1 of 2')
  await page.keyboard.press('s')
  await expect(focus).toContainText('Payment 2 of 2')
  const secondUtr = (await focus.locator('dd.font-mono').first().innerText()).trim()
  await page.keyboard.press('r')
  const dlg = page.getByRole('dialog')
  await expect(dlg).toContainText('Payment not received?')
  await dlg.getByRole('button', { name: 'Mark as not received' }).click()
  await expect.poll(() => sql(`select status from event_payments where utr = '${secondUtr}'`)).toBe('rejected')
  expect(sql(`select review_note from event_payments where utr = '${secondUtr}'`)).toContain('UPI reference not found')
  // typing in the reason box never triggers a shortcut: the one left stays submitted
  expect(sql(`select count(*) from event_payments p join event_registrations r on r.id = p.registration_id where r.event_id = '${ev.id}' and p.status = 'submitted'`)).toBe('1')
  await ctx.close()
})

test('waiting list: join when full, auto-offer on a cancellation, manual offer, capacity per day, and a ticket transfer', async ({ browser }) => {
  const tag = `ow${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  sql(`update events set capacity = 2 where id = '${ev.id}'`)
  const h1 = await makeUser(`${tag}h1`, { name: `Holder1 ${tag}` })
  const h2 = await makeUser(`${tag}h2`, { name: `Holder2 ${tag}` })
  const w1 = await makeUser(`${tag}w1`, { name: `Waiter1 ${tag}` })
  const w2 = await makeUser(`${tag}w2`, { name: `Waiter2 ${tag}` })
  const r1 = await register(h1, ev, true)
  await register(h2, ev, true)
  // the event is full: members can queue, the database says so
  const early = await w1.db.rpc('join_waitlist', { p_event: ev.id, p_headcount: 1 })
  expect(early.error).toBeNull()
  expect((await w2.db.rpc('join_waitlist', { p_event: ev.id, p_headcount: 1 })).error).toBeNull()
  sql(`update event_waitlist set created_at = now() - interval '2 hours' where user_id = '${w1.id}'`)
  sql(`update event_waitlist set created_at = now() - interval '1 hour' where user_id = '${w2.id}'`)

  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=waitlist`)
  await expect(page.getByTestId('capacity-figures')).toContainText('Capacity')
  await expect(page.getByTestId('seats-left')).toHaveText('0')
  await expect(page.getByText(`Waiter1 ${tag}`)).toBeVisible()
  await expect(page.getByText(`Waiter2 ${tag}`)).toBeVisible()
  await noSideScroll(page)

  // nothing to offer while it is full
  await page.getByRole('button', { name: 'Offer free places now' }).click()
  await expect(page.getByText('No one to offer a place to right now')).toBeVisible()
  // a manual offer needs room
  await page.getByRole('button', { name: `Offer a place to Waiter1 ${tag}` }).click()
  await expect(page.getByText(/free places right now/)).toBeVisible()

  // switch on automatic offers; a cancellation then offers the place to the first in line
  await page.getByText('Offer free places automatically').click()
  await expect.poll(() => sql(`select waitlist_auto_promote from event_ops where event_id = '${ev.id}'`)).toBe('t')
  sql(`update event_registrations set status = 'cancelled' where id = '${r1.reg.id}'`)
  await expect.poll(() => sql(`select status from event_waitlist where user_id = '${w1.id}'`)).toBe('offered')
  expect(sql(`select status from event_waitlist where user_id = '${w2.id}'`)).toBe('waiting')
  expect(sql(`select count(*) from notifications where user_id = '${w1.id}' and body like 'A place has opened up for you%'`)).toBe('1')
  expect(sql(`select count(*) from notifications where user_id = '${w2.id}'`)).toBe('0')
  await page.reload()
  await expect(page.getByText('Place offered')).toBeVisible()

  // more room: raise the capacity; with auto-offers on, the second in line is offered too
  sql(`update events set capacity = 3 where id = '${ev.id}'`)
  await expect.poll(() => sql(`select status from event_waitlist where user_id = '${w2.id}'`)).toBe('offered')

  // capacity per day: add a day and save
  await page.reload()
  await page.getByRole('button', { name: 'Add a day' }).click()
  await page.getByRole('textbox', { name: 'People' }).fill('120')
  await page.getByRole('textbox', { name: /^Label/ }).fill('Saturday')
  await page.getByRole('button', { name: 'Save day limits' }).click()
  await expect(page.getByText('Day limits saved')).toBeVisible()
  expect(sql(`select capacity || ':' || label from event_day_capacity where event_id = '${ev.id}'`)).toBe('120:Saturday')
  expect(auditCount(`action = 'save_event_ops' and actor = '${boss.id}' and details->>'event_id' = '${ev.id}'`)).toBeGreaterThanOrEqual(2)

  // a member can read only their own queue entry; the whole queue is closed to them
  expect((await w1.db.rpc('admin_waitlist', { p_event: ev.id })).error?.code).toBe('42501')
  const own = await w1.db.from('event_waitlist').select('user_id').eq('event_id', ev.id)
  expect(own.data?.map((r) => r.user_id)).toEqual([w1.id])

  // transfer a ticket to another member from the registration card
  const buyer = await makeUser(`${tag}buy`, { name: `Buyer ${tag}` })
  const bought = await register(buyer, ev, true)
  const heir = await makeUser(`${tag}heir`, { name: `Zheir ${tag}` })
  await page.goto(`/admin/events/${ev.slug}?tab=people&q=${bought.reg.code}`)
  const drawer = page.getByRole('dialog', { name: new RegExp(`Reg ${buyer.email}`) })
  await drawer.getByRole('button', { name: 'Transfer ticket' }).click()
  await drawer.getByLabel('Reason').fill('Buyer cannot travel')
  await drawer.getByLabel('Search members by name').fill(`Zheir ${tag}`)
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: `Transfer: Zheir ${tag}` }).click()
  await expect(page.getByText(`Ticket moved to Zheir ${tag}`)).toBeVisible()
  expect(sql(`select user_id || ':' || full_name from event_registrations where id = '${bought.reg.id}'`)).toBe(`${heir.id}:Zheir ${tag}`)
  expect(sql(`select count(*) from event_payments where registration_id = '${bought.reg.id}'`)).toBe('1')
  expect(auditCount(`action = 'transfer_registration' and actor = '${boss.id}' and details->'to'->>'id' = '${heir.id}' and details->>'reason' = 'Buyer cannot travel'`)).toBe(1)
  expect(sql(`select count(*) from notifications where user_id in ('${buyer.id}', '${heir.id}') and body like '%${bought.reg.code}%'`)).toBe('2')
  await ctx.close()
})

test('adjustments: a discount, a part payment and a comp, each recorded in the database and the activity log', async ({ browser }) => {
  const tag = `oa${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  const a = await unpaid(`${tag}a`, ev, { batch: 2001, city: 'Pune', name: `Disc ${tag}` })
  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=people&q=${a.reg.code}`)
  const drawer = page.getByRole('dialog', { name: new RegExp(`Reg ${a.u.email}`) })
  await drawer.getByRole('button', { name: 'Discount' }).click()
  const adjust = drawer.getByLabel('Adjustments')
  await adjust.getByLabel('Amount (₹)').fill('250')
  await adjust.getByLabel('Approved by / reason').fill('Committee member, approved by Boss')
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: 'Apply discount' }).click()
  await expect(page.getByText('Discount applied')).toBeVisible()
  expect(sql(`select amount_paise || ':' || method || ':' || status from event_payments where registration_id = '${a.reg.id}'`)).toBe('25000:waiver:verified')
  expect(sql(`select status || ':' || amount_paise from event_registrations where id = '${a.reg.id}'`)).toBe('pending_payment:100000')
  expect(auditCount(`action = 'record_waiver' and actor = '${boss.id}' and details->>'note' like 'Discount: Committee member%'`)).toBe(1)

  // a part payment in cash leaves the rest due; the card shows what is still owed (₹1000 - ₹250 discount)
  await expect(drawer).toContainText('₹750 due')
  await drawer.getByLabel('Amount (₹)').fill('300')
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Payment recorded')).toBeVisible()
  expect(sql(`select amount_paise || ':' || status from event_payments where registration_id = '${a.reg.id}' and method = 'cash'`)).toBe('30000:verified')
  expect(sql(`select status from event_registrations where id = '${a.reg.id}'`)).toBe('pending_payment') // ₹450 still owed
  await expect(drawer).toContainText('₹450 due')

  // a comp: waive what is left; the registration is confirmed and nothing counts as collected for the waived part
  await drawer.getByText('Waive', { exact: true }).click()
  await drawer.getByLabel('Approved by / reason').last().fill('Comp for the speaker, approved by Boss')
  page.once('dialog', (d) => void d.accept())
  await drawer.getByRole('button', { name: 'Waive and confirm' }).click()
  await expect.poll(() => sql(`select status from event_registrations where id = '${a.reg.id}'`)).toBe('confirmed')
  expect(sql(`select coalesce(sum(amount_paise), 0) from event_payments where registration_id = '${a.reg.id}' and method = 'waiver'`)).toBe('70000')
  expect(auditCount(`action = 'record_cash' and actor = '${boss.id}' and target_id = '${a.reg.id}'`)).toBe(1)
  expect(auditCount(`action = 'record_waiver' and actor = '${boss.id}' and target_id = '${a.reg.id}'`)).toBe(2)

  // the ledger counts the waived part separately from the money received
  await page.goto(`/admin/events/${ev.slug}?tab=finance`)
  await expect(page.getByTestId('ledger-totals')).toContainText('₹300')
  await noSideScroll(page)
  await ctx.close()
})

test('day of the event: check in by search, live counter, no-shows, name badges to print', async ({ browser }) => {
  const tag = `od${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const vol = await makeUser(`${tag}vol`, { name: `Vol ${tag}` })
  const ev = makeEvent(tag)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${vol.id}', 'checkin')`)
  const people: { u: TestUser; reg: { id: string; code: string }; phone: string; name: string }[] = []
  for (const [i, batch] of [[1, 2001], [2, 2001], [3, 2005]] as const) {
    const ph = `+91 9${String(Math.floor(Math.random() * 9e4) + 1e4)} ${String(i).repeat(5)}`
    const name = `Arriver${i} ${tag}`
    const u = await makeUser(`${tag}u${i}`, { name, phone: ph })
    const { reg } = await register(u, ev, true)
    sql(`update event_registrations set grad_year = ${batch}, full_name = '${name}', phone = '${ph}' where id = '${reg.id}'`)
    people.push({ u, reg, phone: ph, name })
  }
  // two confirmed, one still being verified; the first one brings a spouse
  for (const p of people.slice(0, 2)) {
    expect((await boss.db.rpc('review_payment', { p_payment: sql(`select id from event_payments where registration_id = '${p.reg.id}' and status = 'submitted'`), p_approve: true })).error).toBeNull()
  }
  sql(`update event_registrations set guests = '[{"name":"Spouse ${tag}","relation":"Spouse"}]'::jsonb, headcount = 2 where id = '${people[0]!.reg.id}'`)

  // ---- the volunteer: finds people at the gate, checks in, sees the count, never sees phone numbers
  const vctx = await phoneContext(browser)
  const vp = await vctx.newPage()
  await loginPage(vp, vol, `/admin/events/${ev.slug}/check-in`)
  const last4 = people[1]!.phone.replace(/\D/g, '').slice(-4) // 2222
  await vp.getByLabel('Find by name, code or last digits of mobile').fill(last4)
  const results = vp.getByTestId('gate-results')
  await expect(results).toContainText(people[1]!.name)
  await expect(vp.locator('body')).not.toContainText(people[1]!.phone)
  await vp.getByRole('button', { name: `Check in ${people[1]!.name}` }).click()
  await expect.poll(() => sql(`select checked_in_at is not null from event_registrations where id = '${people[1]!.reg.id}'`)).toBe('t')
  expect(sql(`select checked_in_by from event_registrations where id = '${people[1]!.reg.id}'`)).toBe(vol.id)
  await expect(vp.getByTestId('arrived-people')).toHaveText('1')
  await vp.getByLabel('Find by name, code or last digits of mobile').fill(`Arriver1 ${tag}`)
  await expect(results).toContainText(people[0]!.reg.code)
  // a volunteer cannot read finance or the whole attendee list with phones, in the database either
  expect((await vol.db.rpc('admin_event_ledger', { p_event: ev.id })).error?.code).toBe('42501')
  const sanitized = await vol.db.rpc('checkin_search', { p_event: ev.id, p_q: tag })
  expect(JSON.stringify(sanitized.data)).not.toContain(people[1]!.phone.replace(/\D/g, '').slice(-8))
  await noSideScroll(vp)
  await vctx.close()

  // ---- the manager: day-of tab, no-shows, badges
  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=dayof`)
  await expect(page.getByTestId('arrived-people')).toHaveText('1')
  await expect(page.getByTestId('arrivals-counter')).toContainText('/ 3 people') // 1 + 2 expected (the spouse counts)
  await page.getByLabel('Find by name, code or last digits of mobile').fill(`Arriver1 ${tag}`)
  await page.getByRole('button', { name: `Check in Arriver1 ${tag}` }).click()
  await expect(page.getByTestId('arrived-people')).toHaveText('3', { timeout: 20_000 })
  const attendance = page.getByRole('region', { name: 'Attendance report' })
  await expect(attendance).toContainText('2001')
  // nobody confirmed is missing now; the one still being verified is not "confirmed"
  expect(sql(`select count(*) from event_registrations where event_id = '${ev.id}' and status = 'confirmed' and checked_in_at is null`)).toBe('0')

  await page.goto(`/admin/events/${ev.slug}/badges`)
  await expect(page.getByTestId('badge-count')).toContainText('3 badges') // two registrants + one spouse (the unconfirmed person is not included)
  await expect(page.getByTestId('badge').filter({ hasText: 'Alumnus' }).filter({ hasText: `Arriver1 ${tag}` })).toContainText(people[0]!.reg.code)
  await expect(page.getByTestId('badge').filter({ hasText: `Spouse ${tag}` })).toContainText('Spouse')
  await page.getByText('Confirmed + payment being verified').click()
  await expect(page.getByTestId('badge-count')).toContainText('4 badges')
  await page.getByRole('button', { name: `Leave out the badge for Arriver3 ${tag}` }).click()
  await expect(page.getByTestId('badge-count')).toContainText('3 badges')
  // printing: the app's own navigation is hidden and the sheets stay
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('badge-sheets')).toBeVisible()
  await expect(page.locator('nav').first()).toBeHidden()
  await expect(page.getByRole('button', { name: 'Print / save as PDF' })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  // a volunteer is turned away from the badge page
  const v2 = await phoneContext(browser)
  const vp2 = await v2.newPage()
  await loginPage(vp2, vol, `/admin/events/${ev.slug}/badges`)
  await expect(vp2).not.toHaveURL(/badges/)
  await v2.close()
  await ctx.close()
})

test('member side of the waiting list: the card appears when every place is taken, joins, shows the position and leaves', async ({ browser }) => {
  // The shared Alumni Meet event must not be filled for real while other suites run, so the three database calls
  // behind the card are answered here; what they do in the database is covered by the waiting-list journey above and the SQL suite.
  const tag = `ow${ts}m`.slice(0, 12)
  const member = await makeUser(`${tag}m`, { name: `Queuer ${tag}` })
  const ctx = await phoneContext(browser)
  const page = await ctx.newPage()
  let entry: { status: string; headcount: number; position: number; offered_at: null } | null = null
  const calls: string[] = []
  await page.route('**/rest/v1/rpc/event_seats_left', (r) => r.fulfill({ json: 0 }))
  await page.route('**/rest/v1/rpc/my_waitlist', (r) => r.fulfill({ json: entry }))
  await page.route('**/rest/v1/rpc/join_waitlist', (r) => {
    calls.push(`join:${JSON.parse(r.request().postData() ?? '{}').p_headcount}`)
    entry = { status: 'waiting', headcount: 2, position: 3, offered_at: null }
    return r.fulfill({ json: entry })
  })
  await page.route('**/rest/v1/rpc/leave_waitlist', (r) => {
    calls.push('leave')
    entry = null
    return r.fulfill({ status: 204, body: '' })
  })
  await loginPage(page, member, '/meet')
  const card = page.getByTestId('waitlist-card')
  await expect(card).toContainText('All places are taken')
  await card.getByRole('button', { name: 'More: places' }).click()
  await card.getByRole('button', { name: 'Join the waiting list' }).click()
  await expect(card).toContainText('You are on the waiting list')
  await expect(card).toContainText('number 3 in line for 2 places')
  expect(calls).toEqual(['join:2'])
  await noSideScroll(page)
  await card.getByRole('button', { name: 'Leave the waiting list' }).click()
  await expect(card).toContainText('All places are taken')
  expect(calls).toEqual(['join:2', 'leave'])
  // an offered place turns the card into a way to register
  entry = { status: 'offered', headcount: 1, position: 1, offered_at: null }
  await page.reload()
  await expect(page.getByTestId('waitlist-card')).toContainText('A place is being held for you')
  await expect(page.getByTestId('waitlist-card').getByRole('link', { name: 'Register now' })).toBeVisible()
  await ctx.close()
})

test('roles: a treasurer runs messages and finance for their event only; a volunteer gets the gate tools and nothing financial', async ({ browser }) => {
  const tag = `or${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const tre = await makeUser(`${tag}tre`, { name: `Treasurer ${tag}` })
  const vol = await makeUser(`${tag}vol`, { name: `Volunteer ${tag}` })
  const ev = makeEvent(tag)
  const other = makeEvent(`${tag}x`)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${tre.id}', 'manager'), ('${ev.id}', '${vol.id}', 'checkin')`)
  const a = await unpaid(`${tag}a`, ev, { batch: 2001, city: 'Pune', name: `Asha ${tag}` })
  void a

  const tctx = await phoneContext(browser)
  const tp = await tctx.newPage()
  await loginPage(tp, tre, `/admin/events/${ev.slug}?tab=messages`)
  await expect(tp.getByRole('heading', { name: 'New message' })).toBeVisible()
  await expect(tp.getByLabel('Only members in a saved view')).toHaveCount(0)
  await tp.getByRole('button', { name: 'Payment reminder' }).click()
  await expect(tp.getByTestId('audience-preview')).toContainText('This will reach 1 person')
  for (const tab of ['Finance', 'Waitlist', 'Day-of', 'Payments']) await expect(tp.getByRole('tab', { name: new RegExp(`^${tab}`) })).toBeVisible()
  await expect(tp.getByRole('tab', { name: 'Settings' })).toHaveCount(0) // admin only
  await tp.getByRole('tab', { name: 'Finance' }).click()
  await expect(tp.getByTestId('ledger-totals')).toContainText('Verified (collected)')
  // other events are closed to them in the database
  expect((await tre.db.rpc('admin_event_ledger', { p_event: other.id })).error?.code).toBe('42501')
  expect((await tre.db.rpc('admin_message_preview', { p_event: other.id, p_audience: {} })).error?.code).toBe('42501')
  // and a saved member view is for admins
  const viaView = await tre.db.rpc('admin_message_preview', { p_event: ev.id, p_audience: { view_id: '00000000-0000-0000-0000-000000000000' } })
  expect(viaView.error?.message).toMatch(/admins/)
  await tctx.close()

  const vctx = await phoneContext(browser)
  const vp = await vctx.newPage()
  await loginPage(vp, vol, `/admin/events/${ev.slug}?tab=finance`)
  await expect(vp.getByRole('tab', { name: 'People' })).toBeVisible()
  await expect(vp.getByRole('tab', { name: 'Day-of' })).toBeVisible()
  for (const tab of ['Finance', 'Messages', 'Payments', 'Waitlist']) await expect(vp.getByRole('tab', { name: tab })).toHaveCount(0)
  await expect(vp.getByTestId('ledger-totals')).toHaveCount(0)
  await vp.getByRole('tab', { name: 'Day-of' }).click()
  await expect(vp.getByTestId('arrivals-counter')).toBeVisible()
  await expect(vp.getByRole('region', { name: 'Attendance report' })).toHaveCount(0)
  await expect(vp.getByRole('link', { name: 'Print name badges' })).toHaveCount(0)
  await noSideScroll(vp)
  await vctx.close()
})

test('layout: every new screen fits a 360px phone without sideways scrolling', async ({ browser }) => {
  const tag = `ol${ts}`.slice(0, 12)
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const ev = makeEvent(tag)
  const a = await unpaid(`${tag}a`, ev, { batch: 2001, city: 'Pune', name: `Layout ${tag}` })
  await register(await makeUser(`${tag}b`, { name: `Layout2 ${tag}` }), ev, true)
  void a
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=messages`)
  for (const [tab, marker] of [['messages', 'New message'], ['finance', 'Verified (collected)'], ['waitlist', 'Capacity per day'], ['dayof', 'Find and check in'], ['payments', 'Match with bank statement']] as const) {
    await page.goto(`/admin/events/${ev.slug}?tab=${tab}`)
    await expect(page.getByText(marker).first()).toBeVisible()
    await noSideScroll(page)
  }
  await page.getByRole('button', { name: 'Review one by one' }).click()
  await expect(page.getByTestId('focus-review')).toBeVisible()
  await noSideScroll(page)
  await page.goto(`/admin/events/${ev.slug}/badges`)
  await expect(page.getByTestId('badge-count')).toBeVisible()
  await noSideScroll(page)
  await ctx.close()
})
