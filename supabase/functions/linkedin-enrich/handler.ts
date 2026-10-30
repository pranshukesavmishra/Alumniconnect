// Request handling for linkedin-enrich, with its outside world passed in (tests run it with fakes).
//   {mode: 'status'}                         -> {available}: is a provider configured? (free, no look-up)
//   {mode: 'email', consent: true}           -> look up the member's own verified sign-in e-mail
//   {mode: 'url', url, consent: true}        -> look up their LinkedIn profile link (linkedin.com/in/... only)
// Answers {profile, jec} with the same profile shape as Magic fill. A JEC education entry is recorded as a
// verification hint for admins (never stored: the provider's raw answer).
import { corsHeaders, json } from '../_shared/http.ts'
import { ProviderError, type EnrichProvider, type ProviderErrorCode } from './provider.ts'
import { findJec, normaliseLinkedInUrl } from './rules.ts'

export interface Quota {
  ok: boolean
  reason?: string
}

export interface Deps {
  /** the signed-in member with their sign-in e-mail (already verified by Supabase Auth) */
  currentUser(authorization: string | null): Promise<{ id: string; email: string | null } | null>
  provider(): EnrichProvider | null
  take(userId: string): Promise<Quota>
  recordHint(userId: string, hint: { school: string; degree: string | null; field: string | null; branch: string | null; start_year: number | null; end_year: number | null; linkedin_url: string | null }): Promise<string | null>
  log?(line: Record<string, unknown>): void
}

const STATUS: Record<ProviderErrorCode, number> = { enrich_not_configured: 503, enrich_busy: 503, enrich_unavailable: 503, enrich_out_of_credits: 503 }
const MSG: Record<ProviderErrorCode | 'no_match' | 'limit' | 'global_limit', string> = {
  enrich_not_configured: 'Filling from LinkedIn is not switched on yet. Please use Magic fill or add your details yourself.',
  enrich_busy: 'Filling from LinkedIn is busy right now. Please try again in a minute.',
  enrich_unavailable: 'Filling from LinkedIn could not be reached. Please try again, or use Magic fill.',
  enrich_out_of_credits: 'Filling from LinkedIn is paused for now. Please use Magic fill or add your details yourself.',
  no_match: 'We could not find your LinkedIn profile.',
  limit: 'You have tried this a few times today. Please try again tomorrow, or use Magic fill.',
  global_limit: 'Filling from LinkedIn has reached today’s limit. Please try again tomorrow, or use Magic fill.',
}

export function makeHandler(deps: Deps) {
  const log = deps.log ?? ((l) => console.log(JSON.stringify({ fn: 'linkedin-enrich', ...l })))
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, { error: 'method' }, 405)
    const user = await deps.currentUser(req.headers.get('Authorization'))
    if (!user) return json(req, { error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as { mode?: string; url?: unknown; consent?: unknown }
    const provider = deps.provider()
    if (body.mode === 'status') return json(req, { available: !!provider })
    if (body.mode !== 'email' && body.mode !== 'url') return json(req, { error: 'invalid' }, 400)
    if (body.consent !== true) return json(req, { error: 'consent', message: 'Please tick the box to agree to the look-up first.' }, 400)

    let query: { email?: string; profileUrl?: string }
    if (body.mode === 'url') {
      const url = normaliseLinkedInUrl(typeof body.url === 'string' ? body.url : '')
      if (!url) return json(req, { error: 'bad_url', message: 'Please paste a LinkedIn profile link, like linkedin.com/in/your-name.' }, 400)
      query = { profileUrl: url }
    } else {
      if (!user.email) return json(req, { error: 'no_match', message: MSG.no_match }, 404)
      query = { email: user.email.toLowerCase() }
    }
    if (!provider) return json(req, { error: 'enrich_not_configured', message: MSG.enrich_not_configured }, 503)

    let quota: Quota
    try {
      quota = await deps.take(user.id)
    } catch {
      return json(req, { error: 'enrich_unavailable', message: MSG.enrich_unavailable }, 503)
    }
    if (!quota.ok) {
      const global = quota.reason === 'global_limit'
      return json(req, { error: 'limit', reason: quota.reason, message: global ? MSG.global_limit : MSG.limit }, 429)
    }

    try {
      const found = await provider.lookup(query)
      if (!found) {
        log({ ok: false, code: 'no_match', mode: body.mode })
        return json(req, { error: 'no_match', message: MSG.no_match }, 404)
      }
      const jec = findJec(found.education)
      let hint: string | null = null
      if (jec) {
        found.grad_year = jec.end_year
        found.branch = jec.branch
        hint = await deps
          .recordHint(user.id, { school: jec.school, degree: jec.degree, field: jec.field, branch: jec.branch, start_year: jec.start_year, end_year: jec.end_year, linkedin_url: found.linkedin_url ?? query.profileUrl ?? null })
          .catch(() => null)
      }
      if (!found.linkedin_url && query.profileUrl) found.linkedin_url = query.profileUrl
      // counts only: no names, links or e-mail addresses in the log
      log({ ok: true, mode: body.mode, provider: provider.name, experiences: found.experiences.length, education: found.education.length, jec: jec?.kind ?? null })
      return json(req, { profile: found, jec: jec ? { ...jec, hint } : null })
    } catch (e) {
      if (e instanceof ProviderError) {
        log({ ok: false, code: e.code, mode: body.mode })
        return json(req, { error: e.code, message: MSG[e.code] }, STATUS[e.code])
      }
      log({ ok: false, code: 'exception', mode: body.mode })
      return json(req, { error: 'enrich_unavailable', message: MSG.enrich_unavailable }, 503)
    }
  }
}
