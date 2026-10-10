-- PHOTOS, part 2: the COLLEGE GALLERY. One curated collection for the whole college (not per event).
--   gallery_categories   the filter chips (Campus, Reunions, ...): admin-editable
--   gallery_albums       optional groups of photos
--   gallery_photos       the curated photos. Files live in the 'gallery' bucket (a copy made when an event photo is added), so removing an
--                        event photo never empties the gallery. event_id keeps the small "From <event>" link back.
--   gallery_suggestions  a member suggests an event photo; an admin adds it (approve) or declines it
-- Visible to verified members only (RLS: is_verified()). Written only through admin_gallery_* functions, all of which need the
-- 'gallery_manage' permission and write to the activity log. Nobody writes these tables through the API.

create table public.gallery_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  label_hi text check (char_length(label_hi) <= 40),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table public.gallery_albums (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  title_hi text check (char_length(title_hi) <= 80),
  description text check (char_length(description) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path like 'gallery/%'),
  thumb_path text not null check (thumb_path like 'gallery/%'),
  width int,
  height int,
  title text check (char_length(title) <= 120),
  title_hi text check (char_length(title_hi) <= 120),
  alt_text text check (char_length(alt_text) <= 300),
  category_id uuid references public.gallery_categories (id) on delete set null,
  album_id uuid references public.gallery_albums (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  source_photo_id uuid,
  is_featured boolean not null default false,
  featured_at timestamptz,
  taken_on date,
  pair_of uuid references public.gallery_photos (id) on delete set null,   -- this is the "Now"; pair_of is its "Then"
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (pair_of is null or pair_of <> id)
);
create index gallery_photos_feed_idx on public.gallery_photos (is_featured desc, featured_at desc, created_at desc);
create index gallery_photos_category_idx on public.gallery_photos (category_id);
create index gallery_photos_album_idx on public.gallery_photos (album_id);
create table public.gallery_suggestions (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.event_photos (id) on delete cascade,
  suggested_by uuid not null references public.profiles (id) on delete cascade,
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (photo_id, suggested_by)
);

alter table public.gallery_categories enable row level security;
alter table public.gallery_albums enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.gallery_suggestions enable row level security;
create policy "verified read categories" on public.gallery_categories for select to authenticated using (public.is_verified());
create policy "verified read albums" on public.gallery_albums for select to authenticated using (public.is_verified());
create policy "verified read gallery" on public.gallery_photos for select to authenticated using (public.is_verified());
create policy "own or curator suggestions" on public.gallery_suggestions for select to authenticated
  using (suggested_by = auth.uid() or public._admin_can('gallery_manage'));
grant select on public.gallery_categories, public.gallery_albums, public.gallery_photos, public.gallery_suggestions to authenticated;

insert into public.gallery_categories (slug, label, label_hi, sort) values
  ('campus', 'Campus', 'कैंपस', 10),
  ('reunions', 'Reunions', 'पुनर्मिलन', 20),
  ('sports', 'Sports', 'खेल', 30),
  ('culture', 'Culture', 'संस्कृति', 40),
  ('then-now', 'Then & Now', 'तब और अब', 50);

-- ------------------------------------------------------------------ storage: the 'gallery' bucket (public read like event photos; random file names)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5 * 1024 * 1024, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;
create policy "gallery curators upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (storage.foldername(name))[1] = 'gallery' and public._admin_can('gallery_manage'));
create policy "gallery curators delete" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (storage.foldername(name))[1] = 'gallery' and public._admin_can('gallery_manage'));

-- ------------------------------------------------------------------ helpers
create or replace function public._require_gallery()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._admin_can('gallery_manage') then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
end $$;
revoke execute on function public._require_gallery() from anon, authenticated, public;

-- ------------------------------------------------------------------ curating
create or replace function public.admin_gallery_add(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_path text := p ->> 'storage_path';
  v_thumb text := p ->> 'thumb_path';
  v_cat uuid := nullif(p ->> 'category_id', '')::uuid;
  v_album uuid := nullif(p ->> 'album_id', '')::uuid;
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_sug public.gallery_suggestions;
  v_featured boolean := coalesce((p ->> 'is_featured')::boolean, false);
begin
  perform public._require_gallery();
  if v_path is null or v_thumb is null or v_path not like 'gallery/%' or v_thumb not like 'gallery/%' then raise exception 'Upload the photo first' using errcode = 'P0001'; end if;
  if (select count(*) from storage.objects o where o.bucket_id = 'gallery' and o.name in (v_path, v_thumb)) <> (case when v_path = v_thumb then 1 else 2 end) then
    raise exception 'The photo file was not found. Please upload it again.' using errcode = 'P0001';
  end if;
  if v_cat is not null and not exists (select 1 from public.gallery_categories c where c.id = v_cat) then raise exception 'Choose a chip from the list' using errcode = 'P0001'; end if;
  if v_album is not null and not exists (select 1 from public.gallery_albums a where a.id = v_album) then raise exception 'Choose an album from the list' using errcode = 'P0001'; end if;
  if v_event is not null and not exists (select 1 from public.events e where e.id = v_event) then v_event := null; end if;
  insert into public.gallery_photos (storage_path, thumb_path, width, height, title, title_hi, alt_text, category_id, album_id, event_id, source_photo_id,
                                     is_featured, featured_at, taken_on, created_by)
  values (v_path, v_thumb, (p ->> 'width')::int, (p ->> 'height')::int, nullif(btrim(left(p ->> 'title', 120)), ''), nullif(btrim(left(p ->> 'title_hi', 120)), ''),
          nullif(btrim(left(p ->> 'alt_text', 300)), ''), v_cat, v_album, v_event, nullif(p ->> 'source_photo_id', '')::uuid,
          v_featured, case when v_featured then now() end, nullif(p ->> 'taken_on', '')::date, auth.uid())
  returning id into v_id;
  if nullif(p ->> 'suggestion_id', '') is not null then
    update public.gallery_suggestions s set status = 'approved', handled_by = auth.uid(), handled_at = now()
     where s.id = (p ->> 'suggestion_id')::uuid and s.status = 'pending' returning * into v_sug;
    if found then perform public._notify(v_sug.suggested_by, 'gallery_approved', null, v_id, null); end if;
  end if;
  perform public._audit('gallery_add', 'gallery_photos', v_id, jsonb_build_object('event', v_event, 'from_suggestion', nullif(p ->> 'suggestion_id', '') is not null));
  return v_id;
end $$;

create or replace function public.admin_gallery_update(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.gallery_photos;
  v_pair uuid;
begin
  perform public._require_gallery();
  select * into g from public.gallery_photos where id = p_id;
  if not found then raise exception 'Photo not found' using errcode = 'P0001'; end if;
  if p ? 'category_id' and nullif(p ->> 'category_id', '') is not null and not exists (select 1 from public.gallery_categories c where c.id = (p ->> 'category_id')::uuid) then
    raise exception 'Choose a chip from the list' using errcode = 'P0001';
  end if;
  if p ? 'album_id' and nullif(p ->> 'album_id', '') is not null and not exists (select 1 from public.gallery_albums a where a.id = (p ->> 'album_id')::uuid) then
    raise exception 'Choose an album from the list' using errcode = 'P0001';
  end if;
  if p ? 'pair_of' then
    v_pair := nullif(p ->> 'pair_of', '')::uuid;
    if v_pair is not null and (v_pair = p_id or not exists (select 1 from public.gallery_photos x where x.id = v_pair)) then raise exception 'Choose a different photo for the pair' using errcode = 'P0001'; end if;
  else
    v_pair := g.pair_of;
  end if;
  update public.gallery_photos set
    title = case when p ? 'title' then nullif(btrim(left(p ->> 'title', 120)), '') else title end,
    title_hi = case when p ? 'title_hi' then nullif(btrim(left(p ->> 'title_hi', 120)), '') else title_hi end,
    alt_text = case when p ? 'alt_text' then nullif(btrim(left(p ->> 'alt_text', 300)), '') else alt_text end,
    category_id = case when p ? 'category_id' then nullif(p ->> 'category_id', '')::uuid else category_id end,
    album_id = case when p ? 'album_id' then nullif(p ->> 'album_id', '')::uuid else album_id end,
    taken_on = case when p ? 'taken_on' then nullif(p ->> 'taken_on', '')::date else taken_on end,
    pair_of = v_pair,
    is_featured = case when p ? 'is_featured' then (p ->> 'is_featured')::boolean else is_featured end,
    featured_at = case when p ? 'is_featured' then (case when (p ->> 'is_featured')::boolean then coalesce(featured_at, now()) end) else featured_at end
   where id = p_id;
  perform public._audit('gallery_update', 'gallery_photos', p_id, jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
end $$;

-- returns the file names so the app can delete them from storage
create or replace function public.admin_gallery_remove(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  g public.gallery_photos;
begin
  perform public._require_gallery();
  delete from public.gallery_photos where id = p_id returning * into g;
  if not found then raise exception 'Photo not found' using errcode = 'P0001'; end if;
  perform public._audit('gallery_remove', 'gallery_photos', p_id, jsonb_build_object('event', g.event_id));
  return array[g.storage_path, g.thumb_path];
end $$;

create or replace function public.admin_gallery_save_category(p_id uuid, p_label text, p_label_hi text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_slug text;
  v_base text;
begin
  perform public._require_gallery();
  if char_length(btrim(coalesce(p_label, ''))) < 1 or char_length(btrim(p_label)) > 40 then raise exception 'Give the chip a short name' using errcode = 'P0001'; end if;
  if v_id is null then
    v_base := coalesce(nullif(trim(both '-' from lower(regexp_replace(p_label, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'chip');
    v_slug := v_base;
    while exists (select 1 from public.gallery_categories c where c.slug = v_slug) loop v_slug := v_base || '-' || substr(gen_random_uuid()::text, 1, 4); end loop;
    insert into public.gallery_categories (slug, label, label_hi, sort)
    values (v_slug, btrim(p_label), nullif(btrim(left(p_label_hi, 40)), ''), coalesce((select max(sort) from public.gallery_categories), 0) + 10) returning id into v_id;
  else
    update public.gallery_categories set label = btrim(p_label), label_hi = nullif(btrim(left(p_label_hi, 40)), '') where id = v_id;
    if not found then raise exception 'Chip not found' using errcode = 'P0001'; end if;
  end if;
  perform public._audit('gallery_chip_save', 'gallery_categories', v_id, jsonb_build_object('label', btrim(p_label)));
  return v_id;
end $$;

create or replace function public.admin_gallery_reorder_categories(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  update public.gallery_categories c set sort = o.ord * 10 from unnest(p_ids) with ordinality as o(cid, ord) where c.id = o.cid;
  perform public._audit('gallery_chip_reorder', 'gallery_categories', null, jsonb_build_object('chips', coalesce(array_length(p_ids, 1), 0)));
end $$;

create or replace function public.admin_gallery_delete_category(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  delete from public.gallery_categories where id = p_id;
  if not found then raise exception 'Chip not found' using errcode = 'P0001'; end if;
  perform public._audit('gallery_chip_delete', 'gallery_categories', p_id, '{}'::jsonb);
end $$;

create or replace function public.admin_gallery_save_album(p_id uuid, p_title text, p_title_hi text, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
begin
  perform public._require_gallery();
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(btrim(p_title)) > 80 then raise exception 'Give the album a short name' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.gallery_albums (title, title_hi, description, created_by)
    values (btrim(p_title), nullif(btrim(left(p_title_hi, 80)), ''), nullif(btrim(left(p_description, 300)), ''), auth.uid()) returning id into v_id;
  else
    update public.gallery_albums set title = btrim(p_title), title_hi = nullif(btrim(left(p_title_hi, 80)), ''), description = nullif(btrim(left(p_description, 300)), '') where id = v_id;
    if not found then raise exception 'Album not found' using errcode = 'P0001'; end if;
  end if;
  perform public._audit('gallery_album_save', 'gallery_albums', v_id, jsonb_build_object('title', btrim(p_title)));
  return v_id;
end $$;

create or replace function public.admin_gallery_delete_album(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  delete from public.gallery_albums where id = p_id;
  if not found then raise exception 'Album not found' using errcode = 'P0001'; end if;
  perform public._audit('gallery_album_delete', 'gallery_albums', p_id, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------------ suggestions
create or replace function public.suggest_gallery_photo(p_photo uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ph public.event_photos;
  v_id uuid;
begin
  select * into ph from public.event_photos where id = p_photo and not is_hidden and status = 'approved';
  if not found or not public.is_verified() or not public.can_view_event_photos(ph.event_id) then raise exception 'Photo not found' using errcode = '42501'; end if;
  if exists (select 1 from public.gallery_photos g where g.source_photo_id = p_photo) then raise exception 'This photo is already in the college gallery' using errcode = 'P0001', hint = 'gallery.errAlready'; end if;
  if (select count(*) from public.gallery_suggestions s where s.suggested_by = auth.uid() and s.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can suggest up to 10 photos a day. Please try again tomorrow.' using errcode = 'P0001', hint = 'gallery.errSuggestRate';
  end if;
  insert into public.gallery_suggestions (photo_id, suggested_by, note) values (p_photo, auth.uid(), nullif(btrim(left(p_note, 300)), ''))
  on conflict (photo_id, suggested_by) do nothing returning id into v_id;
  if v_id is null then raise exception 'You have already suggested this photo' using errcode = 'P0001', hint = 'gallery.errSuggested'; end if;
  return v_id;
end $$;

create or replace function public.admin_gallery_suggestions()
returns table (id uuid, photo_id uuid, event_id uuid, event_title text, storage_path text, thumb_path text, width int, height int, caption text,
               suggested_by uuid, suggester_name text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_gallery();
  return query
  select s.id, s.photo_id, p.event_id, e.title, p.storage_path, p.thumb_path, p.width, p.height, p.caption, s.suggested_by, u.full_name, s.note, s.created_at
    from public.gallery_suggestions s
    join public.event_photos p on p.id = s.photo_id
    join public.events e on e.id = p.event_id
    join public.profiles u on u.id = s.suggested_by
   where s.status = 'pending' order by s.created_at limit 200;
end $$;

create or replace function public.admin_gallery_decline_suggestion(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.gallery_suggestions;
begin
  perform public._require_gallery();
  update public.gallery_suggestions x set status = 'declined', handled_by = auth.uid(), handled_at = now() where x.id = p_id and x.status = 'pending' returning * into s;
  if not found then raise exception 'Suggestion not found' using errcode = 'P0001'; end if;
  perform public._notify(s.suggested_by, 'gallery_declined', null, null, null);
  perform public._audit('gallery_suggestion_decline', 'gallery_suggestions', p_id, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------------ reading: on this day
create or replace function public.gallery_on_this_day(p_limit int default 12)
returns setof public.gallery_photos language plpgsql stable security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_verified() then return; end if;
  return query select g.* from public.gallery_photos g
    where g.taken_on is not null and extract(month from g.taken_on) = extract(month from d) and extract(day from g.taken_on) = extract(day from d)
    order by g.taken_on limit least(greatest(p_limit, 1), 50);
end $$;

-- ------------------------------------------------------------------ grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin_gallery_add(jsonb)', 'admin_gallery_update(uuid,jsonb)', 'admin_gallery_remove(uuid)', 'admin_gallery_save_category(uuid,text,text)',
    'admin_gallery_reorder_categories(uuid[])', 'admin_gallery_delete_category(uuid)', 'admin_gallery_save_album(uuid,text,text,text)',
    'admin_gallery_delete_album(uuid)', 'suggest_gallery_photo(uuid,text)', 'admin_gallery_suggestions()', 'admin_gallery_decline_suggestion(uuid)',
    'gallery_on_this_day(int)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
