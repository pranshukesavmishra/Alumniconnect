-- WALL OF FAME (alumni spotlight): curated stories of achievers, entrepreneurs, public servants, researchers, sports people,
-- artists and legends, members or not. (The older "spotlights" table is the weekly "JECian of the Week" and is unchanged.)
--
--   wall_of_fame          member_id is optional (legends who are not on the app). Image in the public 'gallery' bucket under
--                         gallery/fame/ (the existing gallery curator storage policies cover it). Links: https only.
--                         Shown while published and inside the optional starts_at / ends_at window.
--                         Verified members read what is shown (RLS); curators (gallery_manage) read everything.
--                         is_public = also shown on the signed-out landing page, through public_wall_of_fame() (no ids).
--                         Written only through admin_save_fame / admin_delete_fame / admin_reorder_fame (activity log).

create table if not exists public.wall_of_fame (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  title_hi text check (char_length(title_hi) <= 160),
  story text check (char_length(story) <= 2000),
  story_hi text check (char_length(story_hi) <= 2000),
  image_path text check (image_path is null or image_path ~ '^gallery/fame/[A-Za-z0-9/._-]{1,200}$'),
  link_url text check (link_url is null or (char_length(link_url) <= 500
    and link_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[^[:space:]<>"''\\]*)?$')),
  category text not null check (category in ('achiever', 'entrepreneur', 'public_service', 'research', 'sports', 'arts', 'legend')),
  grad_year int check (grad_year between 1947 and 2100),
  branch text check (char_length(branch) <= 80),
  sort int not null default 0,
  is_published boolean not null default false,
  is_public boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists wall_of_fame_shown_idx on public.wall_of_fame (sort, created_at desc) where is_published;

alter table public.wall_of_fame enable row level security;
drop policy if exists "verified read the wall of fame" on public.wall_of_fame;
create policy "verified read the wall of fame" on public.wall_of_fame for select to authenticated
  using ((is_published and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) and public.is_verified())
         or public._admin_can('gallery_manage'));
revoke all on public.wall_of_fame from public, anon, authenticated;
grant select on public.wall_of_fame to authenticated;

drop trigger if exists wall_of_fame_touch on public.wall_of_fame;
create trigger wall_of_fame_touch before update on public.wall_of_fame for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ curating
create or replace function public.admin_save_fame(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_member uuid := nullif(p ->> 'member_id', '')::uuid;
  v_image text := nullif(btrim(coalesce(p ->> 'image_path', '')), '');
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_link text := nullif(btrim(coalesce(p ->> 'link_url', '')), '');
  m public.profiles;
begin
  perform public._require_gallery();
  if v_member is not null then
    select * into m from public.profiles where id = v_member;
    if not found then raise exception 'Choose a member from the list' using errcode = 'P0001', hint = 'fame.errMember'; end if;
    if v_name = '' then v_name := m.full_name; end if;
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'Enter a name' using errcode = 'P0001', hint = 'fame.errName'; end if;
  if char_length(v_title) < 2 or char_length(v_title) > 160 then raise exception 'Enter a headline' using errcode = 'P0001', hint = 'fame.errTitle'; end if;
  if coalesce(p ->> 'category', '') not in ('achiever', 'entrepreneur', 'public_service', 'research', 'sports', 'arts', 'legend') then
    raise exception 'Choose a category' using errcode = 'P0001', hint = 'fame.errCategory';
  end if;
  if char_length(coalesce(p ->> 'story', '')) > 2000 or char_length(coalesce(p ->> 'story_hi', '')) > 2000 then
    raise exception 'The story can be up to 2000 characters' using errcode = 'P0001', hint = 'fame.errStory';
  end if;
  if v_link is not null and (char_length(v_link) > 500
       or v_link !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[^[:space:]<>"''\\]*)?$') then
    raise exception 'Links must start with https://' using errcode = 'P0001', hint = 'fame.errLink';
  end if;
  if v_image is not null and (v_image !~ '^gallery/fame/[A-Za-z0-9/._-]{1,200}$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'gallery' and o.name = v_image)) then
    raise exception 'The photo was not found. Please upload it again.' using errcode = 'P0001', hint = 'fame.errFile';
  end if;

  if v_id is null then
    insert into public.wall_of_fame (name, title, category, created_by, sort)
    values (v_name, v_title, p ->> 'category', auth.uid(), coalesce((select max(f.sort) + 1 from public.wall_of_fame f), 0))
    returning id into v_id;
  elsif not exists (select 1 from public.wall_of_fame f where f.id = v_id) then
    raise exception 'Entry not found' using errcode = 'P0001';
  end if;

  update public.wall_of_fame set
    member_id = v_member, name = v_name, title = v_title, category = p ->> 'category',
    title_hi = nullif(btrim(left(coalesce(p ->> 'title_hi', ''), 160)), ''),
    story = nullif(btrim(coalesce(p ->> 'story', '')), ''),
    story_hi = nullif(btrim(coalesce(p ->> 'story_hi', '')), ''),
    image_path = case when p ? 'image_path' then v_image else image_path end,
    link_url = v_link,
    grad_year = coalesce(nullif(p ->> 'grad_year', '')::int, m.grad_year),
    branch = coalesce(nullif(btrim(left(coalesce(p ->> 'branch', ''), 80)), ''), m.branch),
    is_published = coalesce((p ->> 'is_published')::boolean, is_published),
    is_public = coalesce((p ->> 'is_public')::boolean, is_public),
    starts_at = nullif(p ->> 'starts_at', '')::timestamptz,
    ends_at = nullif(p ->> 'ends_at', '')::timestamptz
   where id = v_id;
  perform public._audit('fame_save', 'wall_of_fame', v_id,
    (select jsonb_build_object('name', f.name, 'category', f.category, 'published', f.is_published, 'public', f.is_public)
       from public.wall_of_fame f where f.id = v_id));
  return v_id;
end;
$$;

create or replace function public.admin_delete_fame(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.wall_of_fame;
begin
  perform public._require_gallery();
  delete from public.wall_of_fame where id = p_id returning * into f;
  if not found then raise exception 'Entry not found' using errcode = 'P0001'; end if;
  perform public._audit('fame_delete', 'wall_of_fame', p_id, jsonb_build_object('name', f.name));
  return case when f.image_path is null then '{}'::text[] else array[f.image_path] end;
end;
$$;

create or replace function public.admin_reorder_fame(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_gallery();
  update public.wall_of_fame f set sort = o.ord::int
    from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality o(id, ord)
   where f.id = o.id and f.sort is distinct from o.ord::int;
  perform public._audit('fame_reorder', 'wall_of_fame', null, jsonb_build_object('count', cardinality(p_ids)));
end;
$$;

-- ------------------------------------------------------------------ reading
-- verified members: what is shown now, with the member's avatar when no image was uploaded
create or replace function public.wall_of_fame_list(p_category text default null)
returns table (id uuid, member_id uuid, name text, title text, title_hi text, story text, story_hi text, image_path text,
               avatar_url text, link_url text, category text, grad_year int, branch text, is_public boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, case when f.member_id is not null and not public.is_blocked_between(auth.uid(), f.member_id) then f.member_id end,
         f.name, f.title, f.title_hi, f.story, f.story_hi, f.image_path,
         case when f.image_path is null and f.member_id is not null then p.avatar_url end,
         f.link_url, f.category, f.grad_year, f.branch, f.is_public
    from public.wall_of_fame f
    left join public.profiles p on p.id = f.member_id
   where public.is_verified()
     and f.is_published and (f.starts_at is null or f.starts_at <= now()) and (f.ends_at is null or f.ends_at > now())
     and (p_category is null or f.category = p_category)
   order by f.sort, f.created_at desc
   limit 200;
$$;

-- the landing page (anon): public entries only, no ids, no member avatar unless an image was uploaded for the entry
create or replace function public.public_wall_of_fame(p_limit int default 12)
returns table (name text, title text, title_hi text, story text, story_hi text, image_path text, link_url text, category text,
               grad_year int, branch text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.name, f.title, f.title_hi, f.story, f.story_hi, f.image_path, f.link_url, f.category, f.grad_year, f.branch
    from public.wall_of_fame f
   where f.is_published and f.is_public and (f.starts_at is null or f.starts_at <= now()) and (f.ends_at is null or f.ends_at > now())
   order by f.sort, f.created_at desc
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_save_fame(jsonb)', 'admin_delete_fame(uuid)', 'admin_reorder_fame(uuid[])', 'wall_of_fame_list(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.public_wall_of_fame(int) from public;
grant execute on function public.public_wall_of_fame(int) to anon, authenticated;
