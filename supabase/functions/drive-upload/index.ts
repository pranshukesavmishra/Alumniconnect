// Archives the full-quality original of an event photo to the committee's Google Drive.
//   POST {action: "start", photo_id, mime_type, size}  -> {upload_url} (or {skipped: true} if Drive isn't set up)
//   POST {action: "finish", photo_id, file_id}         -> {ok: true}   (records drive_file_id after verifying the file)
//   POST {action: "create_root", event_id}                 -> {folder_id} (admins: creates the event's archive folder)
// The caller must be the photo's uploader (checked with their own JWT through row-level security).
// Google only lets this app see folders and files it created itself ("drive.file"), so the archive
// folder is always created by the app, never picked from the existing Drive.
import { asService, asUser, currentUser, eq } from '../_shared/db.ts'
import { createFolder, driveConfigured, ensureFolder, fileInfo, startResumableUpload } from '../_shared/google.ts'
import { corsHeaders, isAllowedOrigin, json } from '../_shared/http.ts'

const MAX_BYTES = 40 * 1024 * 1024
const MIME = /^image\/(jpeg|png|webp|heic|heif)$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const user = await currentUser(auth)
  if (!user) return json(req, { error: 'Please sign in again.' }, 401)

  let body: { action?: string; photo_id?: string; mime_type?: string; size?: number; file_id?: string; event_id?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'Invalid request' }, 400)
  }

  // Row-level security: the member can only read photos they may see; we additionally require ownership.
  if (body.action === 'create_root') return createRoot(req, user.id, body.event_id)

  if (!body.photo_id || !/^[0-9a-f-]{36}$/.test(body.photo_id)) return json(req, { error: 'Photo not found' }, 404)
  const [photo] = await asUser(auth).select<{ id: string; event_id: string; uploaded_by: string; kind: string }>(
    'event_photos', `select=id,event_id,uploaded_by,kind&id=${eq(body.photo_id)}`)
  if (!photo || photo.uploaded_by !== user.id) return json(req, { error: 'Photo not found' }, 404)

  const admin = asService()
  const [ev] = await admin.select<{ slug: string; title: string }>('events', `select=slug,title&id=${eq(photo.event_id)}`)
  const [settings] = await admin.select<{ drive_folder_id: string | null }>('event_settings', `select=drive_folder_id&event_id=${eq(photo.event_id)}`)
  if (!driveConfigured() || !ev || !settings?.drive_folder_id) return json(req, { skipped: true })
  const event = { ...ev, drive_folder_id: settings.drive_folder_id }

  try {
    if (body.action === 'start') {
      const origin = req.headers.get('Origin')
      if (!isAllowedOrigin(origin)) return json(req, { error: 'Origin not allowed' }, 403)
      if (!body.mime_type || !MIME.test(body.mime_type)) return json(req, { error: 'Only photos can be archived' }, 400)
      if (!body.size || body.size <= 0 || body.size > MAX_BYTES) return json(req, { error: 'Photo too large (max 40 MB)' }, 400)
      const sub = await ensureFolder(photo.kind === 'throwback' ? 'Then (college days)' : 'Now (at the meet)', event.drive_folder_id)
      const [profile] = await admin.select<{ full_name: string; grad_year: number | null }>('profiles', `select=full_name,grad_year&id=${eq(user.id)}`)
      const who = `${profile?.full_name ?? 'Member'}${profile?.grad_year ? ` ${profile.grad_year}` : ''}`.replace(/[\\/:*?"<>|]/g, '')
      const ext = body.mime_type.split('/')[1]!.replace('jpeg', 'jpg')
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
      await admin.update('event_photos', `id=${eq(photo.id)}`, { drive_file_id: body.file_id })
      return json(req, { ok: true })
    }
    return json(req, { error: 'Unknown action' }, 400)
  } catch (e) {
    console.error(e)
    return json(req, { error: 'Archiving to Drive failed. The photo is still saved in the app.' }, 502)
  }
})

async function createRoot(req: Request, userId: string, eventId: string | undefined): Promise<Response> {
  const admin = asService()
  const [me] = await admin.select<{ is_admin: boolean }>('profiles', `select=is_admin&id=${eq(userId)}`)
  if (!me?.is_admin) return json(req, { error: 'Only admins can set up the Drive archive' }, 403)
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
