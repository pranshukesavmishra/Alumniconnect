import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { compressImageSizes, PHOTO_SIZE, THUMB_SIZE } from '../../lib/image'
import type { Attachment } from './merge'

// Chat files live in the private "chat-media" bucket under "<my id>/<chat id>/...".
// Only members of that chat can read them (storage policy), through short-lived signed links.
export const BUCKET = 'chat-media'
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PHOTOS = 10

const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|apk|app|dmg|sh|html?|svg)$/i

export function fileProblem(f: File): string | null {
  if (f.size > MAX_FILE_BYTES) return `“${f.name}” is larger than 25 MB.`
  if (f.size === 0) return `“${f.name}” is empty.`
  if (BLOCKED_EXT.test(f.name)) return `“${f.name}” can’t be shared here for safety. Try a PDF or a photo.`
  return null
}

export const isPhoto = (f: File) => /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i.test(f.type) || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name)

export function formatBytes(n: number | undefined): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function safeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80)
  return cleaned || 'file'
}

async function put(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: '31536000' })
  if (error) throw error
}

/** Upload one photo as a full size (≤1600px) + a thumbnail (≤480px). */
export async function uploadPhoto(uid: string, chatId: string, file: File): Promise<Attachment> {
  const [full, thumb] = await compressImageSizes(file, [
    { maxSide: PHOTO_SIZE, quality: 0.82 },
    { maxSide: THUMB_SIZE, quality: 0.72 },
  ])
  const id = crypto.randomUUID()
  const path = `${uid}/${chatId}/${id}.${full!.ext}`
  const thumbPath = `${uid}/${chatId}/${id}_t.${thumb!.ext}`
  await Promise.all([put(path, full!.blob, full!.type), put(thumbPath, thumb!.blob, thumb!.type)])
  return { path, thumb: thumbPath, name: file.name, mime: full!.type, size: full!.blob.size, width: full!.width, height: full!.height }
}

/** Upload a document as-is. */
export async function uploadFile(uid: string, chatId: string, file: File): Promise<Attachment> {
  const path = `${uid}/${chatId}/${crypto.randomUUID()}/${safeName(file.name)}`
  await put(path, file, file.type || 'application/octet-stream')
  return { path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size }
}

/** Remove my own uploaded files (after "delete for everyone" or a failed send). Best effort. */
export async function removeMyFiles(attachments: Attachment[]) {
  const paths = attachments.flatMap((a) => [a.path, a.thumb].filter((p): p is string => !!p))
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined)
}

// ---- signed links, batched: a screen full of photos costs one request, not one per photo
const TTL = 60 * 60 // seconds
let queue: { path: string; resolve: (u: string) => void; reject: (e: unknown) => void }[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  const batch = queue
  queue = []
  timer = null
  const paths = [...new Set(batch.map((b) => b.path))]
  supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, TTL)
    .then(({ data, error }) => {
      if (error) throw error
      const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl] as const))
      for (const b of batch) {
        const url = map.get(b.path)
        if (url) b.resolve(url)
        else b.reject(new Error('File not available'))
      }
    })
    .catch((e) => batch.forEach((b) => b.reject(e)))
}

export function signedUrl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push({ path, resolve, reject })
    if (!timer) timer = setTimeout(flush, 15)
  })
}

/** Signed link for a chat file; cached for most of its lifetime. `localUrl` (optimistic preview) wins. */
export function useMediaUrl(path: string | undefined, localUrl?: string) {
  return useQuery({
    queryKey: ['chat-media', path],
    enabled: !!path && !localUrl && !path.startsWith('local:'),
    staleTime: (TTL - 300) * 1000,
    gcTime: (TTL - 300) * 1000,
    retry: 1,
    queryFn: () => signedUrl(path!),
  })
}

/** Download link (forces a download with the original file name). */
export async function downloadUrl(a: Attachment): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 300, { download: a.name ?? true })
  if (error) throw error
  return data.signedUrl
}
