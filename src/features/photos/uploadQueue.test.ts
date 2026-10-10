import { describe, expect, it } from 'vitest'
import { UploadQueue } from './uploadQueue'

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `f${i}.jpg`, size: 10, payload: i }))
const settle = async (q: UploadQueue<number>) => {
  for (let i = 0; i < 200 && !q.idle; i++) await new Promise((r) => setTimeout(r, 1))
}

describe('UploadQueue', () => {
  it('never runs more than the concurrency limit at once and finishes everything', async () => {
    let now = 0
    let peak = 0
    const q = new UploadQueue<number>({
      concurrency: 3,
      run: async () => {
        now++
        peak = Math.max(peak, now)
        await new Promise((r) => setTimeout(r, 2))
        now--
        return 'done'
      },
    })
    q.add(items(25))
    await settle(q)
    expect(peak).toBe(3)
    expect(q.stats).toMatchObject({ done: 25, failed: 0, total: 25 })
  })

  it('retries network trouble by itself, waits for the connection, and then succeeds', async () => {
    const calls: Record<string, number> = {}
    let waited = 0
    const q = new UploadQueue<number>({
      concurrency: 2,
      sleep: () => Promise.resolve(),
      online: async () => void waited++,
      run: async (it) => {
        calls[it.key] = (calls[it.key] ?? 0) + 1
        if (it.payload === 1 && calls[it.key]! < 3) throw new Error('Failed to fetch')
        return 'done'
      },
    })
    q.add(items(3))
    await settle(q)
    expect(calls.k1).toBe(3)
    expect(waited).toBe(2)
    expect(q.stats.done).toBe(3)
  })

  it('stops after the attempts, keeps the error, and a manual retry works', async () => {
    let fail = true
    const q = new UploadQueue<number>({
      concurrency: 1,
      maxAttempts: 2,
      sleep: () => Promise.resolve(),
      run: async () => {
        if (fail) throw new Error('boom')
        return 'done'
      },
    })
    q.add(items(1))
    await settle(q)
    expect(q.items[0]).toMatchObject({ state: 'failed', error: 'boom', attempts: 2 })
    fail = false
    q.retry('k0')
    await settle(q)
    expect(q.items[0]!.state).toBe('done')
  })

  it('does not retry errors that cannot get better, and reports duplicates', async () => {
    let tries = 0
    const q = new UploadQueue<number>({
      concurrency: 2,
      isRetryable: (e) => !(e instanceof RangeError),
      run: async (it) => {
        if (it.payload === 0) {
          tries++
          throw new RangeError('too big')
        }
        return 'duplicate'
      },
    })
    q.add(items(2))
    await settle(q)
    expect(tries).toBe(1)
    expect(q.stats).toMatchObject({ failed: 1, duplicate: 1 })
  })

  it('pausing holds the queue until resumed', async () => {
    const q = new UploadQueue<number>({ concurrency: 1, run: async () => 'done' })
    q.setPaused(true)
    q.add(items(2))
    await new Promise((r) => setTimeout(r, 5))
    expect(q.stats.queued).toBe(2)
    q.setPaused(false)
    await settle(q)
    expect(q.stats.done).toBe(2)
  })
})
