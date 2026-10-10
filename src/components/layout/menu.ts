// The ONE list of everything a member can open. The desktop sidebar, the phone Menu sheet, the search/jump box and the Home
// quick actions all read it. To add a destination add ONE line to MENU (label key in en.ts and hi.ts, icon, route, group, who sees it).
import {
  Activity, BarChart3, Bell, BriefcaseBusiness, CalendarHeart, CalendarRange, Download, Flag, GraduationCap, Handshake, History, Home, Image, Images,
  Inbox, KeyRound, Landmark, Languages, Link2, LogOut, MapPin, MessagesSquare, Network, PenLine, Search, ShieldCheck, ShieldHalf, ScrollText, Store, UserPlus, UserRound,
  Users, UsersRound, type LucideIcon,
} from 'lucide-react'
import { hasAnyPerm, type AdminAccess } from '../../lib/adminAccess'
import type { MsgKey } from '../../i18n'

export type MenuGroupId = 'home' | 'community' | 'events' | 'opportunities' | 'me' | 'organise'

/** Who is looking: everything a visibility rule may ask. Built from the profile, the admin access and the site settings. */
export interface MenuCtx {
  signedIn: boolean
  verified: boolean
  access: AdminAccess
  /** an admin, an event team member or a site moderator */
  organiser: boolean
  /** a site moderator (sees Reports without an admin permission) */
  moderator?: boolean
  /** feature switches that are OFF (absent = on) */
  off?: readonly string[]
}

export interface MenuItem {
  id: string
  label: MsgKey
  icon: LucideIcon
  /** route (may carry a #hash); omitted for actions */
  to?: string
  /** something other than a link */
  action?: 'signout'
  group: MenuGroupId
  /** the route only matches itself, not its sub-routes */
  end?: boolean
  /** extra routes that highlight this item */
  also?: readonly string[]
  /** 'verified' needs a verified member; default needs only a signed-in one */
  who?: 'verified' | 'organiser' | 'admin'
  /** shown to visitors who are not signed in */
  public?: boolean
  /** moderators see it too, whatever their admin permissions */
  moderator?: boolean
  /** an admin who holds any of these permissions (a trailing * means the whole family) */
  perms?: readonly string[]
  /** hidden when this feature switch is off */
  feature?: string
  /** extra words the jump box matches (English) */
  keywords?: string
  /** also offered as a Quick action on Home */
  quick?: boolean
}

export const MENU_GROUPS: readonly { id: MenuGroupId; label: MsgKey }[] = [
  { id: 'home', label: 'menu.g.home' },
  { id: 'community', label: 'menu.g.community' },
  { id: 'events', label: 'menu.g.events' },
  { id: 'opportunities', label: 'menu.g.opportunities' },
  { id: 'me', label: 'menu.g.me' },
  { id: 'organise', label: 'menu.g.organise' },
]

export const MENU: readonly MenuItem[] = [
  { id: 'home', group: 'home', label: 'nav.home', icon: Home, to: '/', end: true, public: true },
  // Community
  { id: 'groups', group: 'community', label: 'nav.groups', icon: Users, to: '/groups', who: 'verified', also: ['/groups/'], keywords: 'department batch circle official', quick: true },
  { id: 'directory', group: 'community', label: 'home.findJecians', icon: Search, to: '/people', who: 'verified', keywords: 'directory people search members', quick: true },
  { id: 'nearby', group: 'community', label: 'nearby.title', icon: MapPin, to: '/nearby', who: 'verified', also: ['/trips', '/city/'], keywords: 'city trips location' },
  { id: 'chat', group: 'community', label: 'nav.chat', icon: MessagesSquare, to: '/chat', who: 'verified', keywords: 'messages dm' },
  { id: 'connections', group: 'community', label: 'profile.connections', icon: Handshake, to: '/me/connections', who: 'verified' },
  { id: 'notifications', group: 'community', label: 'notif.title', icon: Bell, to: '/notifications', who: 'verified', keywords: 'alerts' },
  // Events & memories
  { id: 'meet', group: 'events', label: 'nav.meet', icon: CalendarHeart, to: '/meet', end: true, public: true, also: ['/meet/register', '/meet/my'], keywords: 'reunion register ticket', quick: true },
  { id: 'reunion-photos', group: 'events', label: 'menu.reunionPhotos', icon: Images, to: '/meet/photos', who: 'verified', also: ['/events/'], keywords: 'photos slideshow' },
  { id: 'gallery', group: 'events', label: 'profile.gallery', icon: Image, to: '/gallery', who: 'verified', keywords: 'college photos albums', quick: true },
  { id: 'programme', group: 'events', label: 'menu.programme', icon: CalendarRange, to: '/meet#programme', public: true, keywords: 'schedule agenda' },
  // Opportunities
  { id: 'jobs', group: 'opportunities', label: 'profile.jobs', icon: BriefcaseBusiness, to: '/jobs', who: 'verified', also: ['/jobs/'], keywords: 'work hiring career', quick: true },
  { id: 'mentors', group: 'opportunities', label: 'menu.mentorship', icon: GraduationCap, to: '/mentors', who: 'verified', also: ['/mentors/'] },
  { id: 'businesses', group: 'opportunities', label: 'menu.businesses', icon: Store, to: '/businesses', who: 'verified', also: ['/businesses/'], keywords: 'shops support' },
  { id: 'help', group: 'opportunities', label: 'profile.askJec', icon: UsersRound, to: '/help', who: 'verified', keywords: 'ask help network' },
  // Me
  { id: 'profile', group: 'me', label: 'menu.myProfile', icon: UserRound, to: '/me', end: true },
  { id: 'edit-profile', group: 'me', label: 'profile.edit', icon: PenLine, to: '/me/edit' },
  { id: 'invite', group: 'me', label: 'profile.invite', icon: UserPlus, to: '/invite', who: 'verified', keywords: 'share refer', quick: true },
  { id: 'import', group: 'me', label: 'home.importLinkedin', icon: Link2, to: '/me/import', keywords: 'linkedin pdf' },
  { id: 'language', group: 'me', label: 'menu.language', icon: Languages, to: '/me#language', keywords: 'hindi english bhasha' },
  { id: 'my-data', group: 'me', label: 'menu.downloadData', icon: Download, to: '/me#my-data', keywords: 'export privacy' },
  { id: 'about', group: 'me', label: 'menu.about', icon: Landmark, to: '/about', public: true, keywords: 'college gec government engineering jecaa association history' },
  { id: 'privacy', group: 'me', label: 'menu.privacy', icon: ShieldHalf, to: '/privacy', public: true },
  { id: 'terms', group: 'me', label: 'menu.terms', icon: ScrollText, to: '/terms', public: true },
  { id: 'signout', group: 'me', label: 'profile.signOut', icon: LogOut, action: 'signout', keywords: 'log out' },
  // Organise: only what the viewer's admin permissions allow
  { id: 'org-home', group: 'organise', label: 'nav.organise', icon: ShieldCheck, to: '/admin', end: true, who: 'organiser' },
  { id: 'org-inbox', group: 'organise', label: 'menu.org.inbox', icon: Inbox, to: '/admin/inbox', who: 'admin', perms: ['members_verify', 'moderation_*', 'community_circles', 'messages_send', 'money_*', 'events_registrations'] },
  { id: 'org-members', group: 'organise', label: 'menu.org.members', icon: Users, to: '/admin/members', who: 'admin', perms: ['members_view'] },
  { id: 'org-reports', group: 'organise', label: 'menu.org.reports', icon: Flag, to: '/admin/reports', who: 'admin', perms: ['moderation_*'], moderator: true },
  { id: 'org-community', group: 'organise', label: 'menu.org.community', icon: Network, to: '/admin/community', who: 'admin', perms: ['community_*'] },
  { id: 'org-analytics', group: 'organise', label: 'menu.org.analytics', icon: BarChart3, to: '/admin/analytics', who: 'admin', perms: ['analytics'] },
  { id: 'org-roles', group: 'organise', label: 'menu.org.roles', icon: KeyRound, to: '/admin/roles', who: 'admin', perms: ['admins', 'events_team'] },
  { id: 'org-health', group: 'organise', label: 'menu.org.health', icon: Activity, to: '/admin/health', who: 'admin', perms: ['health'] },
  { id: 'org-activity', group: 'organise', label: 'menu.org.activity', icon: History, to: '/admin/activity', who: 'admin', perms: ['audit'] },
]

/** Whether this viewer sees the item at all. Pure, so it is unit-tested. */
export function isVisible(item: MenuItem, ctx: MenuCtx): boolean {
  if (item.feature && ctx.off?.includes(item.feature)) return false
  if (!ctx.signedIn) return !!item.public
  if (item.who === 'verified') return ctx.verified || ctx.access.is_admin
  if (item.who === 'organiser') return ctx.organiser || ctx.access.is_admin
  if (item.who === 'admin') {
    if (ctx.moderator && item.moderator) return true
    return ctx.access.is_admin && (!item.perms || hasAnyPerm(ctx.access, item.perms))
  }
  return true
}

export interface MenuSection {
  id: MenuGroupId
  label: MsgKey
  items: MenuItem[]
}

/** The groups this viewer sees, each with its visible items (empty groups are dropped). */
export function visibleMenu(ctx: MenuCtx): MenuSection[] {
  return MENU_GROUPS.map((g) => ({ id: g.id, label: g.label, items: MENU.filter((i) => i.group === g.id && isVisible(i, ctx)) })).filter((s) => s.items.length > 0)
}

/** Does the current location belong to this item? Hash-only items (Language, Programme) never highlight. */
export function isActive(item: MenuItem, pathname: string): boolean {
  if (!item.to || item.to.includes('#')) return false
  if (pathname === item.to) return true
  if (item.end) return false
  if (item.also?.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p))) return true
  return item.to !== '/' && pathname.startsWith(item.to + '/')
}

/** Items matching a typed query (label as shown, English keywords, route). Empty query = everything. */
export function searchMenu(sections: MenuSection[], query: string, label: (k: MsgKey) => string): MenuSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return sections
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => `${label(i.label)} ${i.keywords ?? ''} ${i.to ?? ''} ${label(s.label)}`.toLowerCase().includes(q)) }))
    .filter((s) => s.items.length > 0)
}
