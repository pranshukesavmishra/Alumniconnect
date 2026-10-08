// Google Drive access for the committee's own account (OAuth "drive.file" scope: the app can only
// see files it created, never the rest of the Drive). Configure with Supabase secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
// GOOGLE_OAUTH_URL / GOOGLE_API_URL / GOOGLE_UPLOAD_URL exist only so tests can point at a fake server.

const OAUTH = Deno.env.get('GOOGLE_OAUTH_URL') ?? 'https://oauth2.googleapis.com/token'
const API = Deno.env.get('GOOGLE_API_URL') ?? 'https://www.googleapis.com/drive/v3'
const UPLOAD = Deno.env.get('GOOGLE_UPLOAD_URL') ?? 'https://www.googleapis.com/upload/drive/v3'

export function driveConfigured(): boolean {
  return Boolean(Deno.env.get('GOOGLE_CLIENT_ID') && Deno.env.get('GOOGLE_CLIENT_SECRET') && Deno.env.get('GOOGLE_DRIVE_REFRESH_TOKEN'))
}

let cached: { token: string; expires: number } | null = null

export async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GOOGLE_DRIVE_REFRESH_TOKEN')!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status}). Re-authorise the Drive account.`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Creates a folder (in My Drive's top level when no parent is given). */
export async function createFolder(name: string, parent?: string): Promise<string> {
  const created = await api<{ id: string }>(`${API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
  })
  return created.id
}

/** Finds (or creates) a folder by name inside a parent folder. */
export async function ensureFolder(name: string, parent: string): Promise<string> {
  const found = await api<{ files: { id: string }[] }>(
    `${API}/files?${new URLSearchParams({
      q: `name = '${q(name)}' and '${q(parent)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })}`,
  )
  if (found.files[0]) return found.files[0].id
  const created = await api<{ id: string }>(`${API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }),
  })
  return created.id
}

/**
 * Starts a resumable upload. The returned URL accepts a PUT of the file bytes directly from the
 * member's phone (Google allows CORS for the Origin given here), so large originals never pass
 * through our server.
 */
export async function startResumableUpload(opts: { name: string; parent: string; mimeType: string; size: number; origin: string; description?: string; appProperties?: Record<string, string> }): Promise<string> {
  const res = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': opts.mimeType,
      'X-Upload-Content-Length': String(opts.size),
      Origin: opts.origin,
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.parent], description: opts.description, appProperties: opts.appProperties }),
  })
  const location = res.headers.get('Location')
  if (!res.ok || !location) throw new Error(`Could not start Drive upload (${res.status})`)
  return location
}

export async function fileInfo(fileId: string): Promise<{ parents: string[]; appProperties: Record<string, string> }> {
  const f = await api<{ parents?: string[]; appProperties?: Record<string, string> }>(
    `${API}/files/${encodeURIComponent(fileId)}?fields=parents,appProperties&supportsAllDrives=true`,
  )
  return { parents: f.parents ?? [], appProperties: f.appProperties ?? {} }
}

/** Uploads a small text file (e.g. a CSV backup) in one request. */
export async function uploadText(opts: { name: string; parent: string; mimeType: string; content: string }): Promise<string> {
  const boundary = `jec${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: opts.name, parents: [opts.parent] })}\r\n` +
    `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n${opts.content}\r\n--${boundary}--`
  const f = await api<{ id: string }>(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return f.id
}
