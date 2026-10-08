// Reads the PDF from LinkedIn's "Save to PDF" (Apache FOP output) in the browser.
//
// Layout facts measured from 27 real exports (2022–2026, see docs/LINKEDIN_PDF.md):
// - one font for everything, so roles are told apart by font SIZE, column and order
// - sidebar lines start at x≈21.6, main column at x≈223.6 (split at x=200); footer "Page N of M" is size 9
// - main: name 26 · headline/location/summary/company/school 12 · section header 15.75 ·
//         job title 11.5 · dates/location/description/degree/multi-role duration 10.5
// - sidebar: headers 13 · skills/contact 10.5 · URLs 11
// - section titles are translated into the member's UI language, so we rely on structure, not titles
import { cleanText, normalizeLinkedInUrl, type ImportedProfile } from './common'

export interface PdfLine {
  page: number
  y: number
  size: number
  text: string
}

const near = (a: number, b: number, tol = 0.3) => Math.abs(a - b) <= tol
const S = { name: 26, header: 15.75, sidebarHeader: 13, body: 12, title: 11.5, url: 11, small: 10.5 }

// ---------------------------------------------------------------- extraction (browser / node)

interface TextItemLike {
  str: string
  transform: number[]
}

/** Groups text items into lines per page and column. Exported for tests (node uses the legacy pdfjs build). */
export function itemsToLines(pages: TextItemLike[][]): { main: PdfLine[]; sidebar: PdfLine[] } {
  const main: PdfLine[] = []
  const sidebar: PdfLine[] = []
  pages.forEach((items, pageIdx) => {
    const buckets = new Map<string, { x: number; y: number; size: number; parts: { x: number; s: string }[] }>()
    for (const it of items) {
      if (!it.str) continue
      const [a = 0, b = 0, , , x = 0, y = 0] = it.transform
      const size = Math.round(Math.hypot(a, b) * 100) / 100
      if (size <= 9.5) continue // footer "Page N of M"
      const col = x < 200 ? 's' : 'm'
      const key = `${col}:${Math.round(y * 2) / 2}`
      const bucket = buckets.get(key) ?? { x, y, size: 0, parts: [] }
      bucket.size = Math.max(bucket.size, size)
      bucket.parts.push({ x, s: it.str })
      buckets.set(key, bucket)
    }
    for (const [key, b] of buckets) {
      const text = b.parts
        .sort((p, q) => p.x - q.x)
        .map((p) => p.s)
        .join('')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      ;(key.startsWith('s') ? sidebar : main).push({ page: pageIdx, y: b.y, size: b.size, text })
    }
  })
  const order = (p: PdfLine, q: PdfLine) => p.page - q.page || q.y - p.y
  return { main: main.sort(order), sidebar: sidebar.sort(order) }
}

/** Vertical distance to the previous line, or Infinity across a page break. */
function gap(prev: PdfLine | undefined, cur: PdfLine): number {
  return prev && prev.page === cur.page ? prev.y - cur.y : Infinity
}

// ---------------------------------------------------------------- parsing helpers

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** "August 2022" -> 2022-08-01, "2008" -> 2008-01-01, localised month names fall back to the year. */
function parsePoint(s: string): { date: string | null; present: boolean } {
  const t = s.trim().toLowerCase()
  if (/present|presente|настоящее|aujourd|heute|atual/.test(t)) return { date: null, present: true }
  const year = t.match(/(19|20)\d{2}/)?.[0]
  if (!year) return { date: null, present: false }
  const word = t.match(/^([a-z]+)\.?\s/)?.[1]
  const month = word ? MONTHS[word] : undefined
  return { date: `${year}-${String(month ?? 1).padStart(2, '0')}-01`, present: false }
}

const DURATION = /^\(?(\d+\s+\S+(\s+\d+\s+\S+)?|less than a year|menos de un año)\)?$/i
export const DATE_RANGE = /^(.+?\d{4}|.*\S)\s+[-–]\s+(.+?)(\s*\(.*\))?$/

export function parseDateRange(line: string): { start: string | null; end: string | null; current: boolean } | null {
  const noDur = line.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const m = noDur.match(/^(.*?)\s+[-–]\s+(.*)$/)
  if (!m) {
    const single = parsePoint(noDur)
    return single.date ? { start: single.date, end: single.date, current: false } : null
  }
  const a = parsePoint(m[1]!)
  const b = parsePoint(m[2]!)
  if (!a.date && !a.present) return null
  return { start: a.date, end: b.present ? null : b.date, current: b.present }
}

function looksLikeDateLine(text: string): boolean {
  return /(19|20)\d{2}/.test(text) && /\s[-–]\s/.test(text) || /\((\d+\s|less than)/i.test(text) && /(19|20)\d{2}/.test(text)
}

export function parseDegreeLine(text: string): { degree: string | null; field: string | null; start: number | null; end: number | null } {
  let main = text
  let dates = ''
  const dot = text.lastIndexOf('·')
  if (dot >= 0 && /\(/.test(text.slice(dot))) {
    main = text.slice(0, dot).trim()
    dates = text.slice(dot + 1)
  } else if (/\((?:[^()]*\d{4}[^()]*)\)\s*$/.test(text)) {
    const i = text.lastIndexOf('(')
    main = text.slice(0, i).trim()
    dates = text.slice(i)
  }
  const years = [...dates.matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]))
  const comma = main.indexOf(', ')
  const degree = (comma >= 0 ? main.slice(0, comma) : main).trim() || null
  const field = comma >= 0 ? main.slice(comma + 2).trim() || null : null
  return {
    degree: degree?.slice(0, 160) ?? null,
    field: field?.slice(0, 160) ?? null,
    start: years.length > 1 ? years[0]! : null,
    end: years.length ? years[years.length - 1]! : null,
  }
}

type Section = { header: string; lines: PdfLine[] }

function splitSections(lines: PdfLine[], headerSize: number): { before: PdfLine[]; sections: Section[] } {
  const before: PdfLine[] = []
  const sections: Section[] = []
  for (const l of lines) {
    if (near(l.size, headerSize)) sections.push({ header: l.text, lines: [] })
    else if (sections.length) sections[sections.length - 1]!.lines.push(l)
    else before.push(l)
  }
  return { before, sections }
}

const isExperienceSection = (s: Section) => s.lines.some((l) => near(l.size, S.title)) && s.lines.some((l) => near(l.size, S.small) && looksLikeDateLine(l.text))
const isEducationSection = (s: Section) =>
  /^(education|educación|formation|ausbildung|formação|istruzione|opleiding|образование|edukacja)$/i.test(s.header) ||
  (!s.lines.some((l) => near(l.size, S.title)) && s.lines.some((l) => near(l.size, S.body)) && s.lines.some((l) => near(l.size, S.small)))
const SKILL_HEADERS = /^(top skills|aptitudes principales|compétences principales|top-kenntnisse|principais competências|competenze principali|основные навыки|belangrijkste vaardigheden|najważniejsze umiejętności)$/i

// ---------------------------------------------------------------- main parser

export function parseLinkedInPdfLines(main: PdfLine[], sidebar: PdfLine[]): ImportedProfile {
  const out: ImportedProfile = { experiences: [], educations: [] }
  const { before, sections } = splitSections(main, S.header)

  // Header block: name (26), headline lines (12), location (last 12pt line before the first section)
  const top = before.filter((l) => near(l.size, S.body))
  if (top.length >= 2) {
    out.headline = cleanText(top.slice(0, -1).map((l) => l.text).join(' '), 160)
    out.city = top[top.length - 1]!.text.split(',')[0]!.trim().slice(0, 80) || undefined
  } else if (top.length === 1) {
    const t = top[0]!.text
    if (/,/.test(t) && t.length < 70 && !/\s(at|@|\|)\s/i.test(t)) out.city = t.split(',')[0]!.trim()
    else out.headline = cleanText(t, 160)
  }

  for (const sec of sections) {
    if (isExperienceSection(sec)) parseExperience(sec.lines, out)
    else if (isEducationSection(sec)) parseEducation(sec.lines, out)
    else if (!out.about && sec.lines.every((l) => near(l.size, S.body))) {
      // Summary: 12pt lines 18pt apart; a blank line (36pt) starts a new paragraph. Page breaks just continue.
      let text = ''
      sec.lines.forEach((l, i) => {
        const g = gap(sec.lines[i - 1], l)
        text += i === 0 ? l.text : g > 26 && g !== Infinity ? `\n\n${l.text}` : ` ${l.text}`
      })
      out.about = cleanText(text)
    }
  }

  parseSidebar(sidebar, out)
  return out
}

function parseExperience(lines: PdfLine[], out: ImportedProfile) {
  let company = ''
  type Role = ImportedProfile['experiences'][number] & { _desc: string[] }
  let role: Role | null = null
  let stage: 'company' | 'title' | 'date' | 'body' = 'company'
  const flush = () => {
    if (role && role.title && role.company) {
      const { _desc, ...r } = role
      out.experiences.push({ ...r, description: cleanText(_desc.join('\n')) ?? null })
    }
    role = null
  }

  lines.forEach((l, i) => {
    const prev = lines[i - 1]
    if (near(l.size, S.body)) {
      flush()
      // a company name that wraps continues on the next 12pt line
      company = stage === 'company' && prev && near(prev.size, S.body) && gap(prev, l) < 15 ? `${company} ${l.text}` : l.text
      stage = 'company'
      return
    }
    if (near(l.size, S.title)) {
      if (stage === 'title' && role && prev && near(prev.size, S.title) && gap(prev, l) < 15.5) {
        role.title = `${role.title} ${l.text}`.slice(0, 160) // wrapped title
        return
      }
      flush()
      role = { company: company.slice(0, 160), title: l.text.slice(0, 160), location: null, start_date: null, end_date: null, is_current: false, description: null, source: 'linkedin', _desc: [] }
      stage = 'title'
      return
    }
    if (!near(l.size, S.small)) return
    if (stage === 'company' && DURATION.test(l.text)) return // multi-role total duration
    if (stage === 'title' && role) {
      const d = parseDateRange(l.text)
      if (d) {
        role.start_date = d.start
        role.end_date = d.end
        role.is_current = d.current
      }
      stage = 'date'
      return
    }
    if (stage === 'date' && role) {
      stage = 'body'
      // location sits ~14.7pt below the date line; a description starts ~20pt below
      if (gap(prev, l) < 17) {
        role.location = l.text.slice(0, 120)
        return
      }
    }
    if (role) role._desc.push(l.text)
  })
  flush()
}

function parseEducation(lines: PdfLine[], out: ImportedProfile) {
  let school: string | null = null
  let degreeParts: string[] = []
  const flush = () => {
    if (school) {
      const d = degreeParts.length ? parseDegreeLine(degreeParts.join(' ')) : { degree: null, field: null, start: null, end: null }
      out.educations.push({ school: school.slice(0, 200), degree: d.degree, field: d.field, start_year: d.start, end_year: d.end, source: 'linkedin' })
    }
    school = null
    degreeParts = []
  }
  lines.forEach((l, i) => {
    const prev = lines[i - 1]
    if (near(l.size, S.body)) {
      if (school && !degreeParts.length && prev && near(prev.size, S.body) && gap(prev, l) < 20) {
        school = `${school} ${l.text}` // wrapped school name
        return
      }
      flush()
      school = l.text
    } else if (near(l.size, S.small) && school) {
      degreeParts.push(l.text)
    }
  })
  flush()
}

function parseSidebar(lines: PdfLine[], out: ImportedProfile) {
  const { sections } = splitSections(lines, S.sidebarHeader)
  // Skills: the "Top Skills" section (by name in common languages, else the section right after Contact
  // when its entries are short one-liners).
  let skillsSec = sections.find((s) => SKILL_HEADERS.test(s.header))
  if (!skillsSec && sections.length > 1 && sections[1]!.lines.length <= 5 && sections[1]!.lines.every((l) => l.text.length <= 60 && !/\(/.test(l.text))) {
    skillsSec = sections[1]
  }
  if (skillsSec) {
    const skills: string[] = []
    skillsSec.lines.forEach((l, i) => {
      const prev = skillsSec!.lines[i - 1]
      if (prev && gap(prev, l) < 14 && skills.length) skills[skills.length - 1] = `${skills[skills.length - 1]} ${l.text}`
      else skills.push(l.text)
    })
    out.skills = [...new Set(skills.map((s) => s.slice(0, 80)))].slice(0, 50)
  }

  // LinkedIn URL from the contact block (URLs may wrap mid-token: join with no space)
  const contact = sections[0]
  if (contact) {
    let joined = ''
    contact.lines.forEach((l, i) => {
      const prev = contact.lines[i - 1]
      // a wrapped URL continues 14.4pt below; a new contact entry starts further down
      joined += prev && gap(prev, l) < 16 && !/\)\s*$/.test(prev.text) ? l.text : `\n${l.text}`
    })
    for (const line of joined.split('\n')) {
      if (!/linkedin\.com\/in\//i.test(line)) continue
      const url = normalizeLinkedInUrl(line.replace(/\s*\([^)]*\)\s*$/, '').trim())
      if (url) {
        out.linkedin_url = url
        break
      }
    }
  }
}

// ---------------------------------------------------------------- browser entry point

export async function readLinkedInPdf(file: Blob): Promise<ImportedProfile> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let doc
  try {
    doc = await task.promise
  } catch {
    throw new Error('We couldn’t open this PDF. Please choose the file from LinkedIn’s “Save to PDF”.')
  }
  const meta = await doc.getMetadata().catch(() => null)
  const info = (meta?.info ?? {}) as { Author?: string; Producer?: string }
  const pages: TextItemLike[][] = []
  for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(content.items.filter((i): i is TextItemLike & typeof i => 'str' in i))
  }
  await task.destroy()
  const { main, sidebar } = itemsToLines(pages)
  if (!main.some((l) => near(l.size, S.name)) && info.Author !== 'LinkedIn') {
    throw new Error('This doesn’t look like a LinkedIn profile PDF. On LinkedIn (desktop), open your profile and use More → Save to PDF.')
  }
  return parseLinkedInPdfLines(main, sidebar)
}
