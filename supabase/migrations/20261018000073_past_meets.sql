-- PAST MEETS: an archive of earlier alumni meets, one entry per year ("Alumni Meet 2025", "Alumni Meet 2024", ...).
--
--   past_meets     title, year, date, venue, description, highlights, attendance, cover image, English + Hindi. Published entries are
--                  readable by EVERYONE (anon too); drafts only by curators. Written only through admin_save_past_meet / admin_delete_past_meet
--                  (permission gallery_manage, activity log).
--   photos & videos of a meet use the event photo system (hearts, tags, reports, approval, official vs member, videos in Drive):
--                  every meet has an ARCHIVE EVENT (events row, created by admin_save_past_meet, or an existing event the curator links).
--                  Its photos are seen by verified members only, like every event's photos. "Members can add" maps to the event's photo
--                  setting: on = member uploads wait for approval, off = only the team (photos_moderate / events_edit) adds.
--   glimpses.meet_id   a glimpse can belong to a meet; the meet page plays its glimpses.
--
-- The row for Alumni Meet 2025 is a DRAFT with only a title and a year: nothing is invented, a curator fills it in and publishes it.

create table if not exists public.past_meets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  title_hi text check (char_length(title_hi) <= 120),
  year int not null check (year between 1980 and 2100),
  held_on date,
  venue text check (char_length(venue) <= 200),
  description text check (char_length(description) <= 3000),
  description_hi text check (char_length(description_hi) <= 3000),
  highlights text check (char_length(highlights) <= 2000),
  highlights_hi text check (char_length(highlights_hi) <= 2000),
  attendance int check (attendance is null or attendance between 0 and 100000),
  cover_path text check (cover_path is null or cover_path like 'gallery/meets/%'),
  event_id uuid references public.events (id) on delete set null,
  archive_event boolean not null default false,   -- the event was made by us (so its photo setting follows members_can_add)
  members_can_add boolean not null default false,
  is_published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists past_meets_year_idx on public.past_meets (year desc);
alter table public.past_meets enable row level security;
drop policy if exists "everyone sees published meets" on public.past_meets;
create policy "everyone sees published meets" on public.past_meets for select to anon, authenticated
  using (is_published or public._admin_can('gallery_manage'));
revoke all on public.past_meets from anon, authenticated;
grant select on public.past_meets to anon, authenticated;

alter table public.glimpses add column if not exists meet_id uuid references public.past_meets (id) on delete set null;

-- Alumni Meet 2025: a draft placeholder, no facts
insert into public.past_meets (slug, title, year, is_published) values ('alumni-meet-2025', 'Alumni Meet 2025', 2025, false) on conflict (slug) do nothing;

-- ------------------------------------------------------------------ curating
create or replace function public.admin_save_past_meet(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  m public.past_meets;
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_year int := nullif(p ->> 'year', '')::int;
  v_slug text;
  v_base text;
  v_event uuid;
  v_archive boolean;
  v_members boolean := coalesce((p ->> 'members_can_add')::boolean, false);
  v_cover text := nullif(p ->> 'cover_path', '');
begin
  perform public._require_gallery();
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'Give the meet a title' using errcode = 'P0001', hint = 'meets.errTitle'; end if;
  if v_year is null or v_year < 1980 or v_year > 2100 then raise exception 'Enter the year of the meet' using errcode = 'P0001', hint = 'meets.errYear'; end if;
  if v_cover is not null and (v_cover not like 'gallery/meets/%' or not exists (select 1 from storage.objects o where o.bucket_id = 'gallery' and o.name = v_cover)) then
    raise exception 'The cover image was not found. Please upload it again.' using errcode = 'P0001';
  end if;
  if v_id is not null then
    select * into m from public.past_meets where id = v_id for update;
    if not found then raise exception 'Meet not found' using errcode = 'P0001'; end if;
  else
    v_base := coalesce(nullif(trim(both '-' from lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'meet');
    v_base := left(v_base, 50);
    v_slug := v_base;
    while exists (select 1 from public.past_meets x where x.slug = v_slug) loop v_slug := v_base || '-' || substr(gen_random_uuid()::text, 1, 4); end loop;
    insert into public.past_meets (slug, title, year, created_by) values (v_slug, v_title, v_year, auth.uid()) returning * into m;
    v_id := m.id;
  end if;

  -- the event that holds the meet's photos and videos
  v_event := m.event_id;
  v_archive := m.archive_event;
  if nullif(p ->> 'link_event_id', '') is not null then
    if not exists (select 1 from public.events e where e.id = (p ->> 'link_event_id')::uuid) then raise exception 'Choose an event from the list' using errcode = 'P0001'; end if;
    if (p ->> 'link_event_id')::uuid is distinct from v_event then v_event := (p ->> 'link_event_id')::uuid; v_archive := false; end if;
  end if;
  if v_event is null then
    insert into public.events (slug, title, starts_at, is_published)
    values (left('meet-archive-' || m.slug, 60), v_title, (nullif(p ->> 'held_on', '')::date)::timestamptz, true)
    on conflict (slug) do update set title = excluded.title
    returning id into v_event;
    v_archive := true;
  elsif v_archive then
    update public.events set title = v_title, is_published = true where id = v_event;
  end if;
  if v_archive then
    insert into public.event_photo_settings (event_id, member_uploads, updated_by, updated_at)
    values (v_event, case when v_members then 'approval' else 'off' end, auth.uid(), now())
    on conflict (event_id) do update set member_uploads = excluded.member_uploads, updated_by = excluded.updated_by, updated_at = now();
  end if;

  update public.past_meets set
    title = v_title, title_hi = nullif(btrim(left(p ->> 'title_hi', 120)), ''), year = v_year,
    held_on = nullif(p ->> 'held_on', '')::date, venue = nullif(btrim(left(p ->> 'venue', 200)), ''),
    description = nullif(btrim(left(p ->> 'description', 3000)), ''), description_hi = nullif(btrim(left(p ->> 'description_hi', 3000)), ''),
    highlights = nullif(btrim(left(p ->> 'highlights', 2000)), ''), highlights_hi = nullif(btrim(left(p ->> 'highlights_hi', 2000)), ''),
    attendance = nullif(p ->> 'attendance', '')::int,
    cover_path = case when p ? 'cover_path' then v_cover else cover_path end,
    event_id = v_event, archive_event = v_archive, members_can_add = v_members,
    is_published = coalesce((p ->> 'is_published')::boolean, false), updated_at = now()
   where id = v_id;
  perform public._audit('meet_save', 'past_meets', v_id, jsonb_build_object('year', v_year, 'published', coalesce((p ->> 'is_published')::boolean, false)));
  return v_id;
end $$;

-- returns the cover file so the app can delete it; the meet's event and its photos are left alone
create or replace function public.admin_delete_past_meet(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  m public.past_meets;
begin
  perform public._require_gallery();
  delete from public.past_meets where id = p_id returning * into m;
  if not found then raise exception 'Meet not found' using errcode = 'P0001'; end if;
  perform public._audit('meet_delete', 'past_meets', p_id, jsonb_build_object('year', m.year));
  return case when m.cover_path is null then '{}'::text[] else array[m.cover_path] end;
end $$;

create or replace function public.admin_glimpse_set_meet(p_id uuid, p_meet uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  if p_meet is not null and not exists (select 1 from public.past_meets m where m.id = p_meet) then raise exception 'Choose a meet from the list' using errcode = 'P0001'; end if;
  update public.glimpses set meet_id = p_meet, updated_at = now() where id = p_id;
  if not found then raise exception 'Glimpse not found' using errcode = 'P0001'; end if;
  perform public._audit('glimpse_update', 'glimpses', p_id, jsonb_build_object('fields', jsonb_build_array('meet_id')));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['admin_save_past_meet(jsonb)', 'admin_delete_past_meet(uuid)', 'admin_glimpse_set_meet(uuid,uuid)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
