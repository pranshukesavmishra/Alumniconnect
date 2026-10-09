import { describe, expect, it } from 'vitest'
import { AUDIT_GROUPS, AUDIT_LABELS } from './auditText'

describe('activity log wording', () => {
  it('every action behind a filter chip has a plain-words label', () => {
    for (const g of AUDIT_GROUPS) for (const a of g.actions) expect(AUDIT_LABELS[a], `${g.id}: ${a}`).toBeTruthy()
  })
  it('configuration changes made by the generic audit trigger are readable', () => {
    for (const t of ['groups_update', 'groups_delete', 'spotlights_insert', 'batch_sizes_update', 'event_questions_insert', 'export_audit']) expect(AUDIT_LABELS[t], t).toBeTruthy()
  })
})
