import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { EmptyState, PageSkeleton } from '../../components/ui/Display'
import { hasAnyPerm, hasPerm, NO_ACCESS, type AdminAccess } from '../../lib/adminAccess'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export const adminAccessKey = (uid: string | null) => ['admin-access', uid] as const

/** What the signed-in person may do as an admin. Asked of the database on every visit, so a change a super admin made shows at once. */
export function useAdminAccess() {
  const uid = useUserId()
  const q = useQuery({
    queryKey: adminAccessKey(uid),
    enabled: !!uid,
    staleTime: 5_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_admin_access')
      if (error) throw error
      return data as unknown as AdminAccess
    },
  })
  const access = q.data ?? NO_ACCESS
  return {
    access,
    isLoading: q.isLoading,
    isSuper: access.is_super,
    isAdmin: access.is_admin,
    can: (key: string) => hasPerm(access, key),
    canAny: (keys: readonly string[]) => hasAnyPerm(access, keys),
  }
}

/** The friendly screen for an admin who opens something their permissions do not include. */
export function NoAccess({ what }: { what?: string }) {
  return (
    <div>
      <PageHeader title="No access" back="/admin" />
      <Page>
        <div data-testid="no-access">
          <EmptyState
            icon={<Lock />}
            title="You do not have access to this"
            action={<ButtonLink to="/admin" variant="secondary">Back to Organise</ButtonLink>}
          >
            {what ? `${what} is not part of your admin permissions.` : 'This is not part of your admin permissions.'} Ask a super admin to give you access.
          </EmptyState>
        </div>
      </Page>
    </div>
  )
}

/** Shows its children only to admins who hold one of the permissions; everyone else gets the friendly screen (or leaves the admin area). */
export function RequirePerm({ any, what, children }: { any: readonly string[]; what?: string; children: ReactNode }) {
  const { access, isLoading } = useAdminAccess()
  if (isLoading) return <PageSkeleton />
  if (!access.is_admin) return <Navigate to="/admin" replace />
  if (!hasAnyPerm(access, any)) return <NoAccess what={what} />
  return <>{children}</>
}
