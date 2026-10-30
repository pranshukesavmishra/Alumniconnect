// Magic fill: "Tell us about yourself, paste your LinkedIn text, or speak" -> profile fields, for signed-in members.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets; never in the repo):
//   ANTHROPIC_API_KEY  the Claude API key. Without it the function answers 503 ai_not_configured and the app simply shows
//                      the manual fields.
//   AI_MODEL           optional, default claude-opus-5-5. claude-haiku-5-5 costs about 40x less ($0.10 / $0.50 per
//                      million input / output tokens against $4 / $20) and is plenty for this extraction.
//   AI_DAILY_CAP       optional, default 500: calls per day for everyone together (protects the budget).
// Limits: 12,000 characters per call; 10 calls per member per day (60 for admins), counted in the database
// (ai_fill_take). The text is sent to Claude and forgotten: only counts are logged.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { asService, currentUser } from '../_shared/db.ts'
import { DEFAULT_MODEL } from './extract.ts'
import { makeHandler, type Quota } from './handler.ts'

const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
const cap = Number.parseInt(Deno.env.get('AI_DAILY_CAP') ?? '', 10)
const client = key ? new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 }) : null

Deno.serve(
  makeHandler({
    currentUser,
    client: () => client,
    model: Deno.env.get('AI_MODEL')?.trim() || DEFAULT_MODEL,
    take: (userId, chars) => asService().rpc<Quota>('ai_fill_take', { p_user: userId, p_global_cap: Number.isFinite(cap) && cap >= 0 ? cap : 500, p_chars: chars }),
  }),
)
