import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Runs public/push-sw.js against a fake service-worker global and drives its push / notificationclick handlers.
function loadWorker(windows: { url: string; focus: () => Promise<unknown>; navigate: (u: string) => Promise<unknown> }[] = []) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const self = {
    location: { origin: 'https://alumni.example.org' },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: { matchAll: vi.fn(() => Promise.resolve(windows)), openWindow: vi.fn(() => Promise.resolve(null)) },
  }
  new Function('self', readFileSync('public/push-sw.js', 'utf8'))(self)
  return { self, handlers }
}

function fire(handler: (e: unknown) => void, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve()
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) })
  return pending
}

describe('push service worker', () => {
  it('shows the notification with the app icon, grouping by chat', async () => {
    const { self, handlers } = loadWorker()
    await fire(handlers.push!, { data: { json: () => ({ title: 'Asha Rao', body: 'See you at JEC!', url: '/chat/1', tag: 'chat:1' }) } })
    expect(self.registration.showNotification).toHaveBeenCalledWith('Asha Rao', expect.objectContaining({ body: 'See you at JEC!', icon: '/pwa-192.png', tag: 'chat:1', renotify: true, data: { url: '/chat/1' } }))
  })

  it('falls back to plain text and a default title', async () => {
    const { self, handlers } = loadWorker()
    await fire(handlers.push!, { data: { json: () => { throw new Error('not json') }, text: () => 'hello' } })
    expect(self.registration.showNotification).toHaveBeenCalledWith('JEC Alumni Connect', expect.objectContaining({ body: 'hello', data: { url: '/' } }))
  })

  it('tap: focuses the open app and goes to the chat', async () => {
    const win = { url: 'https://alumni.example.org/groups', focus: vi.fn(() => Promise.resolve(win)), navigate: vi.fn(() => Promise.resolve(null)) }
    const { self, handlers } = loadWorker([win])
    const close = vi.fn()
    await fire(handlers.notificationclick!, { notification: { close, data: { url: '/chat/42' } } })
    expect(close).toHaveBeenCalled()
    expect(win.navigate).toHaveBeenCalledWith('https://alumni.example.org/chat/42')
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('tap with the app closed: opens it on the right screen', async () => {
    const { self, handlers } = loadWorker([])
    await fire(handlers.notificationclick!, { notification: { close: vi.fn(), data: { url: '/me/connections' } } })
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://alumni.example.org/me/connections')
  })

  it('never opens another website from a notification', async () => {
    const { self, handlers } = loadWorker([])
    await fire(handlers.notificationclick!, { notification: { close: vi.fn(), data: { url: 'https://evil.example.com/' } } })
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })
})
