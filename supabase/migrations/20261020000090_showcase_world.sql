-- SHOWCASE PRIVACY + PUBLIC LANDING STATS + JEC WORLD (alumni by city).
--
--   member_showcase_prefs   one row per member who changed a default (no row = defaults):
--                             show_on_world_map  (default true)  counted on JEC World and listed in its city drill-down
--                             show_in_yearbook   (default true)  listed in the batch yearbook member list
--                             card_show_photo    (default false) the public ID-card check (verify_id_card) may show the photo
--                           Read / written only through my_showcase_prefs() / set_my_showcase_prefs(): no table grants.
--   _member_places()        internal: each verified, onboarded member's PROFILE city matched to the bundled GeoNames table
--                           (city centre coordinates; aliases such as Bangalore -> Bengaluru), or, when the city is unknown,
--                           the country (its largest bundled city stands in as the country's point, precision = 'country').
--                           Never a member's own position: the opt-in live location (member_locations) is not used here.
--   public_landing_stats()  anon: aggregated counts for the signed-out landing page + the flagship meet.
--   alumni_world()          verified members: one row per city (and per country for unknown cities) with a count.
--   public_alumni_world()   anon: only places with >= 3 visible alumni, counts rounded DOWN (3, 5, 10, 15, ... "at least").
--   alumni_world_city()     verified members: the members of one place (blocks and the map opt-out respected), paginated.
-- Country names from geo_countries are trimmed of stray \r (a database migrated from a Windows checkout stores them that way).

-- ------------------------------------------------------------------ privacy preferences
create table if not exists public.member_showcase_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  show_on_world_map boolean not null default true,
  show_in_yearbook boolean not null default true,
  card_show_photo boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.member_showcase_prefs enable row level security;
revoke all on public.member_showcase_prefs from public, anon, authenticated;
-- no policy and no grant: reached through the functions below only

drop trigger if exists member_showcase_prefs_touch on public.member_showcase_prefs;
create trigger member_showcase_prefs_touch before update on public.member_showcase_prefs
  for each row execute function public.touch_updated_at();

create or replace function public.my_showcase_prefs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'show_on_world_map', coalesce(s.show_on_world_map, true),
    'show_in_yearbook', coalesce(s.show_in_yearbook, true),
    'card_show_photo', coalesce(s.card_show_photo, false)) end
    from (select 1) one
    left join public.member_showcase_prefs s on s.user_id = auth.uid();
$$;

-- null leaves a setting as it is
create or replace function public.set_my_showcase_prefs(p_show_on_world_map boolean default null, p_show_in_yearbook boolean default null,
                                                        p_card_show_photo boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  insert into public.member_showcase_prefs (user_id, show_on_world_map, show_in_yearbook, card_show_photo)
  values (auth.uid(), coalesce(p_show_on_world_map, true), coalesce(p_show_in_yearbook, true), coalesce(p_card_show_photo, false))
  on conflict (user_id) do update set
    show_on_world_map = coalesce(p_show_on_world_map, public.member_showcase_prefs.show_on_world_map),
    show_in_yearbook = coalesce(p_show_in_yearbook, public.member_showcase_prefs.show_in_yearbook),
    card_show_photo = coalesce(p_card_show_photo, public.member_showcase_prefs.card_show_photo);
  return public.my_showcase_prefs();
end;
$$;

-- ------------------------------------------------------------------ matching a profile city to the bundled city table
create index if not exists geo_cities_country_pop_idx on public.geo_cities (country_code, population desc);

-- common spellings people type that differ from the GeoNames name
create or replace function public._world_city_key(p_city text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case k
           when 'bangalore' then 'bengaluru' when 'gurugram' then 'gurgaon' when 'bombay' then 'mumbai'
           when 'calcutta' then 'kolkata' when 'madras' then 'chennai' when 'poona' then 'pune' when 'baroda' then 'vadodara'
           when 'trivandrum' then 'thiruvananthapuram' when 'cochin' then 'kochi' when 'mysuru' then 'mysore'
           when 'prayagraj' then 'allahabad' when 'new york' then 'new york city' when 'nyc' then 'new york city'
           when 'jabalpur (m.p.)' then 'jabalpur' when 'jabalpur mp' then 'jabalpur'
           else k end
    from (select nullif(regexp_replace(lower(btrim(coalesce(p_city, ''))), '\s+', ' ', 'g'), '') as k) x;
$$;

create or replace function public._world_country_code(p_country text)
returns text
language sql
stable
set search_path = ''
as $$
  with k as (select lower(btrim(coalesce(nullif(btrim(p_country), ''), 'India'))) as v)
  select coalesce(
    (select case k.v
              when 'usa' then 'US' when 'us' then 'US' when 'u.s.a.' then 'US' when 'united states of america' then 'US' when 'america' then 'US'
              when 'uk' then 'GB' when 'u.k.' then 'GB' when 'england' then 'GB' when 'great britain' then 'GB' when 'britain' then 'GB'
              when 'scotland' then 'GB' when 'wales' then 'GB' when 'uae' then 'AE' when 'u.a.e.' then 'AE' when 'bharat' then 'IN'
              when 'holland' then 'NL' when 'korea' then 'KR' end from k),
    (select gc.code from public.geo_countries gc, k where lower(btrim(gc.name, E' \r\n\t')) = k.v or gc.code = upper(k.v) limit 1));
$$;

-- every verified, onboarded member with the place their profile names (p_visible_only: drop members who hid from the map)
create or replace function public._member_places(p_visible_only boolean)
returns table (user_id uuid, grad_year int, branch text, city_id int, city text, country_code text, country text,
               lat double precision, lng double precision, place_precision text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select p.id, p.grad_year, p.branch, public._world_city_key(p.city) as ckey, nullif(btrim(p.city), '') as raw_city,
           coalesce(nullif(btrim(p.country), ''), 'India') as cname, public._world_country_code(p.country) as cc
      from public.profiles p
      left join public.member_showcase_prefs s on s.user_id = p.id
     where p.verification = 'verified' and p.onboarded
       and (not p_visible_only or coalesce(s.show_on_world_map, true))
  )
  select m.id, m.grad_year, m.branch,
         g.id,
         coalesce(g.name, m.raw_city),
         coalesce(g.country_code, m.cc),
         coalesce((select btrim(gc.name, E' \r\n\t') from public.geo_countries gc where gc.code = coalesce(g.country_code, m.cc)), m.cname),
         coalesce(g.lat, f.lat), coalesce(g.lng, f.lng),
         case when g.id is not null then 'city' when f.id is not null then 'country' end
    from m
    left join lateral (
      select c.id, c.name, c.country_code, c.lat, c.lng from public.geo_cities c
       where m.ckey is not null and c.search_key = m.ckey and (m.cc is null or c.country_code = m.cc)
       order by c.population desc limit 1) g on true
    left join lateral (
      select c.id, c.lat, c.lng from public.geo_cities c
       where g.id is null and m.cc is not null and c.country_code = m.cc
       order by c.population desc limit 1) f on true;
$$;

-- ------------------------------------------------------------------ the signed-out landing page
create or replace function public.public_landing_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select p.grad_year, nullif(lower(btrim(p.current_company)), '') as company
      from public.profiles p where p.verification = 'verified' and p.onboarded
  ),
  places as (select * from public._member_places(false)),
  ev as (
    select e.slug, e.title, e.starts_at, e.ends_at, e.venue from public.events e
     where e.slug = 'alumni-meet-2026' and e.is_published
  )
  select jsonb_build_object(
    'verified_members', (select count(*) from v),
    'batches', (select count(distinct grad_year) from v where grad_year is not null),
    'companies', (select count(distinct company) from v where company is not null and company not in ('-', 'na', 'n/a', 'none', 'self', 'self employed', 'self-employed', 'student')),
    'countries', (select count(distinct coalesce(country_code, lower(country))) from places where city is not null or country_code is not null),
    'cities', (select count(distinct coalesce(city_id::text, lower(city) || '|' || coalesce(country_code, lower(country)))) from places where city is not null),
    'flagship', (select jsonb_build_object('slug', ev.slug, 'title', ev.title, 'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'venue', ev.venue) from ev),
    'generated_at', now());
$$;

-- ------------------------------------------------------------------ JEC World
create or replace function public.alumni_world()
returns table (city_id int, city text, country_code text, country text, lat double precision, lng double precision,
               place_precision text, alumni int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_verified() then raise exception 'Only verified members can see JEC World' using errcode = '42501'; end if;
  return query
    select case when x.place_precision = 'city' then x.city_id end, case when x.place_precision = 'city' then min(x.city) end,
           x.country_code, min(x.country), min(x.lat), min(x.lng), x.place_precision, count(*)::int
      from public._member_places(true) x
     where x.place_precision is not null
     group by x.place_precision, case when x.place_precision = 'city' then x.city_id end, x.country_code
     order by count(*) desc, min(x.city) nulls last;
end;
$$;

-- anon: only places with at least 3 visible alumni; counts rounded down so a single join or leave is not visible
create or replace function public.public_alumni_world()
returns table (city text, country_code text, country text, lat double precision, lng double precision, place_precision text,
               alumni_at_least int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.city, c.country_code, c.country, c.lat, c.lng, c.place_precision,
         case when c.n < 5 then 3 when c.n < 50 then (c.n / 5) * 5 else (c.n / 10) * 10 end
    from (
      select case when x.place_precision = 'city' then min(x.city) end as city, x.country_code, min(x.country) as country,
             -- a coarse point: two decimals (about 1 km) of the bundled city centre
             round(min(x.lat)::numeric, 2)::float8 as lat, round(min(x.lng)::numeric, 2)::float8 as lng,
             x.place_precision, count(*)::int as n
        from public._member_places(true) x
       where x.place_precision is not null
       group by x.place_precision, case when x.place_precision = 'city' then x.city_id end, x.country_code
    ) c
   where c.n >= 3
   order by c.n desc, c.city nulls last;
$$;

-- the members of one place. p_city_id for a city; p_city_id null + p_country_code for "somewhere in <country>" (unknown city)
create or replace function public.alumni_world_city(p_city_id int default null, p_country_code text default null,
                                                    p_limit int default 50, p_offset int default 0)
returns table (user_id uuid, full_name text, avatar_url text, grad_year int, branch text, headline text, current_title text,
               current_company text, city text, country text, same_batch boolean, total int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_year int;
begin
  if not public.is_verified() then raise exception 'Only verified members can see JEC World' using errcode = '42501'; end if;
  if p_city_id is null and nullif(btrim(coalesce(p_country_code, '')), '') is null then raise exception 'Choose a place' using errcode = 'P0001'; end if;
  select p.grad_year into my_year from public.profiles p where p.id = me;
  return query
    with hits as (
      select x.user_id, x.city, x.country from public._member_places(true) x
       where (p_city_id is not null and x.place_precision = 'city' and x.city_id = p_city_id)
          or (p_city_id is null and x.place_precision = 'country' and x.country_code = upper(btrim(p_country_code)))
    ),
    visible as (
      select h.*, p.full_name, p.avatar_url, p.grad_year, p.branch, p.headline, p.current_title, p.current_company
        from hits h join public.profiles p on p.id = h.user_id
       where not public.is_blocked_between(me, h.user_id)
    )
    select v.user_id, v.full_name, v.avatar_url, v.grad_year, v.branch, v.headline, v.current_title, v.current_company,
           v.city, v.country, (my_year is not null and v.grad_year = my_year), (count(*) over ())::int
      from visible v
     order by (my_year is not null and v.grad_year = my_year) desc, v.full_name, v.user_id
     limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public._world_city_key(text) from public, anon, authenticated;
revoke execute on function public._world_country_code(text) from public, anon, authenticated;
revoke execute on function public._member_places(boolean) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['my_showcase_prefs()', 'set_my_showcase_prefs(boolean, boolean, boolean)', 'alumni_world()',
                           'alumni_world_city(int, text, int, int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['public_landing_stats()', 'public_alumni_world()'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
