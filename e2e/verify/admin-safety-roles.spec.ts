// Roles page and Team tab, end to end: UI action -> database rows -> activity log -> what the affected member sees (and no longer sees).
import { expect, test, type Page } from '@playwright/test'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `sr${ts}`.slice(0, 9)

let boss: TestUser, sup: TestUser, ev: ReturnType<typeof makeEvent>, evTitle: string
const people: Record<string, TestUser> = {}
const nameOf = (k: string) => `Sfty ${k} ${tag}`

test.beforeAll(async () => {
  boss = await makeUser(`${tag}boss`, { admin: true, name: nameOf('Boss') })
  // admin access has its own door now: a super admin makes and removes admins (everything else an ordinary admin still does)
  sup = await makeUser(`${tag}sup`, { admin: true, name: nameOf('Sup') })
  sql(`update profiles set is_super_admin = true where id = '${sup.id}'`)
  for (const k of ['Tre', 'Con', 'Chk', 'Mod', 'Adm']) people[k] = await makeUser(`${tag}${k}`, { name: nameOf(k) })
  ev = makeEvent(`${tag}r`)
  evTitle = sql(`select title from events where id = '${ev.id}'`)
})

/** Search for the person and press "Give role" for them (the role / event selects are set first). */
async function give(page: Page, role: string, who: string, opts: { event?: boolean; accept: boolean }) {
  await page.getByLabel('Role', { exact: true }).selectOption(role)
  if (opts.event) await page.getByLabel('Event', { exact: true }).selectOption({ label: evTitle })
  await page.getByLabel('Search members by name').fill(nameOf(who))
  const btn = page.getByRole('button', { name: `Give role: ${nameOf(who)}` })
  await expect(btn).toBeVisible()
  page.once('dialog', (d) => (opts.accept ? d.accept() : d.dismiss()))
  await btn.click()
}

test('grant: dismissing the confirmation changes nothing; accepting writes the row, the audit entry and shows in the list', async ({ page }) => {
  await loginPage(page, boss, '/admin/roles')
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
  const t = people.Tre!
  await give(page, 'treasurer', 'Tre', { event: true, accept: false })
  expect(sql(`select count(*) from event_staff where user_id = '${t.id}'`)).toBe('0')
  expect(auditCount(`action = 'role_grant' and target_id = '${t.id}'`)).toBe(0)

  const grants: [string, string, boolean][] = [['treasurer', 'Tre', true], ['content', 'Con', true], ['checkin', 'Chk', true], ['moderator', 'Mod', false]]
  for (const [role, who, evRole] of grants) {
    await give(page, role, who, { event: evRole, accept: true })
    await expect(page.getByText(/is now|already had/).first()).toBeVisible()
    const u = people[who]!
    if (evRole) expect(sql(`select count(*) from event_staff where user_id = '${u.id}' and event_id = '${ev.id}' and role = '${role}'`)).toBe('1')
    else if (role === 'moderator') expect(sql(`select count(*) from site_roles where user_id = '${u.id}' and role = 'moderator'`)).toBe('1')
    else expect(sql(`select is_admin from profiles where id = '${u.id}'`)).toBe('t')
    expect(auditCount(`action = 'role_grant' and target_id = '${u.id}' and details->>'role' = '${role}' and actor = '${boss.id}'`)).toBe(1)
    if (evRole) expect(sql(`select details->>'event' from admin_audit where action = 'role_grant' and target_id = '${u.id}'`)).toBe(evTitle)
  }
  // admin access is not a role any more: an ordinary admin cannot give it, a super admin does, with its own log entry
  expect((await boss.db.rpc('admin_grant_role', { p_user: people.Adm!.id, p_role: 'admin', p_event: null, p_note: null })).error?.code).toBe('42501')
  expect((await sup.db.rpc('admin_set_admin', { p_user: people.Adm!.id, p_enabled: true, p_permissions: null, p_note: null })).error).toBeNull()
  expect(sql(`select is_admin from profiles where id = '${people.Adm!.id}'`)).toBe('t')
  expect(auditCount(`action = 'admin_granted' and target_id = '${people.Adm!.id}' and actor = '${sup.id}'`)).toBe(1)
  // giving the same role again is harmless: no second row, no second audit entry
  await give(page, 'treasurer', 'Tre', { event: true, accept: true })
  await expect(page.getByText(/already had this role/)).toBeVisible()
  expect(sql(`select count(*) from event_staff where user_id = '${t.id}'`)).toBe('1')
  expect(auditCount(`action = 'role_grant' and target_id = '${t.id}'`)).toBe(1)

  // the page lists everyone (reload: the new admin was made through the function while the page was open)
  await page.reload()
  await expect(page.getByTestId('admins-list')).toContainText(nameOf('Adm'))
  await expect(page.getByTestId('moderators-list')).toContainText(nameOf('Mod'))
  const team = page.getByTestId('event-team').filter({ hasText: evTitle })
  for (const k of ['Tre', 'Con', 'Chk']) await expect(team).toContainText(nameOf(k))
})

test('the new role holders see exactly their screens, and the database lets them do exactly their jobs', async ({ browser }) => {
  const buyer = await makeUser(`${tag}buy`)
  const { payment, reg } = await register(buyer, ev, true)
  const T = people.Tre!, C = people.Con!, K = people.Chk!, M = people.Mod!, A = people.Adm!

  const open = async (u: TestUser, path: string) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
    const page = await ctx.newPage()
    await loginPage(page, u, path)
    return { ctx, page }
  }
  const tabs = (page: Page) => page.getByRole('tablist').first()

  // treasurer
  let v = await open(T, '/admin')
  await expect(v.page.getByTestId('my-access')).toContainText('Treasurer')
  await v.page.goto(`/admin/events/${ev.slug}`)
  await expect(tabs(v.page).getByRole('tab', { name: /^Payments/ })).toBeVisible()
  await expect(tabs(v.page).getByRole('tab', { name: 'Messages' })).toHaveCount(0)
  await expect(tabs(v.page).getByRole('tab', { name: 'Team' })).toHaveCount(0)
  await v.ctx.close()
  expect((await T.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })).error).toBeNull()
  expect(sql(`select status from event_payments where id = '${payment!.id}'`)).toBe('verified')
  expect(sql(`select status from event_registrations where id = '${reg.id}'`)).toBe('confirmed')
  expect((await T.db.rpc('admin_grant_role', { p_user: T.id, p_role: 'admin', p_event: null, p_note: null })).error?.code).toBe('42501')

  // content manager
  v = await open(C, `/admin/events/${ev.slug}`)
  await expect(tabs(v.page).getByRole('tab', { name: 'Messages' })).toBeVisible()
  await expect(tabs(v.page).getByRole('tab', { name: 'Programme' })).toBeVisible()
  await expect(tabs(v.page).getByRole('tab', { name: /^Payments/ })).toHaveCount(0)
  await v.ctx.close()
  expect((await C.db.rpc('post_announcement', { p_event: ev.id, p_title: 'Content says hello', p_body: 'Body of the announcement', p_pinned: false })).error).toBeNull()
  expect(sql(`select count(*) from event_announcements where event_id = '${ev.id}' and title = 'Content says hello'`)).toBe('1')
  expect((await C.db.rpc('admin_event_ledger', { p_event: ev.id })).error?.code).toBe('42501')
  expect((await C.db.from('event_payments').select('id')).data).toEqual([])

  // check-in volunteer: the door only
  v = await open(K, `/admin/events/${ev.slug}/check-in`)
  await expect(v.page.locator('body')).toContainText(/Check-in|Scan|Find|ticket/i)
  await v.ctx.close()
  const found = await K.db.rpc('checkin_search', { p_event: ev.id, p_q: 'Reg' })
  expect(found.error).toBeNull()
  expect(JSON.stringify(found.data)).not.toMatch(/90000 12345|"email"|"phone"|amount_paise|utr/)
  expect((await K.db.rpc('admin_attendance_report', { p_event: ev.id })).error?.code).toBe('42501')
  expect((await K.db.from('event_registrations').select('id')).data).toEqual([])

  // moderator: reports and slow mode, nothing else
  v = await open(M, '/admin')
  await expect(v.page.getByTestId('my-access')).toContainText('Moderator')
  await expect(v.page.getByRole('link', { name: /Members/ })).toHaveCount(0)
  await v.ctx.close()
  expect((await M.db.rpc('admin_reports', { p_status: 'open' })).error).toBeNull()
  expect((await M.db.rpc('admin_set_member', { p_id: buyer.id, p_is_admin: null, p_verification: 'rejected' })).error?.code).toBe('42501')
  expect((await M.db.rpc('review_payment', { p_payment: payment!.id, p_approve: false, p_note: null })).error?.code).toBe('42501')

  // new admin: everything
  v = await open(A, '/admin')
  await expect(v.page.getByTestId('my-access')).toContainText('Admin')
  await expect(v.page.getByRole('link', { name: /Members/ }).first()).toBeVisible()
  await v.page.goto('/admin/roles')
  await expect(v.page.getByRole('heading', { name: 'Roles' })).toBeVisible()
  await v.ctx.close()
  expect((await A.db.rpc('admin_roles_overview')).error).toBeNull()
})

test('revoke: dismissing keeps the role, accepting removes it, the audit logs it, and the person loses access at once', async ({ page, browser }) => {
  await loginPage(page, sup, '/admin/roles')
  const T = people.Tre!, C = people.Con!, K = people.Chk!, M = people.Mod!, A = people.Adm!

  // keep: dismiss the confirmation
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: `Remove Treasurer role from ${nameOf('Tre')} on ${evTitle}` }).click()
  expect(sql(`select count(*) from event_staff where user_id = '${T.id}'`)).toBe('1')

  for (const [label, who, u] of [['Treasurer', 'Tre', T], ['Content manager', 'Con', C], ['Check-in volunteer', 'Chk', K]] as const) {
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: `Remove ${label} role from ${nameOf(who)} on ${evTitle}` }).click()
    await expect(page.getByText('Role removed').first()).toBeVisible()
    expect(sql(`select count(*) from event_staff where user_id = '${u.id}'`)).toBe('0')
    expect(auditCount(`action = 'role_revoke' and target_id = '${u.id}' and actor = '${sup.id}'`)).toBe(1)
  }
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove moderator role from ${nameOf('Mod')}` }).click()
  await expect(page.getByText(nameOf('Mod'))).toHaveCount(0)
  expect(sql(`select count(*) from site_roles where user_id = '${M.id}'`)).toBe('0')

  // another admin can be removed (not yourself, not the last one)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove admin access from ${nameOf('Adm')}` }).click()
  await expect(page.getByTestId('admins-list')).not.toContainText(nameOf('Adm'))
  expect(sql(`select is_admin from profiles where id = '${A.id}'`)).toBe('f')
  expect(auditCount(`action = 'admin_removed' and target_id = '${A.id}' and actor = '${sup.id}'`)).toBe(1)
  await expect(page.getByRole('button', { name: `Remove admin access from ${nameOf('Sup')}` })).toHaveCount(0)

  // the people who lost a role are locked out, by screen and by database
  const buyer = await makeUser(`${tag}buy2`)
  const { payment } = await register(buyer, ev, true)
  for (const [u, call] of [
    [T, () => T.db.rpc('review_payment', { p_payment: payment!.id, p_approve: true, p_note: null })],
    [C, () => C.db.rpc('post_announcement', { p_event: ev.id, p_title: 'Still here', p_body: 'Should be refused', p_pinned: false })],
    [K, () => K.db.rpc('checkin_search', { p_event: ev.id, p_q: 'Reg' })],
    [M, () => M.db.rpc('admin_reports', { p_status: 'open' })],
    [A, () => A.db.rpc('admin_roles_overview')],
  ] as const) {
    expect((await call()).error?.code, `${u.email} should be refused after losing the role`).toBe('42501')
  }
  expect(sql(`select status from event_payments where id = '${payment!.id}'`)).toBe('submitted')
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const p2 = await ctx.newPage()
  await loginPage(p2, T, `/admin/events/${ev.slug}`)
  await expect(p2.getByRole('tab', { name: /^Payments/ })).toHaveCount(0)
  await loginPage(p2, A, '/admin/roles')
  await expect(p2).toHaveURL(/\/(admin)?$/)
  await ctx.close()
})

test('the last admin and yourself are protected in the database, whatever the screen says', async () => {
  // yourself: an ordinary admin has no door at all, a super admin cannot use it on themselves
  const self = await boss.db.rpc('admin_revoke_role', { p_user: boss.id, p_role: 'admin', p_event: null, p_note: null })
  expect(self.error?.message).toContain('super admin only')
  expect((await sup.db.rpc('admin_set_admin', { p_user: sup.id, p_enabled: false, p_permissions: null, p_note: null })).error?.message).toContain('Ownership is locked')
  expect(sql(`select is_admin from profiles where id = '${boss.id}'`)).toBe('t')
  // the last admin: even a direct update by the table owner is refused (one -c string = one transaction, so the first update is rolled back too)
  let message = ''
  try {
    sql(`update profiles set is_admin = false where is_admin and not is_super_admin and id <> '${sup.id}'; update profiles set is_admin = false where id = '${sup.id}'`)
  } catch (e) {
    message = String((e as { stderr?: string }).stderr ?? e)
  }
  expect(message).toMatch(/There must always be at least one admin|profiles_super_is_admin/) // (an owner is an admin: the database refuses either way)
  expect(sql(`select is_admin from profiles where id = '${sup.id}'`)).toBe('t')
  expect(Number(sql(`select count(*) from profiles where is_admin`))).toBeGreaterThanOrEqual(1)
})

test('Team tab: add and remove treasurer, content and check-in on one event; legacy manager rows become treasurer + content', async ({ page }) => {
  const evT = makeEvent(`${tag}t`)
  const evTTitle = sql(`select title from events where id = '${evT.id}'`)
  const a = await makeUser(`${tag}tA`, { name: nameOf('TeamA') })
  const b = await makeUser(`${tag}tB`, { name: nameOf('TeamB') })
  const c = await makeUser(`${tag}tC`, { name: nameOf('TeamC') })
  const legacy = await makeUser(`${tag}tL`, { name: nameOf('Legacy') })
  await loginPage(page, boss, `/admin/events/${evT.slug}?tab=team`)
  await expect(page.getByText('Team for this event')).toBeVisible()
  await expect(page.getByText('No one added yet')).toBeVisible()

  for (const [role, label, u, who] of [['treasurer', 'Treasurer', a, 'TeamA'], ['content', 'Content manager', b, 'TeamB'], ['checkin', 'Check-in volunteer', c, 'TeamC']] as const) {
    await page.getByLabel('Role', { exact: true }).selectOption(role)
    await page.getByLabel('Search members by name').fill(nameOf(who))
    page.once('dialog', (d) => {
      expect(d.message()).toContain(`Give ${nameOf(who)} the ${label} role for ${evTTitle}`)
      return d.accept()
    })
    await page.getByRole('button', { name: `Give role: ${nameOf(who)}` }).click()
    await expect(page.getByTestId('team-list').locator(`[data-role="${role}"]`)).toContainText(nameOf(who))
    expect(sql(`select role || ':' || granted_by from event_staff where event_id = '${evT.id}' and user_id = '${u.id}'`)).toBe(`${role}:${boss.id}`)
    expect(auditCount(`action = 'role_grant' and target_id = '${u.id}' and details->>'event_id' = '${evT.id}'`)).toBe(1)
  }
  // the team of event 1 is not the team of event 2
  expect(sql(`select count(*) from event_staff where event_id = '${ev.id}' and user_id in ('${a.id}','${b.id}','${c.id}')`)).toBe('0')
  expect((await a.db.rpc('admin_event_ledger', { p_event: ev.id })).error?.code).toBe('42501')
  expect((await a.db.rpc('admin_event_ledger', { p_event: evT.id })).error).toBeNull()

  // legacy 'manager' (older scripts / data) maps to treasurer + content and the Team tab shows both
  sql(`insert into event_staff (event_id, user_id, role) values ('${evT.id}', '${legacy.id}', 'manager')`)
  expect(sql(`select string_agg(role, ',' order by role) from event_staff where event_id = '${evT.id}' and user_id = '${legacy.id}'`)).toBe('content,treasurer')
  expect(sql(`select count(*) from event_staff where role = 'manager'`)).toBe('0')
  await page.reload()
  const rows = page.getByTestId('team-list').getByText(nameOf('Legacy'))
  await expect(rows).toHaveCount(2)
  expect((await legacy.db.rpc('admin_event_ledger', { p_event: evT.id })).error).toBeNull()
  expect((await legacy.db.rpc('admin_message_preview', { p_event: evT.id, p_audience: {} })).error).toBeNull()

  // remove through the tab
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove Treasurer role from ${nameOf('TeamA')}` }).click()
  await expect(page.getByTestId('team-list')).not.toContainText(nameOf('TeamA'))
  expect(sql(`select count(*) from event_staff where event_id = '${evT.id}' and user_id = '${a.id}'`)).toBe('0')
  expect(auditCount(`action = 'role_revoke' and target_id = '${a.id}'`)).toBe(1)
  expect((await a.db.rpc('admin_event_ledger', { p_event: evT.id })).error?.code).toBe('42501')
  // a member cannot reach the Team tab at all
  const m = await makeUser(`${tag}tM`)
  expect((await m.db.from('event_staff').select('user_id').eq('event_id', evT.id)).data).toEqual([])
  expect((await m.db.rpc('admin_grant_role', { p_user: m.id, p_role: 'treasurer', p_event: evT.id, p_note: null })).error?.code).toBe('42501')
})
