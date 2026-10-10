// Sends files to the committee's Google Drive. Google lets the phone upload straight to Drive (resumable upload); this function only
// hands out the one-time upload link and, afterwards, checks the file and records it.
//
//   Event photos and videos (the caller is the row's uploader, checked with their own JWT through row-level security):
//   POST {action: "start", photo_id, mime_type, size}  -> {upload_url} (or {skipped: true} if Drive isn't set up)
//   POST {action: "finish", photo_id, file_id}         -> {ok: true}   (records drive_file_id after verifying the file)
//   Gallery videos and glimpses (the caller needs the gallery_manage permission; the row exists already):
//   POST {action: "start"  | "finish", kind: "gallery" | "glimpse", id, mime_type, size | file_id}
//   POST {action: "create_root", event_id}             -> {folder_id} (admins: creates the event's archive folder)
//
// Photos: originals are archived (best effort). Videos: the Drive file IS the video (played back by the drive-media function), so a video
// becomes playable only when "finish" has verified the Drive file (made for this row, with the size announced at "start").
// Google only lets this app see folders and files it created itself ("drive.file"), so folders are always created by the app.
import { asService, asUser, currentUser, eq } from '../_shared/db.ts'
import { createFolder, driveConfigured, ensureFolder, fileInfo, startResumableUpload } from '../_shared/google.ts'
import { corsHeaders, isAllowedOrigin, json } from '../_shared/http.ts'

const MAX_PHOTO_BYTES = 25 * 1024 * 1024
const MAX_VIDEO_BYTES = 500 * 1024 * 1024
const PHOTO_MIME = /^image\/(jpeg|png|webp|heic|heif)$/
const VIDEO_MIME = /^video\/(mp4|quicktime|webm)$/
const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }
const UUID = /^[0-9a-f-]{36}$/
const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '')

type Body = { action?: string; kind?: string; id?: string; photo_id?: string; mime_type?: string; size?: number; file_id?: string; event_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const user = await currentUser(auth)
  if (!user) return json(req, { error: 'Please sign in again.' }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'Invalid request' }, 400)
  }

  if (body.action === 'create_root') return createRoot(req, user.id, body.event_id)
  if (body.kind === 'gallery' || body.kind === 'glimpse') return curated(req, auth, user.id, body.kind, body)
  return eventMedia(req, auth, user.id, body)
})

// ------------------------------------------------------------------ event photos and videos
async function eventMedia(req: Request, auth: string, userId: string, body: Body): Promise<Response> {
  // Row-level security: the member can only read photos they may see; we additionally require ownership.
  if (!body.photo_id || !UUID.test(body.photo_id)) return json(req, { error: 'Photo not found' }, 404)
  const [photo] = await asUser(auth).select<{ id: string; event_id: string; uploaded_by: string; kind: string; source: string | null; media_kind: string; size_bytes: number | null; mime_type: string | null }>(
    'event_photos', `select=id,event_id,uploaded_by,kind,source,media_kind,size_bytes,mime_type&id=${eq(body.photo_id)}`)
  if (!photo || photo.uploaded_by !== userId) return json(req, { error: 'Photo not found' }, 404)
  const video = photo.media_kind === 'video'

  const admin = asService()
  const [ev] = await admin.select<{ slug: string; title: string }>('events', `select=slug,title&id=${eq(photo.event_id)}`)
  const [settings] = await admin.select<{ drive_folder_id: string | null }>('event_settings', `select=drive_folder_id&event_id=${eq(photo.event_id)}`)
  if (!driveConfigured() || !ev || !settings?.drive_folder_id) return json(req, { skipped: true })
  const event = { ...ev, drive_folder_id: settings.drive_folder_id }

  try {
    if (body.action === 'start') {
      const origin = req.headers.get('Origin')
      if (!isAllowedOrigin(origin)) return json(req, { error: 'Origin not allowed' }, 403)
      if (video) {
        if (!body.mime_type || !VIDEO_MIME.test(body.mime_type)) return json(req, { error: 'Only MP4, MOV and WebM videos can be sent' }, 400)
        if (!body.size || body.size <= 0 || body.size > MAX_VIDEO_BYTES) return json(req, { error: 'Video too large (max 500 MB)' }, 400)
        if (body.size !== photo.size_bytes || body.mime_type !== photo.mime_type) return json(req, { error: 'This file does not match the video that was saved' }, 400)
      } else {
        if (!body.mime_type || !PHOTO_MIME.test(body.mime_type)) return json(req, { error: 'Only photos can be archived' }, 400)
        if (!body.size || body.size <= 0 || body.size > MAX_PHOTO_BYTES) return json(req, { error: 'Photo too large (max 25 MB)' }, 400)
      }
      // the committee's photographer uploads go to their own folder; members' photos keep the old two
      const folderName = video
        ? (photo.source === 'official' ? 'Official videos' : 'Videos from members')
        : photo.source === 'official' ? 'Official photos' : photo.kind === 'throwback' ? 'Then (college days)' : 'Now (at the meet)'
      const sub = await ensureFolder(folderName, event.drive_folder_id)
      const [profile] = await admin.select<{ full_name: string; grad_year: number | null }>('profiles', `select=full_name,grad_year&id=${eq(userId)}`)
      const who = clean(`${profile?.full_name ?? 'Member'}${profile?.grad_year ? ` ${profile.grad_year}` : ''}`)
      const ext = video ? VIDEO_EXT[body.mime_type]! : body.mime_type.split('/')[1]!.replace('jpeg', 'jpg')
      const upload_url = await startResumableUpload({
        name: `${who} - ${photo.id.slice(0, 8)}.${ext}`,
        parent: sub,
        mimeType: body.mime_type,
        size: body.size,
        origin,
        description: `Uploaded by ${who} via JEC Alumni Connect for ${event.title}`,
        appProperties: { jec_photo_id: photo.id }, // binds the Drive file to this photo
      })
      return json(req, { upload_url })
    }

    if (body.action === 'finish') {
      if (!body.file_id || !/^[A-Za-z0-9_-]{10,200}$/.test(body.file_id)) return json(req, { error: 'Invalid file' }, 400)
      // The file must be the one created for THIS photo (tag set in "start", which only the server can set).
      const info = await fileInfo(body.file_id)
      if (info.appProperties.jec_photo_id !== photo.id) return json(req, { error: 'File does not belong to this photo' }, 400)
      if (video && info.size !== photo.size_bytes) return json(req, { error: 'The upload is incomplete. Please send the video again.' }, 409)
      await admin.update('event_photos', `id=${eq(photo.id)}`, { drive_file_id: body.file_id })
      return json(req, { ok: true })
    }
    return json(req, { error: 'Unknown action' }, 400)
  } catch (e) {
    console.error(e)
    return json(req, { error: video ? 'Sending the video to Drive failed. Please try again.' : 'Archiving to Drive failed. The photo is still saved in the app.' }, 502)
  }
}

// ------------------------------------------------------------------ gallery videos and glimpses
async function canCurate(auth: string): Promise<boolean> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/_admin_can`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_perm: 'gallery_manage' }),
  })
  return res.ok && (await res.json()) === true
}

/** The Drive folder for the gallery or the glimpses: made once by the app, remembered in drive_roots. */
async function curatedFolder(kind: 'gallery' | 'glimpse'): Promise<string> {
  const admin = asService()
  const key = kind === 'gallery' ? 'gallery' : 'glimpses'
  const [row] = await admin.select<{ folder_id: string }>('drive_roots', `select=folder_id&key=${eq(key)}`)
  if (row) return row.folder_id
  const folder = await createFolder(kind === 'gallery' ? 'JEC Alumni Connect - College gallery videos' : 'JEC Alumni Connect - Glimpses')
  await admin.upsert('drive_roots', { key, folder_id: folder })
  return folder
}

async function curated(req: Request, auth: string, userId: string, kind: 'gallery' | 'glimpse', body: Body): Promise<Response> {
  if (!body.id || !UUID.test(body.id)) return json(req, { error: 'Video not found' }, 404)
  if (!(await canCurate(auth))) return json(req, { error: 'You do not have permission to do this. Ask a super admin for access.' }, 403)
  const table = kind === 'gallery' ? 'gallery_photos' : 'glimpses'
  const admin = asService()
  const [row] = await admin.select<{ id: string; media_kind?: string; mime_type: string | null; size_bytes: number | null; drive_file_id: string | null }>(
    table, `select=id,mime_type,size_bytes,drive_file_id${kind === 'gallery' ? ',media_kind' : ''}&id=${eq(body.id)}`)
  if (!row || (kind === 'gallery' && row.media_kind !== 'video') || !row.mime_type || !row.size_bytes) return json(req, { error: 'Video not found' }, 404)
  if (!driveConfigured()) return json(req, { skipped: true })
  const tag = kind === 'gallery' ? 'jec_gallery_id' : 'jec_glimpse_id'

  try {
    if (body.action === 'start') {
      const origin = req.headers.get('Origin')
      if (!isAllowedOrigin(origin)) return json(req, { error: 'Origin not allowed' }, 403)
      if (!body.mime_type || !VIDEO_MIME.test(body.mime_type) || body.mime_type !== row.mime_type) return json(req, { error: 'This file does not match the video that was saved' }, 400)
      if (!body.size || body.size !== row.size_bytes || body.size > MAX_VIDEO_BYTES) return json(req, { error: 'This file does not match the video that was saved' }, 400)
      const upload_url = await startResumableUpload({
        name: `${kind === 'gallery' ? 'Gallery' : 'Glimpse'} - ${row.id.slice(0, 8)}.${VIDEO_EXT[body.mime_type]}`,
        parent: await curatedFolder(kind),
        mimeType: body.mime_type,
        size: body.size,
        origin,
        description: `Added via JEC Alumni Connect (${kind})`,
        appProperties: { [tag]: row.id },
      })
      return json(req, { upload_url })
    }
    if (body.action === 'finish') {
      if (!body.file_id || !/^[A-Za-z0-9_-]{10,200}$/.test(body.file_id)) return json(req, { error: 'Invalid file' }, 400)
      const info = await fileInfo(body.file_id)
      if (info.appProperties[tag] !== row.id) return json(req, { error: 'File does not belong to this video' }, 400)
      if (info.size !== row.size_bytes) return json(req, { error: 'The upload is incomplete. Please send the video again.' }, 409)
      await admin.update(table, `id=${eq(row.id)}`, { drive_file_id: body.file_id })
      return json(req, { ok: true })
    }
    return json(req, { error: 'Unknown action' }, 400)
  } catch (e) {
    console.error(e, userId)
    return json(req, { error: 'Sending the video to Drive failed. Please try again.' }, 502)
  }
}

async function createRoot(req: Request, userId: string, eventId: string | undefined): Promise<Response> {
  const admin = asService()
  const [me] = await admin.select<{ is_admin: boolean; is_super_admin: boolean }>('profiles', `select=is_admin,is_super_admin&id=${eq(userId)}`)
  if (!me?.is_admin) return json(req, { error: 'Only admins can set up the Drive archive' }, 403)
  // a limited admin needs the event-settings permission; super admins and admins without a limited grant hold every permission
  const [grant] = await admin.select<{ permissions: string[] }>('admin_grants', `select=permissions&user_id=${eq(userId)}`)
  if (!me.is_super_admin && grant && !grant.permissions.includes('events_settings')) {
    return json(req, { error: 'You do not have permission to change event settings. Ask a super admin.' }, 403)
  }
  if (!driveConfigured()) return json(req, { skipped: true })
  if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) return json(req, { error: 'Event not found' }, 404)
  const [ev] = await admin.select<{ title: string }>('events', `select=title&id=${eq(eventId)}`)
  if (!ev) return json(req, { error: 'Event not found' }, 404)
  const [existing] = await admin.select<{ drive_folder_id: string | null }>('event_settings', `select=drive_folder_id&event_id=${eq(eventId)}`)
  if (existing?.drive_folder_id) return json(req, { folder_id: existing.drive_folder_id })
  try {
    const root = await createFolder(`JEC Alumni Connect - ${ev.title}`.replace(/[\\/:*?"<>|]/g, ''))
    await Promise.all(['Then (college days)', 'Now (at the meet)', 'Backups'].map((n) => ensureFolder(n, root)))
    await admin.upsert('event_settings', { event_id: eventId, drive_folder_id: root })
    return json(req, { folder_id: root })
  } catch (e) {
    console.error(e)
    return json(req, { error: 'Could not create the Drive folder. Check the Drive connection in the setup guide.' }, 502)
  }
}
