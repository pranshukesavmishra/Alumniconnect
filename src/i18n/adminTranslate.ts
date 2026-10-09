// Runtime Hindi for the admin screens. The admin UI is written in English; this looks up the exact text (or a pattern with
// changing parts) in ADMIN_HI and returns Hindi. Anything it does not know stays English, so a missing phrase never breaks a screen.
import { ADMIN_HI } from './adminHi'

type Pattern = { re: RegExp; hi: string; weight: number }

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function compile(dict: Record<string, string>): { exact: Map<string, string>; patterns: Pattern[] } {
  const exact = new Map<string, string>()
  const patterns: Pattern[] = []
  for (const [en, hi] of Object.entries(dict)) {
    if (!en.includes('{}')) {
      exact.set(en, hi)
      continue
    }
    const parts = en.split('{}')
    const numericFirst = en.startsWith('{} ')
    const src = parts.map(escapeRe).reduce((acc, part, i) => acc + (i === 0 ? '' : i === 1 && numericFirst ? '(\\d[\\d,.]*%?)' : '(.+?)') + part, '')
    patterns.push({ re: new RegExp(`^${src}$`, 's'), hi, weight: parts.join('').length })
  }
  patterns.sort((a, b) => b.weight - a.weight)
  return { exact, patterns }
}

const compiled = compile(ADMIN_HI)

/** Hindi for a piece of English UI text; the same text back when there is no entry. Keeps leading and trailing spaces. */
export function translateAdmin(text: string, c = compiled, depth = 0): string {
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  const core = collapse(text)
  if (!core || !/[A-Za-z]/.test(core)) return text
  const hit = c.exact.get(core)
  if (hit !== undefined) return lead + hit + trail
  if (depth < 2) {
    for (const p of c.patterns) {
      const m = p.re.exec(core)
      if (!m) continue
      const out = p.hi.replace(/\{(\d+)\}/g, (_w, n: string) => translateAdmin(m[Number(n)] ?? '', c, depth + 1))
      return lead + out + trail
    }
  }
  return text
}
