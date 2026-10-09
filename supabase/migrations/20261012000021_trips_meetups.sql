-- Trips ("I'll be in Pune 12-15 Nov"), city meetups (opt-in group chats per city) and opt-in alerts.
--
--  * Trips: the member chooses a city from the bundled city table and dates, and who may see it (everyone / my batch).
--    Expired trips disappear by date (every read filters on the date; no cron). No coordinates are involved.
--  * Meetups: a normal group chat (kind 'meetup') plus a small city_meetups row. Nobody is ever added automatically:
--    members join and leave themselves; the creator and admins moderate; admins can hide or close (audited).
--  * Alerts (off by default): "a batchmate is in my city" and "a JECian plans a trip to my city", through the existing
--    notifications table (and so push). At most one alert per person per kind per 7 days; nobody is named unless they
--    chose to be visible (city sharing on / trip visibility allows); blocks respected; turning things off removes
--    pending (unread) alerts.

alter type public.group_kind add value if not exists 'meetup';

-- ------------------------------------------------------------------ helpers
create or replace function public._today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
revoke execute on function public._today() from anon, authenticated, public;

-- Where is this member right now (for alerts)? Their shared city; without sharing, the city on their profile.
create or replace function public._loc_in_city(p_user uuid, p_city_id int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_locations m join public.location_prefs s on s.user_id = m.user_id and s.sharing
                  where m.user_id = p_user and m.city_id = p_city_id)
      or (not exists (select 1 from public.location_prefs s where s.user_id = p_user and s.sharing)
          and exists (select 1 from public.profiles p
                        join public.geo_cities c on c.id = p_city_id
                        left join public.geo_countries gc on gc.code = c.country_code
                       where p.id = p_user and lower(btrim(p.city)) in (lower(c.name), c.search_key)
                         and coalesce(nullif(btrim(p.country), ''), 'India') = coalesce(gc.name, c.country_code)));
$$;
revoke execute on function public._loc_in_city(uuid, int) from anon, authenticated, public;

-- ------------------------------------------------------------------ trips
create table public.member_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  city_id int not null references public.geo_cities (id),
  starts_on date not null,
  ends_on date not null,
  visibility text not null default 'everyone' check (visibility in ('everyone', 'batch')),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 90)
);
create index member_trips_city_idx on public.member_trips (city_id, ends_on) where cancelled_at is null;
create index member_trips_user_idx on public.member_trips (user_id, ends_on);
alter table public.member_trips enable row level security;
revoke all on public.member_trips from anon, authenticated, public;   -- reached through the functions below only

-- one validated write path for add and edit
create or replace function public._trip_check(p_city_id int, p_starts date, p_ends date, p_visibility text, p_keep_start date, p_exclude uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare today date := public._today();
begin
  if not exists (select 1 from public.geo_cities where id = p_city_id) then raise exception 'Choose a city from the list'; end if;
  if p_starts is null or p_ends is null then raise exception 'Choose the dates of your trip'; end if;
  if coalesce(p_visibility, '') not in ('everyone', 'batch') then raise exception 'Choose who can see this trip'; end if;
  if p_ends < p_starts then raise exception 'The end date can’t be before the start date'; end if;
  if p_ends < today or (p_starts < today and p_starts is distinct from p_keep_start) then raise exception 'A trip can’t be in the past'; end if;
  if p_ends - p_starts > 90 then raise exception 'A trip can be at most 90 days long'; end if;
  if (select count(*) from public.member_trips t where t.user_id = auth.uid() and t.cancelled_at is null and t.ends_on >= today
         and t.id is distinct from p_exclude) >= 5 then
    raise exception 'You can have up to 5 upcoming trips. Cancel one first.';
  end if;
end;
$$;
revoke execute on function public._trip_check(int, date, date, text, date, uuid) from anon, authenticated, public;

create or replace function public.add_trip(p_city_id int, p_starts date, p_ends date, p_visibility text default 'everyone')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t uuid;
begin
  if not public.is_verified() then raise exception 'Only verified members can add trips' using errcode = '42501'; end if;
  perform public._trip_check(p_city_id, p_starts, p_ends, p_visibility, null, null);
  insert into public.member_trips (user_id, city_id, starts_on, ends_on, visibility)
  values (me, p_city_id, p_starts, p_ends, p_visibility) returning id into t;
  perform public._alert_trip(t);
  return t;
end;
$$;

create or replace function public.update_trip(p_id uuid, p_city_id int, p_starts date, p_ends date, p_visibility text)
returns void language plpgsql security definer set search_path = '' as $$
declare old public.member_trips;
begin
  select * into old from public.member_trips where id = p_id and user_id = auth.uid() and cancelled_at is null for update;
  if not found then raise exception 'Trip not found'; end if;
  perform public._trip_check(p_city_id, p_starts, p_ends, p_visibility, old.starts_on, p_id);
  update public.member_trips set city_id = p_city_id, starts_on = p_starts, ends_on = p_ends, visibility = p_visibility, updated_at = now()
   where id = p_id;
  -- pending alerts about the old plan are withdrawn
  if old.city_id <> p_city_id or (old.visibility = 'everyone' and p_visibility = 'batch') then
    delete from public.notifications where kind = 'nearby_trip' and target_id = p_id and read_at is null;
  end if;
end;
$$;

create or replace function public.cancel_trip(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.member_trips set cancelled_at = now(), updated_at = now() where id = p_id and user_id = auth.uid() and cancelled_at is null;
  if not found then raise exception 'Trip not found'; end if;
  delete from public.notifications where kind = 'nearby_trip' and target_id = p_id and read_at is null;
end;
$$;

create or replace function public.my_trips()
returns table (id uuid, city_id int, city text, region text, country text, starts_on date, ends_on date, visibility text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.city_id, c.name, c.region, coalesce(gc.name, c.country_code), t.starts_on, t.ends_on, t.visibility
    from public.member_trips t
    join public.geo_cities c on c.id = t.city_id
    left join public.geo_countries gc on gc.code = c.country_code
   where t.user_id = auth.uid() and t.cancelled_at is null and t.ends_on >= public._today()
   order by t.starts_on, t.created_at;
$$;

-- "Visiting soon" in a city: upcoming trips this member is allowed to see.
create or replace function public.city_trips(p_city_id int)
returns table (id uuid, user_id uuid, full_name text, avatar_url text, grad_year int, branch text, current_title text,
               current_company text, starts_on date, ends_on date, visibility text, mine boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.user_id, p.full_name, p.avatar_url, p.grad_year, p.branch, p.current_title, p.current_company,
         t.starts_on, t.ends_on, t.visibility, t.user_id = auth.uid()
    from public.member_trips t
    join public.profiles p on p.id = t.user_id
    join public.profiles me on me.id = auth.uid()
   where public.is_verified() and t.city_id = p_city_id and t.cancelled_at is null and t.ends_on >= public._today()
     and p.onboarded and p.verification = 'verified'
     and (t.user_id = me.id or (not public.is_blocked_between(t.user_id, me.id)
          and (t.visibility = 'everyone' or (me.grad_year is not null and p.grad_year = me.grad_year))))
   order by t.starts_on, p.full_name
   limit 100;
$$;

-- Upcoming-trip chip on someone's profile (only trips this member may see).
create or replace function public.member_trips_of(p_user uuid)
returns table (id uuid, city_id int, city text, country text, starts_on date, ends_on date)
language sql stable security definer set search_path = '' as $$
  select t.id, t.city_id, c.name, coalesce(gc.name, c.country_code), t.starts_on, t.ends_on
    from public.member_trips t
    join public.profiles p on p.id = t.user_id
    join public.profiles me on me.id = auth.uid()
    join public.geo_cities c on c.id = t.city_id
    left join public.geo_countries gc on gc.code = c.country_code
   where public.is_verified() and t.user_id = p_user and t.cancelled_at is null and t.ends_on >= public._today()
     and p.onboarded and p.verification = 'verified'
     and (t.user_id = me.id or (not public.is_blocked_between(t.user_id, me.id)
          and (t.visibility = 'everyone' or (me.grad_year is not null and p.grad_year = me.grad_year))))
   order by t.starts_on
   limit 5;
$$;

create or replace function public.city_info(p_city_id int)
returns table (id int, name text, region text, country text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.region, coalesce(gc.name, c.country_code)
    from public.geo_cities c left join public.geo_countries gc on gc.code = c.country_code
   where c.id = p_city_id and public.is_verified();
$$;

-- ------------------------------------------------------------------ alert settings (all off by default)
alter table public.location_prefs
  add column alert_batchmate boolean not null default false,
  add column alert_batchmate_scope text not null default 'batch' check (alert_batchmate_scope in ('batch', 'everyone')),
  add column alert_trip boolean not null default false,
  add column alert_trip_scope text not null default 'batch' check (alert_trip_scope in ('batch', 'everyone'));

-- at most one alert per person per kind per 7 days, and a record of who it was about (never shown to anyone)
create table public.location_alert_log (
  id bigint generated always as identity primary key,
  recipient uuid not null references public.profiles (id) on delete cascade,
  subject uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('batchmate', 'trip')),
  city_id int not null,
  created_at timestamptz not null default now()
);
create index location_alert_log_idx on public.location_alert_log (recipient, kind, created_at desc);
alter table public.location_alert_log enable row level security;
revoke all on public.location_alert_log from anon, authenticated, public;

create or replace function public.set_location_alerts(p_batchmate boolean, p_batchmate_scope text, p_trip boolean, p_trip_scope text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  old public.location_prefs;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  if coalesce(p_batchmate_scope, 'batch') not in ('batch', 'everyone') or coalesce(p_trip_scope, 'batch') not in ('batch', 'everyone') then
    raise exception 'Choose my batch or everyone';
  end if;
  select * into old from public.location_prefs where user_id = me;
  insert into public.location_prefs (user_id, alert_batchmate, alert_batchmate_scope, alert_trip, alert_trip_scope)
  values (me, coalesce(p_batchmate, false), coalesce(p_batchmate_scope, 'batch'), coalesce(p_trip, false), coalesce(p_trip_scope, 'batch'))
  on conflict (user_id) do update set alert_batchmate = excluded.alert_batchmate, alert_batchmate_scope = excluded.alert_batchmate_scope,
    alert_trip = excluded.alert_trip, alert_trip_scope = excluded.alert_trip_scope;
  -- turning an alert off removes the ones still waiting to be read
  if not coalesce(p_batchmate, false) then delete from public.notifications where user_id = me and kind = 'nearby_batchmate' and read_at is null; end if;
  if not coalesce(p_trip, false) then delete from public.notifications where user_id = me and kind = 'nearby_trip' and read_at is null; end if;
  return public.my_location();
end;
$$;

-- ------------------------------------------------------------------ alert senders (internal)
create or replace function public._alert_city_arrival(p_subject uuid, p_city_id int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.profiles;
  c public.geo_cities;
  r record;
  n int := 0;
begin
  select * into s from public.profiles where id = p_subject and onboarded and verification = 'verified';
  if not found then return 0; end if;
  -- only people who chose to be visible (city sharing on) are ever announced
  if not exists (select 1 from public.location_prefs where user_id = p_subject and sharing) then return 0; end if;
  select * into c from public.geo_cities where id = p_city_id;
  if not found then return 0; end if;
  for r in
    select p.id from public.profiles p join public.location_prefs pr on pr.user_id = p.id
     where pr.alert_batchmate and p.id <> p_subject and p.onboarded and p.verification = 'verified'
       and (pr.alert_batchmate_scope = 'everyone' or (s.grad_year is not null and p.grad_year = s.grad_year))
       and not public.is_blocked_between(p.id, p_subject)
       and public._loc_in_city(p.id, p_city_id)
       and not exists (select 1 from public.location_alert_log l
                        where l.recipient = p.id and l.kind = 'batchmate' and l.created_at > now() - interval '7 days')
  loop
    insert into public.location_alert_log (recipient, subject, kind, city_id) values (r.id, p_subject, 'batchmate', p_city_id);
    perform public._notify(r.id, 'nearby_batchmate', p_subject, null, c.name);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public._alert_city_arrival(uuid, int) from anon, authenticated, public;

create or replace function public._alert_trip(p_trip uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t public.member_trips;
  s public.profiles;
  c public.geo_cities;
  r record;
  n int := 0;
begin
  select * into t from public.member_trips where id = p_trip and cancelled_at is null;
  if not found then return 0; end if;
  select * into s from public.profiles where id = t.user_id and onboarded and verification = 'verified';
  if not found then return 0; end if;
  select * into c from public.geo_cities where id = t.city_id;
  for r in
    select p.id from public.profiles p join public.location_prefs pr on pr.user_id = p.id
     where pr.alert_trip and p.id <> t.user_id and p.onboarded and p.verification = 'verified'
       -- the trip's own visibility always wins over the recipient's scope
       and (case when t.visibility = 'batch' then s.grad_year is not null and p.grad_year = s.grad_year
                 else pr.alert_trip_scope = 'everyone' or (s.grad_year is not null and p.grad_year = s.grad_year) end)
       and not public.is_blocked_between(p.id, t.user_id)
       and public._loc_in_city(p.id, t.city_id)
       and not exists (select 1 from public.location_alert_log l
                        where l.recipient = p.id and l.kind = 'trip' and l.created_at > now() - interval '7 days')
  loop
    insert into public.location_alert_log (recipient, subject, kind, city_id) values (r.id, t.user_id, 'trip', t.city_id);
    perform public._notify(r.id, 'nearby_trip', t.user_id, t.id, c.name);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public._alert_trip(uuid) from anon, authenticated, public;

-- ------------------------------------------------------------------ my_location: now also reports alert settings
create or replace function public.my_location()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.location_prefs;
  l public.member_locations;
  reg text;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  select * into s from public.location_prefs where user_id = me;
  select * into l from public.member_locations where user_id = me;
  select c.region into reg from public.geo_cities c where c.id = l.city_id;
  return jsonb_build_object(
    'sharing', coalesce(s.sharing, false),
    'update_profile', coalesce(s.update_profile, false),
    'prompt_dismissed', coalesce(s.prompt_dismissed, false),
    'city', l.city,
    'city_id', l.city_id,
    'region', reg,
    'country', l.country,
    'lat', l.lat,
    'lng', l.lng,
    'updated_at', l.updated_at,
    'alerts', jsonb_build_object(
      'batchmate', coalesce(s.alert_batchmate, false), 'batchmate_scope', coalesce(s.alert_batchmate_scope, 'batch'),
      'trip', coalesce(s.alert_trip, false), 'trip_scope', coalesce(s.alert_trip_scope, 'batch')),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', h.action, 'at', h.created_at) order by h.id desc)
                           from (select * from public.location_consent_log where user_id = me order by id desc limit 50) h), '[]'::jsonb));
end;
$$;

-- clearing the location also withdraws alerts about this member that haven't been read yet
create or replace function public.clear_my_location()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  was boolean;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  select sharing into was from public.location_prefs where user_id = me;
  delete from public.member_locations where user_id = me;
  insert into public.location_prefs (user_id, sharing, update_profile, prompt_dismissed)
  values (me, false, false, true)
  on conflict (user_id) do update set sharing = false, update_profile = false, prompt_dismissed = true;
  delete from public.notifications where kind = 'nearby_batchmate' and actor_id = me and read_at is null;
  if coalesce(was, false) then
    insert into public.location_consent_log (user_id, action) values (me, 'opt_out');
  end if;
  return public.my_location();
end;
$$;

-- set_my_location: same rules as before, plus "changed city" -> alerts
create or replace function public.set_my_location(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.location_prefs;
  old_row public.member_locations;
  has_row boolean;
  rlat numeric;
  rlng numeric;
  c public.geo_cities;
  cname text;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That location doesn’t look right' using hint = 'loc.errBadPoint';
  end if;
  select * into s from public.location_prefs where user_id = me for update;
  if not coalesce(s.sharing, false) then
    raise exception 'Turn on “Share my city” first' using hint = 'loc.errNotSharing';
  end if;
  select * into old_row from public.member_locations where user_id = me;
  has_row := found;
  if has_row and s.last_set_at > now() - interval '10 minutes' then
    raise exception 'Your city was updated a few minutes ago. Please try again later.' using hint = 'loc.errTooSoon';
  end if;
  if s.sets_day = current_date and s.sets_count >= 20 then
    raise exception 'Your city was updated many times today. Please try again tomorrow.' using hint = 'loc.errDaily';
  end if;

  rlat := public._loc_round(p_lat);
  rlng := public._loc_round(p_lng);
  if rlng > 180 then rlng := 180; end if;
  if rlng < -180 then rlng := -180; end if;
  c := public._loc_nearest_city(rlat::float8, rlng::float8);
  select coalesce(gc.name, c.country_code) into cname from public.geo_countries gc where gc.code = c.country_code;

  insert into public.member_locations (user_id, lat, lng, city_id, city, country, updated_at)
  values (me, rlat, rlng, c.id, c.name, cname, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, city_id = excluded.city_id,
    city = excluded.city, country = excluded.country, updated_at = now();
  update public.location_prefs
     set last_set_at = now(),
         sets_day = current_date,
         sets_count = case when sets_day = current_date then sets_count + 1 else 1 end
   where user_id = me;
  if s.update_profile and c.name is not null then
    update public.profiles set city = c.name, country = cname
     where id = me and (city is distinct from c.name or country is distinct from cname);
  end if;
  -- moved to another city: tell the batchmates (and others) who asked to hear about it
  if has_row and old_row.city_id is distinct from c.id then
    perform public._alert_city_arrival(me, c.id);
  end if;
  return public.my_location();
end;
$$;

-- ------------------------------------------------------------------ meetups
create table public.city_meetups (
  group_id uuid primary key references public.groups (id) on delete cascade,
  city_id int not null references public.geo_cities (id),
  creator_id uuid references public.profiles (id) on delete set null,
  meet_when text check (char_length(meet_when) <= 80),
  place text check (char_length(place) <= 80),
  status text not null default 'active' check (status in ('active', 'closed', 'hidden')),
  status_reason text check (char_length(status_reason) <= 300),
  created_at timestamptz not null default now()
);
create index city_meetups_city_idx on public.city_meetups (city_id, status);
-- one active meetup per city per creator
create unique index city_meetups_one_active_idx on public.city_meetups (city_id, creator_id) where status = 'active';
alter table public.city_meetups enable row level security;
revoke all on public.city_meetups from anon, authenticated, public;

create table public.meetup_bans (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  banned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.meetup_bans enable row level security;
revoke all on public.meetup_bans from anon, authenticated, public;

-- A closed meetup keeps its history for members but takes no new messages; a hidden one is gone for everyone but admins.
create or replace function public.can_read_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c left join public.groups g on g.id = c.group_id
     where c.id = p_chat and (
       (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b))
       or (c.kind = 'group' and public.is_verified() and (public.is_group_member(c.group_id) or g.kind = 'channel' or public.is_admin())
           and (public.is_admin() or not exists (select 1 from public.city_meetups mt where mt.group_id = c.group_id and mt.status = 'hidden')))
     ));
$$;

create or replace function public.can_post_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c left join public.groups g on g.id = c.group_id
     where c.id = p_chat and (
       (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b) and public.is_verified()
          and not public.is_blocked_between(c.dm_a, c.dm_b))
       or (c.kind = 'group' and public.is_verified() and (
             (g.kind = 'channel' and public.is_group_admin(c.group_id))
             or (g.kind <> 'channel' and public.is_group_member(c.group_id)))
           and not exists (select 1 from public.city_meetups mt where mt.group_id = c.group_id and mt.status <> 'active'))
     ));
$$;

-- Meetups are joined through join_meetup (bans, blocks, status), never through join_group.
create or replace function public.join_group(p_group uuid, p_join boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if not public.is_verified() then
    raise exception 'Groups are for verified members' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group;
  if not found or g.kind::text in ('batch', 'year', 'meetup') or not g.is_approved then
    raise exception 'You can’t join or leave this group';
  end if;
  if p_join then
    insert into public.group_members (group_id, user_id) values (p_group, auth.uid()) on conflict do nothing;
  else
    delete from public.group_members where group_id = p_group and user_id = auth.uid();
  end if;
end;
$$;

create or replace function public.start_meetup(p_city_id int, p_name text, p_when text default null, p_place text default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_when text := nullif(btrim(coalesce(p_when, '')), '');
  v_place text := nullif(btrim(coalesce(p_place, '')), '');
  g public.groups;
begin
  if not public.is_verified() then raise exception 'Only verified members can start a meetup' using errcode = '42501'; end if;
  if not exists (select 1 from public.geo_cities where id = p_city_id) then raise exception 'Choose a city from the list'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then raise exception 'Give the meetup a name of 3 to 80 characters'; end if;
  if char_length(coalesce(v_desc, '')) > 500 then raise exception 'The description can be up to 500 characters'; end if;
  if char_length(coalesce(v_when, '')) > 80 or char_length(coalesce(v_place, '')) > 80 then raise exception 'Date and place can be up to 80 characters each'; end if;
  if exists (select 1 from public.city_meetups where city_id = p_city_id and creator_id = me and status = 'active') then
    raise exception 'You already have an active meetup in this city. Close it first.';
  end if;
  if (select count(*) from public.city_meetups where creator_id = me and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You can start up to 3 meetups a day. Please try again tomorrow.';
  end if;
  insert into public.groups (kind, slug, name, description, icon, created_by, is_approved)
  values ('meetup', 'meetup-' || p_city_id || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), v_name, v_desc, '📍', me, true)
  returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, me, 'admin');
  insert into public.city_meetups (group_id, city_id, creator_id, meet_when, place) values (g.id, p_city_id, me, v_when, v_place);
  return g.id;
end;
$$;

create or replace function public.join_meetup(p_group uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.city_meetups;
begin
  if not public.is_verified() then raise exception 'Only verified members can join a meetup' using errcode = '42501'; end if;
  select * into m from public.city_meetups where group_id = p_group;
  if not found or m.status <> 'active' or public.is_blocked_between(auth.uid(), m.creator_id)
     or exists (select 1 from public.meetup_bans b where b.group_id = p_group and b.user_id = auth.uid()) then
    raise exception 'This meetup isn’t available';
  end if;
  insert into public.group_members (group_id, user_id) values (p_group, auth.uid()) on conflict do nothing;
  return (select c.id from public.chats c where c.group_id = p_group);
end;
$$;

create or replace function public.leave_meetup(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.city_meetups;
begin
  select * into m from public.city_meetups where group_id = p_group;
  if not found then raise exception 'Meetup not found'; end if;
  if m.creator_id = auth.uid() and m.status = 'active' then raise exception 'You started this meetup. Close it instead of leaving.'; end if;
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
end;
$$;

-- creator or an admin: remove a member (they can't rejoin)
create or replace function public.remove_meetup_member(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.city_meetups;
begin
  select * into m from public.city_meetups where group_id = p_group;
  if not found then raise exception 'Meetup not found'; end if;
  if not (m.creator_id = auth.uid() or public.is_admin()) then raise exception 'Only the person who started the meetup can do this' using errcode = '42501'; end if;
  if p_user = m.creator_id then raise exception 'The organiser can’t be removed'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  insert into public.meetup_bans (group_id, user_id, banned_by) values (p_group, p_user, auth.uid()) on conflict do nothing;
  if public.is_admin() and m.creator_id is distinct from auth.uid() then
    perform public._audit('meetup_member_removed', 'groups', p_group, jsonb_build_object('user', p_user));
  end if;
end;
$$;

create or replace function public.close_meetup(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.city_meetups;
begin
  select * into m from public.city_meetups where group_id = p_group;
  if not found then raise exception 'Meetup not found'; end if;
  if not (m.creator_id = auth.uid() or public.is_admin()) then raise exception 'Only the person who started the meetup can close it' using errcode = '42501'; end if;
  if m.status = 'active' then
    update public.city_meetups set status = 'closed' where group_id = p_group;
    if m.creator_id is distinct from auth.uid() then perform public._audit('meetup_closed', 'groups', p_group, '{}'::jsonb); end if;
  end if;
end;
$$;

-- admins: hide (gone for everyone), close, or restore, with a reason; always audited
create or replace function public.admin_set_meetup(p_group uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.city_meetups;
begin
  if not public.is_admin() then raise exception 'Only admins can do this' using errcode = '42501'; end if;
  if p_status not in ('active', 'closed', 'hidden') then raise exception 'Unknown status'; end if;
  select * into m from public.city_meetups where group_id = p_group for update;
  if not found then raise exception 'Meetup not found'; end if;
  if p_status = 'active' and exists (select 1 from public.city_meetups o where o.city_id = m.city_id and o.creator_id = m.creator_id
                                      and o.status = 'active' and o.group_id <> p_group) then
    raise exception 'The organiser already has another active meetup in this city';
  end if;
  update public.city_meetups set status = p_status, status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300) where group_id = p_group;
  update public.groups set is_approved = (p_status <> 'hidden') where id = p_group;
  perform public._audit(case p_status when 'hidden' then 'meetup_hidden' when 'closed' then 'meetup_closed' else 'meetup_restored' end,
                        'groups', p_group, jsonb_build_object('reason', left(coalesce(p_reason, ''), 300), 'city', m.city_id));
end;
$$;

create or replace function public.city_meetups(p_city_id int)
returns table (group_id uuid, chat_id uuid, name text, description text, meet_when text, place text, creator_id uuid, creator_name text,
               creator_avatar text, member_count int, joined boolean, is_creator boolean, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.group_id, c.id, g.name, g.description, m.meet_when, m.place, m.creator_id, p.full_name, p.avatar_url, g.member_count,
         exists (select 1 from public.group_members gm where gm.group_id = m.group_id and gm.user_id = auth.uid()),
         m.creator_id = auth.uid(), m.status, m.created_at
    from public.city_meetups m
    join public.groups g on g.id = m.group_id
    left join public.chats c on c.group_id = m.group_id
    left join public.profiles p on p.id = m.creator_id
   where public.is_verified() and m.city_id = p_city_id
     and (public.is_admin() or (m.status = 'active' and (m.creator_id is null or not public.is_blocked_between(m.creator_id, auth.uid()))))
   order by (m.status = 'active') desc, g.member_count desc, m.created_at desc
   limit 50;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public.add_trip(int, date, date, text) from anon, public;
revoke execute on function public.update_trip(uuid, int, date, date, text) from anon, public;
revoke execute on function public.cancel_trip(uuid) from anon, public;
revoke execute on function public.my_trips() from anon, public;
revoke execute on function public.city_trips(int) from anon, public;
revoke execute on function public.member_trips_of(uuid) from anon, public;
revoke execute on function public.city_info(int) from anon, public;
revoke execute on function public.set_location_alerts(boolean, text, boolean, text) from anon, public;
revoke execute on function public.start_meetup(int, text, text, text, text) from anon, public;
revoke execute on function public.join_meetup(uuid) from anon, public;
revoke execute on function public.leave_meetup(uuid) from anon, public;
revoke execute on function public.remove_meetup_member(uuid, uuid) from anon, public;
revoke execute on function public.close_meetup(uuid) from anon, public;
revoke execute on function public.admin_set_meetup(uuid, text, text) from anon, public;
revoke execute on function public.city_meetups(int) from anon, public;
revoke execute on function public.my_location() from anon, public;
revoke execute on function public.clear_my_location() from anon, public;
revoke execute on function public.set_my_location(double precision, double precision) from anon, public;
revoke execute on function public.join_group(uuid, boolean) from anon, public;
revoke execute on function public.can_read_chat(uuid) from anon, public;
revoke execute on function public.can_post_chat(uuid) from anon, public;
grant execute on function public.add_trip(int, date, date, text) to authenticated;
grant execute on function public.update_trip(uuid, int, date, date, text) to authenticated;
grant execute on function public.cancel_trip(uuid) to authenticated;
grant execute on function public.my_trips() to authenticated;
grant execute on function public.city_trips(int) to authenticated;
grant execute on function public.member_trips_of(uuid) to authenticated;
grant execute on function public.city_info(int) to authenticated;
grant execute on function public.set_location_alerts(boolean, text, boolean, text) to authenticated;
grant execute on function public.start_meetup(int, text, text, text, text) to authenticated;
grant execute on function public.join_meetup(uuid) to authenticated;
grant execute on function public.leave_meetup(uuid) to authenticated;
grant execute on function public.remove_meetup_member(uuid, uuid) to authenticated;
grant execute on function public.close_meetup(uuid) to authenticated;
grant execute on function public.admin_set_meetup(uuid, text, text) to authenticated;
grant execute on function public.city_meetups(int) to authenticated;
grant execute on function public.my_location() to authenticated;
grant execute on function public.clear_my_location() to authenticated;
grant execute on function public.set_my_location(double precision, double precision) to authenticated;
grant execute on function public.join_group(uuid, boolean) to authenticated;
grant execute on function public.can_read_chat(uuid) to authenticated;
grant execute on function public.can_post_chat(uuid) to authenticated;
