// "Fill my profile from LinkedIn" for signed-in members, through a licensed people-data provider.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets; never in the repo):
//   ENRICH_PROVIDER     'pdl' (People Data Labs). Unset: the app hides the LinkedIn option and offers Magic fill.
//   PDL_API_KEY         the People Data Labs API key.
//   ENRICH_DAILY_CAP    optional, default 50: look-ups per day for everyone together (each match costs one credit).
// Limits: 3 look-ups per member per day (database: enrich_take). Consent is required on every look-up.
import { asService } from '../_shared/db.ts'
import { makeHandler, type Quota } from './handler.ts'
import { pdlProvider } from './provider.ts'
import { normaliseLinkedInUrl } from './rules.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const kind = Deno.env.get('ENRICH_PROVIDER')?.trim().toLowerCase()
const pdlKey = Deno.env.get('PDL_API_KEY')?.trim()
const cap = Number.parseInt(Deno.env.get('ENRICH_DAILY_CAP') ?? '', 10)
const provider = kind === 'pdl' && pdlKey ? pdlProvider(pdlKey, normaliseLinkedInUrl) : null

Deno.serve(
  makeHandler({
    async currentUser(authorization) {
      if (!authorization?.startsWith('Bearer ')) return null
      const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authorization } })
      if (!res.ok) return null
      const u = (await res.json()) as { id?: string; email?: string | null; email_confirmed_at?: string | null }
      if (!u.id) return null
      return { id: u.id, email: u.email && u.email_confirmed_at ? u.email : null }
    },
    provider: () => provider,
    take: (userId) => asService().rpc<Quota>('enrich_take', { p_user: userId, p_global_cap: Number.isFinite(cap) && cap >= 0 ? cap : 50 }),
    recordHint: (userId, h) =>
      asService().rpc<string | null>('record_verification_hint', {
        p_user: userId, p_school: h.school, p_degree: h.degree, p_field: h.field, p_branch: h.branch, p_start: h.start_year, p_end: h.end_year, p_linkedin: h.linkedin_url,
      }),
  }),
)
