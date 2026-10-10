import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useUserId } from '../auth/AuthProvider'
import { compressImageSizes } from '../../lib/image'
import { supabase } from '../../lib/supabase'

export interface Author {
  id: string
  full_name: string
  avatar_url: string | null
  grad_year: number | null
  branch: string | null
  current_title: string | null
  current_company: string | null
  verification: string
}

export interface Group {
  id: string
  kind: 'batch' | 'year' | 'circle' | 'channel' | 'official' | 'department' | 'meetup'
  slug: string
  name: string
  description: string | null
  icon: string | null
  grad_year: number | null
  branch: string | null
  is_official: boolean
  is_approved: boolean
  member_count: number
  post_mode?: 'everyone' | 'staff_only'
  comments_allowed?: boolean
}

export interface Post {
  id: string
  author_id: string
  group_id: string | null
  body: string
  link_url: string | null
  media: { path: string; w: number; h: number }[]
  is_pinned: boolean
  is_hidden: boolean
  like_count: number
  comment_count: number
  created_at: string
  edited_at: string | null
  author: Author
  group: Pick<Group, 'id' | 'name' | 'slug' | 'kind' | 'icon'> | null
  liked: boolean
}

export interface Comment {
  id: string
  post_id: string
  author_id: string
  body: string
  created_at: string
  author: Author
}

const AUTHOR = 'id, full_name, avatar_url, grad_year, branch, current_title, current_company, verification'
const POST_SELECT = `*, author:profiles!posts_author_id_fkey(${AUTHOR}), group:groups(id, name, slug, kind, icon)`
const PAGE = 15

export const feedKey = (scope: string) => ['feed', scope] as const

/** scope: "home" (everything I can see), "group:<id>", or "author:<id>" */
export function useFeed(scope: string, enabled = true) {
  const uid = useUserId()
  return useInfiniteQuery({
    queryKey: feedKey(scope),
    enabled: enabled && !!uid,
    initialPageParam: null as string | null,
    staleTime: 20_000,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('posts').select(POST_SELECT).eq('is_hidden', false).order('created_at', { ascending: false }).limit(PAGE)
      if (scope.startsWith('group:')) q = q.eq('group_id', scope.slice(6))
      if (scope.startsWith('author:')) q = q.eq('author_id', scope.slice(7))
      if (pageParam) q = q.lt('created_at', pageParam)
      const { data, error } = await q
      if (error) throw error
      const posts = data as unknown as Omit<Post, 'liked'>[]
      const liked = new Set<string>()
      if (posts.length) {
        const { data: likes } = await supabase.from('post_likes').select('post_id').eq('user_id', uid!).in('post_id', posts.map((p) => p.id))
        for (const l of likes ?? []) liked.add(l.post_id as string)
      }
      return posts.map((p) => ({ ...p, liked: liked.has(p.id) }))
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.created_at : null),
  })
}

type FeedData = InfiniteData<Post[], string | null>

function patchPost(qc: ReturnType<typeof useQueryClient>, id: string, fn: (p: Post) => Post) {
  qc.setQueriesData<FeedData>({ queryKey: ['feed'] }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => page.map((p) => (p.id === id ? fn(p) : p))) } : data,
  )
}

/** Likes update instantly on screen (optimistic) and roll back if the server says no. */
export function useToggleLike() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (post: Post) => {
      const { error } = post.liked
        ? await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', uid!)
        : await supabase.from('post_likes').insert({ post_id: post.id, user_id: uid })
      if (error && error.code !== '23505') throw error
    },
    onMutate: (post) => patchPost(qc, post.id, (p) => ({ ...p, liked: !post.liked, like_count: p.like_count + (post.liked ? -1 : 1) })),
    onError: (_e, post) => patchPost(qc, post.id, (p) => ({ ...p, liked: post.liked, like_count: post.like_count })),
  })
}

export function useCreatePost() {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (input: { body: string; groupId: string | null; photos: File[]; linkUrl?: string | null }) => {
      const media: Post['media'] = []
      const uploaded: string[] = []
      try {
        for (const f of input.photos.slice(0, 4)) {
          const [img] = await compressImageSizes(f, [{ maxSide: 1600, quality: 0.82 }])
          const path = `${uid}/${crypto.randomUUID()}.${img!.ext}`
          const { error } = await supabase.storage.from('post-media').upload(path, img!.blob, { contentType: img!.type })
          if (error) throw error
          uploaded.push(path)
          media.push({ path, w: img!.width, h: img!.height })
        }
        const { error } = await supabase
          .from('posts')
          .insert({ author_id: uid, group_id: input.groupId, body: input.body.trim(), media, link_url: input.linkUrl ?? null })
        if (error) throw error
      } catch (e) {
        if (uploaded.length) void supabase.storage.from('post-media').remove(uploaded)
        throw e
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['feed'] })
    },
  })
}

export function useDeletePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (post: Post) => {
      const { error } = await supabase.from('posts').delete().eq('id', post.id)
      if (error) throw error
      if (post.media.length) void supabase.storage.from('post-media').remove(post.media.map((m) => m.path))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useComments(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['comments', postId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select(`*, author:profiles!comments_author_id_fkey(${AUTHOR})`)
        .eq('post_id', postId)
        .eq('is_hidden', false)
        .order('created_at')
        .limit(200)
      if (error) throw error
      return data as unknown as Comment[]
    },
  })
}

export function useAddComment(postId: string) {
  const qc = useQueryClient()
  const uid = useUserId()
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from('comments').insert({ post_id: postId, author_id: uid, body: body.trim() })
      if (error) throw error
    },
    onSuccess: async () => {
      patchPost(qc, postId, (p) => ({ ...p, comment_count: p.comment_count + 1 }))
      await qc.invalidateQueries({ queryKey: ['comments', postId] })
    },
  })
}

export async function report(targetType: 'post' | 'comment' | 'profile' | 'message', targetId: string, reason: string) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  const { error } = await supabase.from('reports').insert({ reporter: uid, target_type: targetType, target_id: targetId, reason })
  if (error && error.code !== '23505') throw error
}

// ---------------------------------------------------------------- groups

export function useGroups() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['groups', uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const [g, m] = await Promise.all([
        supabase.from('groups').select('*').eq('is_approved', true).order('member_count', { ascending: false }),
        supabase.from('group_members').select('group_id, role').eq('user_id', uid!),
      ])
      if (g.error) throw g.error
      if (m.error) throw m.error
      const mine = new Map((m.data ?? []).map((r) => [r.group_id as string, r.role as string]))
      return (g.data as Group[]).map((x) => ({ ...x, joined: mine.has(x.id), myRole: mine.get(x.id) ?? null }))
    },
  })
}

export type GroupWithMe = NonNullable<ReturnType<typeof useGroups>['data']>[number]

export function useJoinGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; join: boolean }) => {
      const { error } = await supabase.rpc('join_group', { p_group: input.id, p_join: input.join })
      if (error) throw error
    },
    // joining/leaving changes the chat list too (every group has a chat)
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['groups'] }), qc.invalidateQueries({ queryKey: ['chats'] })]),
  })
}

// ---------------------------------------------------------------- notifications

export interface Notification {
  id: string
  kind: 'like' | 'comment' | 'connection_request' | 'connection_accepted' | 'message' | 'invite_joined' | string
  target_id: string | null
  body: string | null
  read_at: string | null
  created_at: string
  actor: Pick<Author, 'id' | 'full_name' | 'avatar_url'> | null
}

export function useNotifications() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['notifications', uid],
    enabled: !!uid,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, kind, target_id, body, read_at, created_at, actor:profiles!notifications_actor_id_fkey(id, full_name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) throw error
      return data as unknown as Notification[]
    },
  })
}

export async function markNotificationsRead() {
  await supabase.rpc('mark_notifications_read')
}
