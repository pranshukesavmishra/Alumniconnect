-- Admin console functions and audit log. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-00000000000a', 'm@example.com', '{"full_name": "Member"}'),
  ('30000000-0000-0000-0000-00000000000c', 'a@example.com', '{"full_name": "Admin"}');
update public.profiles set is_admin = true where id = '30000000-0000-0000-0000-00000000000c';
insert into public.events (id, slug, title, is_published) values ('30000000-0000-0000-0000-0000000000e1', 'admin-test', 'T', true);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration) values
  ('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true, 1),
  ('30000000-0000-0000-0000-0000000000f2', '30000000-0000-0000-0000-0000000000e1', 'Spouse', 50000, false, 1);
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

select pg_temp.login('30000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  insert into t select 'reg', (public.upsert_registration('30000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Member", "phone": "9000000001"}',
       '[{"ticket_type_id": "30000000-0000-0000-0000-0000000000f1", "quantity": 1}]')).id;
  begin perform public.admin_update_member('30000000-0000-0000-0000-00000000000a', '{"city": "X"}', null); assert false, 'member cannot use admin fn';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_registration((select v from t where k='reg'), null, null, 'x'); assert false, 'member cannot edit regs';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.admin_audit) = 0, 'members cannot read audit';
  perform public.save_my_linkedin_import('{"headline": "Engineer", "skills": ["A","B"], "linkedin_url": "javascript:alert(1)"}',
    '[{"title": "SDE", "company": "X", "is_current": true, "start_date": "2020-01-01"}]', '[{"school": "JEC", "start_year": 2001, "end_year": 2005}]');
  assert (select headline from public.profiles where id = auth.uid()) = 'Engineer', 'import headline';
  assert (select linkedin_url from public.profiles where id = auth.uid()) is null, 'bad url rejected';
  assert (select count(*) from public.experiences where profile_id = auth.uid()) = 1, 'import exp';
  perform public.save_my_linkedin_import('{}', '[]', '[]');
  assert (select count(*) from public.experiences where profile_id = auth.uid()) = 0, 'reimport replaces';
end $$;
reset role;

select pg_temp.login('30000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  perform public.admin_update_member('30000000-0000-0000-0000-00000000000a', '{"city": "Indore", "grad_year": 2005}', '+91 90000 00009');
  assert (select city from public.profiles where id = '30000000-0000-0000-0000-00000000000a') = 'Indore', 'admin edits profile';
  assert (select phone from public.profile_private where id = '30000000-0000-0000-0000-00000000000a') = '+91 90000 00009', 'admin edits phone';
  begin perform public.admin_update_member('30000000-0000-0000-0000-00000000000a', '{"is_admin": true}', null); assert false, 'flags not via this fn';
  exception when raise_exception then null; end;
  begin perform public.admin_set_member(auth.uid(), false, null); assert false, 'cannot remove own admin';
  exception when raise_exception then null; end;
  begin perform public.admin_update_registration((select v from t where k='reg'), null, null, ' '); assert false, 'reason required';
  exception when raise_exception then null; end;
  -- pay by cash, then add a spouse: confirmed -> pending for the balance
  perform public.record_offline_payment((select v from t where k='reg'), 'cash', 100000, 'desk');
  assert (select status from public.event_registrations where id = (select v from t where k='reg')) = 'confirmed', 'cash confirms';
  r := public.admin_update_registration((select v from t where k='reg'), '{"food_pref": "veg"}',
       '[{"ticket_type_id": "30000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "30000000-0000-0000-0000-0000000000f2", "quantity": 1}]', 'Spouse joining');
  assert r.amount_paise = 150000 and r.headcount = 2 and r.status = 'pending_payment' and r.food_pref = 'veg', 'edit re-prices: ' || r.status;
  r := public.admin_set_registration_status(r.id, true, 'Refunded at member request');
  assert r.status = 'cancelled', 'cancel';
  r := public.admin_set_registration_status(r.id, false, 'Changed mind');
  assert r.status = 'pending_payment', 'reopen';
  assert (select count(*) from public.admin_audit) = 5, 'audited (member edit, cash, registration edit, cancel, reopen): ' || (select count(*) from public.admin_audit);
  assert exists (select 1 from public.admin_audit where action = 'record_cash'), 'payment audit trigger';
end $$;
reset role;

-- contact lookup, skills, configuration audit
select pg_temp.login('30000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.admin_member_email('30000000-0000-0000-0000-00000000000a'); assert false, 'members cannot look up emails';
  exception when insufficient_privilege then null; end;
  begin update public.events set title = 'Hijacked' where id = '30000000-0000-0000-0000-0000000000e1'; assert (select title from public.events where id = '30000000-0000-0000-0000-0000000000e1') = 'T', 'members cannot edit events';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('30000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare n0 int;
begin
  assert public.admin_member_email('30000000-0000-0000-0000-00000000000a') = 'm@example.com', 'admin sees email';
  assert exists (select 1 from public.admin_audit where action = 'view_member_email'), 'email lookups are logged';
  perform public.admin_update_member('30000000-0000-0000-0000-00000000000a', '{"headline": "Cloud architect", "about": "Hi", "linkedin_url": "https://www.linkedin.com/in/m", "website_url": "https://m.example.com", "country": "India", "skills": ["Go", " AWS ", ""]}'::jsonb);
  assert (select skills from public.profiles where id = '30000000-0000-0000-0000-00000000000a') = array['Go', 'AWS'], 'skills saved clean';
  assert (select headline from public.profiles where id = '30000000-0000-0000-0000-00000000000a') = 'Cloud architect', 'headline saved';
  n0 := (select count(*) from public.admin_audit);
  update public.events set title = 'Alumni Meet' where id = '30000000-0000-0000-0000-0000000000e1';
  update public.event_ticket_types set price_paise = 120000 where id = '30000000-0000-0000-0000-0000000000f1';
  insert into public.event_staff (event_id, user_id, role) values ('30000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-00000000000a', 'checkin');
  assert (select count(*) from public.admin_audit) = n0 + 3, 'event, ticket and team changes are audited';
  assert exists (select 1 from public.admin_audit where action = 'events_update' and details -> 'changed' ? 'title'), 'changed fields recorded';
end $$;
reset role;
select 'ALL ADMIN TESTS PASSED';
rollback;
