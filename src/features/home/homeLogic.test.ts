import { describe, expect, it } from 'vitest'
import { dayPart, firstTimeToday, istDay, istHour, isMilestone } from './homeLogic'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('home logic', () => {
  it('day parts', () => {
    expect(dayPart(4)).toBe('night')
    expect(dayPart(5)).toBe('morning')
    expect(dayPart(11)).toBe('morning')
    expect(dayPart(12)).toBe('afternoon')
    expect(dayPart(17)).toBe('evening')
    expect(dayPart(21)).toBe('night')
    expect(dayPart(0)).toBe('night')
  })

  it('uses India time', () => {
    const d = new Date('2026-10-13T20:00:00Z') // 01:30 on the 14th in India
    expect(istHour(d)).toBe(1)
    expect(istDay(d)).toBe('2026-10-14')
  })

  it('once per India-time day', () => {
    const s = memory()
    const a = new Date('2026-10-13T03:00:00Z')
    expect(firstTimeToday('k', s, a)).toBe(true)
    expect(firstTimeToday('k', s, a)).toBe(false)
    expect(firstTimeToday('k', s, new Date('2026-10-13T17:00:00Z'))).toBe(false) // 22:30 IST, same day
    expect(firstTimeToday('k', s, new Date('2026-10-13T19:00:00Z'))).toBe(true) // 00:30 IST, the next day
    expect(firstTimeToday('k', null, a)).toBe(false)
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
    }
    expect(firstTimeToday('k', throwing, a)).toBe(false)
  })

  it('milestones', () => {
    expect(isMilestone('silver')).toBe(true)
    expect(isMilestone('first')).toBe(true)
    expect(isMilestone('plain')).toBe(false)
    expect(isMilestone('none')).toBe(false)
  })
})
