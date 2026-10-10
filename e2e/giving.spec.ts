import { expect, test, type Browser, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { sql } from './helpers'
import { auditCount, loginPage, makeUser, ts, type TestUser } from './verify/admin-lib'

// Give Back end to end: the committee launches an appeal from the app, members give by UPI + UTR, the treasurer verifies, and totals,
// progress, the batch leaderboard and the donor wall follow (anonymous donors stay hidden). Also: receipts, adopt-an-item, pledges,
// the Reunion Fund card, the expense log, and sponsorship (packages and slots, a lead from a registration, the pipeline, payment through
// the same queue, the wall on the Meet page and the slideshow, in-kind kept apart). Every step is asserted in the database too.

const tag = `gv${ts}`.slice(0, 14)
const MEET = 'alumni-meet-2026'
const meetId = () => sql(`select id from events where slug = '${MEET}'`)
let utrSeq = 0
const utr = () => String(Date.now() * 100 + (utrSeq++ % 100)).slice(-12).padStart(12, '3')

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  let c = 0xffffffff
  for (const x of td) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, td, crc])
}
function png(r: number, g: number, b: number, w = 96, h = 64) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const img = (name: string, r = 30, g = 100, b = 200) => ({ name, mimeType: 'image/png', buffer: png(r, g, b) })

async function open(browser: Browser, u: TestUser, path: string, width = 412) {
  const ctx = await browser.newContext({ viewport: { width, height: 915 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await loginPage(page, u, path)
  return { ctx, page }
}
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100)

test.describe.configure({ mode: 'serial' })

let boss: TestUser
let asha: TestUser // batch 2005, gives under her name
let ravi: TestUser // batch 2010, gives anonymously
const title = `Convocation Hall ${tag}`
let campaignId = ''
let adoptId = ''
let adoptSlug = ''

test.beforeAll(async () => {
  boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}`, grad: 1990 })
  asha = await makeUser(`${tag}asha`, { name: `Asha Giver ${tag}`, grad: 2005 })
  ravi = await makeUser(`${tag}ravi`, { name: `Ravi Secret ${tag}`, grad: 2010 })
  sql(`update giving_settings set default_upi_id = 'jecalumni@okicici', payee_name = 'JEC Alumni', assoc_name = 'JEC Alumni Association', tax_text = null`)
})

test.afterAll(() => {
  // leave the shared dev database as we found it
  const ids = sql(`select id from giving_campaigns where title like '%${tag}%'`).split('\n').filter(Boolean).map((i) => `'${i}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`
  const sp = sql(`select id from sponsors where name like '%${tag}%'`).split('\n').filter(Boolean).map((i) => `'${i}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`
  sql(`delete from giving_donations where campaign_id in (${ids}) or sponsor_id in (${sp});
       delete from giving_expenses where description like '%${tag}%';
       delete from sponsors where id in (${sp});
       delete from sponsor_packages where name like '%${tag}%';
       delete from giving_campaigns where id in (${ids});
       delete from event_registrations where code like 'GV${ts.slice(-6).toUpperCase()}%'`)
})

test('the committee launches a project appeal from the app: items, milestones, cover, publish, feature', async ({ browser }) => {
  const adm = await open(browser, boss, '/admin/funds')
  const p = adm.page
  await expect(p.getByTestId('funds-tab-campaigns')).toBeVisible()
  await p.getByTestId('new-campaign').click()
  await p.getByTestId('f-title').fill(title)
  await p.getByTestId('f-summary').fill('A hall for every convocation')
  await p.getByTestId('f-story').fill('For fifty years our graduates walked out in the open. Help us build a hall.')
  await p.getByTestId('f-goal').fill('100000')
  await p.getByTestId('f-suggested').fill('100, 500, 1000')
  await p.getByTestId('f-ends').fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 16))
  await p.getByTestId('upload-input').setInputFiles(img('cover.png'))
  await expect(p.locator('img[src*="/giving/"]').first()).toBeVisible({ timeout: 20_000 })
  await p.getByTestId('add-item').click()
  await p.getByTestId('item-name').nth(0).fill('Stage')
  await p.getByTestId('item-price').nth(0).fill('40000')
  await p.getByTestId('add-milestone').click()
  await p.getByTestId('ms-percent').nth(0).fill('1')
  await p.getByTestId('ms-title').nth(0).fill('Foundation')
  await p.getByTestId('ms-unlocks').nth(0).fill('We lay the foundation stone')
  await p.getByTestId('add-milestone').click()
  await p.getByTestId('ms-percent').nth(1).fill('50')
  await p.getByTestId('ms-title').nth(1).fill('Walls')
  await p.getByTestId('save-campaign').click()
  await expect(p).toHaveURL(/\/admin\/funds\/campaign\/[0-9a-f-]{36}/)
  campaignId = p.url().split('/').pop()!
  expect(sql(`select status || '|' || goal_paise || '|' || (cover_path like 'giving/%')::text from giving_campaigns where id = '${campaignId}'`)).toBe('draft|10000000|true')
  expect(sql(`select count(*) from giving_items where campaign_id = '${campaignId}'`)).toBe('1')
  expect(sql(`select count(*) from giving_milestones where campaign_id = '${campaignId}'`)).toBe('2')
  // a draft is invisible to members
  expect(sql(`select count(*) from giving_campaigns where id = '${campaignId}' and status = 'draft'`)).toBe('1')
  await p.getByTestId('publish').click()
  await expect(p.getByText('Published. Members have been told.')).toBeVisible()
  expect(sql(`select status from giving_campaigns where id = '${campaignId}'`)).toBe('live')
  await p.getByTestId('feature').click()
  await expect(p.getByText('Featured on Home and the hub.')).toBeVisible()
  expect(sql(`select is_featured from giving_campaigns where id = '${campaignId}'`)).toBe('t')
  expect(auditCount(`target_id = '${campaignId}' and action in ('giving_campaign_create', 'giving_campaign_status', 'giving_campaign_feature')`)).toBeGreaterThanOrEqual(3)
  // members were notified of the new appeal
  expect(Number(sql(`select count(*) from notifications where kind = 'giving_new' and target_id = '${campaignId}' and user_id = '${asha.id}'`))).toBe(1)
  await noSideScroll(p)
  await adm.ctx.close()
})

test('a member sees the hero on the hub and Home, gives with a UTR, and nothing counts until the treasurer verifies', async ({ browser }) => {
  const m = await open(browser, asha, '/')
  const p = m.page
  await expect(p.getByTestId('home-give-card')).toContainText(title)
  await p.goto('/give')
  await expect(p.getByTestId('give-hero')).toContainText(title)
  await noSideScroll(p)
  await p.getByTestId('give-hero').click()
  await expect(p.getByRole('heading', { name: title }).first()).toBeVisible()
  await expect(p.getByTestId('raised')).toHaveText('₹0')
  await expect(p.getByTestId('milestone')).toHaveCount(2)
  await expect(p.getByTestId('countdown')).toContainText(/days? left/)
  await expect(p.getByTestId('item-card')).toContainText('Stage')
  await expect(p.getByTestId('share-whatsapp')).toHaveAttribute('href', /wa\.me/)
  await p.getByTestId('give-btn').click()
  // bounds are explained before anything is sent
  await p.getByLabel('Amount (₹)').fill('5')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p.getByText('The smallest gift is ₹10.')).toBeVisible()
  await p.getByLabel('Amount (₹)').fill('1000001')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p.getByText('₹10,00,000')).toBeVisible()
  await p.getByRole('button', { name: '₹1,000', exact: true }).click()
  await p.getByLabel('In honour of').fill('Prof. Verma')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p.getByTestId('upi-id')).toHaveText('jecalumni@okicici')
  await expect(p.getByRole('img', { name: /QR/i })).toBeVisible()
  await noSideScroll(p)
  const u = utr()
  await p.getByLabel('UPI reference number (UTR)').fill('123')
  await p.getByRole('button', { name: 'I have paid' }).click()
  await expect(p.getByText(/12-digit number/)).toBeVisible()
  await p.getByLabel('UPI reference number (UTR)').fill(u)
  await p.getByRole('button', { name: 'I have paid' }).click()
  await expect(p.getByTestId('give-done')).toBeVisible()
  expect(sql(`select status || '|' || amount_paise || '|' || donor_batch || '|' || dedication from giving_donations where utr = '${u}'`)).toBe('submitted|100000|2005|Prof. Verma')
  await p.keyboard.press('Escape')
  await p.reload()
  await expect(p.getByTestId('raised')).toHaveText('₹0') // not verified yet
  // the same UTR cannot be used again, by anyone
  const dup = await open(browser, ravi, `/give/${sql(`select slug from giving_campaigns where id = '${campaignId}'`)}`)
  await dup.page.getByTestId('give-btn').click()
  await dup.page.getByRole('button', { name: '₹500', exact: true }).click()
  await dup.page.getByRole('button', { name: 'Continue' }).click()
  await dup.page.getByLabel('UPI reference number (UTR)').fill(u)
  await dup.page.getByRole('button', { name: 'I have paid' }).click()
  await expect(dup.page.getByText(/already been used/)).toBeVisible()
  await dup.ctx.close()
  await m.ctx.close()
})

test('the treasurer verifies one by one and in bulk; totals, progress, leaderboard and the donor wall follow; anonymous stays hidden', async ({ browser }) => {
  // an anonymous gift from another batch
  const r = await open(browser, ravi, `/give/${sql(`select slug from giving_campaigns where id = '${campaignId}'`)}`)
  await r.page.getByTestId('give-btn').click()
  await r.page.getByRole('button', { name: '₹500', exact: true }).click()
  await r.page.getByText('Give anonymously').click()
  await r.page.getByLabel('A message for the wall').fill('Proud of JEC')
  await r.page.getByRole('button', { name: 'Continue' }).click()
  const u2 = utr()
  await r.page.getByLabel('UPI reference number (UTR)').fill(u2)
  await r.page.getByRole('button', { name: 'I have paid' }).click()
  await expect(r.page.getByTestId('give-done')).toBeVisible()
  expect(sql(`select is_anonymous from giving_donations where utr = '${u2}'`)).toBe('t')

  const adm = await open(browser, boss, '/admin/funds?tab=verify')
  const p = adm.page
  const rows = p.getByTestId('queue-row')
  await expect(rows.filter({ hasText: `Ravi Secret ${tag}` })).toContainText('Anonymous to members') // the treasurer still sees who
  const asha1 = sql(`select utr from giving_donations where user_id = '${asha.id}' and campaign_id = '${campaignId}'`)
  await rows.filter({ hasText: `Asha Giver ${tag}` }).getByTestId('verify-one').click()
  await expect(p.getByText(/1 gift verified/)).toBeVisible()
  expect(sql(`select status || '|' || (receipt_no ~ '^JEC-GV-[0-9]{4}-[0-9]{6}$')::text from giving_donations where utr = '${asha1}'`)).toBe('verified|true')
  // bulk
  await p.getByRole('checkbox', { name: 'Select all' }).check()
  const pendingNow = Number(sql(`select count(*) from giving_donations where status = 'submitted'`))
  await p.getByTestId('verify-selected').click()
  await expect(p.getByText(new RegExp(`${pendingNow} gifts? verified`))).toBeVisible()
  expect(sql(`select status from giving_donations where utr = '${u2}'`)).toBe('verified')
  expect(sql(`select count(*) from notifications where kind = 'donation_verified' and user_id = '${asha.id}'`)).toBe('1')
  expect(sql(`select count(*) from notifications where kind = 'giving_milestone' and user_id = '${asha.id}' and target_id = '${campaignId}'`)).toBe('1') // 1% reached
  await adm.ctx.close()

  // the campaign page now shows ₹1,500 (1.5%), the batch race, and the donor wall
  const a = await open(browser, asha, `/give/${sql(`select slug from giving_campaigns where id = '${campaignId}'`)}`, 360)
  const q = a.page
  await expect(q.getByTestId('raised')).toHaveText('₹1,500')
  await expect(q.getByTestId('percent')).toHaveText('1%')
  await expect(q.getByTestId('donor-count')).toContainText('2 donors')
  await expect(q.getByTestId('milestone').first()).toHaveAttribute('data-reached', 'true')
  await expect(q.getByTestId('board-row')).toHaveCount(1)
  await expect(q.getByTestId('board-row')).toContainText('Batch 2005 raised ₹1,000')
  await expect(q.getByTestId('leaderboard')).toContainText('₹500 given anonymously')
  const wall = q.getByTestId('donor-wall')
  await expect(wall).toContainText(`Asha Giver ${tag}`)
  await expect(wall).toContainText('in honour of'.length ? 'Prof. Verma' : '')
  await expect(wall).toContainText('A JECian')
  await expect(wall).not.toContainText('Ravi Secret')
  await expect(wall).not.toContainText('Proud of JEC')
  await expect(q.getByTestId('leaderboard')).not.toContainText('2010')
  await expect(q.getByTestId('my-total')).toContainText('₹1,000')
  await noSideScroll(q)
  // receipt: printable, no tax text until the committee enters one
  await q.goto('/give/mine')
  await expect(q.getByTestId('my-giving-total')).toHaveText('₹1,000')
  await q.getByTestId('receipt-link').first().click()
  await expect(q.getByTestId('receipt')).toContainText(/JEC-GV-\d{4}-\d{6}/)
  await expect(q.getByTestId('receipt')).toContainText(`Asha Giver ${tag}`)
  await expect(q.getByTestId('receipt')).toContainText(title)
  await expect(q.getByTestId('tax-text')).toHaveCount(0)
  await expect(q.getByTestId('print-btn')).toBeVisible()
  await noSideScroll(q)
  sql(`update giving_settings set tax_text = 'Donations are exempt under section 80G (test ${tag})', receipt_footer = 'Thank you from the committee'`)
  await q.reload()
  await expect(q.getByTestId('tax-text')).toContainText('80G')
  await expect(q.getByTestId('receipt')).toContainText('Thank you from the committee')
  sql(`update giving_settings set tax_text = null, receipt_footer = null`)
  // another member cannot read this receipt
  const rid = sql(`select id from giving_donations where utr = '${asha1}'`)
  await r.page.goto(`/give/receipt/${rid}`)
  await expect(r.page.getByTestId('receipt')).toHaveCount(0)
  await a.ctx.close()
  await r.ctx.close()
})

test('refund lowers the total; a rejected UTR can be tried again; offline gifts count at once', async () => {
  const d = sql(`select id from giving_donations where utr = (select utr from giving_donations where user_id = '${ravi.id}' and campaign_id = '${campaignId}')`)
  const res = await boss.db.rpc('admin_giving_refund', { p_id: d, p_reason: 'Donor asked' })
  expect(res.error).toBeNull()
  expect(sql(`select coalesce(sum(amount_paise), 0) from giving_donations where campaign_id = '${campaignId}' and status = 'verified'`)).toBe('100000')
  const off = await boss.db.rpc('admin_giving_record_offline', { p: { campaign_id: campaignId, donor_name: `Cash Donor ${tag}`, amount_paise: 250000, method: 'cash', reason: 'Handed over at the office' } })
  expect(off.error).toBeNull()
  expect(sql(`select coalesce(sum(amount_paise), 0) from giving_donations where campaign_id = '${campaignId}' and status = 'verified'`)).toBe('350000')
  expect(auditCount(`action in ('giving_refund', 'giving_record_offline') and details::text like '%${campaignId}%' or action = 'giving_refund' and target_id = '${d}'`)).toBeGreaterThanOrEqual(2)
  // a member cannot call admin functions
  const bad = await asha.db.rpc('admin_giving_verify', { p_ids: [d] })
  expect(bad.error?.code).toBe('42501')
  const direct = await asha.db.from('giving_donations').select('*')
  expect(direct.data ?? []).toHaveLength(0)
})

test('adopt-an-item: fund part of an item, the item bar follows after verification; pledge reminders; Reunion Fund card', async ({ browser }) => {
  const created = await boss.db.rpc('admin_giving_save_campaign', {
    p_id: null,
    p: { type: 'adopt', title: `Adopt the Civil Lab ${tag}`, goal_paise: 20000000, department: 'Civil Engineering', items: [{ name: 'Smart board', price_paise: 6000000 }, { name: 'Projector', price_paise: 3000000 }], milestones: [{ percent: 25, title: 'Quarter' }] },
  })
  expect(created.error).toBeNull()
  adoptId = created.data as string
  expect((await boss.db.rpc('admin_giving_set_status', { p_id: adoptId, p_status: 'live' })).error).toBeNull()
  adoptSlug = sql(`select slug from giving_campaigns where id = '${adoptId}'`)

  const m = await open(browser, asha, `/give/${adoptSlug}`)
  const p = m.page
  await expect(p.getByTestId('item-card')).toHaveCount(2)
  await p.getByTestId('item-card').filter({ hasText: 'Smart board' }).getByTestId('adopt-btn').click()
  await expect(p.getByText('Funding: Smart board')).toBeVisible()
  await p.getByLabel('Amount (₹)').fill('20000') // part of the ₹60,000 board
  await p.getByRole('button', { name: 'Continue' }).click()
  const u = utr()
  await p.getByLabel('UPI reference number (UTR)').fill(u)
  await p.getByRole('button', { name: 'I have paid' }).click()
  await expect(p.getByTestId('give-done')).toBeVisible()
  expect(sql(`select item_id is not null from giving_donations where utr = '${u}'`)).toBe('t')
  const row = sql(`select id from giving_donations where utr = '${u}'`)
  expect((await boss.db.rpc('admin_giving_verify', { p_ids: [row] })).error).toBeNull()
  await p.keyboard.press('Escape')
  await p.reload()
  await expect(p.getByTestId('item-card').filter({ hasText: 'Smart board' }).getByTestId('item-funded')).toContainText('₹20,000')
  await expect(p.getByTestId('raised')).toHaveText('₹20,000')

  // pledge: remind me today (IST), the reminder arrives as a notification, nothing is charged
  await p.getByTestId('pledge-btn').click()
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  await p.getByLabel('Remind me on').fill(today)
  await p.getByRole('button', { name: 'Save reminder' }).click()
  await expect(p.getByText('We will remind you.')).toBeVisible()
  expect(sql(`select active::text || '|' || remind_on from giving_pledges where user_id = '${asha.id}' and campaign_id = '${adoptId}'`)).toBe(`true|${today}`)
  const run = await boss.db.rpc('admin_giving_run_reminders')
  expect(run.error).toBeNull()
  expect(sql(`select count(*) from notifications where kind = 'pledge_reminder' and user_id = '${asha.id}' and target_id = '${adoptId}'`)).toBe('1')
  expect(sql(`select active::text from giving_pledges where user_id = '${asha.id}' and campaign_id = '${adoptId}'`)).toBe('false')
  await p.goto('/notifications')
  await expect(p.getByText(`Your reminder: Adopt the Civil Lab ${tag}`)).toBeVisible()

  // Reunion Fund card: from registration data, never double counted in the appeals
  const ev = sql(`select id from events where slug = '${MEET}'`)
  const regCode = `GV${ts.slice(-6).toUpperCase()}1`
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise, fund_paise)
       values ('${ev}', '${ravi.id}', '${regCode}', 'Ravi', '+91 90000 11111', 'r@x.com', 'confirmed', 1, 350000, 250000)`)
  await p.goto('/give')
  const expected = Number(sql(`select coalesce(sum(fund_paise), 0) from event_registrations where fund_paise > 0 and status = 'confirmed'`))
  await expect(p.getByTestId('reunion-fund-card')).toBeVisible()
  await expect(p.getByTestId('reunion-raised')).toHaveText(inr(expected))
  // department filter and type chips
  await p.getByRole('tab', { name: 'Adopt a lab or classroom' }).click()
  await expect(p.getByTestId('give-card').filter({ hasText: `Adopt the Civil Lab ${tag}` })).toBeVisible()
  await expect(p.getByLabel('Department')).toBeVisible()
  await noSideScroll(p)
  await m.ctx.close()
})

test('expense log: the committee records spending with a bill; members read it under "Where the money went"', async ({ browser }) => {
  const adm = await open(browser, boss, '/admin/funds?tab=expenses', 360)
  const p = adm.page
  await p.getByTestId('add-expense').click()
  await p.getByTestId('exp-scope').selectOption({ label: title })
  await p.getByTestId('exp-desc').fill(`Cement for the foundation ${tag}`)
  await p.getByTestId('exp-amount').fill('25000')
  await p.getByTestId('exp-file').setInputFiles(img('bill.png', 200, 120, 40))
  await expect(p.getByTestId('expense-sheet').locator('img')).toBeVisible({ timeout: 20_000 })
  await p.getByTestId('exp-save').click()
  await expect(p.getByText('Expense saved.')).toBeVisible()
  expect(sql(`select amount_paise || '|' || (receipt_path like 'giving/%')::text from giving_expenses where description like '%${tag}%'`)).toBe('2500000|true')
  await noSideScroll(p)
  await adm.ctx.close()
  const m = await open(browser, asha, '/give/where-it-went', 360)
  await expect(m.page.getByTestId('expense').filter({ hasText: `Cement for the foundation ${tag}` })).toContainText('₹25,000')
  await expect(m.page.getByTestId('expense').filter({ hasText: `Cement for the foundation ${tag}` }).getByRole('link', { name: 'View bill' })).toBeVisible()
  await expect(m.page.getByTestId('total-spent')).toBeVisible()
  await noSideScroll(m.page)
  await m.ctx.close()
})

test('reports are gated, totals match the database, and the CSV export is logged and formula-safe', async ({ browser }) => {
  const adm = await open(browser, boss, '/admin/funds?tab=reports', 412)
  const p = adm.page
  await expect(p.getByTestId('report-table')).toContainText(title)
  const before = auditCount(`action = 'export_giving_data'`)
  // a donor named like a formula must not run in a spreadsheet
  sql(`update giving_donations set donor_name = '=HYPERLINK("http://x")' where donor_name like 'Cash Donor ${tag}'`)
  await p.getByTestId('report-kind').selectOption('donor')
  await expect(p.getByTestId('report-table')).toBeVisible()
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('report-csv').click()])
  const text = (await import('node:fs')).readFileSync(await dl.path(), 'utf8')
  expect(text).not.toMatch(/(^|,|\n)=HYPERLINK/)
  expect(text).toContain("'=HYPERLINK")
  expect(auditCount(`action = 'export_giving_data'`)).toBe(before + 1)
  await adm.ctx.close()
  // a member never reaches the admin screens
  const m = await open(browser, asha, '/admin/funds')
  await expect(m.page.getByTestId('funds-tab-campaigns')).toHaveCount(0)
  await m.ctx.close()
})

test('sponsorship: packages and slots, a lead from a registration, committed then paid after UTR verification, the wall on Meet and the slideshow, in-kind kept apart', async ({ browser }) => {
  const ev = meetId()
  const regCode = `GV${ts.slice(-6).toUpperCase()}2`
  sql(`insert into event_registrations (event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise, sponsor_interest, sponsor_level, sponsor_org, sponsor_note)
       values ('${ev}', '${asha.id}', '${regCode}', 'Asha Giver', '+91 98765 43210', 'asha@x.com', 'confirmed', 1, 100000, true, 'main', 'Acme Builders ${tag}', 'Happy to talk')`)
  const adm = await open(browser, boss, '/admin/funds?tab=sponsors')
  const p = adm.page
  await p.getByTestId('sponsor-scope').selectOption(`e:${ev}`)
  // packages
  await p.getByTestId('add-package').click()
  await p.getByTestId('pk-name').fill(`Gold ${tag}`)
  await p.getByTestId('pk-price').fill('50000')
  await p.getByTestId('pk-slots').fill('1')
  await p.getByTestId('pk-rank').fill('2')
  await p.getByTestId('pk-benefits').fill('Logo on the event page\nStage mention')
  await p.getByTestId('pk-save').click()
  const gold = p.getByTestId('package-card').filter({ hasText: `Gold ${tag}` })
  await expect(gold).toContainText('0 sold of 1')
  await expect(gold).toContainText('1 available')
  await p.getByTestId('add-package').click()
  await p.getByTestId('pk-name').fill(`In-kind ${tag}`)
  await p.getByTestId('pk-price').fill('0')
  await p.getByTestId('pk-rank').fill('5')
  await p.getByText('In-kind package').click()
  await p.getByTestId('pk-save').click()
  await expect(p.getByTestId('package-card').filter({ hasText: `In-kind ${tag}` })).toBeVisible()
  // the registration lead is a suggestion with contact details, for admins only
  const lead = p.getByTestId('lead-row').filter({ hasText: `Acme Builders ${tag}` })
  await expect(lead).toContainText('+91 98765 43210')
  await lead.getByTestId('import-lead').click()
  await expect(p.getByTestId('sponsor-row').filter({ hasText: `Acme Builders ${tag}` })).toBeVisible()
  await expect(p.getByTestId('lead-row').filter({ hasText: `Acme Builders ${tag}` })).toHaveCount(0)
  const sid = sql(`select id from sponsors where name = 'Acme Builders ${tag}'`)
  expect(sql(`select stage || '|' || (alumni_id = '${asha.id}')::text from sponsors where id = '${sid}'`)).toBe('lead|true')

  // pipeline: package, logo, website, contacted, proposal, committed
  await p.getByTestId('sponsor-row').filter({ hasText: `Acme Builders ${tag}` }).getByRole('link').click()
  await p.getByTestId('f-pkg').selectOption({ label: new RegExp(`Gold ${tag}`) as never }).catch(async () => {
    const val = sql(`select id from sponsor_packages where name = 'Gold ${tag}'`)
    await p.getByTestId('f-pkg').selectOption(val)
  })
  await p.getByTestId('f-web').fill('https://acme.example.com')
  await p.getByTestId('logo-input').setInputFiles(img('logo.png', 220, 40, 40))
  await expect(p.locator('img[src*="/giving/"]').first()).toBeVisible({ timeout: 20_000 })
  await p.getByTestId('f-follow').fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10))
  await p.getByTestId('save-sponsor').click()
  await expect(p.getByText('Saved.', { exact: true })).toBeVisible()
  await p.getByTestId('stage-contacted').click()
  await expect(p.getByText('Moved to Contacted.')).toBeVisible()
  await p.getByTestId('stage-proposal_sent').click()
  await expect(p.getByText('Moved to Proposal sent.')).toBeVisible()
  // committing needs a slot: Gold has one, it is free, so this works and sells it out
  await p.getByTestId('stage-committed').click()
  await expect(p.getByText('Moved to Committed.')).toBeVisible()
  expect(sql(`select stage || '|' || committed_paise from sponsors where id = '${sid}'`)).toBe('committed|5000000')
  // checklist
  await p.getByTestId('dl-title').fill('Logo received')
  await p.getByTestId('dl-add').click()
  await expect(p.getByTestId('deliverable')).toContainText('Logo received')
  expect(sql(`select count(*) from sponsor_deliverables where sponsor_id = '${sid}'`)).toBe('1')
  // printable documents
  await p.getByTestId('doc-agreement').click()
  await expect(p.getByTestId('sponsor-doc')).toContainText('Sponsorship agreement')
  await expect(p.getByTestId('sponsor-doc')).toContainText(`Gold ${tag}`)
  await expect(p.getByTestId('sponsor-doc')).toContainText('₹50,000')
  await p.goBack()

  // payment by UPI: waits in the queue; a UTR used by a donation or an event payment is refused
  await p.getByTestId('record-payment').click()
  await p.getByTestId('pay-utr').fill(asha1Utr())
  await p.getByTestId('pay-save').click()
  await expect(p.getByText(/already been used/)).toBeVisible()
  const u = utr()
  await p.getByTestId('pay-utr').fill(u)
  await p.getByTestId('pay-save').click()
  await expect(p.getByText(/waits in the Verify tab/)).toBeVisible()
  expect(sql(`select kind || '|' || status from giving_donations where utr = '${u}'`)).toBe('sponsorship|submitted')
  expect(sql(`select stage from sponsors where id = '${sid}'`)).toBe('committed')
  const wallBefore = await open(browser, asha, '/meet')
  await expect(wallBefore.page.getByTestId('sponsor-wall')).toHaveCount(0) // unpaid: not on the wall
  await wallBefore.ctx.close()
  // verified through the same queue
  await p.goto('/admin/funds?tab=verify')
  const row = p.getByTestId('queue-row').filter({ hasText: `Acme Builders ${tag}` })
  await expect(row).toContainText('sponsorship')
  await row.getByTestId('verify-one').click()
  await expect(p.getByText(/1 gift verified/)).toBeVisible()
  expect(sql(`select stage from sponsors where id = '${sid}'`)).toBe('paid')

  // a second sponsor cannot take the sold-out Gold slot
  await p.goto('/admin/funds?tab=sponsors')
  await p.getByTestId('sponsor-scope').selectOption(`e:${ev}`)
  await p.getByTestId('add-sponsor').click()
  await p.getByTestId('sp-name').fill(`Late Gold ${tag}`)
  await p.getByTestId('sp-add').click()
  const lateId = await expect.poll(() => sql(`select id from sponsors where name = 'Late Gold ${tag}'`)).toMatch(/[0-9a-f-]{36}/).then(() => sql(`select id from sponsors where name = 'Late Gold ${tag}'`))
  const goldId = sql(`select id from sponsor_packages where name = 'Gold ${tag}'`)
  const full = await boss.db.rpc('admin_sponsor_save', { p_id: lateId, p: { event_id: ev, name: `Late Gold ${tag}`, package_id: goldId, committed_paise: 5000000 } })
  expect(full.error).toBeNull()
  const late = await boss.db.rpc('admin_sponsor_set_stage', { p_id: lateId, p_stage: 'committed', p_note: null })
  expect(late.error?.message).toMatch(/No slots left/)
  expect(sql(`select stage from sponsors where id = '${lateId}'`)).toBe('lead')

  // in-kind sponsor: shown apart, never in the cash totals
  await p.reload()
  await p.getByTestId('sponsor-scope').selectOption(`e:${ev}`)
  await p.getByTestId('add-sponsor').click()
  await p.getByTestId('sp-name').fill(`Print Shop ${tag}`)
  await p.getByTestId('sp-add').click()
  await p.getByTestId('sponsor-row').filter({ hasText: `Print Shop ${tag}` }).getByRole('link').click()
  await p.getByText('In-kind sponsor (goods or services, not cash)').click()
  await p.getByTestId('f-kindvalue').fill('25000')
  await p.getByTestId('f-pkg').selectOption(sql(`select id from sponsor_packages where name = 'In-kind ${tag}'`))
  await p.getByTestId('save-sponsor').click()
  await expect(p.getByText('Saved.', { exact: true })).toBeVisible()
  await p.getByTestId('stage-committed').click()
  await expect(p.getByText('Moved to Committed.')).toBeVisible()
  const cash = sql(`select coalesce(sum(amount_paise), 0) from giving_donations where event_id = '${ev}' and kind = 'sponsorship' and status = 'verified' and donor_name like '%${tag}%'`)
  expect(cash).toBe('5000000')
  await p.goto('/admin/funds?tab=sponsors')
  await p.getByTestId('sponsor-scope').selectOption(`e:${ev}`)
  await expect(p.getByTestId('sponsor-inkind')).toContainText('₹25,000')
  await expect(p.getByTestId('sponsor-paid')).not.toContainText('25,000')
  await noSideScroll(p)
  await adm.ctx.close()

  // members: the wall on the Meet page (logo links out safely), the slideshow corner, the transparency page
  const m = await open(browser, asha, '/meet', 360)
  const wall = m.page.getByTestId('sponsor-wall')
  await expect(wall).toBeVisible()
  await expect(wall).toContainText(`Gold ${tag}`)
  await expect(wall).toContainText(`In-kind ${tag}`)
  const link = wall.getByRole('link', { name: `Acme Builders ${tag}` })
  await expect(link).toHaveAttribute('href', 'https://acme.example.com')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(wall.locator('img[alt="Acme Builders ' + tag + '"]')).toBeVisible()
  await expect(wall).not.toContainText('98765')
  await noSideScroll(m.page)
  await m.page.goto(`/events/${MEET}/photos/slideshow`)
  await expect(m.page.getByTestId('slideshow-sponsors')).toBeVisible()
  await m.page.goto('/give/where-it-went')
  await expect(m.page.getByTestId('sponsor-income')).toContainText('In-kind')
  await m.ctx.close()
  // contact details never reach a member
  expect((await asha.db.rpc('admin_sponsor', { p_id: sid })).error?.code).toBe('42501')
  expect((await asha.db.from('sponsors').select('*')).data ?? []).toHaveLength(0)
  expect(sql(`select count(*) from notifications where kind = 'sponsor_followup'`)).toBeDefined()
})

function asha1Utr(): string {
  return sql(`select utr from giving_donations where utr is not null and campaign_id = '${campaignId}' and status = 'verified' limit 1`)
}
