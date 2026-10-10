// A small, UI-free upload queue for bulk photo uploads: a limit on how many files are in flight, per-file state, automatic retries
// with backoff for network trouble (waiting for the connection to come back first), and manual retry for the rest.
// The work for one file is injected, so the queue is unit-tested without a browser or a server.

export type ItemState = 'queued' | 'working' | 'done' | 'duplicate' | 'failed'

export interface QueueItem<T> {
  key: string
  name: string
  size: number
  payload: T
  state: ItemState
  attempts: number
  error?: string
  /** a human step label while working, e.g. "Sending original" */
  stage?: string
}

export interface QueueOptions<T> {
  concurrency: number
  maxAttempts?: number
  /** resolves 'done' | 'duplicate'; throws on failure */
  run: (item: QueueItem<T>, setStage: (s: string) => void) => Promise<'done' | 'duplicate'>
  /** false = do not retry automatically (bad format, no permission, rate limit ...) */
  isRetryable?: (e: unknown) => boolean
  messageOf?: (e: unknown) => string
  sleep?: (ms: number) => Promise<void>
  online?: () => Promise<void>
  onChange?: (items: readonly QueueItem<T>[]) => void
}

export class UploadQueue<T> {
  items: QueueItem<T>[] = []
  private active = 0
  private paused = false
  private o: Required<Omit<QueueOptions<T>, 'onChange'>> & Pick<QueueOptions<T>, 'onChange'>

  constructor(o: QueueOptions<T>) {
    this.o = {
      maxAttempts: 4,
      isRetryable: () => true,
      messageOf: (e) => (e instanceof Error ? e.message : String(e)),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      online: () => Promise.resolve(),
      ...o,
    }
  }

  add(list: { key: string; name: string; size: number; payload: T }[]) {
    for (const l of list) this.items.push({ ...l, state: 'queued', attempts: 0 })
    this.emit()
    this.pump()
  }

  retry(key: string) {
    const it = this.items.find((i) => i.key === key)
    if (!it || it.state !== 'failed') return
    it.state = 'queued'
    it.error = undefined
    it.attempts = 0
    this.emit()
    this.pump()
  }

  retryFailed() {
    for (const it of this.items) if (it.state === 'failed') this.retry(it.key)
  }

  setPaused(p: boolean) {
    this.paused = p
    if (!p) this.pump()
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.state === 'queued' || i.state === 'working' || i.state === 'failed')
    this.emit()
  }

  get stats() {
    const c = { queued: 0, working: 0, done: 0, duplicate: 0, failed: 0, total: this.items.length }
    for (const i of this.items) c[i.state]++
    return c
  }

  get idle() {
    return this.active === 0 && !this.items.some((i) => i.state === 'queued' || i.state === 'working')
  }

  private emit() {
    this.o.onChange?.([...this.items])
  }

  private pump() {
    while (!this.paused && this.active < this.o.concurrency) {
      const next = this.items.find((i) => i.state === 'queued')
      if (!next) return
      next.state = 'working'
      this.active++
      this.emit()
      void this.work(next).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async work(it: QueueItem<T>) {
    for (;;) {
      it.attempts++
      try {
        it.state = 'working'
        it.stage = undefined
        const result = await this.o.run(it, (s) => {
          it.stage = s
          this.emit()
        })
        it.state = result
        it.error = undefined
        it.stage = undefined
        this.emit()
        return
      } catch (e) {
        if (this.o.isRetryable(e) && it.attempts < this.o.maxAttempts) {
          it.stage = 'retrying'
          this.emit()
          await this.o.sleep(Math.min(1000 * 3 ** (it.attempts - 1), 15_000))
          await this.o.online()
          continue
        }
        it.state = 'failed'
        it.error = this.o.messageOf(e)
        it.stage = undefined
        this.emit()
        return
      }
    }
  }
}
