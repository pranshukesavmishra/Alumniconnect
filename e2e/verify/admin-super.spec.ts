// Super admins and permission-scoped admins, end to end: what a super admin does on /admin/roles changes rows in the database,
// the activity log and notifications, changes what the affected admin sees at once, and the database refuses everything else.
import { expect, test, type Page } from '@playwright/test'
import { PERMISSION_KEYS } from '../../src/lib/adminAccess'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `su${ts}`.slice(0, 9)
const nameOf = (k: string) => `Supa ${k} ${tag}`

let boss: TestUser, ordinary: TestUser, mod: TestUser, second: TestUser, heir: TestUser, victim: TestUser, plain: TestUser
let ev: ReturnType<typeof makeEvent>
let payment: { id: string }

test.beforeAll(async () => {
  boss = await makeUser(`${tag}boss`, { admin: true, name: nameOf('Boss') })
  sql(`update profiles set is_super_admin = true where id = '${boss.id}'`)
  ordinary = await makeUser(`${tag}ord`, { admin: true, name: nameOf('Ordinary') })
  mod = await makeUser(`${tag}mod`, { name: nameOf('Mod') })
  second = await makeUser(`${tag}sec`, { name: nameOf('Second') })
  heir = await makeUser(`${tag}heir`, { name: nameOf('Heir') })
  victim = await makeUser(`${tag}vic`, { name: nameOf('Victim') })
  plain = await makeUser(`${tag}plain`, { name: nameOf('Plain') })
  ev = makeEvent(`${tag}e`)
  payment = (await register(victim, ev, true)).payment!
})

async function refused(p: PromiseLike<{ error: { code?: string; message?: string } | null }>) {
  const r = await p
  expect(r.error?.code, r.error?.message).toBe('42501')
}
const notes = (id: string) => Number(sql(`select count(*) from notifications where user_id = '${id}' and kind = 'admin_access'`))

async function openAs(page: Page, u: TestUser, path: string) {
  await loginPage(page, u, path)
}

test('the permission list in the app is the permission list in the database', () => {
  expect(PERMISSION_KEYS.join(',')).toBe(sql(`select string_agg(key, ',' order by sort) from _permission_catalog()`))
})

test('a super admin makes a Moderation-only admin through the wizard: database, activity log and notification all agree', async ({ page }) => {
  await openAs(page, boss, '/admin/roles')
  const section = page.getByTestId('admins-and-owners')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('admins-list')).toContainText(nameOf('Boss'))
  await expect(section.getByTestId('admins-list')).toContainText('Super admin')
  await expect(section.getByRole('button', { name: 'Make admin', exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: 'Transfer ownership', exact: true })).toBeVisible()

  await section.getByRole('button', { name: 'Make admin', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Make admin' })
  await dialog.getByLabel('Search members by name').fill(nameOf('Mod'))
  await dialog.getByRole('button', { name: `Choose: ${nameOf('Mod')}` }).click()
  // dismissing at the review step changes nothing
  await dialog.getByText('Moderation only', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Review' }).click()
  const review = dialog.getByTestId('review')
  await expect(review).toContainText('Moderation only')
  await expect(review).toContainText('Reports')
  await expect(review).toContainText('Slow mode')
  await expect(review).toContainText('will not be able to')
  expect(sql(`select count(*) from admin_grants where user_id = '${mod.id}'`)).toBe('0')
  await dialog.getByLabel('Note').fill('Moderator for the 2005 batch')
  await dialog.getByRole('button', { name: `Make ${nameOf('Mod')} an admin` }).click()
  await expect(page.getByText(`${nameOf('Mod')} is now an admin`)).toBeVisible()

  expect(sql(`select is_admin::text || ' ' || is_super_admin::text from profiles where id = '${mod.id}'`)).toBe('true false')
  expect(sql(`select array_to_string(permissions, ',') from admin_grants where user_id = '${mod.id}'`)).toBe('moderation_hide,moderation_meetups,moderation_reports,moderation_slowmode')
  expect(sql(`select note from admin_grants where user_id = '${mod.id}'`)).toBe('Moderator for the 2005 batch')
  expect(auditCount(`action = 'admin_granted' and target_id = '${mod.id}' and actor = '${boss.id}'`)).toBe(1)
  expect(notes(mod.id)).toBe(1)
  const row = section.getByTestId('admins-list').locator(`[data-admin="${mod.id}"]`)
  await expect(row).toContainText('Limited admin')
  await expect(row).toContainText('Hide and restore content')
})

test('that admin sees only the moderation and inbox tiles; the other screens say who to ask; the database refuses the rest', async ({ page }) => {
  await openAs(page, mod, '/admin')
  await expect(page.getByTestId('my-access')).toContainText('Admin (4 permissions)')
  await expect(page.getByRole('link', { name: /^Reports/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Inbox/ })).toBeVisible()
  for (const t of ['Members', 'Analytics', 'Community', 'Roles', 'Health', 'Activity log']) await expect(page.getByRole('link', { name: new RegExp(`^${t}`) })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'New event' })).toHaveCount(0)

  for (const path of ['/admin/members', '/admin/analytics', '/admin/activity', '/admin/health', '/admin/community', '/admin/roles', '/admin/members/import']) {
    await page.goto(path)
    await expect(page.getByTestId('no-access'), path).toContainText('Ask a super admin to give you access')
  }
  await page.goto('/admin/reports')
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()

  const db = mod.db
  await refused(db.rpc('admin_list_members', { p_filter: {}, p_limit: 5, p_offset: 0, p_ids_only: false }))
  await refused(db.rpc('admin_export_members', { p_ids: [victim.id], p_contact: true }))
  await refused(db.rpc('admin_member_email', { p_id: victim.id }))
  await refused(db.rpc('admin_set_member', { p_id: victim.id, p_is_admin: null, p_verification: 'rejected' }))
  await refused(db.rpc('admin_update_member', { p_id: victim.id, p_fields: { city: 'Delhi' }, p_phone: null }))
  await refused(db.rpc('admin_search', { p_q: 'Supa', p_limit: 5 }))
  await refused(db.rpc('admin_analytics'))
  await refused(db.rpc('admin_audit_search', { p_actions: null, p_actor: null, p_q: null, p_from: null, p_to: null, p_limit: 5, p_before: null }))
  await refused(db.rpc('admin_health'))
  await refused(db.rpc('admin_event_ledger', { p_event: ev.id }))
  await refused(db.rpc('review_payment', { p_payment: payment.id, p_approve: true, p_note: null }))
  await refused(db.rpc('admin_record_refund', { p_payment: payment.id, p_amount_paise: 100, p_method: 'cash', p_reference: null, p_note: null, p_cancel: false }))
  await refused(db.rpc('admin_send_event_message', { p_event: ev.id, p_kind: 'announcement', p_title: 'Hello', p_body: 'Body text', p_audience: {} }))
  await refused(db.rpc('post_announcement', { p_event: ev.id, p_title: 'Hello', p_body: 'Body text', p_pinned: false }))
  await refused(db.rpc('admin_list_admins'))
  await refused(db.rpc('admin_set_admin', { p_user: victim.id, p_enabled: true, p_permissions: ['members_view'], p_note: null }))
  await refused(db.rpc('admin_grant_role', { p_user: victim.id, p_role: 'treasurer', p_event: ev.id, p_note: null }))
  expect((await db.from('event_registrations').select('id')).data ?? []).toHaveLength(0)
  expect((await db.from('profile_private').select('id').eq('id', victim.id)).data ?? []).toHaveLength(0)
  expect((await db.from('admin_audit').select('id').limit(1)).data ?? []).toHaveLength(0)
  // what the moderation permissions do allow
  expect((await db.rpc('admin_reports', { p_status: 'open' })).error).toBeNull()
  expect((await db.rpc('admin_inbox')).error).toBeNull()
  const att = (await db.rpc('admin_attention')).data as { global: Record<string, unknown> | null }
  expect(Object.keys(att.global ?? {}).sort()).toEqual(['jobs_expiring', 'reports_open'])
})

test('editing the permissions changes what the admin sees at once', async ({ page, browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const modPage = await ctx.newPage()
  await openAs(modPage, mod, '/admin')
  await expect(modPage.getByRole('link', { name: /^Members/ })).toHaveCount(0)

  await openAs(page, boss, '/admin/roles')
  await page.getByRole('button', { name: `Edit permissions for ${nameOf('Mod')}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit admin permissions' })
  await expect(dialog).toContainText('What may')
  await dialog.getByText('Custom', { exact: true }).click()
  await expect(dialog.getByTestId('custom-permissions')).toBeVisible()
  // start from the moderation set, add "See members" and "Analytics"
  await dialog.getByRole('checkbox', { name: /^See members/ }).check()
  await dialog.getByRole('checkbox', { name: /^Analytics/ }).check()
  await dialog.getByRole('checkbox', { name: /^Slow mode/ }).uncheck()
  await dialog.getByRole('button', { name: 'Review' }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(`Saved what ${nameOf('Mod')} may do`)).toBeVisible()
  expect(sql(`select array_to_string(permissions, ',') from admin_grants where user_id = '${mod.id}'`)).toBe('analytics,members_view,moderation_hide,moderation_meetups,moderation_reports')
  expect(auditCount(`action = 'admin_permissions_changed' and target_id = '${mod.id}'`)).toBe(1)
  expect(notes(mod.id)).toBe(2)

  // the other person, on their next screen: new tiles, and the RPCs follow
  await modPage.goto('/admin')
  await expect(modPage.getByRole('link', { name: /^Members/ })).toBeVisible()
  await expect(modPage.getByRole('link', { name: /^Analytics/ })).toBeVisible()
  await expect(modPage.getByRole('link', { name: /^Reports/ })).toBeVisible()
  await expect(modPage.getByRole('link', { name: /^Health/ })).toHaveCount(0)
  await expect(modPage.getByTestId('my-access')).toContainText('Admin (5 permissions)')
  expect((await mod.db.rpc('admin_list_members', { p_filter: {}, p_limit: 5, p_offset: 0, p_ids_only: false })).error).toBeNull()
  await refused(mod.db.rpc('admin_set_slow_mode', { p_group: '00000000-0000-0000-0000-000000000000', p_seconds: 10 }))
  await refused(mod.db.rpc('admin_export_members', { p_ids: [victim.id], p_contact: false }))
  await modPage.goto('/admin/members')
  await expect(modPage.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expect(modPage.getByRole('button', { name: 'Add member' })).toHaveCount(0)
  await modPage.goto('/admin/activity')
  await expect(modPage.getByTestId('no-access')).toBeVisible()
  await ctx.close()
})

test('removing admin access: confirmed, logged, the person is told and loses everything at once', async ({ page, browser }) => {
  await openAs(page, boss, '/admin/roles')
  const before = auditCount(`action = 'admin_removed' and target_id = '${mod.id}'`)
  // dismissing the confirmation changes nothing
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: `Remove admin access from ${nameOf('Mod')}` }).click()
  expect(sql(`select is_admin::text from profiles where id = '${mod.id}'`)).toBe('true')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove admin access from ${nameOf('Mod')}` }).click()
  await expect(page.getByText(`${nameOf('Mod')} is no longer an admin`)).toBeVisible()
  expect(sql(`select is_admin::text from profiles where id = '${mod.id}'`)).toBe('false')
  expect(sql(`select count(*) from admin_grants where user_id = '${mod.id}'`)).toBe('0')
  expect(auditCount(`action = 'admin_removed' and target_id = '${mod.id}'`)).toBe(before + 1)
  expect(notes(mod.id)).toBe(3)
  await expect(page.getByTestId('admins-list')).not.toContainText(nameOf('Mod'))

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const modPage = await ctx.newPage()
  await openAs(modPage, mod, '/admin/members')
  await expect(modPage).not.toHaveURL(/\/admin\/members/)
  await refused(mod.db.rpc('admin_list_members', { p_filter: {}, p_limit: 5, p_offset: 0, p_ids_only: false }))
  await refused(mod.db.rpc('admin_reports', { p_status: 'open' }))
  await ctx.close()
})

test('a super admin makes a second super admin only after typing the phrase', async ({ page }) => {
  // give "second" full admin access first (through the same function the UI uses)
  expect((await boss.db.rpc('admin_set_admin', { p_user: second.id, p_enabled: true, p_permissions: null, p_note: null })).error).toBeNull()
  await openAs(page, boss, '/admin/roles')
  await page.getByRole('button', { name: `Make ${nameOf('Second')} a super admin` }).click()
  const dialog = page.getByRole('dialog', { name: 'Make super admin' })
  const go = dialog.getByRole('button', { name: 'Make super admin' })
  await expect(go).toBeDisabled()
  await dialog.getByLabel(/Type MAKE SUPER ADMIN/).fill('make super')
  await expect(go).toBeDisabled()
  expect(sql(`select is_super_admin::text from profiles where id = '${second.id}'`)).toBe('false')
  await dialog.getByLabel(/Type MAKE SUPER ADMIN/).fill('MAKE SUPER ADMIN')
  await go.click()
  await expect(page.getByText(`${nameOf('Second')} is now a super admin`)).toBeVisible()
  expect(sql(`select is_super_admin::text || ' ' || is_admin::text from profiles where id = '${second.id}'`)).toBe('true true')
  expect(auditCount(`action = 'super_admin_granted' and target_id = '${second.id}'`)).toBe(1)
  expect(Number(sql(`select count(*) from notifications where user_id = '${second.id}' and kind = 'admin_access' and body like '%super admin%'`))).toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('admins-list').locator(`[data-admin="${second.id}"]`)).toContainText('Super admin')
  // the new owner has the controls
  const ctxPage = await page.context().newPage()
  await openAs(ctxPage, second, '/admin/roles')
  await expect(ctxPage.getByRole('button', { name: 'Make admin', exact: true })).toBeVisible()
  await ctxPage.close()
})

test('the transfer ownership wizard: explains, needs the typed phrase, hands over and steps down in one go', async ({ page }) => {
  await openAs(page, boss, '/admin/roles')
  await page.getByRole('button', { name: 'Transfer ownership', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Transfer ownership' })
  await dialog.getByLabel('Search members by name').fill(nameOf('Heir'))
  await dialog.getByRole('button', { name: `Choose: ${nameOf('Heir')}` }).click()
  await expect(dialog).toContainText('Hand over and step down')
  await expect(dialog).toContainText('Read this first')
  await expect(dialog).toContainText('You lose the power')
  const go = dialog.getByRole('button', { name: 'Transfer ownership', exact: true })
  await expect(go).toBeDisabled()
  await dialog.getByLabel(/Type TRANSFER OWNERSHIP/).fill('TRANSFER OWNERSHIP')
  await go.click()
  await expect(page.getByText(`${nameOf('Heir')} now owns the app`)).toBeVisible()
  expect(sql(`select is_super_admin::text || ' ' || is_admin::text from profiles where id = '${heir.id}'`)).toBe('true true')
  expect(sql(`select is_super_admin::text || ' ' || is_admin::text from profiles where id = '${boss.id}'`)).toBe('false true')
  expect(auditCount(`action = 'ownership_transferred' and target_id = '${heir.id}' and actor = '${boss.id}' and details->>'step_down' = 'true'`)).toBe(1)
  expect(Number(sql(`select count(*) from profiles where is_super_admin`))).toBeGreaterThanOrEqual(2)
  // the former owner is an ordinary full admin now: no controls, and the database agrees
  await page.reload()
  await expect(page.getByTestId('admins-list')).toBeVisible()
  await expect(page.getByRole('button', { name: /Make admin|Transfer ownership|Edit permissions/ })).toHaveCount(0)
  await refused(boss.db.rpc('admin_set_admin', { p_user: victim.id, p_enabled: true, p_permissions: ['members_view'], p_note: null }))
  await refused(boss.db.rpc('admin_transfer_ownership', { p_to_user: boss.id, p_step_down: false }))
})

test('an ordinary admin sees the list but no edit controls and no permission lists of others, and every RPC refuses', async ({ page }) => {
  await openAs(page, ordinary, '/admin/roles')
  const section = page.getByTestId('admins-and-owners')
  await expect(section.getByTestId('admins-list')).toContainText(nameOf('Heir'))
  await expect(section.getByTestId('admins-list')).toContainText('Super admin')
  await expect(section).toContainText('Only a super admin can change this list')
  await expect(page.getByRole('button', { name: /Make admin|Transfer ownership|Edit permissions|Remove admin access|Make .* a super admin/ })).toHaveCount(0)
  await expect(section.getByRole('list', { name: new RegExp(`What ${nameOf('Heir')} may do`) })).toHaveCount(0)

  const db = ordinary.db
  await refused(db.rpc('admin_set_admin', { p_user: plain.id, p_enabled: true, p_permissions: null, p_note: null }))
  await refused(db.rpc('admin_set_admin', { p_user: ordinary.id, p_enabled: false, p_permissions: null, p_note: null }))
  await refused(db.rpc('admin_set_super_admin', { p_user: ordinary.id, p_enabled: true }))
  await refused(db.rpc('admin_transfer_ownership', { p_to_user: ordinary.id, p_step_down: false }))
  await refused(db.rpc('admin_grant_role', { p_user: plain.id, p_role: 'admin', p_event: null, p_note: null }))
  await refused(db.rpc('admin_set_member', { p_id: plain.id, p_is_admin: true, p_verification: null }))
  expect((await db.from('profiles').update({ is_admin: true }).eq('id', plain.id)).error).not.toBeNull()
  expect((await db.from('profiles').update({ is_super_admin: true }).eq('id', ordinary.id)).error).not.toBeNull()
  expect((await db.from('admin_grants').insert({ user_id: plain.id, permissions: ['members_view'] })).error).not.toBeNull()
  expect(sql(`select count(*) from profiles where id in ('${plain.id}', '${ordinary.id}') and (is_super_admin or (id = '${plain.id}' and is_admin))`)).toBe('0')
  // everything a full admin does today still works
  expect((await db.rpc('admin_list_members', { p_filter: {}, p_limit: 5, p_offset: 0, p_ids_only: false })).error).toBeNull()
  expect((await db.rpc('admin_event_ledger', { p_event: ev.id })).error).toBeNull()
  const list = (await db.rpc('admin_list_admins')).data as { admins: { full_name: string; permissions: string[] | null }[] }
  expect(list.admins.filter((a) => a.permissions !== null).map((a) => a.full_name)).toEqual([nameOf('Ordinary')])
})

test('a plain member cannot write the owner flag or the grants table, and sees none of it', async () => {
  expect((await plain.db.from('profiles').update({ is_super_admin: true }).eq('id', plain.id)).error).not.toBeNull()
  expect((await plain.db.from('admin_grants').insert({ user_id: plain.id, permissions: ['members_view'] })).error).not.toBeNull()
  expect((await plain.db.from('admin_grants').select('*')).data ?? []).toHaveLength(0)
  await refused(plain.db.rpc('admin_list_admins'))
  const me = (await plain.db.rpc('my_admin_access')).data as { is_admin: boolean; permissions: string[] }
  expect(me.is_admin).toBe(false)
  expect(me.permissions).toEqual([])
})

test.afterAll(() => {
  // leave no test owners behind in the shared dev database
  // (a deliberate bypass of the "last super admin" trigger: the shared dev database should hold no test owners)
  sql(`alter table profiles disable trigger profiles_keep_one_super; update profiles set is_super_admin = false where id in ('${boss.id}', '${second.id}', '${heir.id}'); alter table profiles enable trigger profiles_keep_one_super`)
})
