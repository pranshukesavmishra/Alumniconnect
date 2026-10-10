// Permanent owners, role templates and scoped admins, end to end. What the owner does on /admin/roles changes rows in the database,
// the activity log and notifications; the owner lock refuses every route; a department head only ever sees their department.
import { expect, test, type Page } from '@playwright/test'
import { PERMISSION_KEYS, scopeText } from '../../src/lib/adminAccess'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `su${ts}`.slice(0, 9)
const nameOf = (k: string) => `Supa ${k} ${tag}`

let boss: TestUser, ordinary: TestUser, treas: TestUser, head: TestUser, inDept: TestUser, outDept: TestUser, plain: TestUser
let ev: ReturnType<typeof makeEvent>

test.beforeAll(async () => {
  boss = await makeUser(`${tag}boss`, { admin: true, name: nameOf('Boss') })
  sql(`update profiles set is_super_admin = true where id = '${boss.id}'; insert into protected_owners (user_id) values ('${boss.id}')`)
  ordinary = await makeUser(`${tag}ord`, { admin: true, name: nameOf('Ordinary') })
  treas = await makeUser(`${tag}tre`, { name: nameOf('Treas') })
  head = await makeUser(`${tag}head`, { name: nameOf('Head') })
  inDept = await makeUser(`${tag}in`, { name: nameOf('InDept') })
  outDept = await makeUser(`${tag}out`, { name: nameOf('OutDept') })
  plain = await makeUser(`${tag}plain`, { name: nameOf('Plain') })
  sql(`update profiles set branch = 'MCA' where id in ('${head.id}', '${inDept.id}'); update profiles set branch = 'M.Sc. (Applied Sciences)' where id = '${outDept.id}'`)
  ev = makeEvent(`${tag}e`)
  await register(plain, ev, true)
})

async function refused(p: PromiseLike<{ error: { code?: string; message?: string } | null }>) {
  const r = await p
  expect(r.error?.code, r.error?.message).toBe('42501')
}
function dbRefuses(statement: string): string {
  try { sql(statement) } catch (e) { return String((e as Error).message) }
  return ''
}
const notes = (id: string) => Number(sql(`select count(*) from notifications where user_id = '${id}' and kind = 'admin_access'`))

async function pickMember(page: Page, who: string) {
  const dialog = page.getByRole('dialog', { name: 'Make admin' })
  await dialog.getByLabel('Search members by name').fill(who)
  await dialog.getByRole('button', { name: `Choose: ${who}` }).click()
  return dialog
}

test('the permission list in the app is the permission list in the database', () => {
  expect(PERMISSION_KEYS.join(',')).toBe(sql(`select string_agg(key, ',' order by sort) from _permission_catalog()`))
  expect(scopeText('department', 'MCA')).toBe('Department: MCA')
  expect(scopeText('batch', '2005')).toBe('Batch 2005')
  expect(scopeText('all', null)).toBe('')
})

test('the owner shows as permanent: lock badge, no edit or remove, no transfer or make-super controls anywhere', async ({ page }) => {
  await openRoles(page, boss)
  const section = page.getByTestId('admins-and-owners')
  const row = section.getByTestId('admins-list').locator(`[data-admin="${boss.id}"]`)
  await expect(row).toContainText('Owner · permanent')
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Make admin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Transfer ownership|super admin/i })).toHaveCount(0)
  await expect(section).not.toContainText(/transfer|hand over|hand-over|make super/i)
  // another admin sees the same lock and no controls at all
  await openRoles(page, ordinary)
  await expect(page.getByTestId('admins-list').locator(`[data-admin="${boss.id}"]`)).toContainText('Owner · permanent')
  await expect(page.getByRole('button', { name: /Make admin|Edit permissions|Remove admin access/ })).toHaveCount(0)
})

async function openRoles(page: Page, u: TestUser) {
  await loginPage(page, u, '/admin/roles')
  await expect(page.getByTestId('admins-list')).toBeVisible()
}

test('nothing can remove, demote, un-verify or delete an owner: not the owner, not another admin, not SQL, not a user delete', async () => {
  // the retired functions are gone
  for (const fn of ['admin_set_super_admin', 'admin_transfer_ownership']) {
    const r = await boss.db.rpc(fn, { p_user: boss.id, p_enabled: false, p_to_user: ordinary.id, p_step_down: false })
    expect(r.error, fn).not.toBeNull()
    expect(r.error?.code).not.toBeUndefined()
  }
  const lock = /Ownership is locked/
  // the owner on themself, and another admin on the owner
  expect((await boss.db.rpc('admin_set_admin', { p_user: boss.id, p_enabled: false })).error?.message).toMatch(lock)
  expect((await boss.db.rpc('admin_set_admin', { p_user: boss.id, p_enabled: true, p_permissions: ['members_view'] })).error?.message).toMatch(lock)
  expect((await boss.db.rpc('admin_set_member', { p_id: boss.id, p_is_admin: false, p_verification: null })).error?.message).toMatch(lock)
  expect((await ordinary.db.rpc('admin_set_member', { p_id: boss.id, p_is_admin: null, p_verification: 'rejected' })).error?.message).toMatch(lock)
  expect((await ordinary.db.rpc('admin_bulk_set_verification', { p_ids: [boss.id], p_verification: 'pending' })).error?.message).toMatch(lock)
  expect((await ordinary.db.rpc('admin_update_member', { p_id: boss.id, p_fields: { city: 'Nowhere' }, p_phone: null })).error?.message).toMatch(lock)
  expect((await ordinary.db.rpc('admin_merge_members', { p_keep: plain.id, p_drop: boss.id })).error?.message).toMatch(lock)
  await refused(ordinary.db.rpc('admin_set_admin', { p_user: boss.id, p_enabled: false }))
  // direct writes through the API never reach the flags
  expect((await ordinary.db.from('profiles').update({ is_super_admin: false, is_admin: false }).eq('id', boss.id)).error).not.toBeNull()
  // the database owner, a delete of the profile, and a delete of the user (what the dashboard does)
  expect(dbRefuses(`update profiles set is_super_admin = false where id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`update profiles set is_admin = false where id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`update profiles set verification = 'rejected' where id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`delete from profiles where id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`delete from auth.users where id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`insert into admin_grants (user_id, permissions) values ('${boss.id}', '{analytics}')`)).toMatch(lock)
  expect(dbRefuses(`delete from protected_owners where user_id = '${boss.id}'`)).toMatch(lock)
  expect(dbRefuses(`truncate protected_owners`)).toMatch(lock)
  expect(sql(`select is_super_admin::text || is_admin::text || verification from profiles where id = '${boss.id}'`)).toBe('truetrueverified')
  // the list of owners is invisible to the API
  expect((await boss.db.from('protected_owners').select('*')).error).not.toBeNull()
  // ... and a normal admin is not affected
  expect((await boss.db.rpc('admin_set_member', { p_id: plain.id, p_is_admin: null, p_verification: 'verified' })).error).toBeNull()
})

test('make an admin from a role: member -> role card -> review -> confirm (Treasurer)', async ({ page }) => {
  await openRoles(page, boss)
  const section = page.getByTestId('admins-and-owners')
  await section.getByRole('button', { name: 'Make admin', exact: true }).click()
  const dialog = await pickMember(page, nameOf('Treas'))
  await dialog.getByText('Treasurer', { exact: true }).click()
  await expect(dialog.getByText(/Handles the money/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  const review = dialog.getByTestId('review')
  await expect(review).toContainText('Treasurer')
  await expect(review).toContainText('Verify payments')
  await expect(review).toContainText('will not be able to')
  expect(sql(`select count(*) from admin_grants where user_id = '${treas.id}'`)).toBe('0')
  await dialog.getByLabel('Note').fill('Reunion treasurer')
  await dialog.getByRole('button', { name: `Make ${nameOf('Treas')} an admin` }).click()
  await expect(page.getByText(`${nameOf('Treas')} is now an admin`)).toBeVisible()

  expect(sql(`select template_key || ' ' || scope_kind || ' ' || (permissions @> array['money_payments','money_refunds','money_finance','money_exports'])::text from admin_grants where user_id = '${treas.id}'`)).toBe('treasurer all true')
  expect(sql(`select (permissions && array['members_view','events_create'])::text from admin_grants where user_id = '${treas.id}'`)).toBe('false')
  expect(auditCount(`action = 'admin_granted' and target_id = '${treas.id}' and actor = '${boss.id}' and details->>'role' = 'treasurer'`)).toBe(1)
  expect(notes(treas.id)).toBe(1)
  const row = page.getByTestId('admins-list').locator(`[data-admin="${treas.id}"]`)
  await expect(row).toContainText('Treasurer')
  await expect(row).toContainText('Verify payments')
  // the treasurer can do money things and nothing about members
  expect((await treas.db.rpc('admin_event_ledger', { p_event: ev.id })).error).toBeNull()
  await refused(treas.db.rpc('admin_list_members', { p_filter: {}, p_limit: 5, p_offset: 0, p_ids_only: false }))
})

test('a Department head needs a department; they then see and verify only that department', async ({ page, browser }) => {
  await openRoles(page, boss)
  await page.getByTestId('admins-and-owners').getByRole('button', { name: 'Make admin', exact: true }).click()
  const dialog = await pickMember(page, nameOf('Head'))
  await dialog.getByText('Department head', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Next' }).click()
  const go = dialog.getByRole('button', { name: 'Review' })
  await expect(go).toBeDisabled()
  await dialog.getByLabel('Department').selectOption('MCA')
  await go.click()
  const review = dialog.getByTestId('review')
  await expect(review).toContainText('Department: MCA')
  await expect(review).toContainText('See members')
  await expect(review).toContainText('Verify members')
  await dialog.getByRole('button', { name: `Make ${nameOf('Head')} an admin` }).click()
  await expect(page.getByText(`${nameOf('Head')} is now an admin`)).toBeVisible()
  expect(sql(`select template_key || ' ' || scope_kind || ' ' || scope_value from admin_grants where user_id = '${head.id}'`)).toBe('department_head department MCA')
  await expect(page.getByTestId('admins-list').locator(`[data-admin="${head.id}"]`)).toContainText('Department: MCA')

  // the department head's own screens
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const hp = await ctx.newPage()
  await loginPage(hp, head, '/admin/members')
  await hp.getByLabel(/Search/i).first().fill('Supa')
  await expect(hp.getByText(nameOf('InDept')).first()).toBeVisible()
  await expect(hp.getByText(nameOf('OutDept'))).toHaveCount(0)
  await ctx.close()
  // and the database agrees, function by function
  const list = (await head.db.rpc('admin_list_members', { p_filter: { q: tag }, p_limit: 50, p_offset: 0, p_ids_only: false })).data as { rows: { id: string }[] }
  expect(list.rows.map((r) => r.id).sort()).toEqual([head.id, inDept.id].sort())
  const found = (await head.db.rpc('admin_search', { p_q: 'Supa', p_limit: 30 })).data as { members: { id: string }[] }
  expect(found.members.map((m) => m.id)).not.toContain(outDept.id)
  expect(found.members.map((m) => m.id)).toContain(inDept.id)
  await refused(head.db.rpc('admin_member_timeline', { p_id: outDept.id }))
  await refused(head.db.rpc('admin_view_as_member', { p_member: outDept.id }))
  await refused(head.db.rpc('admin_set_member', { p_id: outDept.id, p_is_admin: null, p_verification: 'verified' }))
  await refused(head.db.rpc('admin_bulk_set_verification', { p_ids: [inDept.id, outDept.id], p_verification: 'verified' }))
  expect((await head.db.rpc('admin_member_timeline', { p_id: inDept.id })).error).toBeNull()
  expect((await head.db.rpc('admin_set_member', { p_id: inDept.id, p_is_admin: null, p_verification: 'verified' })).error).toBeNull()
  expect((await head.db.from('profile_private').select('id').eq('id', outDept.id)).data ?? []).toHaveLength(0)
  expect((await head.db.from('profile_private').select('id').eq('id', inDept.id)).data ?? []).toHaveLength(1)
  await refused(head.db.rpc('admin_set_admin', { p_user: plain.id, p_enabled: true, p_permissions: ['members_view'], p_note: null }))
})

test('changing a role: the list shows the new role and scope and the admin sees the new reach at once', async ({ page }) => {
  await openRoles(page, boss)
  await page.getByRole('button', { name: `Edit permissions for ${nameOf('Head')}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit admin permissions' })
  await dialog.getByText('Batch representative', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByLabel('Batch year').fill('2005')
  await dialog.getByRole('button', { name: 'Review' }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(`Saved ${nameOf('Head')}’s role`)).toBeVisible()
  expect(sql(`select template_key || ' ' || scope_kind || ' ' || scope_value from admin_grants where user_id = '${head.id}'`)).toBe('batch_rep batch 2005')
  expect(auditCount(`action = 'admin_permissions_changed' and target_id = '${head.id}'`)).toBe(1)
  await expect(page.getByTestId('admins-list').locator(`[data-admin="${head.id}"]`)).toContainText('Batch 2005')
  sql(`update profiles set grad_year = 2007 where id = '${outDept.id}'`)
  const list = (await head.db.rpc('admin_list_members', { p_filter: { q: tag }, p_limit: 50, p_offset: 0, p_ids_only: false })).data as { rows: { id: string; grad_year: number }[] }
  expect(list.rows.every((r) => r.grad_year === 2005)).toBe(true)
  expect(list.rows.map((r) => r.id)).not.toContain(outDept.id)
  await refused(head.db.rpc('admin_set_member', { p_id: inDept.id, p_is_admin: null, p_verification: 'rejected' }))
})

test('removing admin access: confirmed, logged, the person is told and loses everything at once', async ({ page }) => {
  await openRoles(page, boss)
  const before = auditCount(`action = 'admin_removed' and target_id = '${treas.id}'`)
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: `Remove admin access from ${nameOf('Treas')}` }).click()
  expect(sql(`select is_admin::text from profiles where id = '${treas.id}'`)).toBe('true')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Remove admin access from ${nameOf('Treas')}` }).click()
  await expect(page.getByText(`${nameOf('Treas')} is no longer an admin`)).toBeVisible()
  expect(sql(`select is_admin::text from profiles where id = '${treas.id}'`)).toBe('false')
  expect(sql(`select count(*) from admin_grants where user_id = '${treas.id}'`)).toBe('0')
  expect(auditCount(`action = 'admin_removed' and target_id = '${treas.id}'`)).toBe(before + 1)
  await refused(treas.db.rpc('admin_event_ledger', { p_event: ev.id }))
})

test('an ordinary admin cannot make admins, owners or roles, and sees no permission lists of others', async () => {
  const db = ordinary.db
  await refused(db.rpc('admin_set_admin', { p_user: plain.id, p_enabled: true, p_permissions: null, p_note: null, p_template: 'treasurer' }))
  await refused(db.rpc('admin_set_admin', { p_user: ordinary.id, p_enabled: false, p_permissions: null, p_note: null }))
  await refused(db.rpc('admin_grant_role', { p_user: plain.id, p_role: 'admin', p_event: null, p_note: null }))
  await refused(db.rpc('admin_set_member', { p_id: plain.id, p_is_admin: true, p_verification: null }))
  expect((await db.from('profiles').update({ is_admin: true }).eq('id', plain.id)).error).not.toBeNull()
  expect((await db.from('admin_grants').insert({ user_id: plain.id, permissions: ['members_view'] })).error).not.toBeNull()
  expect((await db.rpc('admin_role_templates')).error).toBeNull()
  const list = (await db.rpc('admin_list_admins')).data as { admins: { full_name: string; permissions: string[] | null; is_owner: boolean }[] }
  expect(list.admins.filter((a) => a.permissions !== null).map((a) => a.full_name)).toEqual([nameOf('Ordinary')])
  expect(list.admins.find((a) => a.full_name === nameOf('Boss'))?.is_owner).toBe(true)
})

test('a plain member cannot write the owner flag or the grants table, nor read templates or the owner list', async () => {
  expect((await plain.db.from('profiles').update({ is_super_admin: true }).eq('id', plain.id)).error).not.toBeNull()
  expect((await plain.db.from('admin_grants').insert({ user_id: plain.id, permissions: ['members_view'] })).error).not.toBeNull()
  expect((await plain.db.from('admin_grants').select('*')).data ?? []).toHaveLength(0)
  expect((await plain.db.from('protected_owners').select('*')).error).not.toBeNull()
  await refused(plain.db.rpc('admin_list_admins'))
  await refused(plain.db.rpc('admin_role_templates'))
  const me = (await plain.db.rpc('my_admin_access')).data as { is_admin: boolean; permissions: string[] }
  expect(me.is_admin).toBe(false)
  expect(me.permissions).toEqual([])
})

test.afterAll(() => {
  // leave no test owners behind in the shared dev database: our own account, removed with the deliberate break-glass steps
  sql(`alter table protected_owners disable trigger protected_owners_no_change; alter table profiles disable trigger profiles_00_protect_owner;
       delete from protected_owners where user_id = '${boss.id}';
       alter table profiles disable trigger profiles_keep_one_super;
       update profiles set is_super_admin = false where id = '${boss.id}';
       alter table profiles enable trigger profiles_keep_one_super;
       alter table protected_owners enable trigger protected_owners_no_change; alter table profiles enable trigger profiles_00_protect_owner`)
})
