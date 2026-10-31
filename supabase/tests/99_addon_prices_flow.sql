-- Optional extras by person type through the real registration functions: saved rows, totals, payment lock, admin edit. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('99100000-0000-0000-0000-00000000000a', 'adp-a@example.com', '{"full_name":"Alum Price"}'),
  ('99100000-0000-0000-0000-0000000000ff', 'adp-admin@example.com', '{"full_name":"Admin Price"}');
update public.profiles set onboarded = true where id::text like '99100000-%';
update public.profile_private set phone = '+91 98765 43210' where id = '99100000-0000-0000-0000-00000000000a';
update public.profiles set is_admin = true where id = '99100000-0000-0000-0000-0000000000ff';

insert into public.events (id, slug, title, is_published, upi_id, upi_payee_name, starts_at, ends_at)
values ('99100000-0000-0000-0000-0000000000e1', 'adp-flow', 'Flow', true, 'jecalumni@okicici', 'JEC Alumni', '2026-12-26 10:00+05:30', '2026-12-27 18:00+05:30');
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, is_addon, max_per_registration, sort, days) values
  ('99100000-0000-0000-0000-0000000000a1', '99100000-0000-0000-0000-0000000000e1', 'Alumnus', 400000, true, false, 1, 1, null),
  ('99100000-0000-0000-0000-0000000000a2', '99100000-0000-0000-0000-0000000000e1', 'Spouse', 50000, false, false, 1, 2, null),
  ('99100000-0000-0000-0000-0000000000a3', '99100000-0000-0000-0000-0000000000e1', 'Child', 30000, false, false, 4, 3, null),
  ('99100000-0000-0000-0000-0000000000b1', '99100000-0000-0000-0000-0000000000e1', 'Outdoor tour', 65000, false, true, 10, 4, '{2}');
insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise, available) values
  ('99100000-0000-0000-0000-0000000000b1', '99100000-0000-0000-0000-0000000000a3', '99100000-0000-0000-0000-0000000000e1', 35000, true),
  ('99100000-0000-0000-0000-0000000000b1', '99100000-0000-0000-0000-0000000000a2', '99100000-0000-0000-0000-0000000000e1', null, false);
create temp table t (k text primary key, v uuid);
grant select, insert, update on t to authenticated;

create function pg_temp.d() returns jsonb language sql as $$
  select '{"accept_terms": true, "full_name": "Alum Price", "food_pref": "veg", "tshirt_size": "M", "needs_accommodation": false}'::jsonb;
$$;
create function pg_temp.i(p_tour_alumnus int, p_tour_child int, p_children int default 1, p_spouse int default 1) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000a1', 'quantity', 1),
    jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000a2', 'quantity', p_spouse),
    jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000a3', 'quantity', p_children),
    jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000b1', 'for_ticket_type_id', '99100000-0000-0000-0000-0000000000a1', 'quantity', p_tour_alumnus),
    jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000b1', 'for_ticket_type_id', '99100000-0000-0000-0000-0000000000a3', 'quantity', p_tour_child));
$$;
grant execute on function pg_temp.d(), pg_temp.i(int, int, int, int) to authenticated;

select pg_temp.login('99100000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  -- alumnus + spouse + child; tour for alumnus (650) and child (350)
  r := public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(1, 1));
  assert r.amount_paise = 400000 + 50000 + 30000 + 65000 + 35000, 'server total: ' || r.amount_paise;
  assert r.headcount = 3, 'headcount excludes extras';
  assert (select count(*) from public.event_registration_items where registration_id = r.id) = 5, 'five item rows';
  assert (select sum(unit_price_paise * quantity) from public.event_registration_items where registration_id = r.id) = r.amount_paise, 'rows add up to the total';
  assert exists (select 1 from public.event_registration_items where registration_id = r.id and for_ticket_type_id = '99100000-0000-0000-0000-0000000000a3' and unit_price_paise = 35000 and label = 'Outdoor tour (Child)'), 'child row';
  assert exists (select 1 from public.event_registration_items where registration_id = r.id and for_ticket_type_id = '99100000-0000-0000-0000-0000000000a1' and unit_price_paise = 65000), 'alumnus row at the default price';
  insert into t values ('reg', r.id);

  -- spouse cannot have it
  begin
    perform public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(1, 1) || jsonb_build_array(jsonb_build_object('ticket_type_id', '99100000-0000-0000-0000-0000000000b1', 'for_ticket_type_id', '99100000-0000-0000-0000-0000000000a2', 'quantity', 1)));
    assert false, 'unavailable for spouse';
  exception when raise_exception then assert sqlerrm like '%is not available for%', sqlerrm; end;
  -- a refused save leaves the earlier one untouched
  assert (select amount_paise from public.event_registrations where id = r.id) = 580000, 'refused save changes nothing';

  -- the organiser changes the child price: new saves use it, and removing a tick re-prices
  r := public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(0, 1));
  assert r.amount_paise = 400000 + 50000 + 30000 + 35000 and (select count(*) from public.event_registration_items where registration_id = r.id) = 4, 'only the child tour';
end $$;

-- a registration saved before this migration has an untyped extra row: make one and re-open it
reset role;
  update public.event_registration_items set for_ticket_type_id = null, unit_price_paise = 65000, label = 'Outdoor tour'
   where registration_id = (select v from t where k = 'reg') and ticket_type_id = '99100000-0000-0000-0000-0000000000b1';
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  assert (select count(*) from public.event_registration_items where registration_id = (select v from t where k = 'reg') and for_ticket_type_id is null and ticket_type_id = '99100000-0000-0000-0000-0000000000b1') = 1, 'legacy row in place';
  r := public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(1, 1));
  assert r.amount_paise = 580000, 're-saving with typed ticks replaces the legacy row';

  -- pay, then the ticket mix (including who has the tour) is locked
  perform public.submit_upi_payment(r.id, '991234567890', 'Alum', null);
  r := public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(1, 1));
  assert r.status = 'under_review' and r.amount_paise = 580000, 'same ticks after payment are accepted';
  begin
    perform public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(0, 1));
    assert false, 'dropping a tick after payment';
  exception when raise_exception then assert sqlerrm like '%tickets can no longer be changed%', sqlerrm; end;
  begin
    perform public.upsert_registration('99100000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.i(1, 1, 1, 0) || jsonb_build_array());
    assert false, 'changing people after payment';
  exception when raise_exception then assert sqlerrm like '%tickets can no longer be changed%', sqlerrm; end;
end $$;

-- the organiser edits on the member's behalf (typed extras kept, re-priced on the server)
reset role;
select pg_temp.login('99100000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  r := public.admin_update_registration((select v from t where k = 'reg'), null, pg_temp.i(1, 0, 1, 1), 'Child will not come to the tour');
  assert r.amount_paise = 400000 + 50000 + 30000 + 65000, 'admin re-priced: ' || r.amount_paise;
  assert (select count(*) from public.event_registration_items where registration_id = r.id and for_ticket_type_id is not null) = 1, 'typed row kept';
  begin
    perform public.admin_update_registration(r.id, null, pg_temp.i(1, 1, 1, 1) || '[]'::jsonb, 'Check the limits');
    assert true;
  end;
  -- two child tours with one child are fine now (counts are independent of the family)
  r := public.admin_update_registration(r.id, null, pg_temp.i(0, 2, 1, 1), 'Two child tours');
  assert r.amount_paise = 400000 + 50000 + 30000 + 70000, 'independent child tours: ' || r.amount_paise;
end $$;
reset role;
do $$ begin raise notice 'ALL ADDON PRICE FLOW TESTS PASSED'; end $$;
rollback;
