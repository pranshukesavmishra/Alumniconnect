import { describe, expect, it } from 'vitest'
import { hasAnyPerm, hasPerm, missing, PERMISSION_KEYS, PERMISSIONS, presetFor, PRESETS, summarize, unknownKeys, visibleTiles, type AdminAccess } from './adminAccess'

const limited = (permissions: string[]): AdminAccess => ({ is_admin: true, is_super: false, full: false, permissions })
const full: AdminAccess = { is_admin: true, is_super: false, full: true, permissions: [] }
const member: AdminAccess = { is_admin: false, is_super: false, full: false, permissions: [] }

describe('catalogue', () => {
  it('has unique keys, labels and a description for each', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSIONS.length)
    expect(new Set(PERMISSIONS.map((p) => p.label)).size).toBe(PERMISSIONS.length)
    expect(PERMISSIONS.every((p) => p.description.length > 10)).toBe(true)
  })
  it('every preset only uses known keys', () => {
    for (const p of PRESETS) expect(unknownKeys(p.permissions ?? [])).toEqual([])
  })
  it('the moderation preset is exactly the moderation family', () => {
    expect(PRESETS.find((p) => p.id === 'moderation')!.permissions).toEqual(PERMISSION_KEYS.filter((k) => k.startsWith('moderation_')))
  })
  it('no preset hands out the admins view or is accidentally empty (except custom)', () => {
    for (const p of PRESETS.filter((x) => x.id !== 'custom' && x.permissions !== null)) {
      expect(p.permissions!.length).toBeGreaterThan(0)
      expect(p.permissions).not.toContain('admins')
    }
  })
})

describe('hasPerm', () => {
  it('a full admin holds everything, a member nothing', () => {
    expect(hasPerm(full, 'money_payments')).toBe(true)
    expect(hasPerm(member, 'money_payments')).toBe(false)
    expect(hasPerm(null, 'x')).toBe(false)
  })
  it('a limited admin holds exactly their keys', () => {
    const a = limited(['moderation_reports'])
    expect(hasPerm(a, 'moderation_reports')).toBe(true)
    expect(hasPerm(a, 'moderation_hide')).toBe(false)
    expect(hasPerm(a, 'moderation_*')).toBe(true)
    expect(hasPerm(a, 'money_*')).toBe(false)
    expect(hasAnyPerm(a, ['members_view', 'moderation_reports'])).toBe(true)
  })
})

describe('presets and summaries', () => {
  it('recognises a preset from its permission set, in any order', () => {
    const mod = PRESETS.find((p) => p.id === 'moderation')!.permissions!
    expect(presetFor([...mod].reverse())).toBe('moderation')
    expect(presetFor(null)).toBe('full')
    expect(presetFor(['analytics'])).toBe('custom')
  })
  it('summarises in plain words', () => {
    expect(summarize(null)).toMatch(/^Full admin/)
    expect(summarize([])).toBe('Nothing selected')
    expect(summarize(['analytics', 'audit'])).toBe('2 of 32 permissions: Analytics, Activity log')
    expect(missing(['analytics'])).toHaveLength(PERMISSION_KEYS.length - 1)
    expect(missing(null)).toEqual([])
  })
})

describe('tiles on the admin home', () => {
  it('a moderation-only admin sees the reports and inbox tiles and nothing else', () => {
    expect(visibleTiles(limited(['moderation_reports', 'moderation_hide', 'moderation_slowmode', 'moderation_meetups']))).toEqual(['reports', 'inbox'])
  })
  it('a full admin sees every tile', () => {
    expect(visibleTiles(full)).toEqual(['members', 'analytics', 'community', 'reports', 'roles', 'health', 'activity', 'inbox'])
  })
  it('a member sees none', () => {
    expect(visibleTiles(member)).toEqual([])
  })
  it('members_view alone opens only Members', () => {
    expect(visibleTiles(limited(['members_view']))).toEqual(['members'])
  })
})
