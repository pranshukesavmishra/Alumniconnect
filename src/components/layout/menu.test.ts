import { describe, expect, it } from 'vitest'
import { en } from '../../i18n/en'
import { hi } from '../../i18n/hi'
import { NO_ACCESS, type AdminAccess } from '../../lib/adminAccess'
import { isActive, isVisible, MENU, MENU_GROUPS, searchMenu, visibleMenu, type MenuCtx } from './menu'

const member: MenuCtx = { signedIn: true, verified: true, access: NO_ACCESS, organiser: false }
const limited = (permissions: string[]): AdminAccess => ({ is_admin: true, is_super: false, full: false, permissions })
const ids = (c: MenuCtx) => visibleMenu(c).flatMap((s) => s.items.map((i) => i.id))
const label = (k: string) => (en as Record<string, string>)[k] ?? k

describe('menu registry', () => {
  it('has unique ids, known groups and every label in English and Hindi', () => {
    expect(new Set(MENU.map((i) => i.id)).size).toBe(MENU.length)
    const groups = new Set<string>(MENU_GROUPS.map((g) => g.id))
    for (const i of MENU) {
      expect(groups.has(i.group), i.id).toBe(true)
      expect(i.to || i.action, i.id).toBeTruthy()
      expect(label(i.label) !== i.label, `${i.id} en`).toBe(true)
      expect(i.label in hi, `${i.id} hi`).toBe(true)
    }
    for (const g of MENU_GROUPS) expect(g.label in hi).toBe(true)
  })

  it('shows a visitor only the public entries', () => {
    expect(ids({ ...member, signedIn: false, verified: false })).toEqual(['home', 'meet', 'programme', 'about', 'privacy', 'terms'])
  })

  it('hides community entries from unverified members but keeps profile and settings', () => {
    const got = ids({ ...member, verified: false })
    expect(got).not.toContain('groups')
    expect(got).not.toContain('jobs')
    expect(got).toEqual(expect.arrayContaining(['home', 'meet', 'profile', 'edit-profile', 'signout']))
  })

  it('shows a verified member everything except Organise', () => {
    const got = visibleMenu(member)
    expect(got.map((s) => s.id)).toEqual(['home', 'community', 'events', 'opportunities', 'me'])
  })

  it('shows Organise entries by permission', () => {
    const none = ids({ ...member, access: limited([]), organiser: true })
    expect(none).toContain('org-home')
    expect(none).not.toContain('org-members')
    const some = ids({ ...member, access: limited(['members_view', 'audit']), organiser: true })
    expect(some).toEqual(expect.arrayContaining(['org-home', 'org-members', 'org-activity']))
    expect(some).not.toContain('org-health')
    expect(some).not.toContain('org-roles')
    const all = ids({ ...member, access: { is_admin: true, is_super: true, full: true, permissions: [] }, organiser: true })
    for (const id of ['org-inbox', 'org-members', 'org-reports', 'org-community', 'org-analytics', 'org-roles', 'org-health', 'org-activity']) expect(all).toContain(id)
  })

  it('lets a moderator who is no admin see Reports only', () => {
    const got = ids({ ...member, organiser: true, moderator: true })
    expect(got).toContain('org-home')
    expect(got).toContain('org-reports')
    expect(got).not.toContain('org-members')
  })

  it('hides an entry whose feature is switched off', () => {
    const item = { ...MENU[0]!, feature: 'x' }
    expect(isVisible(item, { ...member, off: ['x'] })).toBe(false)
    expect(isVisible(item, member)).toBe(true)
  })

  it('highlights the current route, sub-routes included, but not hash-only entries', () => {
    const by = (id: string) => MENU.find((i) => i.id === id)!
    expect(isActive(by('home'), '/')).toBe(true)
    expect(isActive(by('home'), '/groups')).toBe(false)
    expect(isActive(by('groups'), '/groups/jec-2028')).toBe(true)
    expect(isActive(by('meet'), '/meet/photos')).toBe(false)
    expect(isActive(by('reunion-photos'), '/meet/photos')).toBe(true)
    expect(isActive(by('profile'), '/me/edit')).toBe(false)
    expect(isActive(by('edit-profile'), '/me/edit')).toBe(true)
    expect(isActive(by('language'), '/me')).toBe(false)
  })

  it('searches labels, keywords and group names', () => {
    const all = visibleMenu(member)
    const flat = (q: string) => searchMenu(all, q, label).flatMap((s) => s.items.map((i) => i.id))
    expect(flat('')).toEqual(all.flatMap((s) => s.items.map((i) => i.id)))
    expect(flat('jecian')).toContain('directory')
    expect(flat('hindi')).toContain('language')
    expect(flat('opportun')).toEqual(['jobs', 'mentors', 'businesses', 'help'])
    expect(flat('zzzz')).toEqual([])
  })
})
