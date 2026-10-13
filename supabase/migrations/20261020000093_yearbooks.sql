-- BATCH YEARBOOK + "your batch" summary for Home.
--
--   yearbooks               curated content for one graduating year (branch null = the whole year) or one branch of it:
--                           cover, quote / motto, up to 12 class photos, memories, English + Hindi, published or draft.
--                           Files live in the public 'gallery' bucket under gallery/yearbooks/ (random names; the existing
--                           "gallery curators upload / delete" storage policies already cover the folder: gallery_manage).
--                           Verified members read published yearbooks; curators (gallery_manage) read drafts too.
--                           Written only through admin_save_yearbook / admin_delete_yearbook (activity log).
--   batch_yearbook()        verified members: the yearbook, header stats (aggregates; companies and cities only when >= 2
--                           members share them, names only), branch chips, and the member list (blocks and the
--                           show_in_yearbook opt-out respected; the caller always sees themself).
--   my_batchmates_summary() for Home: batchmates on the app, the 5 newest (verified) joiners, and how many live in my city.

create or replace function public._yearbook_paths_ok(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p), 0) <= 12
     and coalesce((select bool_and(x ~ '^gallery/yearbooks/[A-Za-z0-9/._-]{1,200}$') from unnest(p) x), true);
$$;

create table if not exists public.yearbooks (
  id uuid primary key default gen_random_uuid(),
  grad_year int not null check (grad_year between 1947 and 2100),
  branch text check (branch is null or char_length(btrim(branch)) between 2 and 80),
  cover_path text check (cover_path is null or cover_path ~ '^gallery/yearbooks/[A-Za-z0-9/._-]{1,200}$'),
  quote text check (char_length(quote) <= 300),
  quote_hi text check (char_length(quote_hi) <= 300),
  class_photo_paths text[] not null default '{}' check (public._yearbook_paths_ok(class_photo_paths)),
  memories text check (char_length(memories) <= 5000),
  memories_hi text check (char_length(memories_hi) <= 5000),
  is_published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists yearbooks_year_branch_idx on public.yearbooks (grad_year, coalesce(branch, ''));

alter table public.yearbooks enable row level security;
drop policy if exists "verified read published yearbooks" on public.yearbooks;
create policy "verified read published yearbooks" on public.yearbooks for select to authenticated
  using ((is_published and public.is_verified()) or public._admin_can('gallery_manage'));
revoke all on public.yearbooks from public, anon, authenticated;
grant select on public.yearbooks to authenticated;

drop trigger if exists yearbooks_touch on public.yearbooks;
create trigger yearbooks_touch before update on public.yearbooks for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ curating
create or replace function public.admin_save_yearbook(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_year int := nullif(p ->> 'grad_year', '')::int;
  v_branch text := nullif(btrim(coalesce(p ->> 'branch', '')), '');
  v_cover text := nullif(btrim(coalesce(p ->> 'cover_path', '')), '');
  v_photos text[];
  v_missing int;
begin
  perform public._require_gallery();
  if v_year is null or v_year < 1947 or v_year > 2100 then raise exception 'Enter the batch year' using errcode = 'P0001', hint = 'yearbook.errYear'; end if;
  if p ? 'class_photo_paths' and jsonb_typeof(p -> 'class_photo_paths') = 'array' then
    select coalesce(array_agg(x order by o), '{}') into v_photos from jsonb_array_elements_text(p -> 'class_photo_paths') with ordinality t(x, o);
  end if;
  if not public._yearbook_paths_ok(coalesce(v_photos, '{}')) or (v_cover is not null and not public._yearbook_paths_ok(array[v_cover])) then
    raise exception 'Up to 12 class photos, uploaded to the yearbook folder' using errcode = 'P0001', hint = 'yearbook.errPhotos';
  end if;
  select count(*) into v_missing from unnest(coalesce(v_photos, '{}') || case when v_cover is null then '{}'::text[] else array[v_cover] end) f
   where not exists (select 1 from storage.objects o where o.bucket_id = 'gallery' and o.name = f);
  if v_missing > 0 then raise exception 'A photo was not found. Please upload it again.' using errcode = 'P0001', hint = 'yearbook.errFile'; end if;

  if v_id is null then
    insert into public.yearbooks (grad_year, branch, created_by) values (v_year, v_branch, auth.uid())
    on conflict (grad_year, coalesce(branch, '')) do nothing
    returning id into v_id;
    if v_id is null then raise exception 'This batch already has a yearbook' using errcode = 'P0001', hint = 'yearbook.errExists'; end if;
  elsif not exists (select 1 from public.yearbooks y where y.id = v_id) then
    raise exception 'Yearbook not found' using errcode = 'P0001';
  end if;

  update public.yearbooks set
    grad_year = v_year, branch = v_branch,
    cover_path = case when p ? 'cover_path' then v_cover else cover_path end,
    class_photo_paths = coalesce(v_photos, class_photo_paths),
    quote = case when p ? 'quote' then nullif(btrim(left(p ->> 'quote', 300)), '') else quote end,
    quote_hi = case when p ? 'quote_hi' then nullif(btrim(left(p ->> 'quote_hi', 300)), '') else quote_hi end,
    memories = case when p ? 'memories' then nullif(btrim(left(p ->> 'memories', 5000)), '') else memories end,
    memories_hi = case when p ? 'memories_hi' then nullif(btrim(left(p ->> 'memories_hi', 5000)), '') else memories_hi end,
    is_published = coalesce((p ->> 'is_published')::boolean, is_published)
   where id = v_id;
  perform public._audit('yearbook_save', 'yearbooks', v_id,
    jsonb_build_object('grad_year', v_year, 'branch', v_branch, 'published', (select y.is_published from public.yearbooks y where y.id = v_id)));
  return v_id;
end;
$$;

-- returns the files so the app can remove them from storage
create or replace function public.admin_delete_yearbook(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  y public.yearbooks;
begin
  perform public._require_gallery();
  delete from public.yearbooks where id = p_id returning * into y;
  if not found then raise exception 'Yearbook not found' using errcode = 'P0001'; end if;
  perform public._audit('yearbook_delete', 'yearbooks', p_id, jsonb_build_object('grad_year', y.grad_year, 'branch', y.branch));
  return y.class_photo_paths || case when y.cover_path is null then '{}'::text[] else array[y.cover_path] end;
end;
$$;

-- ------------------------------------------------------------------ reading
create or replace function public.batch_yearbook(p_year int, p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  curator boolean;
  result jsonb;
begin
  if not public.is_verified() then raise exception 'Only verified members can open the yearbook' using errcode = '42501'; end if;
  if p_year is null or p_year < 1947 or p_year > 2100 then raise exception 'Choose a batch' using errcode = 'P0001'; end if;
  curator := public._admin_can('gallery_manage');

  with batch as (
    select p.id, p.full_name, p.avatar_url, p.branch, p.grad_year, p.headline, p.current_title, p.current_company, p.city, p.country,
           coalesce(s.show_in_yearbook, true) as listed
      from public.profiles p
      left join public.member_showcase_prefs s on s.user_id = p.id
     where p.verification = 'verified' and p.onboarded and p.grad_year = p_year
  ),
  scoped as (select * from batch b where v_branch is null or b.branch = v_branch),
  yb as (
    select y.* from public.yearbooks y
     where y.grad_year = p_year and (y.is_published or curator)
       and (y.branch is not distinct from v_branch or y.branch is null)
     order by (y.branch is not distinct from v_branch) desc limit 1
  ),
  people as (
    select sc.* from scoped sc
     where (sc.listed or sc.id = me) and (sc.id = me or not public.is_blocked_between(me, sc.id))
     order by sc.full_name, sc.id limit 1000
  )
  select jsonb_build_object(
    'grad_year', p_year,
    'branch', v_branch,
    'years_since', extract(year from (now() at time zone 'Asia/Kolkata'))::int - p_year,
    'yearbook', (select jsonb_build_object('id', yb.id, 'grad_year', yb.grad_year, 'branch', yb.branch, 'cover_path', yb.cover_path,
                   'quote', yb.quote, 'quote_hi', yb.quote_hi, 'class_photo_paths', to_jsonb(yb.class_photo_paths),
                   'memories', yb.memories, 'memories_hi', yb.memories_hi, 'is_published', yb.is_published, 'updated_at', yb.updated_at) from yb),
    'stats', jsonb_build_object(
      'members', (select count(*) from scoped),
      'cities', (select count(distinct lower(btrim(city)) || '|' || lower(coalesce(nullif(btrim(country), ''), 'India'))) from scoped where nullif(btrim(city), '') is not null),
      'countries', (select count(distinct lower(coalesce(nullif(btrim(country), ''), 'India'))) from scoped where nullif(btrim(city), '') is not null or nullif(btrim(country), '') is not null),
      'top_companies', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'members', c.n) order by c.n desc, c.name), '[]'::jsonb) from (
                          select min(btrim(current_company)) as name, count(*)::int as n from scoped
                           where nullif(btrim(current_company), '') is not null
                           group by lower(btrim(current_company)) having count(*) >= 2 order by count(*) desc, min(btrim(current_company)) limit 8) c),
      'top_cities', (select coalesce(jsonb_agg(jsonb_build_object('city', c.city, 'country', c.country, 'members', c.n) order by c.n desc, c.city), '[]'::jsonb) from (
                       select min(btrim(city)) as city, min(coalesce(nullif(btrim(country), ''), 'India')) as country, count(*)::int as n from scoped
                        where nullif(btrim(city), '') is not null
                        group by lower(btrim(city)), lower(coalesce(nullif(btrim(country), ''), 'India')) having count(*) >= 2
                        order by count(*) desc, min(btrim(city)) limit 8) c)),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('branch', b.branch, 'members', b.n) order by b.n desc, b.branch), '[]'::jsonb) from (
                   select branch, count(*)::int as n from batch where branch is not null group by branch) b),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'full_name', pe.full_name, 'avatar_url', pe.avatar_url,
                   'branch', pe.branch, 'grad_year', pe.grad_year, 'headline', pe.headline, 'current_title', pe.current_title,
                   'current_company', pe.current_company, 'city', pe.city, 'country', pe.country, 'is_me', pe.id = me,
                   'listed', pe.listed) order by pe.full_name, pe.id), '[]'::jsonb) from people pe),
    'hidden_count', (select count(*) from scoped where not listed and id <> me))
    into result;
  return result;
end;
$$;

create or replace function public.my_batchmates_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my public.profiles;
  my_key text;
  my_cc text;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  select * into my from public.profiles where id = me;
  if my.grad_year is null then
    return jsonb_build_object('grad_year', null, 'branch', my.branch, 'batchmates', 0, 'same_branch', 0, 'in_my_city', 0, 'newest', '[]'::jsonb);
  end if;
  my_key := public._world_city_key(my.city);
  my_cc := public._world_country_code(my.country);
  return (
    with mates as (
      select p.id, p.full_name, p.avatar_url, p.branch, p.city, p.country, coalesce(c.issued_at, p.created_at) as joined_at
        from public.profiles p
        left join public.member_cards c on c.user_id = p.id
       where p.verification = 'verified' and p.onboarded and p.grad_year = my.grad_year and p.id <> me
    )
    select jsonb_build_object(
      'grad_year', my.grad_year,
      'branch', my.branch,
      'batchmates', (select count(*) from mates),
      'same_branch', (select count(*) from mates where my.branch is not null and branch = my.branch),
      'in_my_city', (select count(*) from mates
                      where my_key is not null and public._world_city_key(city) = my_key
                        and public._world_country_code(country) is not distinct from my_cc),
      'newest', case when public.is_verified() then (
          select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'full_name', n.full_name, 'avatar_url', n.avatar_url,
                   'branch', n.branch, 'joined_at', n.joined_at) order by n.joined_at desc), '[]'::jsonb)
            from (select * from mates m where not public.is_blocked_between(me, m.id) order by m.joined_at desc, m.id limit 5) n)
        else '[]'::jsonb end));
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public._yearbook_paths_ok(text[]) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['admin_save_yearbook(jsonb)', 'admin_delete_yearbook(uuid)', 'batch_yearbook(int, text)', 'my_batchmates_summary()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
