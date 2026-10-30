// Pure rules for quick profiles: map what Magic fill found to the app's lists, decide what may be written without
// overwriting anything the member already has, suggest skills from a job title, and normalise reunion-list rows.
import { BRANCHES, HELP_TAGS } from '../../lib/constants'
import { normaliseBranch } from '../../lib/memberImport'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import type { Profile } from '../../lib/types'

/** The reply of the profile-ai-fill function (same shape as supabase/functions/profile-ai-fill/extract.ts). */
export interface AiExperience {
  title: string
  company: string
  start_year: number | null
  end_year: number | null
  is_current: boolean
  location: string | null
}
export interface AiEducation {
  school: string
  degree: string | null
  field: string | null
  start_year: number | null
  end_year: number | null
}
export interface AiProfile {
  full_name: string | null
  headline: string | null
  current_title: string | null
  current_company: string | null
  city: string | null
  country: string | null
  grad_year: number | null
  branch: string | null
  degree: string | null
  experiences: AiExperience[]
  education: AiEducation[]
  skills: string[]
  help_tags: string[]
  interests: string[]
  about: string | null
  /** only from "Fill from LinkedIn" */
  linkedin_url?: string | null
}

// ---------------------------------------------------------------- lists

const BRANCH_RULES: [RegExp, string][] = [
  [/mechatronic/i, 'Mechatronics'],
  [/\b(ai\s*(&|and)?\s*ds|aids|artificial intelligence|data science)\b/i, 'Artificial Intelligence & Data Science'],
  [/\bmca\b|master of computer app/i, 'MCA'],
  [/structural/i, 'M.E. in Structural Engineering'],
  [/communication system/i, 'M.E. in Communication Systems'],
  [/environment/i, 'M.E. in Environmental Engineering'],
  [/high voltage/i, 'M.E. in High Voltage Engineering'],
  [/power system/i, 'M.E. in Power Systems Engineering'],
  [/heat power|machine design/i, 'M.E. in Heat Power Engineering / Machine Design'],
  [/\b(industrial|production|ip|ipe)\b/i, 'B.E. Industrial & Production Engineering'],
  [/\b(e\s*&\s*tc|e\s*n\s*tc|etc|ece|ec|entc|electronics|telecom)/i, 'B.E. in Electronics & Telecommunications'],
  [/\b(electrical|ee|eee)\b/i, 'B.E. in Electrical Engineering'],
  [/\b(mech|mechanical|me)\b/i, 'B.E. in Mechanical Engineering'],
  [/\b(cse|cs|computer)/i, 'B.E. in Computer Science & Engineering'],
  [/\b(it|information tech)/i, 'B.E. in Information Technology'],
  [/\bcivil|\bce\b/i, 'B.E. in Civil Engineering'],
]

/** "Mech", "B.E. Mechanical", "CSE" -> the app's branch name; null when it cannot be told. */
export function mapBranch(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  const exact = BRANCHES.find((b) => b.toLowerCase() === t.toLowerCase())
  if (exact) return exact
  const viaImport = normaliseBranch(t)
  if ((BRANCHES as readonly string[]).includes(viaImport)) return viaImport
  for (const [re, b] of BRANCH_RULES) if (re.test(t)) return b
  return null
}

const HELP_RULES: [RegExp, (typeof HELP_TAGS)[number]][] = [
  [/referr|job|placement|openings?/i, 'Referrals'],
  [/mentor|guid|career|advice|counsel/i, 'Career guidance'],
  [/mock|interview/i, 'Mock interviews'],
  [/higher stud|\bms\b|\bmba\b|\bgate\b|\bgre\b|abroad|masters|phd/i, 'Higher studies'],
  [/startup|founder|entrepreneur/i, 'Startups'],
  [/government|govt|upsc|psc|psu|civil service/i, 'Government jobs'],
  [/hiring|recruit/i, 'Hiring'],
]

/** Free words or near-misses ("can help with jobs", "mentoring") -> the app's help tags, without repeats. */
export function mapHelpTags(list: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const t = raw.trim()
    const exact = HELP_TAGS.find((h) => h.toLowerCase() === t.toLowerCase())
    const hit = exact ?? HELP_RULES.find(([re]) => re.test(t))?.[1]
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

/** Case-insensitive union, existing values first, trimmed, capped. */
export function unionList(current: readonly string[], incoming: readonly string[], max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of [...current, ...incoming]) {
    const t = v.replace(/\s+/g, ' ').trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

// ---------------------------------------------------------------- preview

export type ScalarKey = 'full_name' | 'headline' | 'current_title' | 'current_company' | 'city' | 'country' | 'grad_year' | 'branch' | 'about' | 'linkedin_url'
export type ListKey = 'skills' | 'help_tags' | 'interests'
export const SCALAR_KEYS: ScalarKey[] = ['full_name', 'current_title', 'current_company', 'headline', 'city', 'country', 'branch', 'grad_year', 'about', 'linkedin_url']
export const LIST_KEYS: ListKey[] = ['skills', 'help_tags', 'interests']
const LIST_MAX: Record<ListKey, number> = { skills: 50, help_tags: 12, interests: 30 }

export interface ScalarItem {
  key: ScalarKey
  value: string
  /** what the profile has now ('' when empty) */
  current: string
  /** the profile already has a different value: never replaced unless the member ticks it */
  replaces: boolean
  checked: boolean
}
export interface ListItem {
  key: ListKey
  /** only the values the profile does not have yet */
  values: string[]
  checked: boolean
}
export interface Preview {
  scalars: ScalarItem[]
  lists: ListItem[]
  experiences: (AiExperience & { checked: boolean; exists: boolean })[]
  education: (AiEducation & { checked: boolean })[]
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ')

type ProfileLike = Pick<Profile, ScalarKey | ListKey>

/**
 * What Magic fill found, against what the profile has. Empty fields are ticked; a field that already holds something
 * different is shown unticked ("replaces ...") so nothing is overwritten silently; identical values are left out.
 */
export function buildPreview(ai: AiProfile, current: ProfileLike, existingExperiences: readonly { title: string; company: string }[] = []): Preview {
  const incoming: Record<ScalarKey, string> = {
    full_name: str(ai.full_name),
    headline: str(ai.headline),
    current_title: str(ai.current_title),
    current_company: str(ai.current_company),
    city: str(ai.city),
    country: str(ai.country),
    grad_year: ai.grad_year && ai.grad_year >= 1947 && ai.grad_year <= 2100 ? String(ai.grad_year) : '',
    branch: mapBranch(ai.branch) ?? '',
    about: str(ai.about).slice(0, 400),
    linkedin_url: /^https:\/\/www\.linkedin\.com\/in\/[^/?#\s]+$/.test(str(ai.linkedin_url)) ? str(ai.linkedin_url) : '',
  }
  const scalars: ScalarItem[] = []
  for (const key of SCALAR_KEYS) {
    const value = incoming[key]
    const cur = str(current[key])
    if (!value || same(value, cur)) continue
    // the name from sign-in is kept unless it is missing; the country only matters with a city
    if (key === 'full_name' && cur.length >= 2) continue
    if (key === 'country' && same(value, 'India') && !cur) continue
    const replaces = cur !== ''
    scalars.push({ key, value, current: cur, replaces, checked: !replaces })
  }
  const lists: ListItem[] = []
  const lists_in: Record<ListKey, string[]> = { skills: ai.skills.slice(0, 15), help_tags: mapHelpTags(ai.help_tags), interests: ai.interests.slice(0, 10) }
  for (const key of LIST_KEYS) {
    const have = new Set((current[key] ?? []).map((x) => x.toLowerCase()))
    const values = unionList([], lists_in[key], 15).filter((v) => !have.has(v.toLowerCase()))
    if (values.length) lists.push({ key, values, checked: true })
  }
  const known = new Set(existingExperiences.map((e) => `${e.title.toLowerCase()}|${e.company.toLowerCase()}`))
  const experiences = ai.experiences
    .filter((e) => str(e.title) && str(e.company))
    .map((e) => {
      const exists = known.has(`${e.title.trim().toLowerCase()}|${e.company.trim().toLowerCase()}`)
      return { ...e, exists, checked: !exists }
    })
  const education = ai.education.filter((e) => str(e.school)).map((e) => ({ ...e, checked: true }))
  return { scalars, lists, experiences, education }
}

export function previewIsEmpty(p: Preview): boolean {
  return !p.scalars.length && !p.lists.length && !p.experiences.some((e) => !e.exists) && !p.education.length
}

export interface QuickSave {
  profile: Record<string, string | number | string[] | null>
  experiences: AiExperience[]
  educations: AiEducation[]
}

/** The ticked parts of a preview, ready for save_my_quick_profile. Lists are merged with what the profile has. */
export function previewToSave(p: Preview, current: ProfileLike): QuickSave {
  const profile: QuickSave['profile'] = {}
  for (const s of p.scalars) {
    if (!s.checked || !s.value.trim()) continue
    profile[s.key] = s.key === 'grad_year' ? Number(s.value) : s.value.trim()
  }
  for (const l of p.lists) {
    if (!l.checked || !l.values.length) continue
    profile[l.key] = unionList(current[l.key] ?? [], l.values, LIST_MAX[l.key])
  }
  return {
    profile,
    experiences: p.experiences.filter((e) => e.checked && !e.exists).map(({ checked: _c, exists: _e, ...e }) => e),
    educations: p.education.filter((e) => e.checked).map(({ checked: _c, ...e }) => e),
  }
}

/**
 * Generic merge rule (registration answers, reunion list, imports): fill a field only when it is empty. Returns the
 * fields that may be written. Values the profile already has are never changed.
 */
export function fillEmpty<T extends Record<string, unknown>>(current: T, incoming: Partial<T>): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(incoming) as [keyof T, T[keyof T]][]) {
    const empty = (x: unknown) => x === null || x === undefined || (typeof x === 'string' && x.trim() === '') || (Array.isArray(x) && x.length === 0)
    if (empty(v)) continue
    if (empty(current[k])) out[k] = v
  }
  return out
}

// ---------------------------------------------------------------- nudges

const SKILL_RULES: [RegExp, string[]][] = [
  [/software|developer|programmer|full ?stack|front ?end|back ?end|sde|devops/i, ['Software development', 'System design', 'Cloud']],
  [/data|analyst|scientist|machine learning|\bml\b|\bai\b/i, ['Python', 'SQL', 'Data analysis']],
  [/teacher|professor|lecturer|faculty/i, ['Teaching', 'Research', 'Mentoring']],
  [/sales|marketing|business develop/i, ['Sales', 'Marketing', 'Business development']],
  [/automotive|mechanical|design engineer|manufactur|production/i, ['Product design', 'Manufacturing', 'AutoCAD']],
  [/civil|structural|construction|site engineer/i, ['Structural design', 'Construction management', 'AutoCAD']],
  [/electrical|power|electronics|embedded/i, ['Power systems', 'Embedded systems', 'Electrical design']],
  [/officer|ias|ips|government|administrat/i, ['Public administration', 'Policy', 'Leadership']],
  [/founder|ceo|director|owner|entrepreneur/i, ['Entrepreneurship', 'Strategy', 'Leadership']],
  [/manager|lead|head|vp|president|gm\b/i, ['Team leadership', 'Project management', 'Stakeholder management']],
]

/** Three skills to offer as one-tap chips, from the job title (simple rules, no AI). Skips ones the member has. */
export function suggestSkills(title: string | null | undefined, have: readonly string[] = []): string[] {
  const t = title ?? ''
  const picked = SKILL_RULES.filter(([re]) => re.test(t)).flatMap(([, s]) => s)
  const pool = unionList([], [...picked, 'Problem solving', 'Communication', 'Leadership'], 12)
  const own = new Set(have.map((h) => h.toLowerCase()))
  return pool.filter((s) => !own.has(s.toLowerCase())).slice(0, 3)
}

// ---------------------------------------------------------------- reunion list (prefill) rows

/** E.164 when the number is a valid one, else null (Excel's "9.19876E+11" and typos are dropped, not guessed). */
export function e164OrNull(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw)
  return n.startsWith('+') && isValidPhone(n) ? n : null
}

/** First letter of a name, ignoring titles like "Dr." and anything that is not a letter. */
export function nameInitial(name: string | null | undefined): string {
  const t = (name ?? '').trim().replace(/^(dr|er|mr|mrs|ms|prof|shri|smt)\.?\s+/i, '')
  return (t.match(/\p{L}/u)?.[0] ?? '').toLowerCase()
}

/** The same check the database makes before offering a reunion-list record by mobile number. */
export function phoneClaimMatches(record: { phone: string | null; full_name: string }, typedPhone: string, typedName: string): boolean {
  const a = e164OrNull(record.phone)
  const b = e164OrNull(typedPhone)
  return !!a && a === b && nameInitial(typedName) !== '' && nameInitial(record.full_name) === nameInitial(typedName)
}
