// Runs the PDF parser over real LinkedIn exports when LINKEDIN_SAMPLES points to a folder of them.
// The samples are public profiles of real people, so they are NOT committed to this repo.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { itemsToLines, parseLinkedInPdfLines } from './profilePdf'

const dir = process.env.LINKEDIN_SAMPLES
const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? files(p) : f.toLowerCase().endsWith('.pdf') ? [p] : []
  })

describe.skipIf(!dir)('real LinkedIn PDFs', () => {
  for (const file of dir ? files(dir) : []) {
    it(file.replace(dir!, ''), async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
      const pages = []
      for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items as never[])
      const { main, sidebar } = itemsToLines(pages)
      const r = parseLinkedInPdfLines(main, sidebar)
      console.log(JSON.stringify({ file: file.replace(dir!, ''), headline: r.headline, city: r.city, url: r.linkedin_url, skills: r.skills, about: r.about?.slice(0, 60), exp: r.experiences.map((e) => `${e.title} @ ${e.company} [${e.start_date ?? '?'}..${e.is_current ? 'now' : (e.end_date ?? '?')}] loc=${e.location ?? '-'} desc=${(e.description ?? '').length}`), edu: r.educations.map((e) => `${e.school} | ${e.degree ?? '-'} | ${e.field ?? '-'} | ${e.start_year ?? '?'}-${e.end_year ?? '?'}`) }, null, 1))
      expect(r.experiences.length + r.educations.length).toBeGreaterThan(0)
      for (const e of r.experiences) {
        expect(e.title.length).toBeGreaterThan(0)
        expect(e.company.length).toBeGreaterThan(0)
      }
    })
  }
})
