import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, UploadAborted, UploadRefused, chunkPlan, nextOffset, resumableUpload, type ChunkResponse, type ChunkTransport } from './driveUpload'

const KB = 1024
const file = (n: number) => new Blob([new Uint8Array(n)])

/** A fake Google: keeps what arrived, answers 308 with a Range (or without, if `hideRange`), 200 with the file id at the end. */
function fakeDrive(total: number, o: { hideRange?: boolean; failFirst?: number; status?: number } = {}) {
  let received = 0
  let failures = o.failFirst ?? 0
  const calls: { range: string; size: number }[] = []
  const transport: ChunkTransport = {
    async put(_url, body, headers, onProgress, signal): Promise<ChunkResponse> {
      if (signal.aborted) throw new UploadAborted()
      const cr = headers['Content-Range']!
      calls.push({ range: cr, size: body.size })
      const ask = /^bytes \*\//.test(cr)
      if (!ask && failures > 0) {
        failures--
        throw new TypeError('Network error')
      }
      if (o.status && !ask) return { status: o.status, range: null, body: '' }
      if (!ask) {
        const [a] = cr.replace('bytes ', '').split('-')
        if (Number(a) !== received) return { status: 400, range: null, body: 'wrong offset' }
        received += body.size
        onProgress(body.size)
      }
      if (received >= total) return { status: 200, range: null, body: JSON.stringify({ id: 'DRIVEFILE123' }) }
      return { status: 308, range: o.hideRange || received === 0 ? null : `bytes=0-${received - 1}`, body: '' }
    },
  }
  return { transport, calls, get received() { return received } }
}

describe('resumable upload helpers', () => {
  it('reads the next offset from a Range header', () => {
    expect(nextOffset('bytes=0-8388607')).toBe(8388608)
    expect(nextOffset(null)).toBeNull()
    expect(nextOffset('nonsense')).toBeNull()
  })
  it('plans chunks that are multiples of 256 KiB and end at the file end', () => {
    expect(CHUNK_BYTES % (256 * KB)).toBe(0)
    expect(chunkPlan(20 * 1024 * KB, 0)).toEqual({ start: 0, end: CHUNK_BYTES - 1 })
    expect(chunkPlan(10, 0)).toEqual({ start: 0, end: 9 })
    expect(chunkPlan(CHUNK_BYTES + 5, CHUNK_BYTES)).toEqual({ start: CHUNK_BYTES, end: CHUNK_BYTES + 4 })
  })
})

describe('resumableUpload', () => {
  const noSleep = () => Promise.resolve()

  it('sends the file in chunks and returns the Drive id', async () => {
    const size = 5 * 256 * KB + 100
    const d = fakeDrive(size)
    const seen: number[] = []
    const r = await resumableUpload({ url: 'u', file: file(size), mime: 'video/mp4', transport: d.transport, chunk: 2 * 256 * KB, sleep: noSleep, onProgress: (s) => seen.push(s) })
    expect(r.fileId).toBe('DRIVEFILE123')
    expect(d.calls.map((c) => c.range)).toEqual([
      `bytes 0-${512 * KB - 1}/${size}`,
      `bytes ${512 * KB}-${1024 * KB - 1}/${size}`,
      `bytes ${1024 * KB}-${size - 1}/${size}`,
    ])
    expect(seen.at(-1)).toBe(size)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('works when the browser cannot read the Range header (assumes each chunk arrived whole)', async () => {
    const size = 3 * 256 * KB
    const d = fakeDrive(size, { hideRange: true })
    const r = await resumableUpload({ url: 'u', file: file(size), mime: 'video/webm', transport: d.transport, chunk: 256 * KB, sleep: noSleep })
    expect(r.fileId).toBe('DRIVEFILE123')
    expect(d.calls).toHaveLength(3)
  })

  it('retries a dropped chunk after asking Drive where it is, and carries on', async () => {
    const size = 4 * 256 * KB
    const d = fakeDrive(size, { failFirst: 2 })
    const r = await resumableUpload({ url: 'u', file: file(size), mime: 'video/mp4', transport: d.transport, chunk: 256 * KB, sleep: noSleep })
    expect(r.fileId).toBe('DRIVEFILE123')
    expect(d.calls.filter((c) => c.range.startsWith('bytes */'))).toHaveLength(2)
    expect(d.received).toBe(size)
  })

  it('gives up after too many failures in a row', async () => {
    const d = fakeDrive(512 * KB, { failFirst: 99 })
    await expect(resumableUpload({ url: 'u', file: file(512 * KB), mime: 'video/mp4', transport: d.transport, chunk: 256 * KB, sleep: noSleep, retries: 2 })).rejects.toThrow('Network error')
  })

  it('stops at once with a clear error for a hard refusal (no retries)', async () => {
    const d = fakeDrive(512 * KB, { status: 403 })
    await expect(resumableUpload({ url: 'u', file: file(512 * KB), mime: 'video/mp4', transport: d.transport, chunk: 256 * KB, sleep: noSleep })).rejects.toBeInstanceOf(UploadRefused)
    expect(d.calls).toHaveLength(1)
  })

  it('retries server errors (5xx) but not client errors', async () => {
    let n = 0
    const t: ChunkTransport = {
      async put(_u, body, h) {
        if (/^bytes \*\//.test(h['Content-Range']!)) return { status: 308, range: null, body: '' }
        n++
        return n < 3 ? { status: 503, range: null, body: '' } : { status: 200, range: null, body: JSON.stringify({ id: 'OKFILE12345' }) }
      },
    }
    const r = await resumableUpload({ url: 'u', file: file(100), mime: 'video/mp4', transport: t, sleep: noSleep })
    expect(r.fileId).toBe('OKFILE12345')
    expect(n).toBe(3)
  })

  it('cancels', async () => {
    const ctl = new AbortController()
    const d = fakeDrive(4 * 256 * KB)
    const t: ChunkTransport = {
      async put(u, b, h, p, s) {
        const r = await d.transport.put(u, b, h, p, s)
        ctl.abort()
        return r
      },
    }
    await expect(resumableUpload({ url: 'u', file: file(4 * 256 * KB), mime: 'video/mp4', transport: t, chunk: 256 * KB, signal: ctl.signal, sleep: noSleep })).rejects.toBeInstanceOf(UploadAborted)
    expect(d.received).toBeLessThan(4 * 256 * KB)
  })

  it('resumes from where an earlier attempt stopped, and takes the answer if Drive already has the whole file', async () => {
    const size = 4 * 256 * KB
    const d = fakeDrive(size)
    // the first 2 chunks are already at Drive
    await resumableUpload({ url: 'u', file: file(512 * KB), mime: 'video/mp4', transport: fakeDrive(512 * KB).transport, chunk: 256 * KB, sleep: noSleep })
    const half = fakeDrive(size)
    await half.transport.put('u', file(512 * KB), { 'Content-Range': `bytes 0-${512 * KB - 1}/${size}` }, () => {}, new AbortController().signal)
    const r = await resumableUpload({ url: 'u', file: file(size), mime: 'video/mp4', transport: half.transport, chunk: 256 * KB, sleep: noSleep, resumeFrom: 512 * KB })
    expect(r.fileId).toBe('DRIVEFILE123')
    expect(half.calls.map((c) => c.range).slice(1)[0]).toBe(`bytes */${size}`)
    expect(d.calls).toHaveLength(0)
    const done = fakeDrive(256 * KB)
    await done.transport.put('u', file(256 * KB), { 'Content-Range': `bytes 0-${256 * KB - 1}/${256 * KB}` }, () => {}, new AbortController().signal)
    const again = await resumableUpload({ url: 'u', file: file(256 * KB), mime: 'video/mp4', transport: done.transport, sleep: noSleep, resumeFrom: 256 * KB })
    expect(again.fileId).toBe('DRIVEFILE123')
  })
})
