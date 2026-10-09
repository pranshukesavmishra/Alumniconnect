import { toast } from 'sonner'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

export type ExportKind = 'registrations' | 'attendees' | 'payments' | 'responses' | 'performers' | 'song_requests' | 'not_arrived'

/** Writes the download to the activity log first; the file is saved only if that worked (an unlogged export of phone numbers is not allowed). */
export async function loggedExport(eventId: string, what: ExportKind, count: number, save: () => void) {
  const { error } = await supabase.rpc('admin_log_event_export', { p_event: eventId, p_what: what, p_count: count })
  if (error) return void toast.error(friendlyError(error))
  save()
}
