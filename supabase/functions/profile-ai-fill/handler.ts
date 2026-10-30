// The request handling of profile-ai-fill, with its outside world (sign-in check, usage limits, Claude) passed in so the
// tests can run it without a network. index.ts wires the real ones.
import { corsHeaders, json } from '../_shared/http.ts'
import { ExtractError, extractProfile, type AiProfile, type ExtractErrorCode, type MessagesClient } from './extract.ts'
import { MAX_INPUT_CHARS } from './lists.ts'

export interface Quota {
  ok: boolean
  reason?: string
  used?: number
  limit?: number
}

export interface Deps {
  currentUser(authorization: string | null): Promise<{ id: string } | null>
  /** null when ANTHROPIC_API_KEY is not set: the app then shows the manual fields */
  client(): MessagesClient | null
  model: string
  /**
   * Another provider (AI_PROVIDER=gemini) used instead of Claude. `run` is null when its key is missing. Leave undefined for
   * the default Claude path.
   */
  alternate?: { name: string; run: ((text: string) => Promise<{ profile: AiProfile; usage: { input: number; output: number } }>) | null }
  /** takes one call from the member's and the global daily allowance */
  take(userId: string, chars: number): Promise<Quota>
  log?(line: Record<string, unknown>): void
}

const STATUS: Record<ExtractErrorCode, number> = {
  ai_not_configured: 503,
  ai_busy: 503,
  ai_unavailable: 503,
  ai_failed: 502,
  refusal: 422,
  truncated: 502,
  bad_output: 502,
}
const MESSAGES: Record<ExtractErrorCode, string> = {
  ai_not_configured: 'Magic fill is not switched on yet. Please fill in the fields yourself.',
  ai_busy: 'Magic fill is busy right now. Please try again in a minute, or fill in the fields yourself.',
  ai_unavailable: 'Magic fill could not be reached. Please try again, or fill in the fields yourself.',
  ai_failed: 'Magic fill could not read that. Please try different words, or fill in the fields yourself.',
  refusal: 'Magic fill could not read that text. Please describe your work in your own words.',
  truncated: 'That was too much to read at once. Please shorten it a little.',
  bad_output: 'Magic fill could not read that. Please try again, or fill in the fields yourself.',
}

export function makeHandler(deps: Deps) {
  const log = deps.log ?? ((l) => console.log(JSON.stringify({ fn: 'profile-ai-fill', ...l })))
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, { error: 'method' }, 405)

    const user = await deps.currentUser(req.headers.get('Authorization'))
    if (!user) return json(req, { error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as { text?: unknown; status?: unknown }
    // cheap "is the AI switched on?" check for the app: no quota taken, nothing sent anywhere
    if (body.status === true) return json(req, { available: deps.alternate ? !!deps.alternate.run : !!deps.client(), provider: deps.alternate?.name ?? 'anthropic' })
    const text = typeof body.text === 'string' ? body.text.replace(/\u0000/g, '').trim() : ''
    if (!text) return json(req, { error: 'empty', message: 'Please write a line or two about yourself first.' }, 400)
    if (text.length > MAX_INPUT_CHARS) {
      return json(req, { error: 'too_long', max: MAX_INPUT_CHARS, message: `Please keep it under ${MAX_INPUT_CHARS.toLocaleString('en-IN')} characters.` }, 413)
    }

    const client = deps.alternate ? null : deps.client()
    const run = deps.alternate ? deps.alternate.run : client ? (t: string) => extractProfile(client, deps.model, t) : null
    if (!run) return json(req, { error: 'ai_not_configured', message: MESSAGES.ai_not_configured }, 503)

    let quota: Quota
    try {
      quota = await deps.take(user.id, text.length)
    } catch {
      return json(req, { error: 'ai_unavailable', message: MESSAGES.ai_unavailable }, 503)
    }
    if (!quota.ok) {
      log({ ok: false, code: quota.reason ?? 'limit', chars: text.length })
      const global = quota.reason === 'global_limit'
      return json(
        req,
        {
          error: 'limit',
          reason: quota.reason,
          message: global
            ? 'Magic fill has reached today’s limit for everyone. Please fill in the fields yourself, or try again tomorrow.'
            : 'You have used Magic fill a lot today. Please fill in the fields yourself, or try again tomorrow.',
        },
        429,
      )
    }

    try {
      const { profile, usage } = await run(text)
      // counts only: the member's text and the extracted details are never logged or stored here
      log({ ok: true, chars: text.length, input_tokens: usage.input, output_tokens: usage.output, model: deps.model })
      return json(req, { profile, remaining: quota.limit !== undefined && quota.used !== undefined ? Math.max(0, quota.limit - quota.used) : null })
    } catch (e) {
      if (e instanceof ExtractError) {
        log({ ok: false, code: e.code, chars: text.length })
        return json(req, { error: e.code, message: MESSAGES[e.code] }, STATUS[e.code])
      }
      log({ ok: false, code: 'exception', chars: text.length })
      return json(req, { error: 'ai_unavailable', message: MESSAGES.ai_unavailable }, 503)
    }
  }
}
