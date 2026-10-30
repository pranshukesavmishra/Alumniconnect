// Run: deno test --node-modules-dir=none --allow-env --allow-read supabase/functions/profile-ai-fill/index.test.ts
// The handler with a fake Claude client and fake limits: no network, no API key, no cost.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { makeHandler, type Deps, type Quota } from './handler.ts'
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, tidy, type AiProfile, type MessagesClient } from './extract.ts'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

const EMPTY: AiProfile = {
  full_name: null, headline: null, current_title: null, current_company: null, city: null, country: null, grad_year: null, branch: null,
  degree: null, experiences: [], education: [], skills: [], help_tags: [], interests: [], about: null,
}

const SAMPLE: AiProfile = {
  ...EMPTY,
  headline: 'Senior Manager at L&T, Pune',
  current_title: 'Senior Manager',
  current_company: 'L&T',
  city: 'Pune',
  country: 'India',
  grad_year: 2008,
  branch: 'B.E. in Mechanical Engineering',
  experiences: [
    { title: 'Senior Manager', company: 'L&T', start_year: null, end_year: null, is_current: true, location: 'Pune' },
    { title: 'Engineer', company: 'Tata Motors', start_year: null, end_year: null, is_current: false, location: null },
  ],
  skills: ['Automotive', 'automotive', 'Project management'],
  help_tags: ['Referrals', 'Not a real tag'],
  about: 'I am a senior manager at L&T in Pune. Earlier I spent 6 years at Tata Motors. I can help with jobs in automotive.',
}

function fakeClient(reply: Partial<Anthropic.Message> | Error, calls: Anthropic.MessageCreateParamsNonStreaming[] = []): MessagesClient {
  return {
    messages: {
      create(params) {
        calls.push(params)
        if (reply instanceof Error) return Promise.reject(reply)
        return Promise.resolve({
          id: 'msg_1', type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(SAMPLE), citations: null }],
          usage: { input_tokens: 900, output_tokens: 300 },
          ...reply,
        } as Anthropic.Message)
      },
    },
  }
}

interface World {
  deps: Deps
  calls: Anthropic.MessageCreateParamsNonStreaming[]
  takes: { user: string; chars: number }[]
  logs: Record<string, unknown>[]
}
function world(opts: { user?: boolean; client?: MessagesClient | null; quota?: Quota | Error; reply?: Partial<Anthropic.Message> | Error } = {}): World {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
  const takes: { user: string; chars: number }[] = []
  const logs: Record<string, unknown>[] = []
  const client = opts.client === undefined ? fakeClient(opts.reply ?? {}, calls) : opts.client
  return {
    calls,
    takes,
    logs,
    deps: {
      currentUser: (a) => Promise.resolve(opts.user === false || !a ? null : { id: 'user-1' }),
      client: () => client,
      model: 'claude-haiku-5-5',
      take: (user, chars) => {
        takes.push({ user, chars })
        return opts.quota instanceof Error ? Promise.reject(opts.quota) : Promise.resolve(opts.quota ?? { ok: true, used: 1, limit: 10 })
      },
      log: (l) => logs.push(l),
    },
  }
}
const call = (w: World, body: unknown = { text: 'Senior manager at L&T in Pune, Mech 2008' }, init: RequestInit = {}) =>
  makeHandler(w.deps)(
    new Request('http://fn/profile-ai-fill', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init }),
  )

Deno.test('signed-in member: one Claude call with structured output, low effort, no thinking settings; tidy result', async () => {
  const w = world()
  const res = await call(w)
  eq(res.status, 200, 'status')
  const out = await res.json()
  eq(out.profile.current_company, 'L&T', 'company')
  eq(out.profile.skills, ['Automotive', 'Project management'], 'skills de-duplicated')
  eq(out.profile.help_tags, ['Referrals'], 'unknown help tags dropped')
  eq(out.remaining, 9, 'remaining today')
  eq(w.calls.length, 1, 'one call')
  const p = w.calls[0]!
  eq(p.model, 'claude-haiku-5-5', 'model from config')
  eq(p.output_config?.effort, 'low', 'low effort')
  eq(p.output_config?.format?.type, 'json_schema', 'structured output')
  eq('thinking' in p, false, 'no thinking parameter (budget/disabled would 400 on Opus 5.5)')
  eq(p.system, SYSTEM_PROMPT, 'system prompt')
  eq(String((p.messages[0]!.content as string)).includes('Mech 2008'), true, 'text sent as user content')
  eq(w.takes, [{ user: 'user-1', chars: 'Senior manager at L&T in Pune, Mech 2008'.length }], 'quota taken with char count')
  // only counts are logged, never the text or the result
  eq(JSON.stringify(w.logs).includes('L&T'), false, 'no text in logs')
  eq(w.logs[0]!.input_tokens, 900, 'token counts logged')
})

Deno.test('every object in the output schema is closed and fully required', () => {
  const walk = (s: Record<string, unknown>, path: string) => {
    if (s.type === 'object') {
      eq(s.additionalProperties, false, `${path} closed`)
      eq(Object.keys(s.properties as object).sort(), [...(s.required as string[])].sort(), `${path} required`)
      for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`)
    }
    if (s.type === 'array') walk(s.items as Record<string, unknown>, `${path}[]`)
  }
  walk(OUTPUT_SCHEMA as unknown as Record<string, unknown>, '$')
})

Deno.test('not signed in: 401 and no Claude call, no quota taken', async () => {
  const w = world({ user: false })
  eq((await call(w)).status, 401, 'status')
  eq(w.calls.length + w.takes.length, 0, 'nothing called')
})

Deno.test('empty and too long text are refused before any cost', async () => {
  const w = world()
  eq((await call(w, { text: '   ' })).status, 400, 'empty')
  const long = await call(w, { text: 'x'.repeat(12_001) })
  eq(long.status, 413, 'too long')
  eq((await long.json()).error, 'too_long', 'code')
  eq((await call(w, { text: 'x'.repeat(12_000) })).status, 200, 'exactly at the limit is fine')
  eq(w.calls.length, 1, 'only the valid one reached Claude')
})

Deno.test('AI not configured: friendly 503 so the app shows the manual fields; quota untouched', async () => {
  const w = world({ client: null })
  const res = await call(w)
  eq(res.status, 503, 'status')
  eq((await res.json()).error, 'ai_not_configured', 'code')
  eq(w.takes.length, 0, 'no quota taken')
})

Deno.test('daily limits: per member and global', async () => {
  const mine = await call(world({ quota: { ok: false, reason: 'user_limit', used: 10, limit: 10 } }))
  eq(mine.status, 429, 'status')
  eq((await mine.json()).reason, 'user_limit', 'reason')
  const all = await call(world({ quota: { ok: false, reason: 'global_limit' } }))
  eq((await all.json()).reason, 'global_limit', 'global')
  const broken = await call(world({ quota: new Error('db down') }))
  eq(broken.status, 503, 'limit check failing closes the door')
})

Deno.test('refusal and cut-off replies are reported, not parsed', async () => {
  const r = await call(world({ reply: { stop_reason: 'refusal', content: [] } }))
  eq([r.status, (await r.json()).error], [422, 'refusal'], 'refusal')
  const t = await call(world({ reply: { stop_reason: 'max_tokens' } }))
  eq([t.status, (await t.json()).error], [502, 'truncated'], 'max tokens')
})

Deno.test('a reply that is not valid JSON or not the right shape is rejected (zod)', async () => {
  const notJson = await call(world({ reply: { content: [{ type: 'text', text: 'Sure! Here you go', citations: null }] } }))
  eq((await notJson.json()).error, 'bad_output', 'not json')
  const wrong = await call(world({ reply: { content: [{ type: 'text', text: JSON.stringify({ ...SAMPLE, experiences: 'many' }), citations: null }] } }))
  eq([wrong.status, (await wrong.json()).error], [502, 'bad_output'], 'wrong shape')
})

Deno.test('typed SDK errors map to friendly codes', async () => {
  const cases: [Error, number, string][] = [
    [new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers()), 503, 'ai_not_configured'],
    [new Anthropic.RateLimitError(429, {}, 'slow down', new Headers()), 503, 'ai_busy'],
    [new Anthropic.BadRequestError(400, {}, 'bad', new Headers()), 502, 'ai_failed'],
    [new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()), 503, 'ai_unavailable'],
    [new Anthropic.APIConnectionError({ message: 'offline' }), 503, 'ai_unavailable'],
    [new TypeError('boom'), 503, 'ai_unavailable'],
  ]
  for (const [err, status, code] of cases) {
    const res = await call(world({ reply: err }))
    eq([res.status, (await res.json()).error], [status, code], err.constructor.name)
  }
})

Deno.test('tidy keeps the app limits: about <= 400, skills <= 15, years in range, branch from the list only', () => {
  const t = tidy({
    ...EMPTY,
    about: 'I build things. '.repeat(60),
    skills: Array.from({ length: 30 }, (_, i) => `Skill ${i}`),
    grad_year: 1850,
    branch: 'Mechanical',
    experiences: [{ title: ' ', company: 'X', start_year: 3000, end_year: null, is_current: false, location: null }],
  })
  eq(t.about!.length <= 400, true, 'about length')
  eq(t.skills.length, 15, 'skills cap')
  eq(t.grad_year, null, 'year out of range')
  eq(t.branch, null, 'branch not in list')
  eq(t.experiences.length, 0, 'empty title dropped')
})

Deno.test('CORS preflight and wrong method', async () => {
  const w = world()
  eq((await makeHandler(w.deps)(new Request('http://fn/x', { method: 'OPTIONS' }))).status, 204, 'preflight')
  eq((await makeHandler(w.deps)(new Request('http://fn/x', { method: 'GET' }))).status, 405, 'GET')
})
