// Reads LinkedIn's "Get a copy of your data" export (ZIP of CSV files) in the browser.
// Nothing is uploaded: the member reviews the result before anything is saved.
import Papa from 'papaparse'
import { cleanText, parseLinkedInDate, yearOf, type ImportedProfile } from './common'

type Row = Record<string, string>

/** LinkedIn CSVs sometimes start with "Notes:" lines before the real header row. */
export function parseLinkedInCsv(text: string, mustHave: string): Row[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headerIdx = lines.findIndex((l) => l.toLowerCase().includes(mustHave.toLowerCase()))
  if (headerIdx < 0) return []
  const body = lines.slice(headerIdx).join('\n')
  const res = Papa.parse<Row>(body, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  return res.data.filter((r) => Object.values(r).some((v) => (v ?? '').trim() !== ''))
}

function get(row: Row, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase())
    if (hit && row[hit]?.trim()) return row[hit]!.trim()
  }
  return undefined
}

export function profileFromCsvFiles(files: { profile?: string; positions?: string; education?: string; skills?: string }): ImportedProfile {
  const out: ImportedProfile = { experiences: [], educations: [] }

  if (files.profile) {
    const p = parseLinkedInCsv(files.profile, 'First Name')[0]
    if (p) {
      out.headline = cleanText(get(p, 'Headline'), 160)
      out.about = cleanText(get(p, 'Summary'))
      const geo = get(p, 'Geo Location', 'Location')
      if (geo) out.city = geo.split(',')[0]!.trim().slice(0, 80)
    }
  }

  if (files.positions) {
    for (const r of parseLinkedInCsv(files.positions, 'Company Name')) {
      const company = get(r, 'Company Name')
      const title = get(r, 'Title')
      if (!company || !title) continue
      const finished = get(r, 'Finished On')
      out.experiences.push({
        company: company.slice(0, 160),
        title: title.slice(0, 160),
        location: get(r, 'Location')?.slice(0, 120) ?? null,
        description: cleanText(get(r, 'Description')) ?? null,
        start_date: parseLinkedInDate(get(r, 'Started On')),
        end_date: parseLinkedInDate(finished),
        is_current: !finished,
        source: 'linkedin',
      })
    }
    out.experiences.sort((a, b) => Number(b.is_current) - Number(a.is_current) || (b.start_date ?? '').localeCompare(a.start_date ?? ''))
  }

  if (files.education) {
    for (const r of parseLinkedInCsv(files.education, 'School Name')) {
      const school = get(r, 'School Name')
      if (!school) continue
      out.educations.push({
        school: school.slice(0, 200),
        degree: get(r, 'Degree Name')?.slice(0, 160) ?? null,
        field: get(r, 'Field Of Study', 'Notes')?.slice(0, 160) ?? null,
        start_year: yearOf(get(r, 'Start Date')),
        end_year: yearOf(get(r, 'End Date')),
        source: 'linkedin',
      })
    }
  }

  if (files.skills) {
    const names = parseLinkedInCsv(files.skills, 'Name')
      .map((r) => get(r, 'Name'))
      .filter((s): s is string => !!s)
    out.skills = [...new Set(names.map((s) => s.slice(0, 60)))].slice(0, 50)
  }
  return out
}

export async function readLinkedInZip(file: Blob): Promise<ImportedProfile> {
  const { default: JSZip } = await import('jszip')
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('This doesn’t look like a LinkedIn data file. Please choose the .zip file LinkedIn emailed you.')
  }
  const find = (name: string) => {
    const entry = Object.values(zip.files).find((f) => !f.dir && f.name.split('/').pop()?.toLowerCase() === name.toLowerCase())
    return entry ? entry.async('string') : Promise.resolve(undefined)
  }
  const [profile, positions, education, skills] = await Promise.all([find('Profile.csv'), find('Positions.csv'), find('Education.csv'), find('Skills.csv')])
  if (!profile && !positions && !education && !skills) {
    throw new Error('We couldn’t find profile data in this file. When requesting your data on LinkedIn, include Profile, Positions, Education and Skills.')
  }
  return profileFromCsvFiles({ profile, positions, education, skills })
}
