import { describe, expect, it } from 'vitest'
import { cleanFilter, describeFilter, extraFilterCount, filterFromParams, filterToParams, PRESET_VIEWS, sameFilter, toRpcFilter } from './memberFilters'

describe('member filters', () => {
  it('reads the admin-home deep link (?filter=pending) and drops junk', () => {
    expect(filterFromParams(new URLSearchParams('filter=pending'))).toEqual({ status: 'pending' })
    expect(filterFromParams(new URLSearchParams('filter=bogus&older=abc&from=05&type=guest&sort=random'))).toEqual({})
    expect(filterFromParams(new URLSearchParams('open=123'))).toEqual({})
  })

  it('round-trips through the URL', () => {
    const f = { q: 'asha', status: 'pending' as const, onboarded: 'yes' as const, older: 3, signin: 'never' as const, branch: 'Civil Engineering', batch_from: 2001, batch_to: 2005, city: 'Pune', type: 'alumnus' as const, sort: 'oldest' as const }
    const params = new URLSearchParams(filterToParams(f))
    expect(params.get('filter')).toBe('pending')
    expect(filterFromParams(params)).toEqual(f)
  })

  it('treats defaults as no filter', () => {
    expect(cleanFilter({ status: 'all', sort: 'newest', q: '   ' })).toEqual({})
    expect(sameFilter({ status: 'all' }, {})).toBe(true)
    expect(sameFilter({ older: 3, status: 'pending' }, { status: 'pending', older: 3 })).toBe(true)
    expect(sameFilter({ older: 3 }, { older: 4 })).toBe(false)
  })

  it('sends strings to the server, which validates them again', () => {
    expect(toRpcFilter({ status: 'pending', older: 3, batch_from: 2001 })).toEqual({ status: 'pending', older: '3', batch_from: '2001' })
    expect(toRpcFilter({ older: 0 })).toEqual({})
  })

  it('counts and describes the extra filters', () => {
    expect(extraFilterCount({ q: 'x', status: 'pending' })).toBe(0)
    expect(extraFilterCount({ older: 3, city: 'Pune', sort: 'name' })).toBe(3)
    expect(describeFilter({ status: 'pending', older: 3, batch_from: 2001, batch_to: 2005 })).toEqual(['Not yet verified', 'Joined over 3 days ago', 'Batch 2001–2005'])
    expect(describeFilter({ batch_to: 1999, signin: 'never', older: 1 })).toEqual(['Joined over 1 day ago', 'Never signed in', 'Batch 1999 or earlier'])
  })

  it('has a "waiting over 3 days" preset that matches the queue', () => {
    const p = PRESET_VIEWS.find((v) => v.id === 'waiting-3')!
    expect(toRpcFilter(p.filter)).toEqual({ status: 'pending', onboarded: 'yes', older: '3', sort: 'oldest' })
  })
})
