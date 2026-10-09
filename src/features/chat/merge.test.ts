import { describe, expect, it } from 'vitest'
import { firstUnreadIndex, hasUnknownSender, isContinuation, mergeMessages, previewOf, type Message } from './merge'

const ME = 'u-me'
const OTHER = 'u-other'
function msg(id: string, at: string, over: Partial<Message> = {}): Message {
  return {
    id,
    chat_id: 'c1',
    sender_id: OTHER,
    kind: 'text',
    body: id,
    attachments: [],
    reply_to: null,
    poll: null,
    edited_at: null,
    deleted_at: null,
    created_at: at,
    ...over,
  }
}

describe('mergeMessages', () => {
  it('orders by time and de-duplicates by id', () => {
    const a = msg('a', '2026-10-08T10:00:00Z')
    const b = msg('b', '2026-10-08T10:01:00Z')
    const out = mergeMessages([b], [a, b])
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('replaces edited/deleted copies but keeps the known sender', () => {
    const sender = { id: OTHER, full_name: 'Bela Rao', avatar_url: null }
    const a = msg('a', '2026-10-08T10:00:00Z', { sender })
    const edited = msg('a', '2026-10-08T10:00:00Z', { body: 'fixed', edited_at: '2026-10-08T10:02:00Z' })
    const [out] = mergeMessages([a], [edited])
    expect(out?.body).toBe('fixed')
    expect(out?.sender).toEqual(sender)
  })

  it('borrows a sender from another message of the same person (realtime rows have no join)', () => {
    const sender = { id: OTHER, full_name: 'Bela Rao', avatar_url: null }
    const out = mergeMessages([msg('a', '2026-10-08T10:00:00Z', { sender })], [msg('b', '2026-10-08T10:01:00Z')])
    expect(out[1]?.sender).toEqual(sender)
  })

  it('keeps unsent messages at the bottom and retires the optimistic copy once the real one arrives', () => {
    const local = msg('local-1', '2026-10-08T10:05:00Z', { sender_id: ME, body: 'hello', pending: true })
    const failed = msg('local-2', '2026-10-08T09:00:00Z', { sender_id: ME, body: 'oops', failed: true })
    const older = msg('x', '2026-10-08T10:06:00Z')
    let out = mergeMessages([local, failed], [older], ME)
    expect(out.map((m) => m.id)).toEqual(['x', 'local-2', 'local-1'])
    out = mergeMessages(out, [msg('real', '2026-10-08T10:07:00Z', { sender_id: ME, body: 'hello' })], ME)
    expect(out.map((m) => m.id)).toEqual(['x', 'real', 'local-2'])
  })

  it('retires only one optimistic copy when the same text was sent twice', () => {
    const l1 = msg('local-1', '2026-10-08T10:05:00Z', { sender_id: ME, body: 'ok', pending: true })
    const l2 = msg('local-2', '2026-10-08T10:05:01Z', { sender_id: ME, body: 'ok', pending: true })
    const out = mergeMessages([l1, l2], [msg('r1', '2026-10-08T10:05:02Z', { sender_id: ME, body: 'ok' })], ME)
    expect(out.filter((m) => m.pending)).toHaveLength(1)
    expect(out).toHaveLength(2)
  })
})

describe('helpers', () => {
  it('finds the first unread message from someone else', () => {
    const items = [
      msg('a', '2026-10-08T10:00:00Z'),
      msg('b', '2026-10-08T10:01:00Z', { sender_id: ME }),
      msg('c', '2026-10-08T10:02:00Z'),
    ]
    expect(firstUnreadIndex(items, '2026-10-08T10:00:30Z', ME)).toBe(2)
    expect(firstUnreadIndex(items, null, ME)).toBe(-1)
    expect(firstUnreadIndex(items, '2026-10-08T11:00:00Z', ME)).toBe(-1)
  })

  it('groups consecutive messages within 5 minutes from the same sender', () => {
    const a = msg('a', '2026-10-08T10:00:00Z')
    expect(isContinuation(a, msg('b', '2026-10-08T10:04:00Z'))).toBe(true)
    expect(isContinuation(a, msg('b', '2026-10-08T10:06:00Z'))).toBe(false)
    expect(isContinuation(a, msg('b', '2026-10-08T10:01:00Z', { sender_id: ME }))).toBe(false)
    expect(isContinuation(undefined, a)).toBe(false)
  })

  it('previews every kind', () => {
    expect(previewOf({ kind: 'image', body: null, attachments: [], poll: null, deleted_at: null })).toBe('📷 Photo')
    expect(previewOf({ kind: 'file', body: null, attachments: [{ path: 'p', name: 'a.pdf' }], poll: null, deleted_at: null })).toBe('📄 a.pdf')
    expect(previewOf({ kind: 'poll', body: null, attachments: [], poll: { question: 'When?', options: ['a', 'b'] }, deleted_at: null })).toBe('📊 When?')
    expect(previewOf({ kind: 'text', body: 'hi', attachments: [], poll: null, deleted_at: '2026-10-08T10:00:00Z' })).toBe('This message was deleted')
  })

  it('detects unknown senders', () => {
    expect(hasUnknownSender([], msg('a', '2026-10-08T10:00:00Z'))).toBe(true)
    expect(hasUnknownSender([msg('z', '2026-10-08T09:00:00Z', { sender: { id: OTHER, full_name: 'B', avatar_url: null } })], msg('a', '2026-10-08T10:00:00Z'))).toBe(false)
  })
})

describe('reactions', () => {
  it('groups by emoji, most popular first, and flags mine', async () => {
    const { groupReactions } = await import('./merge')
    const g = groupReactions(
      [
        { user_id: 'a', emoji: '👍' },
        { user_id: ME, emoji: '❤️' },
        { user_id: 'b', emoji: '❤️' },
      ],
      ME,
    )
    expect(g).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '👍', count: 1, mine: false },
    ])
  })
  it('toggles and replaces my reaction', async () => {
    const { applyMyReaction } = await import('./merge')
    const base = [{ user_id: 'a', emoji: '👍' }]
    expect(applyMyReaction(base, ME, '❤️')).toEqual([...base, { user_id: ME, emoji: '❤️' }])
    expect(applyMyReaction([...base, { user_id: ME, emoji: '❤️' }], ME, '😂')).toEqual([...base, { user_id: ME, emoji: '😂' }])
    expect(applyMyReaction([...base, { user_id: ME, emoji: '❤️' }], ME, null)).toEqual(base)
  })
  it('keeps reactions and reply previews when a live row (without joins) updates a message', () => {
    const withExtras = msg('a', '2026-10-08T10:00:00Z', { reactions: [{ user_id: 'x', emoji: '👍' }], reply: null })
    const [out] = mergeMessages([withExtras], [msg('a', '2026-10-08T10:00:00Z', { body: 'edited' })])
    expect(out?.reactions).toHaveLength(1)
    const [gone] = mergeMessages([withExtras], [msg('a', '2026-10-08T10:00:00Z', { deleted_at: '2026-10-08T10:01:00Z' })])
    expect(gone?.reactions).toHaveLength(0)
  })
})

describe('polls and voice', () => {
  it('tallies votes and my selection', async () => {
    const { pollTally } = await import('./merge')
    const t = pollTally({ question: 'q', options: ['a', 'b', 'c'] }, [
      { user_id: ME, option_index: 1 },
      { user_id: 'x', option_index: 1 },
      { user_id: 'y', option_index: 0 },
      { user_id: 'z', option_index: 9 },
    ], ME)
    expect(t).toEqual({ counts: [1, 2, 0], voters: 3, mine: [1] })
  })
  it('single choice replaces/clears, multiple toggles', async () => {
    const { nextSelection } = await import('./merge')
    const single = { question: 'q', options: ['a', 'b'] }
    expect(nextSelection(single, [0], 1)).toEqual([1])
    expect(nextSelection(single, [1], 1)).toEqual([])
    const multi = { question: 'q', options: ['a', 'b', 'c'], multiple: true }
    expect(nextSelection(multi, [2], 0)).toEqual([0, 2])
    expect(nextSelection(multi, [0, 2], 2)).toEqual([0])
  })
  it('formats durations', async () => {
    const { formatDuration } = await import('./merge')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(723)).toBe('12:03')
    expect(formatDuration(undefined)).toBe('0:00')
  })
})
