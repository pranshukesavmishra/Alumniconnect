-- Opt-in city sharing and Nearby JECians: privacy, rounding, rate limits, filters. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- a, b: batch 2005 CSE (Pune) · c: 2010 ECE (Mumbai) · g: 2012 (Pimpri, near Pune) · e: lives in Pune per profile, never shares
-- f: blocked by a · d: shares then turns it off · u: unverified
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-00000000000a', 'loc-a@x.com', '{"full_name":"Asha Loc"}'),
  ('97000000-0000-0000-0000-00000000000b', 'loc-b@x.com', '{"full_name":"Bala Loc"}'),
  ('97000000-0000-0000-0000-00000000000c', 'loc-c@x.com', '{"full_name":"Chetan Loc"}'),
  ('97000000-0000-0000-0000-00000000000d', 'loc-d@x.com', '{"full_name":"Divya Loc"}'),
  ('97000000-0000-0000-0000-00000000000e', 'loc-e@x.com', '{"full_name":"Esha Loc"}'),
  ('97000000-0000-0000-0000-00000000000f', 'loc-f@x.com', '{"full_name":"Farhan Loc"}'),
  ('97000000-0000-0000-0000-000000000001', 'loc-g@x.com', '{"full_name":"Gita Loc"}'),
  ('97000000-0000-0000-0000-0000000000aa', 'loc-u@x.com', '{"full_name":"Unverified Loc"}');
update public.profiles set verification = 'verified', onboarded = true, grad_year = 2005, branch = 'Computer Science & Engineering', city = null
 where id::text like '97000000-%';
update public.profiles set verification = 'pending' where id = '97000000-0000-0000-0000-0000000000aa';
update public.profiles set grad_year = 2010, branch = 'Electronics & Communication', current_title = 'Staff Engineer', current_company = 'Rocket Labs'
 where id = '97000000-0000-0000-0000-00000000000c';
update public.profiles set grad_year = 2012, help_tags = array['Referrals'] where id = '97000000-0000-0000-0000-000000000001';
update public.profiles set grad_year = 2010, city = 'pune ', country = 'India' where id = '97000000-0000-0000-0000-00000000000e';
insert into public.blocks (blocker, blocked) values ('97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-00000000000f');
insert into public.mentor_profiles (user_id, topics, bio) values ('97000000-0000-0000-0000-00000000000b', array['Startups'], 'Happy to talk about building products.');

-- no client role can touch the tables directly
do $$
declare t text;
begin
  foreach t in array array['member_locations', 'location_prefs', 'location_consent_log', 'location_search_log', 'geo_cities', 'geo_countries'] loop
    assert not has_table_privilege('authenticated', 'public.' || t, 'select'), t || ' readable by authenticated';
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ' readable by anon';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete'), t || ' writable';
  end loop;
  assert not has_function_privilege('anon', 'public.set_my_location(double precision, double precision)', 'execute'), 'anon set';
  assert not has_function_privilege('anon', 'public.nearby_members(int, text, int, int, text, boolean, boolean, int, int)', 'execute'), 'anon nearby';
  assert not has_function_privilege('authenticated', 'public._loc_nearest_city(double precision, double precision)', 'execute'), 'internal helper';
  assert not has_function_privilege('authenticated', 'public._loc_rate(text, int, interval)', 'execute'), 'internal rate helper';
  -- the opt-in history never holds coordinates
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'location_consent_log'
                      and column_name in ('lat', 'lng')), 'consent log has coordinates';
  -- nothing returned to other members carries the member's coordinates
  assert not exists (select 1 from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT'
                      and specific_name ~ '^(nearby_members|batchmates_nearby)_' and parameter_name in ('lat', 'lng', 'latitude', 'longitude')),
         'coordinates in nearby output';
  -- the bundled table knows Indian places well, without transliteration marks
  assert (select count(*) from public.geo_cities where country_code = 'IN') > 2000, 'Indian coverage';
  assert exists (select 1 from public.geo_cities where name = 'Thane' and region = 'Maharashtra'), 'Thane folded';
  assert (select (public._loc_nearest_city(23.15, 79.95)).name) = 'Jabalpur', 'Jabalpur lookup';
end $$;

set local role anon;
do $$ begin
  begin perform 1 from public.member_locations; assert false, 'anon read';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- opting in is required, and rounding happens on the server
select pg_temp.login('97000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r jsonb;
begin
  begin perform 1 from public.member_locations; assert false, 'member read';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.location_prefs; assert false, 'prefs read';
  exception when insufficient_privilege then null; end;
  begin insert into public.member_locations (user_id, lat, lng) values (auth.uid(), 18.5, 73.85); assert false, 'direct insert';
  exception when insufficient_privilege then null; end;
  r := public.my_location();
  assert not (r ->> 'sharing')::boolean and not (r ->> 'prompt_dismissed')::boolean and r ->> 'city' is null, 'starts off';
  begin perform public.set_my_location(18.5234, 73.8567); assert false, 'opt-in required';
  exception when raise_exception then assert sqlerrm like 'Turn on%', sqlerrm; end;
  begin perform public.nearby_members(); assert false, 'nearby needs sharing';
  exception when raise_exception then assert sqlerrm like 'Turn on city sharing%', sqlerrm; end;
  r := public.set_location_sharing(true, true);
  assert (r ->> 'sharing')::boolean and (r ->> 'update_profile')::boolean and (r ->> 'prompt_dismissed')::boolean, 'on';
  begin perform public.set_my_location(91, 10); assert false, 'bad latitude';
  exception when raise_exception then null; end;
  begin perform public.set_my_location('NaN', 10); assert false, 'NaN';
  exception when raise_exception then null; end;
  r := public.set_my_location(18.5234, 73.8567);
  assert r ->> 'city' = 'Pune' and r ->> 'country' = 'India' and r ->> 'region' = 'Maharashtra', 'Pune: ' || r::text;
  assert (r ->> 'lat')::numeric = 18.50 and (r ->> 'lng')::numeric = 73.85, 'rounded to the 0.05 grid: ' || r::text;
  -- rate limit: one update every 10 minutes
  begin perform public.set_my_location(18.52, 73.86); assert false, 'rate limit';
  exception when raise_exception then assert sqlerrm like '%few minutes ago%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert (select lat from public.member_locations where user_id = '97000000-0000-0000-0000-00000000000a') = 18.50, 'stored rounded';
  assert (select city from public.profiles where id = '97000000-0000-0000-0000-00000000000a') = 'Pune', 'profile city updated when ticked';
end $$;
-- a direct write of an unrounded point is refused by the table itself
do $$ begin
  begin insert into public.member_locations (user_id, lat, lng) values ('97000000-0000-0000-0000-00000000000b', 18.51, 73.85); assert false, 'grid check';
  exception when check_violation then null; end;
end $$;
-- 10 minutes later it can update again
update public.location_prefs set last_set_at = now() - interval '11 minutes' where user_id = '97000000-0000-0000-0000-00000000000a';
select pg_temp.login('97000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert public.set_my_location(18.5234, 73.8567) ->> 'city' = 'Pune', 'second update';
end $$;
reset role;

-- everyone else shares (b without the profile option)
create function pg_temp.share(p_uid uuid, p_lat float8, p_lng float8) returns void language plpgsql as $$
begin
  perform pg_temp.login(p_uid);
  perform public.set_location_sharing(true, false);
  perform public.set_my_location(p_lat, p_lng);
end $$;
select pg_temp.share('97000000-0000-0000-0000-00000000000b', 18.56, 73.91);   -- Pune, other side of town
select pg_temp.share('97000000-0000-0000-0000-00000000000c', 19.07, 72.88);   -- Mumbai (~120 km)
select pg_temp.share('97000000-0000-0000-0000-000000000001', 18.66, 73.78);   -- Pimpri, ~18 km
select pg_temp.share('97000000-0000-0000-0000-00000000000f', 18.52, 73.85);   -- Pune, but blocked
select pg_temp.share('97000000-0000-0000-0000-0000000000aa', 18.52, 73.85);   -- Pune, unverified
select pg_temp.share('97000000-0000-0000-0000-00000000000d', 18.52, 73.85);   -- Pune, then turns it off
do $$ begin
  assert (select city from public.profiles where id = '97000000-0000-0000-0000-00000000000b') is null, 'profile untouched without the option';
end $$;

-- clearing deletes the row and turns sharing off; history kept without coordinates
select pg_temp.login('97000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.clear_my_location();
  assert not (r ->> 'sharing')::boolean and r ->> 'city' is null and r ->> 'lat' is null, 'cleared';
  assert jsonb_array_length(r -> 'history') = 2 and r -> 'history' -> 0 ->> 'action' = 'opt_out', 'history: ' || (r -> 'history')::text;
  begin perform public.set_my_location(18.52, 73.85); assert false, 'off again';
  exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.member_locations where user_id = '97000000-0000-0000-0000-00000000000d'), 'row deleted';
end $$;

-- unverified members cannot look
select pg_temp.login('97000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  begin perform public.nearby_members(); assert false, 'unverified nearby';
  exception when insufficient_privilege then null; end;
  begin perform public.search_cities('pun'); assert false, 'unverified city search';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Nearby from a's own location
select pg_temp.login('97000000-0000-0000-0000-00000000000a');
create temp table near_a as select * from public.nearby_members();  -- the function reads the caller from the JWT claims
grant select on near_a to authenticated;
set local role authenticated;
do $$
declare r record;
begin
  assert (select count(*) from near_a) = 3, 'b, g live and e from profile: ' || (select string_agg(full_name || ':' || bucket, ', ') from near_a);
  select * into r from near_a where user_id = '97000000-0000-0000-0000-00000000000b';
  assert r.bucket = 'same_city' and r.city = 'Pune' and r.approx_km is null and r.same_batch and r.is_mentor and r.source = 'live', 'b';
  select * into r from near_a where user_id = '97000000-0000-0000-0000-000000000001';
  assert r.bucket = 'km' and r.approx_km % 5 = 0 and r.approx_km between 10 and 25 and not r.same_batch and r.can_help, 'g: ' || r::text;
  select * into r from near_a where user_id = '97000000-0000-0000-0000-00000000000e';
  assert r.source = 'profile' and r.bucket = 'profile' and r.approx_km is null, 'e from profile';
  -- order: live before profile; same city first
  assert (select user_id from near_a limit 1) = '97000000-0000-0000-0000-00000000000b', 'same city first';
end $$;
reset role;
do $$ begin
  -- the map pins are city centres from the public table, never the member's point
  assert not exists (select 1 from near_a n join public.geo_cities c on c.id = n.cluster_id where n.cluster_lat <> c.lat or n.cluster_lng <> c.lng),
         'cluster coordinates are the public city centre';
end $$;
select pg_temp.login('97000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  -- filters
  assert (select count(*) from public.nearby_members(p_scope => 'batch')) = 1, 'my batch: b only';
  assert (select count(*) from public.nearby_members(p_scope => 'branch')) = 3, 'my branch: b, g and e';
  assert (select count(*) from public.nearby_members(p_year_from => 2008, p_year_to => 2011)) = 1, 'batch range: e';
  assert (select count(*) from public.nearby_members(p_mentors => true)) = 1, 'mentors: b';
  assert (select count(*) from public.nearby_members(p_helpers => true)) = 1, 'open to help: g';
  assert (select count(*) from public.nearby_members(p_query => 'bala')) = 1, 'text';
  begin perform public.nearby_members(p_scope => 'everyone'); assert false, 'scope checked';
  exception when raise_exception then null; end;
  -- a bigger radius reaches Mumbai with an approximate distance
  assert (select approx_km from public.nearby_members(p_radius_km => 200) where user_id = '97000000-0000-0000-0000-00000000000c') % 10 = 0, 'Mumbai ~120 km';
  assert not exists (select 1 from public.nearby_members(p_radius_km => 200)
                      where user_id in ('97000000-0000-0000-0000-00000000000f', '97000000-0000-0000-0000-0000000000aa', '97000000-0000-0000-0000-00000000000d')),
         'blocked, unverified and opted-out never appear';
  -- the future "batchmates near you" shape: buckets only
  assert (select count(*) from public.batchmates_nearby()) = 2, 'batchmates_nearby: opted-in only';
  assert (select bucket from public.batchmates_nearby() where user_id = '97000000-0000-0000-0000-00000000000b') = 'same_city', 'bucket b';
  assert (select bucket from public.batchmates_nearby() where user_id = '97000000-0000-0000-0000-000000000001') = 'within_25', 'bucket g';
  assert (select same_batch from public.batchmates_nearby() limit 1), 'batchmates first';
end $$;
reset role;

-- the blocked member does not see a either
select pg_temp.login('97000000-0000-0000-0000-00000000000f');
set local role authenticated;
do $$ begin
  assert not exists (select 1 from public.nearby_members() where user_id = '97000000-0000-0000-0000-00000000000a'), 'block works both ways';
  assert exists (select 1 from public.nearby_members() where user_id = '97000000-0000-0000-0000-00000000000b'), 'others still visible';
end $$;
reset role;

-- city search from Mumbai: "who is in Pune?" (needs no sharing of your own)
select pg_temp.login('97000000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$
declare pune int; mumbai int;
begin
  select id into pune from public.search_cities('pune') limit 1;
  assert (select name from public.search_cities('pune') limit 1) = 'Pune', 'suggestion';
  assert (select name from public.search_cities('thane') limit 1) = 'Thane', 'folded suggestion';
  assert (select country from public.search_cities('mumb') limit 1) = 'India', 'country name';
  assert (select count(*) from public.search_cities('p')) = 0, 'two letters needed';
  select id into mumbai from public.search_cities('mumbai') limit 1;
  assert (select count(*) from public.nearby_members(p_city_id => pune)) = 4, 'a, b, f, g in/near Pune (f blocked only a)';
  assert (select bucket from public.nearby_members(p_city_id => pune) where user_id = '97000000-0000-0000-0000-00000000000a') = 'same_city', 'a in Pune';
  assert (select approx_km from public.nearby_members(p_city_id => pune) where user_id = '97000000-0000-0000-0000-000000000001') between 10 and 25, 'g ~15 km';
  assert (select cluster_name from public.nearby_members(p_city_id => mumbai) where user_id = '97000000-0000-0000-0000-00000000000c') = 'Mumbai', 'c in Mumbai';
  begin perform public.nearby_members(p_city_id => -1); assert false, 'unknown city';
  exception when raise_exception then null; end;
end $$;
reset role;
-- b looks at Pune: e appears from the profile; e's own row never duplicates
select pg_temp.login('97000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare pune int := (select id from public.search_cities('pune') limit 1);
begin
  assert (select count(*) from public.nearby_members(p_city_id => pune) where user_id = '97000000-0000-0000-0000-00000000000e' and source = 'profile') = 1, 'profile fallback';
  assert (select count(*) from public.nearby_members(p_city_id => pune)) = (select count(distinct user_id) from public.nearby_members(p_city_id => pune)), 'no duplicates';
end $$;
reset role;
-- city searches are rate-limited
insert into public.location_search_log (user_id, kind) select '97000000-0000-0000-0000-00000000000c', 'city_search' from generate_series(1, 30);
select pg_temp.login('97000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  begin perform public.nearby_members(p_city_id => (select id from public.search_cities('pune') limit 1)); assert false, 'search rate limit';
  exception when raise_exception then assert sqlerrm like 'Too many searches%', sqlerrm; end;
  assert (select count(*) from public.nearby_members()) >= 0, 'own-location view is not limited';
end $$;
reset role;

-- the Home card can be dismissed for good
select pg_temp.login('97000000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$ begin
  perform public.dismiss_location_prompt();
  assert (public.my_location() ->> 'prompt_dismissed')::boolean and not (public.my_location() ->> 'sharing')::boolean, 'dismissed';
end $$;
reset role;

-- re-enabling right after turning off works once (first fix), but the daily cap holds
update public.location_prefs set sets_count = 20, sets_day = current_date where user_id = '97000000-0000-0000-0000-00000000000d';
select pg_temp.login('97000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  perform public.set_location_sharing(true);
  begin perform public.set_my_location(18.52, 73.85); assert false, 'daily cap';
  exception when raise_exception then assert sqlerrm like '%many times today%', sqlerrm; end;
end $$;
reset role;

-- deleting an account deletes the location
delete from auth.users where id = '97000000-0000-0000-0000-00000000000b';
do $$ begin
  assert not exists (select 1 from public.member_locations where user_id = '97000000-0000-0000-0000-00000000000b'), 'location deleted with account';
  assert not exists (select 1 from public.location_prefs where user_id = '97000000-0000-0000-0000-00000000000b'), 'prefs deleted with account';
  assert not exists (select 1 from public.location_consent_log where user_id = '97000000-0000-0000-0000-00000000000b'), 'history deleted with account';
end $$;

select 'ALL LOCATION TESTS PASSED';
rollback;
