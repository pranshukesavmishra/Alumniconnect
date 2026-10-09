// Standalone fake Google for the REAL local edge runtime (supabase/functions/.env points
// GOOGLE_*_URL at http://host.docker.internal:4545). Accepts the client id/secret/refresh token
// found in supabase/functions/.env. GET /__state returns the fake Drive's files (no contents).
//   deno run -A e2e/verify/drive-fake-google-server.ts
import { CLIENT, FakeGoogle } from './drive-fake-google.ts'

const env = Object.fromEntries(
  (await Deno.readTextFile(new URL('../../supabase/functions/.env', import.meta.url)))
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
)
CLIENT.id = env.GOOGLE_CLIENT_ID
CLIENT.secret = env.GOOGLE_CLIENT_SECRET
CLIENT.refresh = env.GOOGLE_DRIVE_REFRESH_TOKEN

const g = new FakeGoogle()
const port = Number(Deno.env.get('FAKE_GOOGLE_PORT') ?? 4545)
g.base = `http://127.0.0.1:${port}` // Location handed to the browser must be reachable from the host
Deno.serve({ port, hostname: '0.0.0.0' }, (req) => {
  const u = new URL(req.url)
  if (u.pathname === '/__state') {
    return Response.json({
      tokenCalls: g.tokenCalls,
      files: [...g.files.values()].map((f) => ({ ...f, content: undefined, size: f.content?.length ?? 0 })),
      log: g.log.map((l) => ({ method: l.method, path: l.path, origin: l.headers.origin ?? null })),
    })
  }
  return g.handle(req)
})
