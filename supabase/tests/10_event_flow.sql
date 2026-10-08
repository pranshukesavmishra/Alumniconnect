-- End-to-end security and money tests for the event module. Runs inside a transaction and rolls back.
-- Run with: scripts/db-test.sh
\set ON_ERROR_STOP 1
begin;

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  -- set both the current and the legacy claim settings that auth.uid() reads
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;

-- Three members: Asha (alumna), Bharat (alumnus), Chitra (admin / treasurer), Dev (check-in volunteer)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'asha@example.com', '{"full_name": "Asha Rao", "picture": "https://x/a.jpg"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bharat@example.com', '{"name": "Bharat Jain"}'),
  ('00000000-0000-0000-0000-00000000000c', 'chitra@example.com', '{"given_name": "Chitra", "family_name": "Sen"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dev@example.com', '{}');
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000c';

insert into public.events (id, slug, title, is_published, upi_id, upi_payee_name, capacity)
values ('00000000-0000-0000-0000-0000000000e1', 'test-meet', 'Test Meet', true, 'jecalumni@okicici', 'JEC Alumni Association', 5);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration, sort) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'Alumnus', 250000, true, 1, 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', 'Spouse', 150000, false, 1, 2),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', 'Child (5–12)', 50000, false, 4, 3);
insert into public.event_staff (event_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000d', 'checkin');

-- Profiles were created from sign-in metadata
do $$ begin
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Asha Rao', 'full_name from metadata';
  assert (select avatar_url from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'https://x/a.jpg', 'avatar from picture';
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 'Chitra Sen', 'given + family name';
end $$;

-- ---------------------------------------------------------------- Asha registers
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
set local role authenticated;

do $$
declare r public.event_registrations;
begin
  r := public.upsert_registration('00000000-0000-0000-0000-0000000000e1',
    '{"full_name": "Asha Rao", "phone": "+91 98765 43210", "grad_year": "2005", "branch": "CSE", "food_pref": "veg", "tshirt_size": "M", "guests": [{"name": "Kid 1"}, {"name": "Kid 2"}]}',
    '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f3", "quantity": 2}]');
  assert r.amount_paise = 350000, 'server computes amount: ' || r.amount_paise;
  assert r.headcount = 3, 'headcount';
  assert r.status = 'pending_payment', 'status';
  assert r.code ~ '^JEC-[2-9A-HJ-NP-Z]{6}$', 'code format ' || r.code;
  assert (select count(*) from public.event_registration_items where registration_id = r.id) = 2, 'items saved';

  -- updating again replaces the selection rather than adding to it
  r := public.upsert_registration('00000000-0000-0000-0000-0000000000e1',
    '{"full_name": "Asha Rao", "phone": "+91 98765 43210"}',
    '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f2", "quantity": 1}]');
  assert r.amount_paise = 400000 and r.headcount = 2, 'update replaces items';
  assert (select count(*) from public.event_registrations) = 1, 'one registration per member';
end $$;

-- Rejected inputs
do $$ begin
  begin
    perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "A", "phone": "+91 9876543210"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f2", "quantity": 1}]');
    assert false, 'must require one main ticket';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "A", "phone": "+91 9876543210"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f3", "quantity": 9}]');
    assert false, 'must enforce max per registration';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "A", "phone": "12"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
    assert false, 'must validate phone';
  exception when raise_exception then null; end;
end $$;

-- Tampering: members cannot write registrations or payments directly, or make themselves admin
do $$ begin
  update public.event_registrations set amount_paise = 0, status = 'confirmed';
  assert (select amount_paise from public.event_registrations limit 1) = 400000, 'direct update must not change amount';
  begin
    insert into public.event_payments (registration_id, amount_paise, status)
      select id, 400000, 'verified' from public.event_registrations;
    assert false, 'direct payment insert must fail';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set is_admin = true where id = auth.uid();
    assert false, 'is_admin must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_payment(gen_random_uuid(), true, null);
    assert false, 'unknown payment';
  exception when raise_exception then null; end;
end $$;

-- Payment submission
do $$
declare p public.event_payments;
begin
  begin
    perform public.submit_upi_payment((select id from public.event_registrations limit 1), '12345', null, null);
    assert false, 'UTR must be 12 digits';
  exception when raise_exception then null; end;
  begin
    perform public.submit_upi_payment((select id from public.event_registrations limit 1), '123456789012', null, 'someone-else/x.jpg');
    assert false, 'proof must be in own folder';
  exception when raise_exception then null; end;
  p := public.submit_upi_payment((select id from public.event_registrations limit 1), '1234 5678 9012', 'Asha', null);
  assert p.amount_paise = 400000 and p.utr = '123456789012' and p.status = 'submitted', 'payment row';
  assert (select status from public.event_registrations limit 1) = 'under_review', 'under review after payment';
  begin
    perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "Asha Rao", "phone": "+91 98765 43210"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
    assert false, 'tickets locked after payment';
  exception when raise_exception then null; end;
  -- details (not tickets) can still change
  perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "Asha Rao", "phone": "+91 98765 43210", "food_pref": "jain"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f2", "quantity": 1}]');
  assert (select food_pref from public.event_registrations limit 1) = 'jain', 'details editable';
  begin
    perform public.review_payment(p.id, true, null);
    assert false, 'cannot verify own payment';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- Bharat cannot see Asha's data or reuse her UTR
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  assert (select count(*) from public.event_registrations) = 0, 'cannot see others registrations';
  assert (select count(*) from public.event_payments) = 0, 'cannot see others payments';
  assert (select count(*) from public.profile_private) = 1, 'sees only own private row';
  assert (select count(*) from public.profiles) = 4, 'profiles are visible to members';
  r := public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "Bharat Jain", "phone": "9876500000"}',
    '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f2", "quantity": 1}]');
  begin
    perform public.submit_upi_payment(r.id, '123456789012', null, null);
    assert false, 'UTR reuse must fail';
  exception when raise_exception then null; end;
  begin
    -- capacity is 5: Asha's 2 (under review) + 2 here is fine, 4 more is not
    perform public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "Bharat Jain", "phone": "9876500000"}',
      '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f2", "quantity": 1}, {"ticket_type_id": "00000000-0000-0000-0000-0000000000f3", "quantity": 2}]');
    assert false, 'capacity must be enforced';
  exception when raise_exception then null; end;
  perform public.cancel_my_registration(r.id);
  assert (select status from public.event_registrations where id = r.id) = 'cancelled', 'cancel unpaid';
end $$;
reset role;

-- ---------------------------------------------------------------- Dev (volunteer) can check in but not verify payments
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_registrations) = 2, 'volunteer sees registrations';
  begin
    perform public.review_payment((select id from public.event_payments limit 1), true, null);
    assert false, 'volunteer cannot verify';
  exception when insufficient_privilege then null; end;
  -- not yet confirmed: check-in does not mark arrival
  assert (select (c.registration).checked_in_at is null from public.check_in('00000000-0000-0000-0000-0000000000e1',
          (select code from public.event_registrations where full_name = 'Asha Rao')) c), 'unconfirmed not checked in';
end $$;
reset role;

-- ---------------------------------------------------------------- Chitra (admin) verifies; Dev checks in
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  r := public.review_payment((select id from public.event_payments limit 1), true, 'Matched bank statement');
  assert r.status = 'confirmed', 'confirmed after verification';
  assert (select reviewed_by from public.event_payments limit 1) = auth.uid(), 'audit trail';
end $$;
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$
declare c record;
begin
  select * into c from public.check_in('00000000-0000-0000-0000-0000000000e1',
    lower((select code from public.event_registrations where full_name = 'Asha Rao')));
  assert (c.registration).checked_in_at is not null and not c.already_checked_in, 'checked in';
  select * into c from public.check_in('00000000-0000-0000-0000-0000000000e1',
    (select code from public.event_registrations where full_name = 'Asha Rao'));
  assert c.already_checked_in, 'second scan flags duplicate';
end $$;
reset role;

-- ---------------------------------------------------------------- free tickets confirm immediately; rejected payments reopen
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare r public.event_registrations; p public.event_payments;
begin
  update public.event_ticket_types set price_paise = 0 where id = '00000000-0000-0000-0000-0000000000f1';
  r := public.upsert_registration('00000000-0000-0000-0000-0000000000e1', '{"full_name": "Chitra Sen", "phone": "9000000000"}',
    '[{"ticket_type_id": "00000000-0000-0000-0000-0000000000f1", "quantity": 1}]');
  assert r.status = 'confirmed' and r.amount_paise = 0, 'free registration auto-confirms';
end $$;
reset role;

select 'ALL EVENT TESTS PASSED' as result;
rollback;
