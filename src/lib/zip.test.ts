import { describe, expect, it } from 'vitest'
import { crc32, safeZipName, ZipBuilder } from './zip'

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('cleans file names', () => {
    expect(safeZipName('../../etc/passwd')).toBe('.._.._etc_passwd'.replace(/^\.+/, '_'))
    expect(safeZipName('a:b*c?.jpg')).toBe('a_b_c_.jpg')
    expect(safeZipName('')).toBe('file')
  })

  it('writes a readable archive with local headers, a central directory and the end record', async () => {
    const z = new ZipBuilder()
    z.add('one.txt', new TextEncoder().encode('hello'))
    z.add('two.txt', new TextEncoder().encode('world!!'))
    z.add('one.txt', new TextEncoder().encode('again')) // same name: renamed, not overwritten
    const bytes = new Uint8Array(await z.finish().arrayBuffer())
    const v = new DataView(bytes.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = bytes.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(3)
    // walk the central directory and read the names back
    let p = v.getUint32(end + 16, true)
    const names: string[] = []
    for (let i = 0; i < 3; i++) {
      expect(v.getUint32(p, true)).toBe(0x02014b50)
      const len = v.getUint16(p + 28, true)
      const off = v.getUint32(p + 42, true)
      names.push(new TextDecoder().decode(bytes.slice(p + 46, p + 46 + len)))
      expect(v.getUint32(off, true)).toBe(0x04034b50) // the offset points at a local header
      p += 46 + len
    }
    expect(names).toEqual(['one.txt', 'two.txt', 'one (2).txt'])
    // stored data is right after the first header
    expect(new TextDecoder().decode(bytes.slice(30 + 7, 30 + 7 + 5))).toBe('hello')
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello')))
  })
})
