// Provider adapters for "Fill my profile from LinkedIn". LinkedIn's own sign-in only shares name, e-mail and photo,
// and copying LinkedIn pages is against its terms, so a licensed people-data provider is asked instead. Each adapter
// turns its provider's answer into the same shape Magic fill returns; the raw answer is dropped right there.
import type { AiProfile } from '../profile-ai-fill/extract.ts'

export interface EnrichQuery {
  email?: string
  profileUrl?: string
}

export interface EnrichedProfile extends AiProfile {
  linkedin_url: string | null
}

export type ProviderErrorCode = 'enrich_not_configured' | 'enrich_busy' | 'enrich_unavailable' | 'enrich_out_of_credits'
export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string) {
    super(message)
  }
}

export interface EnrichProvider {
  name: string
  /** null when the provider has no confident match (no credit is used then) */
  lookup(q: EnrichQuery): Promise<EnrichedProfile | null>
}

// ---------------------------------------------------------------- People Data Labs (Person Enrichment API, v5)
// GET https://api.peopledatalabs.com/v5/person/enrich?profile=...|email=...&min_likelihood=N, header X-Api-Key.
// 200 {status, likelihood, data} on a match (1 credit); 404 when nothing matches (no credit).

interface PdlExperience {
  company?: { name?: string | null; location?: { name?: string | null } | null } | null
  title?: { name?: string | null } | null
  start_date?: string | null
  end_date?: string | null
  is_primary?: boolean | null
  location_names?: string[] | null
}
interface PdlEducation {
  school?: { name?: string | null } | null
  degrees?: string[] | null
  majors?: string[] | null
  start_date?: string | null
  end_date?: string | null
}
interface PdlPerson {
  full_name?: string | null
  headline?: string | null
  summary?: string | null
  linkedin_url?: string | null
  job_title?: string | null
  job_company_name?: string | null
  location_locality?: string | null
  location_country?: string | null
  skills?: string[] | null
  interests?: string[] | null
  experience?: PdlExperience[] | null
  education?: PdlEducation[] | null
}

/** PDL stores most text in lower case: "senior manager" -> "Senior Manager" (keeps L&T, IIT, TCS as written). */
export function titleCase(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t !== t.toLowerCase()) return t
  return t.replace(/(^|[\s(/&-])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase()).replace(/\b(Of|And|In|At|For|The)\b/g, (w, _x, i: number) => (i === 0 ? w : w.toLowerCase()))
}

const yearOf = (d: string | null | undefined): number | null => {
  const y = Number((d ?? '').slice(0, 4))
  return y >= 1940 && y <= 2100 ? y : null
}

export function mapPdlPerson(p: PdlPerson, normaliseUrl: (u: string) => string | null): EnrichedProfile {
  const experiences = (p.experience ?? [])
    .map((e) => ({
      title: titleCase(e.title?.name) ?? '',
      company: titleCase(e.company?.name) ?? '',
      start_year: yearOf(e.start_date),
      end_year: yearOf(e.end_date),
      is_current: !e.end_date && !!e.is_primary,
      location: titleCase(e.location_names?.[0] ?? null),
    }))
    .filter((e) => e.title && e.company)
    .sort((a, b) => Number(b.is_current) - Number(a.is_current) || (b.start_year ?? 0) - (a.start_year ?? 0))
    .slice(0, 15)
  const education = (p.education ?? [])
    .map((e) => ({
      school: titleCase(e.school?.name) ?? '',
      degree: titleCase(e.degrees?.[0] ?? null),
      field: titleCase(e.majors?.[0] ?? null),
      start_year: yearOf(e.start_date),
      end_year: yearOf(e.end_date),
    }))
    .filter((e) => e.school)
    .slice(0, 6)
  const current_title = titleCase(p.job_title)
  const current_company = titleCase(p.job_company_name)
  const city = titleCase(p.location_locality)
  const headline = titleCase(p.headline) ?? (current_title && current_company ? `${current_title} at ${current_company}` : null)
  return {
    full_name: titleCase(p.full_name),
    headline: headline ? headline.slice(0, 160) : null,
    current_title,
    current_company,
    city,
    country: titleCase(p.location_country),
    grad_year: null,
    branch: null,
    degree: null,
    experiences,
    education,
    skills: [...new Set((p.skills ?? []).map((s) => titleCase(s)).filter((s): s is string => !!s))].slice(0, 15),
    help_tags: [],
    interests: [...new Set((p.interests ?? []).map((s) => titleCase(s)).filter((s): s is string => !!s))].slice(0, 10),
    about: null,
    linkedin_url: p.linkedin_url ? normaliseUrl(p.linkedin_url) : null,
  }
}

export function pdlProvider(apiKey: string, normaliseUrl: (u: string) => string | null, fetchFn: typeof fetch = fetch): EnrichProvider {
  return {
    name: 'pdl',
    async lookup(q) {
      const params = new URLSearchParams({ min_likelihood: '6' })
      if (q.profileUrl) params.set('profile', q.profileUrl)
      else if (q.email) params.set('email', q.email)
      else return null
      let res: Response
      try {
        res = await fetchFn(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      } catch {
        throw new ProviderError('enrich_unavailable', 'The provider could not be reached.')
      }
      if (res.status === 404) {
        await res.body?.cancel()
        return null
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError('enrich_not_configured', 'The provider key is not valid.')
      if (res.status === 402) throw new ProviderError('enrich_out_of_credits', 'The provider has no credits left.')
      if (res.status === 429) throw new ProviderError('enrich_busy', 'The provider is busy.')
      if (!res.ok) throw new ProviderError('enrich_unavailable', `The provider answered ${res.status}.`)
      const body = (await res.json().catch(() => null)) as { status?: number; data?: PdlPerson } | null
      if (!body?.data || (body.status !== undefined && body.status !== 200)) return null
      return mapPdlPerson(body.data, normaliseUrl)
    },
  }
}
