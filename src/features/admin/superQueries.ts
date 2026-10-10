import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RoleTemplate, ScopeKind } from '../../lib/adminAccess'
import { supabase } from '../../lib/supabase'

export interface AdminListEntry {
  id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  is_super: boolean
  /** a permanent owner (cannot be changed or removed by anyone from the app) */
  is_owner: boolean
  /** 'Owner', 'Full admin', a role name or 'Custom' */
  role_label: string
  role_key: string | null
  scope_kind: ScopeKind
  scope_value: string | null
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

export function useRoleTemplates(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-role-templates'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_role_templates')
      if (error) throw error
      return data as unknown as RoleTemplate[]
    },
  })
}

/** Super admins only. Idempotent on the server: doing it twice changes nothing. There is no call that makes or removes an owner. */
export function useAdminAccessMutations() {
  const qc = useQueryClient()
  const done = () => {
    for (const key of ['admin-list', 'admin-roles', 'admin-access', 'admin-audit', 'admin-members', 'managed-events']) void qc.invalidateQueries({ queryKey: [key] })
  }
  return {
    setAdmin: useMutation({
      mutationFn: async (input: { userId: string; enabled: boolean; permissions: string[] | null; note?: string; template?: string | null; scopeKind?: ScopeKind | null; scopeValue?: string | null }) => {
        const { data, error } = await supabase.rpc('admin_set_admin', {
          p_user: input.userId, p_enabled: input.enabled, p_permissions: input.permissions, p_note: input.note?.trim() || null,
          p_template: input.template ?? null, p_scope_kind: input.scopeKind ?? null, p_scope_value: input.scopeValue ?? null,
        })
        if (error) throw error
        return data as unknown as { changed: boolean }
      },
      onSuccess: done,
    }),
  }
}
