import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface AdminListEntry {
  id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  is_super: boolean
  /** a super admin, or an admin without a limited grant */
  full: boolean
  permission_count: number
  /** only for super admins (and your own row) */
  permissions: string[] | null
  note: string | null
  granted_at: string | null
  granted_by: string | null
}

export interface AdminList {
  viewer_is_super: boolean
  admins: AdminListEntry[]
}

export function useAdminList(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-list'],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_admins')
      if (error) throw error
      return data as unknown as AdminList
    },
  })
}

/** Super admins only. Each call is idempotent on the server: doing it twice changes nothing. */
export function useAdminAccessMutations() {
  const qc = useQueryClient()
  const done = () => {
    for (const key of ['admin-list', 'admin-roles', 'admin-access', 'admin-audit', 'admin-members', 'managed-events']) void qc.invalidateQueries({ queryKey: [key] })
  }
  return {
    setAdmin: useMutation({
      mutationFn: async (input: { userId: string; enabled: boolean; permissions: string[] | null; note?: string }) => {
        const { data, error } = await supabase.rpc('admin_set_admin', { p_user: input.userId, p_enabled: input.enabled, p_permissions: input.permissions, p_note: input.note?.trim() || null })
        if (error) throw error
        return data as unknown as { changed: boolean }
      },
      onSuccess: done,
    }),
    setSuper: useMutation({
      mutationFn: async (input: { userId: string; enabled: boolean }) => {
        const { data, error } = await supabase.rpc('admin_set_super_admin', { p_user: input.userId, p_enabled: input.enabled })
        if (error) throw error
        return data as unknown as { changed: boolean }
      },
      onSuccess: done,
    }),
    transfer: useMutation({
      mutationFn: async (input: { toUser: string; stepDown: boolean }) => {
        const { data, error } = await supabase.rpc('admin_transfer_ownership', { p_to_user: input.toUser, p_step_down: input.stepDown })
        if (error) throw error
        return data as unknown as { changed: boolean; stepped_down: boolean }
      },
      onSuccess: done,
    }),
  }
}
