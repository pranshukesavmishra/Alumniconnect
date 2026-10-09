import { expect, test } from '@playwright/test'
import { sql } from './helpers'
import { loginPage, makeEvent, makeUser, register, ts } from './verify/admin-lib'

// Admin pass 4: granular roles, moderation, message safety, inbox, activity-log filters, view as member.
// Every check reads the database as well as the screen. All data is created by this run.
const tag = `rl${ts}`.slice(0, 10)
test.use({ viewport: { width: 412, height: 915 } })

test('each role sees its own tabs, and the database refuses what the tab hides', async ({ browser }) => {
  const boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  const tre = await makeUser(`${tag}tre`, { name: `Tre ${tag}` })
  const con = await makeUser(`${tag}con`, { name: `Con ${tag}` })
  const buyer = await makeUser(`${tag}buy`)
  const ev = makeEvent(`${tag}a`)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${tre.id}', 'treasurer'), ('${ev.id}', '${con.id}', 'content')`)
  const { payment } = await register(buyer, ev, true)

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const page = await ctx.newPage()
  await loginPage(page, tre, `/admin/events/${ev.slug}`)
  const tabs = page.getByRole('tablist').first()
  for (const t of ['Payments', 'Finance', 'Waitlist', 'People']) await expect(tabs.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible()
  for (const t of ['Messages', 'Programme', 'Team', 'Settings']) await expect(tabs.getByRole('tab', { name: t })).toHaveCount(0)

  await loginPage(page, con, `/admin/events/${ev.slug}`)
  for (const t of ['Messages', 'Programme', 'People']) await expect(page.getByRole('tablist').first().getByRole('tab', { name: t })).toBeVisible()
  for (const t of ['Payments', 'Finance', 'Waitlist', 'Overview']) await expect(page.getByRole('tablist').first().getByRole('tab', { name: new RegExp(`^${t}`) })).toHaveCount(0)

  // the same limits hold when the screen is bypassed
  expect((await con.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })).error?.code).toBe('42501')
  expect((await tre.db.rpc('admin_send_event_message', { p_event: ev.id, p_kind: 'announcement', p_title: 'Hello all', p_body: 'Body text', p_audience: {}, p_send_at: null })).error?.code).toBe('42501')
  expect((await tre.db.rpc('admin_grant_role', { p_user: tre.id, p_role: 'admin', p_event: null, p_note: null })).error?.code).toBe('42501')
  expect(sql(`select status from event_payments where id = '${payment!.id}'`)).toBe('submitted')
  expect((await tre.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })).error).toBeNull()
  expect(sql(`select status from event_payments where id = '${payment!.id}'`)).toBe('verified')
  expect(sql(`select is_admin from profiles where id = '${boss.id}'`)).toBe('t')
  await ctx.close()
})

test('roles page: give and remove a moderator with confirmation, no self-demotion, audit and activity-log filter', async ({ page }) => {
  const boss = await makeUser(`${tag}rb`, { admin: true, name: `Roleboss ${tag}` })
  await makeUser(`${tag}rm`, { name: `Rolemod ${tag}` })
  await loginPage(page, boss, '/admin/roles')
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
  await page.getByLabel('Role', { exact: true }).selectOption('moderator')
  await page.getByLabel('Search members by name').fill(`Rolemod ${tag}`)
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: `Give role: Rolemod ${tag}` }).click()
  expect(sql(`select count(*) from site_roles where user_id = (select id from auth.users where email like 'adm-${ts}-${tag}rm@%')`)).toBe('0')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Give role: Rolemod ${tag}` }).click()
  await expect(page.getByTestId('moderators-list').getByText(`Rolemod ${tag}`)).toBeVisible()
  expect(sql(`select count(*) from site_roles where role = 'moderator' and user_id = (select id from auth.users where email like 'adm-${ts}-${tag}rm@%')`)).toBe('1')
  expect(sql(`select count(*) from admin_audit where action = 'role_grant' and details->>'name' = 'Rolemod ${tag}'`)).toBe('1')

  // an admin has no remove button on their own row, and the database refuses too
  await expect(page.getByRole('button', { name: `Remove admin access from Roleboss ${tag}` })).toHaveCount(0)
  expect((await boss.db.rpc('admin_revoke_role', { p_user: boss.id, p_role: 'admin', p_event: null, p_note: null })).error?.message).toContain('your own admin access')

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove moderator role from Rolemod ${tag}` }).click()
  await expect(page.getByTestId('moderators-list')).toHaveCount(0)
  expect(sql(`select count(*) from site_roles where user_id = (select id from auth.users where email like 'adm-${ts}-${tag}rm@%')`)).toBe('0')

  // activity log: filter to roles, search by name
  await page.goto('/admin/activity')
  await page.getByRole('button', { name: 'Roles', exact: true }).click()
  const rows = page.getByTestId('audit-rows').locator('[data-action]')
  await expect(rows.first()).toBeVisible()
  expect(await rows.evaluateAll((els) => els.every((e) => ['role_grant', 'role_revoke', 'set_member_flags', 'event_staff_insert', 'event_staff_update', 'event_staff_delete'].includes(e.getAttribute('data-action')!)))).toBe(true)
  await page.getByLabel('Search the activity log').fill(`Rolemod ${tag}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Removed a role').first()).toBeVisible()
  await page.getByLabel('Search the activity log').fill(`zzz-none-${tag}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText('Nothing matches')).toBeVisible()
})

test('moderator: reports, hide, slow mode, inbox; nothing else', async ({ page }) => {
  const mod = await makeUser(`${tag}md`, { name: `Moddy ${tag}` })
  const author = await makeUser(`${tag}au`, { name: `Author ${tag}` })
  const rep = await makeUser(`${tag}rp`)
  sql(`insert into site_roles (user_id, role) values ('${mod.id}', 'moderator')`)
  const post = sql(`insert into posts (author_id, body) values ('${author.id}', 'Spam post ${tag}') returning id`).split('\n')[0]!
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${rep.id}', 'post', '${post}', 'spam ${tag}')`)
  const group = sql(`insert into groups (kind, slug, name) values ('circle', 'slow-${tag}', 'Slow ${tag}') returning id`).split('\n')[0]!

  await loginPage(page, mod, '/admin')
  await expect(page.getByText('Signed in as Moderator')).toBeVisible()
  await expect(page.getByRole('link', { name: /Members/ })).toHaveCount(0)
  await page.goto('/admin/inbox')
  await expect(page.getByTestId('inbox').locator('[data-kind="report"]').first()).toBeVisible()
  await page.goto('/admin/reports')
  const card = page.getByRole('listitem').filter({ hasText: `Spam post ${tag}` })
  page.once('dialog', (d) => d.accept())
  await card.getByRole('button', { name: 'Hide' }).click()
  await expect(card).toHaveCount(0)
  expect(sql(`select is_hidden from posts where id = '${post}'`)).toBe('t')
  await page.getByLabel('Group or channel').selectOption(group)
  await page.getByRole('button', { name: '30 s' }).click()
  await expect(page.getByText('Slow mode: 30 seconds')).toBeVisible()
  expect(sql(`select slow_mode_seconds from groups where id = '${group}'`)).toBe('30')
  expect(sql(`select count(*) from admin_audit where action = 'hide_post' and actor = '${mod.id}'`)).toBe('1')

  // not the member list, roles, activity log, or other people's money
  await page.goto('/admin/members')
  await expect(page).not.toHaveURL(/\/admin\/members$/)
  await page.goto('/admin/roles')
  await expect(page).toHaveURL(/\/admin$/)
  expect((await mod.db.rpc('admin_update_member', { p_id: author.id, p_fields: { headline: 'x' } })).error?.code).toBe('42501')
})

test('large messages wait for a second admin; preview shows the final text', async ({ page, browser }) => {
  const a1 = await makeUser(`${tag}a1`, { admin: true, name: `Adm1 ${tag}` })
  const a2 = await makeUser(`${tag}a2`, { admin: true, name: `Adm2 ${tag}` })
  const ev = makeEvent(`${tag}m`)
  const buyer = await makeUser(`${tag}by`)
  await register(buyer, ev, false)
  // a message that was submitted for approval (the audience size rule itself is covered by the database suite)
  const msg = sql(`insert into event_messages (event_id, kind, title, body, audience, status, created_by) values ('${ev.id}', 'announcement', 'Big ${tag}', 'Please read this', '{"segment":"registered"}', 'pending_approval', '${a1.id}') returning id`).split('\n')[0]!

  await loginPage(page, a1, `/admin/events/${ev.slug}?tab=messages`)
  await page.getByLabel('Title').fill(`Hello ${tag}`)
  await page.getByLabel('Message').fill('See you all there')
  await expect(page.getByTestId('message-preview')).toContainText(`Hello ${tag}`)
  await expect(page.getByTestId('message-preview')).toContainText('See you all there')
  // the author sees it waiting but cannot approve it
  const mine = page.getByRole('listitem').filter({ hasText: `Big ${tag}` })
  await expect(mine).toContainText('Waiting for a second admin')
  await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  expect((await a1.db.rpc('admin_review_event_message', { p_id: msg, p_approve: true, p_note: null })).error?.message).toContain('second admin')

  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const p2 = await ctx2.newPage()
  await loginPage(p2, a2, '/admin/inbox')
  await expect(p2.getByTestId('inbox').locator('[data-kind="approval"]').filter({ hasText: `Big ${tag}` })).toBeVisible()
  await p2.goto(`/admin/events/${ev.slug}?tab=messages`)
  p2.once('dialog', (d) => d.accept())
  await p2.getByRole('listitem').filter({ hasText: `Big ${tag}` }).getByRole('button', { name: 'Approve' }).click()
  await expect(p2.getByRole('listitem').filter({ hasText: `Big ${tag}` })).toContainText('Sent to 1')
  expect(sql(`select status || ':' || recipient_count from event_messages where id = '${msg}'`)).toBe('sent:1')
  expect(sql(`select count(*) from notifications where user_id = '${buyer.id}' and body like 'Big ${tag}%'`)).toBe('1')
  await ctx2.close()
})

test('view as member is read-only and hides contact details', async ({ page }) => {
  const boss = await makeUser(`${tag}vb`, { admin: true })
  const m = await makeUser(`${tag}vm`, { name: `Viewed ${tag}`, phone: '+91 97531 24680' })
  const ev = makeEvent(`${tag}v`)
  const { reg } = await register(m, ev, true)
  const before = sql(`select count(*) || ':' || max(updated_at) from event_registrations where id = '${reg.id}'`)
  await loginPage(page, boss, `/admin/members/${m.id}/preview`)
  const view = page.getByTestId('member-preview')
  await expect(view).toContainText(`Viewed ${tag}`)
  await expect(view).toContainText(reg.code)
  await expect(page.getByText('Read-only preview of')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('97531')
  await expect(view.getByRole('button')).toHaveCount(0)
  expect(sql(`select count(*) || ':' || max(updated_at) from event_registrations where id = '${reg.id}'`)).toBe(before)
  expect(sql(`select count(*) from admin_audit where action = 'view_as_member' and target_id = '${m.id}'`)).toBe('1')
  // a non-admin gets nothing
  expect((await m.db.rpc('admin_view_as_member', { p_member: boss.id })).error?.code).toBe('42501')
})
