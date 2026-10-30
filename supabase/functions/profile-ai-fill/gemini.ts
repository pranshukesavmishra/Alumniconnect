// Free-tier alternative to Claude: Google's Generative Language REST API (key from aistudio.google.com).
// One small file on purpose: it only builds the request and reads the reply; the prompt, the zod check and the tidy-up
// are shared with the Claude path (extract.ts). Written from the documented request shape, never run against the real
// service in CI: the founder confirms it once with a real call (docs/SETUP.md, "Free AI boost").
import { AiProfileSchema, ExtractError, SYSTEM_PROMPT, tidy, type AiProfile } from './extract.ts'
import { HELP_TAGS } from './lists.ts'

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const ns = { type: 'STRING', nullable: true }
const ni = { type: 'INTEGER', nullable: true }
const strs = { type: 'ARRAY', items: { type: 'STRING' } }

/** The same shape as OUTPUT_SCHEMA in the OpenAPI subset Gemini accepts (no additionalProperties; nullable instead of anyOf). */
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['full_name', 'headline', 'current_title', 'current_company', 'city', 'country', 'grad_year', 'branch', 'degree', 'experiences', 'education', 'skills', 'help_tags', 'interests', 'about'],
  properties: {
    full_name: ns, headline: ns, current_title: ns, current_company: ns, city: ns, country: ns, grad_year: ni, branch: ns, degree: ns,
    experiences: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['title', 'company', 'start_year', 'end_year', 'is_current', 'location'],
        properties: { title: { type: 'STRING' }, company: { type: 'STRING' }, start_year: ni, end_year: ni, is_current: { type: 'BOOLEAN' }, location: ns },
      },
    },
    education: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['school', 'degree', 'field', 'start_year', 'end_year'],
        properties: { school: { type: 'STRING' }, degree: ns, field: ns, start_year: ni, end_year: ni },
      },
    },
    skills: strs,
    help_tags: { type: 'ARRAY', items: { type: 'STRING', enum: [...HELP_TAGS] } },
    interests: strs,
    about: ns,
  },
} as const

export interface GeminiReply {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

/** Maps a non-OK HTTP answer to an ExtractError (429 busy, bad key / model unavailable). Returns normally for 2xx. */
export async function throwForStatus(res: Response): Promise<void> {
  if (res.status === 429) throw new ExtractError('ai_busy', 'The free AI limit is reached for now.')
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
    await res.body?.cancel().catch(() => undefined)
    throw new ExtractError('ai_unavailable', `The AI service refused the request (${res.status}); check the key and model.`)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new ExtractError('ai_unavailable', `The AI service answered ${res.status}.`)
  }
}

/** Safety blocks and cut-off replies throw; otherwise returns the first candidate. */
export function checkReply(data: GeminiReply): NonNullable<GeminiReply['candidates']>[number] | undefined {
  if (data.promptFeedback?.blockReason) throw new ExtractError('refusal', 'The AI declined to read this text.')
  const cand = data.candidates?.[0]
  if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT' || cand?.finishReason === 'BLOCKLIST') throw new ExtractError('refusal', 'The AI declined to read this text.')
  if (cand?.finishReason === 'MAX_TOKENS') throw new ExtractError('truncated', 'The reply was cut short.')
  return cand
}

/** Missing keys become null / [] so a reply that leaves out an empty field still passes the shared zod schema. */
function fillGaps(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = { ...(raw as Record<string, unknown>) }
  for (const k of ['full_name', 'headline', 'current_title', 'current_company', 'city', 'country', 'grad_year', 'branch', 'degree', 'about']) if (r[k] === undefined) r[k] = null
  for (const k of ['experiences', 'education', 'skills', 'help_tags', 'interests']) if (r[k] === undefined || r[k] === null) r[k] = []
  const fill = (v: unknown, defaults: Record<string, unknown>) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? { ...defaults, ...(x as object) } : x)) : v)
  r.experiences = fill(r.experiences, { start_year: null, end_year: null, location: null, is_current: false })
  r.education = fill(r.education, { degree: null, field: null, start_year: null, end_year: null })
  return r
}

export async function extractWithGemini(opts: { apiKey: string; model: string; text: string; fetchFn?: FetchLike }): Promise<{ profile: AiProfile; usage: { input: number; output: number } }> {
  const fetchFn: FetchLike = opts.fetchFn ?? ((u, i) => fetch(u, i))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: `<member_text>\n${opts.text}\n</member_text>` }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0 },
  }
  let res: Response
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
  } catch {
    throw new ExtractError('ai_unavailable', 'The AI service could not be reached.')
  }
  await throwForStatus(res)
  let data: GeminiReply
  try {
    data = (await res.json()) as GeminiReply
  } catch {
    throw new ExtractError('bad_output', 'The AI reply was not JSON.')
  }
  const cand = checkReply(data)
  const text = cand?.content?.parts?.[0]?.text
  if (!text) throw new ExtractError('bad_output', 'The AI reply had no text.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ExtractError('bad_output', 'The AI reply was not JSON.')
  }
  const parsed = AiProfileSchema.safeParse(fillGaps(raw))
  if (!parsed.success) throw new ExtractError('bad_output', 'The AI reply did not match the profile shape.')
  return { profile: tidy(parsed.data), usage: { input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 } }
}
