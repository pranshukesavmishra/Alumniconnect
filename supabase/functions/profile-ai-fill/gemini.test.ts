// Run: deno test --node-modules-dir=none --allow-env --allow-read supabase/functions/profile-ai-fill/gemini.test.ts
// The Gemini adapter and the status/alternate wiring with a mocked fetch: no network, no key.
import { ExtractError } from './extract.ts'
import { extractWithGemini, GEMINI_SCHEMA, type FetchLike } from './gemini.ts'
import { makeHandler, type Deps } from './handler.ts'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}
const PROFILE = {
  full_name: 'Asha Verma', headline: 'Engineer at L&T', current_title: 'Engineer', current_company: 'L&T', city: 'Pune', country: 'India', grad_year: 2008,
  branch: 'B.E. in Mechanical Engineering', degree: 'B.E.', experiences: [{ title: 'Engineer', company: 'L&T', start_year: 2010, end_year: null, is_current: true, location: 'Pune' }],
  education: [], skills: ['CAD', 'cad'], help_tags: [], interests: [], about: null,
}
const reply = (body: unknown, status = 200): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const ok = (p: unknown = PROFILE) => reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(p) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 200 } })
async function code(f: FetchLike): Promise<string> {
  try {
    await extractWithGemini({ apiKey: 'k', model: 'gemini-2.5-flash', text: 'hi', fetchFn: f })
  } catch (e) {
    if (e instanceof ExtractError) return e.code
    throw e
  }
  return 'none'
}

Deno.test('success: right URL, key header, body shape; tidy result and token counts', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const r = await extractWithGemini({ apiKey: 'KEY', model: 'gemini-2.5-flash', text: 'Engineer at L&T', fetchFn: (url, init) => { seen = { url, init }; return Promise.resolve(ok()) } })
  eq(r.profile.current_company, 'L&T', 'company')
  eq(r.profile.skills, ['CAD'], 'tidied')
  eq(r.usage, { input: 700, output: 200 }, 'usage')
  eq(seen!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', 'url')
  eq((seen!.init.headers as Record<string, string>)['x-goog-api-key'], 'KEY', 'key header (not in the URL)')
  const body = JSON.parse(String(seen!.init.body))
  eq(body.generationConfig.responseMimeType, 'application/json', 'json mode')
  eq(body.generationConfig.temperature, 0, 'temperature')
  eq(body.generationConfig.responseSchema, JSON.parse(JSON.stringify(GEMINI_SCHEMA)), 'schema')
  eq(body.contents[0].role, 'user', 'role')
  eq(body.contents[0].parts[0].text.includes('Engineer at L&T'), true, 'text sent')
  eq(typeof body.systemInstruction.parts[0].text, 'string', 'system instruction')
})

Deno.test('reply that leaves out empty fields still passes', async () => {
  const r = await extractWithGemini({ apiKey: 'k', model: 'm', text: 't', fetchFn: () => Promise.resolve(ok({ headline: 'Hi', experiences: [{ title: 'A', company: 'B' }] })) })
  eq(r.profile.headline, 'Hi', 'headline')
  eq(r.profile.experiences.length, 1, 'experience kept')
  eq(r.profile.experiences[0]!.is_current, false, 'defaulted')
})

Deno.test('safety block, finishReason SAFETY and MAX_TOKENS', async () => {
  eq(await code(() => Promise.resolve(reply({ promptFeedback: { blockReason: 'SAFETY' } }))), 'refusal', 'prompt block')
  eq(await code(() => Promise.resolve(reply({ candidates: [{ finishReason: 'SAFETY' }] }))), 'refusal', 'finish safety')
  eq(await code(() => Promise.resolve(reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }))), 'truncated', 'max tokens')
})

Deno.test('429 is ai_busy; bad key and unknown model are ai_unavailable; 500 and network errors too', async () => {
  eq(await code(() => Promise.resolve(reply({ error: {} }, 429))), 'ai_busy', '429')
  eq(await code(() => Promise.resolve(reply({ error: {} }, 400))), 'ai_unavailable', '400')
  eq(await code(() => Promise.resolve(reply({ error: {} }, 403))), 'ai_unavailable', '403')
  eq(await code(() => Promise.resolve(reply('x', 503))), 'ai_unavailable', '503')
  eq(await code(() => Promise.reject(new TypeError('offline'))), 'ai_unavailable', 'network')
})

Deno.test('malformed output: not JSON, wrong shape, no text, bad reply body', async () => {
  const text = (t: string) => reply({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] })
  eq(await code(() => Promise.resolve(text('not json'))), 'bad_output', 'not json')
  eq(await code(() => Promise.resolve(text('[1,2]'))), 'bad_output', 'array')
  eq(await code(() => Promise.resolve(text(JSON.stringify({ ...PROFILE, grad_year: 'x' })))), 'bad_output', 'wrong type')
  eq(await code(() => Promise.resolve(reply({ candidates: [] }))), 'bad_output', 'no candidates')
  eq(await code(() => Promise.resolve(reply('<html>'))), 'bad_output', 'html body')
})

function deps(over: Partial<Deps>): Deps {
  return { currentUser: () => Promise.resolve({ id: 'u' }), client: () => null, model: 'm', take: () => Promise.resolve({ ok: true, used: 1, limit: 10 }), log: () => undefined, ...over }
}
const post = (d: Deps, body: unknown) => makeHandler(d)(new Request('http://fn', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }))

Deno.test('status mode: no quota taken; reflects whether the provider has a key', async () => {
  let takes = 0
  const take = () => { takes++; return Promise.resolve({ ok: true }) }
  const on = await (await post(deps({ take, alternate: { name: 'gemini', run: () => Promise.reject(new Error('never')) } }), { status: true })).json()
  eq(on, { available: true, provider: 'gemini', suggest: false }, 'gemini on')
  const off = await (await post(deps({ take, alternate: { name: 'gemini', run: null } }), { status: true })).json()
  eq(off.available, false, 'gemini without key')
  eq((await (await post(deps({ take }), { status: true })).json()).available, false, 'claude without key')
  eq(takes, 0, 'status never takes quota')
  const unauth = await makeHandler(deps({ currentUser: () => Promise.resolve(null) }))(new Request('http://fn', { method: 'POST', body: '{"status":true}' }))
  eq(unauth.status, 401, 'status needs sign-in')
})

Deno.test('alternate provider: handler uses it, takes quota, maps its errors', async () => {
  let takes = 0
  const take = () => { takes++; return Promise.resolve({ ok: true, used: 2, limit: 10 }) }
  const good = await post(deps({ take, alternate: { name: 'gemini', run: () => Promise.resolve({ profile: { ...PROFILE } as never, usage: { input: 1, output: 1 } }) } }), { text: 'hello' })
  eq(good.status, 200, 'ok')
  eq((await good.json()).remaining, 8, 'remaining')
  const busy = await post(deps({ take, alternate: { name: 'gemini', run: () => Promise.reject(new ExtractError('ai_busy', 'x')) } }), { text: 'hello' })
  eq(busy.status, 503, 'busy')
  eq((await busy.json()).error, 'ai_busy', 'busy code')
  eq(takes, 2, 'quota taken per call')
})
