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
  kind: 'jec'
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lower-case words with the college's spelling variants folded: "Govt. Engg. Collage", "J.E.C.", "G.E.C." */
export function foldCollegeName(school: string): string {
  return flat(school.replace(/\./g, ''))
    .replace(/\b(govt|gov|govermment|goverment|govenment|governmnt)\b/g, 'government')
    .replace(/\b(engg|enggineering|enginering|engineerng|engineeing|eng)\b/g, 'engineering')
    .replace(/\b(collage|colege|collge|clg)\b/g, 'college')
    .replace(/\b([jg]) e c\b/g, '$1ec')
}

/**
 * The college has had two names: Government Engineering College (GEC) and Jabalpur Engineering College (JEC). Both, their
 * abbreviations and common typos are one institution. A university name alone (RDVV, Jabalpur University) is NOT JEC.
 * Keep in sync with src/lib/linkedin/common.ts (isJec).
 */
export function isJecSchool(school: string): 'jec' | null {
  const s = foldCollegeName(school)
  if (/\bjabalpur engineering\b/.test(s)) return 'jec'
  if (/\bgovernment engineering\b/.test(s) && /\b(jabalpur|jbp)\b/.test(s)) return 'jec'
  if (/\b(jec|gec|gecj)\b/.test(s) && /\b(jabalpur|jbp)\b/.test(s)) return 'jec'
  if (/^(jec|gec|j e c|g e c)( jbp)?$/.test(s)) return 'jec'
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

/** The JEC entry in a list of education entries. */
export function findJec(education: readonly EducationLike[]): JecMatch | null {
  for (const e of education) {
    const kind = isJecSchool(e.school)
    if (!kind) continue
    // only a start year ("1989 - ") on a four-year engineering degree: the batch is start + 4
    const end = e.end_year ?? (e.start_year && /\bb ?e\b|b ?tech|bachelor/.test(flat(e.degree ?? '')) ? e.start_year + 4 : null)
    return { school: e.school, degree: e.degree, field: e.field, branch: branchFromField(e.field, e.degree), start_year: e.start_year, end_year: end, kind }
  }
  return null
}
