import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { friendlyError } from '../../lib/errors'
import { compressImageSizes, PHOTO_SIZE, THUMB_SIZE } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'
import { tr, type MsgKey } from '../../i18n/core'
import { useUserId } from '../auth/AuthProvider'

// ------------------------------------------------------------------ event photos
export interface PhotoRow {
  id: string
  event_id: string
  event_slug: string
  event_title: string
  uploaded_by: string
  uploader_name: string | null
  storage_path: string
  thumb_path: string
  width: number | null
  height: number | null
  caption: string | null
  caption_hi: string | null
  alt_text: string | null
  kind: 'event' | 'throwback'
  source: 'official' | 'member'
  status: 'approved' | 'pending'
  is_hidden: boolean
  sort_order: number
  created_at: string
  hearts: number
  hearted: boolean
  tag_count: number
  report_count: number
  tagged_me: boolean
  media_kind: 'photo' | 'video'
  duration_ms: number | null
  mime_type: string | null
  size_bytes: number | null
  /** a photo, or a video whose file is in Drive (an unfinished upload is not playable) */
  playable: boolean
}

export const isVideo = (p: { media_kind: string }) => p.media_kind === 'video'

export interface PhotoCaps {
  view: boolean
  /** may upload as Official and manage this event's photos */
  official: boolean
  /** may curate the college gallery */
  gallery: boolean
  member_uploads: 'immediate' | 'approval' | 'off'
  /** the event has a Drive archive folder, so videos can be sent */
  drive: boolean
}

export interface PhotoSummary {
  total: number
  official: number
  members: number
  videos: number
  pending: number | null
  hidden: number | null
  reported: number | null
}

export type PhotoScope = 'approved' | 'pending' | 'hidden' | 'reported' | 'mine' | 'tagged'
export interface PhotoFilter {
  scope: PhotoScope
  kind?: 'event' | 'throwback' | null
  source?: 'official' | 'member' | null
  media?: 'photo' | 'video' | null
  batch?: number | null
  order?: 'curated' | 'new'
}

export const PAGE = 48

export const photoUrl = (p: Pick<PhotoRow, 'storage_path'>) => publicUrl('event-photos', p.storage_path) ?? ''
export const thumbUrl = (p: Pick<PhotoRow, 'thumb_path'>) => publicUrl('event-photos', p.thumb_path) ?? ''
export const photoQueryKey = (eventId: string | null | undefined) => ['photos', eventId ?? 'mine'] as const

/** The caption in the reader's language (Hindi when there is one and the reader chose Hindi), else English. */
export function captionOf(p: { caption: string | null; caption_hi: string | null }, lang: string): string | null {
  return (lang === 'hi' ? p.caption_hi || p.caption : p.caption || p.caption_hi) || null
}

/** Errors from the photo functions carry a hint that names a translated message; everything else goes through friendlyError. */
export function photoError(e: unknown): string {
  const hint = (e as { hint?: string } | null)?.hint
  if (hint && /^(photos|gallery)\.err/.test(hint)) return tr(hint as MsgKey)
  return friendlyError(e)
}

export function usePhotoCaps(eventId: string | undefined) {
  const uid = useUserId()
  return useQuery({
    queryKey: ['photo-caps', eventId, uid],
    enabled: !!eventId && !!uid,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('photo_caps', { p_event: eventId! })
      if (error) throw error
      return data as PhotoCaps
    },
  })
}

export async function fetchPhotos(eventId: string | null, f: PhotoFilter, offset: number, limit = PAGE, id?: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase.rpc('event_photos_list', {
    p_event: eventId,
    p_scope: f.scope,
    p_kind: f.kind ?? null,
    p_source: f.source ?? null,
    p_batch: f.batch ?? null,
    p_media: f.media ?? null,
    p_order: f.order ?? 'curated',
    p_id: id ?? null,
    p_limit: limit,
    p_offset: offset,
  } as never)
  if (error) throw error
  return (data ?? []) as PhotoRow[]
}

export function usePhotoPages(eventId: string | null | undefined, f: PhotoFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...photoQueryKey(eventId), f],
    enabled: enabled && (eventId !== undefined),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPhotos(eventId ?? null, f, pageParam),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
}

export function usePhotoSummary(eventId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['photo-summary', eventId],
    enabled: !!eventId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('photo_summary', { p_event: eventId! })
      if (error) throw error
      return data as PhotoSummary
    },
  })
}

export interface VoteCandidate {
  id: string
  thumb_path: string
  storage_path: string
  alt: string | null
  votes: number | null
}
export interface PhotoVote {
  id: string
  title: string
  closes_at: string
  closed: boolean
  winner: string | null
  my_vote: string | null
  total: number | null
  candidates: VoteCandidate[]
}
export function useCurrentVote(eventId: string | undefined) {
  return useQuery({
    queryKey: ['photo-vote', eventId],
    enabled: !!eventId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('current_photo_vote', { p_event: eventId! })
      if (error) throw error
      return (data ?? null) as PhotoVote | null
    },
  })
}

// ------------------------------------------------------------------ college gallery
export interface GalleryCategory {
  id: string
  slug: string
  label: string
  label_hi: string | null
  sort: number
}
export interface GalleryAlbum {
  id: string
  title: string
  title_hi: string | null
  description: string | null
  created_at: string
}
export interface GalleryPhoto {
  id: string
  storage_path: string
  thumb_path: string
  width: number | null
  height: number | null
  title: string | null
  title_hi: string | null
  alt_text: string | null
  category_id: string | null
  album_id: string | null
  event_id: string | null
  source_photo_id: string | null
  is_featured: boolean
  featured_at: string | null
  taken_on: string | null
  pair_of: string | null
  created_at: string
  media_kind: 'photo' | 'video'
  duration_ms: number | null
  mime_type: string | null
  size_bytes: number | null
  drive_file_id: string | null
  event?: { slug: string; title: string } | null
}
export const galleryUrl = (path: string) => publicUrl('gallery', path) ?? ''
export const galleryTitle = (p: { title: string | null; title_hi: string | null }, lang: string) => (lang === 'hi' ? p.title_hi || p.title : p.title || p.title_hi) || null
export const chipLabel = (c: { label: string; label_hi: string | null }, lang: string) => (lang === 'hi' && c.label_hi ? c.label_hi : c.label)
export const albumTitle = (a: { title: string; title_hi: string | null }, lang: string) => (lang === 'hi' && a.title_hi ? a.title_hi : a.title)

const GALLERY_SELECT = '*, event:events(slug, title)'
const GALLERY_PAGE = 60

export function useGalleryCategories(enabled = true) {
  return useQuery({
    queryKey: ['gallery-categories'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('gallery_categories').select('*').order('sort')
      if (error) throw error
      return data as GalleryCategory[]
    },
  })
}

export function useGalleryAlbums(enabled = true) {
  return useQuery({
    queryKey: ['gallery-albums'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('gallery_albums').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as GalleryAlbum[]
    },
  })
}

export function useGalleryPhotos(filter: { category?: string | null; album?: string | null }, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['gallery-photos', filter.category ?? null, filter.album ?? null],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('gallery_photos').select(GALLERY_SELECT)
      if (filter.category) q = q.eq('category_id', filter.category)
      if (filter.album) q = q.eq('album_id', filter.album)
      const { data, error } = await q
        .order('is_featured', { ascending: false })
        .order('featured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + GALLERY_PAGE - 1)
      if (error) throw error
      return data as unknown as GalleryPhoto[]
    },
    getNextPageParam: (last, all) => (last.length === GALLERY_PAGE ? all.length * GALLERY_PAGE : undefined),
  })
}

/** One photo by id, for a shared link (also loads its "Then" partner). */
export async function fetchGalleryPhoto(id: string): Promise<GalleryPhoto | null> {
  const { data, error } = await supabase.from('gallery_photos').select(GALLERY_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as unknown as GalleryPhoto | null) ?? null
}

export function useFeaturedGallery(enabled: boolean) {
  return useQuery({
    queryKey: ['gallery-featured'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('gallery_photos').select(GALLERY_SELECT).eq('is_featured', true).order('featured_at', { ascending: false }).limit(12)
      if (error) throw error
      return data as unknown as GalleryPhoto[]
    },
  })
}

export function useOnThisDay(enabled: boolean) {
  return useQuery({
    queryKey: ['gallery-on-this-day', new Date().toDateString()],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gallery_on_this_day', { p_limit: 12 })
      if (error) throw error
      return (data ?? []) as GalleryPhoto[]
    },
  })
}

export interface GallerySuggestion {
  media_kind: 'photo' | 'video'
  id: string
  photo_id: string
  event_id: string
  event_title: string
  storage_path: string
  thumb_path: string
  width: number | null
  height: number | null
  caption: string | null
  suggested_by: string
  suggester_name: string
  note: string | null
  created_at: string
}
export function useGallerySuggestions(enabled: boolean) {
  return useQuery({
    queryKey: ['gallery-suggestions'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_gallery_suggestions')
      if (error) throw error
      return (data ?? []) as GallerySuggestion[]
    },
  })
}

export interface GalleryMeta {
  title?: string
  title_hi?: string
  alt_text?: string
  category_id?: string | null
  album_id?: string | null
  event_id?: string | null
  source_photo_id?: string | null
  suggestion_id?: string | null
  is_featured?: boolean
  taken_on?: string | null
  media_kind?: 'photo' | 'video'
  mime_type?: string
  size_bytes?: number
  duration_ms?: number | null
}

/** Puts an image (a file from the device, or a copy of an event photo) into the gallery bucket and adds it to the gallery. */
export async function addToGallery(source: Blob, meta: GalleryMeta): Promise<string> {
  const [big, thumb] = await compressImageSizes(source, [
    { maxSide: PHOTO_SIZE, quality: 0.82 },
    { maxSide: THUMB_SIZE, quality: 0.75 },
  ])
  const id = crypto.randomUUID()
  const path = `gallery/${id}.${big!.ext}`
  const tpath = `gallery/${id}_t.${thumb!.ext}`
  const up: string[] = []
  try {
    const a = await supabase.storage.from('gallery').upload(path, big!.blob, { contentType: big!.type })
    if (a.error) throw a.error
    up.push(path)
    const b = await supabase.storage.from('gallery').upload(tpath, thumb!.blob, { contentType: thumb!.type })
    if (b.error) throw b.error
    up.push(tpath)
    const { data, error } = await supabase.rpc('admin_gallery_add', { p: { ...meta, storage_path: path, thumb_path: tpath, width: big!.width, height: big!.height } } as never)
    if (error) throw error
    return data as unknown as string
  } catch (e) {
    if (up.length) void supabase.storage.from('gallery').remove(up)
    throw e
  }
}

export async function addEventPhotoToGallery(p: PhotoRow, meta: GalleryMeta): Promise<string> {
  const res = await fetch(photoUrl(p))
  if (!res.ok) throw new Error(tr('gallery.errCopy'))
  return addToGallery(await res.blob(), { ...meta, event_id: p.event_id, source_photo_id: p.id, alt_text: meta.alt_text ?? p.alt_text ?? undefined })
}

/** A gallery video: the poster goes into the gallery bucket, the row is made, then the video is sent to Drive (the caller does that with the returned id). */
export async function addGalleryVideoRow(poster: Blob & { type: string }, ext: string, meta: GalleryMeta & { width?: number | null; height?: number | null }): Promise<{ id: string; remove: () => Promise<void> }> {
  const id = crypto.randomUUID()
  const tpath = `gallery/${id}_t.${ext}`
  const up = await supabase.storage.from('gallery').upload(tpath, poster, { contentType: poster.type })
  if (up.error) throw up.error
  const { data, error } = await supabase.rpc('admin_gallery_add', {
    p: { ...meta, media_kind: 'video', storage_path: `gallery/${id}.vid`, thumb_path: tpath },
  } as never)
  if (error) {
    void supabase.storage.from('gallery').remove([tpath])
    throw error
  }
  const rowId = data as unknown as string
  return {
    id: rowId,
    remove: async () => {
      await supabase.rpc('admin_gallery_remove', { p_id: rowId })
      await supabase.storage.from('gallery').remove([tpath])
    },
  }
}

/** An event video goes into the gallery without copying the video (the same Drive file), only its poster is copied. */
export async function addEventVideoToGallery(p: PhotoRow, meta: GalleryMeta): Promise<string> {
  const res = await fetch(thumbUrl(p))
  if (!res.ok) throw new Error(tr('gallery.errCopy'))
  const poster = await res.blob()
  const ext = poster.type === 'image/jpeg' ? 'jpg' : 'webp'
  const id = crypto.randomUUID()
  const tpath = `gallery/${id}_t.${ext}`
  const up = await supabase.storage.from('gallery').upload(tpath, poster, { contentType: poster.type || 'image/webp' })
  if (up.error) throw up.error
  const { data, error } = await supabase.rpc('admin_gallery_add', {
    p: { ...meta, media_kind: 'video', storage_path: `gallery/${id}.vid`, thumb_path: tpath, event_id: p.event_id, source_photo_id: p.id, width: p.width, height: p.height, alt_text: meta.alt_text ?? p.alt_text ?? undefined },
  } as never)
  if (error) {
    void supabase.storage.from('gallery').remove([tpath])
    throw error
  }
  return data as unknown as string
}
