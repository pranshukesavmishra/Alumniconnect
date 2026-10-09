-- Command centre: attention queue, global search, roles overview. Who may call, correct counts, no contact leaks, audit. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-00000000000a', 'zuri.private@x.com', '{"full_name":"Zuri Quillfeather"}'),
  ('95000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela Member"}'),
  ('95000000-0000-0000-0000-0000000000dd', 'd@x.com', '{"full_name":"Volunteer"}'),
  ('95000000-0000-0000-0000-0000000000ee', 'e@x.com', '{"full_name":"Treasurer"}'),
  ('95000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Boss"}');
update public.profiles set onboarded = true where id::text like '95000000-%';
update public.profiles set verification = 'verified' where id::text like '95000000-%' and id <> '95000000-0000-0000-0000-00000000000a';
update public.profiles set is_admin = true where id = '95000000-0000-0000-0000-0000000000ff';
update public.profile_private set phone = '+91 98765 11122' where id = '95000000-0000-0000-0000-00000000000a';
insert into public.events (id, slug, title, is_published, upi_id, registration_closes_at, capacity) values
  ('95000000-0000-0000-0000-0000000000e1', 'cc-mine', 'CC Mine', true, null, now() + interval '3 days', 10),
  ('95000000-0000-0000-0000-0000000000e2', 'cc-other', 'CC Other', true, 'jec@okhdfc', null, null);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary) values
  ('95000000-0000-0000-0000-0000000000f1', '95000000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true),
  ('95000000-0000-0000-0000-0000000000f2', '95000000-0000-0000-0000-0000000000e2', 'Alumnus', 100000, true);
insert into public.event_staff (event_id, user_id, role) values
  ('95000000-0000-0000-0000-0000000000e1', '95000000-0000-0000-0000-0000000000ee', 'manager'),
  ('95000000-0000-0000-0000-0000000000e1', '95000000-0000-0000-0000-0000000000dd', 'checkin');
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise) values
  ('95000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-0000000000e1', '95000000-0000-0000-0000-00000000000a', 'JEC-QQ7777', 'Zuri Quillfeather', '+91 98765 11122', 'zuri.reg@x.com', 'under_review', 2, 100000),
  ('95000000-0000-0000-0000-0000000000a2', '95000000-0000-0000-0000-0000000000e2', '95000000-0000-0000-0000-00000000000b', 'JEC-QQ8888', 'Bela Member', '+91 98765 33344', null, 'under_review', 1, 100000);
insert into public.event_payments (registration_id, amount_paise, utr, status) values
  ('95000000-0000-0000-0000-0000000000a1', 100000, '123456789012', 'submitted'),
  ('95000000-0000-0000-0000-0000000000a2', 100000, '210987654321', 'submitted');
insert into public.groups (kind, slug, name, is_approved, created_by) values ('circle', 'cc-circle', 'CC Circle', false, '95000000-0000-0000-0000-00000000000b');
create temp table snap (k text primary key, j jsonb);
grant select, insert on snap to authenticated;

-- members and volunteers cannot call any of it; anon cannot either
select pg_temp.login('95000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin perform public.admin_attention(); assert false, 'member attention';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_search('zuri'); assert false, 'member search';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_roles_overview(); assert false, 'member roles';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin
  begin perform public.admin_attention(); assert false, 'check-in volunteer attention';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_search('zuri'); assert false, 'check-in volunteer search';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.admin_attention(); assert false, 'anon attention';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_search('zuri'); assert false, 'anon search';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- the treasurer sees only their own event, no site-wide numbers, only their registrations
select pg_temp.login('95000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$
declare a jsonb := public.admin_attention(); s jsonb;
begin
  assert a ->> 'is_admin' = 'false' and a -> 'global' = 'null'::jsonb, 'no site-wide numbers for a treasurer';
  assert jsonb_array_length(a -> 'events') = 1 and a -> 'events' -> 0 ->> 'slug' = 'cc-mine', 'only my event';
  assert (a -> 'events' -> 0 ->> 'payments_to_verify')::int = 1, 'one payment waiting';
  assert (a -> 'events' -> 0 ->> 'closes_soon')::boolean, 'closing within a week';
  assert (a -> 'events' -> 0 ->> 'missing_upi')::boolean, 'published, priced, no UPI id';
  assert (a -> 'events' -> 0 ->> 'seats_taken')::int = 2, 'seats = headcount';
  s := public.admin_search('qq');
  assert jsonb_array_length(s -> 'registrations') = 1 and s -> 'registrations' -> 0 ->> 'code' = 'JEC-QQ7777', 'treasurer finds only own event registrations';
  assert jsonb_array_length(s -> 'members') = 0, 'treasurer cannot search the member list';
  s := public.admin_search('210987654321');
  assert jsonb_array_length(s -> 'payments') = 0, 'other events UTRs are invisible';
  s := public.admin_search('123456789012');
  assert jsonb_array_length(s -> 'payments') = 1 and s -> 'payments' -> 0 ->> 'code' = 'JEC-QQ7777', 'UTR finds the payment and its ticket';
  begin perform public.admin_roles_overview(); assert false, 'treasurer roles overview is admin-only';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- the admin
select pg_temp.login('95000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare a jsonb := public.admin_attention(); s jsonb; r jsonb; before_n int;
begin
  assert a ->> 'is_admin' = 'true', 'admin flag';
  assert (a -> 'global' ->> 'members_pending')::int = (select count(*) from public.profiles where onboarded and verification = 'pending'), 'pending members match';
  assert (a -> 'global' ->> 'members_pending')::int >= 1, 'Zuri waits';
  assert (a -> 'global' ->> 'circles_waiting')::int = (select count(*) from public.groups where kind = 'circle' and not is_approved), 'circles match';
  assert jsonb_array_length(a -> 'events') >= 2, 'admin sees every event';
  insert into snap values ('a', a);

  -- name, ticket code, UTR, phone, e-mail
  s := public.admin_search('quillfeather');
  assert s -> 'members' -> 0 ->> 'id' = '95000000-0000-0000-0000-00000000000a' and s -> 'members' -> 0 ->> 'matched_on' = 'name', 'member by name';
  assert s -> 'registrations' -> 0 ->> 'code' = 'JEC-QQ7777', 'registration by name';
  assert not (s ->> 'by_contact')::boolean, 'a name search is not a contact lookup';
  s := public.admin_search('jec-qq8888');
  assert s -> 'registrations' -> 0 ->> 'full_name' = 'Bela Member' and s -> 'registrations' -> 0 ->> 'matched_on' = 'ticket code', 'by code, any case';
  s := public.admin_search('210987654321');
  assert s -> 'payments' -> 0 ->> 'code' = 'JEC-QQ8888', 'admin finds any UTR';
  before_n := (select count(*) from public.admin_audit where action = 'search_contact');
  s := public.admin_search('98765 11122');
  assert s -> 'members' -> 0 ->> 'id' = '95000000-0000-0000-0000-00000000000a' and s -> 'members' -> 0 ->> 'matched_on' = 'phone', 'member by phone';
  assert s -> 'registrations' -> 0 ->> 'code' = 'JEC-QQ7777', 'registration by phone';
  s := public.admin_search('zuri.private@x');
  assert s -> 'members' -> 0 ->> 'matched_on' = 'email', 'member by email';
  assert (select count(*) from public.admin_audit where action = 'search_contact') = before_n + 2, 'both contact lookups logged';
  -- never returns the contact details themselves, only that they matched
  r := public.admin_search('zuri');
  assert r::text !~ '98765' and r::text !~ 'x\.com', 'no phone or e-mail in any result';
  r := public.admin_search('98765 11122');
  assert r::text !~ '98765 11122' and r::text !~ 'x\.com', 'a phone search does not echo the number';
  assert jsonb_array_length((public.admin_search('z')) -> 'members') = 0, 'one letter is too short';
  assert jsonb_array_length((public.admin_search('%%')) -> 'members') = 0, 'wildcards match nothing';

  r := public.admin_roles_overview();
  assert exists (select 1 from jsonb_array_elements(r -> 'admins') x where x ->> 'full_name' = 'Boss'), 'admin listed';
  assert exists (select 1 from jsonb_array_elements(r -> 'staff') x where x ->> 'full_name' = 'Treasurer' and x ->> 'role' = 'treasurer' and x ->> 'event_slug' = 'cc-mine'), 'treasurer listed (legacy manager row became treasurer + content)';
  assert exists (select 1 from jsonb_array_elements(r -> 'staff') x where x ->> 'full_name' = 'Treasurer' and x ->> 'role' = 'content' and x ->> 'event_slug' = 'cc-mine'), 'and content manager';
  assert exists (select 1 from jsonb_array_elements(r -> 'staff') x where x ->> 'full_name' = 'Volunteer' and x ->> 'role' = 'checkin'), 'volunteer listed';
  assert r::text !~ 'x\.com', 'no e-mail in roles overview';
end $$;
reset role;

-- counts move when the data changes
update public.profiles set verification = 'verified' where id = '95000000-0000-0000-0000-00000000000a';
update public.groups set is_approved = true where slug = 'cc-circle';
update public.event_payments set status = 'verified' where utr = '123456789012';
select pg_temp.login('95000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare before_j jsonb := (select j from snap where k = 'a'); after_j jsonb := public.admin_attention();
begin
  assert (after_j -> 'global' ->> 'members_pending')::int = (before_j -> 'global' ->> 'members_pending')::int - 1, 'verified member leaves the queue';
  assert (after_j -> 'global' ->> 'circles_waiting')::int = (before_j -> 'global' ->> 'circles_waiting')::int - 1, 'approved circle leaves the queue';
  assert (select (e ->> 'payments_to_verify')::int from jsonb_array_elements(after_j -> 'events') e where e ->> 'slug' = 'cc-mine') = 0, 'verified payment leaves the queue';
end $$;
reset role;
select 'COMMAND CENTRE TESTS PASSED';
rollback;
