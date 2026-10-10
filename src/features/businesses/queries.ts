import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'

export const BUSINESS_CATEGORIES = [
  'IT & Software',
  'Consulting',
  'Manufacturing',
  'Education & Coaching',
  'Food & Hospitality',
  'Health & Wellness',
  'Real Estate',
  'Finance & Legal',
  'Retail & E-commerce',
  'Media & Design',
  'Travel',
  'Other',
] as const
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]

export interface BusinessListItem {
  id: string
  name: string
  category: BusinessCategory
  city: string
  description: string
  offer: string | null
  website_url: string | null
  phone: string | null
  whatsapp: boolean
  email: string | null
  logo_path: string | null
  created_at: string
  owner_id: string
  owner_name: string
  owner_avatar: string | null
  owner_batch: number | null
}

export interface BusinessDetail {
  id: string
  owner_id: string
  name: string
  category: BusinessCategory
  city: string
  description: string
  offer: string | null
  website_url: string | null
  phone: string | null
  whatsapp: boolean
  email: string | null
  is_hidden: boolean
  created_at: string
  owner: { id: string; full_name: string; avatar_url: string | null; grad_year: number | null; branch: string | null; current_title: string | null; current_company: string | null } | null
}

export interface BusinessFields {
  name: string
  category: string
  city: string
  description: string
  offer: string
  website_url: string
  phone: string
  whatsapp: boolean
  email: string
}

const PAGE = 20

export interface BusinessFilters {
  query: string
  category: BusinessCategory | null
  city: string
}

export function useBusinesses(f: BusinessFilters) {
  return useInfiniteQuery({
    queryKey: ['businesses', f],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('search_businesses', {
        p_query: f.query.trim() || null,
        p_category: f.category,
        p_city: f.city.trim() || null,
        p_limit: PAGE,
        p_offset: pageParam,
      })
      if (error) throw error
      return data as BusinessListItem[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function useBusiness(id: string | undefined) {
  return useQuery({
    queryKey: ['business', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*, owner:profiles!businesses_owner_id_fkey(id, full_name, avatar_url, grad_year, branch, current_title, current_company)')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as BusinessDetail | null
    },
  })
}

export function useMyBusinesses() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-businesses', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { count, error } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('owner_id', uid!)
      if (error) throw error
      return count ?? 0
    },
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['businesses'] })
    void qc.invalidateQueries({ queryKey: ['my-businesses'] })
    if (id) void qc.invalidateQueries({ queryKey: ['business', id] })
  }
}

export function useSaveBusiness(editId?: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (fields: BusinessFields) => {
      const { data, error } = editId ? await supabase.rpc('update_my_business', { p_id: editId, p_fields: fields }) : await supabase.rpc('add_business', { p_fields: fields })
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (d) => invalidate(d.id),
  })
}

export function useDeleteBusiness() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('businesses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, id) => invalidate(id),
  })
}

export { telHref, whatsappDigits } from '../../lib/phone'
