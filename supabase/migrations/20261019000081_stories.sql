-- STORIES (24 hours) and HIGHLIGHTS: the tables, who may see a story, and the member-facing functions.
--
--   stories                 one row per story: a photo, a short video (stored in Drive, like glimpses) or a text card.
--                           Expires 24 h after posting; EXPIRY IS ENFORCED BY expires_at IN THE QUERIES AND POLICIES, not by a job.
--                           Official stories (is_official) are posted by people with the permission stories_post;
--                           personal stories by any verified member.
--   audience                all (every verified member) | connections (personal) | event (registered for an event) | group (a group's members)
--   story_views / hearts    one row per viewer per story (primary key); counts are for the owner (and official admins) only
--   story_mutes             "Mute stories from X", per viewer
--   story_highlights(+items)  permanent collections of stories. Items reference story rows, which cleanup never deletes while in a highlight.
--
-- The ONE rule for who may see a story is public._story_audience_ok(); row security, the storage policy for photos, the drive-media
-- function (through story_media_ref) and every list use it, so they cannot drift apart.
-- Idempotent and line-ending safe (patched fragments sit on one line).

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

-- ------------------------------------------------------------------ the permission and the roles that carry it
select pg_temp.patch('_permission_catalog', $$    ('admins', 'Admins', 'See who$$,
$$    ('stories_post', 'Stories', 'Official stories', 'Post official stories and highlights for members (everyone, one event, a batch, a department or a group), see who viewed them, and send one notification about a story an hour.', 67), ('admins', 'Admins', 'See who$$);

update public.admin_role_templates
   set permissions = array['messages_*', 'stories_post']
 where key = 'communications' and not ('stories_post' = any (coalesce(permissions, '{}')));
insert into public.admin_role_templates (key, label, description, permissions, scope_kind, sort) values
  ('content_manager', 'Content manager', 'Looks after what members read and watch: official stories and highlights, event announcements, event photos and the college gallery.',
   array['stories_post', 'messages_announcements', 'photos_moderate', 'gallery_manage'], 'none', 55)
on conflict (key) do update set label = excluded.label, description = excluded.description, permissions = excluded.permissions, sort = excluded.sort;

-- ------------------------------------------------------------------ the Drive folder for story videos
alter table public.drive_roots drop constraint if exists drive_roots_key_check;
alter table public.drive_roots add constraint drive_roots_key_check check (key in ('gallery', 'glimpses', 'stories'));

-- ------------------------------------------------------------------ tables
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  is_official boolean not null default false,
  kind text not null check (kind in ('photo', 'video', 'text')),
  audience text not null default 'connections' check (audience in ('all', 'connections', 'event', 'group')),
  event_id uuid references public.events (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 200),
  text_body text check (text_body is null or char_length(text_body) between 1 and 280),
  bg_key text check (bg_key is null or bg_key in ('indigo', 'teal', 'amber', 'rose', 'forest', 'slate', 'plum', 'sunset')),
  media_path text check (media_path is null or media_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  thumb_path text check (thumb_path is null or thumb_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  mime_type text check (mime_type is null or mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 41943040),
  duration_ms int check (duration_ms is null or duration_ms between 500 and 61000),
  width int check (width is null or width between 1 and 10000),
  height int check (height is null or height between 1 and 10000),
  drive_file_id text check (drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  link_url text check (link_url is null or (char_length(link_url) <= 500
    and link_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[^[:space:]<>"''\\]*)?$')),
  link_label text check (link_label is null or char_length(link_label) between 1 and 40),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  notified_at timestamptz,
  notified_count int,
  is_ready boolean generated always as (kind <> 'video' or drive_file_id is not null) stored,
  constraint stories_shape check (
       (kind = 'photo' and media_path is not null and thumb_path is not null and text_body is null and mime_type is null and drive_file_id is null)
    or (kind = 'video' and thumb_path is not null and mime_type is not null and size_bytes is not null and duration_ms is not null and media_path is null and text_body is null)
    or (kind = 'text' and text_body is not null and bg_key is not null and media_path is null and thumb_path is null and mime_type is null and drive_file_id is null)),
  constraint stories_audience_shape check (
       (audience = 'event') = (event_id is not null) and (audience = 'group') = (group_id is not null)),
  constraint stories_audience_by_owner check (
       (is_official and audience in ('all', 'event', 'group')) or (not is_official and audience in ('all', 'connections'))),
  constraint stories_link_official check (link_url is null or is_official),
  constraint stories_link_label_needs_link check (link_label is null or link_url is not null)
);
create index if not exists stories_owner_idx on public.stories (owner_id, created_at desc);
create index if not exists stories_active_idx on public.stories (expires_at desc) where not is_hidden;
create index if not exists stories_official_idx on public.stories (created_at desc) where is_official;

create table if not exists public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer_idx on public.story_views (viewer_id);

create table if not exists public.story_hearts (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_hearts_user_idx on public.story_hearts (user_id);

create table if not exists public.story_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user),
  check (user_id <> muted_user)
);

create table if not exists public.story_highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  is_official boolean not null default false,
  title text not null check (char_length(btrim(title)) between 1 and 40),
  cover_story_id uuid references public.stories (id) on delete set null,
  -- inherit: each item keeps its own audience (the most restricted wins); all / connections: the owner re-shares explicitly
  audience text not null default 'inherit' check (audience in ('inherit', 'all', 'connections')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_official or audience <> 'connections')
);
create index if not exists story_highlights_owner_idx on public.story_highlights (owner_id, sort_order);
create index if not exists story_highlights_official_idx on public.story_highlights (sort_order) where is_official;

create table if not exists public.story_highlight_items (
  highlight_id uuid not null references public.story_highlights (id) on delete cascade,
  story_id uuid not null references public.stories (id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (highlight_id, story_id)
);
create index if not exists story_highlight_items_story_idx on public.story_highlight_items (story_id);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.story_hearts enable row level security;
alter table public.story_mutes enable row level security;
alter table public.story_highlights enable row level security;
alter table public.story_highlight_items enable row level security;

-- ------------------------------------------------------------------ the visibility rules (one place)
-- Audience only: no expiry, no moderation flag. The owner always passes. Everyone else must be a verified member and, for a personal story,
-- not blocked either way with an owner who is still verified. Official stories skip the owner checks (the owner is the committee).
create or replace function public._story_audience_ok(s public.stories)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return false; end if;
  if s.owner_id = me then return true; end if;
  if not public.is_verified() then return false; end if;
  if s.is_official then
    return case s.audience
      when 'all' then true
      when 'event' then exists (select 1 from public.event_registrations r
                                 where r.event_id = s.event_id and r.user_id = me and r.status in ('under_review', 'confirmed'))
      when 'group' then exists (select 1 from public.group_members m where m.group_id = s.group_id and m.user_id = me)
      else false end;
  end if;
  if not exists (select 1 from public.profiles o where o.id = s.owner_id and o.verification = 'verified') then return false; end if;
  if public.is_blocked_between(me, s.owner_id) then return false; end if;
  return case s.audience
    when 'all' then true
    when 'connections' then public.are_connected(me, s.owner_id)
    else false end;
end $$;

-- A story that members can watch right now.
create or replace function public._story_active_ok(s public.stories)
returns boolean language sql stable security definer set search_path = '' as $$
  select s.expires_at > now() and not s.is_hidden and s.is_ready and public._story_audience_ok(s);
$$;

-- Can the signed-in person see this highlight? (owner; official-story admins for official ones; else the highlight's audience rule)
create or replace function public._highlight_visible(h public.story_highlights)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return false; end if;
  if h.owner_id = me then return true; end if;
  if h.is_official and public._admin_can('stories_post') then return true; end if;
  if not public.is_verified() then return false; end if;
  if not h.is_official then
    if not exists (select 1 from public.profiles o where o.id = h.owner_id and o.verification = 'verified') then return false; end if;
    if public.is_blocked_between(me, h.owner_id) then return false; end if;
  end if;
  if h.audience = 'all' then
    return exists (select 1 from public.story_highlight_items i join public.stories s on s.id = i.story_id and not s.is_hidden and s.is_ready where i.highlight_id = h.id);
  end if;
  if h.audience = 'connections' then
    return public.are_connected(me, h.owner_id)
       and exists (select 1 from public.story_highlight_items i join public.stories s on s.id = i.story_id and not s.is_hidden and s.is_ready where i.highlight_id = h.id);
  end if;
  -- inherit: the most restricted item decides (every item's own audience must pass), and there must be something to show
  return exists (select 1 from public.story_highlight_items i join public.stories s on s.id = i.story_id and not s.is_hidden and s.is_ready where i.highlight_id = h.id)
     and not exists (select 1 from public.story_highlight_items i join public.stories s on s.id = i.story_id and not s.is_hidden and s.is_ready
                      where i.highlight_id = h.id and not public._story_audience_ok(s));
end $$;

create or replace function public._story_in_visible_highlight(p_story uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.story_highlight_items i join public.story_highlights h on h.id = i.highlight_id
                  where i.story_id = p_story and public._highlight_visible(h));
$$;

-- May the signed-in person read this story row (and its media)? Used by row security, the storage policy and story_media_ref.
create or replace function public.story_readable(s public.stories)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
       s.owner_id = auth.uid()
    or (s.is_official and public._admin_can('stories_post'))
    or (not s.is_hidden and s.is_ready and ((s.expires_at > now() and public._story_audience_ok(s)) or public._story_in_visible_highlight(s.id))));
$$;

create or replace function public.can_view_story(p_story uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.story_readable(s) from public.stories s where s.id = p_story), false);
$$;

-- storage path -> may the signed-in person read that file (a photo or a poster of a story they may see)
create or replace function public.story_path_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.stories s where (s.media_path = p_name or s.thumb_path = p_name) and public.story_readable(s));
$$;

-- ------------------------------------------------------------------ row security and grants
drop policy if exists "read stories I may see" on public.stories;
create policy "read stories I may see" on public.stories for select to authenticated using (public.story_readable(stories));
drop policy if exists "own views" on public.story_views;
create policy "own views" on public.story_views for select to authenticated using (viewer_id = auth.uid());
drop policy if exists "own hearts" on public.story_hearts;
create policy "own hearts" on public.story_hearts for select to authenticated using (user_id = auth.uid());
drop policy if exists "own mutes" on public.story_mutes;
create policy "own mutes" on public.story_mutes for select to authenticated using (user_id = auth.uid());
drop policy if exists "own highlights" on public.story_highlights;
create policy "own highlights" on public.story_highlights for select to authenticated using (owner_id = auth.uid());
drop policy if exists "own highlight items" on public.story_highlight_items;
create policy "own highlight items" on public.story_highlight_items for select to authenticated
  using (exists (select 1 from public.story_highlights h where h.id = highlight_id and h.owner_id = auth.uid()));

revoke all on public.stories, public.story_views, public.story_hearts, public.story_mutes, public.story_highlights, public.story_highlight_items from anon, authenticated, public;
grant select on public.stories, public.story_views, public.story_hearts, public.story_mutes, public.story_highlights, public.story_highlight_items to authenticated;
-- nobody writes these tables directly: every change goes through the functions below (which check who is asking)

-- ------------------------------------------------------------------ private bucket for photos and posters
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', false, 3 * 1024 * 1024, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members add story files" on storage.objects;
create policy "members add story files" on storage.objects for insert to authenticated
  with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text and public.is_verified());
drop policy if exists "story files I may see" on storage.objects;
create policy "story files I may see" on storage.objects for select to authenticated
  using (bucket_id = 'stories' and ((storage.foldername(name))[1] = auth.uid()::text or public.story_path_readable(name)));
drop policy if exists "remove own story files" on storage.objects;
create policy "remove own story files" on storage.objects for delete to authenticated
  using (bucket_id = 'stories' and ((storage.foldername(name))[1] = auth.uid()::text or public._admin_can('stories_post')));

-- ------------------------------------------------------------------ one story as the app shows it
create or replace function public._story_card(s public.stories)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'owner_id', s.owner_id, 'is_official', s.is_official,
    'owner_name', case when s.is_official then null else o.full_name end,
    'owner_avatar', case when s.is_official then null else o.avatar_url end,
    'kind', s.kind, 'audience', s.audience, 'event_id', s.event_id, 'group_id', s.group_id,
    'caption', s.caption, 'text_body', s.text_body, 'bg_key', s.bg_key,
    'media_path', s.media_path, 'thumb_path', s.thumb_path, 'mime_type', s.mime_type, 'duration_ms', s.duration_ms,
    'width', s.width, 'height', s.height, 'link_url', s.link_url, 'link_label', s.link_label,
    'created_at', s.created_at, 'expires_at', s.expires_at, 'is_hidden', s.is_hidden, 'ready', s.is_ready,
    'seen', exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid()),
    'hearted', exists (select 1 from public.story_hearts h where h.story_id = s.id and h.user_id = auth.uid()),
    'mine', s.owner_id = auth.uid(),
    'views', case when s.owner_id = auth.uid() or (s.is_official and public._admin_can('stories_post'))
                  then (select count(*)::int from public.story_views v where v.story_id = s.id) end,
    'hearts', case when s.owner_id = auth.uid() or (s.is_official and public._admin_can('stories_post'))
                   then (select count(*)::int from public.story_hearts h where h.story_id = s.id) end,
    'in_highlight', exists (select 1 from public.story_highlight_items i where i.story_id = s.id and s.owner_id = auth.uid()))
  from public.profiles o where o.id = s.owner_id;
$$;

-- ------------------------------------------------------------------ posting
create or replace function public.create_story(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_official boolean := coalesce((p ->> 'official')::boolean, false);
  v_kind text := p ->> 'kind';
  v_aud text := coalesce(nullif(p ->> 'audience', ''), case when v_official then 'all' else 'connections' end);
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_caption text := nullif(btrim(left(coalesce(p ->> 'caption', ''), 200)), '');
  v_text text := nullif(btrim(coalesce(p ->> 'text_body', '')), '');
  v_bg text := nullif(p ->> 'bg_key', '');
  v_media text := nullif(p ->> 'media_path', '');
  v_thumb text := nullif(p ->> 'thumb_path', '');
  v_mime text := nullif(p ->> 'mime_type', '');
  v_size bigint := nullif(p ->> 'size_bytes', '')::bigint;
  v_dur int := nullif(p ->> 'duration_ms', '')::int;
  v_link text := nullif(btrim(coalesce(p ->> 'link_url', '')), '');
  v_label text := nullif(btrim(left(coalesce(p ->> 'link_label', ''), 40)), '');
  v_today int;
  v_cap int;
begin
  if me is null or not public.is_verified() then raise exception 'Only verified members can share stories' using errcode = '42501'; end if;
  if v_official and not public._admin_can('stories_post') then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('photo', 'video', 'text') then raise exception 'Choose a photo, a video or a text card' using errcode = 'P0001', hint = 'stories.errKind'; end if;
  if v_official and v_aud not in ('all', 'event', 'group') then raise exception 'Choose who can see this story' using errcode = 'P0001', hint = 'stories.errAudience'; end if;
  if not v_official and v_aud not in ('all', 'connections') then raise exception 'Choose who can see this story' using errcode = 'P0001', hint = 'stories.errAudience'; end if;
  if v_aud = 'event' and (v_event is null or not exists (select 1 from public.events e where e.id = v_event)) then
    raise exception 'Choose the event' using errcode = 'P0001', hint = 'stories.errEvent';
  end if;
  if v_aud = 'group' and (v_group is null or not exists (select 1 from public.groups g where g.id = v_group)) then
    raise exception 'Choose the group' using errcode = 'P0001', hint = 'stories.errGroup';
  end if;
  if v_aud <> 'event' then v_event := null; end if;
  if v_aud <> 'group' then v_group := null; end if;
  if v_link is not null and not v_official then raise exception 'Only official stories can have a link' using errcode = 'P0001', hint = 'stories.errLinkOfficial'; end if;
  if v_link is not null and (v_link !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[^[:space:]<>"''\\]*)?$' or char_length(v_link) > 500) then
    raise exception 'The link must start with https:// and be a plain web address' using errcode = 'P0001', hint = 'stories.errLink';
  end if;
  if v_link is null then v_label := null; end if;

  select count(*) into v_today from public.stories s where s.owner_id = me and s.created_at > now() - interval '24 hours';
  v_cap := case when v_official then 200 else 20 end;
  if v_today >= v_cap then
    raise exception 'You can share up to 20 stories a day. Please try again tomorrow.' using errcode = 'P0001', hint = 'stories.errRate';
  end if;
  if exists (select 1 from public.stories s where s.id = v_id) then raise exception 'This story was already saved' using errcode = 'P0001', hint = 'stories.errDuplicate'; end if;

  if v_kind = 'text' then
    if v_text is null or char_length(v_text) > 280 then raise exception 'Write something (up to 280 characters)' using errcode = 'P0001', hint = 'stories.errText'; end if;
    if v_bg is null or v_bg not in ('indigo', 'teal', 'amber', 'rose', 'forest', 'slate', 'plum', 'sunset') then v_bg := 'indigo'; end if;
    v_media := null; v_thumb := null; v_mime := null; v_size := null; v_dur := null;
  else
    v_text := null; v_bg := null;
    if v_thumb is null or split_part(v_thumb, '/', 1) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'stories' and o.name = v_thumb) then
      raise exception 'The picture was not found. Please try again.' using errcode = 'P0001', hint = 'stories.errFile';
    end if;
    if v_kind = 'photo' then
      if v_media is null or split_part(v_media, '/', 1) <> me::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'stories' and o.name = v_media) then
        raise exception 'The picture was not found. Please try again.' using errcode = 'P0001', hint = 'stories.errFile';
      end if;
      v_mime := null; v_size := null; v_dur := null;
    else
      v_media := null;
      if v_mime is null or v_mime not in ('video/mp4', 'video/webm', 'video/quicktime') then
        raise exception 'Use an MP4, MOV or WebM video' using errcode = 'P0001', hint = 'stories.errVideoFormat';
      end if;
      if v_size is null or v_size < 1 or v_size > 41943040 then
        raise exception 'Story videos can be up to 40 MB' using errcode = 'P0001', hint = 'stories.errVideoBig';
      end if;
      if v_dur is null or v_dur < 500 then raise exception 'We could not read the length of this video' using errcode = 'P0001', hint = 'stories.errVideoLength'; end if;
      if v_dur > 60500 then raise exception 'Story videos can be up to 60 seconds' using errcode = 'P0001', hint = 'stories.errVideoLong'; end if;
      -- a claim that cannot be true is refused: more than ~100 Mbit/s for this length
      if v_size::numeric * 8 / (v_dur / 1000.0) > 100000000 then raise exception 'We could not read this video properly' using errcode = 'P0001', hint = 'stories.errVideoLength'; end if;
    end if;
  end if;

  insert into public.stories (id, owner_id, is_official, kind, audience, event_id, group_id, caption, text_body, bg_key, media_path, thumb_path,
                              mime_type, size_bytes, duration_ms, width, height, link_url, link_label)
  values (v_id, me, v_official, v_kind, v_aud, v_event, v_group, v_caption, v_text, v_bg, v_media, v_thumb, v_mime, v_size, v_dur,
          nullif(p ->> 'width', '')::int, nullif(p ->> 'height', '')::int, v_link, v_label);
  if v_official then
    perform public._audit('story_post', 'stories', v_id, jsonb_build_object('kind', v_kind, 'audience', v_aud, 'event', v_event, 'group', v_group));
  end if;
  return v_id;
end $$;

-- the owner (or, for an official story, an official-story admin) deletes it; returns the files to remove from storage
create or replace function public.delete_story(p_story uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  s public.stories;
begin
  select * into s from public.stories where id = p_story for update;
  if not found or not (s.owner_id = auth.uid() or (s.is_official and public._admin_can('stories_post'))) then
    raise exception 'Story not found' using errcode = '42501';
  end if;
  delete from public.stories where id = p_story;
  if s.is_official then perform public._audit('story_delete', 'stories', p_story, jsonb_build_object('kind', s.kind)); end if;
  return array_remove(array[s.media_path, s.thumb_path], null);
end $$;

-- ------------------------------------------------------------------ watching, hearts, mute, report
create or replace function public.mark_story_seen(p_story uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.stories;
begin
  select * into s from public.stories where id = p_story;
  if not found or s.owner_id = auth.uid() or not public._story_active_ok(s) then return; end if;
  insert into public.story_views (story_id, viewer_id) values (p_story, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.toggle_story_heart(p_story uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.stories;
  v_on boolean;
begin
  select * into s from public.stories where id = p_story;
  if not found or not public._story_active_ok(s) then raise exception 'Story not found' using errcode = '42501'; end if;
  if s.owner_id = auth.uid() then raise exception 'You cannot react to your own story' using errcode = 'P0001', hint = 'stories.errOwnHeart'; end if;
  delete from public.story_hearts where story_id = p_story and user_id = auth.uid();
  if found then v_on := false; else insert into public.story_hearts (story_id, user_id) values (p_story, auth.uid()); v_on := true; end if;
  return jsonb_build_object('hearted', v_on);
end $$;

create or replace function public.mute_story_owner(p_user uuid, p_mute boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Please sign in' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'That is you' using errcode = 'P0001'; end if;
  if p_mute then
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found' using errcode = 'P0001'; end if;
    insert into public.story_mutes (user_id, muted_user) values (auth.uid(), p_user) on conflict do nothing;
  else
    delete from public.story_mutes where user_id = auth.uid() and muted_user = p_user;
  end if;
end $$;

create or replace function public.my_story_mutes()
returns table (muted_user uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select m.muted_user, p.full_name, p.avatar_url from public.story_mutes m join public.profiles p on p.id = m.muted_user
   where m.user_id = auth.uid() order by m.created_at desc limit 200;
$$;

-- ------------------------------------------------------------------ reading: the rings on Home, a person's stories, my archive
create or replace function public.stories_feed()
returns table (section text, owner_id uuid, owner_name text, owner_avatar text, story_count int, unseen_count int, latest_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with vis as (
    select s.id, s.owner_id, s.is_official, s.created_at,
           exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid()) as seen
      from public.stories s
     where auth.uid() is not null and public.is_verified()
       and public._story_active_ok(s)
       and (s.is_official or s.owner_id = auth.uid()
            or not exists (select 1 from public.story_mutes m where m.user_id = auth.uid() and m.muted_user = s.owner_id))
  ), grp as (
    select case when v.is_official then 'official' when v.owner_id = auth.uid() then 'mine'
                when public.are_connected(auth.uid(), v.owner_id) then 'connections' else 'more' end as section,
           case when v.is_official then null else v.owner_id end as owner_id,
           count(*)::int as story_count, (count(*) filter (where not v.seen))::int as unseen_count, max(v.created_at) as latest_at
      from vis v group by 1, 2
  ), ranked as (
    select g.*, row_number() over (partition by g.section order by g.latest_at desc) as rn from grp g
  )
  select r.section, r.owner_id, p.full_name, p.avatar_url, r.story_count, r.unseen_count, r.latest_at
    from ranked r left join public.profiles p on p.id = r.owner_id
   where r.section <> 'more' or r.rn <= 30
   order by case r.section when 'official' then 0 when 'mine' then 1 when 'connections' then 2 else 3 end, (r.unseen_count = 0), r.latest_at desc;
$$;

-- the active stories of one member (or the official ones) that the signed-in person may watch, oldest first
create or replace function public.stories_of(p_owner uuid default null, p_official boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public._story_card(s) order by s.created_at), '[]'::jsonb)
    from public.stories s
   where auth.uid() is not null and public.is_verified()
     and public._story_active_ok(s)
     and ((p_official and s.is_official) or (not p_official and not s.is_official and s.owner_id = p_owner));
$$;

-- avatar rings for a list of people (directory, profile): who has an active story the caller may watch, and whether it is unseen
create or replace function public.story_rings(p_ids uuid[])
returns table (user_id uuid, story_count int, unseen_count int)
language sql stable security definer set search_path = '' as $$
  select s.owner_id, count(*)::int,
         (count(*) filter (where not exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid())))::int
    from public.stories s
   where auth.uid() is not null and public.is_verified() and not s.is_official
     and s.owner_id = any ((coalesce(p_ids, '{}'::uuid[]))[1:200])
     and public._story_active_ok(s)
   group by s.owner_id;
$$;

-- my own stories, newest first, expired ones included (to save them into a highlight); counts are mine to see
create or replace function public.my_stories()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(q.c order by q.ca desc), '[]'::jsonb)
    from (select public._story_card(s) as c, s.created_at as ca from public.stories s
           where s.owner_id = auth.uid() and not s.is_official order by s.created_at desc limit 100) q;
$$;

create or replace function public.story_viewers(p_story uuid)
returns table (viewer_id uuid, full_name text, avatar_url text, viewed_at timestamptz, hearted boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stories s where s.id = p_story and (s.owner_id = auth.uid() or (s.is_official and public._admin_can('stories_post')))) then
    raise exception 'Story not found' using errcode = '42501';
  end if;
  return query
    select v.viewer_id, p.full_name, p.avatar_url, v.viewed_at,
           exists (select 1 from public.story_hearts h where h.story_id = p_story and h.user_id = v.viewer_id)
      from public.story_views v join public.profiles p on p.id = v.viewer_id
     where v.story_id = p_story order by v.viewed_at desc limit 500;
end $$;

-- for the drive-media function: the Drive file of a story video, only for someone who may watch it (same rule as everything else)
create or replace function public.story_media_ref(p_story uuid)
returns table (drive_file_id text, mime_type text)
language sql stable security definer set search_path = '' as $$
  select s.drive_file_id, s.mime_type from public.stories s
   where s.id = p_story and s.kind = 'video' and s.drive_file_id is not null and public.story_readable(s);
$$;

-- ------------------------------------------------------------------ grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'create_story(jsonb)', 'delete_story(uuid)', 'mark_story_seen(uuid)', 'toggle_story_heart(uuid)', 'mute_story_owner(uuid,boolean)', 'my_story_mutes()',
    'stories_feed()', 'stories_of(uuid,boolean)', 'story_rings(uuid[])', 'my_stories()', 'story_viewers(uuid)', 'story_media_ref(uuid)',
    'can_view_story(uuid)', 'story_path_readable(text)', 'story_readable(public.stories)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers: never callable from the API
  foreach f in array array[
    '_story_audience_ok(public.stories)', '_story_active_ok(public.stories)', '_highlight_visible(public.story_highlights)',
    '_story_in_visible_highlight(uuid)', '_story_card(public.stories)'] loop
    execute format('revoke execute on function public.%s from anon, authenticated, public', f);
  end loop;
end $$;
