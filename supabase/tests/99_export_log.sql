-- Event data downloads are logged; only organisers can log them. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t99x_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end;
$$;
grant execute on function public.t99x_fails(text) to authenticated, anon;
insert into auth.users (id, email, raw_user_meta_data) values
  ('99a00000-0000-0000-0000-0000000000d1', 'c@x99.com', '{"full_name":"Exp Content"}'),
  ('99a00000-0000-0000-0000-0000000000a1', 'a@x99.com', '{"full_name":"Exp Admin"}'),
  ('99a00000-0000-0000-0000-0000000000b1', 'v@x99.com', '{"full_name":"Exp Volunteer"}'),
  ('99a00000-0000-0000-0000-0000000000c1', 'm@x99.com', '{"full_name":"Exp Member"}');
update public.profiles set onboarded = true, verification = 'verified' where id::text like '99a00000-%';
update public.profiles set is_admin = true where id = '99a00000-0000-0000-0000-0000000000a1';
insert into public.events (id, slug, title, is_published, upi_id) values ('99a00000-0000-0000-0000-0000000000e1', 'exp-one', 'Exp One', true, 'jec@okhdfc');
insert into public.event_staff (event_id, user_id, role) values ('99a00000-0000-0000-0000-0000000000e1', '99a00000-0000-0000-0000-0000000000b1', 'checkin'), ('99a00000-0000-0000-0000-0000000000e1', '99a00000-0000-0000-0000-0000000000d1', 'content');
delete from public.admin_audit where actor::text like '99a00000-%';

select pg_temp.login('99a00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'registrations', 12);
select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'song_requests', 3);
do $$ begin
  assert (select count(*) from public.admin_audit where action = 'export_event_data' and actor = '99a00000-0000-0000-0000-0000000000a1') = 2, 'both downloads are logged';
  assert (select details ->> 'what' from public.admin_audit where action = 'export_event_data' and actor = '99a00000-0000-0000-0000-0000000000a1' and details ->> 'what' = 'registrations') = 'registrations'
     and (select (details ->> 'count')::int from public.admin_audit where action = 'export_event_data' and actor = '99a00000-0000-0000-0000-0000000000a1' and details ->> 'what' = 'registrations') = 12, 'what and how many';
  assert public.t99x_fails($q$select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'everything', 1)$q$) like '%Unknown export%', 'unknown kinds are refused';
end $$;
reset role;

-- a gate volunteer may log the not-arrived list only
select pg_temp.login('99a00000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'not_arrived', 4);
do $$ begin
  assert public.t99x_fails($q$select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'payments', 4)$q$) like '%Only treasurers%', 'volunteer cannot log finance exports';
end $$;
reset role;

-- a content manager runs messages and the programme, not money or phone lists
select pg_temp.login('99a00000-0000-0000-0000-0000000000d1');
set local role authenticated;
do $$ begin
  assert public.t99x_fails($q$select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'registrations', 4)$q$) like '%Only treasurers%', 'content manager cannot log (or make) finance exports';
end $$;
reset role;

-- a plain member and anonymous callers cannot call it at all
select pg_temp.login('99a00000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t99x_fails($q$select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'registrations', 1)$q$) like '%Only event organisers%', 'member refused';
end $$;
reset role;
set local role anon;
do $$ begin
  assert public.t99x_fails($q$select public.admin_log_event_export('99a00000-0000-0000-0000-0000000000e1', 'registrations', 1)$q$) is not null, 'anon refused';
end $$;
reset role;
select 'ALL EXPORT LOG TESTS PASSED';
rollback;
