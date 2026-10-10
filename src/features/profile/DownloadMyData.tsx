import { Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { friendlyError } from '../../lib/errors'
import { downloadFile } from '../../lib/ics'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

/** Everything the app holds about the signed-in member, as one readable file (their right to a copy of their data). */
export async function collectMyData(uid: string) {
  const own = async (table: string, column: string, select = '*') => {
    const { data, error } = await supabase.from(table).select(select).eq(column, uid)
    if (error) throw error
    return data as unknown as Record<string, unknown>[]
  }
  const [profile, contact, experiences, educations, posts, comments, registrations, connections, groups, notifications] = await Promise.all([
    own('profiles', 'id'),
    own('profile_private', 'id'),
    own('experiences', 'profile_id'),
    own('educations', 'profile_id'),
    own('posts', 'author_id'),
    own('comments', 'author_id'),
    own('event_registrations', 'user_id'),
    supabase.from('connections').select('*').or(`requester.eq.${uid},addressee.eq.${uid}`).then((r) => r.data ?? []),
    own('group_members', 'user_id'),
    own('notifications', 'user_id'),
  ])
  const regIds = (registrations as unknown as { id: string }[]).map((r) => r.id)
  const [items, payments] = regIds.length
    ? await Promise.all([
        supabase.from('event_registration_items').select('*').in('registration_id', regIds).then((r) => r.data ?? []),
        supabase.from('event_payments').select('*').in('registration_id', regIds).then((r) => r.data ?? []),
      ])
    : [[], []]
  const social = await own('profile_social_links', 'user_id')
  const { data: loc } = await supabase.rpc('my_location')
  const { data: trips } = await supabase.rpc('my_trips')
  const { data: meetups } = await supabase.from('groups').select('id, name, description, created_at').eq('created_by', uid).eq('kind', 'meetup')
  const { data: sent } = await supabase.from('messages').select('id, chat_id, kind, body, created_at').eq('sender_id', uid).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000)
  return {
    exported_at: new Date().toISOString(),
    note: 'This is the information JEC Alumni Connect holds about you. Photos and files you uploaded are not included in this file.',
    profile: profile[0] ?? null,
    contact_details: contact[0] ?? null,
    social_links: social[0] ?? null,
    experiences,
    educations,
    posts,
    comments,
    messages_you_sent: sent ?? [],
    connections,
    group_memberships: groups,
    event_registrations: registrations,
    event_registration_items: items,
    event_payments: payments,
    notifications,
    shared_location: loc ?? null,
    upcoming_trips: trips ?? [],
    meetups_you_started: meetups ?? [],
  }
}

export function DownloadMyData() {
  const uid = useUserId()
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        icon={<Download className="size-4" />}
        loading={busy}
        onClick={async () => {
          if (!uid) return
          setBusy(true)
          try {
            const data = await collectMyData(uid)
            downloadFile(`jec-alumni-connect-my-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')
            toast.success('Your data has been downloaded.')
          } catch (e) {
            toast.error(friendlyError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        Download my data
      </Button>
      <p className="text-sm text-muted">A copy of your profile, posts, registrations and messages you sent, as one file.</p>
    </div>
  )
}
