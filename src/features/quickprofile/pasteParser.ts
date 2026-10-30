// Reads the text a member copies from their own LinkedIn profile page (select all, copy) - desktop, mobile web, the app's
// share page - or from the PDF that LinkedIn's "Save to PDF" makes. Pure rules, no network, no AI: it runs on the device.
//
// How it works (see pasteParser.test.ts for 14 realistic fixtures):
//   1. clean the text into lines, drop LinkedIn's buttons and menus ("Connect", "Show all", "...see more", "500+ connections")
//      and the accessibility duplicates (every title is copied twice)
//   2. cut it into sections at the headings (About, Experience, Education, Skills, Licenses & certifications ...)
//   3. in Experience every job has a date line ("Jan 2020 - Present · 5 yrs 3 mos"): the line above is the title, the line
//      above that is the company ("Company · Full-time") or, for a company with several roles, the company heading
//   4. Education is walked school -> degree, field -> years
// It never throws: junk in gives an empty profile out. Section titles are English only (LinkedIn shows them in the
// member's language; other languages need the PDF or the AI reading).
import { isJec, normalizeLinkedInUrl } from '../../lib/linkedin/common'
import { mapBranch, type AiEducation, type AiExperience, type AiProfile } from './mapping'

export interface ParsedPaste extends AiProfile {
  /** names of licenses and certifications (the app has no field for them yet; shown nowhere, kept for later) */
  certifications: string[]
  /** 'Education shows <as written>, <years>' for the admin verification queue; null when the college is not in the education list */
  verification_note: string | null
}

export const PASTE_MAX_CHARS = 20_000

export function emptyParsed(): ParsedPaste {
  return {
    full_name: null, headline: null, current_title: null, current_company: null, city: null, country: null, grad_year: null, branch: null,
    degree: null, experiences: [], education: [], skills: [], help_tags: [], interests: [], about: null, linkedin_url: null, certifications: [], verification_note: null,
  }
}

/** True when the reading found something worth showing in a preview. */
export function parsedHasContent(p: AiProfile): boolean {
  return !!(p.experiences.length || p.education.length || p.skills.length || p.headline || p.about)
}

// ---------------------------------------------------------------- patterns

const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const YEAR = '(?:19|20)\\d{2}'
const DATE_RANGE = new RegExp(`^(?:(?:${MON})\\.?\\s+)?(${YEAR})\\s*(?:-|–|—|\\bto\\b)\\s*(?:(present|current|now)|(?:(?:${MON})\\.?\\s+)?(${YEAR}))\\s*(?:[·•|(].*)?$`, 'i')
const EDU_START_ONLY = new RegExp(`^(?:(?:${MON})\\.?\\s+)?(${YEAR})\\s*(?:-|–|—)$`, 'i')
const EDU_SINGLE = new RegExp(`^(?:expected\\s+|class of\\s+)?(?:(?:${MON})\\.?\\s+)?(${YEAR})$`, 'i')
const TRAILING_YEARS = new RegExp(`\\s*[·•|]?\\s*\\(\\s*(${YEAR})\\s*(?:-|–|—)?\\s*(${YEAR})?\\s*\\)\\s*$`)
const EMP_TYPE = /^(full[- ]?time|part[- ]?time|self[- ]?employed|freelance|contract|internship|apprenticeship|seasonal|temporary|permanent|volunteer)$/i
const DURATION = /^(?:less than a year|\d+\s*(?:yrs?|years?|mos?|months?)(?:\s+\d+\s*(?:mos?|months?))?)$/i
const SEP = /\s+[·•]\s+/

const COUNTRIES = new Set([
  'india', 'united states', 'usa', 'united kingdom', 'uk', 'canada', 'australia', 'germany', 'deutschland', 'france', 'singapore', 'united arab emirates', 'uae',
  'saudi arabia', 'qatar', 'kuwait', 'oman', 'bahrain', 'netherlands', 'ireland', 'switzerland', 'sweden', 'norway', 'denmark', 'finland', 'japan', 'china',
  'hong kong', 'malaysia', 'indonesia', 'thailand', 'new zealand', 'south africa', 'nepal', 'bangladesh', 'sri lanka', 'brazil', 'mexico', 'spain', 'italy',
  'israel', 'russia', 'south korea', 'poland', 'belgium', 'austria', 'philippines', 'vietnam', 'egypt', 'nigeria', 'kenya', 'pakistan', 'portugal', 'turkey',
  'luxembourg', 'czechia', 'argentina', 'chile', 'colombia', 'ukraine', 'romania', 'greece', 'hungary', 'taiwan', 'kazakhstan', 'ghana', 'ethiopia', 'tanzania',
])

type Kind = 'top' | 'about' | 'experience' | 'education' | 'skills' | 'certs' | 'sidebar' | 'other'
const HEADERS: Record<string, Kind> = {
  about: 'about', summary: 'about', 'profile summary': 'about',
  experience: 'experience', 'work experience': 'experience', 'professional experience': 'experience',
  education: 'education',
  skills: 'skills', 'top skills': 'skills', 'key skills': 'skills',
  'licenses & certifications': 'certs', 'licenses and certifications': 'certs', 'licenses & certification': 'certs', certifications: 'certs', licenses: 'certs',
  contact: 'sidebar', languages: 'sidebar', websites: 'sidebar',
  projects: 'other', volunteering: 'other', 'volunteer experience': 'other', 'honors & awards': 'other', 'honors and awards': 'other', 'honors-awards': 'other',
  publications: 'other', courses: 'other', recommendations: 'other', interests: 'other', activity: 'other', featured: 'other', highlights: 'other',
  analytics: 'other', resources: 'other', 'people also viewed': 'other', 'people you may know': 'other', 'more profiles for you': 'other',
  'explore premium profiles': 'other', organizations: 'other', patents: 'other', 'test scores': 'other', causes: 'other', services: 'other',
  'profile language': 'other', 'public profile & url': 'other', 'you might like': 'other', 'pages for you': 'other', 'suggested for you': 'other',
  'also viewed': 'other', 'who your viewers also viewed': 'other', following: 'other', 'recommendations received': 'other', 'recommendations given': 'other',
}
const MAIN: Kind[] = ['about', 'experience', 'education']

const NOISE_EXACT = new Set([
  'skip to search', 'skip to main content', 'close jump menu', 'home', 'my network', 'jobs', 'messaging', 'notifications', 'me', 'for business', 'try premium',
  'search', 'connect', 'message', 'follow', 'more', 'pending', 'save', 'send', 'like', 'comment', 'repost', 'share', 'endorse', 'edit', 'add', 'view',
  'contact info', 'open to work', 'resources', 'visit my website', 'book an appointment', 'premium', 'get hired faster', 'only visible to you', 'private to you',
  'edit profile', 'add profile section', 'enhance profile', 'add section', 'show credential', 'show all', 'see more', 'see less', 'see all', 'show more', 'show less',
  'view profile', 'view full profile', 'save to pdf', 'request a recommendation', 'sign in', 'join now', 'get started', 'ad', 'promoted', 'verified', 'get introduced',
  'send profile in a message', 'share profile', 'report this profile',
])
const NOISE_RES: RegExp[] = [
  /^[·•\-–—|.,:;]+$/,
  /^\((?:he|she|they|him|her|them|ze)\b.*\)$/i,
  /^(?:he|she|they)\/(?:him|her|them)$/i,
  /^[·•]?\s*(?:1st|2nd|3rd\+?)$/i,
  /^page \d+ of \d+$/i,
  /^\d+\+? notifications?( total)?$/i,
  /^[\d,.]+[km]?\+?\s*(?:followers?|connections?)(?:\s*[·•]\s*[\d,.]+[km]?\+?\s*(?:followers?|connections?))?$/i,
  /\bmutual connections?\b/i,
  /^(?:show|view|see) (?:all|more|less|details|credential|project|publication|my|the)\b/i,
  /^[….]{1,3}\s*(?:see|show) more$/i,
  /\bshow all \d+/i,
  /^\+\s*follow$/i,
  /^(?:try premium|get premium|reactivate premium)\b/i,
  /^[\w&.'’ -]{1,40} logo$/i,
  /^(?:loaded|profile photo|background image|profile picture)\b/i,
  /^[A-Za-z .'’-]{1,40} is open to work$/i,
]
const isNoise = (s: string) => NOISE_EXACT.has(s.toLowerCase().replace(/[.…:]+$/, '')) || NOISE_RES.some((re) => re.test(s))

// ---------------------------------------------------------------- small helpers

const isDateLine = (s: string) => DATE_RANGE.test(s)
const isDurationOnly = (s: string) => {
  const parts = s.split(SEP).map((x) => x.trim())
  return parts.every((x) => EMP_TYPE.test(x) || DURATION.test(x)) && parts.some((x) => DURATION.test(x))
}
const hasEmpType = (parts: string[]) => parts.slice(1).some((x) => EMP_TYPE.test(x))

function locationLike(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 90 || /\d/.test(t)) return false
  if (/\b(engineer|manager|developer|student|analyst|consultant|founder|director|professor|officer|architect|designer|lead|head|intern|at|@|\|)\b/i.test(t) && !/\b(area|region)\b/i.test(t)) return false
  const base = t.replace(/\s*[·•].*$/, '')
  if (COUNTRIES.has(base.toLowerCase())) return true
  if (/\b(?:area|region|metropolitan|district)$/i.test(base)) return true
  const parts = base.split(',').map((x) => x.trim())
  return parts.length >= 2 && parts.length <= 4 && parts.every((x) => x.length > 0 && x.split(/\s+/).length <= 4)
}

function splitLocation(raw: string | null): { city: string | null; country: string | null } {
  if (!raw) return { city: null, country: null }
  const cleaned = raw.replace(/\s*[·•].*$/, '').replace(/^greater\s+/i, '').replace(/\s+(?:metropolitan\s+)?(?:area|region)$/i, '').trim()
  const parts = cleaned.split(',').map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return { city: null, country: null }
  if (parts.length === 1) {
    const only = parts[0]!
    if (['singapore', 'hong kong'].includes(only.toLowerCase())) return { city: only, country: only }
    return COUNTRIES.has(only.toLowerCase()) ? { city: null, country: only } : { city: only, country: null }
  }
  const last = parts[parts.length - 1]!
  const country = COUNTRIES.has(last.toLowerCase()) || parts.length >= 3 ? last : null
  return { city: parts[0]!, country }
}

function expLocation(s: string | undefined): string | null {
  if (!s) return null
  const t = s.replace(/\s*[·•]\s*(?:remote|hybrid|on-?site)\s*$/i, '').trim()
  if (!t || /^(?:remote|hybrid|on-?site)$/i.test(t)) return null
  return t.slice(0, 120)
}

const bodyLike = (s: string) =>
  locationLike(s) || /\b(remote|hybrid|on-?site)\b/i.test(s) || /^skills?\s*:/i.test(s) || s.length > 70 || /[.!?]$/.test(s) || /^[•*-]/.test(s)

function rangeOf(line: string): { sy: number; ey: number | null; current: boolean } | null {
  const m = DATE_RANGE.exec(line)
  if (!m) return null
  const current = !!m[2]
  return { sy: Number(m[1]), ey: current ? null : Number(m[3]), current }
}

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

// ---------------------------------------------------------------- text -> lines

export function cleanLines(input: string): string[] {
  const text = (typeof input === 'string' ? input : '')
    .slice(0, PASTE_MAX_CHARS * 2)
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\0')
    .join('')
    // a long address wrapped by the PDF: "linkedin.com/in/asha-verma-\n123abc"
    .replace(/(linkedin\.com\/in\/[^\s]*-)\s*\n\s*(\S+)/gi, '$1$2')
  const out: string[] = []
  for (const raw of text.split('\n').slice(0, 3000)) {
    const line = raw.replace(/\t/g, ' ').replace(/\s+/g, ' ').replace(/^[•*▪◦●]\s*/, '').trim().slice(0, 3000)
    if (!line) continue
    if (out.length && out[out.length - 1]!.toLowerCase() === line.toLowerCase()) continue
    out.push(line)
  }
  return out
}

// ---------------------------------------------------------------- sections

interface Section {
  kind: Kind
  lines: string[]
}

const headerKind = (line: string): Kind | null => {
  const key = line.toLowerCase().replace(/\s*&amp;\s*/g, ' & ').replace(/[:：]+$/, '').trim()
  return Object.hasOwn(HEADERS, key) ? HEADERS[key]! : null
}

function cutSections(lines: string[]): { sections: Section[]; top: string[]; pdf: boolean } {
  const kinds = lines.map(headerKind)
  const firstMain = kinds.findIndex((k) => k !== null && MAIN.includes(k))
  const firstHeader = kinds.findIndex((k) => k !== null)
  const sidebarFirst = firstHeader >= 0 && firstMain > firstHeader && kinds.slice(0, firstMain).some((k) => k === 'sidebar' || k === 'skills' || k === 'certs')
  // PDF: the sidebar (Contact, Top Skills ...) comes first, then name / headline / location right above the first main heading
  const taken = new Set<number>()
  let top: string[] = []
  if (sidebarFirst) {
    const idx: number[] = []
    for (let i = firstMain - 1; i >= 0 && idx.length < 3; i--) {
      if (kinds[i] || isNoise(lines[i]!)) break
      idx.unshift(i)
    }
    // a name has no comma-less sentence punctuation; drop leading lines that clearly are sidebar items (urls, emails)
    while (idx.length && /@|linkedin\.com|^\+?\d[\d ()-]{6,}$/i.test(lines[idx[0]!]!)) idx.shift()
    idx.forEach((i) => taken.add(i))
    top = idx.map((i) => lines[i]!)
  }
  const sections: Section[] = []
  let cur: Section = { kind: 'top', lines: [] }
  sections.push(cur)
  lines.forEach((line, i) => {
    if (taken.has(i)) return
    const k = kinds[i]
    if (k) {
      cur = { kind: k, lines: [] }
      sections.push(cur)
      return
    }
    if (isNoise(line)) return
    cur.lines.push(line)
  })
  if (!sidebarFirst) {
    // raw top lines keep their noise markers so "Contact info" / "500+ connections" can end the header block
    const end = firstHeader >= 0 ? firstHeader : lines.length
    top = lines.slice(0, end)
  }
  return { sections, top, pdf: sidebarFirst }
}

// ---------------------------------------------------------------- top block

function parseTop(raw: string[], pdf: boolean): { name: string | null; headline: string | null; location: string | null } {
  const block: string[] = []
  for (const line of raw) {
    if (/^contact info$/i.test(line) || /\b[\d,.]+\+?\s*(connections?|followers?)\b/i.test(line)) {
      // "Pune, India · Contact info" on one line keeps its location
      const before = line.replace(/\s*[·•]?\s*contact info$/i, '').trim()
      if (before && before !== line && !isNoise(before)) block.push(before)
      if (!pdf) break
      continue
    }
    if (isNoise(line)) continue
    block.push(line.replace(/\s*[·•]\s*(?:1st|2nd|3rd\+?)\s*$/i, '').replace(/\s*\((?:he|she|they)\b[^)]*\)\s*$/i, '').trim())
    if (!pdf && block.length >= 4) break
  }
  const lines = block.filter(Boolean)
  if (!lines.length) return { name: null, headline: null, location: null }
  let location: string | null = null
  if (lines.length >= 2 && locationLike(lines[lines.length - 1]!)) location = lines.pop()!
  const name = lines[0]!.length <= 100 ? lines[0]! : null
  const headlineLines = lines.slice(1)
  const headline = headlineLines.length ? (pdf ? headlineLines.join(' ') : headlineLines[0]!) : null
  return { name: name ? clip(name, 120) : null, headline: headline ? clip(headline, 160) : null, location: location ? clip(location, 120) : null }
}

// ---------------------------------------------------------------- experience

function parseExperience(L: string[], pdf: boolean): AiExperience[] {
  const dates: number[] = []
  L.forEach((s, i) => {
    if (isDateLine(s)) dates.push(i)
  })
  // the PDF writes the duration as "(7 years 9 months)" and puts the company above the title; the web puts it below
  const pdfOrder = pdf || L.some((s) => isDateLine(s) && /\(\s*\d+\s*(?:years?|months?)/i.test(s))
  const out: AiExperience[] = []
  let group: string | null = null
  let prev = -1
  for (const di of dates) {
    const r = rangeOf(L[di]!)
    const d1 = di - 1 > prev ? L[di - 1] : undefined
    const d2 = di - 2 > prev ? L[di - 2] : undefined
    const d3 = di - 3 > prev ? L[di - 3] : undefined
    let title: string | undefined
    let company: string | undefined
    if (r && d1 !== undefined) {
      const parts = d1.split(SEP).map((x) => x.trim())
      if (hasEmpType(parts)) {
        company = parts[0]
        title = d2
        group = null
      } else if (d2 !== undefined && isDurationOnly(d2)) {
        title = d1
        company = d3 === undefined ? (group ?? undefined) : (d3.split(SEP)[0] ?? d3)
        group = company ?? null
      } else if (group && (d2 === undefined || bodyLike(d2))) {
        title = d1
        company = group
      } else if (d2 !== undefined) {
        title = pdfOrder ? d1 : d2
        company = pdfOrder ? (d2.split(SEP)[0] ?? d2) : (parts[0] ?? d1)
        group = null
      }
    }
    prev = di
    if (!r || !title || !company) continue
    const tParts = title.split(SEP).map((x) => x.trim())
    if (hasEmpType(tParts)) title = tParts[0]!
    if (isDurationOnly(title) || isDateLine(title)) continue
    const locLine = L[di + 1]
    const nextIsRole = L[di + 2] !== undefined && isDateLine(L[di + 2]!)
    const location = locLine && !nextIsRole && !isDateLine(locLine) && (locationLike(locLine) || /\b(remote|hybrid|on-?site)\b/i.test(locLine)) ? expLocation(locLine) : null
    const t = clip(title, 160)
    const c = clip(company, 160)
    if (!t || !c) continue
    if (out.some((e) => e.title === t && e.company === c && e.start_year === r.sy)) continue
    out.push({ title: t, company: c, start_year: r.sy, end_year: r.ey, is_current: r.current, location })
  }
  return out.slice(0, 20)
}

// ---------------------------------------------------------------- education

const DEGREE_LIKE = /\b(bachelor|master|b\.?\s?e\.?|b\.?\s?tech|m\.?\s?tech|m\.?\s?e\.?|mba|pgdm|diploma|ph\.?d|doctor|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?a\.?|m\.?\s?a\.?|mca|bca|secondary|higher secondary|intermediate|ssc|hsc|cbse|icse|class (?:x|xii|10|12)|post ?graduate|graduate|certificate|associate|engineering|science|commerce|arts|management)\b/i
const SCHOOL_LIKE = /\b(college|university|institute|institution|school|iit|iim|nit|iiit|academy|vidyalaya|vidyapeeth|polytechnic|campus|faculty|mahavidyalaya|universit[aäé]t?|instituto|ecole|école)\b|\b(?:iit|iim|nit|iiit|bits|jec)\b/i
const EDU_SKIP = /^(?:grade|activities and societies|activities|field of study|description|skills|honors?|cgpa|gpa|percentage|score)\s*:/i

function parseEducation(L: string[]): AiEducation[] {
  const out: AiEducation[] = []
  let cur: AiEducation | null = null
  let hasDates = false
  const isDegreeLine = (s: string) => DEGREE_LIKE.test(s) && !SCHOOL_LIKE.test(s)
  const isDateish = (s: string | undefined) => !!s && (isDateLine(s) || EDU_SINGLE.test(s) || EDU_START_ONLY.test(s))
  const dates = (s: string) => {
    const r = rangeOf(s)
    if (r) return { sy: r.sy, ey: r.ey }
    const st = EDU_START_ONLY.exec(s)
    if (st) return { sy: Number(st[1]), ey: null }
    const m = EDU_SINGLE.exec(s)
    return m ? { sy: null, ey: Number(m[1]) } : null
  }
  const push = () => {
    if (cur) out.push(cur)
    cur = null
    hasDates = false
  }
  for (let i = 0; i < L.length; i++) {
    const line = L[i]!
    if (EDU_SKIP.test(line)) continue
    if (isDateish(line)) {
      const d = dates(line)
      if (cur && d && !hasDates) {
        cur.start_year = d.sy
        cur.end_year = d.ey
        hasDates = true
      }
      continue
    }
    const next = L[i + 1]
    const startsSchool = !cur || hasDates || (cur.degree !== null && (SCHOOL_LIKE.test(line) || isDegreeLine(next ?? '') || isDateish(next))) || (!cur.degree && SCHOOL_LIKE.test(line) && !isDegreeLine(line))
    if (startsSchool) {
      if (cur && hasDates && !SCHOOL_LIKE.test(line) && !(isDegreeLine(next ?? '') || isDateish(next))) continue // description text
      if (!cur || SCHOOL_LIKE.test(line) || isDegreeLine(next ?? '') || isDateish(next)) {
        push()
        cur = { school: clip(line.replace(TRAILING_YEARS, ''), 200), degree: null, field: null, start_year: null, end_year: null }
        continue
      }
      continue
    }
    if (cur && cur.degree === null) {
      const ty = TRAILING_YEARS.exec(line)
      const text = line.replace(TRAILING_YEARS, '').trim()
      const comma = text.indexOf(',')
      const dash = / [·•] /.exec(text)
      const cut = comma > 0 ? comma : dash ? dash.index : -1
      cur.degree = clip(cut > 0 ? text.slice(0, cut) : text, 160) || null
      cur.field = cut > 0 ? clip(text.slice(cut + (comma > 0 ? 1 : 3)), 160) || null : null
      if (ty) {
        cur.start_year = ty[2] ? Number(ty[1]) : null
        cur.end_year = Number(ty[2] ?? ty[1])
        hasDates = true
      }
    }
  }
  push()
  return out.filter((e) => e.school).slice(0, 8)
}

// ---------------------------------------------------------------- skills, certifications, about

function parseSkills(lines: string[], known: Set<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string) => {
    const t = clip(s, 80)
    const k = t.toLowerCase()
    if (!t || seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  for (const line of lines) {
    if (/endorse|\+\s?\d+ (?:experiences?|skills?)|\d+ (?:experiences?|other connections?)|^passed linkedin|skill assessment|^industry knowledge$|^tools & technologies$|^interpersonal skills$/i.test(line)) continue
    if (/^\d+$/.test(line) || / at /i.test(line) || line.length > 60) continue
    const parts = line.split(/\s+[·•|]\s+|\s*•\s*/).map((x) => x.trim()).filter(Boolean)
    const items = parts.length > 1 && parts.every((x) => x.split(/\s+/).length <= 4) ? parts : [line]
    for (const it of items) {
      const low = it.toLowerCase()
      if ([...known].some((k) => low === k || low.startsWith(`${k} `))) continue
      if (it.split(/\s+/).length > 6) continue
      add(it)
    }
  }
  return out.slice(0, 50)
}

function parseCerts(L: string[]): string[] {
  const skip = /^(?:issued\b|expires\b|credential|show credential|skills?\s*:|see credential)/i
  const anchors: number[] = []
  L.forEach((s, i) => {
    if (/^issued\b/i.test(s)) anchors.push(i)
  })
  const names = anchors.length ? anchors.map((i) => L[i - 2]).filter((x): x is string => !!x && !skip.test(x)) : L.filter((x) => !skip.test(x))
  return [...new Set(names.map((n) => clip(n, 160)).filter(Boolean))].slice(0, 20)
}

function parseAbout(L: string[]): { about: string | null; topSkills: string[] } {
  const topSkills: string[] = []
  let lines = L.filter((x) => !/^(?:[….]{1,3}\s*)?see more$/i.test(x)).map((x) => x.replace(/\s*[….]{1,3}\s*see more\s*$/i, '').trim()).filter(Boolean)
  const ts = lines.findIndex((x) => /^top skills\b/i.test(x))
  if (ts >= 0) {
    const inline = lines[ts]!.replace(/^top skills\s*:?\s*/i, '')
    const rest = inline || lines[ts + 1] || ''
    for (const s of rest.split(/\s*[•·|]\s*/)) if (s.trim() && s.trim().length <= 50) topSkills.push(s.trim())
    lines = lines.slice(0, ts)
  }
  const half = lines.length / 2
  if (lines.length >= 2 && Number.isInteger(half) && lines.slice(0, half).join('\n') === lines.slice(half).join('\n')) lines = lines.slice(0, half)
  const text = lines.join('\n').trim()
  return { about: text ? text.slice(0, 2000) : null, topSkills }
}

// ---------------------------------------------------------------- main

/** Reads pasted LinkedIn profile text. Never throws. */
export function parsePastedProfile(input: string): ParsedPaste {
  try {
    return parse(input)
  } catch {
    return emptyParsed()
  }
}

function parse(input: string): ParsedPaste {
  const p = emptyParsed()
  const lines = cleanLines(input)
  if (!lines.length) return p
  const urlMatch = /linkedin\.com\/in\/[^\s/?#()]+/i.exec(lines.join('\n'))
  p.linkedin_url = urlMatch ? normalizeLinkedInUrl(`https://www.${urlMatch[0]}`) : null

  const { sections, top, pdf } = cutSections(lines)
  const body = (k: Kind) => sections.filter((s) => s.kind === k).flatMap((s) => s.lines)

  const head = parseTop(top, pdf)
  p.full_name = head.name
  p.headline = head.headline
  const loc = splitLocation(head.location)
  p.city = loc.city ? clip(loc.city, 80) : null
  p.country = loc.country ? clip(loc.country, 80) : null

  p.experiences = parseExperience(body('experience'), pdf)
  p.education = parseEducation(body('education'))
  const cur = p.experiences.find((e) => e.is_current)
  if (cur) {
    p.current_title = cur.title
    p.current_company = cur.company
  }

  const isBachelor = (e: AiEducation) => /bachelor|\bb\.?\s?e\b|b\.?\s?tech/i.test(e.degree ?? '')
  const jec = p.education.find((e) => isJec(e.school) && isBachelor(e)) ?? p.education.find((e) => isJec(e.school))
  if (jec) {
    // older profiles often show only the first year ("1989 -"): a B.E. is four years
    p.grad_year = jec.end_year ?? (jec.start_year && isBachelor(jec) ? jec.start_year + 4 : null)
    p.degree = jec.degree
    p.branch = mapBranch(jec.field) ?? mapBranch(jec.degree)
    const years = [jec.start_year, p.grad_year].filter(Boolean).join('–')
    p.verification_note = `Education shows ${jec.school}${years ? `, ${years}` : ''}`
  }

  const about = parseAbout(body('about'))
  p.about = about.about
  const known = new Set([...p.experiences.map((e) => e.company), ...p.education.map((e) => e.school)].map((x) => x.toLowerCase()))
  const skillLines = body('skills')
  p.skills = parseSkills([...about.topSkills, ...skillLines], known)
  p.certifications = parseCerts(body('certs'))
  return p
}
