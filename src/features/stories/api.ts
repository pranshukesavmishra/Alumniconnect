// Stories and highlights: types, queries, and the posting flow. Every rule that matters is enforced by the database (see
// supabase/migrations/20261019000081_stories.sql); the checks here only save a round trip and explain things in plain words.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { tr, type MsgKey } from '../../i18n'
import { friendlyError } from '../../lib/errors'
import { compressImageSizes, THUMB_SIZE } from '../../lib/image'
import { supabase } from '../../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { sendVideoToDrive, UploadRefused } from '../photos/driveUpload'
import { placeholderPoster, readVideoInfo, videoMime, type VideoInfo } from '../photos/video'
import { normalizeLink, storyVideoProblem, type Audience, type BgKey, type FeedRing, type StoryKind, type StoryVideoProblem } from './rules'

export interface StoryCard {
  id: string
  owner_id: string
  is_official: boolean
  owner_name: string | null
  owner_avatar: string | null
  kind: StoryKind
  audience: Audience
  event_id: string | null
  group_id: string | null
  caption: string | null
  text_body: string | null
  bg_key: string | null
  media_path: string | null
  thumb_path: string | null
  mime_type: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  link_url: string | null
  link_label: string | null
  created_at: string
  expires_at: string
  is_hidden: boolean
  ready: boolean
  seen: boolean
  hearted: boolean
  mine: boolean
  /** only for the owner (and official-story admins) */
  views: number | null
  hearts: number | null
  in_highlight: boolean
}

export interface AdminStoryCard extends StoryCard {
  active: boolean
  event_title: string | null
  group_name: string | null
  notified_at: string | null
  notified_count: number | null
  highlights: number
}

export interface HighlightCover {
  kind: StoryKind
  thumb_path: string | null
  bg_key: string | null
  text_body: string | null
}
export interface HighlightLite {
  id: string
  title: string
  audience: 'inherit' | 'all' | 'connections'
  is_official: boolean
  owner_id: string
  mine: boolean
  sort_order: number
  cover_story_id: string | null
  count: number
  cover: HighlightCover | null
}
export interface HighlightDetail {
  highlight: Omit<HighlightLite, 'sort_order' | 'count' | 'cover'>
  stories: StoryCard[]
}

export interface Viewer {
  viewer_id: string
  full_name: string
  avatar_url: string | null
  viewed_at: string
  hearted: boolean
}

/** Errors from the story functions carry a hint that names a translated message; everything else goes through friendlyError. */
export function storyError(e: unknown): string {
  const hint = (e as { hint?: string } | null)?.hint
  if (hint && /^stories\.err/.test(hint)) return tr(hint as MsgKey)
  if (e instanceof UploadRefused) return e.message === 'drive-not-set-up' ? tr('stories.errNoDrive') : e.message
  return friendlyError(e)
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as never)
  if (error) throw error
  return data as T
}

// ------------------------------------------------------------------ the row on Home
export function useStoryFeed() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['stories', 'feed', uid],
    enabled: !!uid,
    staleTime: 45_000,
    refetchInterval: 5 * 60_000,
    queryFn: () => call<FeedRing[]>('stories_feed'),
  })
}

export type StorySource = { type: 'official' } | { type: 'owner'; id: string } | { type: 'highlight'; id: string }
export const sourceKey = (s: StorySource) => (s.type === 'official' ? 'official' : `${s.type}:${s.id}`)

export interface SourceStories {
  stories: StoryCard[]
  /** a highlight's own details */
  highlight?: HighlightDetail['highlight']
}

export function useSourceStories(source: StorySource | null, enabled = true) {
  const uid = useUserId()
  return useQuery({
    queryKey: ['stories', 'source', uid, source ? sourceKey(source) : null],
    enabled: !!source && !!uid && enabled,
    staleTime: 20_000,
    retry: 1,
    queryFn: async (): Promise<SourceStories> => {
      if (source!.type === 'highlight') {
        const d = await call<HighlightDetail>('highlight_stories', { p_id: source!.id })
        return { stories: d.stories, highlight: d.highlight }
      }
      const stories = await call<StoryCard[]>('stories_of', source!.type === 'official' ? { p_official: true } : { p_owner: source!.id, p_official: false })
      return { stories }
    },
  })
}

// ------------------------------------------------------------------ avatar rings (directory, profile): one request for everyone on screen
export interface RingInfo {
  story_count: number
  unseen_count: number
}
type Waiter = { resolve: (r: RingInfo | null) => void; reject: (e: unknown) => void }
const pending = new Map<string, Waiter[]>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  timer = null
  const batch = new Map(pending)
  pending.clear()
  const ids = [...batch.keys()]
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200)
      const rows = await call<({ user_id: string } & RingInfo)[]>('story_rings', { p_ids: slice })
      const by = new Map((rows ?? []).map((r) => [r.user_id, r]))
      for (const id of slice) for (const w of batch.get(id) ?? []) w.resolve(by.get(id) ?? null)
    }
  } catch (e) {
    for (const ws of batch.values()) for (const w of ws) w.reject(e)
  }
}

function loadRing(id: string): Promise<RingInfo | null> {
  return new Promise((resolve, reject) => {
    pending.set(id, [...(pending.get(id) ?? []), { resolve, reject }])
    timer ??= setTimeout(() => void flush(), 15)
  })
}

/** Does this member have an active story the signed-in person may watch? (null = no.) */
export function useStoryRing(userId: string | null | undefined, enabled = true) {
  const me = useUserId()
  return useQuery({
    queryKey: ['stories', 'ring', me, userId],
    enabled: !!me && !!userId && enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => loadRing(userId!),
  })
}

// ------------------------------------------------------------------ mine
export function useMyStories() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['stories', 'mine', uid],
    enabled: !!uid,
    staleTime: 30_000,
    queryFn: () => call<StoryCard[]>('my_stories'),
  })
}

export function useStoryViewers(storyId: string | null) {
  return useQuery({
    queryKey: ['stories', 'viewers', storyId],
    enabled: !!storyId,
    staleTime: 10_000,
    queryFn: () => call<Viewer[]>('story_viewers', { p_story: storyId }),
  })
}

export function useMutedPeople() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['stories', 'mutes', uid],
    enabled: !!uid,
    queryFn: () => call<{ muted_user: string; full_name: string; avatar_url: string | null }[]>('my_story_mutes'),
  })
}

// ------------------------------------------------------------------ the pictures (private bucket: short-lived signed addresses)
export function useStoryUrls(cards: readonly Pick<StoryCard, 'media_path' | 'thumb_path'>[]) {
  const paths = [...new Set(cards.flatMap((c) => [c.media_path, c.thumb_path]).filter((p): p is string => !!p))].sort()
  return useQuery({
    queryKey: ['stories', 'urls', paths.join('|')],
    enabled: paths.length > 0,
    staleTime: 40 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from('stories').createSignedUrls(paths, 3600)
      if (error) throw error
      const out: Record<string, string> = {}
      for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl
      return out
    },
  })
}

// ------------------------------------------------------------------ small actions
function useInvalidateStories() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['stories'] })
}

export function useMarkSeen() {
  return useMutation({ mutationFn: (id: string) => call<null>('mark_story_seen', { p_story: id }) })
}

export function useToggleHeart() {
  return useMutation({ mutationFn: (id: string) => call<{ hearted: boolean }>('toggle_story_heart', { p_story: id }) })
}

/** The heart on a story: shows the change at once and puts it back if the database says no. */
export function useHeartState(story: StoryCard | undefined) {
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const m = useToggleHeart()
  const on = story ? (override[story.id] ?? story.hearted) : false
  return {
    on,
    async toggle() {
      if (!story) return
      const id = story.id
      const before = on
      setOverride((o) => ({ ...o, [id]: !before }))
      try {
        const r = await m.mutateAsync(id)
        setOverride((o) => ({ ...o, [id]: r.hearted }))
      } catch (e) {
        setOverride((o) => ({ ...o, [id]: before }))
        throw e
      }
    },
  }
}

export function useMuteOwner() {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (v: { user: string; mute: boolean }) => call<null>('mute_story_owner', { p_user: v.user, p_mute: v.mute }),
    onSuccess: inv,
  })
}

export function useReportStory() {
  return useMutation({ mutationFn: (v: { id: string; reason: string }) => call<null>('report_story', { p_story: v.id, p_reason: v.reason }) })
}

export function useDeleteStory() {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: async (id: string) => {
      const paths = await call<string[]>('delete_story', { p_story: id })
      if (paths?.length) void supabase.storage.from('stories').remove(paths)
    },
    onSuccess: inv,
  })
}

// ------------------------------------------------------------------ posting
export interface NewStory {
  kind: StoryKind
  official: boolean
  audience: Audience
  eventId?: string | null
  groupId?: string | null
  caption: string
  text?: string
  bg?: BgKey
  file?: File | null
  /** read from the file when it was chosen */
  video?: VideoInfo | null
  link?: string
  linkLabel?: string
}

export type PostStage = 'photo' | 'saving' | 'sending'
export interface PostHooks {
  onStage?: (s: PostStage) => void
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  /** remembered between attempts of the same video (so a retry carries on) */
  session?: { url?: string; offset?: number }
}

const extOf = (type: string) => (type === 'image/webp' ? 'webp' : 'jpg')

async function putFile(path: string, blob: Blob, contentType: string) {
  const { error } = await supabase.storage.from('stories').upload(path, blob, { contentType, upsert: false, cacheControl: '3600' })
  if (error) throw error
}

/** Reads a video on the phone: its length, size and a poster; and says what is wrong with it (if anything). */
export async function prepareStoryVideo(file: File): Promise<{ info: VideoInfo; problem: StoryVideoProblem | null }> {
  const info = await readVideoInfo(file)
  return { info, problem: storyVideoProblem(file, info.duration_ms) }
}

/** Sends a story: compresses the picture on the phone, saves it, and for a video sends the file to Drive. Returns the new story's id. */
export async function postStory(n: NewStory, uid: string, hooks: PostHooks = {}): Promise<string> {
  const id = crypto.randomUUID()
  const body: Record<string, unknown> = {
    id,
    kind: n.kind,
    official: n.official,
    audience: n.audience,
    event_id: n.audience === 'event' ? n.eventId : null,
    group_id: n.audience === 'group' ? n.groupId : null,
    caption: n.caption.trim() || null,
  }
  if (n.official && n.link?.trim()) {
    body.link_url = normalizeLink(n.link)
    body.link_label = n.linkLabel?.trim() || null
  }
  const uploaded: string[] = []
  try {
    if (n.kind === 'text') {
      body.text_body = n.text?.trim()
      body.bg_key = n.bg ?? 'indigo'
    } else if (n.kind === 'photo') {
      if (!n.file) throw new Error('No photo')
      hooks.onStage?.('photo')
      const [main, thumb] = await compressImageSizes(n.file, [
        { maxSide: 1600, quality: 0.82 },
        { maxSide: THUMB_SIZE, quality: 0.7 },
      ])
      const mainPath = `${uid}/${id}-main.${extOf(main!.type)}`
      const thumbPath = `${uid}/${id}-thumb.${extOf(thumb!.type)}`
      await putFile(mainPath, main!.blob, main!.type)
      uploaded.push(mainPath)
      await putFile(thumbPath, thumb!.blob, thumb!.type)
      uploaded.push(thumbPath)
      Object.assign(body, { media_path: mainPath, thumb_path: thumbPath, width: main!.width, height: main!.height })
    } else {
      if (!n.file || !n.video) throw new Error('No video')
      const mime = videoMime(n.file)
      if (!mime) throw new Error('Unsupported video')
      hooks.onStage?.('photo')
      const poster = n.video.placeholder ? (await placeholderPoster()) : n.video.poster
      const posterPath = `${uid}/${id}-poster.${extOf(poster.type)}`
      await putFile(posterPath, poster.blob, poster.type)
      uploaded.push(posterPath)
      Object.assign(body, { thumb_path: posterPath, mime_type: mime, size_bytes: n.file.size, duration_ms: n.video.duration_ms, width: n.video.width, height: n.video.height })
    }
    hooks.onStage?.('saving')
    await call<string>('create_story', { p: body })
  } catch (e) {
    if (uploaded.length) void supabase.storage.from('stories').remove(uploaded)
    throw e
  }
  if (n.kind === 'video') {
    try {
      hooks.onStage?.('sending')
      await sendVideoToDrive({ target: { kind: 'story', id }, file: n.file!, mime: videoMime(n.file!)!, onProgress: hooks.onProgress, signal: hooks.signal, session: hooks.session })
    } catch (e) {
      // a video that did not arrive (or was cancelled) is not left half-posted
      void supabase.rpc('delete_story', { p_story: id }).then(() => supabase.storage.from('stories').remove(uploaded))
      throw e
    }
  }
  return id
}

export function usePostStory() {
  const uid = useUserId()
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (v: { story: NewStory; hooks?: PostHooks }) => postStory(v.story, uid!, v.hooks),
    onSuccess: inv,
  })
}

// ------------------------------------------------------------------ highlights
export function useHighlights(who: { owner: string } | { official: true } | null) {
  const uid = useUserId()
  const key = !who ? null : 'official' in who ? 'official' : who.owner
  return useQuery({
    queryKey: ['stories', 'highlights', uid, key],
    enabled: !!uid && !!who,
    staleTime: 60_000,
    queryFn: () => call<HighlightLite[]>('highlights_of', who && 'official' in who ? { p_official: true } : { p_owner: (who as { owner: string }).owner, p_official: false }),
  })
}

export function useSaveHighlight(official: boolean) {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (v: { id?: string | null; title: string; audience?: 'inherit' | 'all' | 'connections'; cover?: string | null }) =>
      call<string>(official ? 'admin_highlight_save' : 'save_highlight', { p_id: v.id ?? null, p_title: v.title, p_audience: v.audience ?? 'inherit', p_cover: v.cover ?? null }),
    onSuccess: inv,
  })
}

export function useSetHighlightItems(official: boolean) {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (v: { id: string; ids: string[] }) => call<null>(official ? 'admin_highlight_items' : 'set_highlight_items', { p_id: v.id, p_story_ids: v.ids }),
    onSuccess: inv,
  })
}

export function useAddToHighlight() {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (v: { highlight: string; story: string }) => call<null>('add_story_to_highlight', { p_highlight: v.highlight, p_story: v.story }),
    onSuccess: inv,
  })
}

export function useDeleteHighlight(official: boolean) {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (id: string) => call<null>(official ? 'admin_highlight_delete' : 'delete_highlight', { p_id: id }),
    onSuccess: inv,
  })
}

export function useReorderHighlights(official: boolean) {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: (ids: string[]) => call<null>(official ? 'admin_highlight_reorder' : 'reorder_highlights', { p_ids: ids }),
    onSuccess: inv,
  })
}

// ------------------------------------------------------------------ admin
export function useAdminStories(scope: 'all' | 'active' | 'expired' = 'all') {
  return useQuery({
    queryKey: ['stories', 'admin', scope],
    staleTime: 15_000,
    queryFn: () => call<AdminStoryCard[]>('admin_story_list', { p_scope: scope }),
  })
}

export function useAudienceCount(audience: Audience, eventId: string | null, groupId: string | null, enabled: boolean) {
  const ok = enabled && (audience === 'all' || (audience === 'event' && !!eventId) || (audience === 'group' && !!groupId))
  return useQuery({
    queryKey: ['stories', 'audience-count', audience, eventId, groupId],
    enabled: ok,
    staleTime: 30_000,
    queryFn: () => call<number>('admin_story_audience_count', { p_audience: audience, p_event: eventId, p_group: groupId }),
  })
}

export function useNotifyStory() {
  const inv = useInvalidateStories()
  return useMutation({ mutationFn: (id: string) => call<number>('admin_story_notify', { p_story: id }), onSuccess: inv })
}

export function useCleanupStories() {
  const inv = useInvalidateStories()
  return useMutation({
    mutationFn: async () => {
      const r = await call<{ deleted: number; paths: string[] }>('admin_stories_cleanup')
      if (r.paths?.length) await supabase.storage.from('stories').remove(r.paths)
      return r
    },
    onSuccess: inv,
  })
}

export function useStoryEvents() {
  return useQuery({
    queryKey: ['stories', 'pick-events'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('id, title, starts_at').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as { id: string; title: string; starts_at: string | null }[]
    },
  })
}

export function useStoryGroups() {
  return useQuery({
    queryKey: ['stories', 'pick-groups'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('groups').select('id, name, kind').eq('is_approved', true).order('name').limit(400)
      if (error) throw error
      return data as { id: string; name: string; kind: string }[]
    },
  })
}
