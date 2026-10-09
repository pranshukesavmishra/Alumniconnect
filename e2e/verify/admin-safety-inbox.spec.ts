// Unified inbox (each item only for the right roles, each action makes the item leave), community admin screen, announcements and the health page.
import { expect, test, type Page } from '@playwright/test'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `si${ts}`.slice(0, 9)
const id = (q: string) => sql(q).split('\n')[0]!

let boss: TestUser, boss2: TestUser, mod: TestUser, tre: TestUser, con: TestUser, chk: TestUser, plain: TestUser, buyer: TestUser, waiter: TestUser, author: TestUser
let ev: ReturnType<typeof makeEvent>, evTitle: string

interface Item { kind: string; title: string; detail: string | null; href: string }
const inbox = async (u: TestUser) => {
  const { data, error } = await u.db.rpc('admin_inbox')
  if (error) throw error
  return (data as { items: Item[] }).items.filter((i) => `${i.title} ${i.detail ?? ''}`.includes(tag))
}

test.beforeAll(async () => {
  boss = await makeUser(`${tag}b1`, { admin: true, name: `Boss ${tag}` })
  boss2 = await makeUser(`${tag}b2`, { admin: true, name: `Boss2 ${tag}` })
  mod = await makeUser(`${tag}md`, { name: `Mod ${tag}` })
  tre = await makeUser(`${tag}tr`, { name: `Tre ${tag}` })
  con = await makeUser(`${tag}cn`, { name: `Con ${tag}` })
  chk = await makeUser(`${tag}ck`, { name: `Chk ${tag}` })
  plain = await makeUser(`${tag}pl`, { name: `Plain ${tag}` })
  buyer = await makeUser(`${tag}by`, { name: `Buyer ${tag}` })
  waiter = await makeUser(`${tag}wt`, { name: `Waiter ${tag}` })
  author = await makeUser(`${tag}au`, { name: `Author ${tag}` })
  ev = makeEvent(`${tag}i`)
  evTitle = sql(`select title from events where id = '${ev.id}'`)
  sql(`insert into site_roles (user_id, role) values ('${mod.id}', 'moderator')`)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${tre.id}', 'treasurer'), ('${ev.id}', '${con.id}', 'content'), ('${ev.id}', '${chk.id}', 'checkin')`)
})

test('inbox: every kind appears for the right roles only, and the screen opens the right place', async ({ page }) => {
  // a report, a refund owed, a person waiting, a message waiting for a second admin
  const post = id(`insert into posts (author_id, body) values ('${author.id}', 'Inbox post ${tag}') returning id`)
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${plain.id}', 'post', '${post}', 'inbox-report ${tag}')`)
  const { reg, payment } = await register(buyer, ev, true)
  expect((await boss.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })).error).toBeNull()
  expect((await boss.db.rpc('admin_set_registration_status', { p_registration: reg.id, p_cancel: true, p_reason: 'asked to cancel', p_refunded: false, p_expected: null })).error).toBeNull()
  sql(`insert into event_waitlist (event_id, user_id, headcount, status) values ('${ev.id}', '${waiter.id}', 1, 'waiting')`)
  const msg = id(`insert into event_messages (event_id, title, body, audience, status, scheduled_for, created_by) values ('${ev.id}', 'Approve me ${tag}', 'A long message body that needs a second admin', '{}', 'pending_approval', now(), '${boss2.id}') returning id`)

  const kinds = async (u: TestUser) => (await inbox(u)).map((i) => i.kind).sort().join(',')
  expect(await kinds(boss)).toBe('approval,refund,report,waitlist')
  expect(await kinds(mod)).toBe('report')
  expect(await kinds(tre)).toBe('refund,waitlist')
  for (const u of [con, chk, plain]) expect((await u.db.rpc('admin_inbox')).error?.code, `${u.email} has no inbox`).toBe('42501')

  // items link to the screen that resolves them
  const hrefs = Object.fromEntries((await inbox(boss)).map((i) => [i.kind, i.href]))
  expect(hrefs.report).toBe('/admin/reports')
  expect(hrefs.refund).toBe(`/admin/events/${ev.slug}?tab=finance`)
  expect(hrefs.waitlist).toBe(`/admin/events/${ev.slug}?tab=waitlist`)
  expect(hrefs.approval).toBe(`/admin/events/${ev.slug}?tab=messages`)

  // the screen: treasurer sees refund + waiting list only, filters work
  await loginPage(page, tre, '/admin/inbox')
  const list = page.getByTestId('inbox')
  await expect(list.locator('[data-kind="refund"]').filter({ hasText: `Buyer ${tag}` })).toHaveCount(0) // the refund row is titled by the registration name
  await expect(list.locator('[data-kind="refund"]').filter({ hasText: evTitle })).toBeVisible()
  await expect(list.locator('[data-kind="waitlist"]').filter({ hasText: evTitle })).toBeVisible()
  await expect(list.locator('[data-kind="report"]').filter({ hasText: `inbox-report ${tag}` })).toHaveCount(0)
  await expect(list.locator('[data-kind="approval"]').filter({ hasText: tag })).toHaveCount(0)
  await page.getByRole('button', { name: /^Refunds/ }).click()
  await expect(list.locator('[data-kind="waitlist"]').filter({ hasText: evTitle })).toHaveCount(0)
  await list.locator('[data-kind="refund"]').filter({ hasText: evTitle }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${ev.slug}\\?tab=finance`))

  // moderator: the report only
  await loginPage(page, mod, '/admin/inbox')
  await expect(page.getByTestId('inbox').locator('[data-kind="report"]').filter({ hasText: `inbox-report ${tag}` })).toBeVisible()
  await expect(page.getByTestId('inbox').locator('[data-kind="refund"]').filter({ hasText: evTitle })).toHaveCount(0)

  // admin: all four
  await loginPage(page, boss, '/admin/inbox')
  for (const k of ['report', 'refund', 'waitlist', 'approval']) await expect(page.getByTestId('inbox').locator(`[data-kind="${k}"]`).filter({ hasText: k === 'report' ? `inbox-report ${tag}` : k === 'approval' ? tag : evTitle })).toBeVisible()

  // --- acting on each item makes it leave the inbox (and nobody else's)
  // report: dismissed on the Reports screen
  await loginPage(page, mod, '/admin/reports')
  const card = page.getByRole('listitem').filter({ hasText: `Inbox post ${tag}` })
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toHaveCount(0)
  expect(await kinds(mod)).toBe('')
  expect(await kinds(boss)).toBe('approval,refund,waitlist')
  // refund: recorded in full
  const held = Number(sql(`select amount_paise from event_payments where id = '${payment!.id}'`))
  expect((await tre.db.rpc('admin_record_refund', { p_payment: payment!.id, p_amount_paise: held, p_method: 'upi', p_reference: `RF${tag}`, p_note: 'refund', p_cancel: false })).error).toBeNull()
  expect(await kinds(tre)).toBe('waitlist')
  // waiting list: removed
  const entry = id(`select id from event_waitlist where event_id = '${ev.id}' and user_id = '${waiter.id}'`)
  expect((await tre.db.rpc('admin_remove_waitlist', { p_entry: entry, p_reason: 'no longer needed' })).error).toBeNull()
  expect(await kinds(tre)).toBe('')
  // approval: a second admin approves, the first admin cannot approve their own
  expect((await boss2.db.rpc('admin_review_event_message', { p_id: msg, p_approve: true, p_note: null })).error?.message ?? '').toMatch(/second admin|wrote it/i)
  expect((await boss.db.rpc('admin_review_event_message', { p_id: msg, p_approve: false, p_note: 'not needed' })).error).toBeNull()
  expect(await kinds(boss)).toBe('')
  expect(sql(`select status from event_messages where id = '${msg}'`)).toBe('rejected')
  expect(auditCount(`action = 'record_refund' and actor = '${tre.id}'`)).toBeGreaterThanOrEqual(1)
  expect(auditCount(`action = 'reject_event_message' and target_id = '${msg}'`)).toBe(1)
  expect(await boss.db.rpc('admin_inbox').then((r) => (r.data as { items: Item[] }).items.some((i) => i.title.includes(tag)))).toBe(false)
})

async function counts(page: Page) {
  return page.getByTestId('health').innerText()
}

test('health page shows real backup, storage and push values (and nothing to non-admins)', async ({ page }) => {
  const stamp = `Health ${tag}`
  const fresh = sql(`insert into system_events (kind, ok, detail, at) values ('backup', false, '${stamp} failed', now()) returning id`).split('\n')[0]!
  try {
    await loginPage(page, boss, '/admin/health')
    let h = await counts(page)
    expect(h).toContain('Failed')
    expect(h).toContain(`${stamp} failed`)
    expect(h).toMatch(/Last good backup/)
    // a good backup minutes later turns it OK
    const ok = sql(`insert into system_events (kind, ok, detail, at) values ('backup', true, '${stamp} ok', now() + interval '1 second') returning id`).split('\n')[0]!
    await page.reload()
    h = await counts(page)
    expect(h).toContain(`${stamp} ok`)
    await expect(page.getByTestId('health').getByText('OK').first()).toBeVisible()
    // a backup that is three days old is flagged as late
    sql(`delete from system_events where id in (${fresh}, ${ok}); delete from system_events where kind = 'backup' and at > now() - interval '2 days'`)
    sql(`insert into system_events (kind, ok, detail, at) values ('backup', true, '${stamp} old', now() - interval '3 days')`)
    await page.reload()
    await expect(page.getByTestId('health').getByText('Late')).toBeVisible()

    // storage: the numbers match the database
    const real = JSON.parse(sql(`select coalesce(json_agg(json_build_object('b', bucket_id, 'n', n)), '[]') from (select bucket_id, count(*) n from storage.objects group by 1) s`)) as { b: string; n: number }[]
    const rpc = (await boss.db.rpc('admin_health')).data as { storage: { bucket: string; objects: number }[]; push: { subscriptions: number; failures_24h: number | null }; members: number }
    for (const r of real) expect(rpc.storage.find((s) => s.bucket === r.b)?.objects).toBe(Number(r.n))
    expect(rpc.members).toBe(Number(sql('select count(*) from profiles')))
    expect(rpc.push.subscriptions).toBe(Number(sql('select count(*) from push_subscriptions')))
    // push failures: failed sends in the last day are counted
    const before = rpc.push.failures_24h
    if (before !== null) {
      sql(`insert into net._http_response (status_code, created, content) values (500, now(), 'verify ${tag}'), (200, now(), 'verify ${tag}')`)
      const after = ((await boss.db.rpc('admin_health')).data as typeof rpc).push.failures_24h
      expect(after).toBe(before + 1)
      sql(`delete from net._http_response where content = 'verify ${tag}'`)
    }
  } finally {
    sql(`delete from system_events where detail like '${stamp}%'`)
  }
  expect((await plain.db.rpc('admin_health')).error?.code).toBe('42501')
  expect((await mod.db.rpc('admin_health')).error?.code).toBe('42501')
  expect((await plain.db.from('system_events').select('id')).error?.code).toBe('42501')
})

test('community admin: reject and approve a circle, publish and remove a spotlight, set and delete a batch size; moderators and members cannot', async ({ page }) => {
  const year = 1960 + (Date.now() % 20)
  const circleA = id(`insert into groups (kind, slug, name, description, is_approved, created_by) values ('circle', 'cm-a-${tag}', 'Circle A ${tag}', 'About A', false, '${author.id}') returning id`)
  const circleB = id(`insert into groups (kind, slug, name, description, is_approved, created_by) values ('circle', 'cm-b-${tag}', 'Circle B ${tag}', 'About B', false, '${author.id}') returning id`)

  // not for moderators or members: screen and database
  await loginPage(page, mod, '/admin/community')
  await expect(page).not.toHaveURL(/\/admin\/community/)
  for (const u of [mod, plain]) {
    await u.db.from('groups').update({ is_approved: true }).eq('id', circleA)
    expect((await u.db.from('spotlights').insert({ profile_id: u.id, headline: 'sneaky' })).error).not.toBeNull()
    expect((await u.db.from('batch_sizes').upsert({ grad_year: year, branch: 'Civil Engineering', total: 9 })).error).not.toBeNull()
  }
  expect(sql(`select is_approved from groups where id = '${circleA}'`)).toBe('f')

  await loginPage(page, boss, '/admin/community')
  const a = page.locator('li').filter({ hasText: `Circle A ${tag}` })
  const b = page.locator('li').filter({ hasText: `Circle B ${tag}` })
  await expect(a).toContainText(`Author ${tag}`)
  // reject: confirm first (dismissing keeps it), then it is gone for good
  page.once('dialog', (d) => d.dismiss())
  await a.getByRole('button', { name: 'Reject' }).click()
  expect(sql(`select count(*) from groups where id = '${circleA}'`)).toBe('1')
  page.once('dialog', (d) => d.accept())
  await a.getByRole('button', { name: 'Reject' }).click()
  await expect(a).toHaveCount(0)
  expect(sql(`select count(*) from groups where id = '${circleA}'`)).toBe('0')
  expect(auditCount(`action = 'groups_delete' and actor = '${boss.id}'`)).toBeGreaterThanOrEqual(1)
  // approve: members can find it and join
  expect(((await plain.db.from('groups').select('id').eq('id', circleB)).data ?? []).length).toBe(0)
  await b.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Circle approved')).toBeVisible()
  expect(sql(`select is_approved from groups where id = '${circleB}'`)).toBe('t')
  expect(((await plain.db.from('groups').select('id').eq('id', circleB)).data ?? []).length).toBe(1)
  expect((await plain.db.rpc('join_group', { p_group: circleB, p_join: true })).error).toBeNull()
  expect(sql(`select count(*) from group_members where group_id = '${circleB}' and user_id = '${plain.id}'`)).toBe('1')

  // spotlight: appears on Home, removal takes it away
  await page.getByLabel('Member', { exact: true }).fill(`Author ${tag}`)
  await page.getByRole('button', { name: new RegExp(`Author ${tag}`) }).first().click()
  await page.getByLabel('Headline').fill(`Spotlight ${tag}`)
  await page.getByRole('button', { name: 'Publish spotlight' }).click()
  await expect(page.getByText('Spotlight published')).toBeVisible()
  expect(sql(`select count(*) from spotlights where headline = 'Spotlight ${tag}' and profile_id = '${author.id}'`)).toBe('1')
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 412, height: 915 } })
  const mp = await ctx.newPage()
  await loginPage(mp, plain, '/')
  await expect(mp.getByText(`Spotlight ${tag}`)).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove spotlight for Author ${tag}` }).click()
  await expect(page.getByText(`Spotlight ${tag}`)).toHaveCount(0)
  expect(sql(`select count(*) from spotlights where headline = 'Spotlight ${tag}'`)).toBe('0')
  await mp.reload()
  await expect(mp.getByText(`Spotlight ${tag}`)).toHaveCount(0)
  expect(auditCount(`action = 'spotlights_insert' and actor = '${boss.id}'`)).toBeGreaterThanOrEqual(1)
  expect(auditCount(`action = 'spotlights_delete' and actor = '${boss.id}'`)).toBeGreaterThanOrEqual(1)

  // batch size: validation, save, edit in place, delete
  await page.getByLabel('Passing-out year').selectOption({ index: 1 })
  const yr = await page.getByLabel('Passing-out year').inputValue()
  await page.getByLabel('Branch').selectOption({ index: 1 })
  const branch = await page.getByLabel('Branch').evaluate((s: HTMLSelectElement) => s.value)
  sql(`delete from batch_sizes where grad_year = ${yr} and branch = '${branch.replace(/'/g, "''")}'`)
  await page.getByLabel('Students').fill('120')
  await page.getByRole('button', { name: 'Save batch size' }).click()
  await expect(page.getByText(`Batch ${yr} · ${branch}`)).toBeVisible()
  expect(sql(`select total from batch_sizes where grad_year = ${yr} and branch = '${branch.replace(/'/g, "''")}'`)).toBe('120')
  await page.getByLabel('Students').fill('130')
  await page.getByRole('button', { name: 'Save batch size' }).click()
  await expect.poll(() => sql(`select total from batch_sizes where grad_year = ${yr} and branch = '${branch.replace(/'/g, "''")}'`)).toBe('130')
  await page.getByRole('button', { name: `Remove ${branch} ${yr}` }).click()
  await expect.poll(() => sql(`select count(*) from batch_sizes where grad_year = ${yr} and branch = '${branch.replace(/'/g, "''")}'`)).toBe('0')
  await ctx.close()
})

test('announcements: a content manager sends, registrants (not cancelled ones) are notified, pin and delete work; a treasurer cannot', async ({ page }) => {
  const live = await makeUser(`${tag}an1`, { name: `Anny ${tag}` })
  const gone = await makeUser(`${tag}an2`, { name: `Cancelled ${tag}` })
  await register(live, ev, false)
  const r2 = await register(gone, ev, false)
  sql(`update event_registrations set status = 'cancelled' where id = '${r2.reg.id}'`)

  await loginPage(page, con, `/admin/events/${ev.slug}?tab=programme`)
  await expect(page.getByText('Announcements')).toBeVisible()
  await page.getByLabel('Title').first().fill(`Gate opens ${tag}`)
  await page.getByLabel('Message').fill('Doors open at nine. Please bring your ticket.')
  await page.getByRole('button', { name: 'Send announcement' }).click()
  await expect(page.getByText(/^Sent to \d+ people/)).toBeVisible()
  const a = id(`select id from event_announcements where event_id = '${ev.id}' and title = 'Gate opens ${tag}'`)
  expect(sql(`select created_by from event_announcements where id = '${a}'`)).toBe(con.id)
  expect(auditCount(`action = 'post_announcement' and target_id = '${a}' and actor = '${con.id}'`)).toBe(1)
  expect(sql(`select count(*) from notifications where target_id = '${a}' and user_id = '${live.id}'`)).toBe('1')
  expect(sql(`select count(*) from notifications where target_id = '${a}' and user_id = '${gone.id}'`)).toBe('0')
  expect(sql(`select count(*) from notifications where target_id = '${a}' and user_id = '${con.id}'`)).toBe('0')
  // the registrant sees it
  expect(((await live.db.from('event_announcements').select('title').eq('id', a)).data ?? []).length).toBe(1)

  // pin and unpin
  await page.getByRole('button', { name: `Pin Gate opens ${tag}` }).click()
  await expect.poll(() => sql(`select pinned from event_announcements where id = '${a}'`)).toBe('t')
  await page.getByRole('button', { name: `Unpin Gate opens ${tag}` }).click()
  await expect.poll(() => sql(`select pinned from event_announcements where id = '${a}'`)).toBe('f')
  // delete asks first
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: `Delete Gate opens ${tag}` }).click()
  expect(sql(`select count(*) from event_announcements where id = '${a}'`)).toBe('1')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Delete Gate opens ${tag}` }).click()
  await expect.poll(() => sql(`select count(*) from event_announcements where id = '${a}'`)).toBe('0')

  // others cannot
  expect((await tre.db.rpc('post_announcement', { p_event: ev.id, p_title: 'Treasurer note', p_body: 'Not allowed', p_pinned: false })).error?.code).toBe('42501')
  expect((await plain.db.from('event_announcements').insert({ event_id: ev.id, title: 'Sneaky', body: 'Not allowed' })).error).not.toBeNull()
  expect((await live.db.from('event_announcements').delete().eq('event_id', ev.id)).error ?? null).toBeDefined()
  expect(sql(`select count(*) from event_announcements where event_id = '${ev.id}' and title = 'Sneaky'`)).toBe('0')
})
