// Pure rules (no Deno or npm imports, so the app's unit tests import this file too):
// the LinkedIn profile link, and "does this education entry say JEC?".
import { BRANCHES } from '../profile-ai-fill/lists.ts'

/**
 * "linkedin.com/in/asha-rao", "https://in.linkedin.com/in/asha-rao/?trk=x", "www.linkedin.com/in/Asha-Rao/details" ->
 * "https://www.linkedin.com/in/asha-rao". Anything not on linkedin.com, or not a /in/ profile, gives null.
 */
export function normaliseLinkedInUrl(raw: string | null | undefined): string | null {
  let t = (raw ?? '').trim()
  if (!t || t.length > 300) return null
  if (!/^[a-z]+:\/\//i.test(t)) t = `https://${t}`
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (host !== 'linkedin.com' && !/^([a-z]{2,3}|www|m)\.linkedin\.com$/.test(host)) return null
  const m = u.pathname.match(/^\/in\/([^/?#\s]+)\/?/i)
  if (!m) return null
  let slug: string
  try {
    slug = decodeURIComponent(m[1]!)
  } catch {
    return null
  }
  if (!/^[\p{L}\p{N}_-]{3,100}$/u.test(slug)) return null
  return `https://www.linkedin.com/in/${encodeURIComponent(slug.toLowerCase())}`
}

export interface EducationLike {
  school: string
  degree: string | null
  field: string | null
  start_year: number | null
  end_year: number | null
}

export interface JecMatch {
  school: string
  degree: string | null
  field: string | null
  branch: string | null
  start_year: number | null
  end_year: number | null
  /** 'jec' names the college; 'affiliation' only names its university (weaker, admins decide) */
  kind: 'jec' | 'affiliation'
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function isJecSchool(school: string): 'jec' | 'affiliation' | null {
  const s = flat(school)
  if (/\bjabalpur engineering college\b/.test(s)) return 'jec'
  if (/\b(government|govt) engineering college\b/.test(s) && /\bjabalpur\b/.test(s)) return 'jec'
  if (/\b(jec|gec|gecj)\b/.test(s) && /\bjabalpur\b/.test(s)) return 'jec'
  if (/^(jec|gec) jbp$|\bjec jbp\b/.test(s)) return 'jec'
  if (/\brani durgavati\b/.test(s) || /\brdvv\b/.test(s)) return 'affiliation'
  return null
}

const B = (name: (typeof BRANCHES)[number]) => name
const BRANCH_RULES: [RegExp, string][] = [
  [/mechatronic/, B('Mechatronics')],
  [/artificial intelligence|data science/, B('Artificial Intelligence & Data Science')],
  [/computer app|\bmca\b/, B('MCA')],
  [/structural/, B('M.E. in Structural Engineering')],
  [/industrial|production/, B('B.E. Industrial & Production Engineering')],
  [/electronics|telecom|\bec\b|\bece\b|\betc\b/, B('B.E. in Electronics & Telecommunications')],
  [/electrical|\bee\b/, B('B.E. in Electrical Engineering')],
  [/mechanical|\bmech\b/, B('B.E. in Mechanical Engineering')],
  [/computer|\bcse\b|\bcs\b/, B('B.E. in Computer Science & Engineering')],
  [/information tech|\bit\b/, B('B.E. in Information Technology')],
  [/civil/, B('B.E. in Civil Engineering')],
]

export function branchFromField(field: string | null | undefined, degree?: string | null): string | null {
  const s = flat(`${field ?? ''} ${degree ?? ''}`)
  if (!s) return null
  for (const [re, b] of BRANCH_RULES) if (re.test(s)) return b
  return null
}

/** The JEC entry in a list of education entries (the college itself before a university-only hint). */
export function findJec(education: readonly EducationLike[]): JecMatch | null {
  let weak: JecMatch | null = null
  for (const e of education) {
    const kind = isJecSchool(e.school)
    if (!kind) continue
    const m: JecMatch = { school: e.school, degree: e.degree, field: e.field, branch: branchFromField(e.field, e.degree), start_year: e.start_year, end_year: e.end_year, kind }
    if (kind === 'jec') return m
    // a university name alone only counts for an engineering degree
    if (!weak && /engineer|b ?e\b|b ?tech|m ?e\b|m ?tech/.test(flat(`${e.degree ?? ''} ${e.field ?? ''}`))) weak = m
  }
  return weak
}
