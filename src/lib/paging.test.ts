import { describe, expect, it } from 'vitest'
import { pageSlice } from './paging'

describe('pageSlice', () => {
  const items = Array.from({ length: 250 }, (_, i) => i)
  it('shows the first page and counts what is hidden', () => {
    expect(pageSlice(items, 100)).toMatchObject({ hidden: 150 })
    expect(pageSlice(items, 100).shown).toHaveLength(100)
  })
  it('shows everything once the count passes the length', () => {
    expect(pageSlice(items, 300)).toMatchObject({ hidden: 0 })
    expect(pageSlice(items, 300).shown).toHaveLength(250)
    expect(pageSlice([], 100)).toEqual({ shown: [], hidden: 0 })
  })
})
