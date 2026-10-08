// Synthetic lines that follow the measured layout of LinkedIn's "Save to PDF" (docs/LINKEDIN_PDF.md).
import { describe, expect, it } from 'vitest'
import { parseDateRange, parseDegreeLine, parseLinkedInPdfLines, type PdfLine } from './profilePdf'

const L = (page: number, y: number, size: number, text: string): PdfLine => ({ page, y, size, text })

const main: PdfLine[] = [
  L(0, 726.45, 26, 'Asha Rao'),
  L(0, 700, 12, 'Senior Engineer at Tata Steel | Ex-Infosys |'),
  L(0, 685.6, 12, 'JEC 2005'),
  L(0, 670, 12, 'Pune, Maharashtra, India'),
  L(0, 640, 15.75, 'Summary'),
  L(0, 615, 12, 'I build steel plants and mentor juniors from'),
  L(0, 597, 12, 'Jabalpur Engineering College.'),
  L(0, 561, 12, 'Second paragraph.'),
  L(0, 530, 15.75, 'Experience'),
  // single role
  L(0, 500, 12, 'Tata Steel'),
  L(0, 483.9, 11.5, 'Senior Engineer'),
  L(0, 469.4, 10.5, 'March 2015 - Present (11 years 8 months)'),
  L(0, 454.7, 10.5, 'Pune, Maharashtra, India'),
  L(0, 433.4, 10.5, '• Led commissioning of a blast furnace'),
  // multi-role
  L(0, 395, 12, 'Infosys'),
  L(0, 378.5, 10.5, '9 years 7 months'),
  L(0, 357.2, 11.5, 'Technical Lead'),
  L(0, 342.7, 10.5, 'January 2010 - February 2015 (5 years 2 months)'),
  L(0, 311.2, 11.5, 'Systems Engineer with a very long title that'),
  L(0, 296.9, 11.5, 'wraps onto a second line'),
  L(0, 282.4, 10.5, '2005 - 2009 (4 years)'),
  L(0, 267.7, 10.5, 'Mysuru'),
  // page break inside education
  L(0, 200, 15.75, 'Education'),
  L(0, 170, 12, 'Jabalpur Engineering College'),
  L(1, 738, 10.5, 'Bachelor of Engineering - BE, Mechanical Engineering · (2001 - 2005)'),
  L(1, 704.6, 12, 'Kendriya Vidyalaya'),
]
const sidebar: PdfLine[] = [
  L(0, 740, 13, 'Contact'),
  L(0, 720, 10.5, 'asha@example.com'),
  L(0, 702.4, 11, 'www.linkedin.com/in/asha-'),
  L(0, 688, 11, 'rao-05 (LinkedIn)'),
  L(0, 660, 13, 'Top Skills'),
  L(0, 640, 10.5, 'Project Management'),
  L(0, 622.4, 10.5, 'Metallurgy'),
  L(0, 590, 13, 'Languages'),
  L(0, 570, 10.5, 'Hindi (Native or Bilingual)'),
]

describe('LinkedIn profile PDF', () => {
  const r = parseLinkedInPdfLines(main, sidebar)
  it('reads the header', () => {
    expect(r.headline).toBe('Senior Engineer at Tata Steel | Ex-Infosys | JEC 2005')
    expect(r.city).toBe('Pune')
    expect(r.about).toBe('I build steel plants and mentor juniors from Jabalpur Engineering College.\n\nSecond paragraph.')
  })
  it('reads single and multi-role experience', () => {
    expect(r.experiences).toHaveLength(3)
    expect(r.experiences[0]).toMatchObject({ company: 'Tata Steel', title: 'Senior Engineer', start_date: '2015-03-01', end_date: null, is_current: true, location: 'Pune, Maharashtra, India' })
    expect(r.experiences[0]!.description).toContain('blast furnace')
    expect(r.experiences[1]).toMatchObject({ company: 'Infosys', title: 'Technical Lead', start_date: '2010-01-01', end_date: '2015-02-01', is_current: false, location: null })
    expect(r.experiences[2]).toMatchObject({ company: 'Infosys', title: 'Systems Engineer with a very long title that wraps onto a second line', start_date: '2005-01-01', end_date: '2009-01-01', location: 'Mysuru' })
  })
  it('reads education across a page break', () => {
    expect(r.educations[0]).toMatchObject({ school: 'Jabalpur Engineering College', degree: 'Bachelor of Engineering - BE', field: 'Mechanical Engineering', start_year: 2001, end_year: 2005 })
    expect(r.educations[1]).toMatchObject({ school: 'Kendriya Vidyalaya', degree: null })
  })
  it('reads skills and a wrapped LinkedIn URL', () => {
    expect(r.skills).toEqual(['Project Management', 'Metallurgy'])
    expect(r.linkedin_url).toBe('https://www.linkedin.com/in/asha-rao-05')
  })
  it('parses date and degree variants', () => {
    expect(parseDateRange('2022 - 2022 (less than a year)')).toEqual({ start: '2022-01-01', end: '2022-01-01', current: false })
    expect(parseDateRange('noviembre de 2023 - Present (1 año)')).toEqual({ start: '2023-01-01', end: null, current: true })
    expect(parseDegreeLine('Master of Business Administration - MBA, Marketing')).toEqual({ degree: 'Master of Business Administration - MBA', field: 'Marketing', start: null, end: null })
    expect(parseDegreeLine('Information Technology · (2019 - 2020)')).toMatchObject({ degree: 'Information Technology', start: 2019, end: 2020 })
    expect(parseDegreeLine("Bachelor's degree, Computer Science · (January 2025)")).toMatchObject({ start: null, end: 2025 })
  })
})
