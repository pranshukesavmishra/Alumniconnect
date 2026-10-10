import { describe, expect, it } from 'vitest'
import { AUDIT_GROUPS, AUDIT_LABELS, auditSummary } from './auditText'

describe('activity log wording', () => {
  it('every action behind a filter chip has a plain-words label', () => {
    for (const g of AUDIT_GROUPS) for (const a of g.actions) expect(AUDIT_LABELS[a], `${g.id}: ${a}`).toBeTruthy()
  })
  it('configuration changes made by the generic audit trigger are readable', () => {
    for (const t of ['groups_update', 'groups_delete', 'spotlights_insert', 'batch_sizes_update', 'event_questions_insert', 'export_audit']) expect(AUDIT_LABELS[t], t).toBeTruthy()
  })
})

describe('admin access wording', () => {
  it('describes who was made what', () => {
    expect(AUDIT_LABELS.admin_granted).toBeTruthy()
    expect(AUDIT_LABELS.ownership_transferred).toBeTruthy()
    const roles = AUDIT_GROUPS.find((g) => g.id === 'roles')!
    for (const a of ['admin_granted', 'admin_permissions_changed', 'admin_removed', 'super_admin_granted', 'super_admin_removed', 'ownership_transferred']) expect(roles.actions).toContain(a)
  })
  it('summarises the details', () => {
    expect(auditSummary({ name: 'Nina', full: false, permissions: ['a', 'b'] })).toContain('Nina: 2 permissions')
    expect(auditSummary({ name: 'Nina', full: true, permissions: null })).toContain('full admin')
    expect(auditSummary({ name: 'Ravi', from: 'Asha', step_down: true })).toContain('Asha → Ravi (stepped down)')
    expect(auditSummary({ name: 'Ravi', was_admin: true })).toBe('Ravi')
  })
})
