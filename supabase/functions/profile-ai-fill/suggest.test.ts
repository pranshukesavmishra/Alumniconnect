// Run: deno test --node-modules-dir=none --allow-env --allow-read supabase/functions/profile-ai-fill/suggest.test.ts
// "Suggest my profile" with a mocked fetch for both Gemini calls (grounded search, then JSON reading): no network, no key.
import { ExtractError } from './extract.ts'
import { makeHandler, type Deps } from './handler.ts'
import { suggestWithGemini, type SuggestInput } from './suggest.ts'
import type { FetchLike } from './gemini.ts'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}
const INPUT: SuggestInput = { full_name: 'Asha Verma', grad_year: 2008, branch: 'B.E. in Mechanical Engineering', city: 'Pune', linkedin_url: null }
const PROFILE = {
  full_name: 'Asha Verma', headline: 'Manager at L&T', current_title: 'Manager', current_company: 'L&T', city: 'Pune', country: 'India', grad_year: 2008, branch: null, degree: null,
  experiences: [{ title: 'Manager', company: 'L&T', start_year: 2015, end_year: null, is_current: true, location: 'Pune' }], education: [], skills: [], help_tags: [], interests: [], about: null,
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const grounded = (text: string) =>
  reply({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://v/1', title: 'ltts.com' } }, { web: { uri: 'https://v/2', title: 'example.org' } }, { web: { title: 'ltts.com' } }, { web: { title: 'a.com' } }, { web: { title: 'b.com' } }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  })
const json = (p: unknown) => reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(p) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 40 } })
const ANSWER = 'Asha Verma is a Manager at L&T in Pune since 2015. She studied mechanical engineering at JEC, batch 2008.'

Deno.test('found: two calls (search tool first, no tool second), up to 3 distinct sources, name never replaced, counts summed', async () => {
  const calls: { body: Record<string, unknown> }[] = []
  const f: FetchLike = (_u, init) => {
    const body = JSON.parse(String(init.body))
    calls.push({ body })
    return Promise.resolve(calls.length === 1 ? grounded(ANSWER) : json(PROFILE))
  }
  const r = await suggestWithGemini({ apiKey: 'k', model: 'gemini-2.5-flash', input: INPUT, fetchFn: f })
  eq(r.found, true, 'found')
  eq(r.sources, [{ title: 'ltts.com' }, { title: 'example.org' }, { title: 'a.com' }], 'three distinct sources')
  eq(r.profile?.current_company, 'L&T', 'company')
  eq(r.profile?.full_name, null, 'name is never taken from the web')
  eq(r.usage, { input: 160, output: 90 }, 'usage')
  eq(calls.length, 2, 'two calls')
  eq(calls[0]!.body.tools, [{ google_search: {} }], 'search tool on the first')
  eq('tools' in calls[1]!.body, false, 'no tool on the second')
  eq((calls[1]!.body.generationConfig as Record<string, unknown>).responseMimeType, 'application/json', 'json on the second')
  eq(JSON.stringify(calls[0]!.body.contents).includes('Asha Verma'), true, 'name asked')
})

Deno.test('unknown: one call only, nothing found', async () => {
  let n = 0
  for (const text of ['UNKNOWN', 'unknown.', 'x']) {
    const r = await suggestWithGemini({ apiKey: 'k', model: 'm', input: INPUT, fetchFn: () => { n++; return Promise.resolve(grounded(text)) } })
    eq(r.found, false, `not found for ${text}`)
  }
  eq(n, 3, 'second call never made')
})

Deno.test('a reading with nothing usable is not a suggestion', async () => {
  let n = 0
  const empty = { ...PROFILE, headline: null, current_title: null, current_company: null, experiences: [] }
  const r = await suggestWithGemini({ apiKey: 'k', model: 'm', input: INPUT, fetchFn: () => Promise.resolve(++n === 1 ? grounded(ANSWER) : json(empty)) })
  eq(r.found, false, 'not found')
})

async function code(f: FetchLike): Promise<string> {
  try {
    await suggestWithGemini({ apiKey: 'k', model: 'm', input: INPUT, fetchFn: f })
  } catch (e) {
    if (e instanceof ExtractError) return e.code
    throw e
  }
  return 'none'
}
Deno.test('429, bad key, safety block and network failure', async () => {
  eq(await code(() => Promise.resolve(reply({}, 429))), 'ai_busy', '429')
  eq(await code(() => Promise.resolve(reply({}, 403))), 'ai_unavailable', '403')
  eq(await code(() => Promise.resolve(reply({ promptFeedback: { blockReason: 'SAFETY' } }))), 'refusal', 'prompt block')
  eq(await code(() => Promise.resolve(reply({ candidates: [{ finishReason: 'SAFETY' }] }))), 'refusal', 'finish safety')
  eq(await code(() => Promise.reject(new TypeError('offline'))), 'ai_unavailable', 'network')
  let n = 0
  eq(await code(() => Promise.resolve(++n === 1 ? grounded(ANSWER) : reply({}, 429))), 'ai_busy', '429 on the second call')
})

Deno.test('a name that is too short is not searched', async () => {
  let n = 0
  const r = await suggestWithGemini({ apiKey: 'k', model: 'm', input: { ...INPUT, full_name: ' ' }, fetchFn: () => { n++; return Promise.resolve(grounded(ANSWER)) } })
  eq([r.found, n], [false, 0], 'no call')
})

function deps(over: Partial<Deps['suggester']> & { off?: boolean } = {}): { d: Deps; logs: Record<string, unknown>[]; takes: string[]; profiles: string[] } {
  const logs: Record<string, unknown>[] = []
  const takes: string[] = []
  const profiles: string[] = []
  const d: Deps = {
    currentUser: (a) => Promise.resolve(a ? { id: 'me' } : null),
    client: () => null,
    model: 'm',
    take: () => Promise.reject(new Error('the paste allowance must not be used')),
    log: (l) => logs.push(l),
    suggester: {
      run: over.off ? null : () => Promise.resolve({ found: true, profile: PROFILE, sources: [{ title: 'ltts.com' }], usage: { input: 1, output: 1 } }),
      profile: (id) => { profiles.push(id); return Promise.resolve(INPUT) },
      take: (id) => { takes.push(id); return Promise.resolve({ ok: true, used: 1, limit: 3 }) },
      ...over,
    },
  }
  return { d, logs, takes, profiles }
}
const post = (d: Deps, body: unknown, auth = 'Bearer t') => makeHandler(d)(new Request('http://fn', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) }))

Deno.test('handler: needs sign-in; name from the signed-in profile only; own allowance; counts-only logs', async () => {
  const w = deps()
  eq((await post(w.d, { suggest: true }, '')).status, 401, 'signed out')
  const res = await post(w.d, { suggest: true, name: 'Someone Else', full_name: 'Someone Else' })
  eq(res.status, 200, 'ok')
  const out = await res.json()
  eq([out.found, out.sources], [true, [{ title: 'ltts.com' }]], 'result')
  eq(w.profiles, ['me'], 'profile read for the signed-in user only')
  eq(w.takes, ['me'], 'suggest allowance taken')
  eq(JSON.stringify(w.logs).includes('Asha'), false, 'no name in logs')
  eq(JSON.stringify(w.logs).includes('L&T'), false, 'no result in logs')
})

Deno.test('handler: status says whether suggestions are on; off gives a friendly 503; limit gives 429', async () => {
  eq((await (await post(deps().d, { status: true })).json()).suggest, true, 'on')
  eq((await (await post(deps({ off: true }).d, { status: true })).json()).suggest, false, 'off')
  const off = await post(deps({ off: true }).d, { suggest: true })
  eq([off.status, (await off.json()).error], [503, 'ai_not_configured'], 'not configured')
  const lim = await post(deps({ take: () => Promise.resolve({ ok: false, reason: 'user_limit' }) }).d, { suggest: true })
  eq([lim.status, (await lim.json()).error], [429, 'limit'], 'limit')
  const busy = await post(deps({ run: () => Promise.reject(new ExtractError('ai_busy', 'x')) }).d, { suggest: true })
  eq([busy.status, (await busy.json()).error], [503, 'ai_busy'], 'busy')
})
