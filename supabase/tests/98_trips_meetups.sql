-- Trips, city meetups and opt-in alerts: visibility, limits, dedupe, blocks, opt-out, push wake. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- a: 2005, travels Mumbai -> Pune · b: 2005, in Pune (shares) · c: 2010, Pune on profile only · d: 2005, blocked by a
-- f: 2012, Pune (shares), batch scope · g: 2005, Mumbai · e: unverified · z: admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('98000000-0000-0000-0000-00000000000a', 'tm-a@x.com', '{"full_name":"Asha Trip"}'),
  ('98000000-0000-0000-0000-00000000000b', 'tm-b@x.com', '{"full_name":"Bala Trip"}'),
  ('98000000-0000-0000-0000-00000000000c', 'tm-c@x.com', '{"full_name":"Chetan Trip"}'),
  ('98000000-0000-0000-0000-00000000000d', 'tm-d@x.com', '{"full_name":"Divya Trip"}'),
  ('98000000-0000-0000-0000-00000000000f', 'tm-f@x.com', '{"full_name":"Farhan Trip"}'),
  ('98000000-0000-0000-0000-000000000001', 'tm-g@x.com', '{"full_name":"Gita Trip"}'),
  ('98000000-0000-0000-0000-0000000000ee', 'tm-e@x.com', '{"full_name":"Unverified Trip"}'),
  ('98000000-0000-0000-0000-0000000000aa', 'tm-z@x.com', '{"full_name":"Admin Trip"}');
update public.profiles set verification = 'verified', onboarded = true, grad_year = 2005, branch = 'Computer Science & Engineering'
 where id::text like '98000000-%';
update public.profiles set verification = 'pending' where id = '98000000-0000-0000-0000-0000000000ee';
update public.profiles set is_admin = true where id = '98000000-0000-0000-0000-0000000000aa';
update public.profiles set grad_year = 2010, city = 'Pune', country = 'India' where id = '98000000-0000-0000-0000-00000000000c';
update public.profiles set grad_year = 2012 where id = '98000000-0000-0000-0000-00000000000f';
insert into public.blocks (blocker, blocked) values ('98000000-0000-0000-0000-00000000000a', '98000000-0000-0000-0000-00000000000d');
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create temp table k (name text primary key, id int);
insert into k select 'pune', id from public.geo_cities where name = 'Pune' and country_code = 'IN';
insert into k select 'mumbai', id from public.geo_cities where name = 'Mumbai' and country_code = 'IN';
insert into k select 'chennai', id from public.geo_cities where name = 'Chennai' and country_code = 'IN';
insert into k select 'delhi', id from public.geo_cities where name = 'Delhi' and country_code = 'IN';
create temp table kv (name text primary key, v uuid);
grant select on k, kv to authenticated;
grant insert on kv to authenticated;

do $$
declare t text;
begin
  foreach t in array array['member_trips', 'city_meetups', 'meetup_bans', 'location_alert_log'] loop
    assert not has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete'), t || ' reachable by clients';
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ' reachable by anon';
  end loop;
  assert not has_function_privilege('authenticated', 'public._alert_trip(uuid)', 'execute'), 'alert sender is internal';
  assert not has_function_privilege('authenticated', 'public._alert_city_arrival(uuid, int)', 'execute'), 'alert sender is internal';
  assert not has_function_privilege('anon', 'public.add_trip(int, date, date, text)', 'execute'), 'anon trips';
  assert not has_function_privilege('anon', 'public.start_meetup(int, text, text, text, text)', 'execute'), 'anon meetups';
end $$;

-- ================================================================== TRIPS
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare
  pune int := (select id from k where name = 'pune');
  mumbai int := (select id from k where name = 'mumbai');
  today date := pg_temp.today();
  tid uuid;
begin
  begin perform 1 from public.member_trips; assert false, 'direct read';
  exception when insufficient_privilege then null; end;
  -- validation
  begin perform public.add_trip(pune, today + 5, today + 3, 'everyone'); assert false, 'end before start';
  exception when raise_exception then assert sqlerrm like '%end date%', sqlerrm; end;
  begin perform public.add_trip(pune, today - 2, today + 3, 'everyone'); assert false, 'past start';
  exception when raise_exception then assert sqlerrm like '%past%', sqlerrm; end;
  begin perform public.add_trip(pune, today - 5, today - 3, 'everyone'); assert false, 'past trip';
  exception when raise_exception then assert sqlerrm like '%past%', sqlerrm; end;
  begin perform public.add_trip(pune, today + 1, today + 92, 'everyone'); assert false, 'over 90 days';
  exception when raise_exception then assert sqlerrm like '%90 days%', sqlerrm; end;
  begin perform public.add_trip(-5, today + 1, today + 2, 'everyone'); assert false, 'unknown city';
  exception when raise_exception then assert sqlerrm like '%city%', sqlerrm; end;
  begin perform public.add_trip(pune, today + 1, today + 2, 'friends'); assert false, 'visibility values';
  exception when raise_exception then null; end;
  begin perform public.add_trip(pune, null, today + 2, 'everyone'); assert false, 'dates required';
  exception when raise_exception then null; end;
  -- 90 days is the limit and starting today is fine
  tid := public.add_trip(pune, today, today + 90, 'everyone');
  perform public.cancel_trip(tid);
  -- two real trips: one for everyone (Pune), one for my batch only (Mumbai)
  insert into kv values ('pune_trip', public.add_trip(pune, today + 10, today + 14, 'everyone'));
  insert into kv values ('mumbai_trip', public.add_trip(mumbai, today + 20, today + 22, 'batch'));
  -- the limit of 5 upcoming trips
  perform public.add_trip(pune, today + 30, today + 31, 'batch');
  perform public.add_trip(pune, today + 40, today + 41, 'batch');
  perform public.add_trip(pune, today + 50, today + 51, 'batch');
  begin perform public.add_trip(pune, today + 60, today + 61, 'batch'); assert false, 'max 5';
  exception when raise_exception then assert sqlerrm like '%5 upcoming%', sqlerrm; end;
  assert (select count(*) from public.my_trips()) = 5, 'my trips';
  -- edit and cancel: own only, validated like add
  perform public.update_trip((select v from kv where name = 'pune_trip'), pune, today + 11, today + 15, 'everyone');
  assert (select ends_on from public.my_trips() where id = (select v from kv where name = 'pune_trip')) = today + 15, 'edited';
  begin perform public.update_trip((select v from kv where name = 'pune_trip'), pune, today + 11, today + 5, 'everyone'); assert false, 'edit validated';
  exception when raise_exception then null; end;
end $$;
reset role;

-- a trip that has already ended is hidden by date alone; one that started but is still running stays
insert into public.member_trips (user_id, city_id, starts_on, ends_on, visibility)
values ('98000000-0000-0000-0000-00000000000a', (select id from k where name = 'pune'), pg_temp.today() - 9, pg_temp.today() - 1, 'everyone'),
       ('98000000-0000-0000-0000-00000000000f', (select id from k where name = 'delhi'), pg_temp.today() - 2, pg_temp.today() + 1, 'batch');
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare pune int := (select id from k where name = 'pune'); today date := pg_temp.today();
begin
  assert not exists (select 1 from public.my_trips() where ends_on < today), 'expired trips hidden from the owner';
  assert (select count(*) from public.my_trips()) = 5, 'still five upcoming';
  assert not exists (select 1 from public.city_trips(pune) where ends_on < today), 'expired trips hidden in the city';
  assert not exists (select 1 from public.member_trips_of('98000000-0000-0000-0000-00000000000a') where ends_on < today), 'expired trips hidden on the profile';
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000f');
set local role authenticated;
do $$
declare delhi int := (select id from k where name = 'delhi'); today date := pg_temp.today(); tid uuid := (select id from public.my_trips() limit 1);
begin
  assert exists (select 1 from public.my_trips() where starts_on < today and ends_on >= today), 'an ongoing trip is kept';
  -- editing a trip that has started keeps its start date; moving the start into the past is refused
  perform public.update_trip(tid, delhi, (select starts_on from public.my_trips() where id = tid), today + 3, 'batch');
  assert (select ends_on from public.my_trips() where id = tid) = today + 3, 'extended';
  begin perform public.update_trip(tid, delhi, today - 5, today + 4, 'batch'); assert false, 'no new past start on edit';
  exception when raise_exception then assert sqlerrm like '%past%', sqlerrm; end;
end $$;
reset role;
delete from public.member_trips where user_id = '98000000-0000-0000-0000-00000000000f';

-- visibility
select pg_temp.login('98000000-0000-0000-0000-00000000000b');   -- same batch as a
set local role authenticated;
do $$
declare pune int := (select id from k where name = 'pune'); mumbai int := (select id from k where name = 'mumbai');
begin
  assert (select count(*) from public.city_trips(pune) where user_id = '98000000-0000-0000-0000-00000000000a') = 4, 'batchmate sees everyone and batch-only trips';
  assert (select count(*) from public.city_trips(mumbai)) = 1, 'batch-only Mumbai trip visible to the same batch';
  assert (select count(*) from public.member_trips_of('98000000-0000-0000-0000-00000000000a')) = 5, 'profile chip: all five';
  assert (select full_name from public.city_trips(pune) limit 1) = 'Asha Trip', 'trip names the member';
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000c');   -- another batch
set local role authenticated;
do $$
declare pune int := (select id from k where name = 'pune'); mumbai int := (select id from k where name = 'mumbai');
begin
  assert (select count(*) from public.city_trips(pune)) = 1, 'other batch sees only the everyone trip';
  assert (select count(*) from public.city_trips(mumbai)) = 0, 'batch-only trip hidden from another batch';
  assert (select count(*) from public.member_trips_of('98000000-0000-0000-0000-00000000000a')) = 1, 'profile chip respects visibility';
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000d');   -- blocked by a
set local role authenticated;
do $$ begin
  assert (select count(*) from public.city_trips((select id from k where name = 'pune'))) = 0, 'blocked member sees no trips';
  assert (select count(*) from public.member_trips_of('98000000-0000-0000-0000-00000000000a')) = 0, 'blocked member sees no chip';
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-0000000000ee');   -- unverified
set local role authenticated;
do $$ begin
  assert (select count(*) from public.city_trips((select id from k where name = 'pune'))) = 0, 'unverified sees nothing';
  begin perform public.add_trip((select id from k where name = 'pune'), pg_temp.today() + 1, pg_temp.today() + 2, 'everyone'); assert false, 'unverified add';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- only the owner can edit or cancel
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin perform public.cancel_trip((select v from kv where name = 'pune_trip')); assert false, 'not mine';
  exception when raise_exception then assert sqlerrm like '%not found%', sqlerrm; end;
  begin perform public.update_trip((select v from kv where name = 'pune_trip'), (select id from k where name = 'pune'), pg_temp.today() + 1, pg_temp.today() + 2, 'everyone'); assert false, 'not mine';
  exception when raise_exception then null; end;
end $$;
reset role;

-- ================================================================== ALERTS
-- push is configured and b has a device, c does not
insert into private.settings values ('push_function_url', 'http://push.invalid/functions/v1/push-send'), ('push_secret', 's3cret')
  on conflict (key) do update set value = excluded.value;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('98000000-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/tm-b', repeat('B', 87), repeat('a', 22));
-- nothing is on by default
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare r jsonb := public.my_location();
begin
  assert not (r -> 'alerts' ->> 'batchmate')::boolean and not (r -> 'alerts' ->> 'trip')::boolean, 'alerts default off';
  assert r -> 'alerts' ->> 'batchmate_scope' = 'batch', 'default scope';
  begin perform public.set_location_alerts(true, 'planets', false, 'batch'); assert false, 'scope checked';
  exception when raise_exception then null; end;
end $$;
reset role;

-- who listens: b (batch, shares from Pune), c (everyone, Pune on profile only), d (blocked by a), f (batch, other year), g (Mumbai), e (unverified)
create function pg_temp.listen(p_uid uuid, p_batchmate boolean, p_bscope text, p_trip boolean, p_tscope text) returns void language plpgsql as $$
begin
  perform pg_temp.login(p_uid);
  perform public.set_location_alerts(p_batchmate, p_bscope, p_trip, p_tscope);
end $$;
create function pg_temp.share(p_uid uuid, p_lat float8, p_lng float8) returns void language plpgsql as $$
begin
  perform pg_temp.login(p_uid);
  perform public.set_location_sharing(true, false);
  perform public.set_my_location(p_lat, p_lng);
end $$;
set local role authenticated;
do $$ begin perform pg_temp.share('98000000-0000-0000-0000-00000000000b', 18.52, 73.85); end $$;
do $$ begin perform pg_temp.share('98000000-0000-0000-0000-00000000000f', 18.52, 73.85); end $$;
do $$ begin perform pg_temp.share('98000000-0000-0000-0000-000000000001', 19.07, 72.88); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-00000000000b', true, 'batch', true, 'batch'); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-00000000000c', true, 'everyone', true, 'everyone'); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-00000000000d', true, 'everyone', true, 'everyone'); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-00000000000f', true, 'batch', true, 'batch'); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-000000000001', true, 'everyone', true, 'everyone'); end $$;
do $$ begin perform pg_temp.listen('98000000-0000-0000-0000-0000000000ee', true, 'everyone', true, 'everyone'); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind like 'nearby_%') = 0, 'setting things up alerts nobody';
end $$;

-- a opts in to be visible, in Mumbai first (the first fix is not a move)
do $$ begin perform pg_temp.share('98000000-0000-0000-0000-00000000000a', 19.07, 72.88); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate') = 0, 'first fix sends nothing';
end $$;
-- ... then travels to Pune
create temp table q0 as select count(*)::bigint as n from net.http_request_queue;
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(18.52, 73.85); end $$;
reset role;
do $$
declare q0 bigint := (select n from q0);
begin
  -- b (same batch, in Pune) and c (everyone, Pune on the profile) hear about it; nobody else
  assert (select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'nearby_batchmate')
       = '98000000-0000-0000-0000-00000000000b,98000000-0000-0000-0000-00000000000c', 'recipients: ' ||
         coalesce((select string_agg(user_id::text, ',') from public.notifications where kind = 'nearby_batchmate'), 'none');
  assert (select actor_id from public.notifications where kind = 'nearby_batchmate' limit 1) = '98000000-0000-0000-0000-00000000000a', 'actor';
  assert (select body from public.notifications where kind = 'nearby_batchmate' limit 1) = 'Pune', 'names the city only';
  assert not exists (select 1 from public.notifications where kind = 'nearby_batchmate' and body ~ '[0-9]'), 'no coordinates in alerts';
  -- push wake: b has a device and gets a queued request, c has none
  assert (select count(*) from net.http_request_queue) = q0 + 1, 'exactly one push wake: b has a device, c has none';
  assert (select headers ->> 'x-push-secret' from net.http_request_queue order by id desc limit 1) = 's3cret', 'wake carries the secret';
end $$;

-- dedupe: moving away and back within 7 days sends nothing new
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(19.07, 72.88); end $$;
reset role;
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(18.52, 73.85); end $$;
reset role;
do $$ begin
  -- Mumbai (g listens there) added one; Pune again repeats b and c within 7 days: nothing new for them
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate') = 3, 'one alert per person per 7 days';
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000b') = 1, 'b once';
end $$;
-- after 8 days it can alert again
update public.location_alert_log set created_at = now() - interval '8 days';
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(19.07, 72.88); end $$;
reset role;
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(18.52, 73.85); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate') = 6, 'fresh alerts after the window';
  -- someone who does not share is never announced
end $$;
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.clear_my_location(); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate') = 0, 'turning sharing off withdraws unread alerts about me';
  assert not exists (select 1 from public.member_locations where user_id = '98000000-0000-0000-0000-00000000000a'), 'location gone';
end $$;
-- a alone (not sharing) moves nowhere, alerts nobody
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.set_my_location(18.52, 73.85); assert false, 'not sharing';
  exception when raise_exception then null; end;
end $$;
reset role;

-- a read alert stays; turning my alert off removes my unread ones and stops new ones
update public.location_alert_log set created_at = now() - interval '9 days';
do $$ begin perform pg_temp.share('98000000-0000-0000-0000-00000000000a', 19.07, 72.88); end $$;
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(18.52, 73.85); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000c') = 1, 'c alerted';
end $$;
update public.notifications set read_at = now() where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000c';
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin perform public.set_location_alerts(false, 'batch', true, 'batch'); end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.notifications where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000b'), 'unread alert removed when b turns alerts off';
  assert exists (select 1 from public.notifications where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000c'), 'a read one is kept';
end $$;
update public.location_alert_log set created_at = now() - interval '9 days';
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(19.07, 72.88); end $$;
reset role;
update public.location_prefs set last_set_at = now() - interval '1 hour' where user_id = '98000000-0000-0000-0000-00000000000a';
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.set_my_location(18.52, 73.85); end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.notifications where kind = 'nearby_batchmate' and user_id = '98000000-0000-0000-0000-00000000000b'), 'no new alert after opting out';
end $$;

-- ---- trip alerts (everyone / batch-only trips; scopes; blocks; cancel removes unread)
delete from public.notifications where kind like 'nearby_%';
delete from public.location_alert_log;
update public.member_trips set cancelled_at = now() where user_id = '98000000-0000-0000-0000-00000000000a';   -- start the trip-alert part with a clean slate
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin perform public.set_location_alerts(false, 'batch', true, 'batch'); end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare today date := pg_temp.today(); pune int := (select id from k where name = 'pune'); t uuid;
begin
  -- a batch-only trip to Pune: b (same batch, in Pune) hears; c (other batch, "everyone" scope) must not learn of it
  t := public.add_trip(pune, today + 90 - 30, today + 90 - 28, 'batch');
  insert into kv values ('alert_trip', t);
end $$;
reset role;
do $$ begin
  assert (select string_agg(user_id::text, ',') from public.notifications where kind = 'nearby_trip') = '98000000-0000-0000-0000-00000000000b',
         'batch-only trip alerts the same batch only, never other batches: ' || coalesce((select string_agg(user_id::text, ',') from public.notifications where kind = 'nearby_trip'), 'none');
  assert (select target_id from public.notifications where kind = 'nearby_trip' limit 1) = (select v from kv where name = 'alert_trip'), 'linked to the trip';
  assert (select body from public.notifications where kind = 'nearby_trip' limit 1) = 'Pune', 'city only';
end $$;
-- cancelling withdraws the unread alert
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.cancel_trip((select v from kv where name = 'alert_trip')); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_trip') = 0, 'cancel removes the unread alert';
end $$;
-- an everyone trip: b (batch scope, same batch) and c (everyone) hear; d (blocked), f (other batch, batch scope), g (Mumbai), e (unverified) do not
delete from public.location_alert_log;
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.add_trip((select id from k where name = 'pune'), pg_temp.today() + 40, pg_temp.today() + 41, 'everyone'); end $$;
reset role;
do $$ begin
  assert (select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'nearby_trip')
       = '98000000-0000-0000-0000-00000000000b,98000000-0000-0000-0000-00000000000c', 'trip recipients: ' ||
         coalesce((select string_agg(user_id::text, ',') from public.notifications where kind = 'nearby_trip'), 'none');
end $$;
-- a second trip within 7 days alerts nobody again
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.cancel_trip(id) from public.my_trips() where starts_on = pg_temp.today() + 40; end $$;
do $$ begin perform public.add_trip((select id from k where name = 'pune'), pg_temp.today() + 42, pg_temp.today() + 43, 'everyone'); end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'nearby_trip') = 0 or
         (select count(*) from public.notifications where kind = 'nearby_trip' and created_at > now() - interval '1 minute') <= 2, 'trip alert rate limit';
  assert (select count(*) from public.location_alert_log where kind = 'trip') = 2, 'still one per person: ' || (select count(*) from public.location_alert_log where kind = 'trip');
end $$;

-- ================================================================== MEETUPS
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare pune int := (select id from k where name = 'pune'); g uuid;
begin
  begin perform public.start_meetup(pune, 'Hi'); assert false, 'name too short';
  exception when raise_exception then assert sqlerrm like '%3 to 80%', sqlerrm; end;
  begin perform public.start_meetup(pune, repeat('x', 81)); assert false, 'name too long';
  exception when raise_exception then null; end;
  begin perform public.start_meetup(pune, 'Chai at FC Road', null, null, repeat('d', 501)); assert false, 'description too long';
  exception when raise_exception then assert sqlerrm like '%500%', sqlerrm; end;
  begin perform public.start_meetup(pune, 'Chai at FC Road', repeat('w', 81)); assert false, 'when too long';
  exception when raise_exception then null; end;
  begin perform public.start_meetup(-1, 'Chai at FC Road'); assert false, 'city';
  exception when raise_exception then null; end;
  g := public.start_meetup(pune, 'Chai at FC Road', 'Sat 5 pm', 'Vaishali, FC Road', 'Informal catch-up for JECians in Pune.');
  insert into kv values ('meetup', g);
  begin perform public.start_meetup(pune, 'A second one'); assert false, 'one active meetup per city per creator';
  exception when raise_exception then assert sqlerrm like '%already have an active meetup%', sqlerrm; end;
  -- a different city is fine
  perform public.start_meetup((select id from k where name = 'mumbai'), 'Mumbai lunch');
  assert (select member_count from public.groups where id = g) = 1, 'creator is the only member';
  assert (select is_creator and joined and member_count = 1 and meet_when = 'Sat 5 pm' and place = 'Vaishali, FC Road' from public.city_meetups(pune) where group_id = g), 'listed on the city page';
end $$;
reset role;
insert into kv select 'chat', id from public.chats where group_id = (select v from kv where name = 'meetup');
do $$ begin
  assert (select kind::text from public.groups where id = (select v from kv where name = 'meetup')) = 'meetup', 'a group of kind meetup';
  assert exists (select 1 from public.chats where group_id = (select v from kv where name = 'meetup')), 'it has a chat';
  assert (select role::text from public.group_members where group_id = (select v from kv where name = 'meetup')) = 'admin', 'creator moderates';
end $$;

-- daily limit of 3 meetups
select pg_temp.login('98000000-0000-0000-0000-00000000000f');
set local role authenticated;
do $$ begin
  perform public.start_meetup((select id from k where name = 'pune'), 'F one');
  perform public.start_meetup((select id from k where name = 'mumbai'), 'F two');
  perform public.start_meetup((select id from k where name = 'delhi'), 'F three');
  begin perform public.start_meetup((select id from k where name = 'chennai'), 'F four'); assert false, 'daily limit';
  exception when raise_exception then assert sqlerrm like '%3 meetups a day%', sqlerrm; end;
end $$;
reset role;

-- a sends a message before anyone joins; b joins late and still reads it
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.send_message((select v from kv where name = 'chat'), 'See you all Saturday'); end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare g uuid := (select v from kv where name = 'meetup'); chat uuid := (select v from kv where name = 'chat');
begin
  -- never added automatically; not a member, so not readable
  assert not public.can_read_chat(chat), 'non-members cannot read';
  begin perform public.send_message(chat, 'hello'); assert false, 'non-member post';
  exception when insufficient_privilege then null; end;
  begin perform public.join_group(g, true); assert false, 'join_group is not for meetups';
  exception when raise_exception then null; end;
  assert public.join_meetup(g) = chat, 'join returns the chat';
  assert (select count(*) from public.messages where chat_id = chat) = 1, 'late joiner reads the history';
  assert (select member_count from public.city_meetups((select id from k where name = 'pune')) where group_id = g) = 2, 'count';
  perform public.send_message(chat, 'Count me in');
  perform public.leave_meetup(g);
  assert not exists (select 1 from public.group_members where group_id = g and user_id = auth.uid()), 'left';
  perform public.join_meetup(g);
end $$;
reset role;
do $$ begin
  assert (select member_count from public.groups where id = (select v from kv where name = 'meetup')) = 2, 'joined again';
end $$;

-- creator cannot "leave" (close instead); the blocked member cannot join; unverified cannot join
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.leave_meetup((select v from kv where name = 'meetup')); assert false, 'creator leaving';
  exception when raise_exception then assert sqlerrm like '%Close it%', sqlerrm; end;
  -- creator moderates: slow mode works through the existing group tools; a non-creator cannot remove people
  perform public.set_slow_mode((select v from kv where name = 'meetup'), 30);
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  begin perform public.join_meetup((select v from kv where name = 'meetup')); assert false, 'blocked by the organiser';
  exception when raise_exception then assert sqlerrm like '%isn’t available%', sqlerrm; end;
  assert (select count(*) from public.city_meetups((select id from k where name = 'pune')) where group_id = (select v from kv where name = 'meetup')) = 0, 'blocked member does not see it';
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$ begin
  begin perform public.join_meetup((select v from kv where name = 'meetup')); assert false, 'unverified';
  exception when insufficient_privilege then null; end;
  begin perform public.start_meetup((select id from k where name = 'pune'), 'Nope nope'); assert false, 'unverified start';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- moderation: the creator removes a member (cannot return); others cannot
select pg_temp.login('98000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ declare g uuid := (select v from kv where name = 'meetup'); begin
  perform public.join_meetup(g);
  begin perform public.remove_meetup_member(g, '98000000-0000-0000-0000-00000000000b'); assert false, 'member moderating';
  exception when insufficient_privilege then null; end;
  begin perform public.close_meetup(g); assert false, 'member closing';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ declare g uuid := (select v from kv where name = 'meetup'); begin
  perform public.remove_meetup_member(g, '98000000-0000-0000-0000-00000000000c');
  begin perform public.remove_meetup_member(g, '98000000-0000-0000-0000-00000000000a'); assert false, 'organiser removal';
  exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  begin perform public.join_meetup((select v from kv where name = 'meetup')); assert false, 'removed member rejoining';
  exception when raise_exception then assert sqlerrm like '%isn’t available%', sqlerrm; end;
end $$;
reset role;

-- admin hides: gone from the list and the chat for members, readable by admins, audited; non-admins cannot
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin perform public.admin_set_meetup((select v from kv where name = 'meetup'), 'hidden'); assert false, 'member hiding';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ declare g uuid := (select v from kv where name = 'meetup'); chat uuid := (select v from kv where name = 'chat'); begin
  perform public.admin_set_meetup(g, 'hidden', 'Spam');
  assert public.can_read_chat(chat), 'admins can still read';
  assert (select status from public.city_meetups((select id from k where name = 'pune')) where group_id = g) = 'hidden', 'admins still see it, marked hidden';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.admin_audit where action = 'meetup_hidden' and target_id = (select v from kv where name = 'meetup')) = 1, 'hide audited';
  assert (select is_approved from public.groups where id = (select v from kv where name = 'meetup')) = false, 'group hidden';
end $$;
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ declare g uuid := (select v from kv where name = 'meetup'); chat uuid := (select v from kv where name = 'chat'); begin
  assert not public.can_read_chat(chat), 'hidden: members cannot read';
  assert not public.can_post_chat(chat), 'hidden: members cannot post';
  assert (select count(*) from public.city_meetups((select id from k where name = 'pune')) where group_id = g) = 0, 'hidden: not listed';
end $$;
reset role;
-- restore, then the creator closes: history readable, no new messages, joining refused
select pg_temp.login('98000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin perform public.admin_set_meetup((select v from kv where name = 'meetup'), 'active'); end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.close_meetup((select v from kv where name = 'meetup')); end $$;
reset role;
select pg_temp.login('98000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ declare g uuid := (select v from kv where name = 'meetup'); chat uuid := (select v from kv where name = 'chat'); begin
  assert public.can_read_chat(chat) and not public.can_post_chat(chat), 'closed: read-only history';
  assert (select count(*) from public.city_meetups((select id from k where name = 'pune'))) = 1, 'closed meetups are not listed for members: ' || (select count(*) from public.city_meetups((select id from k where name = 'pune')));
end $$;
reset role;
-- after closing, the creator may start a new one in the same city
select pg_temp.login('98000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  perform public.start_meetup((select id from k where name = 'pune'), 'Second round');
end $$;
reset role;

select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
-- deleting an account removes trips, alert records and notifications about them
delete from auth.users where id = '98000000-0000-0000-0000-00000000000a';
do $$ begin
  assert not exists (select 1 from public.member_trips where user_id = '98000000-0000-0000-0000-00000000000a'), 'trips deleted';
  assert not exists (select 1 from public.location_alert_log where subject = '98000000-0000-0000-0000-00000000000a'), 'alert log deleted';
  assert not exists (select 1 from public.notifications where kind like 'nearby_%' and actor_id = '98000000-0000-0000-0000-00000000000a'), 'alerts deleted';
  assert not exists (select 1 from public.member_locations where user_id = '98000000-0000-0000-0000-00000000000a'), 'location deleted';
end $$;

select 'ALL TRIPS AND MEETUPS TESTS PASSED';
rollback;
