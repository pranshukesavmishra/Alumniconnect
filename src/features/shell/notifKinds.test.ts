import { describe, expect, it } from 'vitest'
import { translate } from '../../i18n/core'
import type { Notification } from '../community/queries'
import { describeNotification, groupByDay } from './notifKinds'

const tx = (k: string, p?: Record<string, string | number>) => translate('en', k, p)
const n = (kind: string, extra: Partial<Notification> = {}): Notification => ({
  id: kind, kind, target_id: 't1', body: 'hello', read_at: null, created_at: new Date().toISOString(), actor: { id: 'a1', full_name: 'Asha Rao', avatar_url: null }, ...extra,
})

describe('notifications centre', () => {
  it('says who did what and links to the right place', () => {
    expect(describeNotification(n('message'), tx as never)).toMatchObject({ to: '/chat/t1' })
    expect(describeNotification(n('message'), tx as never).text).toContain('Asha Rao')
    expect(describeNotification(n('connection_request'), tx as never).to).toBe('/me/connections')
    expect(describeNotification(n('mentor_accepted'), tx as never).text).toContain('Asha Rao')
    expect(describeNotification(n('something_new', { body: 'Plain' }), tx as never)).toMatchObject({ text: 'Plain', to: '/' })
  })

  it('groups into today and earlier', () => {
    const now = new Date('2026-10-13T15:00:00')
    const g = groupByDay([{ created_at: '2026-10-13T09:00:00' }, { created_at: '2026-10-12T23:00:00' }], now)
    expect(g.today).toHaveLength(1)
    expect(g.earlier).toHaveLength(1)
  })
})
