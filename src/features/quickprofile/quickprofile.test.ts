import { describe, expect, it } from 'vitest'
import { BRANCHES, HELP_TAGS } from '../../lib/constants'
import type { Profile } from '../../lib/types'
import * as fnLists from '../../../supabase/functions/profile-ai-fill/lists.ts'
import { findJec, normaliseLinkedInUrl } from '../../../supabase/functions/linkedin-enrich/rules.ts'
import {
  aiToImported, buildPreview, e164OrNull, fillEmpty, mapBranch, mapHelpTags, nameInitial, phoneClaimMatches, pickPdfReading, previewIsEmpty,
  previewToSave, suggestSkills, unionList, type AiProfile,
} from './mapping'
import { nudgeCandidates, nudgeDone, pickNudge } from './nudges'
import { mapPrefillColumns, prefillFromCsv, toImportPayload } from './prefillImport'

const EMPTY_AI: AiProfile = {
  full_name: null, headline: null, current_title: null, current_company: null, city: null, country: null, grad_year: null, branch: null,
  degree: null, experiences: [], education: [], skills: [], help_tags: [], interests: [], about: null,
}
const AI: AiProfile = {
  ...EMPTY_AI,
  full_name: 'Rakesh Sharma',
  headline: 'Senior Manager at L&T, Pune',
  current_title: 'Senior Manager',
  current_company: 'L&T',
  city: 'Pune',
  country: 'India',
  grad_year: 2008,
  branch: 'Mech',
  experiences: [
    { title: 'Senior Manager', company: 'L&T', start_year: 2014, end_year: null, is_current: true, location: 'Pune' },
    { title: 'Engineer', company: 'Tata Motors', start_year: 2008, end_year: 2014, is_current: false, location: null },
  ],
  skills: ['Automotive', 'Project management'],
  help_tags: ['Referrals', 'can help with jobs', 'mentoring'],
  about: 'I am a senior manager at L&T in Pune.',
}
const profile = (p: Partial<Profile> = {}) =>
  ({ full_name: 'Rakesh Sharma', headline: null, current_title: null, current_company: null, city: null, country: 'India', grad_year: null, branch: null,
    about: null, linkedin_url: null, skills: [], help_tags: [], interests: [], member_type: 'alumnus', ...p }) as Profile

describe('lists shared with the edge function', () => {
  it('branches, help tags and limits are the same as the app’s', () => {
    expect([...fnLists.BRANCHES]).toEqual([...BRANCHES])
    expect([...fnLists.HELP_TAGS]).toEqual([...HELP_TAGS])
    expect(fnLists.MAX_INPUT_CHARS).toBe(12_000)
    expect(fnLists.MAX_SKILLS).toBe(15)
    expect(fnLists.MAX_ABOUT).toBe(400)
  })
})

describe('branch and help-tag mapping', () => {
  it.each([
    ['Mech', 'B.E. in Mechanical Engineering'],
    ['B.E. Mechanical', 'B.E. in Mechanical Engineering'],
    ['CSE', 'B.E. in Computer Science & Engineering'],
    ['E&TC', 'B.E. in Electronics & Telecommunications'],
    ['ECE', 'B.E. in Electronics & Telecommunications'],
    ['Electrical', 'B.E. in Electrical Engineering'],
    ['IT', 'B.E. in Information Technology'],
    ['Civil', 'B.E. in Civil Engineering'],
    ['IP', 'B.E. Industrial & Production Engineering'],
    ['Mechatronics', 'Mechatronics'],
    ['MCA', 'MCA'],
    ['AI & DS', 'Artificial Intelligence & Data Science'],
    ['B.E. in Civil Engineering', 'B.E. in Civil Engineering'],
  ])('%s -> %s', (raw, want) => expect(mapBranch(raw)).toBe(want))

  it('unknown or empty branch stays empty', () => {
    expect(mapBranch('Philosophy')).toBeNull()
    expect(mapBranch('')).toBeNull()
    expect(mapBranch(null)).toBeNull()
  })

  it('help tags map to the app’s keys without repeats', () => {
    expect(mapHelpTags(['Referrals', 'can help with jobs', 'mentoring', 'MBA abroad', 'we are hiring', 'UPSC', 'nonsense'])).toEqual([
      'Referrals', 'Career guidance', 'Higher studies', 'Hiring', 'Government jobs',
    ])
  })
})

describe('AI JSON -> profile patch (preview)', () => {
  it('an empty profile: everything found is ticked; the sign-in name is kept', () => {
    const p = buildPreview(AI, profile())
    expect(p.scalars.map((s) => s.key)).toEqual(['current_title', 'current_company', 'headline', 'city', 'branch', 'grad_year', 'about'])
    expect(p.scalars.every((s) => s.checked && !s.replaces)).toBe(true)
    expect(p.scalars.find((s) => s.key === 'branch')!.value).toBe('B.E. in Mechanical Engineering')
    expect(p.lists.find((l) => l.key === 'help_tags')!.values).toEqual(['Referrals', 'Career guidance'])
    const save = previewToSave(p, profile())
    expect(save.profile).toMatchObject({ current_title: 'Senior Manager', current_company: 'L&T', city: 'Pune', grad_year: 2008, branch: 'B.E. in Mechanical Engineering' })
    expect(save.profile.full_name).toBeUndefined()
    expect(save.experiences).toHaveLength(2)
  })

  it('never overwrites silently: filled fields are unticked with "replaces", identical ones are left out', () => {
    const cur = profile({ city: 'Mumbai', current_company: 'L&T', skills: ['automotive'] })
    const p = buildPreview(AI, cur)
    const city = p.scalars.find((s) => s.key === 'city')!
    expect([city.checked, city.replaces, city.current]).toEqual([false, true, 'Mumbai'])
    expect(p.scalars.some((s) => s.key === 'current_company')).toBe(false)
    expect(p.lists.find((l) => l.key === 'skills')!.values).toEqual(['Project management'])
    const save = previewToSave(p, cur)
    expect(save.profile.city).toBeUndefined()
    expect(save.profile.skills).toEqual(['automotive', 'Project management'])
  })

  it('a ticked replacement is saved; edited values are saved as edited', () => {
    const cur = profile({ city: 'Mumbai' })
    const p = buildPreview(AI, cur)
    p.scalars = p.scalars.map((s) => (s.key === 'city' ? { ...s, checked: true } : s.key === 'current_title' ? { ...s, value: 'Senior Manager, Projects' } : s))
    const save = previewToSave(p, cur)
    expect(save.profile.city).toBe('Pune')
    expect(save.profile.current_title).toBe('Senior Manager, Projects')
  })

  it('jobs already on the profile are marked and not added again; a missing name is filled', () => {
    const p = buildPreview(AI, profile({ full_name: '' }), [{ title: 'Engineer', company: 'Tata Motors' }])
    expect(p.experiences.map((e) => [e.company, e.exists, e.checked])).toEqual([['L&T', false, true], ['Tata Motors', true, false]])
    expect(previewToSave(p, profile()).experiences.map((e) => e.company)).toEqual(['L&T'])
    expect(p.scalars[0]!.key).toBe('full_name')
  })

  it('nothing new found', () => {
    expect(previewIsEmpty(buildPreview(EMPTY_AI, profile()))).toBe(true)
    expect(previewIsEmpty(buildPreview({ ...EMPTY_AI, country: 'India' }, profile({ country: null })))).toBe(true)
  })

  it('a LinkedIn link from LinkedIn fill is offered only in the canonical form', () => {
    expect(buildPreview({ ...EMPTY_AI, linkedin_url: 'https://www.linkedin.com/in/rakesh' }, profile()).scalars.map((s) => s.key)).toEqual(['linkedin_url'])
    expect(buildPreview({ ...EMPTY_AI, linkedin_url: 'https://evil.example/in/rakesh' }, profile()).scalars).toEqual([])
  })
})

describe('merge rules', () => {
  it('fillEmpty only fills empty fields', () => {
    expect(fillEmpty({ city: 'Pune', current_title: '', current_company: null as string | null, skills: [] as string[] }, { city: 'Delhi', current_title: 'CTO', current_company: 'Acme', skills: ['Go'] })).toEqual({
      current_title: 'CTO', current_company: 'Acme', skills: ['Go'],
    })
    expect(fillEmpty({ city: null as string | null }, { city: '  ' })).toEqual({})
  })
  it('unionList keeps existing first, case-insensitive, capped', () => {
    expect(unionList(['Go', 'SQL'], ['go', 'Rust', ' sql '], 3)).toEqual(['Go', 'SQL', 'Rust'])
  })
})

describe('phone matching for the reunion list', () => {
  it('E.164 or nothing', () => {
    expect(e164OrNull('98765 43210')).toBe('+919876543210')
    expect(e164OrNull('+44 7700 900123')).toBe('+447700900123')
    expect(e164OrNull('9.19876E+11')).toBeNull()
    expect(e164OrNull('12345')).toBeNull()
  })
  it('same number and same first letter (titles ignored)', () => {
    const rec = { phone: '+919876543210', full_name: 'Dr. Asha Rao' }
    expect(phoneClaimMatches(rec, '098765 43210', 'asha')).toBe(true)
    expect(phoneClaimMatches(rec, '+91 98765 43210', 'Bela Rao')).toBe(false)
    expect(phoneClaimMatches(rec, '+91 98765 43211', 'Asha')).toBe(false)
    expect(phoneClaimMatches({ phone: null, full_name: 'Asha' }, '9876543210', 'Asha')).toBe(false)
    expect(nameInitial('Er. Vikram')).toBe('v')
  })
})

describe('reunion list file', () => {
  const CSV = [
    'Timestamp,Email Address,Full Name,Batch (Passing year),Branch,Mobile No.,Current City,Current Organisation,Designation',
    '1/1/2026,ASHA@Example.com,Asha Rao,2008,Mech,98765 43210,Pune,L&T,Senior Manager',
    '1/1/2026,,Vikram Singh,Batch of 2005,CSE,+44 7700 900123,London,Acme,CTO',
    '1/1/2026,not-an-email,No Contact,2006,IT,123,Delhi,,',
    '1/1/2026,x@y.com,,2006,IT,,,,',
  ].join('\n')

  it('recognises Google Form style columns', () => {
    expect(mapPrefillColumns(CSV.split('\n')[0]!.split(','))).toEqual({
      full_name: 'Full Name', email: 'Email Address', phone: 'Mobile No.', grad_year: 'Batch (Passing year)', branch: 'Branch',
      city: 'Current City', organisation: 'Current Organisation', designation: 'Designation',
    })
  })

  it('normalises rows and reports unusable ones', () => {
    const p = prefillFromCsv(CSV)
    expect(p.error).toBeNull()
    expect(p.rows[0]).toMatchObject({ email: 'asha@example.com', phone: '+919876543210', grad_year: '2008', branch: 'B.E. in Mechanical Engineering', organisation: 'L&T', designation: 'Senior Manager', problem: '' })
    expect(p.rows[1]).toMatchObject({ email: null, phone: '+447700900123', grad_year: '2005', branch: 'B.E. in Computer Science & Engineering', problem: '' })
    expect(p.rows[2]!.problem).toBe('no_contact')
    expect(p.rows[3]!.problem).toBe('no_name')
    const payload = toImportPayload(p.rows)
    expect(payload).toHaveLength(2)
    expect(payload[0]).not.toHaveProperty('line')
  })

  it('refuses files without a name or a contact column', () => {
    expect(prefillFromCsv('Email,City\na@b.co,Pune').error).toBe('no_name')
    expect(prefillFromCsv('Name,City\nAsha,Pune').error).toBe('no_contact')
    expect(prefillFromCsv('Name,Email').error).toBe('empty')
  })
})

describe('Home nudges', () => {
  it('asks the most useful thing first, at most one a day', () => {
    const c = nudgeCandidates(profile(), false)
    expect(c).toEqual(['role', 'mentor', 'skills'])
    expect(nudgeCandidates(profile({ current_title: 'CTO', help_tags: ['Career guidance'], skills: ['a', 'b', 'c'] }), true)).toEqual(['claim'])
    const first = pickNudge(c, null, '2026-10-30')
    expect(first).toEqual({ id: 'role', store: '2026-10-30|role|shown' })
    expect(pickNudge(c, first.store, '2026-10-30')).toEqual({ id: 'role', store: null })
    expect(pickNudge(c, nudgeDone('2026-10-30', 'role'), '2026-10-30')).toEqual({ id: null, store: null })
    expect(pickNudge(['mentor'], nudgeDone('2026-10-30', 'role'), '2026-10-31').id).toBe('mentor')
  })
  it('suggests three skills from the title, skipping ones the member has', () => {
    expect(suggestSkills('Senior Software Engineer')).toEqual(['Software development', 'System design', 'Cloud'])
    expect(suggestSkills('Engineering Manager', ['Team leadership'])).toEqual(['Project management', 'Stakeholder management', 'Problem solving'])
    expect(suggestSkills(null)).toHaveLength(3)
  })
})

describe('LinkedIn', () => {
  it('profile links are normalised; other hosts are refused', () => {
    expect(normaliseLinkedInUrl('linkedin.com/in/Asha-Rao')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normaliseLinkedInUrl('https://m.linkedin.com/in/asha-rao/?utm=x')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normaliseLinkedInUrl('https://linkedin.com.evil.io/in/asha')).toBeNull()
    expect(normaliseLinkedInUrl('javascript:alert(1)')).toBeNull()
  })
  it('JEC is recognised in education entries', () => {
    expect(findJec([{ school: 'Jabalpur Engineering College', degree: 'B.E.', field: 'Mechanical Engineering', start_year: 2004, end_year: 2008 }])).toMatchObject({ kind: 'jec', branch: 'B.E. in Mechanical Engineering', end_year: 2008 })
    expect(findJec([{ school: 'GEC Jabalpur', degree: null, field: null, start_year: null, end_year: null }])?.kind).toBe('jec')
    expect(findJec([{ school: 'IIT Bombay', degree: 'M.Tech', field: null, start_year: null, end_year: null }])).toBeNull()
  })
  it('a LinkedIn PDF read by Magic fill becomes the import review shape, with the parser as fallback', () => {
    const ai = aiToImported(AI)
    expect(ai.experiences[0]).toMatchObject({ title: 'Senior Manager', start_date: '2014-01-01', end_date: null, is_current: true })
    expect(ai.experiences[1]).toMatchObject({ end_date: '2014-01-01' })
    const parsed = { experiences: [], educations: [], linkedin_url: 'https://www.linkedin.com/in/rakesh', skills: ['Six Sigma'] }
    expect(pickPdfReading(parsed, null)).toBe(parsed)
    const picked = pickPdfReading(parsed, ai)
    expect(picked.linkedin_url).toBe('https://www.linkedin.com/in/rakesh')
    expect(picked.skills).toEqual(['Automotive', 'Project management', 'Six Sigma'])
  })
})
