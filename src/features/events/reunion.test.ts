import { describe, expect, it } from 'vitest'
import type { EventQuestion, TicketType } from '../../lib/types'
import { checkCustomAnswers, cleanCustomAnswers, dayHeads, dayLabel, eventDayCount, fundOk, missingProfileFields, pastJobs, ticketFits } from './reunion'

const event = { starts_at: '2026-12-26T04:30:00Z', ends_at: '2026-12-27T12:30:00Z' }
const t = (id: string, days: number[] | null) => ({ id, days }) as Pick<TicketType, 'id' | 'days'>
const q = (over: Partial<EventQuestion>): EventQuestion => ({ id: 'q1', event_id: 'e', kind: 'yes_no', label: 'Q', help: null, options: [], required: false, is_active: true, sort: 1, ...over })

describe('event days', () => {
  it('counts days in India time and labels them', () => {
    expect(eventDayCount(event)).toBe(2)
    expect(eventDayCount({ starts_at: null, ends_at: null })).toBe(1)
    expect(eventDayCount({ starts_at: event.starts_at, ends_at: null }, [{ days: [3] }])).toBe(3)
    expect(dayLabel(event, 1)).toBe('26 Dec')
    expect(dayLabel(event, 2)).toBe('27 Dec')
  })
  it('family tickets fit only main tickets that cover their days', () => {
    expect(ticketFits({ days: [1] }, { days: [2] })).toBe(false)
    expect(ticketFits({ days: [2] }, { days: [2] })).toBe(true)
    expect(ticketFits({ days: null }, { days: [2] })).toBe(true)
    expect(ticketFits(undefined, { days: [2] })).toBe(true)
    expect(ticketFits({ days: [1] }, { days: null })).toBe(true)
  })
  it('counts people per day', () => {
    const tickets = [t('both', null), t('adult', [2]), t('one', [1])]
    expect(dayHeads(tickets, { both: 1, adult: 2 }, 2)).toEqual({ 1: 1, 2: 3 })
    expect(dayHeads(tickets, { one: 1 }, 2)).toEqual({ 1: 1, 2: 0 })
  })
})

describe('Reunion Fund amount', () => {
  it('accepts whole rupees from ₹100 to ₹10,00,000', () => {
    expect(fundOk(10000)).toBe(true)
    expect(fundOk(250000)).toBe(true)
    expect(fundOk(100000000)).toBe(true)
    expect(fundOk(9900)).toBe(false)
    expect(fundOk(100000100)).toBe(false)
    expect(fundOk(10050)).toBe(false)
    expect(fundOk(NaN)).toBe(false)
    expect(fundOk(null)).toBe(false)
  })
})

describe('organisers’ own questions', () => {
  const qs = [
    q({ id: 'a', kind: 'single', options: ['x', 'y'], required: true }),
    q({ id: 'b', kind: 'multi', options: ['p', 'q'] }),
    q({ id: 'c', kind: 'short_text' }),
    q({ id: 'd', kind: 'yes_no', is_active: false, required: true }),
  ]
  it('flags missing required, bad options and over-long text; ignores switched-off questions', () => {
    expect(checkCustomAnswers(qs, {})).toEqual({ a: 'required' })
    expect(checkCustomAnswers(qs, { a: 'z' })).toEqual({ a: 'option' })
    expect(checkCustomAnswers(qs, { a: 'x', b: ['p', 'nope'] })).toEqual({ b: 'option' })
    expect(checkCustomAnswers(qs, { a: 'x', c: 'z'.repeat(201) })).toEqual({ c: 'long' })
    expect(checkCustomAnswers(qs, { a: 'x', b: ['p'], c: 'ok' })).toEqual({})
  })
  it('sends only trimmed answers to active questions', () => {
    expect(cleanCustomAnswers(qs, { a: 'x', b: [], c: '  hi  ', d: true })).toEqual({ a: 'x', c: 'hi' })
  })
})

describe('profile completeness', () => {
  const full = { full_name: 'A', grad_year: 2007, branch: 'MCA', city: 'Pune', country: 'India', current_title: 'Eng', current_company: 'X' }
  it('lists what the profile still needs', () => {
    expect(missingProfileFields(full, '+91 98765 43210', [], true)).toEqual([])
    expect(missingProfileFields({ ...full, country: null, current_title: null }, null, [], true)).toEqual(['phone', 'country', 'designation'])
    expect(missingProfileFields({ ...full, current_title: null, current_company: null }, '9876543210', [{ title: 'Lead', company: 'Y', is_current: true }], true)).toEqual([])
    expect(missingProfileFields({ ...full, branch: null }, '9876543210', [], false)).toEqual([])
  })
  it('formats earlier jobs, newest first', () => {
    expect(
      pastJobs([
        { title: 'Eng', company: 'TCS', is_current: false, start_date: '2007-07-01', end_date: '2009-12-01' },
        { title: 'Sr', company: 'Wipro', is_current: false, start_date: '2010-01-01', end_date: '2014-12-01' },
        { title: 'Mgr', company: 'Infosys', is_current: true, start_date: '2015-01-01', end_date: null },
      ]),
    ).toEqual(['Sr at Wipro (2010–2014)', 'Eng at TCS (2007–2009)'])
  })
})
