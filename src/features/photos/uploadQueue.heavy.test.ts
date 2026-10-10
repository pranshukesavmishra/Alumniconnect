import { describe, expect, it } from 'vitest'
import { UploadQueue } from './uploadQueue'

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `f${i}.mp4`, size: 10, payload: i }))
const settle = async (q: UploadQueue<number>) => {
  for (let i = 0; i < 300 && !q.idle; i++) await new Promise((r) => setTimeout(r, 1))
}

describe('UploadQueue: big files (videos)', () => {
  it('runs at most one heavy file at a time while photos use the other slots', async () => {
    let heavyNow = 0
    let heavyPeak = 0
    let photosDuringHeavy = 0
    const q = new UploadQueue<number>({
      concurrency: 3,
      isHeavy: (it) => it.payload % 2 === 0,
      maxHeavy: 1,
      run: async (it) => {
        const heavy = it.payload % 2 === 0
        if (heavy) {
          heavyNow++
          heavyPeak = Math.max(heavyPeak, heavyNow)
        } else if (heavyNow > 0) photosDuringHeavy++
        await new Promise((r) => setTimeout(r, 4))
        if (heavy) heavyNow--
        return 'done'
      },
    })
    q.add(items(10))
    await settle(q)
    expect(heavyPeak).toBe(1)
    expect(photosDuringHeavy).toBeGreaterThan(0)
    expect(q.stats.done).toBe(10)
  })

  it('reports progress (clamped), clears it when done, and can drop a waiting file', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const q = new UploadQueue<number>({
      concurrency: 1,
      run: async (_it, _stage, setProgress) => {
        setProgress(25)
        setProgress(25)
        setProgress(180)
        await gate
        return 'done'
      },
    })
    q.add(items(2))
    await new Promise((r) => setTimeout(r, 5))
    expect(q.items[0]!.progress).toBe(100)
    q.remove('k1')
    expect(q.items.map((i) => i.key)).toEqual(['k0'])
    release()
    await settle(q)
    expect(q.items[0]!.progress).toBeUndefined()
    expect(q.items[0]!.state).toBe('done')
  })

  it('never retries a cancelled file', async () => {
    let n = 0
    const q = new UploadQueue<number>({
      concurrency: 1,
      isRetryable: (e) => (e as Error).name !== 'AbortError',
      sleep: () => Promise.resolve(),
      run: async () => {
        n++
        const e = new Error('Cancelled')
        e.name = 'AbortError'
        throw e
      },
    })
    q.add(items(1))
    await settle(q)
    expect(n).toBe(1)
    expect(q.items[0]).toMatchObject({ state: 'failed', error: 'Cancelled' })
  })
})
