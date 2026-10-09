// Shared helpers for the admin / roles / security verification specs (e2e/verify/admin*.spec.ts).
// Users are created through the Auth admin API (password sign-in) so API tests don't depend on email.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { sql } from '../helpers'

export const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
export const PASSWORD = 'Verify-Pass-12345'
/** The Google Drive owner's address must never reach members (spec item 3). */
// the Drive owner's address is never written into the repo: pass it when running (DRIVE_OWNER_EMAIL=... npx playwright test ...)
export const OWNER_EMAIL = process.env.DRIVE_OWNER_EMAIL ?? 'drive-owner@example.invalid'

export const ts = Date.now().toString(36)
export const email = (tag: string) => `adm-${ts}-${tag}@test.local`

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
export const anonClient = () => createClient(API, ANON, opts)
export const serviceClient = () => createClient(API, SERVICE, opts)

export interface TestUser {
  id: string
  email: string
  db: SupabaseClient
  session: { access_token: string; refresh_token: string; expires_at?: number; expires_in: number; token_type: string; user: unknown }
}

/** Creates a confirmed user, fills the onboarding fields in SQL, signs in with a password. */
export async function makeUser(
  tag: string,
  o: { name?: string; admin?: boolean; verified?: boolean; onboarded?: boolean; phone?: string; grad?: number } = {},
): Promise<TestUser> {
  const e = email(tag)
  const svc = serviceClient()
  const { data, error } = await svc.auth.admin.createUser({ email: e, password: PASSWORD, email_confirm: true, user_metadata: { full_name: o.name ?? `Adm ${tag} ${ts}` } })
  if (error) throw error
  const id = data.user!.id
  const onboarded = o.onboarded ?? true
  sql(`update profiles set onboarded = ${onboarded}, member_type = 'alumnus', branch = 'Computer Science & Engineering', grad_year = ${o.grad ?? 2005},
         city = 'Pune', is_admin = ${!!o.admin}, verification = '${o.verified === false ? 'pending' : 'verified'}' where id = '${id}'`)
  sql(`update profile_private set phone = '${o.phone ?? '+91 98765 4' + String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}' where id = '${id}'`)
  const db = createClient(API, ANON, opts)
  const s = await db.auth.signInWithPassword({ email: e, password: PASSWORD })
  if (s.error) throw s.error
  return { id, email: e, db, session: s.data.session as TestUser['session'] }
}

/** Puts a user's session into the browser (supabase-js localStorage key) so a page loads signed in. */
export async function loginPage(page: Page, u: TestUser, path = '/') {
  const key = `sb-${new URL(API).hostname.split('.')[0]}-auth-token`
  await page.goto('/install')
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(u.session)] as const)
  await page.goto(path)
}

/** A published test event with two tickets (₹1000 alumnus, ₹500 spouse). */
export function makeEvent(tag: string, published = true): { id: string; slug: string; alumnus: string; spouse: string } {
  const slug = `adm-${ts}-${tag}`
  const id = sql(`insert into events (slug, title, is_published, upi_id, upi_payee_name, starts_at, capacity)
                  values ('${slug}', 'Verify ${tag} ${ts}', ${published}, 'jecalumni@okicici', 'JEC Alumni', now() + interval '30 days', 500) returning id`).split('\n')[0]!
  const alumnus = sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort) values ('${id}', 'Alumnus', 100000, true, 1, 0) returning id`).split('\n')[0]!
  const spouse = sql(`insert into event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort) values ('${id}', 'Spouse', 50000, false, 1, 1) returning id`).split('\n')[0]!
  return { id, slug, alumnus, spouse }
}

/** Registers a member for an event (as that member) and, optionally, submits a UPI payment. */
export async function register(u: TestUser, ev: { id: string; alumnus: string }, pay = false) {
  const { data: reg, error } = await u.db.rpc('upsert_registration', {
    p_event: ev.id,
    p_details: { full_name: `Reg ${u.email}`, phone: '+91 90000 12345', email: u.email, accept_terms: true, grad_year: 2005, food_pref: 'veg', tshirt_size: 'L' },
    p_items: [{ ticket_type_id: ev.alumnus, quantity: 1 }],
  })
  if (error) throw error
  let payment: { id: string } | null = null
  if (pay) {
    const utr = String(Math.floor(1e11 + Math.random() * 8.9e11))
    const r = await u.db.rpc('submit_upi_payment', { p_registration: reg.id, p_utr: utr, p_payer_name: 'Payer', p_proof_path: null })
    if (r.error) throw r.error
    payment = r.data
  }
  return { reg: reg as { id: string; code: string }, payment }
}

export const auditCount = (where: string) => Number(sql(`select count(*) from admin_audit where ${where}`))
