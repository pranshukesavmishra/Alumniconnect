import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as icons from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { BADGES, BADGE_KEYS, progressText, shownBadges, sortForDisplay, type BadgeState } from './catalog'

const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261020000092_achievements.sql'), 'utf8')

const state = (key: string, over: Partial<BadgeState> = {}): BadgeState => ({
  key, earned: false, earned_at: null, progress: null, target: null, attainable: true, ...over,
})

describe('badge catalogue', () => {
  it('has every key once, in the same order as the database', () => {
    expect(new Set(BADGE_KEYS).size).toBe(BADGE_KEYS.length)
    expect(Object.keys(BADGES).sort()).toEqual([...BADGE_KEYS].sort())
    const dbKeys = [...sql.matchAll(/jsonb_build_object\('key', '([a-z_0-9]+)'/g)].map((m) => m[1])
    expect(dbKeys).toEqual([...BADGE_KEYS])
  })

  it('has English and Hindi titles and hints, a real lucide icon and a tier for each badge', () => {
    for (const key of BADGE_KEYS) {
      const b = BADGES[key]
      expect(b.key).toBe(key)
      expect(b.title.en.trim(), key).not.toBe('')
      expect(b.how.en.trim(), key).not.toBe('')
      // Hindi text really is Devanagari (not a copy of the English)
      expect(b.title.hi, key).toMatch(/[ऀ-ॿ]/)
      expect(b.how.hi, key).toMatch(/[ऀ-ॿ]/)
      expect((icons as Record<string, unknown>)[b.icon], `${key}: ${b.icon}`).toBeTruthy()
      expect(['bronze', 'silver', 'gold', 'platinum']).toContain(b.tier)
    }
  })

  it('targets match the thresholds in the database', () => {
    expect(BADGES.connector.target).toBe(10)
    expect(BADGES.super_connector.target).toBe(50)
    expect(BADGES.storyteller.target).toBe(5)
    expect(BADGES.photographer.target).toBe(10)
    expect(BADGES.patron.target).toBe(1_000_000) // ₹10,000 in paise
    expect(sql).toContain("'target', 10,")
    expect(sql).toContain('1000000')
    expect(sql).toMatch(/serial <= 500/)
  })
})

describe('shown badges', () => {
  it('joins server state with the catalogue, skips unknown keys, keeps catalogue order', () => {
    const out = shownBadges([state('connector', { progress: 6, target: 10 }), state('mystery_new_badge'), state('verified_jecian', { earned: true })])
    expect(out.map((b) => b.key)).toEqual(['verified_jecian', 'connector'])
    expect(out[1]!.ratio).toBeCloseTo(0.6)
    expect(out[0]!.ratio).toBe(1)
    expect(shownBadges(null)).toEqual([])
  })

  it('progress text', () => {
    expect(progressText({ progress: 6, target: 10, earned: false })).toBe('6/10')
    expect(progressText({ progress: 10, target: 10, earned: true })).toBeNull()
    expect(progressText({ progress: 400000, target: 1_000_000, money: true, earned: false })).toBe('₹4,000 / ₹10,000')
    expect(progressText({ progress: null, target: null, earned: false })).toBeNull()
  })

  it('sorts earned (by tier) first, then the nearest to earn, unattainable last', () => {
    const out = sortForDisplay(
      shownBadges([
        state('verified_jecian', { earned: true, earned_at: '2026-01-01' }),
        state('founding_member', { attainable: false }),
        state('connector', { progress: 9, target: 10 }),
        state('storyteller', { progress: 1, target: 5 }),
        state('mentor', { earned: true, earned_at: '2026-02-01' }),
      ]),
    )
    expect(out.map((b) => b.key)).toEqual(['mentor', 'verified_jecian', 'connector', 'storyteller', 'founding_member'])
  })
})
