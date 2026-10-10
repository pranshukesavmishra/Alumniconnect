// Lets an admin add a member who has not signed up yet.
//
// The member's profile is created now (name, batch, branch, ...). When the person later signs in with the SAME
// email (email code, Google or LinkedIn), they land in this profile and just confirm it: nothing is duplicated.
// Safety: only signed-in admins may call it; the profile fields are saved through admin_update_member (validated
// and written to the activity log), and the creation itself is logged too.
import { corsHeaders, json } from '../_shared/http.ts'
import { asService, currentUser } from '../_shared/db.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Body {
  email?: string
  full_name?: string
  member_type?: string
  branch?: string
  grad_year?: string | number
  join_year?: string | number
  city?: string
  current_title?: string
  current_company?: string
  phone?: string
  verified?: boolean
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

type Outcome = { status: number; body: Record<string, unknown> }

async function createMember(b: Body, callerId: string, authorization: string): Promise<Outcome> {
  const email = clean(b.email, 254).toLowerCase()
  const name = clean(b.full_name, 120)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { status: 400, body: { error: 'invalid', message: 'Please enter a valid email address.' } }
  if (name.length < 2) return { status: 400, body: { error: 'invalid', message: 'Please enter the member’s full name.' } }
  const phone = clean(b.phone, 20)
  if (phone && !/^\+?[0-9 ]{8,16}$/.test(phone)) return { status: 400, body: { error: 'invalid', message: 'Please enter a valid mobile number.' } }

  // 1. the account (confirmed email, no password: the member signs in with an email code, Google or LinkedIn)
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: name }, app_metadata: { created_by_admin: callerId } }),
  })
  if (!created.ok) {
    const err = (await created.json().catch(() => ({}))) as { error_code?: string; code?: string; msg?: string }
    if (created.status === 422 || err.error_code === 'email_exists' || err.code === 'email_exists') {
      return { status: 409, body: { error: 'exists', message: 'A member with this email already exists. Search for them in Members.' } }
    }
    return { status: 502, body: { error: 'failed', message: 'Could not create the member. Please try again.' } }
  }
  const user = (await created.json()) as { id: string }

  // 2. profile details, through the audited admin function (as the calling admin)
  const fields: Record<string, unknown> = { full_name: name, onboarded: false }
  for (const k of ['member_type', 'branch', 'city', 'current_title', 'current_company'] as const) {
    const v = clean(b[k], 160)
    if (v) fields[k] = v
  }
  for (const k of ['grad_year', 'join_year'] as const) {
    const v = String(b[k] ?? '').trim()
    if (/^(19|20)\d{2}$/.test(v)) fields[k] = v
  }
  const rpc = (fn: string, body: unknown) =>
    fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const upd = await rpc('admin_update_member', { p_id: user.id, p_fields: fields, p_phone: phone || null })
  if (!upd.ok) return { status: 207, body: { id: user.id, warning: 'saved_without_details', message: 'The member was created, but some details could not be saved. Please edit them.' } }
  if (b.verified !== false) await rpc('admin_set_member', { p_id: user.id, p_is_admin: null, p_verification: 'verified' })

  // 3. the creation itself goes in the activity log
  await asService().upsert('admin_audit', { actor: callerId, action: 'create_member', target_table: 'profiles', target_id: user.id, details: { email, name, verified: b.verified !== false } })
  return { status: 200, body: { id: user.id } }
}

/** Works through a saved import job: claim a few rows, add them, record each result, repeat until nothing is left. */
async function runJob(jobId: string, callerId: string, authorization: string): Promise<void> {
  const rpc = (fn: string, body: unknown) =>
    fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const started = Date.now()
  while (Date.now() - started < 110_000) {
    const res = await rpc('admin_import_claim', { p_job: jobId, p_limit: 10 })
    if (!res.ok) return
    const claim = (await res.json()) as { verified: boolean; rows: { id: number; line: number; payload: Body }[] }
    if (!claim.rows.length) return
    for (const row of claim.rows) {
      let out: Outcome
      try {
        out = await createMember({ ...row.payload, verified: claim.verified }, callerId, authorization)
      } catch {
        out = { status: 500, body: { message: 'Could not create the member. Please try again.' } }
      }
      const ok = out.status === 200 || out.status === 207
      await rpc('admin_import_mark', { p_row: row.id, p_ok: ok, p_member: ok ? out.body.id : null, p_error: ok ? null : String(out.body.message ?? 'Could not add this member.') })
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405)

  const authorization = req.headers.get('Authorization')
  const caller = await currentUser(authorization)
  if (!caller) return json(req, { error: 'unauthorized' }, 401)
  // adding and importing members is the "Import members" permission (full admins and super admins hold every permission)
  const acc = await fetch(`${URL_}/rest/v1/rpc/my_admin_access`, { method: 'POST', headers: { apikey: ANON, Authorization: authorization!, 'Content-Type': 'application/json' }, body: '{}' })
  const access = acc.ok ? ((await acc.json()) as { is_admin: boolean; full: boolean; permissions: string[] }) : null
  if (!access?.is_admin || !(access.full || access.permissions.includes('members_import'))) {
    return json(req, { error: 'forbidden', message: 'You do not have permission to add members. Ask a super admin for access.' }, 403)
  }

  const b = (await req.json().catch(() => ({}))) as Body & { job_id?: string }
  if (b.job_id) {
    if (!/^[0-9a-f-]{36}$/i.test(b.job_id)) return json(req, { error: 'invalid', message: 'That import is not valid.' }, 400)
    // keep working after the answer has been sent (closing the tab must not stop the import)
    const work = runJob(b.job_id, caller.id, authorization!).catch(() => undefined)
    const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
    if (rt?.waitUntil) rt.waitUntil(work)
    else await work
    return json(req, { started: true }, 202)
  }
  const out = await createMember(b, caller.id, authorization!)
  return json(req, out.body, out.status)
})
