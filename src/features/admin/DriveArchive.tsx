import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, Notice, SectionTitle } from '../../components/ui/Display'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

/** Admin-only: the event's archive folder in the committee's Google Drive. */
export function DriveArchive({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { data: folderId, isLoading } = useQuery({
    queryKey: ['event-settings', eventId],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_settings').select('drive_folder_id').eq('event_id', eventId).maybeSingle()
      if (error) throw error
      return (data?.drive_folder_id as string | null) ?? null
    },
  })

  async function create() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('drive-upload', { body: { action: 'create_root', event_id: eventId } })
    setBusy(false)
    if (error) return toast.error(friendlyError(error))
    if ((data as { skipped?: boolean }).skipped) return toast.error('Google Drive isn’t connected yet. Follow “Connect Google Drive” in docs/SETUP.md.')
    toast.success('Drive folder created')
    void qc.invalidateQueries({ queryKey: ['event-settings', eventId] })
  }

  return (
    <section className="space-y-3">
      <SectionTitle>Photo archive and backups (Google Drive)</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-[15px] text-muted">
          Full-quality originals of every photo members upload, plus a nightly backup of registrations and payments, are saved to the committee’s Google Drive.
          Only admins see this. The app can only access the folder it creates, never anything else in that Drive.
        </p>
        {isLoading ? null : folderId ? (
          <a
            href={`https://drive.google.com/drive/folders/${folderId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-semibold text-primary hover:bg-primary-soft"
          >
            <ExternalLink className="size-4" aria-hidden /> Open the archive folder
          </a>
        ) : (
          <>
            <Notice tone="warning" title="Not set up yet">
              Photos are still saved in the app; originals start going to Drive once the folder exists.
            </Notice>
            <Button icon={<FolderPlus className="size-4" />} loading={busy} onClick={create}>
              Create the Drive folder
            </Button>
          </>
        )}
      </Card>
    </section>
  )
}
