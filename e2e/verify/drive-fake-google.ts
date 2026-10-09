// Fake Google OAuth + Drive v3 server for verifying supabase/functions/{drive-upload,nightly-backup}
// without real Google credentials. Run under Deno (see drive-functions.deno.ts).
// It is deliberately STRICT: it rejects requests that the real Drive API would reject (bad auth,
// malformed q syntax, missing upload headers, wrong content length), so passing tests mean the
// function code speaks the protocol correctly, not just that it ran.

export interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  appProperties: Record<string, string>
  description?: string
  content?: Uint8Array
  trashed: boolean
  ownedByApp: boolean // drive.file: the app only sees files it created
}

interface Session {
  meta: { name: string; parents: string[]; description?: string; appProperties?: Record<string, string> }
  contentType: string
  contentLength: number
  origin: string | null
  fields: string | null
  used: boolean
}

export const CLIENT = { id: 'fake-client-id.apps.googleusercontent.com', secret: 'fake-secret', refresh: 'fake-refresh-token' }

export class FakeGoogle {
  files = new Map<string, FakeFile>()
  sessions = new Map<string, Session>()
  tokenCalls = 0
  log: { method: string; path: string; headers: Record<string, string>; body?: string }[] = []
  validTokens = new Set<string>()
  server!: Deno.HttpServer
  base = ''
  private n = 0

  newId(prefix = 'f'): string {
    this.n++
    return `${prefix}${String(this.n).padStart(4, '0')}${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  }

  start(port: number) {
    this.base = `http://127.0.0.1:${port}`
    this.server = Deno.serve({ port, hostname: '127.0.0.1', onListen() {} }, (req) => this.handle(req))
    return this
  }

  async stop() {
    await this.server.shutdown()
  }

  private err(status: number, message: string, extra: Record<string, string> = {}) {
    return new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { 'Content-Type': 'application/json', ...extra } })
  }

  private authed(req: Request): boolean {
    const a = req.headers.get('Authorization') ?? ''
    return a.startsWith('Bearer ') && this.validTokens.has(a.slice(7))
  }

  /** Strict subset of the Drive query language that the app uses. */
  parseQ(q: string): { name?: string; parent?: string; mimeType?: string; trashed?: boolean } {
    const out: { name?: string; parent?: string; mimeType?: string; trashed?: boolean } = {}
    let i = 0
    const ws = () => { while (q[i] === ' ') i++ }
    const str = (): string => {
      if (q[i] !== "'") throw new Error(`expected quote at ${i}`)
      i++
      let s = ''
      while (i < q.length && q[i] !== "'") {
        if (q[i] === '\\') {
          const nx = q[i + 1]
          if (nx !== "'" && nx !== '\\') throw new Error(`bad escape at ${i}`)
          s += nx
          i += 2
        } else s += q[i++]
      }
      if (q[i] !== "'") throw new Error('unterminated string')
      i++
      return s
    }
    const word = () => { const m = /^[A-Za-z]+/.exec(q.slice(i)); if (!m) throw new Error(`expected word at ${i}`); i += m[0].length; return m[0] }
    for (;;) {
      ws()
      if (q[i] === "'") {
        const v = str(); ws()
        if (word() !== 'in') throw new Error('expected in'); ws()
        if (word() !== 'parents') throw new Error('expected parents')
        out.parent = v
      } else {
        const field = word(); ws()
        if (q[i] !== '=') throw new Error('expected =')
        i++; ws()
        if (field === 'trashed') out.trashed = word() === 'true'
        else if (field === 'name') out.name = str()
        else if (field === 'mimeType') out.mimeType = str()
        else throw new Error(`unknown field ${field}`)
      }
      ws()
      if (i >= q.length) break
      if (word() !== 'and') throw new Error('expected and')
    }
    return out
  }

  private visible(id: string): FakeFile | undefined {
    const f = this.files.get(id)
    return f && f.ownedByApp ? f : undefined
  }

  private project(f: FakeFile, fields: string | null) {
    const all: Record<string, unknown> = { kind: 'drive#file', id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, description: f.description }
    if (!fields) return { kind: 'drive#file', id: f.id, name: f.name, mimeType: f.mimeType }
    const o: Record<string, unknown> = {}
    for (const k of fields.split(',').map((s) => s.trim())) if (k in all && all[k] !== undefined && !(k === 'appProperties' && !Object.keys(f.appProperties).length)) o[k] = all[k]
    return o
  }

  private cors(origin: string | null): Record<string, string> {
    return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Type, Location' } : {}
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => { headers[k] = v })
    const raw = req.method === 'GET' || req.method === 'OPTIONS' ? undefined : new Uint8Array(await req.arrayBuffer())
    const text = raw ? new TextDecoder().decode(raw) : undefined
    this.log.push({ method: req.method, path: path + url.search, headers, body: text && text.length < 20000 ? text : text?.slice(0, 200) })

    // ---------------------------------------------------------------- OAuth token endpoint
    if (path === '/token' && req.method === 'POST') {
      this.tokenCalls++
      if (!(req.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) return this.err(400, 'bad content type')
      const p = new URLSearchParams(text)
      if (p.get('grant_type') !== 'refresh_token') return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
      if (p.get('client_id') !== CLIENT.id || p.get('client_secret') !== CLIENT.secret) return Response.json({ error: 'invalid_client' }, { status: 401 })
      if (p.get('refresh_token') !== CLIENT.refresh) return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })
      const t = `ya29.fake-${crypto.randomUUID()}`
      this.validTokens.add(t)
      return Response.json({ access_token: t, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' })
    }

    // ---------------------------------------------------------------- browser PUT to the resumable session URI
    const sm = /^\/upload-session\/([a-z0-9-]+)$/.exec(path)
    if (sm) {
      const s = this.sessions.get(sm[1]!)
      if (!s) return this.err(404, 'session not found')
      const origin = req.headers.get('Origin')
      if (req.method === 'OPTIONS') {
        // Emulates Google: CORS allowed only for the Origin given when the session was started.
        if (!origin || origin !== s.origin) return new Response(null, { status: 403 })
        return new Response(null, { status: 200, headers: { ...this.cors(s.origin), 'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, content-range' } })
      }
      if (req.method !== 'PUT') return this.err(405, 'PUT only')
      if (s.used) return this.err(400, 'session already completed')
      const len = raw?.length ?? 0
      if (len !== s.contentLength) return this.err(400, `Content length ${len} does not match X-Upload-Content-Length ${s.contentLength}`, this.cors(s.origin))
      s.used = true
      const id = this.newId('up')
      const f: FakeFile = { id, name: s.meta.name, mimeType: s.contentType, parents: s.meta.parents, appProperties: s.meta.appProperties ?? {}, description: s.meta.description, content: raw, trashed: false, ownedByApp: true }
      this.files.set(id, f)
      return Response.json(this.project(f, s.fields), { headers: this.cors(s.origin) })
    }

    if (!this.authed(req)) return this.err(401, 'Request had invalid authentication credentials.')

    // ---------------------------------------------------------------- uploads
    if (path === '/upload/drive/v3/files' && req.method === 'POST') {
      const type = url.searchParams.get('uploadType')
      if (type === 'resumable') {
        const ct = req.headers.get('X-Upload-Content-Type')
        const cl = Number(req.headers.get('X-Upload-Content-Length'))
        if (!ct || !Number.isFinite(cl) || cl <= 0) return this.err(400, 'missing X-Upload headers')
        if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return this.err(400, 'metadata must be JSON')
        const meta = JSON.parse(text || '{}')
        for (const p of meta.parents ?? []) if (!this.visible(p)) return this.err(404, `File not found: ${p}.`)
        for (const [k, v] of Object.entries(meta.appProperties ?? {})) if (typeof v !== 'string' || (k.length + String(v).length) > 124) return this.err(400, 'bad appProperties')
        const sid = crypto.randomUUID()
        this.sessions.set(sid, { meta, contentType: ct, contentLength: cl, origin: req.headers.get('Origin'), fields: url.searchParams.get('fields'), used: false })
        return new Response(null, { status: 200, headers: { Location: `${this.base}/upload-session/${sid}?upload_id=${sid}` } })
      }
      if (type === 'multipart') {
        const m = /^multipart\/related; boundary=(.+)$/.exec(req.headers.get('content-type') ?? '')
        if (!m) return this.err(400, 'bad multipart content-type')
        const b = m[1]!
        const parts = text!.split(`--${b}`)
        if (parts.at(-1)!.trim() !== '--') return this.err(400, 'missing closing boundary')
        const body = parts.slice(1, -1).map((p) => {
          const [h, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n')
          return { headers: h!, content: rest.join('\r\n\r\n').replace(/\r\n$/, '') }
        })
        if (body.length !== 2) return this.err(400, `expected 2 parts, got ${body.length}`)
        const meta = JSON.parse(body[0]!.content)
        const ctype = /Content-Type: (.+)/i.exec(body[1]!.headers)?.[1]?.trim() ?? 'application/octet-stream'
        for (const p of meta.parents ?? []) if (!this.visible(p)) return this.err(404, `File not found: ${p}.`)
        const id = this.newId('csv')
        const f: FakeFile = { id, name: meta.name, mimeType: meta.mimeType ?? ctype, parents: meta.parents ?? [], appProperties: meta.appProperties ?? {}, content: new TextEncoder().encode(body[1]!.content), trashed: false, ownedByApp: true }
        this.files.set(id, f)
        return Response.json(this.project(f, url.searchParams.get('fields')))
      }
      return this.err(400, 'bad uploadType')
    }

    // ---------------------------------------------------------------- metadata API
    if (path === '/drive/v3/files' && req.method === 'POST') {
      if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return this.err(400, 'metadata must be JSON')
      const meta = JSON.parse(text || '{}')
      for (const p of meta.parents ?? []) if (!this.visible(p)) return this.err(404, `File not found: ${p}.`)
      const id = this.newId('fold')
      const f: FakeFile = { id, name: meta.name ?? 'Untitled', mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? ['root-of-my-drive'], appProperties: meta.appProperties ?? {}, trashed: false, ownedByApp: true }
      this.files.set(id, f)
      return Response.json(this.project(f, url.searchParams.get('fields')))
    }
    if (path === '/drive/v3/files' && req.method === 'GET') {
      let crit
      try {
        crit = this.parseQ(url.searchParams.get('q') ?? '')
      } catch (e) {
        return this.err(400, `Invalid Value: q (${(e as Error).message})`)
      }
      const res = [...this.files.values()].filter((f) => f.ownedByApp
        && (crit.name === undefined || f.name === crit.name)
        && (crit.parent === undefined || f.parents.includes(crit.parent))
        && (crit.mimeType === undefined || f.mimeType === crit.mimeType)
        && (crit.trashed === undefined || f.trashed === crit.trashed))
      const fields = url.searchParams.get('fields')
      const inner = fields && /^files\((.+)\)$/.exec(fields)?.[1]
      return Response.json({ files: res.map((f) => this.project(f, inner || 'id')) })
    }
    const fm = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (fm && req.method === 'GET') {
      const f = this.visible(decodeURIComponent(fm[1]!))
      if (!f) return this.err(404, `File not found: ${fm[1]}.`)
      return Response.json(this.project(f, url.searchParams.get('fields')))
    }
    return this.err(404, `no fake route ${req.method} ${path}`)
  }

  csvFiles() {
    return [...this.files.values()].filter((f) => f.mimeType === 'text/csv')
  }
}

/** RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF/LF inside quotes). */
export function parseCsv(s: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let quoted = false
  while (i < s.length) {
    const c = s[i]!
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cell += c; i++; continue
    }
    if (c === '"') { quoted = true; i++; continue }
    if (c === ',') { row.push(cell); cell = ''; i++; continue }
    if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
    cell += c; i++
  }
  row.push(cell)
  rows.push(row)
  return rows
}
