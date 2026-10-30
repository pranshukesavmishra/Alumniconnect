// Recorder helpers for the how-to-use guide video: phone viewport, CDP screencast, tap ripples and a pulsing callout ring.
// Local stack: Supabase on 54321/54322 (scripts/dev-stack.sh), app on APP_URL (vite dev server). Everything created here is sample data on example.com.
import { chromium } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

export const GUIDE = process.env.GUIDE
export const APP = process.env.APP_URL ?? 'http://localhost:5199'
export const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const MAILPIT = 'http://127.0.0.1:54324'
export const VW = 390
export const VH = 760
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
export function sql(query) {
  return execFileSync('psql', [DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim()
}

const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export function mintSession(uid, email) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 6 * 3600
  const payload = { sub: uid, email, role: 'authenticated', aud: 'authenticated', iat: now, exp, aal: 'aal1', session_id: randomUUID(), iss: 'http://127.0.0.1:54321/auth/v1' }
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return { access_token: `${head}.${body}.${sig}`, token_type: 'bearer', expires_in: 6 * 3600, expires_at: exp, refresh_token: randomUUID(),
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() } }
}

export async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const list = await res.json()
    const fresh = list.messages.find((m) => new Date(m.Created).getTime() >= after - 2000)
    if (fresh) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()
      const code = (msg.Text || msg.HTML).match(/\b(\d{6})\b/)?.[1]
      if (code) return code
    }
    await sleep(500)
  }
  throw new Error('no code')
}

// injected in every page: tap ripple + callout ring helpers
const INIT = `
document.addEventListener('pointerdown', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:' + (e.clientX - 28) + 'px;top:' + (e.clientY - 28) + 'px;width:56px;height:56px;border-radius:50%;background:rgba(232,163,61,.45);border:3px solid rgba(255,255,255,.95);box-shadow:0 0 16px rgba(232,163,61,.8);pointer-events:none;z-index:2147483647;transform:scale(.35);opacity:1;transition:transform .55s cubic-bezier(.2,.7,.2,1),opacity .55s ease-out';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.35)'; d.style.opacity = '0'; }));
  setTimeout(() => d.remove(), 700);
}, true);
window.__ring = null;
window.__callout = (el, label) => {
  window.__uncall();
  if (!el) return;
  const r = document.createElement('div');
  r.id = '__ring';
  r.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border-radius:14px;border:3.5px solid #E8A33D;box-shadow:0 0 0 4px rgba(232,163,61,.28),0 0 22px rgba(232,163,61,.55);animation:__pulse 1s ease-in-out infinite';
  document.documentElement.appendChild(r);
  let t = null;
  if (label) {
    t = document.createElement('div');
    t.textContent = label;
    t.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;background:#E8A33D;color:#2a1a02;font:700 13px/1 system-ui,sans-serif;padding:6px 10px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap';
    document.documentElement.appendChild(t);
  }
  const place = () => {
    if (!r.isConnected) return;
    const b = el.getBoundingClientRect();
    r.style.left = b.left - 5 + 'px'; r.style.top = b.top - 5 + 'px'; r.style.width = b.width + 10 + 'px'; r.style.height = b.height + 10 + 'px';
    if (t) { const w = t.offsetWidth; t.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2)) + 'px'; t.style.top = (b.top > 46 ? b.top - 36 : b.bottom + 10) + 'px'; }
    requestAnimationFrame(place);
  };
  r.__t = t; window.__ring = r; place();
};
window.__uncall = () => { const r = document.getElementById('__ring'); if (r) { if (r.__t) r.__t.remove(); r.remove(); } window.__ring = null; };
const st = document.createElement('style');
st.textContent = '@keyframes __pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.035);opacity:.8}}::-webkit-scrollbar{display:none}html{scrollbar-width:none}';
document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
`

export async function newRecorder({ name, session = null, lang = 'en', dark = false, record = true }) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] })
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata', colorScheme: dark ? 'dark' : 'light', permissions: [], reducedMotion: 'no-preference' })
  await ctx.addInitScript(INIT)
  await ctx.addInitScript(([s, l]) => {
    try { if (s && !localStorage.getItem('sb-127-auth-token')) localStorage.setItem('sb-127-auth-token', s); localStorage.setItem('jec-lang', l); localStorage.setItem('jec-welcome-seen', '1') } catch {}
  }, [session ? JSON.stringify(session) : null, lang])
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const frames = []
  let paused = !record, needOffset = false, offset = 0, lastTs = 0
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    if (paused) return
    if (needOffset) { offset += f.metadata.timestamp - lastTs - 0.04; needOffset = false }
    frames.push({ ts: f.metadata.timestamp - offset, buf: Buffer.from(f.data, 'base64') })
    lastTs = f.metadata.timestamp
  })
  const dir = `${GUIDE}/rec/${name}`
  return {
    page, ctx, browser, dir,
    async start() { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * 2, maxHeight: VH * 2, everyNthFrame: 1 }) },
    pause() { paused = true },
    resume() { paused = false; needOffset = true },
    async finish() {
      await sleep(400)
      await cdp.send('Page.stopScreencast').catch(() => {})
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      let list = ''
      frames.forEach((f, i) => {
        writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.jpg`, f.buf)
        const next = frames[i + 1]?.ts ?? f.ts + 0.2
        list += `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(next - f.ts, 0.001).toFixed(4)}\n`
      })
      list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`
      writeFileSync(`${dir}/list.txt`, list)
      const out = `${GUIDE}/rec/${name}.mp4`
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', out])
      rmSync(dir, { recursive: true, force: true })
      await browser.close()
      console.log(name, 'frames', frames.length, '->', out)
      return out
    },
  }
}

// ------------------------------------------------------------------ human-like interactions
export async function smoothScroll(page, px, ms = 1000) {
  await page.evaluate(([d, t]) => new Promise((res) => {
    const start = performance.now(), from = window.scrollY
    const el = document.scrollingElement
    const step = (now) => {
      const p = Math.min(1, (now - start) / t)
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      el.scrollTop = from + d * e
      p < 1 ? requestAnimationFrame(step) : res()
    }
    requestAnimationFrame(step)
  }), [px, ms])
}
export async function scrollIntoViewSmooth(page, loc, offset = 200, ms = 800) {
  const box = await loc.boundingBox()
  if (!box) return
  if (box.y < 90 || box.y + box.height > VH - 110) await smoothScroll(page, box.y - offset, ms)
}
/** highlight an element with the pulsing ring (and optional label) */
export async function callout(page, loc, label) {
  const h = await loc.elementHandle()
  await page.evaluate(([el, l]) => window.__callout(el, l), [h, label ?? null])
}
export const uncall = (page) => page.evaluate(() => window.__uncall())
/** callout, wait, tap, drop the ring */
export async function tap(page, loc, { label, look = 800, pause = 700, scroll = true, ring = true } = {}) {
  if (scroll) await scrollIntoViewSmooth(page, loc)
  if (ring) { await callout(page, loc, label); await sleep(look) }
  const box = await loc.boundingBox()
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  if (ring) await sleep(150)
  await uncall(page)
  await sleep(pause)
}
export async function typeSlow(page, loc, text, { delay = 80, label } = {}) {
  await tap(page, loc, { label, look: 600, pause: 250 })
  await loc.pressSequentially(text, { delay })
  await sleep(450)
}

/** the element with this text that is actually inside the phone viewport (the drawer item, not a hidden twin) */
export async function inView(page, text, role) {
  const all = role ? page.getByRole(role, { name: text }) : page.getByText(text)
  const n = await all.count()
  for (let i = 0; i < n; i++) {
    const b = await all.nth(i).boundingBox()
    if (b && b.y >= 0 && b.y + b.height <= VH && b.x >= 0 && b.width > 0) return all.nth(i)
  }
  return all.first()
}
