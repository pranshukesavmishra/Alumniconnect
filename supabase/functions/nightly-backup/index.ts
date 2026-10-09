// Nightly backup of every event's registrations and payments to the committee's Google Drive (CSV),
// and a daily "keep-alive" so the free Supabase project never pauses.
// Called by .github/workflows/nightly.yml with header  x-backup-secret: <BACKUP_SECRET>.
import { asService, eq } from '../_shared/db.ts'
import { driveConfigured, ensureFolder, uploadText } from '../_shared/google.ts'

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]!)
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    // neutralise spreadsheet formulas and quote everything
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return `"${safe.replace(/"/g, '""')}"`
  }
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')
}

async function all(table: string, query: string): Promise<Record<string, unknown>[]> {
  const db = asService()
  const out: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await db.select<Record<string, unknown>>(table, `${query}&limit=1000&offset=${offset}`)
    out.push(...page)
    if (page.length < 1000) return out
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('BACKUP_SECRET')
  if (!secret || req.headers.get('x-backup-secret') !== secret) return new Response('Forbidden', { status: 403 })

  // keep-alive: a real query
  let events: { id: string; slug: string; drive_folder_id: string | null }[]
  try {
    const evs = await asService().select<{ id: string; slug: string }>('events', 'select=id,slug')
    const settings = await asService().select<{ event_id: string; drive_folder_id: string | null }>('event_settings', 'select=event_id,drive_folder_id')
    events = evs.map((e) => ({ ...e, drive_folder_id: settings.find((x) => x.event_id === e.id)?.drive_folder_id ?? null }))
  } catch (e) {
    return new Response(`DB error: ${(e as Error).message}`, { status: 500 })
  }
  // the admin health page shows when this last ran and whether it worked
  const record = (ok: boolean, detail: string) => asService().upsert('system_events', { kind: 'backup', ok, detail: detail.slice(0, 500) }).catch((e) => console.error(e))
  if (!driveConfigured()) {
    await record(true, 'Ran, but Google Drive is not set up, so no files were saved')
    return Response.json({ ok: true, backup: 'skipped (Drive not configured)' })
  }

  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  const done: string[] = []
  try {
    for (const ev of events) {
      if (!ev.drive_folder_id) continue
      const folder = await ensureFolder('Backups', ev.drive_folder_id)
      const regs = await all('event_registrations', `select=*&event_id=${eq(ev.id)}&order=created_at`)
      const pays = await all('event_payments', `select=*,event_registrations!inner(event_id)&event_registrations.event_id=${eq(ev.id)}&order=created_at`)
      const items = await all('event_registration_items', `select=*,event_registrations!inner(event_id)&event_registrations.event_id=${eq(ev.id)}`)
      for (const r of [...pays, ...items]) delete r.event_registrations
      await uploadText({ name: `${ev.slug} registrations ${stamp}.csv`, parent: folder, mimeType: 'text/csv', content: csv(regs) })
      await uploadText({ name: `${ev.slug} payments ${stamp}.csv`, parent: folder, mimeType: 'text/csv', content: csv(pays) })
      await uploadText({ name: `${ev.slug} tickets ${stamp}.csv`, parent: folder, mimeType: 'text/csv', content: csv(items) })
      done.push(`${ev.slug}: ${regs.length} registrations, ${pays.length} payments`)
    }
    await record(true, done.length ? done.join('; ') : 'Ran; no event has a Drive folder yet')
    return Response.json({ ok: true, backup: done })
  } catch (e) {
    console.error(e)
    await record(false, `Failed: ${(e as Error).message}`)
    return new Response(`Backup failed: ${(e as Error).message}`, { status: 502 })
  }
})
