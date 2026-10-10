import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { SocialVisibility } from '../../lib/social'
import { useUserId } from '../auth/AuthProvider'

export interface SocialLinksRow {
  instagram_url: string | null
  facebook_url: string | null
}

export interface MySocialLinks extends SocialLinksRow {
  instagram_visibility: SocialVisibility
  facebook_visibility: SocialVisibility
}

type Waiter = { resolve: (r: SocialLinksRow) => void; reject: (e: unknown) => void }
const pending = new Map<string, Waiter[]>()
let timer: ReturnType<typeof setTimeout> | null = null
const NONE: SocialLinksRow = { instagram_url: null, facebook_url: null }

async function flush() {
  timer = null
  const batch = new Map(pending)
  pending.clear()
  const ids = [...batch.keys()]
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200)
      const { data, error } = await supabase.rpc('get_social_links', { p_ids: slice })
      if (error) throw error
      const rows = new Map((data as ({ user_id: string } & SocialLinksRow)[] | null ?? []).map((r) => [r.user_id, r]))
      for (const id of slice) {
        const r = rows.get(id)
        const row: SocialLinksRow = r ? { instagram_url: r.instagram_url, facebook_url: r.facebook_url } : NONE
        for (const w of batch.get(id) ?? []) w.resolve(row)
      }
    }
  } catch (e) {
    for (const ws of batch.values()) for (const w of ws) w.reject(e)
  }
}

/** One request for every profile that asked within the same moment (a list of 30 people costs one call). */
function loadBatched(id: string): Promise<SocialLinksRow> {
  return new Promise((resolve, reject) => {
    pending.set(id, [...(pending.get(id) ?? []), { resolve, reject }])
    timer ??= setTimeout(() => void flush(), 15)
  })
}

/** The links another member lets the signed-in member see (the database decides: visibility, connections, blocks). */
export function useSocialLinks(userId: string | null | undefined) {
  const me = useUserId()
  return useQuery({
    queryKey: ['social-links', me, userId],
    enabled: !!me && !!userId,
    staleTime: 60_000,
    queryFn: () => loadBatched(userId!),
  })
}

export function useMySocialLinks() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['my-social-links', uid],
    enabled: !!uid,
    queryFn: async (): Promise<MySocialLinks> => {
      const { data, error } = await supabase.from('profile_social_links').select('instagram_url, facebook_url, instagram_visibility, facebook_visibility').eq('user_id', uid!).maybeSingle()
      if (error) throw error
      return (data as MySocialLinks | null) ?? { instagram_url: null, facebook_url: null, instagram_visibility: 'verified', facebook_visibility: 'verified' }
    },
  })
}

export function useSaveSocialLinks() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: MySocialLinks) => {
      // update-then-insert (an upsert would also try to write user_id, which members cannot change)
      const upd = await supabase.from('profile_social_links').update(v).eq('user_id', uid!).select('user_id')
      if (upd.error) throw upd.error
      if (upd.data.length) return
      const { error } = await supabase.from('profile_social_links').insert({ user_id: uid!, ...v })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['my-social-links', uid] }), qc.invalidateQueries({ queryKey: ['social-links'] })])
    },
  })
}
