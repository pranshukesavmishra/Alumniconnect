// Security boundaries, checked through the real API (PostgREST + RPC + Edge Function) with real JWTs.
// No browser needed: every request is exactly what an attacker with a member account could send.
import { expect, test } from '@playwright/test'
import { sql } from '../helpers'
import { anonClient, API, ANON, auditCount, makeEvent, makeUser, OWNER_EMAIL, register, type TestUser } from './admin-lib'

let admin: TestUser, member: TestUser, pending: TestUser, other: TestUser, manager: TestUser, volunteer: TestUser
let ev: ReturnType<typeof makeEvent>, ev2: ReturnType<typeof makeEvent>
let otherReg: { reg: { id: string; code: string }; payment: { id: string } | null }

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  admin = await makeUser('sec-admin', { admin: true })
  member = await makeUser('sec-member')
  pending = await makeUser('sec-pending', { verified: false })
  other = await makeUser('sec-other', { phone: '+91 91111 22222' })
  manager = await makeUser('sec-manager')
  volunteer = await makeUser('sec-volunteer')
  ev = makeEvent('sec')
  ev2 = makeEvent('sec2')
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${manager.id}', 'manager'), ('${ev.id}', '${volunteer.id}', 'checkin')`)
  sql(`insert into event_settings (event_id, drive_folder_id) values ('${ev.id}', 'FOLDER_${'x'.repeat(20)}')`)
  otherReg = await register(other, ev, true)
  await register(member, ev, false)
})

/** RPC must fail; returns the error so the test can show what came back. */
async function refused(p: PromiseLike<{ error: { message: string; code?: string } | null; data: unknown }>) {
  const { error, data } = await p
  expect(error, `expected refusal but got data ${JSON.stringify(data)}`).not.toBeNull()
  return error!
}

test('non-admin member: every admin RPC is refused', async () => {
  const db = member.db
  const e1 = await refused(db.rpc('admin_set_member', { p_id: member.id, p_is_admin: true, p_verification: null }))
  expect(e1.code).toBe('42501')
  await refused(db.rpc('admin_set_member', { p_id: other.id, p_is_admin: null, p_verification: 'rejected' }))
  await refused(db.rpc('admin_update_member', { p_id: other.id, p_fields: { city: 'Hacked' }, p_phone: null }))
  await refused(db.rpc('admin_update_registration', { p_registration: otherReg.reg.id, p_details: { food_pref: 'jain' }, p_items: null, p_reason: 'x' }))
  await refused(db.rpc('admin_set_registration_status', { p_registration: otherReg.reg.id, p_cancel: true, p_reason: 'x' }))
  await refused(db.rpc('review_payment', { p_payment: otherReg.payment!.id, p_approve: true, p_note: null }))
  await refused(db.rpc('record_offline_payment', { p_registration: otherReg.reg.id, p_method: 'waiver', p_amount_paise: null, p_note: 'me' }))
  await refused(db.rpc('check_in', { p_event: ev.id, p_code: otherReg.reg.code, p_undo: false }))
  await refused(db.rpc('moderate', { p_type: 'post', p_id: other.id, p_hide: true, p_report_status: 'actioned' }))
  // internal helpers are not callable at all
  for (const [fn, args] of [
    ['_audit', { p_action: 'x', p_table: 'x', p_target: null, p_details: {} }],
    ['_verify_member_from_payment', { p_user: pending.id }],
    ['_refresh_registration_status', { p_registration: otherReg.reg.id }],
    ['_assert_capacity', { p_event: ev.id, p_exclude: null, p_heads: 1 }],
    ['new_registration_code', {}],
  ] as const) {
    await refused(db.rpc(fn, args))
  }
  // nothing changed in the database
  expect(sql(`select is_admin from profiles where id = '${member.id}'`)).toBe('f')
  expect(sql(`select verification || ':' || city from profiles where id = '${other.id}'`)).toBe('verified:Pune')
  expect(sql(`select status || ':' || coalesce(food_pref,'') from event_registrations where id = '${otherReg.reg.id}'`)).toBe('under_review:veg')
  expect(sql(`select status from event_payments where id = '${otherReg.payment!.id}'`)).toBe('submitted')
  expect(sql(`select checked_in_at is null from event_registrations where id = '${otherReg.reg.id}'`)).toBe('t')
  expect(auditCount(`actor = '${member.id}'`)).toBe(0)
})

test('non-admin member: direct table writes are refused', async () => {
  const db = member.db
  // someone else's profile: RLS filters the row, nothing is updated
  const u1 = await db.from('profiles').update({ city: 'Hacked' }).eq('id', other.id).select()
  expect(u1.data ?? []).toHaveLength(0)
  // own admin / verification flags: column privilege refuses
  const u2 = await db.from('profiles').update({ is_admin: true }).eq('id', member.id)
  expect(u2.error?.code).toBe('42501')
  const u3 = await db.from('profiles').update({ verification: 'verified' }).eq('id', pending.id)
  expect(u3.error?.code).toBe('42501')
  const u3b = await pending.db.from('profiles').update({ verification: 'verified' }).eq('id', pending.id)
  expect(u3b.error?.code).toBe('42501')
  const u3c = await db.from('profiles').update({ invite_code: 'HACKED01' }).eq('id', member.id)
  expect(u3c.error?.code).toBe('42501')
  // others' private details
  const p1 = await db.from('profile_private').select('*').eq('id', other.id)
  expect(p1.data ?? []).toHaveLength(0)
  const p2 = await db.from('profile_private').update({ phone: '+91 99999 99999' }).eq('id', other.id).select()
  expect(p2.data ?? []).toHaveLength(0)
  // registrations, payments: no write privilege at all
  expect((await db.from('event_registrations').update({ status: 'confirmed' }).eq('user_id', member.id)).error?.code).toBe('42501')
  expect((await db.from('event_registrations').insert({ event_id: ev.id, user_id: member.id, code: 'JEC-HACK00', full_name: 'x', phone: '9999999999' })).error?.code).toBe('42501')
  expect((await db.from('event_payments').insert({ registration_id: otherReg.reg.id, amount_paise: 1, method: 'cash', status: 'verified' })).error?.code).toBe('42501')
  expect((await db.from('event_payments').update({ status: 'verified' }).eq('id', otherReg.payment!.id)).error?.code).toBe('42501')
  expect((await db.from('event_registration_items').delete().eq('registration_id', otherReg.reg.id)).error?.code).toBe('42501')
  // other people's registrations / payments are invisible
  expect((await db.from('event_registrations').select('id').eq('event_id', ev.id)).data!.map((r) => r.id)).not.toContain(otherReg.reg.id)
  expect((await db.from('event_payments').select('id')).data!.map((r) => r.id)).not.toContain(otherReg.payment!.id)
  // event settings (drive folder): unreadable and unwritable
  expect((await db.from('event_settings').select('*')).data).toEqual([])
  expect((await db.from('event_settings').insert({ event_id: ev2.id, drive_folder_id: 'ATTACKER_FOLDER_1234' })).error?.code).toBe('42501')
  expect((await db.from('event_settings').update({ drive_folder_id: 'ATTACKER_FOLDER_1234' }).eq('event_id', ev.id).select()).data ?? []).toHaveLength(0)
  expect(sql(`select drive_folder_id from event_settings where event_id = '${ev.id}'`)).toBe(`FOLDER_${'x'.repeat(20)}`)
  // audit log: unreadable, not writable, not deletable
  expect((await db.from('admin_audit').select('*')).data).toEqual([])
  expect((await db.from('admin_audit').insert({ action: 'fake', target_table: 'x' })).error).not.toBeNull()
  const before = auditCount('true')
  await db.from('admin_audit').delete().gt('id', 0)
  expect(auditCount('true')).toBeGreaterThanOrEqual(before)
  // events, tickets, staff: admin-only
  expect((await db.from('events').insert({ slug: `adm-hack-${Date.now()}`, title: 'x' })).error?.code).toBe('42501')
  expect((await db.from('events').update({ title: 'Hacked' }).eq('id', ev.id).select()).data ?? []).toHaveLength(0)
  expect((await db.from('event_ticket_types').update({ price_paise: 1 }).eq('id', ev.alumnus).select()).data ?? []).toHaveLength(0)
  expect((await db.from('event_ticket_types').insert({ event_id: ev.id, label: 'Free', price_paise: 0, is_primary: true })).error?.code).toBe('42501')
  expect((await db.from('event_staff').insert({ event_id: ev.id, user_id: member.id, role: 'manager' })).error?.code).toBe('42501')
  expect(sql(`select title from events where id = '${ev.id}'`)).toContain('Verify sec')
  expect(sql(`select price_paise from event_ticket_types where id = '${ev.alumnus}'`)).toBe('100000')
  // unpublished events are invisible
  const draft = makeEvent('draft', false)
  expect((await db.from('events').select('id').eq('id', draft.id)).data).toEqual([])
})

test('unverified (pending) member sees only themselves', async () => {
  const { data } = await pending.db.from('profiles').select('id')
  expect(data!.map((r) => r.id)).toEqual([pending.id])
  const found = (await pending.db.rpc('search_members', { q: null, p_limit: 100 })).data as { id: string }[]
  expect(found.map((r) => r.id)).not.toContain(other.id)
  expect((await pending.db.from('profile_private').select('id')).data!.map((r) => r.id)).toEqual([pending.id])
})

test('anonymous key sees nothing private', async () => {
  const db = anonClient()
  for (const t of ['profiles', 'profile_private', 'event_registrations', 'event_registration_items', 'event_payments', 'event_settings', 'event_staff', 'admin_audit',
    'experiences', 'educations', 'notifications', 'reports', 'vouches', 'groups', 'group_members', 'posts', 'comments', 'connections', 'follows', 'spotlights', 'batch_sizes']) {
    const { data } = await db.from(t).select('*').limit(5)
    expect(data ?? [], `anon read ${t}`).toEqual([])
  }
  // published events and their tickets are public by design; drafts are not
  const evs = (await db.from('events').select('id, is_published')).data!
  expect(evs.every((e) => e.is_published)).toBe(true)
  for (const [fn, args] of [
    ['admin_set_member', { p_id: other.id, p_is_admin: true, p_verification: null }],
    ['admin_update_member', { p_id: other.id, p_fields: { city: 'x' }, p_phone: null }],
    ['review_payment', { p_payment: otherReg.payment!.id, p_approve: true, p_note: null }],
    ['record_offline_payment', { p_registration: otherReg.reg.id, p_method: 'waiver', p_amount_paise: null, p_note: 'x' }],
    ['check_in', { p_event: ev.id, p_code: otherReg.reg.code, p_undo: false }],
    ['search_members', { q: null }],
  ] as const) {
    const { data, error } = await db.rpc(fn, args)
    expect(error !== null || (Array.isArray(data) && data.length === 0), `anon rpc ${fn}`).toBe(true)
  }
  // aggregate stats are public by design but contain no names
  const stats = await db.rpc('event_public_stats', { p_event: ev.id })
  expect(JSON.stringify(stats.data)).not.toMatch(/@|Reg /)
})

test('check-in volunteer: sees names, cannot see money or manage', async () => {
  const db = volunteer.db
  // volunteers get the attendee list (names, headcount) through a safe function, not the registrations table
  expect((await db.from('event_registrations').select('*').eq('event_id', ev.id)).data).toEqual([])
  const regs = (await db.rpc('event_attendees', { p_event: ev.id })).data!
  expect(regs.length).toBeGreaterThanOrEqual(2)
  expect((await db.from('event_payments').select('id')).data).toEqual([])
  expect((await db.from('event_registration_items').select('*')).data).toEqual([])
  await refused(db.rpc('review_payment', { p_payment: otherReg.payment!.id, p_approve: true, p_note: null }))
  await refused(db.rpc('record_offline_payment', { p_registration: otherReg.reg.id, p_method: 'cash', p_amount_paise: 100, p_note: null }))
  await refused(db.rpc('admin_update_registration', { p_registration: otherReg.reg.id, p_details: { notes: 'x' }, p_items: null, p_reason: 'x' }))
  await refused(db.rpc('admin_set_registration_status', { p_registration: otherReg.reg.id, p_cancel: true, p_reason: 'x' }))
  expect((await db.from('event_staff').select('user_id').eq('event_id', ev.id)).data!.map((r) => r.user_id)).toEqual([volunteer.id])
  // allowed: scanning a ticket (not confirmed yet, so it is looked up but not checked in)
  const ci = await db.rpc('check_in', { p_event: ev.id, p_code: otherReg.reg.code, p_undo: false })
  expect(ci.error).toBeNull()
  // not staff of the other event
  await refused(db.rpc('check_in', { p_event: ev2.id, p_code: otherReg.reg.code, p_undo: false }))
})

// The policy comment says volunteers see "names, headcount" only, and the UI hides phone/email/notes/amount from them,
// but RLS returns the whole row, so any volunteer can pull every registrant's phone, email, notes and amount via the API.
test('check-in volunteer cannot read registrants\' phone / email / amount via the API', async () => {
  const r = (await volunteer.db.from('event_registrations').select('phone, email, amount_paise, notes, admin_note').eq('id', otherReg.reg.id)).data!
  expect(r[0]?.phone ?? null).toBeNull()
})

test('treasurer / manager: payments and registrations of THEIR event only, nothing admin-wide', async () => {
  const db = manager.db
  expect((await db.from('event_payments').select('id').eq('id', otherReg.payment!.id)).data).toHaveLength(1)
  // cannot touch members, flags, settings, staff, the audit log, or the event itself
  await refused(db.rpc('admin_update_member', { p_id: other.id, p_fields: { city: 'x' }, p_phone: null }))
  await refused(db.rpc('admin_set_member', { p_id: manager.id, p_is_admin: true, p_verification: null }))
  expect((await db.from('profile_private').select('phone').eq('id', other.id)).data).toEqual([])
  expect((await db.from('event_settings').select('*')).data).toEqual([])
  expect((await db.from('admin_audit').select('*')).data).toEqual([])
  expect((await db.from('event_staff').insert({ event_id: ev.id, user_id: member.id, role: 'manager' })).error?.code).toBe('42501')
  expect((await db.from('event_staff').update({ role: 'manager' }).eq('user_id', volunteer.id).select()).data ?? []).toHaveLength(0)
  expect((await db.from('events').update({ title: 'Hacked' }).eq('id', ev.id).select()).data ?? []).toHaveLength(0)
  // nothing on another event
  const reg2 = await register(member, ev2, true)
  await refused(db.rpc('review_payment', { p_payment: reg2.payment!.id, p_approve: true, p_note: null }))
  await refused(db.rpc('admin_update_registration', { p_registration: reg2.reg.id, p_details: { notes: 'x' }, p_items: null, p_reason: 'x' }))
  // allowed and audited: verify a payment on their event
  const ok = await db.rpc('review_payment', { p_payment: otherReg.payment!.id, p_approve: true, p_note: null })
  expect(ok.error).toBeNull()
  expect(ok.data.status).toBe('confirmed')
  expect(auditCount(`actor = '${manager.id}' and action = 'verify_payment' and target_id = '${otherReg.reg.id}'`)).toBe(1)
})

test('Drive archive endpoint: members cannot create / overwrite the folder', async () => {
  const res = await fetch(`${API}/functions/v1/drive-upload`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${member.session.access_token}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ action: 'create_root', event_id: ev2.id }),
  })
  expect(res.status).toBe(403)
  const anon = await fetch(`${API}/functions/v1/drive-upload`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{"action":"create_root"}' })
  expect(anon.status).toBe(401)
})

test('owner Google address is not in any member-readable table or API response', async () => {
  // every text-ish column of every public table (what any RLS might expose), plus auth.users
  const hits = sql(`select string_agg(table_name || '.' || column_name, ',') from information_schema.columns c
     where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
       and exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE')`)
  const found: string[] = []
  for (const tc of hits.split(',')) {
    const [t, c] = tc.split('.')
    if (Number(sql(`select count(*) from public.${t} where ${c}::text ilike '%${OWNER_EMAIL}%'`)) > 0) found.push(tc)
  }
  expect(found).toEqual([])
  // API responses as admin (the most privileged browser role) for the tables the admin UI reads
  for (const t of ['profiles', 'profile_private', 'events', 'event_settings', 'admin_audit', 'event_registrations', 'event_payments']) {
    const { data } = await admin.db.from(t).select('*').limit(1000)
    expect(JSON.stringify(data ?? '')).not.toContain(OWNER_EMAIL)
  }
})

// Default Supabase privileges were never revoked for tables created after 20261008000004_grants.sql,
// so posts.is_hidden (moderation) is writable by the post's author.
test('a member cannot un-hide their own post after an admin hid it', async () => {
  const { data: post, error } = await member.db.from('posts').insert({ author_id: member.id, body: `moderation test ${Date.now()}` }).select('id').single()
  expect(error).toBeNull()
  expect((await admin.db.rpc('moderate', { p_type: 'post', p_id: post!.id, p_hide: true, p_report_status: 'actioned' })).error).toBeNull()
  expect(sql(`select is_hidden from posts where id = '${post!.id}'`)).toBe('t')
  await member.db.from('posts').update({ is_hidden: false, like_count: 9999 }).eq('id', post!.id)
  expect(sql(`select is_hidden::text || ':' || like_count from posts where id = '${post!.id}'`)).toBe('true:0')
})

test('admin_audit and community tables carry only explicit grants (no default ALL to anon)', async () => {
  const rows = sql(`select table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') order by 1`)
  expect(rows).toBe('')
})
