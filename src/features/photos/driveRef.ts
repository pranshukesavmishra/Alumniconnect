// Reads a Google Drive file id out of whatever an admin pastes. Same rules as supabase/functions/_shared/driveRef.ts (used by the edge function).
export type DriveRef = { id: string } | { error: 'empty' | 'folder' | 'invalid' }

const ID = /^[A-Za-z0-9_-]{10,200}$/

export function parseDriveRef(input: string | null | undefined): DriveRef {
  const raw = (input ?? '').trim()
  if (!raw) return { error: 'empty' }
  if (ID.test(raw)) return { id: raw }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: 'invalid' }
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || !(host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com')) return { error: 'invalid' }
  if (/\/folders\//.test(url.pathname)) return { error: 'folder' }
  const fromPath = /\/(?:file\/(?:u\/\d+\/)?d|d)\/([A-Za-z0-9_-]{10,200})(?:\/|$)/.exec(url.pathname)?.[1]
  const id = fromPath ?? url.searchParams.get('id') ?? ''
  return ID.test(id) ? { id } : { error: 'invalid' }
}
