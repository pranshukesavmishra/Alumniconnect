// "Suggest my profile": for the signed-in member only, ask Gemini with Google Search grounding what PUBLIC web pages say about
// this person at Jabalpur Engineering College, then turn that answer into the usual profile shape. Two calls because
// structured JSON output may not be combinable with the search tool:
//   1. grounded call (tools: google_search), plain text answer, must say UNKNOWN when it finds nothing reliable
//   2. extractWithGemini over that answer (no tools, same zod schema as every other reading)
// Written from the documented REST shape and never run against the real service in CI; the founder confirms with one real
// call (docs/SETUP.md). The member's name comes from their own profile on the server, never from the request.
import { ExtractError, type AiProfile } from './extract.ts'
import { checkReply, extractWithGemini, throwForStatus, type FetchLike, type GeminiReply } from './gemini.ts'

export interface SuggestInput {
  full_name: string
  grad_year: number | null
  branch: string | null
  city: string | null
  linkedin_url: string | null
}
export interface SuggestSource {
  title: string
}
export interface SuggestResult {
  found: boolean
  profile: AiProfile | null
  sources: SuggestSource[]
  usage: { input: number; output: number }
}

export const SEARCH_PROMPT = `You help a person fill in their own alumni profile for Jabalpur Engineering College (JEC), also called Government Engineering College Jabalpur (GEC), India.
Search the public web for the person described below. Answer ONLY from pages you actually found that clearly refer to this same person (name AND the college or the batch year). Never guess, never merge different people with the same name, never use social media posts about other people.
Write a short factual summary: current job title and company, city, earlier jobs and companies with years if the pages give them, degrees, and the JEC batch year and branch if shown.
If you cannot find a page that clearly matches, or you are not sure it is the same person, answer with exactly the single word UNKNOWN.`

const clean = (s: string | null | undefined, n: number) => (s ?? '').replace(/\p{Cc}+/gu, ' ').trim().slice(0, n)

function describe(i: SuggestInput): string {
  const lines = [`Name: ${clean(i.full_name, 120)}`, 'College: Jabalpur Engineering College (JEC) / Government Engineering College Jabalpur (GEC)']
  if (i.grad_year) lines.push(`Batch (passing-out year): ${i.grad_year}`)
  if (i.branch) lines.push(`Branch: ${clean(i.branch, 80)}`)
  if (i.city) lines.push(`City: ${clean(i.city, 80)}`)
  if (i.linkedin_url) lines.push(`LinkedIn profile: ${clean(i.linkedin_url, 200)}`)
  return lines.join('\n')
}

export async function suggestWithGemini(opts: { apiKey: string; model: string; input: SuggestInput; fetchFn?: FetchLike }): Promise<SuggestResult> {
  const fetchFn: FetchLike = opts.fetchFn ?? ((u, i) => fetch(u, i))
  if (clean(opts.input.full_name, 120).length < 2) return { found: false, profile: null, sources: [], usage: { input: 0, output: 0 } }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`
  const body = {
    systemInstruction: { parts: [{ text: SEARCH_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: describe(opts.input) }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0 },
  }
  let res: Response
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) })
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
  const answer = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('\n').trim()
  const usage = { input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 }
  if (answer.length < 30 || /^unknown\b/i.test(answer)) return { found: false, profile: null, sources: [], usage }

  const sources: SuggestSource[] = []
  for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
    const t = clean(c.web?.title, 80)
    if (t && !sources.some((s) => s.title === t)) sources.push({ title: t })
    if (sources.length >= 3) break
  }

  const second = await extractWithGemini({ apiKey: opts.apiKey, model: opts.model, text: `Facts found on public web pages about ${clean(opts.input.full_name, 120)}:\n${answer.slice(0, 6000)}`, fetchFn })
  usage.input += second.usage.input
  usage.output += second.usage.output
  const p = second.profile
  // the reading must not rename the member: it is only a suggestion for their own profile
  const useful = p.experiences.length || p.education.length || p.current_title || p.headline
  if (!useful) return { found: false, profile: null, sources: [], usage }
  return { found: true, profile: { ...p, full_name: null }, sources, usage }
}
