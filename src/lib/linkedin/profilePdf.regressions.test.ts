// Parser-level regression tests for LinkedIn import, built from the exact line geometry measured in real
// "Save to PDF" exports (no real person's data). Known bugs are `it.fails` with a comment; flip them when fixed.
//   npx vitest run src/lib/linkedin
import { describe, expect, it } from 'vitest'
import { profileFromCsvFiles } from './exportZip'
import { itemsToLines, parseDateRange, parseLinkedInPdfLines } from './profilePdf'

type L = [page: number, x: number, y: number, size: number, text: string]
const M = 223.6
const S = 21.6
function parse(lines: L[]) {
  const pages: { str: string; transform: number[] }[][] = []
  for (const [p, x, y, size, str] of lines) (pages[p] ??= []).push({ str, transform: [size, 0, 0, size, x, y] })
  const { main, sidebar } = itemsToLines(pages.map((x) => x ?? []))
  return parseLinkedInPdfLines(main, sidebar)
}

const header: L[] = [
  [0, S, 737.6, 13, 'Contact'],
  [0, S, 681.2, 11, 'www.linkedin.com/in/test-person'],
  [0, S, 666.8, 11, '(LinkedIn)'],
  [0, S, 579.3, 13, 'Top Skills'],
  [0, S, 559.8, 10.5, 'Python'],
  [0, M, 726.5, 26, 'Test Person'],
  [0, M, 705.3, 12, 'Engineer at Acme'],
  [0, M, 689.9, 12, 'Jabalpur, Madhya Pradesh, India'],
]

describe('LinkedIn PDF parser', () => {
  it('reads header, Present role, location and description on one page', () => {
    const r = parse([
      ...header,
      [0, M, 652.3, 15.75, 'Experience'],
      [0, M, 621.8, 12, 'Acme'],
      [0, M, 605.7, 11.5, 'Engineer'],
      [0, M, 591.2, 10.5, 'August 2022 - Present (2 years 1 month)'],
      [0, M, 576.5, 10.5, 'Pune, Maharashtra, India'],
      [0, M, 555.1, 10.5, 'Built things.'],
    ])
    expect(r).toMatchObject({
      headline: 'Engineer at Acme',
      city: 'Jabalpur',
      skills: ['Python'],
      linkedin_url: 'https://www.linkedin.com/in/test-person',
    })
    expect(r.experiences).toEqual([
      {
        company: 'Acme',
        title: 'Engineer',
        location: 'Pune, Maharashtra, India',
        start_date: '2022-08-01',
        end_date: null,
        is_current: true,
        description: 'Built things.',
        source: 'linkedin',
      },
    ])
  })

  // BUG (3 of 27 real samples): when the page breaks right after the date line, the role's location is the first
  // line of the next page; gap() returns Infinity there, so it is stored as the first line of the description.
  it('keeps the job location when it is the first line of a new page', () => {
    const r = parse([
      ...header,
      [0, M, 652.3, 15.75, 'Experience'],
      [0, M, 59.5, 12, 'Salesforce'],
      [0, M, 43.4, 11.5, 'Solutions Architect'],
      [0, M, 28.9, 10.5, 'December 2021 - February 2026 (4 years 3 months)'],
      [1, M, 738.2, 10.5, 'McLean, Virginia, United States'],
      [1, M, 716.8, 10.5, 'Designed CRM solutions.'],
    ])
    expect(r.experiences[0]).toMatchObject({ location: 'McLean, Virginia, United States', description: 'Designed CRM solutions.' })
  })

  // BUG (3 of 27 real samples): LinkedIn writes HTML entities into the PDF text ("P&amp;L", "iOS &amp; Android").
  it('decodes HTML entities that LinkedIn leaves in the PDF text', () => {
    const r = parse([...header, [0, M, 652.3, 15.75, 'Summary'], [0, M, 626.8, 12, 'Owned P&amp;L for iOS &amp; Android']])
    expect(r.about).toBe('Owned P&L for iOS & Android')
  })

  // BUG (2 of 27 samples, Spanish + Russian UI): localised month names collapse to January of that year.
  it('keeps the month for localised date lines', () => {
    expect(parseDateRange('noviembre de 2018 - Present (7 años 9 meses)')).toEqual({ start: '2018-11-01', end: null, current: true })
    expect(parseDateRange('мая 2021 - июля 2022 (1 год 3 месяца)')).toEqual({ start: '2021-05-01', end: '2022-07-01', current: false })
  })

  // BUG (every sample with a description): each visual PDF line wrap becomes a hard '\n'; the profile renders
  // descriptions with whitespace-pre-line, so sentences break mid-line. Wraps (18pt apart) should join with a space;
  // bullets and paragraph gaps (36pt) should keep the break.
  it('joins wrapped description lines into sentences', () => {
    const r = parse([
      ...header,
      [0, M, 652.3, 15.75, 'Experience'],
      [0, M, 621.8, 12, 'Acme'],
      [0, M, 605.7, 11.5, 'Engineer'],
      [0, M, 591.2, 10.5, 'August 2022 - Present (2 years 1 month)'],
      [0, M, 569.8, 10.5, 'CMPSOARES is a consulting company dedicated to assisting companies in'],
      [0, M, 551.8, 10.5, 'developing the services they need.'],
      [0, M, 515.8, 10.5, '- Business Management'],
      [0, M, 497.8, 10.5, '- Web Development'],
    ])
    expect(r.experiences[0]!.description).toBe(
      'CMPSOARES is a consulting company dedicated to assisting companies in developing the services they need.\n\n- Business Management\n- Web Development',
    )
  })

  it('handles multiple roles at one company, wrapped titles and education without dates', () => {
    const r = parse([
      ...header,
      [0, M, 652.3, 15.75, 'Experience'],
      [0, M, 621.8, 12, 'BNP Paribas'],
      [0, M, 605.3, 10.5, '3 years 10 months'],
      [0, M, 584.0, 11.5, 'Senior Site Reliability & Release'],
      [0, M, 569.7, 11.5, 'Manager'],
      [0, M, 555.2, 10.5, 'May 2018 - January 2019 (9 months)'],
      [0, M, 520.0, 11.5, 'Developer'],
      [0, M, 505.5, 10.5, '2015 - 2016 (1 year)'],
      [0, M, 450.0, 15.75, 'Education'],
      [0, M, 424.5, 12, 'Kendriya Vidyalaya'],
      [0, M, 391.1, 12, 'Jabalpur Engineering College'],
      [0, M, 373.5, 10.5, 'Bachelor of Engineering - BE, Electrical · (2008 - 2012)'],
    ])
    expect(r.experiences.map((e) => [e.company, e.title, e.start_date, e.end_date, e.is_current])).toEqual([
      ['BNP Paribas', 'Senior Site Reliability & Release Manager', '2018-05-01', '2019-01-01', false],
      ['BNP Paribas', 'Developer', '2015-01-01', '2016-01-01', false],
    ])
    expect(r.educations).toEqual([
      { school: 'Kendriya Vidyalaya', degree: null, field: null, start_year: null, end_year: null, source: 'linkedin' },
      {
        school: 'Jabalpur Engineering College',
        degree: 'Bachelor of Engineering - BE',
        field: 'Electrical',
        start_year: 2008,
        end_year: 2012,
        source: 'linkedin',
      },
    ])
  })
})

describe('LinkedIn data export (CSV)', () => {
  it('maps real export columns', () => {
    const r = profileFromCsvFiles({
      positions:
        'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Engineer,,Pune,Jan 2020,\nOld Co,Intern,,,Sep 2018,Dec 2018\n',
      skills: 'Name\nSQL\n',
    })
    expect(r.experiences.map((e) => [e.title, e.start_date, e.end_date, e.is_current])).toEqual([
      ['Engineer', '2020-01-01', null, true],
      ['Intern', '2018-09-01', '2018-12-01', false],
    ])
    expect(r.skills).toEqual(['SQL'])
  })

  // BUG: Education.csv has no field-of-study column; "Notes" is the free-text description of the entry,
  // but exportZip.ts stores it as `field` (cut to 160 chars).
  it('does not put Education.csv "Notes" into field of study', () => {
    const r = profileFromCsvFiles({
      education:
        'School Name,Start Date,End Date,Notes,Degree Name,Activities\nJabalpur Engineering College,2008,2012,Topped the branch and led the robotics club for two years,B.E.,NSS\n',
    })
    expect(r.educations[0]!.field).toBeNull()
  })
})
