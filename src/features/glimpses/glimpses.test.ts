import { describe, expect, it } from 'vitest'
import { glimpseCaption, isLive, moveItem } from './api'

describe('glimpse helpers', () => {
  it('shows a glimpse to the public only when it is switched on AND the video has reached Drive', () => {
    expect(isLive({ is_visible: true, drive_file_id: 'abc' })).toBe(true)
    expect(isLive({ is_visible: false, drive_file_id: 'abc' })).toBe(false)
    expect(isLive({ is_visible: true, drive_file_id: null })).toBe(false)
  })

  it('chooses the caption by language and falls back to the other one', () => {
    const g = { caption: 'Night party', caption_hi: 'नाइट पार्टी' }
    expect(glimpseCaption(g, 'en')).toBe('Night party')
    expect(glimpseCaption(g, 'hi')).toBe('नाइट पार्टी')
    expect(glimpseCaption({ caption: 'Only English', caption_hi: null }, 'hi')).toBe('Only English')
    expect(glimpseCaption({ caption: null, caption_hi: 'सिर्फ हिंदी' }, 'en')).toBe('सिर्फ हिंदी')
    expect(glimpseCaption({ caption: null, caption_hi: null }, 'en')).toBeNull()
  })

  it('moves one entry up or down without changing the others, and stays put at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    const src = ['a', 'b']
    moveItem(src, 0, 1)
    expect(src).toEqual(['a', 'b'])
  })
})
