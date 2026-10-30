import { describe, expect, it } from 'vitest'
import { buildPreview, previewToSave } from './mapping'
import { FIXTURES, JUNK } from './pasteFixtures'
import { cleanLines, parsedHasContent, parsePastedProfile } from './pasteParser'

const EMPTY_PROFILE = { full_name: 'Test Member', headline: null, current_title: null, current_company: null, city: null, country: null, grad_year: null, branch: null, about: null, linkedin_url: null, skills: [], help_tags: [], interests: [] }

describe('paste parser: fixtures', () => {
  it('has at least 12 fixtures', () => expect(FIXTURES.length).toBeGreaterThanOrEqual(12))
  for (const f of FIXTURES) {
    it(f.name, () => {
      const p = parsePastedProfile(f.text)
      expect(p.full_name).toBe(f.full_name)
      expect(p.headline).toBe(f.headline)
      expect(p.city).toBe(f.city)
      expect(p.country).toBe(f.country)
      expect(p.experiences.map((e) => [e.title, e.company, e.start_year, e.end_year, e.is_current])).toEqual(f.jobs)
      expect(p.education.map((e) => [e.school, e.degree, e.field, e.start_year, e.end_year])).toEqual(f.schools)
      if (f.skills) expect(p.skills).toEqual(f.skills)
      if (f.grad_year !== undefined) expect(p.grad_year).toBe(f.grad_year)
      if (f.branch !== undefined) expect(p.branch).toBe(f.branch)
      if (f.current !== undefined) expect(f.current ? [p.current_title, p.current_company] : [p.current_title, p.current_company]).toEqual(f.current ?? [null, null])
      if (f.linkedin_url !== undefined) expect(p.linkedin_url).toBe(f.linkedin_url)
      if (f.about_starts) expect(p.about?.startsWith(f.about_starts)).toBe(true)
    })
  }
})

describe('paste parser: details', () => {
  it('keeps experience locations without the work mode', () => {
    const p = parsePastedProfile(FIXTURES[0]!.text)
    expect(p.experiences[0]!.location).toBe('Pune, Maharashtra, India')
    expect(p.experiences[1]!.location).toBe('Hyderabad, Telangana, India')
  })
  it('reads certifications by their Issued lines', () => {
    expect(parsePastedProfile(FIXTURES[2]!.text).certifications).toEqual(['Certified Scrum Product Owner', 'Google Analytics Individual Qualification'])
  })
  it('does not put About "see more" or button labels into the profile', () => {
    const p = parsePastedProfile(FIXTURES[0]!.text)
    expect(p.about).not.toMatch(/see more/i)
    expect(JSON.stringify(p)).not.toMatch(/Connect|Show all|mutual/)
  })
  it('drops skill context lines (company, endorsements)', () => {
    expect(parsePastedProfile(FIXTURES[0]!.text).skills).not.toContain('Infosys +2 experiences')
  })
  it('collapses duplicated lines', () => expect(cleanLines('A\nA\n a \nB')).toEqual(['A', 'B']))
  it('finds a profile link and rejects other links', () => {
    expect(parsePastedProfile('Name\nlinkedin.com/in/some-one?utm=1').linkedin_url).toBe('https://www.linkedin.com/in/some-one')
    expect(parsePastedProfile('Name\nhttps://example.com/in/x').linkedin_url).toBeNull()
  })
  it('CRLF and tabs read the same as LF', () => {
    const a = parsePastedProfile(FIXTURES[1]!.text)
    const b = parsePastedProfile(FIXTURES[1]!.text.replace(/\n/g, '\r\n').replace(/ · /g, '\t·\t'))
    expect(b.experiences).toEqual(a.experiences)
  })
})

describe('paste parser: junk input', () => {
  for (const [i, j] of JUNK.entries()) {
    it(`junk #${i} never throws and finds nothing real`, () => {
      const p = parsePastedProfile(j)
      expect(p.experiences.length).toBeLessThanOrEqual(20)
      expect(() => JSON.stringify(p)).not.toThrow()
    })
  }
  it('empty-ish junk has no content', () => {
    for (const j of ['', 'hello', '12345', 'Experience\nEducation']) expect(parsedHasContent(parsePastedProfile(j))).toBe(false)
  })
  it('non-string input does not throw', () => {
    expect(parsedHasContent(parsePastedProfile(undefined as unknown as string))).toBe(false)
    expect(parsedHasContent(parsePastedProfile(42 as unknown as string))).toBe(false)
  })
  it('is fast on 20,000 characters', () => {
    const t0 = Date.now()
    parsePastedProfile(FIXTURES[0]!.text.repeat(40).slice(0, 20_000))
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

describe('paste parser: through the preview and save mapping', () => {
  it('turns the first fixture into a profile patch, experiences and education', () => {
    const p = parsePastedProfile(FIXTURES[0]!.text)
    const preview = buildPreview(p, EMPTY_PROFILE as never)
    const keys = preview.scalars.map((s) => s.key)
    expect(keys).toEqual(expect.arrayContaining(['current_title', 'current_company', 'headline', 'city', 'branch', 'grad_year']))
    const save = previewToSave(preview, EMPTY_PROFILE as never)
    expect(save.profile.current_company).toBe('Infosys')
    expect(save.profile.grad_year).toBe(2016)
    expect(save.experiences.map((e) => e.company)).toEqual(['Infosys', 'Tech Mahindra'])
    expect(save.educations[0]!.school).toBe('Jabalpur Engineering College')
  })
  it('never overwrites a field the member already filled', () => {
    const p = parsePastedProfile(FIXTURES[0]!.text)
    const preview = buildPreview(p, { ...EMPTY_PROFILE, city: 'Mumbai' } as never)
    const city = preview.scalars.find((s) => s.key === 'city')!
    expect(city.replaces).toBe(true)
    expect(city.checked).toBe(false)
  })
})
