-- Signature features: landing stats, JEC World, ID cards, achievements, yearbooks, wall of fame, Home highlights.
-- Privacy matrix (anon / member / blocked / hidden / unverified), token verify / revoke / rate limit, badge correctness,
-- curator permission (gallery_manage) and direct-write denial. Rolls back.
\set ON_ERROR_STOP 1
begin;

-- runs q as a caller (null = anon) and returns its jsonb result, or {"err": sqlstate} when it fails
create function pg_temp.q(p_uid uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute format('set local role %s', case when p_uid is null then 'anon' else 'authenticated' end);
  perform set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute q into r;
  exception when others then
    reset role;
    return jsonb_build_object('err', sqlstate, 'msg', sqlerrm);
  end;
  reset role;
  return r;
end $$;
create function pg_temp.err(r jsonb) returns text language sql as $$ select r ->> 'err' $$;

-- A, B, C: verified 2008 in Bengaluru (typed three ways). D: verified 2008 in Pune, blocked by A. H: verified 2008 in Bengaluru,
-- hidden from map and yearbook. U: unverified 2008 Bengaluru. E: verified 2010, unknown city in the USA. F: verified 2010 Mumbai.
-- X: full admin. G: limited admin with gallery_manage only. P1..P12: other verified members (1999).
insert into auth.users (id, email, raw_user_meta_data) values
  ('9a000000-0000-0000-0000-00000000000a', 'a@wow.test', '{"full_name":"Anil Wow"}'),
  ('9a000000-0000-0000-0000-00000000000b', 'b@wow.test', '{"full_name":"Bela Wow"}'),
  ('9a000000-0000-0000-0000-00000000000c', 'c@wow.test', '{"full_name":"Chetan Wow"}'),
  ('9a000000-0000-0000-0000-00000000000d', 'd@wow.test', '{"full_name":"Divya Wow"}'),
  ('9a000000-0000-0000-0000-00000000000e', 'h@wow.test', '{"full_name":"Hidden Wow"}'),
  ('9a000000-0000-0000-0000-00000000000f', 'u@wow.test', '{"full_name":"Unverified Wow"}'),
  ('9a000000-0000-0000-0000-0000000000e1', 'e@wow.test', '{"full_name":"Esha Wow"}'),
  ('9a000000-0000-0000-0000-0000000000f1', 'f@wow.test', '{"full_name":"Farhan Wow"}'),
  ('9a000000-0000-0000-0000-0000000000a1', 'x@wow.test', '{"full_name":"Admin Wow"}'),
  ('9a000000-0000-0000-0000-0000000000a2', 'g@wow.test', '{"full_name":"Gallery Wow"}');
insert into auth.users (id, email, raw_user_meta_data)
  select ('9a000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'p' || i || '@wow.test', json_build_object('full_name', 'Peer ' || i)::jsonb
    from generate_series(1, 12) i;

update public.profiles set onboarded = true, member_type = 'alumnus', grad_year = 2008, branch = 'Computer Science', country = 'India'
 where id::text like '9a000000-0000-0000-0000-00000000000_';
update public.profiles set city = 'Bangalore', current_company = 'Infosys' where id = '9a000000-0000-0000-0000-00000000000a';
update public.profiles set city = 'Bengaluru', current_company = 'infosys ' where id = '9a000000-0000-0000-0000-00000000000b';
update public.profiles set city = 'bengaluru ', branch = 'Mechanical', current_company = 'TCS' where id = '9a000000-0000-0000-0000-00000000000c';
update public.profiles set city = 'Pune' where id = '9a000000-0000-0000-0000-00000000000d';
update public.profiles set city = 'Bengaluru' where id in ('9a000000-0000-0000-0000-00000000000e', '9a000000-0000-0000-0000-00000000000f');
update public.profiles set onboarded = true, member_type = 'alumnus', grad_year = 2010, branch = 'Electrical', city = 'Atlantis', country = 'USA'
 where id = '9a000000-0000-0000-0000-0000000000e1';
update public.profiles set onboarded = true, member_type = 'alumnus', grad_year = 2010, branch = 'Electrical', city = 'Mumbai'
 where id = '9a000000-0000-0000-0000-0000000000f1';
update public.profiles set onboarded = true, member_type = 'alumnus', grad_year = 1999, branch = 'Civil'
 where id::text like '9a000000-0000-0000-0000-0000000001%' or id in ('9a000000-0000-0000-0000-0000000000a1', '9a000000-0000-0000-0000-0000000000a2');
-- verification in a known order (the card serials follow it)
update public.profiles set verification = 'verified' where id = '9a000000-0000-0000-0000-00000000000a';
update public.profiles set verification = 'verified' where id = '9a000000-0000-0000-0000-00000000000b';
update public.profiles set verification = 'verified'
 where id::text like '9a000000-%' and id <> '9a000000-0000-0000-0000-00000000000f' and verification <> 'verified';
update public.profiles set is_admin = true where id in ('9a000000-0000-0000-0000-0000000000a1', '9a000000-0000-0000-0000-0000000000a2', '9a000000-0000-0000-0000-000000000112');
insert into public.admin_grants (user_id, permissions) values ('9a000000-0000-0000-0000-0000000000a2', '{gallery_manage}');
insert into public.admin_grants (user_id, permissions, template_key, scope_kind, scope_value)
  values ('9a000000-0000-0000-0000-000000000112', '{members_view}', 'batch_rep', 'batch', '1999');
insert into public.blocks (blocker, blocked) values ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d');
insert into public.member_showcase_prefs (user_id, show_on_world_map, show_in_yearbook) values ('9a000000-0000-0000-0000-00000000000e', false, false);

-- ================================================================ 1. public landing stats
do $$
declare r jsonb; v int;
begin
  r := pg_temp.q(null, 'select public.public_landing_stats()');
  assert pg_temp.err(r) is null, 'anon can read the landing stats: ' || r::text;
  select count(*) into v from public.profiles where verification = 'verified' and onboarded;
  assert (r ->> 'verified_members')::int = v, 'verified members counted: ' || r::text;
  assert (r ->> 'batches')::int >= 3 and (r ->> 'countries')::int >= 2 and (r ->> 'cities')::int >= 3, 'batches / countries / cities: ' || r::text;
  assert (r ->> 'companies')::int >= 2, 'Infosys (two spellings) and TCS: ' || r::text;
  assert r -> 'flagship' ->> 'slug' = 'alumni-meet-2026' and (r -> 'flagship' ->> 'starts_at') is not null, 'the flagship meet: ' || r::text;
  assert r::text not like '%Wow%' and r::text not like '%9a000000%', 'no names or ids in the landing stats';
end $$;

-- ================================================================ 2. JEC World
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; d constant uuid := '9a000000-0000-0000-0000-00000000000d';
  u constant uuid := '9a000000-0000-0000-0000-00000000000f';
  blr int := (select id from public.geo_cities where search_key = 'bengaluru' and country_code = 'IN' order by population desc limit 1);
  pune int := (select id from public.geo_cities where search_key = 'pune' and country_code = 'IN' order by population desc limit 1);
  r jsonb; row jsonb;
begin
  assert blr is not null and pune is not null, 'Bengaluru and Pune are in the city table';
  -- members: every place, exact counts, the hidden member and the unverified member are not counted
  r := pg_temp.q(a, 'select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world() t');
  assert pg_temp.err(r) is null, 'member reads JEC World: ' || r::text;
  select x into row from jsonb_array_elements(r) x where (x ->> 'city_id')::int = blr;
  assert (row ->> 'alumni')::int >= 3 and row ->> 'city' = 'Bengaluru' and row ->> 'place_precision' = 'city', 'Bangalore + Bengaluru + "bengaluru " = one city: ' || coalesce(row::text, 'null');
  assert (row ->> 'alumni')::int = (select count(*) from public._member_places(true) m where m.city_id = blr and m.place_precision = 'city'), 'counts match the visible members';
  assert not exists (select 1 from public._member_places(true) m where m.user_id in ('9a000000-0000-0000-0000-00000000000e', u)), 'hidden and unverified members are not on the map';
  assert exists (select 1 from public._member_places(false) m where m.user_id = '9a000000-0000-0000-0000-00000000000e'), 'the hidden member still counts in totals';
  assert exists (select 1 from jsonb_array_elements(r) x where x ->> 'place_precision' = 'country' and x ->> 'country_code' = 'US' and x ->> 'city' is null),
    'an unknown city in the USA falls back to the country: ' || r::text;
  assert (row ->> 'lat') is not null and (row ->> 'lng') is not null, 'city centre coordinates';
  -- anon: only places with >= 3, rounded, no ids
  r := pg_temp.q(null, 'select coalesce(jsonb_agg(t), ''[]'') from public.public_alumni_world() t');
  assert pg_temp.err(r) is null, 'anon reads the public world: ' || r::text;
  assert not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'alumni_at_least')::int < 3), 'no place under 3';
  assert exists (select 1 from jsonb_array_elements(r) x where x ->> 'city' = 'Bengaluru'), 'Bengaluru (3 visible) is public: ' || r::text;
  assert not exists (select 1 from jsonb_array_elements(r) x where x ->> 'city' = 'Mumbai' and (select count(*) from public._member_places(true) m where m.city = 'Mumbai') < 3),
    'Mumbai (1) is not public';
  assert r::text not like '%city_id%' and r::text not like '%9a000000%', 'no ids for anon';
  -- refused for anon and the unverified
  assert pg_temp.err(pg_temp.q(null, 'select jsonb_agg(t) from public.alumni_world() t')) = '42501', 'anon cannot read the member world';
  assert pg_temp.err(pg_temp.q(u, 'select jsonb_agg(t) from public.alumni_world() t')) = '42501', 'unverified cannot read the member world';
  assert pg_temp.err(pg_temp.q(u, format('select jsonb_agg(t) from public.alumni_world_city(%s) t', blr))) = '42501', 'unverified cannot drill down';
  -- drill-down: blocks and the hidden member respected
  r := pg_temp.q(a, format('select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world_city(%s) t', blr));
  assert jsonb_array_length(r) = 3 and not exists (select 1 from jsonb_array_elements(r) x where x ->> 'user_id' in ('9a000000-0000-0000-0000-00000000000e', u::text)),
    'A sees A, B, C in Bengaluru (not hidden, not unverified): ' || r::text;
  assert (r -> 0 ->> 'total')::int = 3, 'total for paging';
  r := pg_temp.q(d, format('select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world_city(%s) t', blr));
  assert jsonb_array_length(r) = 2 and not exists (select 1 from jsonb_array_elements(r) x where x ->> 'user_id' = a::text), 'D (blocked by A) does not see A';
  r := pg_temp.q(a, format('select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world_city(%s) t', pune));
  assert jsonb_array_length(r) = 0, 'A does not see D (blocked) in Pune';
  r := pg_temp.q(a, 'select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world_city(null, ''US'') t');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'full_name' = 'Esha Wow', 'country-level drill-down: ' || r::text;
  r := pg_temp.q(a, format('select coalesce(jsonb_agg(t), ''[]'') from public.alumni_world_city(%s, null, 1, 1) t', blr));
  assert jsonb_array_length(r) = 1, 'paging';
end $$;

-- ================================================================ 3. showcase preferences
do $$
declare r jsonb;
begin
  r := pg_temp.q('9a000000-0000-0000-0000-00000000000b', 'select public.my_showcase_prefs()');
  assert r = '{"show_on_world_map": true, "show_in_yearbook": true, "card_show_photo": false}'::jsonb, 'defaults: ' || r::text;
  r := pg_temp.q('9a000000-0000-0000-0000-00000000000b', 'select public.set_my_showcase_prefs(null, null, true)');
  assert (r ->> 'card_show_photo')::boolean and (r ->> 'show_on_world_map')::boolean, 'one setting changed, the others kept: ' || r::text;
  assert pg_temp.err(pg_temp.q(null, 'select public.my_showcase_prefs()')) = '42501', 'anon has no preferences';
  assert pg_temp.err(pg_temp.q('9a000000-0000-0000-0000-00000000000b', 'select to_jsonb(s) from public.member_showcase_prefs s limit 1')) = '42501', 'the table is not readable';
end $$;

-- ================================================================ 4. ID cards
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; b constant uuid := '9a000000-0000-0000-0000-00000000000b';
  u constant uuid := '9a000000-0000-0000-0000-00000000000f';
  r jsonb; ta text; tb text; t2 text; sa bigint; sb bigint; i int;
begin
  assert public.membership_no(2008, 123) = 'JEC-2008-000123' and public.membership_no(null, 5) = 'JEC-000005'
     and public.membership_no(2008, 1234567) = 'JEC-2008-1234567', 'membership number format';
  r := pg_temp.q(a, 'select public.my_id_card()');
  assert r ->> 'status' = 'active' and r ->> 'membership_no' ~ '^JEC-2008-[0-9]{6}$' and r ->> 'token' ~ '^[0-9a-f]{32}$', 'A has an active card: ' || r::text;
  assert (r ->> 'verified')::boolean and r ->> 'full_name' = 'Anil Wow' and r ->> 'branch' = 'Computer Science', 'card shows name, branch';
  ta := r ->> 'token'; sa := (r ->> 'serial')::bigint;
  r := pg_temp.q(b, 'select public.my_id_card()');
  tb := r ->> 'token'; sb := (r ->> 'serial')::bigint;
  assert sb > sa, 'serials follow verification order';
  assert (select count(distinct serial) from public.member_cards) = (select count(*) from public.member_cards), 'serials are unique';
  r := pg_temp.q(u, 'select public.my_id_card()');
  assert r ->> 'status' = 'pending' and r ->> 'membership_no' is null and r ->> 'token' is null, 'unverified: no number, no token: ' || r::text;
  r := pg_temp.q('9a000000-0000-0000-0000-000000000112', 'select public.my_id_card()');
  assert r -> 'roles' ? 'batch_rep' and r -> 'roles' ? 'admin', 'roles on the card: ' || r::text;

  -- the public check: minimal data, photo only when allowed (B allowed it above, A did not)
  r := pg_temp.q(null, format('select public.verify_id_card(%L)', ta));
  assert r ->> 'status' = 'valid' and (r ->> 'valid')::boolean and r ->> 'full_name' = 'Anil Wow' and (r ->> 'grad_year')::int = 2008, 'anon verifies A: ' || r::text;
  assert r ->> 'avatar_url' is null, 'no photo unless allowed';
  assert (select bool_and(k in ('status', 'valid', 'verified', 'full_name', 'avatar_url', 'grad_year', 'branch', 'member_type')) from jsonb_object_keys(r) k),
    'only the allowed fields: ' || r::text;
  update public.profiles set avatar_url = 'https://example.com/b.jpg' where id = b;
  r := pg_temp.q(null, format('select public.verify_id_card(%L)', tb));
  assert r ->> 'avatar_url' = 'https://example.com/b.jpg', 'photo shown when the member allows it';
  assert pg_temp.q(null, 'select public.verify_id_card(''nonsense'')') ->> 'status' = 'not_found', 'garbage token';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', repeat('0', 32))) ->> 'status' = 'not_found', 'unknown token';
  -- regenerate: the old token says revoked, the new one is valid
  r := pg_temp.q(a, 'select public.regenerate_my_id_card_token()');
  t2 := r ->> 'token';
  assert t2 <> ta and (r ->> 'serial')::bigint = sa, 'new token, same membership number';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', ta)) ->> 'status' = 'revoked', 'old token revoked';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', ta)) ->> 'full_name' is null, 'a revoked token reveals nothing';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', t2)) ->> 'status' = 'valid', 'new token valid';
  r := pg_temp.q(a, 'select public.revoke_my_id_card_token()');
  assert r ->> 'token' is null, 'revoked: no QR';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', t2)) ->> 'status' = 'revoked', 'revoked token';
  assert pg_temp.err(pg_temp.q(u, 'select public.regenerate_my_id_card_token()')) = '42501', 'unverified cannot make a token';
  -- un-verified member: card inactive; verified again: same serial
  update public.profiles set verification = 'pending' where id = b;
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', tb)) ->> 'status' = 'inactive', 'un-verified member: inactive';
  update public.profiles set verification = 'verified' where id = b;
  assert (select serial from public.member_cards where user_id = b) = sb, 'serial is stable across re-verification';
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', tb)) ->> 'status' = 'valid', 'valid again';
  -- the tables are closed to the API
  assert pg_temp.err(pg_temp.q(a, 'select to_jsonb(t) from public.member_card_tokens t limit 1')) = '42501', 'tokens table closed';
  assert pg_temp.err(pg_temp.q(a, 'select to_jsonb(t) from public.member_cards t limit 1')) = '42501', 'cards table closed';
  assert pg_temp.err(pg_temp.q(null, 'select public.my_id_card()')) = '42501', 'anon has no card';
end $$;

-- rate limit: 30 checks per 10 minutes per caller address; another address is not affected
do $$
declare r jsonb; i int; tb text := (select token from public.member_card_tokens where user_id = '9a000000-0000-0000-0000-00000000000b' and revoked_at is null);
begin
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true);
  for i in 1..30 loop
    r := pg_temp.q(null, format('select public.verify_id_card(%L)', tb));
    assert r ->> 'status' = 'valid', 'check ' || i || ' allowed: ' || r::text;
  end loop;
  r := pg_temp.q(null, format('select public.verify_id_card(%L)', tb));
  assert r ->> 'status' = 'rate_limited' and r ->> 'full_name' is null, 'the 31st check is refused: ' || r::text;
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.7"}', true);
  assert pg_temp.q(null, format('select public.verify_id_card(%L)', tb)) ->> 'status' = 'valid', 'another address is fine';
  assert not exists (select 1 from public.card_verify_log where client like '%203.0.113%' or client = tb), 'only hashes are stored';
  perform set_config('request.headers', '', true);
end $$;

-- ================================================================ 5. achievements
-- seeded activity for A
insert into public.connections (requester, addressee, status, accepted_at, created_at)
  select '9a000000-0000-0000-0000-00000000000a', ('9a000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'accepted',
         now() - make_interval(days => i), now() - make_interval(days => i)
    from generate_series(1, 10) i;
insert into public.connections (requester, addressee) values
  ('9a000000-0000-0000-0000-000000000111', '9a000000-0000-0000-0000-00000000000a'),
  ('9a000000-0000-0000-0000-00000000000d', '9a000000-0000-0000-0000-00000000000a');
update public.profiles set avatar_url = 'https://example.com/a.jpg', headline = 'Engineer', about = 'About me', skills = '{SQL}',
       help_tags = '{Career}', linkedin_url = 'https://www.linkedin.com/in/anil'
 where id = '9a000000-0000-0000-0000-00000000000a';
insert into public.posts (author_id, body) select '9a000000-0000-0000-0000-00000000000a', 'Post ' || i from generate_series(1, 5) i;
insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path)
  select e.id, '9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000a/p' || i || '.jpg', '9a000000-0000-0000-0000-00000000000a/t' || i || '.jpg'
    from public.events e, generate_series(1, 11) i where e.slug = 'alumni-meet-2026';
update public.event_photos set status = 'approved', is_hidden = (storage_path like '%/p11.jpg') where uploaded_by = '9a000000-0000-0000-0000-00000000000a';
insert into public.event_registrations (event_id, user_id, code, full_name, phone, status)
  select e.id, '9a000000-0000-0000-0000-00000000000a', 'JEC-WOW001', 'Anil Wow', '+91 98765 43210', 'confirmed' from public.events e where e.slug = 'alumni-meet-2026';
insert into public.event_staff (event_id, user_id, role)
  select e.id, '9a000000-0000-0000-0000-00000000000a', 'checkin' from public.events e where e.slug = 'alumni-meet-2026';
insert into public.mentor_profiles (user_id, topics, bio) values ('9a000000-0000-0000-0000-00000000000a', '{"Career growth"}', 'Happy to help juniors with careers.');
insert into public.giving_campaigns (id, slug, type, title, goal_paise, status) values ('9a000000-0000-0000-0000-0000000009c1', 'wow-fund', 'project', 'Wow fund', 10000000, 'live');
insert into public.giving_donations (campaign_id, user_id, amount_paise, method, status, is_anonymous, verified_at)
  values ('9a000000-0000-0000-0000-0000000009c1', '9a000000-0000-0000-0000-00000000000a', 1000000, 'cash', 'verified', true, now());

create function pg_temp.badge(r jsonb, k text) returns jsonb language sql as $$
  select x from jsonb_array_elements(r -> 'badges') x where x ->> 'key' = k
$$;
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; b constant uuid := '9a000000-0000-0000-0000-00000000000b';
  d constant uuid := '9a000000-0000-0000-0000-00000000000d'; u constant uuid := '9a000000-0000-0000-0000-00000000000f';
  r jsonb; k text;
begin
  r := pg_temp.q(a, format('select public.member_achievements(%L)', a));
  assert pg_temp.err(r) is null, 'own badges: ' || r::text;
  assert (select array_agg(x ->> 'key' order by o) from jsonb_array_elements(r -> 'badges') with ordinality t(x, o)) = array['verified_jecian', 'founding_member',
    'profile_star', 'connector', 'super_connector', 'mentor', 'helper', 'storyteller', 'photographer', 'reunion_2026', 'volunteer', 'donor', 'patron',
    'organiser', 'batch_rep'], 'the catalogue keys, in order (src/features/badges/catalog.ts must match)';
  foreach k in array array['verified_jecian', 'profile_star', 'connector', 'mentor', 'helper', 'storyteller', 'photographer', 'reunion_2026',
                           'volunteer', 'donor', 'patron', 'organiser'] loop
    assert (pg_temp.badge(r, k) ->> 'earned')::boolean, 'A earned ' || k || ': ' || pg_temp.badge(r, k)::text;
  end loop;
  assert not (pg_temp.badge(r, 'super_connector') ->> 'earned')::boolean and (pg_temp.badge(r, 'super_connector') ->> 'progress')::int = 10
     and (pg_temp.badge(r, 'super_connector') ->> 'target')::int = 50, 'super connector 10/50';
  assert (pg_temp.badge(r, 'connector') ->> 'earned_at')::timestamptz = now() - interval '1 day', 'connector earned at the 10th connection';
  assert (pg_temp.badge(r, 'photographer') ->> 'progress')::int = 10, 'a hidden photo does not count';
  assert not (pg_temp.badge(r, 'batch_rep') ->> 'earned')::boolean, 'A is no batch rep';
  assert (pg_temp.badge(r, 'founding_member') ->> 'earned')::boolean = ((select serial from public.member_cards where user_id = a) <= 500), 'founding = serial <= 500';
  -- anonymous donations count only in the member's own view
  r := pg_temp.q(b, format('select public.member_achievements(%L)', a));
  assert not (pg_temp.badge(r, 'donor') ->> 'earned')::boolean and not (pg_temp.badge(r, 'patron') ->> 'earned')::boolean, 'B does not learn of an anonymous gift';
  assert (pg_temp.badge(r, 'connector') ->> 'earned')::boolean, 'B sees the other badges';
  insert into public.giving_donations (campaign_id, user_id, amount_paise, method, status, verified_at)
    values ('9a000000-0000-0000-0000-0000000009c1', a, 10000, 'cash', 'verified', now());
  r := pg_temp.q(b, format('select public.member_achievements(%L)', a));
  assert (pg_temp.badge(r, 'donor') ->> 'earned')::boolean and not (pg_temp.badge(r, 'patron') ->> 'earned')::boolean
     and (pg_temp.badge(r, 'patron') ->> 'progress')::int = 10000, 'a public gift of Rs 100: donor, not patron, for others';
  -- batch rep, founding not attainable with a high serial
  r := pg_temp.q(b, 'select public.member_achievements(''9a000000-0000-0000-0000-000000000112'')');
  assert (pg_temp.badge(r, 'batch_rep') ->> 'earned')::boolean, 'batch rep badge';
  update public.member_cards set serial = 900000001 where user_id = '9a000000-0000-0000-0000-0000000000f1';
  r := pg_temp.q(b, 'select public.member_achievements(''9a000000-0000-0000-0000-0000000000f1'')');
  assert not (pg_temp.badge(r, 'founding_member') ->> 'earned')::boolean and not (pg_temp.badge(r, 'founding_member') ->> 'attainable')::boolean, 'late joiner';
  assert not (pg_temp.badge(r, 'profile_star') ->> 'earned')::boolean and (pg_temp.badge(r, 'profile_star') ->> 'progress')::int = 25, 'F: name + batch = 25%';
  -- privacy
  assert pg_temp.q(d, format('select public.member_achievements(%L)', a)) = 'null'::jsonb or pg_temp.q(d, format('select public.member_achievements(%L)', a)) is null, 'blocked: nothing';
  assert pg_temp.err(pg_temp.q(u, format('select public.member_achievements(%L)', a))) = '42501', 'unverified cannot read others';
  assert pg_temp.err(pg_temp.q(u, format('select public.member_achievements(%L)', u))) is null, 'unverified reads their own';
  assert pg_temp.q(a, format('select public.member_achievements(%L)', u)) is null, 'nobody reads an unverified member''s badges';
  assert pg_temp.err(pg_temp.q(null, format('select public.member_achievements(%L)', a))) = '42501', 'anon refused';
end $$;

-- ================================================================ 6. yearbooks
insert into storage.objects (bucket_id, name) values ('gallery', 'gallery/yearbooks/cover.webp'), ('gallery', 'gallery/yearbooks/class1.webp'), ('gallery', 'gallery/fame/one.webp');
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; d constant uuid := '9a000000-0000-0000-0000-00000000000d';
  u constant uuid := '9a000000-0000-0000-0000-00000000000f'; g constant uuid := '9a000000-0000-0000-0000-0000000000a2';
  adm constant uuid := '9a000000-0000-0000-0000-0000000000a1';
  r jsonb; yid uuid;
begin
  -- curators only
  assert pg_temp.err(pg_temp.q(a, 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008}''))')) = '42501', 'a member cannot curate';
  assert pg_temp.err(pg_temp.q('9a000000-0000-0000-0000-000000000112', 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008}''))')) = '42501', 'another limited admin cannot curate';
  r := pg_temp.q(g, 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008,"cover_path":"gallery/yearbooks/cover.webp","class_photo_paths":["gallery/yearbooks/class1.webp"],"quote":"We built bridges","memories":"Canteen chai"}''))');
  assert pg_temp.err(r) is null, 'gallery curator saves a yearbook: ' || r::text;
  yid := (r #>> '{}')::uuid;
  assert exists (select 1 from public.admin_audit where action = 'yearbook_save' and target_id = yid), 'activity log';
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008,"cover_path":"gallery/yearbooks/missing.webp"}''))')) = 'P0001', 'missing file refused';
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008,"class_photo_paths":["gallery/x/../../evil"]}''))')) = 'P0001', 'path outside the folder refused';
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_yearbook(''{"grad_year":2008}''))')) = 'P0001', 'one yearbook per batch';
  -- drafts: curator sees, members do not
  r := pg_temp.q(a, 'select public.batch_yearbook(2008)');
  assert r -> 'yearbook' = 'null'::jsonb or r -> 'yearbook' is null, 'draft hidden from members: ' || (r -> 'yearbook')::text;
  assert pg_temp.q(g, 'select public.batch_yearbook(2008)') -> 'yearbook' ->> 'quote' = 'We built bridges', 'curator sees the draft';
  assert pg_temp.q(a, 'select coalesce(jsonb_agg(to_jsonb(y)), ''[]'') from public.yearbooks y') = '[]'::jsonb, 'RLS: draft rows hidden';
  perform pg_temp.q(g, format('select to_jsonb(public.admin_save_yearbook(''{"id":"%s","grad_year":2008,"is_published":true}''))', yid));
  r := pg_temp.q(a, 'select public.batch_yearbook(2008)');
  assert r -> 'yearbook' ->> 'quote' = 'We built bridges' and r -> 'yearbook' -> 'class_photo_paths' ->> 0 = 'gallery/yearbooks/class1.webp', 'published yearbook, earlier fields kept: ' || (r -> 'yearbook')::text;
  -- members list: A, B, C (D blocked, H hidden, U unverified)
  assert (select array_agg(x ->> 'full_name' order by x ->> 'full_name') from jsonb_array_elements(r -> 'members') x) = array['Anil Wow', 'Bela Wow', 'Chetan Wow'],
    'yearbook members as A: ' || (r -> 'members')::text;
  assert (r ->> 'hidden_count')::int = 1, 'one member chose not to be listed';
  assert (r -> 'stats' ->> 'members')::int = 5, 'stats count every verified batchmate';
  assert r -> 'stats' -> 'top_companies' = '[{"name": "Infosys", "members": 2}]'::jsonb, 'companies shared by 2+: ' || (r -> 'stats' -> 'top_companies')::text;
  assert r -> 'stats' -> 'top_cities' -> 0 ->> 'members' = '4' and jsonb_array_length(r -> 'stats' -> 'top_cities') = 1, 'Bengaluru (4 spellings) only: ' || (r -> 'stats' -> 'top_cities')::text;
  assert (r -> 'stats' ->> 'cities')::int = 2, 'Bengaluru and Pune';
  assert (r ->> 'years_since')::int = extract(year from (now() at time zone 'Asia/Kolkata'))::int - 2008, 'years since';
  r := pg_temp.q(d, 'select public.batch_yearbook(2008)');
  assert not exists (select 1 from jsonb_array_elements(r -> 'members') x where x ->> 'full_name' = 'Anil Wow'), 'D does not see A';
  r := pg_temp.q('9a000000-0000-0000-0000-00000000000e', 'select public.batch_yearbook(2008)');
  assert exists (select 1 from jsonb_array_elements(r -> 'members') x where (x ->> 'is_me')::boolean and not (x ->> 'listed')::boolean), 'the hidden member sees themself, marked unlisted';
  -- a branch: falls back to the year's yearbook
  r := pg_temp.q(a, 'select public.batch_yearbook(2008, ''Computer Science'')');
  assert (select array_agg(x ->> 'full_name' order by x ->> 'full_name') from jsonb_array_elements(r -> 'members') x) = array['Anil Wow', 'Bela Wow'], 'branch filter';
  assert r -> 'yearbook' ->> 'quote' = 'We built bridges', 'year-wide yearbook for a branch';
  -- refused
  assert pg_temp.err(pg_temp.q(u, 'select public.batch_yearbook(2008)')) = '42501', 'unverified refused';
  assert pg_temp.err(pg_temp.q(null, 'select public.batch_yearbook(2008)')) = '42501', 'anon refused';
  assert pg_temp.err(pg_temp.q(g, 'insert into public.yearbooks (grad_year) values (1990) returning to_jsonb(yearbooks.*)')) = '42501', 'no direct insert, even for curators';
  assert pg_temp.err(pg_temp.q(adm, format('update public.yearbooks set quote = ''x'' where id = %L returning to_jsonb(yearbooks.*)', yid))) = '42501', 'no direct update';
  -- delete gives the files back
  r := pg_temp.q(adm, format('select to_jsonb(public.admin_delete_yearbook(%L))', yid));
  assert r ? 'gallery/yearbooks/cover.webp' and r ? 'gallery/yearbooks/class1.webp', 'files to remove: ' || r::text;
end $$;

-- ================================================================ 7. wall of fame
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; u constant uuid := '9a000000-0000-0000-0000-00000000000f';
  g constant uuid := '9a000000-0000-0000-0000-0000000000a2';
  r jsonb; id1 uuid; id2 uuid;
begin
  assert pg_temp.err(pg_temp.q(a, 'select to_jsonb(public.admin_save_fame(''{"name":"Me","title":"Great","category":"legend"}''))')) = '42501', 'members cannot add';
  r := pg_temp.q(g, format('select to_jsonb(public.admin_save_fame(''{"member_id":"%s","title":"Built a startup","category":"entrepreneur","is_published":true,"link_url":"https://example.com/a"}''))', a));
  assert pg_temp.err(r) is null, 'curator adds a member: ' || r::text;
  id1 := (r #>> '{}')::uuid;
  assert (select name from public.wall_of_fame where id = id1) = 'Anil Wow' and (select grad_year from public.wall_of_fame where id = id1) = 2008, 'name and batch from the profile';
  r := pg_temp.q(g, 'select to_jsonb(public.admin_save_fame(''{"name":"Legend Sir","title":"Founder of the college band","category":"legend","is_published":true,"is_public":true,"image_path":"gallery/fame/one.webp","story":"A story."}''))');
  id2 := (r #>> '{}')::uuid;
  perform pg_temp.q(g, 'select to_jsonb(public.admin_save_fame(''{"name":"Draft Person","title":"Not yet","category":"research"}''))');
  perform pg_temp.q(g, format('select to_jsonb(public.admin_save_fame(''{"name":"Future Person","title":"Soon","category":"sports","is_published":true,"is_public":true,"starts_at":"%s"}''))', now() + interval '2 days'));
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_fame(''{"name":"Bad","title":"Link","category":"arts","link_url":"http://example.com"}''))')) = 'P0001', 'http refused';
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_fame(''{"name":"Bad","title":"Link","category":"arts","link_url":"javascript:alert(1)"}''))')) = 'P0001', 'javascript: refused';
  assert pg_temp.err(pg_temp.q(g, format('select to_jsonb(public.admin_save_fame(''{"name":"Long","title":"Story","category":"arts","story":"%s"}''))', repeat('x', 2001)))) = 'P0001', 'story too long';
  assert pg_temp.err(pg_temp.q(g, 'select to_jsonb(public.admin_save_fame(''{"name":"Bad","title":"Cat","category":"villain"}''))')) = 'P0001', 'unknown category';
  -- anon: public + published + in window, no ids
  r := pg_temp.q(null, 'select coalesce(jsonb_agg(t), ''[]'') from public.public_wall_of_fame() t');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'name' = 'Legend Sir' and not (r -> 0 ? 'id') and not (r -> 0 ? 'member_id'), 'anon: one public entry, no ids: ' || r::text;
  assert pg_temp.err(pg_temp.q(null, 'select jsonb_agg(to_jsonb(f)) from public.wall_of_fame f')) = '42501', 'anon cannot read the table';
  -- verified: the 2 shown entries; unverified: none; curator: all 4
  r := pg_temp.q(a, 'select coalesce(jsonb_agg(t), ''[]'') from public.wall_of_fame_list() t');
  assert jsonb_array_length(r) = 2, 'member sees published, current entries: ' || r::text;
  assert exists (select 1 from jsonb_array_elements(r) x where x ->> 'avatar_url' = 'https://example.com/a.jpg'), 'member entry falls back to the avatar';
  assert jsonb_array_length(pg_temp.q(a, 'select coalesce(jsonb_agg(t), ''[]'') from public.wall_of_fame_list(''legend'') t')) = 1, 'category filter';
  assert pg_temp.q(a, 'select count(*)::int::text::jsonb from public.wall_of_fame') = '2'::jsonb, 'RLS: member reads 2 rows';
  assert pg_temp.q(u, 'select count(*)::int::text::jsonb from public.wall_of_fame') = '0'::jsonb, 'RLS: unverified reads none';
  assert pg_temp.q(g, 'select count(*)::int::text::jsonb from public.wall_of_fame') = '4'::jsonb, 'RLS: curator reads all';
  assert pg_temp.err(pg_temp.q(g, 'insert into public.wall_of_fame (name, title, category) values (''x x'', ''y y'', ''arts'') returning to_jsonb(wall_of_fame.*)')) = '42501', 'no direct insert';
  assert pg_temp.err(pg_temp.q(a, format('delete from public.wall_of_fame where id = %L returning to_jsonb(wall_of_fame.*)', id1))) = '42501', 'no direct delete';
  -- reorder and delete
  perform pg_temp.q(g, format('select to_jsonb(public.admin_reorder_fame(array[%L, %L]::uuid[]))', id2, id1));
  assert (select sort from public.wall_of_fame where id = id2) < (select sort from public.wall_of_fame where id = id1), 'reordered';
  assert pg_temp.q(g, format('select to_jsonb(public.admin_delete_fame(%L))', id2)) = '["gallery/fame/one.webp"]'::jsonb, 'delete returns the image';
end $$;

-- ================================================================ 8. Home
do $$
declare
  a constant uuid := '9a000000-0000-0000-0000-00000000000a'; u constant uuid := '9a000000-0000-0000-0000-00000000000f';
  r jsonb;
begin
  r := pg_temp.q(a, 'select public.home_highlights()');
  assert pg_temp.err(r) is null, 'A home: ' || r::text;
  assert (r -> 'batch_anniversary' ->> 'years')::int = extract(year from (now() at time zone 'Asia/Kolkata'))::int - 2008, 'batch anniversary';
  assert (r -> 'new_batchmates_week' ->> 'count')::int = 3
     and not exists (select 1 from jsonb_array_elements(r -> 'new_batchmates_week' -> 'people') x where x ->> 'id' = '9a000000-0000-0000-0000-00000000000d'),
    'B, C, H joined this week (D blocked): ' || (r -> 'new_batchmates_week')::text;
  assert jsonb_array_length(r -> 'upcoming_events') = 1 and r -> 'upcoming_events' -> 0 ->> 'slug' = 'alumni-meet-2026'
     and (r -> 'upcoming_events' -> 0 ->> 'days_left')::int >= 0, 'the meet I am registered for: ' || (r -> 'upcoming_events')::text;
  assert (r ->> 'pending_connection_requests')::int = 1, 'one pending request (the blocked one is not counted)';
  assert (r -> 'unread' ->> 'notifications')::int = (select count(*) from public.notifications where user_id = a and read_at is null), 'unread notifications';
  assert (r -> 'profile' ->> 'percent')::int = 100 and jsonb_array_length(r -> 'profile' -> 'missing') = 0, 'complete profile';
  assert (r ->> 'nearby_in_my_city')::int = 3, 'B, C, H live in my city (D blocked and elsewhere, U unverified): ' || (r ->> 'nearby_in_my_city');
  assert r ? 'server_now', 'server time';
  r := pg_temp.q(u, 'select public.home_highlights()');
  assert pg_temp.err(r) is null and (r ->> 'nearby_in_my_city')::int = 0 and (r -> 'new_batchmates_week' ->> 'count')::int = 0, 'unverified: no people: ' || r::text;
  assert pg_temp.err(pg_temp.q(null, 'select public.home_highlights()')) = '42501', 'anon refused';
  -- batchmates summary
  r := pg_temp.q(a, 'select public.my_batchmates_summary()');
  assert (r ->> 'batchmates')::int = 4 and (r ->> 'in_my_city')::int = 3 and (r ->> 'same_branch')::int = 3, 'batchmates: ' || r::text;
  assert jsonb_array_length(r -> 'newest') = 3 and not exists (select 1 from jsonb_array_elements(r -> 'newest') x where x ->> 'id' = '9a000000-0000-0000-0000-00000000000d'),
    'newest joiners without the blocked member: ' || (r -> 'newest')::text;
  r := pg_temp.q(u, 'select public.my_batchmates_summary()');
  assert (r ->> 'batchmates')::int = 5 and r -> 'newest' = '[]'::jsonb, 'unverified: counts only';
end $$;

-- ================================================================ 9. grants
do $$
declare t text;
begin
  foreach t in array array['member_showcase_prefs', 'member_cards', 'member_card_tokens', 'card_verify_log', 'yearbooks', 'wall_of_fame'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT'), 'anon cannot read ' || t;
    assert not has_table_privilege('authenticated', 'public.' || t, 'INSERT') and not has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       and not has_table_privilege('authenticated', 'public.' || t, 'DELETE'), 'members cannot write ' || t;
  end loop;
  assert has_function_privilege('anon', 'public.public_landing_stats()', 'execute') and has_function_privilege('anon', 'public.verify_id_card(text)', 'execute')
     and has_function_privilege('anon', 'public.public_alumni_world()', 'execute') and has_function_privilege('anon', 'public.public_wall_of_fame(int)', 'execute'),
    'the four public functions';
  assert not has_function_privilege('anon', 'public.alumni_world()', 'execute') and not has_function_privilege('anon', 'public.home_highlights()', 'execute')
     and not has_function_privilege('anon', 'public.my_id_card()', 'execute') and not has_function_privilege('anon', 'public.batch_yearbook(int, text)', 'execute'),
    'member functions are not for anon';
  assert not has_function_privilege('authenticated', 'public._member_places(boolean)', 'execute')
     and not has_function_privilege('authenticated', 'public._profile_completeness(uuid)', 'execute'), 'internal helpers closed';
end $$;

select 'ALL WOW FEATURE TESTS PASSED';
rollback;
