// A tiny ZIP writer (no compression: photos are already compressed). Entries are appended one at a time and the pieces are kept
// as Blob parts, so a whole event's photos never sit in memory as one big array. Used for the admin "Download all photos".

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

/** File names inside the archive: no folders going up, no odd characters. */
export function safeZipName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file'
}

export class ZipBuilder {
  private parts: BlobPart[] = []
  private central: Uint8Array[] = []
  private offset = 0
  private names = new Set<string>()
  count = 0

  add(name: string, data: Uint8Array, when = new Date()) {
    let n = safeZipName(name)
    for (let i = 2; this.names.has(n); i++) n = n.replace(/(\.[^.]*)?$/, ` (${i})$1`)
    this.names.add(n)
    const nameBytes = new TextEncoder().encode(n)
    const crc = crc32(data)
    const { time, date } = dosDateTime(when)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    this.parts.push(local.buffer, nameBytes as BlobPart, data as BlobPart)

    const c = new DataView(new ArrayBuffer(46 + nameBytes.length))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, nameBytes.length, true)
    c.setUint32(42, this.offset, true)
    new Uint8Array(c.buffer).set(nameBytes, 46)
    this.central.push(new Uint8Array(c.buffer))
    this.offset += 30 + nameBytes.length + data.length
    this.count++
  }

  finish(): Blob {
    const size = this.central.reduce((s, c) => s + c.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.count, true)
    end.setUint16(10, this.count, true)
    end.setUint32(12, size, true)
    end.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...this.central.map((c) => c as BlobPart), end.buffer], { type: 'application/zip' })
  }
}
