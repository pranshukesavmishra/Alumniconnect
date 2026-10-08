import { describe, expect, it } from 'vitest'
import { isJec, normalizeLinkedInUrl, parseLinkedInDate, yearOf } from './common'
import { parseLinkedInCsv, profileFromCsvFiles } from './exportZip'

describe('LinkedIn dates', () => {
  it.each([
    ['Jan 2020', '2020-01-01'],
    ['January 2020', '2020-01-01'],
    ['Sept 2019', '2019-09-01'],
    ['September 2019', '2019-09-01'],
    ['2018', '2018-01-01'],
    ['03/2017', '2017-03-01'],
    ['Present', null],
    ['', null],
    ['13/2017', null],
  ])('%s -> %s', (input, out) => expect(parseLinkedInDate(input)).toBe(out))
  it('finds years', () => {
    expect(yearOf('Jul 2001')).toBe(2001)
    expect(yearOf(undefined)).toBeNull()
  })
})

describe('LinkedIn URLs and JEC detection', () => {
  it('normalizes profile URLs', () => {
    expect(normalizeLinkedInUrl('linkedin.com/in/asha-rao')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normalizeLinkedInUrl('https://in.linkedin.com/in/asha-rao/?trk=x')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normalizeLinkedInUrl('https://evil.com/in/asha')).toBeNull()
  })
  it('detects JEC', () => {
    expect(isJec('Jabalpur Engineering College')).toBe(true)
    expect(isJec('Government Engineering College, Jabalpur')).toBe(true)
    expect(isJec('IIT Bombay')).toBe(false)
  })
})

describe('LinkedIn data export CSVs', () => {
  const positions = `Notes:
"This file contains your positions"

Company Name,Title,Description,Location,Started On,Finished On
Flipkart,SDE II,"Built payments, at scale
for India",Bengaluru,Mar 2021,
Infosys,Systems Engineer,,Pune,Jul 2005,Feb 2021
`
  it('skips the notes preamble', () => {
    const rows = parseLinkedInCsv(positions, 'Company Name')
    expect(rows).toHaveLength(2)
    expect(rows[0]!['Company Name']).toBe('Flipkart')
  })
  it('maps everything into a profile', () => {
    const p = profileFromCsvFiles({
      profile: 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location\nAsha,Rao,,,,SDE II at Flipkart,I build things,Software,,"Bengaluru, Karnataka, India"\n',
      positions,
      education: 'School Name,Start Date,End Date,Notes,Degree Name,Activities\nJabalpur Engineering College,2001,2005,,Bachelor of Engineering,\n',
      skills: 'Name\nJava\nSystem Design\nJava\n',
    })
    expect(p.headline).toBe('SDE II at Flipkart')
    expect(p.city).toBe('Bengaluru')
    expect(p.experiences[0]).toMatchObject({ company: 'Flipkart', title: 'SDE II', is_current: true, start_date: '2021-03-01', end_date: null })
    expect(p.experiences[0]!.description).toContain('for India')
    expect(p.experiences[1]).toMatchObject({ company: 'Infosys', is_current: false, end_date: '2021-02-01' })
    expect(p.educations[0]).toMatchObject({ school: 'Jabalpur Engineering College', degree: 'Bachelor of Engineering', start_year: 2001, end_year: 2005 })
    expect(p.skills).toEqual(['Java', 'System Design'])
  })
})
