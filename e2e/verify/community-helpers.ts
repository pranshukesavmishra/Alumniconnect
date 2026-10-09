import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { onboard, signInWithEmail, sql } from '../helpers'

export { sql }

export const API = 'http://127.0.0.1:54321'
export const ANON = (() => {
  try {
    return readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
})()

export const run = Date.now().toString(36)
let seq = 0
export const email = (tag: string) => `com-${run}-${tag}-${seq++}@test.local`

export interface User {
  ctx: BrowserContext
  page: Page
  email: string
  id: string
  name: string
  errors: string[]
}

/** Console errors + uncaught exceptions; ignores aborted fetches that Chromium logs on navigation. */
export function collectErrors(page: Page, into: string[]) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/ERR_ABORTED|net::ERR_INTERNET_DISCONNECTED/.test(t)) return
    // the local stack runs without the realtime container (supabase start -x realtime): socket 503s are environmental
    if (/realtime\/v1\/websocket/.test(t)) return
    if (/Failed to load resource/.test(t)) return // reported with its URL by the response listener below
    into.push(`[console] ${page.url()} :: ${t}`)
  })
  page.on('response', (r) => {
    if (r.status() < 400) return
    const u = r.url()
    into.push(`[http ${r.status()}] ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')} (on ${new URL(page.url()).pathname})`)
  })
  page.on('pageerror', (e) => into.push(`[pageerror] ${page.url()} :: ${e.message}`))
}

export async function newContext(browser: Browser) {
  return browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, baseURL: 'http://localhost:5185' })
}

/** Signs a brand-new member in through the real email-code flow and completes onboarding. */
export async function newMember(
  browser: Browser,
  opts: { tag: string; name?: string; year?: string; branch?: string; verified?: boolean; admin?: boolean; path?: string } ,
): Promise<User> {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  const errors: string[] = []
  collectErrors(page, errors)
  page.on('dialog', (d) => void d.accept()) // confirm() prompts in the app: accept by default
  const mail = email(opts.tag)
  const name = opts.name ?? `Com ${opts.tag} ${run.slice(-4)}`
  await page.goto(opts.path ?? '/signin')
  if (opts.path && opts.path !== '/signin') await page.getByRole('link', { name: 'Sign in or join' }).click()
  await signInWithEmail(page, mail)
  await onboard(page, name, opts.year ?? '2012')
  if (opts.branch && opts.branch !== 'Computer Science & Engineering') {
    sql(`update profiles set branch = '${opts.branch}' where id = (select id from auth.users where email = '${mail}')`)
  }
  await expect(page).not.toHaveURL(/welcome/)
  const id = sql(`select id from auth.users where email = '${mail}'`)
  if (opts.verified !== false) sql(`update profiles set verification = 'verified' where id = '${id}'`)
  if (opts.admin) sql(`update profiles set is_admin = true where id = '${id}'`)
  await page.reload()
  return { ctx, page, email: mail, id, name, errors }
}

/** The access token of the signed-in member in this page (for direct REST probes of RLS). */
export async function token(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return JSON.parse(localStorage.getItem(k)!).access_token as string
    }
    return ''
  })
}

export async function rest(page: Page, path: string, init: RequestInit = {}) {
  const t = await token(page)
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep text */
  }
  return { status: res.status, body }
}

export async function rpc(page: Page, fn: string, args: Record<string, unknown> = {}) {
  return rest(page, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
}

export async function waitFor(fn: () => string, want: string | RegExp, timeout = 10_000) {
  const start = Date.now()
  let v = ''
  while (Date.now() - start < timeout) {
    v = fn()
    if (typeof want === 'string' ? v === want : want.test(v)) return v
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`waitFor: last value ${JSON.stringify(v)} did not match ${want}`)
}

export function postCard(page: Page, text: string) {
  return page.locator('div.overflow-hidden').filter({ has: page.getByText(text, { exact: false }) }).last()
}
