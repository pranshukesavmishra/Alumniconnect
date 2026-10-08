-- Regression tests for the independent security review (findings 1–14). Rolls back.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-00000000000a', 'a@example.com', '{"full_name": "Asha"}'),
  ('10000000-0000-0000-0000-00000000000b', 'b@example.com', '{"full_name": "Bharat"}'),
  ('10000000-0000-0000-0000-00000000000c', 'c@example.com', '{"full_name": "Chitra Admin"}'),
  ('10000000-0000-0000-0000-00000000000e', 'e@example.com', '{"full_name": "Eve Other Manager"}');
update public.profiles set is_admin = true where id = '10000000-0000-0000-0000-00000000000c';

insert into public.events (id, slug, title, is_published, capacity) values
  ('10000000-0000-0000-0000-0000000000e1', 'reg-test-1', 'E1', true, 3),
  ('10000000-0000-0000-0000-0000000000e2', 'reg-test-2', 'E2', true, null);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration, sort) values
  ('10000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true, 1, 1),
  ('10000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000e1', 'Child', 0, false, 4, 2),
  ('10000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000e1', 'Spouse', 100000, false, 1, 3);
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-00000000000e', 'manager');

create temp table t (k text primary key, v uuid);
grant select, insert, update on t to authenticated;

-- #1 re-registering after a cancel works
select pg_temp.login('10000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  r := public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Asha", "phone": "9000000001"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
  perform public.cancel_my_registration(r.id);
  r := public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Asha", "phone": "9000000001"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "10000000-0000-0000-0000-0000000000f2", "quantity": 1}]');
  assert r.status = 'pending_payment', '#1 re-register after cancel: ' || r.status;
  insert into t values ('asha_reg', r.id);
  insert into t select 'asha_pay', (public.submit_upi_payment(r.id, '111111111111', null, null)).id;
  assert (select status from public.event_registrations where id = r.id) = 'under_review', '#1 can pay after re-register';
end $$;
reset role;

-- #2 capacity is enforced at payment time (capacity 3: Asha holds 2)
select pg_temp.login('10000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  r := public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Bharat", "phone": "9000000002"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
  insert into t values ('bharat_reg', r.id);
  -- Bharat (1) fits; then he tries to grow to 2 while unpaid: 2 + 2 > 3
  begin
    perform public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Bharat", "phone": "9000000002"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "10000000-0000-0000-0000-0000000000f3", "quantity": 1}]');
    assert false, '#2 capacity at registration';
  exception when raise_exception then null; end;
  -- #5 cannot claim Asha's UTR
  begin
    perform public.submit_upi_payment(r.id, '111111111111', null, null);
    assert false, '#5 UTR reuse';
  exception when raise_exception then null; end;
  -- #10 unverified member sees only own profile
  assert (select count(*) from public.profiles) = 1, '#10 directory hidden from unverified';
end $$;
reset role;

-- #4 manager of another event cannot see payments or proofs of this event
insert into storage.objects (bucket_id, name, owner) values ('payment-proofs', '10000000-0000-0000-0000-00000000000a/proof.jpg', '10000000-0000-0000-0000-00000000000a');
update public.event_payments set proof_path = '10000000-0000-0000-0000-00000000000a/proof.jpg' where id = (select v from t where k = 'asha_pay');
select pg_temp.login('10000000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_payments) = 0, '#4 other-event manager sees no payments';
  assert (select count(*) from storage.objects where bucket_id = 'payment-proofs') = 0, '#4 other-event manager sees no proofs';
end $$;
reset role;

-- #6 / #7 staff function guards, and the admin can read the proof
select pg_temp.login('10000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  assert (select count(*) from storage.objects where bucket_id = 'payment-proofs') = 1, 'admin reads proof';
  begin
    perform public.review_payment((select v from t where k = 'asha_pay'), null, null);
    assert false, '#6 null approve';
  exception when raise_exception then null; end;
  begin
    perform public.review_payment((select v from t where k = 'asha_pay'), false, '  ');
    assert false, '#6 reject needs reason';
  exception when raise_exception then null; end;
  r := public.review_payment((select v from t where k = 'asha_pay'), false, 'UTR not found in bank statement');
  assert r.status = 'pending_payment' and r.admin_note like 'UTR not found%', '#6 reject reopens payment';
  begin
    perform public.review_payment((select v from t where k = 'asha_pay'), true, null);
    assert false, '#6 cannot approve a rejected payment';
  exception when raise_exception then null; end;
  begin
    perform public.record_offline_payment((select v from t where k = 'bharat_reg'), 'upi', 100000, null);
    assert false, '#7 upi not allowed offline';
  exception when raise_exception then null; end;
  begin
    perform public.record_offline_payment((select v from t where k = 'bharat_reg'), 'cash', 999999, null);
    assert false, '#7 amount over due';
  exception when raise_exception then null; end;
  begin
    perform public.record_offline_payment((select v from t where k = 'bharat_reg'), 'waiver', null, null);
    assert false, '#7 waiver needs a note';
  exception when raise_exception then null; end;
  r := public.record_offline_payment((select v from t where k = 'bharat_reg'), 'cash', 40000, 'Partial cash at desk');
  assert r.status = 'pending_payment', '#7 partial cash';
end $$;
reset role;

-- #5 the same registration may resubmit a rejected UTR; #11 cannot cancel with money received
select pg_temp.login('10000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  perform public.submit_upi_payment((select v from t where k = 'asha_reg'), '111111111111', null, null);
  assert (select status from public.event_registrations where id = (select v from t where k = 'asha_reg')) = 'under_review', '#5 own rejected UTR resubmitted';
end $$;
reset role;
select pg_temp.login('10000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin
    perform public.cancel_my_registration((select v from t where k = 'bharat_reg'));
    assert false, '#11 cancel with partial payment';
  exception when raise_exception then null; end;
end $$;
reset role;

-- #12 confirmed: ticket mix and name are fixed; terms time is kept
select pg_temp.login('10000000-0000-0000-0000-00000000000c');
set local role authenticated;
select public.review_payment((select id from public.event_payments where utr = '111111111111' and status = 'submitted'), true, null);
reset role;
select pg_temp.login('10000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.event_registrations; t0 timestamptz;
begin
  select terms_accepted_at into t0 from public.event_registrations where id = (select v from t where k = 'asha_reg');
  begin
    -- same headcount and amount (child 0 -> 0), different mix: swap Child for Child? use Spouse instead of Child
    perform public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Asha", "phone": "9000000001"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
    assert false, '#12 mix change after confirmation';
  exception when raise_exception then null; end;
  r := public.upsert_registration('10000000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Someone Else", "phone": "9000000009", "food_pref": "veg"}',
       '[{"ticket_type_id": "10000000-0000-0000-0000-0000000000f2", "quantity": 1}, {"ticket_type_id": "10000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
  assert r.status = 'confirmed' and r.full_name = 'Asha' and r.food_pref = 'veg' and r.phone = '9000000009', '#12 name fixed, preferences editable';
  assert r.terms_accepted_at = t0, '#12 terms time kept';
end $$;
reset role;

-- #8 deleting a member with a registration is refused (financial records stay)
do $$ begin
  begin
    delete from auth.users where id = '10000000-0000-0000-0000-00000000000a';
    assert false, '#8 delete should be restricted';
  exception when foreign_key_violation then null; end;
  -- deleting the admin who reviewed payments works and keeps the payments
  delete from public.event_staff where user_id = '10000000-0000-0000-0000-00000000000c';
end $$;

-- #9 photo paths must be in the uploader's folder; moderation by managers only
select pg_temp.login('10000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin
    insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path)
    values ('10000000-0000-0000-0000-0000000000e1', auth.uid(), 'someone-else/x.webp', 'someone-else/x_t.webp');
    assert false, '#9 foreign path';
  exception when check_violation then null; end;
  insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path)
  values ('10000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/p.webp', auth.uid() || '/p_t.webp');
  insert into t select 'photo', id from public.event_photos limit 1;
  begin
    update public.event_photos set is_hidden = false;
    assert false, '#9 uploader cannot change is_hidden';
  exception when insufficient_privilege then null; end;
  begin
    perform public.moderate_photo((select v from t where k = 'photo'), true);
    assert false, '#9 member cannot moderate';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- #13 explicit grants: anon cannot see registrations; #3 stats count confirmed only
set local role anon;
do $$ begin
  begin
    perform 1 from public.event_registrations;
    assert false, '#13 anon has no access to registrations';
  exception when insufficient_privilege then null; end;
  assert (public.event_public_stats('10000000-0000-0000-0000-0000000000e1') ->> 'registered')::int = 1, '#3 stats count confirmed only';
end $$;
reset role;

select 'ALL REVIEW REGRESSION TESTS PASSED' as result;
rollback;
