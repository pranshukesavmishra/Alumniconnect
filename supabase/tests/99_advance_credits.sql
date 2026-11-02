-- Advance payments made before the app: import, matching (phone / email / name + batch + branch), ambiguity, single use,
-- amount due, admin apply / remove / void, privacy, ledger. Fake people only (example.com, made-up numbers). Rolls back.
\set ON_ERROR_STOP 1
-- the same normalisation vectors the vitest suite checks against src/features/events/advance.ts
\set vectors `cat src/features/events/advanceVectors.json`
begin;
select set_config('adv.vectors', :'vectors', true);

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t99adv_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end;
$$;
grant execute on function public.t99adv_fails(text) to authenticated, anon;

do $$
declare
  j jsonb := current_setting('adv.vectors')::jsonb;
  x jsonb;
begin
  for x in select * from jsonb_array_elements(j -> 'phone') loop
    assert public._adv_phone(x ->> 0) is not distinct from x ->> 1, 'phone ' || (x ->> 0) || ' -> ' || coalesce(public._adv_phone(x ->> 0), 'null');
  end loop;
  for x in select * from jsonb_array_elements(j -> 'email') loop
    assert public._adv_email(x ->> 0) is not distinct from x ->> 1, 'email ' || (x ->> 0);
  end loop;
  for x in select * from jsonb_array_elements(j -> 'name') loop
    assert public._adv_name(x ->> 0) = x ->> 1, 'name ' || (x ->> 0) || ' -> ' || public._adv_name(x ->> 0);
  end loop;
  for x in select * from jsonb_array_elements(j -> 'name_first_last') loop
    assert public._adv_name_fl(x ->> 0) is not distinct from x ->> 1, 'first/last ' || (x ->> 0);
  end loop;
  for x in select * from jsonb_array_elements(j -> 'branch') loop
    assert public._adv_branch(x ->> 0) = x ->> 1, 'branch ' || (x ->> 0) || ' -> ' || public._adv_branch(x ->> 0);
  end loop;
end $$;

-- a0 admin, b0 treasurer of the event, 01..09 members
insert into auth.users (id, email, raw_user_meta_data) values
  ('99ad0000-0000-0000-0000-0000000000a0', 'adv-admin@example.com', '{"full_name":"Adv Admin"}'),
  ('99ad0000-0000-0000-0000-0000000000b0', 'adv-treasurer@example.com', '{"full_name":"Adv Treasurer"}'),
  ('99ad0000-0000-0000-0000-000000000001', 'phone.person@example.com', '{"full_name":"Phone Person"}'),
  ('99ad0000-0000-0000-0000-000000000002', 'mail.person@example.com', '{"full_name":"Mail Person"}'),
  ('99ad0000-0000-0000-0000-000000000003', 'name.person@example.com', '{"full_name":"Naman Kumar Pathak"}'),
  ('99ad0000-0000-0000-0000-000000000004', 'batch.person@example.com', '{"full_name":"Batch Person"}'),
  ('99ad0000-0000-0000-0000-000000000005', 'twin.person@example.com', '{"full_name":"Twin Person"}'),
  ('99ad0000-0000-0000-0000-000000000006', 'second.person@example.com', '{"full_name":"Phone Person"}'),
  ('99ad0000-0000-0000-0000-000000000007', 'big.person@example.com', '{"full_name":"Big Advance"}'),
  ('99ad0000-0000-0000-0000-000000000008', 'nobody.person@example.com', '{"full_name":"Nobody Special"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', city = 'Jabalpur', country = 'India'
 where id::text like '99ad0000-%';
update public.profiles set is_admin = true where id = '99ad0000-0000-0000-0000-0000000000a0';
update public.profiles set grad_year = 2008, branch = 'B.E. in Electronics & Telecommunications' where id in ('99ad0000-0000-0000-0000-000000000001', '99ad0000-0000-0000-0000-000000000006');
update public.profiles set grad_year = 2007, branch = 'B.E. in Civil Engineering' where id = '99ad0000-0000-0000-0000-000000000002';
update public.profiles set grad_year = 2009, branch = 'B.E. in Electronics & Telecommunications' where id = '99ad0000-0000-0000-0000-000000000003';
update public.profiles set grad_year = 2011, branch = 'B.E. in Computer Science & Engineering' where id = '99ad0000-0000-0000-0000-000000000004';
update public.profiles set grad_year = 2005, branch = 'B.E. in Information Technology' where id = '99ad0000-0000-0000-0000-000000000005';
update public.profiles set grad_year = 2006, branch = 'B.E. in Mechanical Engineering' where id in ('99ad0000-0000-0000-0000-000000000007', '99ad0000-0000-0000-0000-000000000008');
update public.profile_private set phone = '+91 90000 00001' where id = '99ad0000-0000-0000-0000-000000000001';
update public.profile_private set phone = '+91 90000 00002' where id = '99ad0000-0000-0000-0000-000000000002';
update public.profile_private set phone = '+91 90000 00003' where id = '99ad0000-0000-0000-0000-000000000003';
update public.profile_private set phone = '+91 90000 00004' where id = '99ad0000-0000-0000-0000-000000000004';
update public.profile_private set phone = '+91 90000 00005' where id = '99ad0000-0000-0000-0000-000000000005';
update public.profile_private set phone = '+91 90000 00006' where id = '99ad0000-0000-0000-0000-000000000006';
update public.profile_private set phone = '+91 90000 00007' where id = '99ad0000-0000-0000-0000-000000000007';
update public.profile_private set phone = '+91 90000 00008' where id = '99ad0000-0000-0000-0000-000000000008';

insert into public.events (id, slug, title, is_published, upi_id, upi_payee_name, starts_at) values
  ('99ad0000-0000-0000-0000-0000000000e1', 'adv-test', 'Advance Test', true, 'jecalumni@okicici', 'JEC Alumni', '2026-12-26 10:00+05:30');
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration, sort) values
  ('99ad0000-0000-0000-0000-0000000000f1', '99ad0000-0000-0000-0000-0000000000e1', 'Alumnus', 200000, true, 1, 0);
insert into public.event_staff (event_id, user_id, role) values
  ('99ad0000-0000-0000-0000-0000000000e1', '99ad0000-0000-0000-0000-0000000000b0', 'treasurer');

-- a member registers first, BEFORE the list is imported (matched at import time)
select pg_temp.login('99ad0000-0000-0000-0000-000000000007');
set local role authenticated;
select public.upsert_registration('99ad0000-0000-0000-0000-0000000000e1', '{"accept_terms": true, "full_name": "Big Advance"}',
  '[{"ticket_type_id": "99ad0000-0000-0000-0000-0000000000f1", "quantity": 1}]');
reset role;

do $$
declare
  ev constant uuid := '99ad0000-0000-0000-0000-0000000000e1';
  tix constant jsonb := '[{"ticket_type_id": "99ad0000-0000-0000-0000-0000000000f1", "quantity": 1}]';
  res jsonb;
  r public.event_registrations;
  n int;
  pay public.event_payments;
  v_credit uuid;
  msg text;
begin
  -- a member cannot import
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000008');
  set local role authenticated;
  assert public.t99adv_fails($q$select public.admin_add_advance_credits('99ad0000-0000-0000-0000-0000000000e1', '[{"full_name":"X Y","phone":"9000000099","amount_paise":50000}]')$q$) like '%Only people who handle payments%', 'member import refused';
  reset role;

  -- the treasurer imports the advance list (the event's own role is enough)
  perform pg_temp.login('99ad0000-0000-0000-0000-0000000000b0');
  set local role authenticated;
  res := public.admin_add_advance_credits(ev, jsonb_build_array(
    jsonb_build_object('full_name', 'Phone Person', 'grad_year', 2008, 'branch', 'ETC', 'phone', '098765 00001', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Someone Else', 'phone', '+91 90000 00001', 'amount_paise', 50000), -- entered by mistake, voided below
    jsonb_build_object('full_name', 'Mail Person', 'email', ' Mail.Person @Example.com ', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Dr. Naman K. Pathak', 'grad_year', 2009, 'branch', 'Electronics and Telecommunication Engineering', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Batch Person', 'grad_year', 2010, 'branch', 'CSE', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Twin Person', 'grad_year', 2005, 'branch', 'IT', 'phone', '+91 91111 00005', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Twin  Person', 'grad_year', 2005, 'branch', 'Information Technology', 'phone', '+91 92222 00005', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Big Advance', 'grad_year', 2006, 'branch', 'Mech', 'phone', '+91 90000 00007', 'amount_paise', 300000),
    jsonb_build_object('full_name', 'No Key', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'Zero Amount', 'phone', '+91 93333 00009', 'amount_paise', 0)), 'Google Form');
  reset role;
  assert (res ->> 'added')::int = 8, 'added: ' || res::text;
  assert jsonb_array_length(res -> 'rejected') = 2, 'rejected: ' || (res -> 'rejected')::text;
  assert (res ->> 'applied')::int = 1, 'the member who registered before the import got their advance: ' || res::text;
  select * into r from public.event_registrations where user_id = '99ad0000-0000-0000-0000-000000000007' and event_id = ev;
  assert r.advance_paise = 300000 and r.amount_paise = 200000, 'big advance applied, total unchanged';
  assert r.status = 'confirmed', 'advance covers more than the price: confirmed without UPI, got ' || r.status;
  assert exists (select 1 from public.event_advance_credits where claimed_registration_id = r.id and claimed_by = 'auto' and match_reason = 'phone'), 'claimed by phone';

  -- the same list again: everything is a duplicate
  perform pg_temp.login('99ad0000-0000-0000-0000-0000000000a0');
  set local role authenticated;
  res := public.admin_add_advance_credits(ev, jsonb_build_array(
    jsonb_build_object('full_name', 'Phone Person', 'grad_year', 2008, 'branch', 'ETC', 'phone', '+919876500001', 'amount_paise', 50000),
    jsonb_build_object('full_name', 'MAIL person', 'email', 'mail.person@example.com', 'amount_paise', 50000)));
  assert (res ->> 'added')::int = 0 and jsonb_array_length(res -> 'duplicates') = 2, 're-import is safe: ' || res::text;
  select id into v_credit from public.event_advance_credits where event_id = ev and full_name = 'Someone Else';
  perform public.admin_void_advance_credit(v_credit, 'Entered twice by mistake');
  assert (select status from public.event_advance_credits where id = v_credit) = 'void', 'voided';
  assert public.t99adv_fails(format('select public.admin_void_advance_credit(%L, %L)', v_credit, 'again')) like '%already void%', 'void twice';
  reset role;

  -- (a) phone: the registration phone is on the list (the profile phone was the voided row)
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000001');
  set local role authenticated;
  assert public.my_advance_credit(ev) = '{"state": "expected", "amount_paise": 50000}'::jsonb, 'expected before registering (name + batch + branch)';
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Phone Person", "phone": "+91 98765 00001"}', tix);
  assert r.advance_paise = 50000 and r.amount_paise = 200000 and r.status = 'pending_payment', 'phone match: ' || r.advance_paise || ' ' || r.status;
  assert public.my_advance_credit(ev) = '{"state": "applied", "amount_paise": 50000}'::jsonb, 'member sees applied advance';
  -- members cannot read the list, or the admin functions
  assert (select count(*) from public.event_advance_credits) = 0, 'members cannot read credits';
  assert public.t99adv_fails($q$select public.admin_advance_credits('99ad0000-0000-0000-0000-0000000000e1')$q$) like '%Only people who handle payments%', 'member list refused';
  assert public.t99adv_fails($q$select public._claim_advance_credit(gen_random_uuid())$q$) like '%permission denied%', 'internal claim not callable';
  -- saving again does not apply a second advance
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Phone Person", "phone": "+91 98765 00001"}', tix);
  assert r.advance_paise = 50000, 'once only on re-save';
  assert (select count(*) from public.event_payments where registration_id = r.id and method = 'advance') = 1, 'one advance payment';
  -- due = total - 500: the UPI payment is for the rest
  pay := public.submit_upi_payment(r.id, '123456789012', 'Phone Person', null);
  assert pay.amount_paise = 150000, 'UPI amount is the amount due: ' || pay.amount_paise;
  reset role;
  -- the treasurer verifies the due amount: confirmed
  perform pg_temp.login('99ad0000-0000-0000-0000-0000000000b0');
  set local role authenticated;
  r := public.review_payment(pay.id, true, null);
  assert r.status = 'confirmed', 'confirmed after the due amount: ' || r.status;
  reset role;

  -- (b) email with spaces and capitals on the list; the sign-in email matches
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000002');
  set local role authenticated;
  assert public.my_advance_credit(ev) = '{"state": "expected", "amount_paise": 50000}'::jsonb, 'expected before registering: ' || coalesce(public.my_advance_credit(ev)::text, 'null');
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Mail Person"}', tix);
  assert r.advance_paise = 50000, 'email match';
  reset role;
  assert (select match_reason from public.event_advance_credits where claimed_registration_id = r.id) = 'email', 'matched by email';

  -- (c) name + batch + branch: "Dr. Naman K. Pathak / Electronics and Telecommunication Engineering" vs the app's label
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000003');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Naman Kumar Pathak"}', tix);
  assert r.advance_paise = 50000, 'name + batch + branch match';
  reset role;
  assert (select match_reason from public.event_advance_credits where claimed_registration_id = r.id) = 'name', 'matched by name';

  -- batch differs: no match
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000004');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Batch Person"}', tix);
  assert r.advance_paise = 0 and not r.advance_review, 'batch differs: nothing applied';
  assert public.my_advance_credit(ev) is null, 'no advance shown';
  reset role;

  -- two open credits match: not applied, flagged for review
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000005');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Twin Person"}', tix);
  assert r.advance_paise = 0 and r.advance_review, 'ambiguous: flagged, not applied';
  assert public.my_advance_credit(ev) ->> 'state' = 'review', 'member sees "being checked"';
  reset role;

  -- a second registration that matches an already-claimed credit (same name, batch, branch as Phone Person) gets nothing
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000006');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Phone Person"}', tix);
  assert r.advance_paise = 0, 'a claimed credit is never used twice';
  reset role;

  -- a member without any advance
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000008');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Nobody Special"}', tix);
  assert r.advance_paise = 0 and not r.advance_review and r.status = 'pending_payment', 'no credit';
  reset role;

  -- admin: candidates, apply manually, remove, dismiss
  perform pg_temp.login('99ad0000-0000-0000-0000-0000000000a0');
  set local role authenticated;
  select * into r from public.event_registrations where user_id = '99ad0000-0000-0000-0000-000000000005' and event_id = ev;
  res := public.admin_advance_candidates(r.id);
  assert jsonb_array_length(res) = 2 and res -> 0 ->> 'match' = 'name', 'two candidates: ' || res::text;
  assert jsonb_array_length(public.admin_advance_credits(ev) -> 'review') = 1, 'one registration needs review';
  r := public.admin_apply_advance_credit(r.id, (res -> 0 ->> 'id')::uuid, 'Checked with the treasurer');
  assert r.advance_paise = 50000 and r.advance_manual and not r.advance_review, 'applied by admin';
  assert public.t99adv_fails(format('select public.admin_apply_advance_credit(%L, %L, null)', r.id, (res -> 1 ->> 'id'))) like '%already has an advance%', 'one advance per registration';
  assert public.t99adv_fails(format('select public.admin_void_advance_credit(%L, %L)', (res -> 0 ->> 'id'), 'try')) like '%applied to a registration%', 'cannot void a claimed credit';
  r := public.admin_remove_advance_credit(r.id, 'Wrong person');
  assert r.advance_paise = 0 and r.advance_manual, 'removed';
  assert (select status from public.event_advance_credits where id = (res -> 0 ->> 'id')::uuid) = 'open', 'credit open again';
  assert not exists (select 1 from public.event_payments where registration_id = r.id and method = 'advance'), 'advance payment gone';
  assert (select count(*) from public.admin_audit where action in ('apply_advance_credit', 'remove_advance_credit', 'void_advance_credit', 'add_advance_credits')) >= 4, 'audited';
  reset role;
  -- after an admin decision, saving again does not auto-apply
  perform pg_temp.login('99ad0000-0000-0000-0000-000000000005');
  set local role authenticated;
  r := public.upsert_registration(ev, '{"accept_terms": true, "full_name": "Twin Person"}', tix);
  assert r.advance_paise = 0 and not r.advance_review, 'admin decision sticks';
  reset role;

  -- a check-in volunteer's view of a registration hides the advance
  assert (public._sanitized_registration(r)).advance_paise = 0, 'sanitised';

  -- ledger: the advance money counts as received (offline), with its own total and method line
  perform pg_temp.login('99ad0000-0000-0000-0000-0000000000a0');
  set local role authenticated;
  res := public.admin_event_ledger(ev);
  assert (res -> 'totals' ->> 'advance')::int = 300000 + 50000 * 3, 'advance total: ' || (res -> 'totals')::text;
  assert (res -> 'totals' ->> 'verified')::int = 300000 + 50000 * 3 + 150000, 'verified includes advance + UPI: ' || (res -> 'totals')::text;
  assert exists (select 1 from jsonb_array_elements(res -> 'by_method') m where m ->> 'method' = 'advance' and (m ->> 'verified')::int = 450000), 'by method';
  assert (res -> 'position' ->> 'outstanding')::int = 4 * 200000 + 2 * 150000, 'outstanding uses the due amounts: ' || (res -> 'position')::text;
  assert exists (select 1 from jsonb_array_elements(res -> 'flags') f where f ->> 'kind' = 'overpaid' and (f ->> 'amount_paise')::int = 100000), 'overpaid advance flagged';
  -- refund logic sees the advance: the extra Rs 1000 can be refunded from the advance payment
  select p.* into pay from public.event_payments p join public.event_registrations g on g.id = p.registration_id
   where g.user_id = '99ad0000-0000-0000-0000-000000000007' and p.method = 'advance';
  r := public.admin_record_refund(pay.id, 100000, 'upi', null, 'Advance was more than the ticket');
  assert r.status = 'confirmed', 'still confirmed after refunding the extra';
  select * into r from public.event_registrations where user_id = '99ad0000-0000-0000-0000-000000000007' and event_id = ev;
  assert public.t99adv_fails(format('select public.admin_remove_advance_credit(%L, %L)', r.id, 'oops')) like '%refunded%', 'cannot remove a refunded advance';
  reset role;
  raise notice 'ALL ADVANCE CREDIT TESTS PASSED';
end $$;
rollback;
