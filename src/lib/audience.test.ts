import { describe, expect, it } from 'vitest'
import { audienceJson, describeAudience, emptyAudience, TEMPLATES, validateAudience } from './audience'

describe('audience', () => {
  it('leaves empty filters out of the JSON', () => {
    expect(audienceJson(emptyAudience('unpaid'))).toEqual({ segment: 'unpaid' })
    expect(audienceJson({ ...emptyAudience('confirmed'), batchFrom: ' 2001 ', batchTo: '2005', city: ' Pune ', ticketTypeId: 't1', viewId: 'v1' })).toEqual({
      segment: 'confirmed', batch_from: '2001', batch_to: '2005', city: 'Pune', ticket_type_id: 't1', view_id: 'v1',
    })
  })
  it('drops the ticket filter for people who have no registration', () => {
    expect(audienceJson({ ...emptyAudience('not_registered'), ticketTypeId: 't1' })).toEqual({ segment: 'not_registered' })
    expect(audienceJson({ ...emptyAudience('waitlist'), ticketTypeId: 't1' })).toEqual({ segment: 'waitlist' })
  })
  it('validates batch years', () => {
    expect(validateAudience(emptyAudience())).toBeNull()
    expect(validateAudience({ ...emptyAudience(), batchFrom: '20x5' })).toMatch(/2005/)
    expect(validateAudience({ ...emptyAudience(), batchFrom: '2008', batchTo: '2001' })).toMatch(/after/)
    expect(validateAudience({ ...emptyAudience(), batchFrom: '2001', batchTo: '2001' })).toBeNull()
  })
  it('describes an audience in words', () => {
    expect(describeAudience({ segment: 'unpaid' })).toBe('Registered, not paid yet')
    expect(describeAudience({ segment: 'registered', batch_from: '2001', batch_to: '2005', city: 'Pune' })).toBe('Everyone registered · batches 2001–2005 · city: Pune')
    expect(describeAudience({ segment: 'confirmed', batch_from: '2003', batch_to: '2003', ticket_type_id: 't1' }, { tickets: new Map([['t1', 'Spouse']]) })).toBe('Confirmed · batch 2003 · ticket: Spouse')
    expect(describeAudience({ segment: 'registered', batch_from: '2010' })).toContain('2010 or later')
    expect(describeAudience({ segment: 'not_registered', view_id: 'v' }, { views: new Map([['v', 'Pune folks']]) })).toContain('view: Pune folks')
  })
  it('keeps every template inside the database limits', () => {
    for (const t of TEMPLATES) {
      expect(t.title.length).toBeGreaterThanOrEqual(3)
      expect(t.title.length).toBeLessThanOrEqual(60)
      expect(t.body.length).toBeGreaterThanOrEqual(3)
      expect(t.body.length).toBeLessThanOrEqual(130)
    }
  })
})
