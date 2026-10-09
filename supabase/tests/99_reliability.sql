-- Reliability: resumable import jobs, idempotent bulk actions, optimistic locking, health. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t99r_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end;
$$;
grant execute on function public.t99r_fails(text) to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('99900000-0000-0000-0000-0000000000a1', 'a@r99.com', '{"full_name":"Rel Admin"}'),
  ('99900000-0000-0000-0000-0000000000b1', 't@r99.com', '{"full_name":"Rel Treasurer"}'),
  ('99900000-0000-0000-0000-0000000000c1', 'm@r99.com', '{"full_name":"Rel Member"}'),
  ('99900000-0000-0000-0000-0000000000c2', 'n@r99.com', '{"full_name":"Rel Pending"}');
update public.profiles set onboarded = true where id::text like '99900000-%';
update public.profiles set verification = 'verified' where id::text like '99900000-0000-0000-0000-0000000000_1';
update public.profiles set verification = 'pending' where id = '99900000-0000-0000-0000-0000000000c2';
update public.profiles set is_admin = true where id = '99900000-0000-0000-0000-0000000000a1';
insert into public.events (id, slug, title, is_published, upi_id) values ('99900000-0000-0000-0000-0000000000e1', 'rel-one', 'Rel One', true, 'jec@okhdfc');
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary) values ('99900000-0000-0000-0000-0000000000f1', '99900000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true);
insert into public.event_staff (event_id, user_id, role) values ('99900000-0000-0000-0000-0000000000e1', '99900000-0000-0000-0000-0000000000b1', 'treasurer');
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
  ('99900000-0000-0000-0000-0000000000d1', '99900000-0000-0000-0000-0000000000e1', '99900000-0000-0000-0000-0000000000c1', 'JEC-RE0001', 'Rel Member', '+91 98765 00001', 'under_review', 1, 100000);
insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity) values
  ('99900000-0000-0000-0000-0000000000d1', '99900000-0000-0000-0000-0000000000f1', 'Alumnus', 100000, 1);
insert into public.event_payments (id, registration_id, amount_paise, method, utr, status) values
  ('99900000-0000-0000-0000-0000000000e9', '99900000-0000-0000-0000-0000000000d1', 100000, 'upi', '999000000001', 'submitted');
delete from public.admin_audit where actor::text like '99900000-%';
insert into public.system_events (kind, ok, detail) values ('backup', true, '2 events');

-- ---------------------------------------------------------------- import jobs
select pg_temp.login('99900000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t99r_fails($q$select public.admin_import_start('[{"full_name":"A B","email":"ab@x.com"}]', true)$q$) is not null, 'member cannot start';
  assert public.t99r_fails($q$select public.admin_import_jobs()$q$) is not null, 'or read jobs';
  assert public.t99r_fails($q$select public.admin_health()$q$) is not null, 'or the health page';
  assert (select count(*) from public.import_jobs) = 0, 'tables are not readable';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.login('99900000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  assert public.t99r_fails($q$select public.admin_import_start('[{"full_name":"A B","email":"ab@x.com"}]', true)$q$) is not null, 'treasurer cannot import members';
  assert public.t99r_fails($q$select public.admin_health()$q$) is not null, 'or see health';
end $$;
reset role;

select pg_temp.login('99900000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare
  j uuid; j2 uuid; again jsonb; c jsonb; r jsonb; s jsonb; req uuid := gen_random_uuid();
  rows jsonb := '[{"line":1,"full_name":"Ann One","email":"ann@x.com"},{"line":2,"full_name":"Bob Two","email":"bob@x.com"},{"line":3,"full_name":"Cy Three","email":"cy@x.com"}]';
begin
  j := public.admin_import_start(rows, true, req);
  j2 := public.admin_import_start(rows, true, req);
  assert j = j2, 'the same request makes one job';
  assert public.t99r_fails($q$select public.admin_import_start('[]', true)$q$) like '%no rows%', 'empty import refused';

  c := public.admin_import_claim(j, 2);
  assert jsonb_array_length(c -> 'rows') = 2 and (c ->> 'verified')::boolean, 'claims two';
  -- the worker finishes one and fails one, then "dies"
  perform public.admin_import_mark((c -> 'rows' -> 0 ->> 'id')::bigint, true, '99900000-0000-0000-0000-0000000000c1');
  perform public.admin_import_mark((c -> 'rows' -> 1 ->> 'id')::bigint, false, null, 'A member with this email already exists.');
  -- resume: the next claim gives the one that was never started, not the finished or failed rows
  r := public.admin_import_claim(j, 10);
  assert jsonb_array_length(r -> 'rows') = 1 and r -> 'rows' -> 0 -> 'payload' ->> 'email' = 'cy@x.com', 'resume picks up where it stopped';
  -- that worker dies too: after two minutes the row is handed out again
  assert jsonb_array_length(public.admin_import_claim(j, 10) -> 'rows') = 0, 'not before two minutes';
  perform set_config('t.j', j::text, true);
  reset role;
  update public.import_job_rows set updated_at = now() - interval '3 minutes' where status = 'processing';
  assert (select count(*) from public.import_jobs) = 1 and (select count(*) from public.import_job_rows) = 3, 'one job, three rows';
  set local role authenticated;
  again := public.admin_import_claim(j, 10);
  assert jsonb_array_length(again -> 'rows') = 1, 'a stuck row is handed out again';
  perform public.admin_import_mark((again -> 'rows' -> 0 ->> 'id')::bigint, true, '99900000-0000-0000-0000-0000000000c2');
  s := (public.admin_import_jobs(j)) -> 0;
  assert (s ->> 'done')::int = 2 and (s ->> 'failed')::int = 1 and (s ->> 'pending')::int = 0, 'progress: ' || s::text;
  assert s -> 'failures' -> 0 ->> 'error' like '%already exists%' and s -> 'failures' -> 0 ->> 'email' = 'bob@x.com', 'failed row is listed with its reason';
  assert public.admin_import_retry(j) = 1, 'retry puts the failed row back';
  assert public.admin_import_retry(j) = 0, 'retrying again changes nothing';
  assert (public.admin_import_jobs(j) -> 0 ->> 'pending')::int = 1, 'pending again';
  assert exists (select 1 from public.admin_audit where action = 'import_job_start'), 'start is logged';
  assert exists (select 1 from public.admin_audit where action = 'import_job_retry'), 'retry is logged';
end $$;

-- ---------------------------------------------------------------- idempotent bulk actions
do $$
declare req uuid := gen_random_uuid(); a jsonb; b jsonb; n0 int; n1 int;
begin
  a := public.admin_bulk_set_verification(array['99900000-0000-0000-0000-0000000000c2']::uuid[], 'verified', null, req);
  assert (a ->> 'changed')::int = 1, 'first run changes one';
  n0 := (select count(*) from public.admin_audit where action = 'set_member_flags');
  b := public.admin_bulk_set_verification(array['99900000-0000-0000-0000-0000000000c2']::uuid[], 'verified', null, req);
  assert (b ->> 'repeated')::boolean and (b ->> 'changed')::int = 1, 'the same request returns the first answer';
  n1 := (select count(*) from public.admin_audit where action = 'set_member_flags');
  assert n0 = n1, 'and logs nothing more';
  b := public.admin_bulk_set_verification(array['99900000-0000-0000-0000-0000000000c2']::uuid[], 'verified');
  assert (b ->> 'changed')::int = 0 and (b ->> 'unchanged')::int = 1, 'a fresh run on the same state changes nothing';

  req := gen_random_uuid();
  a := public.admin_bulk_review_payments(array['99900000-0000-0000-0000-0000000000e9']::uuid[], true, null, req);
  assert (a ->> 'done')::int = 1 and (select status from public.event_payments where id = '99900000-0000-0000-0000-0000000000e9') = 'verified', 'payment verified once';
  b := public.admin_bulk_review_payments(array['99900000-0000-0000-0000-0000000000e9']::uuid[], true, null, req);
  assert (b ->> 'repeated')::boolean, 'repeat returns the stored result';
  b := public.admin_bulk_review_payments(array['99900000-0000-0000-0000-0000000000e9']::uuid[], true);
  assert (b ->> 'unchanged')::int = 1 and (b ->> 'done')::int = 0 and jsonb_array_length(b -> 'failed') = 0, 'already verified is unchanged, not a failure';
end $$;

-- ---------------------------------------------------------------- optimistic lock on registrations
do $$
declare t0 timestamptz; t1 timestamptz;
begin
  select updated_at into t0 from public.event_registrations where id = '99900000-0000-0000-0000-0000000000d1';
  perform public.admin_update_registration('99900000-0000-0000-0000-0000000000d1', '{"food_pref":"jain"}', null, 'first editor', t0);
  select updated_at into t1 from public.event_registrations where id = '99900000-0000-0000-0000-0000000000d1';
  assert public.t99r_fails($q$select public.admin_update_registration('99900000-0000-0000-0000-0000000000d1', '{"food_pref":"veg"}', null, 'second editor', (select updated_at - interval '1 second' from public.event_registrations where id = '99900000-0000-0000-0000-0000000000d1'))$q$) like '%Someone else changed%', 'a stale save is refused with a clear message';
  assert (select food_pref from public.event_registrations where id = '99900000-0000-0000-0000-0000000000d1') = 'jain', 'and changed nothing';
  perform public.admin_update_registration('99900000-0000-0000-0000-0000000000d1', '{"food_pref":"veg"}', null, 'no lock given');
  assert (select food_pref from public.event_registrations where id = '99900000-0000-0000-0000-0000000000d1') = 'veg', 'without a lock value it still works (older clients)';
  assert public.t99r_fails($q$select public.admin_set_registration_status('99900000-0000-0000-0000-0000000000d1', true, 'cancel', false, now() - interval '1 day')$q$) like '%Someone else changed%', 'status change is locked too';
end $$;

-- ---------------------------------------------------------------- health
do $$
declare h jsonb;
begin
  h := public.admin_health();
  assert h -> 'backup' -> 'last' ->> 'detail' = '2 events' and h -> 'backup' -> 'last_ok_at' is not null, 'last backup';
  assert (h ->> 'database_bytes')::bigint > 0 and jsonb_typeof(h -> 'storage') = 'array' and h -> 'push' ? 'subscriptions', 'sizes and push';
  assert (h ->> 'import_unfinished_rows')::int = 1, 'unfinished import rows counted';
end $$;
reset role;

select 'ALL RELIABILITY TESTS PASSED';
rollback;
