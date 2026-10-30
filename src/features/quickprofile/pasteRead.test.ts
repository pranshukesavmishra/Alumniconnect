import { describe, expect, it, vi } from 'vitest'
import { parseBatchParam } from './batchInvite'
import { buildPreview, previewToSave, type AiProfile } from './mapping'
import { FIXTURES } from './pasteFixtures'
import { readPasted } from './pasteRead'

const SUGGESTION: AiProfile = {
  full_name: null, headline: 'Manager at L&T', current_title: 'Manager', current_company: 'L&T', city: 'Pune', country: 'India', grad_year: 2008, branch: null, degree: null,
  experiences: [{ title: 'Manager', company: 'L&T', start_year: 2015, end_year: null, is_current: true, location: 'Pune' }],
  education: [{ school: 'Government Engineering College Jabalpur', degree: 'B.E.', field: 'Mechanical', start_year: 2004, end_year: 2008 }],
  skills: [], help_tags: [], interests: [], about: null,
}
const ME = { full_name: 'Asha Verma', headline: null, current_title: null, current_company: null, city: null, country: null, grad_year: null, branch: null, about: null, linkedin_url: null, skills: [], help_tags: [], interests: [] }

describe('suggestion -> preview -> save', () => {
  it('everything is ticked-to-review, the name is never changed, and nothing is written until the member saves', () => {
    const preview = buildPreview(SUGGESTION, ME as never)
    expect(preview.scalars.find((s) => s.key === 'full_name')).toBeUndefined()
    expect(preview.experiences.map((e) => [e.company, e.checked])).toEqual([['L&T', true]])
    expect(preview.education.map((e) => e.school)).toEqual(['Government Engineering College Jabalpur'])
    const save = previewToSave(preview, ME as never)
    expect(save.profile.current_company).toBe('L&T')
    expect(save.profile.grad_year).toBe(2008)
    expect(save.profile.full_name).toBeUndefined()
  })
  it('an unticked suggestion field is not saved', () => {
    const preview = buildPreview(SUGGESTION, ME as never)
    preview.scalars = preview.scalars.map((s) => (s.key === 'city' ? { ...s, checked: false } : s))
    expect(previewToSave(preview, ME as never).profile.city).toBeUndefined()
  })
})

describe('readPasted: AI first when on, silent fallback to the device reading', () => {
  const text = FIXTURES[0]!.text
  it('AI off: the device reading, AI never called', async () => {
    const ai = vi.fn()
    const r = await readPasted(text, false, ai)
    expect(r.by).toBe('device')
    expect(ai).not.toHaveBeenCalled()
    expect(r.profile.experiences.map((e) => e.company)).toEqual(['Infosys', 'Tech Mahindra'])
  })
  it('AI on: its reading is used', async () => {
    const r = await readPasted(text, true, () => Promise.resolve(SUGGESTION))
    expect(r.by).toBe('ai')
    expect(r.profile.current_company).toBe('L&T')
  })
  it('AI fails or is busy: the device reading, no error', async () => {
    const r = await readPasted(text, true, () => Promise.reject(new Error('ai_busy')))
    expect(r.by).toBe('device')
    expect(r.profile.experiences).toHaveLength(2)
  })
  it('AI found far fewer jobs than the device: the device reading wins', async () => {
    const r = await readPasted(FIXTURES[1]!.text, true, () => Promise.resolve({ ...SUGGESTION, experiences: [] }))
    expect(r.by).toBe('device')
  })
})

describe('batch invite link', () => {
  it.each([['?batch=1993', 1993], ['?x=1&batch=2008', 2008], ['?batch=abcd', null], ['?batch=19930', null], ['?batch=1800', null], ['', null]])('%s', (q, n) => {
    expect(parseBatchParam(q)).toBe(n)
  })
})
