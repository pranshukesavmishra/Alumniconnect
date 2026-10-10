-- GLIMPSES: 3 to 4 short clips from earlier alumni meets that autoplay (muted) at the top of Home and on the public landing page.
--
--   glimpses            the admin-managed list. Readable by EVERYONE (anon too) but only the visible, finished ones; curators see all.
--   poster_path         a small still image in the public 'glimpses' bucket (the only thing kept in Supabase, ~30 KB)
--   drive_file_id       the clip itself lives in the committee's Google Drive (folder from drive_roots). The drive-upload function sets it
--                       after the upload; anonymous visitors play it through the glimpse-media edge function, which serves ONLY rows
--                       that are visible glimpses (it never serves any other Drive file) and passes Range requests on.
--
-- Written only through admin_glimpse_* functions: permission gallery_manage ("College gallery"), written to the activity log.
-- No function here is callable by anon: the public reads the table through row level security.

-- ------------------------------------------------------------------ poster bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('glimpses', 'glimpses', true, 2 * 1024 * 1024, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "glimpse curators upload" on storage.objects;
create policy "glimpse curators upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'glimpses' and (storage.foldername(name))[1] = 'glimpses' and public._admin_can('gallery_manage'));
drop policy if exists "glimpse curators delete" on storage.objects;
create policy "glimpse curators delete" on storage.objects for delete to authenticated
  using (bucket_id = 'glimpses' and (storage.foldername(name))[1] = 'glimpses' and public._admin_can('gallery_manage'));

-- ------------------------------------------------------------------ table
create table if not exists public.glimpses (
  id uuid primary key default gen_random_uuid(),
  caption text check (char_length(caption) <= 140),
  caption_hi text check (char_length(caption_hi) <= 140),
  year int check (year between 1980 and 2100),
  poster_path text not null check (poster_path like 'glimpses/%'),
  mime_type text not null check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes bigint not null check (size_bytes between 1 and 62914560),
  duration_ms int check (duration_ms is null or duration_ms between 0 and 90000),
  width int,
  height int,
  drive_file_id text check (drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  sort_order int not null default 0,
  is_visible boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists glimpses_order_idx on public.glimpses (sort_order, created_at);
alter table public.glimpses enable row level security;
drop policy if exists "everyone sees live glimpses" on public.glimpses;
create policy "everyone sees live glimpses" on public.glimpses for select to anon, authenticated
  using ((is_visible and drive_file_id is not null) or public._admin_can('gallery_manage'));
revoke all on public.glimpses from anon, authenticated;
grant select on public.glimpses to anon, authenticated;

-- ------------------------------------------------------------------ curating
create or replace function public.admin_glimpse_add(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_poster text := p ->> 'poster_path';
  v_mime text := p ->> 'mime_type';
  v_size bigint := nullif(p ->> 'size_bytes', '')::bigint;
  v_dur int := nullif(p ->> 'duration_ms', '')::int;
  v_show boolean;
begin
  perform public._require_gallery();
  if (select count(*) from public.glimpses) >= 12 then raise exception 'You can keep up to 12 glimpses. Remove one first.' using errcode = 'P0001', hint = 'glimpses.errTotal'; end if;
  if v_poster is null or v_poster not like 'glimpses/%' or not exists (select 1 from storage.objects o where o.bucket_id = 'glimpses' and o.name = v_poster) then
    raise exception 'The poster image was not found. Please try again.' using errcode = 'P0001';
  end if;
  if v_mime is null or v_mime not in ('video/mp4', 'video/webm', 'video/quicktime') or v_size is null or v_size < 1 or v_size > 62914560 then
    raise exception 'A glimpse is an MP4, MOV or WebM clip up to 60 MB' using errcode = 'P0001', hint = 'glimpses.errFile';
  end if;
  if v_dur is not null and v_dur > 90000 then raise exception 'A glimpse can be up to 90 seconds' using errcode = 'P0001', hint = 'glimpses.errLong'; end if;
  v_show := (select count(*) from public.glimpses g where g.is_visible) < 4;
  insert into public.glimpses (caption, caption_hi, year, poster_path, mime_type, size_bytes, duration_ms, width, height, sort_order, is_visible, created_by)
  values (nullif(btrim(left(p ->> 'caption', 140)), ''), nullif(btrim(left(p ->> 'caption_hi', 140)), ''), nullif(p ->> 'year', '')::int, v_poster, v_mime, v_size, v_dur,
          nullif(p ->> 'width', '')::int, nullif(p ->> 'height', '')::int, coalesce((select max(g.sort_order) from public.glimpses g), 0) + 1, v_show, auth.uid())
  returning id into v_id;
  perform public._audit('glimpse_add', 'glimpses', v_id, jsonb_build_object('visible', v_show));
  return v_id;
end $$;

-- edits the caption / year / visibility; with a new poster_path it REPLACES the clip (the new file is sent right after, the old poster is returned for deletion)
create or replace function public.admin_glimpse_update(p_id uuid, p jsonb)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  g public.glimpses;
  v_old text[] := '{}';
  v_show boolean;
  v_poster text;
begin
  perform public._require_gallery();
  select * into g from public.glimpses where id = p_id for update;
  if not found then raise exception 'Glimpse not found' using errcode = 'P0001'; end if;
  v_show := case when p ? 'is_visible' then (p ->> 'is_visible')::boolean else g.is_visible end;
  if v_show and not g.is_visible and (select count(*) from public.glimpses x where x.is_visible and x.id <> p_id) >= 4 then
    raise exception 'Show at most 4 glimpses. Hide one first.' using errcode = 'P0001', hint = 'glimpses.errMax';
  end if;
  update public.glimpses set
    caption = case when p ? 'caption' then nullif(btrim(left(p ->> 'caption', 140)), '') else caption end,
    caption_hi = case when p ? 'caption_hi' then nullif(btrim(left(p ->> 'caption_hi', 140)), '') else caption_hi end,
    year = case when p ? 'year' then nullif(p ->> 'year', '')::int else year end,
    is_visible = v_show,
    updated_at = now()
   where id = p_id;
  if p ? 'poster_path' then
    v_poster := p ->> 'poster_path';
    if v_poster is null or v_poster not like 'glimpses/%' or not exists (select 1 from storage.objects o where o.bucket_id = 'glimpses' and o.name = v_poster) then
      raise exception 'The poster image was not found. Please try again.' using errcode = 'P0001';
    end if;
    if (p ->> 'mime_type') is null or (p ->> 'mime_type') not in ('video/mp4', 'video/webm', 'video/quicktime')
       or nullif(p ->> 'size_bytes', '')::bigint is null or nullif(p ->> 'size_bytes', '')::bigint not between 1 and 62914560 then
      raise exception 'A glimpse is an MP4, MOV or WebM clip up to 60 MB' using errcode = 'P0001', hint = 'glimpses.errFile';
    end if;
    if v_poster <> g.poster_path then v_old := array[g.poster_path]; end if;
    update public.glimpses set poster_path = v_poster, mime_type = p ->> 'mime_type', size_bytes = (p ->> 'size_bytes')::bigint,
           duration_ms = nullif(p ->> 'duration_ms', '')::int, width = nullif(p ->> 'width', '')::int, height = nullif(p ->> 'height', '')::int,
           drive_file_id = null   -- not shown until the new clip has been sent
     where id = p_id;
  end if;
  perform public._audit('glimpse_update', 'glimpses', p_id, jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return v_old;
end $$;

create or replace function public.admin_glimpse_remove(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  g public.glimpses;
begin
  perform public._require_gallery();
  delete from public.glimpses where id = p_id returning * into g;
  if not found then raise exception 'Glimpse not found' using errcode = 'P0001'; end if;
  perform public._audit('glimpse_remove', 'glimpses', p_id, '{}'::jsonb);
  return array[g.poster_path];
end $$;

create or replace function public.admin_glimpse_reorder(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 12 then raise exception 'Choose between 1 and 12 glimpses' using errcode = 'P0001'; end if;
  update public.glimpses g set sort_order = o.ord from unnest(p_ids) with ordinality as o(gid, ord) where g.id = o.gid;
  perform public._audit('glimpse_reorder', 'glimpses', null, jsonb_build_object('glimpses', array_length(p_ids, 1)));
end $$;

-- ------------------------------------------------------------------ grants
do $$
declare
  f text;
begin
  foreach f in array array['admin_glimpse_add(jsonb)', 'admin_glimpse_update(uuid,jsonb)', 'admin_glimpse_remove(uuid)', 'admin_glimpse_reorder(uuid[])'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
