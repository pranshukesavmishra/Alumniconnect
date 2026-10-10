import { describe, expect, it } from 'vitest'
import { groupByYear, meetDescription, meetHighlights, meetTitle, slugify, sortMeets } from './api'

const m = (title: string, year: number, held_on: string | null = null) => ({ title, year, held_on })

describe('past meets', () => {
  it('lists the newest year first, then the later date, then the title', () => {
    const list = [m('Meet 2023', 2023), m('Meet 2025 B', 2025, '2025-12-28'), m('Meet 2025 A', 2025, '2025-12-27'), m('Meet 2024', 2024)]
    expect(sortMeets(list).map((x) => x.title)).toEqual(['Meet 2025 B', 'Meet 2025 A', 'Meet 2024', 'Meet 2023'])
  })

  it('groups them by year, newest first', () => {
    const g = groupByYear([m('a', 2024), m('b', 2025), m('c', 2025, '2025-01-02')])
    expect(g.map(([y]) => y)).toEqual([2025, 2024])
    expect(g[0]![1].map((x) => x.title)).toEqual(['c', 'b'])
    expect(groupByYear([])).toEqual([])
  })

  it('makes a web address from a title', () => {
    expect(slugify('Alumni Meet 2025')).toBe('alumni-meet-2025')
    expect(slugify('  JEC  Reunion!! (2019) ')).toBe('jec-reunion-2019')
    expect(slugify('!!!')).toBe('meet')
    expect(slugify('x'.repeat(80)).length).toBe(50)
  })

  it('picks the text by language with a fallback', () => {
    const meet = { title: 'Alumni Meet 2025', title_hi: 'पूर्व छात्र सम्मेलन 2025', description: 'A day together', description_hi: null, highlights: null, highlights_hi: 'मुख्य बातें' }
    expect(meetTitle(meet, 'en')).toBe('Alumni Meet 2025')
    expect(meetTitle(meet, 'hi')).toBe('पूर्व छात्र सम्मेलन 2025')
    expect(meetDescription(meet, 'hi')).toBe('A day together')
    expect(meetHighlights(meet, 'en')).toBe('मुख्य बातें')
    expect(meetTitle({ ...meet, title_hi: null }, 'hi')).toBe('Alumni Meet 2025')
  })
})
