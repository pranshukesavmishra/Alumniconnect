import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translateAdmin } from './adminTranslate'

// Every plain English phrase written in the admin screens (JSX text and label / placeholder / title attributes) has a Hindi entry.
const dir = join(__dirname, '../features/admin')
const IGNORE = new Set(['CSV', 'UPI', 'UTR', 'WhatsApp', 'QR', 'JEC', 'IST', 'PDF', 'OK', 'Excel', 'Google Maps', 'LinkedIn'])

function phrases(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/>([^<>{}\n=;()][^<>{}]*?)</g)) out.push(m[1]!)
  for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|label|hint)="([^"{}]+)"/g)) out.push(m[1]!)
  for (const m of src.matchAll(/errs\.push\((?:'([^']+)'|`([^`]+)`)/g)) out.push((m[1] ?? m[2]!).replace(/\$\{[^}]*\}/g, '{}'))
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /^[A-Z][a-z]/.test(s) && /\s|^[A-Z][a-z]+$/.test(s) && !IGNORE.has(s) && !/&&|=>|\.push|\bif \(/.test(s))
}

describe('admin Hindi coverage', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  it.each(files)('%s has Hindi for its visible text', (f) => {
    const missing = [...new Set(phrases(readFileSync(join(dir, f), 'utf8')))].filter((p) => translateAdmin(p) === p)
    expect(missing).toEqual([])
  })
})
