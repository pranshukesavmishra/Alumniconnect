import {
  AtSign, Award, Bell, BriefcaseBusiness, Camera, CircleCheck, CirclePlay, GraduationCap, HandHelping, HeartHandshake, Images, KeyRound, MapPin, Megaphone,
  MessageCircle, MessagesSquare, Plane, ShieldCheck, ThumbsUp, UserCheck, UserPlus, type LucideIcon,
} from 'lucide-react'
import type { TileTone } from '../../components/ui/IconTile'
import type { MsgKey, Params } from '../../i18n'
import type { Notification } from '../community/queries'

export interface NotifView {
  text: string
  to: string
  icon: LucideIcon
  tone: TileTone
}

type Tx = (key: MsgKey, params?: Params) => string

/** What a notification says, where a tap goes and how it looks. Mirrors the Notifications page wording. */
export function describeNotification(n: Notification, tx: Tx): NotifView {
  const who = n.actor?.full_name ?? tx('notif.someone')
  const body = n.body ?? ''
  const v = (text: string, to: string, icon: LucideIcon, tone: TileTone): NotifView => ({ text, to, icon, tone })
  switch (n.kind) {
    case 'like':
      return v(tx('notif.like', { who }), '/', ThumbsUp, 'emerald')
    case 'comment':
      return v(tx('notif.comment', { who, body }), '/', MessageCircle, 'teal')
    case 'connection_request':
      return v(tx('notif.connect', { who }), '/me/connections', UserPlus, 'ink')
    case 'connection_accepted':
      return v(tx('notif.accepted', { who }), `/people/${n.actor?.id}`, UserCheck, 'emerald')
    case 'message':
      return v(tx('notif.message', { who, body }), `/chat/${n.target_id}`, MessagesSquare, 'emerald')
    case 'mention':
      return v(tx('notif.mention', { who, body }), `/chat/${n.target_id}`, AtSign, 'plum')
    case 'announcement':
      return v(tx('shell.n.announcement', { text: body }), '/meet', Megaphone, 'gold')
    case 'mentor_request':
      return v(tx('shell.n.mentorRequest', { who, text: body }), '/mentors/mine', GraduationCap, 'ink')
    case 'mentor_accepted':
      return v(tx('shell.n.mentorAccepted', { who }), '/mentors/mine', GraduationCap, 'emerald')
    case 'mentor_declined':
      return v(tx('shell.n.mentorDeclined', { who }), '/mentors/mine', GraduationCap, 'neutral')
    case 'help_request':
      return v(tx('notif.help', { who, body }), '/help', HandHelping, 'gold')
    case 'nearby_batchmate':
      return v(tx('notif.nearbyBatchmate', { who, city: body }), '/nearby', MapPin, 'maroon')
    case 'nearby_trip':
      return v(tx('notif.nearbyTrip', { who, city: body }), '/nearby', Plane, 'teal')
    case 'group_admin':
      return v(n.body ?? tx('shell.n.groupAdmin'), '/groups', ShieldCheck, 'emerald')
    case 'admin_access':
      return v(n.body ?? tx('shell.n.adminAccess'), '/admin', KeyRound, 'maroon')
    case 'story':
      return v(n.body ? tx('notif.story', { text: n.body }) : tx('notif.storyPlain'), '/', CirclePlay, 'maroon')
    case 'photo_tag':
      return v(tx('notif.photoTag', { who, event: body }), `/photo/${n.target_id}`, Camera, 'ink')
    case 'photo_approved':
      return v(tx('notif.photoApproved'), `/photo/${n.target_id}`, CircleCheck, 'emerald')
    case 'photo_winner':
      return v(tx('notif.photoWinner', { title: body }), `/photo/${n.target_id}`, Award, 'gold')
    case 'photo_vote_result':
      return v(tx('notif.photoVoteResult', { title: body }), `/photo/${n.target_id}`, Award, 'gold')
    case 'gallery_approved':
      return v(tx('notif.galleryApproved'), `/gallery?photo=${n.target_id}`, Images, 'emerald')
    case 'gallery_declined':
      return v(tx('notif.galleryDeclined'), '/gallery', Images, 'neutral')
    case 'invite_joined':
      return v(tx('notif.invite', { who }), `/people/${n.actor?.id}`, UserPlus, 'gold')
    case 'donation_verified':
      return v(tx('notif.give.verified', { what: body.split('|')[0] ?? '' }), '/give/mine', HeartHandshake, 'emerald')
    case 'donation_rejected':
      return v(tx('notif.give.rejected', { note: body }), '/give/mine', HeartHandshake, 'maroon')
    case 'donation_refunded':
      return v(tx('notif.give.refunded', { note: body }), '/give/mine', HeartHandshake, 'neutral')
    case 'giving_milestone':
      return v(tx('notif.give.milestone', { what: body }), '/give', HeartHandshake, 'gold')
    case 'giving_ending':
      return v(tx('notif.give.ending', { what: body }), '/give', HeartHandshake, 'gold')
    case 'giving_new':
      return v(tx('notif.give.new', { what: body }), '/give', HeartHandshake, 'maroon')
    case 'giving_update':
      return v(tx('notif.give.update', { what: body }), '/give', HeartHandshake, 'maroon')
    case 'pledge_reminder':
      return v(tx('notif.give.pledge', { what: body }), '/give', HeartHandshake, 'gold')
    case 'sponsor_followup':
      return v(tx('notif.give.followup', { what: body }), `/admin/funds/sponsor/${n.target_id}`, BriefcaseBusiness, 'ink')
    default:
      return v(n.body ?? tx('notif.default'), '/', Bell, 'neutral')
  }
}

/** Splits newest-first notifications into Today and Earlier (local day). */
export function groupByDay<T extends { created_at: string }>(list: readonly T[], now = new Date()): { today: T[]; earlier: T[] } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today: T[] = []
  const earlier: T[] = []
  for (const n of list) (new Date(n.created_at) >= start ? today : earlier).push(n)
  return { today, earlier }
}
