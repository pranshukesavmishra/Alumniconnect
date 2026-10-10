-- VIDEOS in the event photo area and the college gallery. Every video file lives in the committee's Google Drive (uploaded straight from
-- the phone with a resumable upload started by the drive-upload edge function) and is played inside the app through the drive-media
-- edge function, which checks who may see the row and passes HTTP Range requests on. Nothing but the small poster image is kept in Supabase.
--
--   event_photos / gallery_photos   + media_kind (photo | video), duration_ms, mime_type, size_bytes (<= 500 MB), drive_file_id (gallery)
--   the poster (a still from the first frame, made on the phone) is the row's thumb_path, so every thumbnail grid keeps working
--   a video row is "playable" once drive_file_id is set (the edge function sets it after it has verified the Drive file)
--   drive_roots                     the Drive folders for the gallery and the glimpses (private: only the edge functions read it)
--   event_photo_settings            member_uploads gains 'off' (only the team adds photos: used by the past-meet archives)
--
-- Videos follow exactly the same rules as photos: who sees them (can_view_event_photos), approval, official vs member, hearts, tags,
-- reports, hide / delete (photos_moderate) and the gallery (gallery_manage). Only photos can go into a "best photo" vote.
-- Idempotent and line-ending safe (every patched fragment sits on one line).

create or replace function pg_temp.patch(p_fn text, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f';
  if position(p_to in def) > 0 then return; end if;  -- already applied
  new_def := replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

-- ------------------------------------------------------------------ Drive folders for things that belong to no event
create table if not exists public.drive_roots (
  key text primary key check (key in ('gallery', 'glimpses')),
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  created_at timestamptz not null default now()
);
alter table public.drive_roots enable row level security;
revoke all on public.drive_roots from anon, authenticated, public;

-- ------------------------------------------------------------------ columns
alter table public.event_photos
  add column if not exists media_kind text not null default 'photo' check (media_kind in ('photo', 'video')),
  add column if not exists duration_ms int check (duration_ms is null or duration_ms between 0 and 14400000),
  add column if not exists mime_type text check (mime_type is null or mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes between 1 and 524288000);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_photos_media_shape') then
    alter table public.event_photos add constraint event_photos_media_shape check (
      (media_kind = 'photo' and mime_type is null and duration_ms is null and size_bytes is null)
      or (media_kind = 'video' and mime_type is not null and size_bytes is not null));
  end if;
end $$;
create index if not exists event_photos_media_idx on public.event_photos (event_id, media_kind, status);

alter table public.gallery_photos
  add column if not exists media_kind text not null default 'photo' check (media_kind in ('photo', 'video')),
  add column if not exists duration_ms int check (duration_ms is null or duration_ms between 0 and 14400000),
  add column if not exists mime_type text check (mime_type is null or mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes between 1 and 524288000),
  add column if not exists drive_file_id text check (drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$');
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gallery_photos_media_shape') then
    alter table public.gallery_photos add constraint gallery_photos_media_shape check (
      (media_kind = 'photo' and mime_type is null and duration_ms is null and size_bytes is null and drive_file_id is null)
      or (media_kind = 'video' and mime_type is not null and size_bytes is not null));
  end if;
end $$;

-- a gallery video whose upload has not finished is seen by curators only
drop policy if exists "verified read gallery" on public.gallery_photos;
create policy "verified read gallery" on public.gallery_photos for select to authenticated
  using (public.is_verified() and (media_kind = 'photo' or drive_file_id is not null or public._admin_can('gallery_manage')));
select pg_temp.patch('gallery_on_this_day', $$where g.taken_on is not null and extract$$, $$where (g.media_kind = 'photo' or g.drive_file_id is not null) and g.taken_on is not null and extract$$);

-- members choose only what they may choose; media fields are validated by the insert trigger below (drive_file_id only the edge function sets)
revoke insert on public.event_photos from authenticated;
grant insert (id, event_id, uploaded_by, storage_path, thumb_path, width, height, caption, caption_hi, alt_text, kind, content_hash,
              media_kind, duration_ms, mime_type, size_bytes) on public.event_photos to authenticated;

-- ------------------------------------------------------------------ "only the team adds photos" (past-meet archives)
alter table public.event_photo_settings drop constraint if exists event_photo_settings_member_uploads_check;
alter table public.event_photo_settings add constraint event_photo_settings_member_uploads_check check (member_uploads in ('immediate', 'approval', 'off'));
select pg_temp.patch('admin_set_photo_settings', $$p_member_uploads not in ('immediate', 'approval')$$, $$p_member_uploads not in ('immediate', 'approval', 'off')$$);

-- ------------------------------------------------------------------ the insert trigger: source / status are decided here; videos are checked
create or replace function public._photo_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_official boolean := public.has_event_cap('photos', new.event_id);
  v_mode text := public._photo_mode(new.event_id);
begin
  new.source := case when v_official then 'official' else 'member' end;
  new.status := case when v_official or v_mode = 'immediate' then 'approved' else 'pending' end;
  new.is_hidden := false;
  new.sort_order := 0;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.drive_file_id := null;
  if not v_official and v_mode = 'off' then
    raise exception 'Only the organising team adds photos and videos here.' using errcode = 'P0001', hint = 'photos.errUploadsOff';
  end if;
  if new.media_kind = 'video' then
    if new.mime_type is null or new.size_bytes is null then
      raise exception 'This video is missing its details' using errcode = 'P0001', hint = 'photos.errVideoFormat';
    end if;
    if new.size_bytes > 524288000 then
      raise exception 'Videos can be up to 500 MB' using errcode = 'P0001', hint = 'photos.errVideoBig';
    end if;
    if not exists (select 1 from public.event_settings s where s.event_id = new.event_id and s.drive_folder_id is not null) then
      raise exception 'Videos need the Drive archive, which is not set up for this event yet.' using errcode = 'P0001', hint = 'photos.errVideoNoDrive';
    end if;
    if not v_official and (select count(*) from public.event_photos p
          where p.uploaded_by = new.uploaded_by and p.event_id = new.event_id and p.media_kind = 'video' and p.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'You can add up to 10 videos an hour. Please try again a little later.' using errcode = 'P0001', hint = 'photos.errVideoRate';
    end if;
  else
    new.mime_type := null;
    new.duration_ms := null;
    new.size_bytes := null;
    if not v_official and (select count(*) from public.event_photos p
          where p.uploaded_by = new.uploaded_by and p.event_id = new.event_id and p.media_kind = 'photo' and p.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You can add up to 60 photos an hour. Please try again a little later.' using errcode = 'P0001', hint = 'photos.errRate';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public._photo_before_insert() from anon, authenticated, public;

-- only photos go into a "best photo" vote
select pg_temp.patch('admin_open_photo_vote', $$and p.id = any (p_photos) and not p.is_hidden and p.status = 'approved') <> n then$$,
                                              $$and p.id = any (p_photos) and p.media_kind = 'photo' and not p.is_hidden and p.status = 'approved') <> n then$$);

-- ------------------------------------------------------------------ reading
create or replace function public.photo_caps(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'view', coalesce(public.can_view_event_photos(p_event), false),
    'official', public.has_event_cap('photos', p_event),
    'gallery', public._admin_can('gallery_manage'),
    'member_uploads', public._photo_mode(p_event),
    'drive', exists (select 1 from public.event_settings s where s.event_id = p_event and s.drive_folder_id is not null));
end $$;

drop function if exists public.event_photos_list(uuid, text, text, text, int, text, uuid, int, int);
create or replace function public.event_photos_list(
  p_event uuid, p_scope text default 'approved', p_kind text default null, p_source text default null,
  p_batch int default null, p_order text default 'curated', p_id uuid default null, p_limit int default 48, p_offset int default 0,
  p_media text default null)
returns table (id uuid, event_id uuid, event_slug text, event_title text, uploaded_by uuid, uploader_name text, storage_path text, thumb_path text,
  width int, height int, caption text, caption_hi text, alt_text text, kind text, source text, status text, is_hidden boolean, sort_order int,
  created_at timestamptz, hearts int, hearted boolean, tag_count int, report_count int, tagged_me boolean,
  media_kind text, duration_ms int, mime_type text, size_bytes bigint, playable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_cap boolean := false;
  v_verified boolean := public.is_verified();
begin
  if v_me is null then raise exception 'Please sign in' using errcode = '42501'; end if;
  if p_event is null then
    if p_scope <> 'tagged' then raise exception 'Choose an event' using errcode = '22023'; end if;
  else
    if not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
    v_cap := public.has_event_cap('photos', p_event);
  end if;
  if p_scope in ('pending', 'hidden', 'reported') and not v_cap then raise exception 'You do not have permission to do this' using errcode = '42501'; end if;
  if p_media is not null and p_media not in ('photo', 'video') then raise exception 'Unknown media type' using errcode = '22023'; end if;
  return query
  select p.id, p.event_id, e.slug, e.title, p.uploaded_by, case when p.source = 'member' and (v_verified or v_cap) then u.full_name else null end,
         p.storage_path, p.thumb_path, p.width, p.height, p.caption, p.caption_hi, p.alt_text, p.kind, p.source, p.status, p.is_hidden, p.sort_order, p.created_at,
         (select count(*)::int from public.photo_hearts h where h.photo_id = p.id),
         exists (select 1 from public.photo_hearts h where h.photo_id = p.id and h.user_id = v_me),
         (select count(*)::int from public.photo_tags t where t.photo_id = p.id),
         case when v_cap then (select count(*)::int from public.reports r where r.target_type = 'photo' and r.target_id = p.id and r.status = 'open') else 0 end,
         exists (select 1 from public.photo_tags t where t.photo_id = p.id and t.tagged_user = v_me),
         p.media_kind, p.duration_ms, p.mime_type, p.size_bytes,
         (p.media_kind = 'photo' or p.drive_file_id is not null)
    from public.event_photos p
    join public.profiles u on u.id = p.uploaded_by
    join public.events e on e.id = p.event_id
   where (p_event is null or p.event_id = p_event)
     and (p_event is not null or public.can_view_event_photos(p.event_id))
     and (p_id is null or p.id = p_id)
     and (p_kind is null or p.kind = p_kind)
     and (p_source is null or p.source = p_source)
     and (p_media is null or p.media_kind = p_media)
     -- a video whose upload never finished is shown to its owner and the managers only
     and (p.media_kind = 'photo' or p.drive_file_id is not null or p.uploaded_by = v_me or v_cap)
     and case p_scope
           when 'approved' then (not p.is_hidden and p.status = 'approved') or (p_id is not null and (p.uploaded_by = v_me or v_cap))
           when 'pending' then p.status = 'pending' and not p.is_hidden
           when 'hidden' then p.is_hidden
           when 'reported' then exists (select 1 from public.reports r where r.target_type = 'photo' and r.target_id = p.id and r.status = 'open')
           when 'mine' then p.uploaded_by = v_me
           when 'tagged' then not p.is_hidden and p.status = 'approved' and exists (select 1 from public.photo_tags t where t.photo_id = p.id and t.tagged_user = v_me)
           else false end
     and (p_batch is null or exists (select 1 from public.photo_tags t join public.profiles tp on tp.id = t.tagged_user where t.photo_id = p.id and tp.grad_year = p_batch))
   order by case when p_order = 'curated' then (p.sort_order = 0) end, case when p_order = 'curated' then p.sort_order end, p.created_at desc, p.id
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.photo_summary(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved'),
    'official', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved' and p.source = 'official'),
    'members', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved' and p.source = 'member'),
    'videos', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved' and p.media_kind = 'video'
                  and p.drive_file_id is not null),
    'pending', case when public.has_event_cap('photos', p_event) then (select count(*) from public.event_photos p where p.event_id = p_event and p.status = 'pending' and not p.is_hidden) end,
    'hidden', case when public.has_event_cap('photos', p_event) then (select count(*) from public.event_photos p where p.event_id = p_event and p.is_hidden) end,
    'reported', case when public.has_event_cap('photos', p_event) then (select count(distinct r.target_id) from public.reports r join public.event_photos p on p.id = r.target_id
                                                                          where r.target_type = 'photo' and r.status = 'open' and p.event_id = p_event) end);
end $$;

-- ------------------------------------------------------------------ the college gallery: videos
-- A video comes in two ways: from an event video (the Drive file is shared, nothing is copied) or as a new upload (the row is made
-- first; the drive-upload function sets drive_file_id once the file has landed in Drive).
create or replace function public.admin_gallery_add(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_path text := p ->> 'storage_path';
  v_thumb text := p ->> 'thumb_path';
  v_kind text := coalesce(nullif(p ->> 'media_kind', ''), 'photo');
  v_mime text := nullif(p ->> 'mime_type', '');
  v_size bigint := nullif(p ->> 'size_bytes', '')::bigint;
  v_dur int := nullif(p ->> 'duration_ms', '')::int;
  v_drive text;
  v_source uuid := nullif(p ->> 'source_photo_id', '')::uuid;
  v_src public.event_photos;
  v_cat uuid := nullif(p ->> 'category_id', '')::uuid;
  v_album uuid := nullif(p ->> 'album_id', '')::uuid;
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_sug public.gallery_suggestions;
  v_featured boolean := coalesce((p ->> 'is_featured')::boolean, false);
begin
  perform public._require_gallery();
  if v_kind not in ('photo', 'video') then raise exception 'Unknown media type' using errcode = 'P0001'; end if;
  if v_path is null or v_thumb is null or v_path not like 'gallery/%' or v_thumb not like 'gallery/%' then raise exception 'Upload the photo first' using errcode = 'P0001'; end if;
  if v_kind = 'video' then
    if v_source is not null then
      select * into v_src from public.event_photos x where x.id = v_source and x.media_kind = 'video' and x.drive_file_id is not null;
      if not found then raise exception 'That video is not ready yet' using errcode = 'P0001', hint = 'gallery.errVideo'; end if;
      v_mime := v_src.mime_type; v_size := v_src.size_bytes; v_dur := v_src.duration_ms; v_drive := v_src.drive_file_id;
    elsif v_mime is null or v_mime not in ('video/mp4', 'video/webm', 'video/quicktime') or v_size is null or v_size < 1 or v_size > 524288000 then
      raise exception 'Gallery videos are MP4, MOV or WebM files up to 500 MB' using errcode = 'P0001', hint = 'gallery.errVideo';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'gallery' and o.name = v_thumb) then
      raise exception 'The poster image was not found. Please try again.' using errcode = 'P0001';
    end if;
  else
    v_mime := null; v_size := null; v_dur := null;
    if (select count(*) from storage.objects o where o.bucket_id = 'gallery' and o.name in (v_path, v_thumb)) <> (case when v_path = v_thumb then 1 else 2 end) then
      raise exception 'The photo file was not found. Please upload it again.' using errcode = 'P0001';
    end if;
  end if;
  if v_cat is not null and not exists (select 1 from public.gallery_categories c where c.id = v_cat) then raise exception 'Choose a chip from the list' using errcode = 'P0001'; end if;
  if v_album is not null and not exists (select 1 from public.gallery_albums a where a.id = v_album) then raise exception 'Choose an album from the list' using errcode = 'P0001'; end if;
  if v_event is not null and not exists (select 1 from public.events e where e.id = v_event) then v_event := null; end if;
  insert into public.gallery_photos (storage_path, thumb_path, width, height, title, title_hi, alt_text, category_id, album_id, event_id, source_photo_id,
                                     is_featured, featured_at, taken_on, created_by, media_kind, mime_type, size_bytes, duration_ms, drive_file_id)
  values (v_path, v_thumb, (p ->> 'width')::int, (p ->> 'height')::int, nullif(btrim(left(p ->> 'title', 120)), ''), nullif(btrim(left(p ->> 'title_hi', 120)), ''),
          nullif(btrim(left(p ->> 'alt_text', 300)), ''), v_cat, v_album, v_event, v_source,
          v_featured, case when v_featured then now() end, nullif(p ->> 'taken_on', '')::date, auth.uid(), v_kind, v_mime, v_size, v_dur, v_drive)
  returning id into v_id;
  if nullif(p ->> 'suggestion_id', '') is not null then
    update public.gallery_suggestions s set status = 'approved', handled_by = auth.uid(), handled_at = now()
     where s.id = (p ->> 'suggestion_id')::uuid and s.status = 'pending' returning * into v_sug;
    if found then perform public._notify(v_sug.suggested_by, 'gallery_approved', null, v_id, null); end if;
  end if;
  perform public._audit('gallery_add', 'gallery_photos', v_id, jsonb_build_object('event', v_event, 'from_suggestion', nullif(p ->> 'suggestion_id', '') is not null, 'media', v_kind));
  return v_id;
end $$;

drop function if exists public.admin_gallery_suggestions();
create or replace function public.admin_gallery_suggestions()
returns table (id uuid, photo_id uuid, event_id uuid, event_title text, storage_path text, thumb_path text, width int, height int, caption text,
               suggested_by uuid, suggester_name text, note text, created_at timestamptz,
               media_kind text, mime_type text, size_bytes bigint, duration_ms int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  return query
  select s.id, s.photo_id, p.event_id, e.title, p.storage_path, p.thumb_path, p.width, p.height, p.caption, s.suggested_by, u.full_name, s.note, s.created_at,
         p.media_kind, p.mime_type, p.size_bytes, p.duration_ms
    from public.gallery_suggestions s
    join public.event_photos p on p.id = s.photo_id
    join public.events e on e.id = p.event_id
    join public.profiles u on u.id = s.suggested_by
   where s.status = 'pending' order by s.created_at limit 200;
end $$;

-- ------------------------------------------------------------------ grants: explicit, authenticated only
do $$
declare
  f text;
begin
  foreach f in array array['photo_caps(uuid)', 'event_photos_list(uuid,text,text,text,int,text,uuid,int,int,text)', 'photo_summary(uuid)',
                           'admin_gallery_add(jsonb)', 'admin_gallery_suggestions()'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
