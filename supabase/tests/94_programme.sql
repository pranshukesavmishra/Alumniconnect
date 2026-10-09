-- Programme and announcements. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('94000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Registered"}'),
  ('94000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Cancelled"}'),
  ('94000000-0000-0000-0000-00000000000c', 'c@x.com', '{"full_name":"Outsider"}'),
  ('94000000-0000-0000-0000-0000000000dd', 'd@x.com', '{"full_name":"Volunteer"}'),
  ('94000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Manager"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '94000000-%';
update public.profiles set is_admin = true where id = '94000000-0000-0000-0000-0000000000ff';
insert into public.events (id, slug, title, is_published) values ('94000000-0000-0000-0000-0000000000e1', 'prog-test', 'Meet', true),
                                                                  ('94000000-0000-0000-0000-0000000000e2', 'prog-draft', 'Draft', false);
insert into public.event_staff (event_id, user_id, role) values ('94000000-0000-0000-0000-0000000000e1', '94000000-0000-0000-0000-0000000000dd', 'checkin');
insert into public.event_registrations (event_id, user_id, code, full_name, phone, status) values
  ('94000000-0000-0000-0000-0000000000e1', '94000000-0000-0000-0000-00000000000a', 'JEC-AAA111', 'Registered', '+91 98765 43210', 'confirmed'),
  ('94000000-0000-0000-0000-0000000000e1', '94000000-0000-0000-0000-00000000000b', 'JEC-BBB222', 'Cancelled', '+91 98765 43210', 'cancelled');
insert into public.event_programme (event_id, starts_at, title, venue) values
  ('94000000-0000-0000-0000-0000000000e2', now() + interval '10 days', 'Hidden session', 'Hall');
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

-- manager writes the programme and sends an announcement
select pg_temp.login('94000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare a public.event_announcements;
begin
  insert into public.event_programme (event_id, starts_at, ends_at, title, venue) values
    ('94000000-0000-0000-0000-0000000000e1', '2026-12-26 04:30+00', '2026-12-26 06:30+00', 'Registration and tea', 'Main gate');
  begin insert into public.event_programme (event_id, starts_at, ends_at, title) values ('94000000-0000-0000-0000-0000000000e1', now(), now() - interval '1 hour', 'Backwards'); assert false, 'end after start';
  exception when check_violation then null; end;
  a := public.post_announcement('94000000-0000-0000-0000-0000000000e1', 'Parking', 'Please use gate 2 for parking.', true);
  insert into t values ('ann', a.id);
  begin perform public.post_announcement('94000000-0000-0000-0000-0000000000e1', 'x', 'short', false); assert false, 'title length';
  exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'announcement' and user_id = '94000000-0000-0000-0000-00000000000a'), 'registered member told';
  assert not exists (select 1 from public.notifications where kind = 'announcement' and user_id in ('94000000-0000-0000-0000-00000000000b', '94000000-0000-0000-0000-00000000000c')), 'cancelled and outsiders not told';
  assert exists (select 1 from public.admin_audit where action = 'post_announcement'), 'audited';
end $$;

-- who can read what
select pg_temp.login('94000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_announcements) = 1, 'registered member reads announcements';
  assert (select count(*) from public.event_programme) = 1, 'programme of the published event only';
  begin insert into public.event_programme (event_id, starts_at, title) values ('94000000-0000-0000-0000-0000000000e1', now(), 'Mine'); assert false, 'members cannot edit the programme';
  exception when insufficient_privilege then null; end;
  begin perform public.post_announcement('94000000-0000-0000-0000-0000000000e1', 'Spam title', 'Spam body text', false); assert false, 'members cannot announce';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('94000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin assert (select count(*) from public.event_announcements) = 0, 'cancelled registrations do not read announcements'; end $$;
reset role;
select pg_temp.login('94000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_announcements) = 0, 'outsiders do not read announcements';
  assert (select count(*) from public.event_programme) = 1, 'but the programme is public';
end $$;
reset role;
set local role anon;
do $$ begin
  assert (select count(*) from public.event_programme) = 1, 'anon sees the published programme';
  begin perform count(*) from public.event_announcements; assert false, 'anon may not even query announcements';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('94000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_announcements) = 1, 'team reads announcements';
  begin insert into public.event_programme (event_id, starts_at, title) values ('94000000-0000-0000-0000-0000000000e1', now(), 'Volunteer edit'); assert false, 'volunteers do not edit';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL PROGRAMME TESTS PASSED';
rollback;
