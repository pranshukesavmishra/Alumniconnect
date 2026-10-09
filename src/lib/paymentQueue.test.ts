import { describe, expect, it } from 'vitest'
import { indexAfterRemoval, reviewAction, stepIndex } from './paymentQueue'

describe('payment review keys', () => {
  it('maps the keys', () => {
    expect(reviewAction({ key: 'v' })).toBe('verify')
    expect(reviewAction({ key: 'Enter' })).toBeNull() // Enter already presses the focused button
    expect(reviewAction({ key: 'R' })).toBe('reject')
    expect(reviewAction({ key: 's' })).toBe('skip')
    expect(reviewAction({ key: 'ArrowRight' })).toBe('skip')
    expect(reviewAction({ key: 'ArrowLeft' })).toBe('back')
    expect(reviewAction({ key: 'o' })).toBe('proof')
    expect(reviewAction({ key: 'c' })).toBe('copy')
    expect(reviewAction({ key: '?' })).toBe('help')
    expect(reviewAction({ key: 'z' })).toBeNull()
  })
  it('never fires while typing or on browser shortcuts', () => {
    expect(reviewAction({ key: 'v', target: { tagName: 'INPUT' } })).toBeNull()
    expect(reviewAction({ key: 'r', target: { tagName: 'textarea' } })).toBeNull()
    expect(reviewAction({ key: 'v', target: { isContentEditable: true } })).toBeNull()
    expect(reviewAction({ key: 'c', ctrlKey: true })).toBeNull()
    expect(reviewAction({ key: 'r', metaKey: true })).toBeNull()
    expect(reviewAction({ key: 'v', target: { tagName: 'BUTTON' } })).toBe('verify')
  })
  it('steps without leaving the queue', () => {
    expect(stepIndex(0, 3, -1)).toBe(0)
    expect(stepIndex(2, 3, 1)).toBe(2)
    expect(stepIndex(1, 3, 1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(0)
    expect(indexAfterRemoval(2, 2)).toBe(1)
    expect(indexAfterRemoval(0, 0)).toBe(0)
    expect(indexAfterRemoval(1, 5)).toBe(1)
  })
})
