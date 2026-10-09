// Security through the real API with real JWTs: the payment-proof bucket for every role, admin tables over PostgREST,
// CSV formula safety in a real download, and the Drive owner address / secrets never reaching the built app or the repository.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { sql } from '../helpers'
import { anonClient, API, ANON, auditCount, loginPage, makeEvent, makeUser, register, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `sa${ts}`.slice(0, 9)

let boss: TestUser, tre: TestUser, treOther: TestUser, con: TestUser, chk: TestUser, mod: TestUser, owner: TestUser, other: TestUser
let ev: ReturnType<typeof makeEvent>, ev2: ReturnType<typeof makeEvent>

test.beforeAll(async () => {
  boss = await makeUser(`${tag}bs`, { admin: true, name: `Boss ${tag}` })
  tre = await makeUser(`${tag}tr`)
  treOther = await makeUser(`${tag}t2`)
  con = await makeUser(`${tag}cn`)
  chk = await makeUser(`${tag}ck`)
  mod = await makeUser(`${tag}md`)
  owner = await makeUser(`${tag}ow`)
  other = await makeUser(`${tag}ot`)
  ev = makeEvent(`${tag}a`)
  ev2 = makeEvent(`${tag}b`)
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${tre.id}', 'treasurer'), ('${ev2.id}', '${treOther.id}', 'treasurer'), ('${ev.id}', '${con.id}', 'content'), ('${ev.id}', '${chk.id}', 'checkin')`)
  sql(`insert into site_roles (user_id, role) values ('${mod.id}', 'moderator')`)
})

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

test('payment proofs: only the payer, the treasurer of that event and admins can open the file', async () => {
  const path = `${owner.id}/proof-${tag}.png`
  const up = await owner.db.storage.from('payment-proofs').upload(path, PNG, { contentType: 'image/png' })
  expect(up.error).toBeNull()
  const { reg } = await register(owner, ev, false)
  const pay = await owner.db.rpc('submit_upi_payment', { p_registration: reg.id, p_utr: String(Math.floor(1e11 + Math.random() * 8.9e11)), p_payer_name: 'Payer', p_proof_path: path })
  expect(pay.error).toBeNull()

  const open = async (u: TestUser) => (await u.db.storage.from('payment-proofs').download(path)).error === null
  expect(await open(owner), 'the payer').toBe(true)
  expect(await open(tre), 'treasurer of this event').toBe(true)
  expect(await open(boss), 'admin').toBe(true)
  for (const [label, u] of [['treasurer of another event', treOther], ['content manager', con], ['check-in volunteer', chk], ['moderator', mod], ['other member', other]] as const) {
    expect(await open(u), label).toBe(false)
    expect((await u.db.storage.from('payment-proofs').createSignedUrl(path, 60)).error, `${label}: no signed link`).not.toBeNull()
  }
  const anon = anonClient()
  expect((await anon.storage.from('payment-proofs').download(path)).error).not.toBeNull()
  // the "public" URL of a private bucket serves nothing
  expect((await fetch(`${API}/storage/v1/object/public/payment-proofs/${path}`)).status).toBeGreaterThanOrEqual(400)
  expect((await fetch(`${API}/storage/v1/object/payment-proofs/${path}`, { headers: { apikey: ANON } })).status).toBeGreaterThanOrEqual(400)
  // nobody can list the bucket's other folders
  for (const u of [other, con, chk, mod, treOther]) {
    const l = await u.db.storage.from('payment-proofs').list(owner.id)
    expect(l.data ?? [], `${u.email} lists nothing`).toEqual([])
  }
  // writing into somebody else's folder, overwriting or deleting their proof is refused
  expect((await other.db.storage.from('payment-proofs').upload(`${owner.id}/evil-${tag}.png`, PNG, { contentType: 'image/png' })).error).not.toBeNull()
  expect((await other.db.storage.from('payment-proofs').upload(path, PNG, { contentType: 'image/png', upsert: true })).error).not.toBeNull()
  await tre.db.storage.from('payment-proofs').remove([path])
  await other.db.storage.from('payment-proofs').remove([path])
  expect(await open(owner), 'still there after attempted deletes').toBe(true)
})

test('admin tables over PostgREST: members and role holders read nothing and write nothing', async () => {
  const tables = ['admin_audit', 'admin_requests', 'site_roles', 'event_settings', 'import_jobs', 'import_job_rows', 'member_notes', 'member_views', 'system_events', 'event_refunds', 'event_ops', 'event_messages']
  const existing = sql(`select string_agg(table_name, ',') from information_schema.tables where table_schema = 'public' and table_name in (${tables.map((t) => `'${t}'`).join(',')})`).split(',')
  expect(existing.length).toBeGreaterThanOrEqual(8)
  for (const u of [other, chk, mod, con]) {
    for (const t of existing) {
      const r = await u.db.from(t).select('*').limit(5)
      if (t === 'event_messages' && u === con) continue // content managers may read the messages of their event
      const seen = ((r.data ?? []) as { user_id?: string }[]).filter((row) => !(t === 'site_roles' && row.user_id === u.id)) // your own role row is yours to read
      expect(seen.length, `${u.email} reads ${t}`).toBe(0)
    }
  }
  // someone else's phone number and e-mail
  for (const u of [other, chk, mod, con, tre]) {
    const r = await u.db.from('profile_private').select('id, phone').eq('id', owner.id)
    expect(r.data ?? [], `${u.email} cannot read another member's phone`).toEqual([])
  }
  expect(((await boss.db.from('profile_private').select('id, phone').eq('id', owner.id)).data ?? []).length).toBe(1)
  // writes
  const before = sql(`select (select count(*) from admin_audit) || ':' || (select count(*) from event_staff) || ':' || (select count(*) from site_roles)`)
  for (const u of [other, chk, mod, con]) {
    await u.db.from('admin_audit').insert({ action: 'forged', table_name: 'x' })
    await u.db.from('event_staff').insert({ event_id: ev.id, user_id: u.id, role: 'treasurer' })
    await u.db.from('site_roles').insert({ user_id: u.id, role: 'moderator' })
    await u.db.from('event_staff').delete().eq('event_id', ev.id)
    await u.db.from('site_roles').delete().neq('user_id', u.id)
    await u.db.from('profiles').update({ is_admin: true, verification: 'verified' }).eq('id', u.id)
    await u.db.from('events').update({ title: 'hacked' }).eq('id', ev.id)
    await u.db.from('event_ticket_types').update({ price_paise: 1 }).eq('event_id', ev.id)
    await u.db.from('event_settings').update({ drive_folder_id: 'x' }).eq('event_id', ev.id)
    await u.db.from('reports').update({ status: 'dismissed' }).neq('reporter', u.id)
  }
  expect(sql(`select (select count(*) from admin_audit where action = 'forged') || ':' || (select count(*) from profiles where is_admin and id in ('${other.id}','${chk.id}','${mod.id}','${con.id}'))`)).toBe('0:0')
  expect(sql(`select title from events where id = '${ev.id}'`)).not.toBe('hacked')
  expect(sql(`select min(price_paise) from event_ticket_types where event_id = '${ev.id}'`)).toBe('50000')
  expect(sql(`select (select count(*) from event_staff) || ':' || (select count(*) from site_roles)`)).toBe(before.split(':').slice(1).join(':'))
  // only the real staff rows remain
  expect(sql(`select count(*) from event_staff where event_id = '${ev.id}'`)).toBe('3')
  // anon
  const anon = anonClient()
  for (const t of ['profiles', 'profile_private', 'event_registrations', 'event_payments', 'admin_audit', 'event_staff', 'groups', 'messages', 'reports']) {
    const r = await anon.from(t).select('*').limit(1)
    expect((r.data ?? []).length, `anon reads ${t}`).toBe(0)
  }
  // every admin function directly with a member's JWT: refused (the SQL matrix covers all roles; this proves it over HTTP)
  const fns = JSON.parse(sql(`select json_agg(proname order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'admin\\_%' and has_function_privilege('authenticated', p.oid, 'execute')`)) as string[]
  expect(fns.length).toBeGreaterThan(50)
  let refused = 0
  for (const fn of fns) {
    const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${other.session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })
    const body = await res.json().catch(() => ({}))
    if (fn === 'admin_send_due_messages') { expect(body, 'delivers nothing for a member').toBe(0); refused++; continue } // by design: it only sends what the caller manages
    // either the arguments don't match (PGRST202, nothing runs) or the function says no (42501); never a success
    expect(res.ok, `${fn} must not succeed for a member: ${JSON.stringify(body).slice(0, 120)}`).toBe(false)
    refused++
    // and anonymous callers get nothing at all
    const a = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' })
    expect(a.ok, `${fn} must not succeed for anon`).toBe(false)
  }
  expect(refused).toBe(fns.length)
})

test('CSV downloads cannot run a member-typed formula', async ({ page }) => {
  const evil = await makeUser(`${tag}ev`, { name: `=HYPERLINK("http://evil.example","Click") ${tag}` })
  // a role grant puts the hostile name into the activity log (name, subject and details)
  expect((await boss.db.rpc('admin_grant_role', { p_user: evil.id, p_role: 'checkin', p_event: ev.id, p_note: `=1+1 ${tag}` })).error).toBeNull()
  await loginPage(page, boss, '/admin/activity')
  await page.getByLabel('Search the activity log').fill(tag)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByTestId('audit-rows').locator('[data-action]').first()).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).toContain('HYPERLINK') // the text is there...
  const cells = (await import('papaparse')).default.parse<string[]>(csv.replace(/^﻿/, '')).data.flat()
  const live = cells.filter((c) => /^[=+\-@\t\r]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c))
  expect(live, '...but no cell starts with a formula character').toEqual([])
  expect(cells.some((c) => c.startsWith("'=HYPERLINK") || c.includes(`'=HYPERLINK`) || c.includes('HYPERLINK'))).toBe(true)
  expect(auditCount(`action = 'role_grant' and target_id = '${evil.id}'`)).toBe(1)
})

test('the built app and the repository never contain server secrets or the Drive owner address', async () => {
  const out = '/tmp/claude-0/-home-user-Alumniconnect/f72c2731-e417-505b-8a06-af397d8a8f43/scratchpad/dist-check'
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: process.cwd(), stdio: 'pipe', timeout: 280_000 })
  const grep = (args: string[]) => {
    try { return execFileSync('grep', args, { encoding: 'utf8' }).trim() } catch { return '' }
  }
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  expect(grep(['-rl', service, out]), 'service-role key in the bundle').toBe('')
  expect(grep(['-rliE', 'service_role"?\\s*[:=]\\s*"eyJ|GOOGLE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN|BACKUP_SECRET|PUSH_SECRET|VAPID_PRIVATE|-----BEGIN [A-Z ]*PRIVATE KEY', out]), 'secret names / keys in the bundle').toBe('')
  const owner = process.env.DRIVE_OWNER_EMAIL
  if (owner) {
    expect(grep(['-rlF', owner, out]), 'owner address in the bundle').toBe('')
    expect(grep(['-rlF', owner, '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=test-results', '.']), 'owner address in the working tree').toBe('')
    expect(execFileSync('git', ['log', '--all', '-S', owner, '--format=%h'], { encoding: 'utf8' }).trim(), 'owner address in any commit').toBe('')
  }
  // the client talks only to the public anon key
  expect(grep(['-rlE', 'sb_secret_[A-Za-z0-9_-]{20,}', out])).toBe('')
})
