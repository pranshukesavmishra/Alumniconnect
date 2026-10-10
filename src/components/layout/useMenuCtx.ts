import { useMemo } from 'react'
import { useAuth, useMyProfile } from '../../features/auth/AuthProvider'
import { useAdminAccess } from '../../features/admin/access'
import { useMySiteRoles, useMyStaffEvents } from '../../features/events/queries'
import { visibleMenu, type MenuCtx } from './menu'

/** Organisers get the Organise section: admins, event team members and site moderators. */
export function useIsOrganiser() {
  const { data: profile } = useMyProfile()
  const { data: staff } = useMyStaffEvents()
  const { data: site } = useMySiteRoles()
  return !!profile?.is_admin || !!staff?.length || !!site?.length
}

/** Who is looking at the menu: drives which entries show. */
export function useMenuCtx(): MenuCtx {
  const { session } = useAuth()
  const { data: profile } = useMyProfile()
  const { access } = useAdminAccess()
  const { data: site } = useMySiteRoles()
  const organiser = useIsOrganiser()
  return useMemo(
    () => ({
      signedIn: !!session,
      verified: profile?.verification === 'verified',
      access,
      organiser,
      moderator: !!site?.includes('moderator'),
    }),
    [session, profile?.verification, access, organiser, site],
  )
}

export function useVisibleMenu() {
  const ctx = useMenuCtx()
  return useMemo(() => visibleMenu(ctx), [ctx])
}
