// Helpers for the Alumni Meet verification specs (e2e/verify/meet*.spec.ts).
// DB-level checks run as a real signed-in member by setting the same JWT claims PostgREST would set.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function sql(query: string): string {
  return execFileSync('psql', [DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim()
}

export const q = (s: string | null | undefined) => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`)

/** Runs `query` as the given user (role authenticated, auth.uid() = uid). Returns {ok, out, err}. */
export function tryAs(uid: string | null, query: string): { ok: boolean; out: string; err: string } {
  const claims = uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'anon' })
  const role = uid ? 'authenticated' : 'anon'
  const full = `set local role ${role}; select set_config('request.jwt.claims', ${q(claims)}, true); ${query}`
  const r = spawnSync('psql', [DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', full], { encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

export function as(uid: string | null, query: string): string {
  const r = tryAs(uid, query)
  if (!r.ok) throw new Error(r.err)
  return r.out
}

/** Error message expected from a call (throws if it unexpectedly succeeds). */
export function errAs(uid: string | null, query: string): string {
  const r = tryAs(uid, query)
  if (r.ok) throw new Error(`expected an error, got: ${r.out}`)
  return r.err
}

export const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

/** Creates an auth user (+ profile via trigger) that is onboarded; returns the user id. */
export function createMember(opts: { email: string; name: string; year?: number; phone?: string; verified?: boolean; admin?: boolean }): string {
  const id = randomUUID()
  sql(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${q(opts.email)}, now(), '{}'::jsonb, now(), now())`)
  sql(`update profiles set full_name = ${q(opts.name)}, member_type = 'alumnus', branch = 'B.E. in Computer Science & Engineering',
         grad_year = ${opts.year ?? 2005}, city = 'Pune', country = 'India', current_title = 'Engineer', current_company = 'Acme', onboarded = true,
         verification = '${opts.verified ? 'verified' : 'pending'}', is_admin = ${opts.admin ? 'true' : 'false'} where id = '${id}'`)
  sql(`update profile_private set phone = ${q(opts.phone ?? '+91 98765 43210')} where id = '${id}'`)
  return id
}

export interface TestEvent {
  id: string
  slug: string
  primary: string
  spouse: string
  child: string
  infant: string
}

/** A private, isolated event (never the seeded alumni-meet-2026). Prices in paise. */
export function createEvent(opts: { capacity?: number | null; closes?: string | null; primaryPaise?: number; published?: boolean } = {}): TestEvent {
  const slug = `meet-verify-${stamp()}`
  const id = sql(`insert into events (slug, title, starts_at, ends_at, registration_closes_at, eligible_from_year, eligible_to_year, capacity,
                   upi_id, upi_payee_name, is_published)
                  values ('${slug}', 'Verify Meet ${slug}', now() + interval '60 days', now() + interval '61 days',
                   ${opts.closes === undefined ? "now() + interval '30 days'" : opts.closes === null ? 'null' : q(opts.closes)}, 2003, 2012,
                   ${opts.capacity ?? 'null'}, 'jec.alumni@okhdfcbank', 'JEC Alumni Association', ${opts.published === false ? 'false' : 'true'})
                  returning id`).split('\n')[0]!
  const t = (label: string, price: number, primary: boolean, max: number, sort: number) =>
    sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort)
         values ('${id}', ${q(label)}, ${price}, ${primary}, ${max}, ${sort}) returning id`).split('\n')[0]!
  return {
    id,
    slug,
    primary: t('Alumnus', opts.primaryPaise ?? 250050, true, 1, 1),
    spouse: t('Spouse', 150000, false, 1, 2),
    child: t('Child (5–12)', 50000, false, 4, 3),
    infant: t('Child (under 5)', 0, false, 4, 4),
  }
}

export function details(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    full_name: 'Test Member',
    email: 'x@test.local',
    phone: '+91 98765 43210',
    branch: 'Computer Science & Engineering',
    grad_year: '2005',
    city: 'Pune',
    tshirt_size: 'L',
    food_pref: 'veg',
    needs_accommodation: false,
    arrival_note: '',
    notes: '',
    guests: [],
    accept_terms: true,
    photo_consent: true,
    ...extra,
  })
}

export function items(list: [string, number][]): string {
  return JSON.stringify(list.map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity })))
}

/** upsert_registration as the member; returns the registration row as JSON. */
export function register(uid: string, ev: TestEvent, list: [string, number][], extra: Record<string, unknown> = {}) {
  const out = as(uid, `select row_to_json(r) from upsert_registration('${ev.id}', ${q(details(extra))}::jsonb, ${q(items(list))}::jsonb) r`)
  return JSON.parse(out.split('\n').pop()!) as { id: string; code: string; status: string; amount_paise: number; headcount: number; photo_consent: boolean }
}

export function regRow(id: string) {
  return JSON.parse(sql(`select row_to_json(r) from event_registrations r where id = '${id}'`)) as {
    id: string
    code: string
    status: string
    amount_paise: number
    headcount: number
    checked_in_at: string | null
    photo_consent: boolean
    admin_note: string | null
    branch: string | null
    guests: unknown[]
  }
}

/** A fresh, never-used 12-digit UTR. */
let utrSeq = 0
export function newUtr(): string {
  utrSeq++
  return `5${String(Date.now()).slice(-9)}${String(utrSeq).padStart(2, '0')}`.slice(0, 12)
}

// ------------------------------------------------------------------ browser sessions
// Signing every test user in through e-mail OTP would hit the local auth rate limit (shared with other suites),
// so most UI tests use a session token signed with the local stack's JWT secret – exactly what GoTrue would issue.
import { createHmac } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'

const JWT_SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

export function mintSession(uid: string, email: string) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 6 * 3600
  const payload = { sub: uid, email, role: 'authenticated', aud: 'authenticated', iat: now, exp, aal: 'aal1', session_id: randomUUID(), iss: 'http://127.0.0.1:54321/auth/v1' }
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return {
    access_token: `${head}.${body}.${sig}`,
    token_type: 'bearer',
    expires_in: 6 * 3600,
    expires_at: exp,
    refresh_token: randomUUID(),
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  }
}

/** Every page of this context starts signed in as uid. */
export async function signInContext(ctx: BrowserContext, uid: string, email: string) {
  const session = JSON.stringify(mintSession(uid, email))
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('sb-127-auth-token')) localStorage.setItem('sb-127-auth-token', s)
  }, session)
}

export const SEEDED_EVENT = () => sql(`select id from events where slug = 'alumni-meet-2026'`)
