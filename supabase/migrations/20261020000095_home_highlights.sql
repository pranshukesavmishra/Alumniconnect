-- HOME HIGHLIGHTS: everything the Home "today" strip needs in ONE round trip.
-- (Birthdays are not part of it: the date of birth is optional and handled by upcoming_birthdays().)
--
--   home_highlights() -> jsonb
--     me                      grad_year, join_year, branch, city, verified
--     batch_anniversary       years since the batch graduated (and since joining), milestone = a multiple of 5
--     new_batchmates_week     verified members of my batch who were verified in the last 7 days (count + up to 5, blocks respected)
--     upcoming_events         my registrations (not cancelled) for events that have not ended, soonest first, with days_left
--     unread                  unread notifications, and chats with something new from someone else (muted chats not counted)
--     profile                 completeness percent + missing steps (same rule as the app)
--     pending_connection_requests
--     nearby_in_my_city       verified members whose profile city is mine, plus opted-in members sharing a live city that is mine
--     server_now              for countdowns (the app corrects its clock with it)
-- Lists of people are only filled for verified members.

create index if not exists member_cards_issued_idx on public.member_cards (issued_at desc);

create or replace function public.home_highlights()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my public.profiles;
  verified boolean;
  my_key text;
  my_cc text;
  my_city_id int;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  yr int := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  select * into my from public.profiles where id = me;
  if not found then raise exception 'Please sign in again' using errcode = '42501'; end if;
  verified := public.is_verified();
  my_key := public._world_city_key(my.city);
  my_cc := public._world_country_code(my.country);
  if my_key is not null then
    select c.id into my_city_id from public.geo_cities c
     where c.search_key = my_key and (my_cc is null or c.country_code = my_cc) order by c.population desc limit 1;
  end if;

  return jsonb_build_object(
    'me', jsonb_build_object('grad_year', my.grad_year, 'join_year', my.join_year, 'branch', my.branch, 'city', my.city,
                             'verified', my.verification = 'verified'),
    'batch_anniversary', case when my.grad_year is not null and my.grad_year <= yr then jsonb_build_object(
        'grad_year', my.grad_year,
        'years', yr - my.grad_year,
        'milestone', yr > my.grad_year and (yr - my.grad_year) % 5 = 0,
        'join_year', my.join_year,
        'years_since_join', case when my.join_year is not null and my.join_year <= yr then yr - my.join_year end) end,
    'new_batchmates_week', case when not verified or my.grad_year is null then jsonb_build_object('count', 0, 'people', '[]'::jsonb) else (
        with fresh as (
          select p.id, p.full_name, p.avatar_url, p.branch, c.issued_at
            from public.member_cards c join public.profiles p on p.id = c.user_id
           where c.issued_at > now() - interval '7 days' and p.grad_year = my.grad_year and p.id <> me
             and p.verification = 'verified' and p.onboarded and not public.is_blocked_between(me, p.id))
        select jsonb_build_object('count', (select count(*) from fresh),
          'people', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'full_name', f.full_name, 'avatar_url', f.avatar_url,
                       'branch', f.branch, 'joined_at', f.issued_at) order by f.issued_at desc), '[]'::jsonb)
                       from (select * from fresh order by issued_at desc, id limit 5) f))) end,
    'upcoming_events', (
        select coalesce(jsonb_agg(jsonb_build_object('event_id', e.id, 'slug', e.slug, 'title', e.title, 'starts_at', e.starts_at,
                 'ends_at', e.ends_at, 'venue', e.venue, 'cover_url', e.cover_url, 'registration_status', r.status,
                 'days_left', case when e.starts_at is not null then (e.starts_at at time zone 'Asia/Kolkata')::date - today end)
                 order by e.starts_at nulls last), '[]'::jsonb)
          from (select * from public.event_registrations r0 where r0.user_id = me and r0.status <> 'cancelled') r
          join public.events e on e.id = r.event_id
         where e.is_published and coalesce(e.ends_at, e.starts_at, 'infinity'::timestamptz) >= now()
         limit 5),
    'unread', jsonb_build_object(
        'notifications', (select count(*) from public.notifications n where n.user_id = me and n.read_at is null),
        'chats', case when not verified then 0 else (
          select count(*) from public.chats c
            left join public.chat_reads r on r.chat_id = c.id and r.user_id = me
            left join public.group_members gm on gm.group_id = c.group_id and gm.user_id = me
           where ((c.kind = 'dm' and me in (c.dm_a, c.dm_b)) or (c.kind = 'group' and gm.user_id is not null))
             and c.last_message_at is not null and c.last_sender is distinct from me
             and not coalesce(r.muted, false)
             and c.last_message_at > coalesce(r.last_read_at, gm.joined_at, '-infinity'::timestamptz)) end),
    'profile', public._profile_completeness(me),
    'pending_connection_requests', (
        select count(*) from public.connections c
         where c.addressee = me and c.status = 'pending' and not public.is_blocked_between(me, c.requester)),
    'nearby_in_my_city', case when not verified or my_key is null then 0 else (
        select count(*) from (
          select p.id from public.profiles p
           where p.id <> me and p.verification = 'verified' and p.onboarded
             and public._world_city_key(p.city) = my_key and public._world_country_code(p.country) is not distinct from my_cc
          union
          select l.user_id from public.member_locations l
            join public.location_prefs s on s.user_id = l.user_id and s.sharing
            join public.profiles p on p.id = l.user_id and p.verification = 'verified' and p.onboarded
           where my_city_id is not null and l.city_id = my_city_id and l.user_id <> me
        ) x where not public.is_blocked_between(me, x.id)) end,
    'server_now', now());
end;
$$;

revoke execute on function public.home_highlights() from public, anon;
grant execute on function public.home_highlights() to authenticated;
