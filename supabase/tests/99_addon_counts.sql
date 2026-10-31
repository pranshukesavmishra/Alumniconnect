-- Optional extras with their OWN counts, independent of the family on the main ticket, plus optional names. Rolls back.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  v_event uuid; v_alumnus uuid; v_spouse uuid; v_child uuid; v_tour uuid;
  p jsonb; msg text; u uuid; r public.event_registrations;
begin
  insert into public.events (slug, title, starts_at, ends_at)
    values ('addonc-' || substr(gen_random_uuid()::text, 1, 6), 'Addon counts', '2026-12-26 10:00+05:30', '2026-12-27 18:00+05:30') returning id into v_event;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Alumnus', 400000, true, 1, 1, '{1}') returning id into v_alumnus;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Family Member', 50000, false, 1, 2, '{1}') returning id into v_spouse;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Child', 30000, false, 4, 3, '{1}') returning id into v_child;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, is_addon, max_per_registration, sort, days)
    values (v_event, 'Outdoor 27 Dec', 65000, false, true, 6, 4, '{2}') returning id into v_tour;
  insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise, available) values (v_tour, v_child, v_event, 35000, true);

  -- 0 family on the 26th, 3 adults + 2 children on the extra (+ me): per-type prices, correct total
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 3, 'names', jsonb_build_array('A One', ' ', 'C Three')),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 0)));
  assert (p ->> 'total')::int = 400000 + 65000 + 3 * 65000, 'adults at the default price: ' || (p ->> 'total');
  assert (select l -> 'names' from jsonb_array_elements(p -> 'lines') l where l ->> 'for' = v_spouse::text) = '["A One","C Three"]'::jsonb, 'blank names dropped';

  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 3),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 2)));
  assert (p ->> 'total')::int = 400000 + 3 * 65000 + 2 * 35000, 'per-type prices: ' || (p ->> 'total');
  assert (p ->> 'heads')::int = 5, 'capacity counts the 5 extra-only people: ' || (p ->> 'heads');
  assert p -> 'day_heads' = '{"1":1,"2":5}'::jsonb, 'day 2 sees all 5: ' || (p ->> 'day_heads');
  assert (select count(*) from jsonb_array_elements(p -> 'lines') l where l -> 'names' = '[]'::jsonb) = 3, 'no names by default';

  -- people on both days are not counted twice for capacity
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_child, 'quantity', 2),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 2)));
  assert (p ->> 'heads')::int = 4 and p -> 'day_heads' = '{"1":4,"2":3}'::jsonb, 'family on both days: ' || (p ->> 'heads') || ' ' || (p ->> 'day_heads');

  -- exceeding the maximum (per line and in total) is refused
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 7)));
    assert false, 'above max per line';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'You can choose at most 6%', msg;
  end;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 4),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 2)));
    assert false, 'above max in total';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'You can choose at most 6%', msg;
  end;
  -- Me is at most 1
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 2)));
    assert false, 'Me twice';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like '%main person%', msg;
  end;
  -- an unavailable person type is still refused; an extra still needs a main ticket
  update public.event_addon_prices set available = false where addon_id = v_tour and ticket_type_id = v_child;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
    assert false, 'unavailable';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like '%is not available for%', msg;
  end;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 1)));
    assert false, 'needs a main ticket';
  exception when raise_exception then null; end;
  update public.event_addon_prices set available = true where addon_id = v_tour and ticket_type_id = v_child;

  -- legacy untyped extra rows keep their default price
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 2)));
  assert (p ->> 'total')::int = 400000 + 2 * 65000, 'legacy: ' || (p ->> 'total');

  -- saved through the real function: names kept on the item row
  u := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data) values (u, 'addonc-' || substr(u::text, 1, 6) || '@x.com', '{"full_name":"Addon Counts"}');
  update public.profiles set onboarded = true where id = u;
  update public.profile_private set phone = '+91 98765 43210' where id = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;
  reset role; update public.events set is_published = true, upi_id = 'jecalumni@okicici', upi_payee_name = 'JEC Alumni' where id = v_event; set local role authenticated;
  r := public.upsert_registration(v_event, '{"accept_terms": true, "full_name": "Addon Counts", "food_pref": "veg", "tshirt_size": "M", "needs_accommodation": false}'::jsonb,
    jsonb_build_array(jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 2, 'names', jsonb_build_array('Guest Two', ''))));
  assert r.amount_paise = 400000 + 2 * 65000 and r.headcount = 2, 'saved total/headcount: ' || r.amount_paise || '/' || r.headcount;
  assert (select names from public.event_registration_items where registration_id = r.id and for_ticket_type_id = v_spouse) = '["Guest Two"]'::jsonb, 'names stored';
  assert r.day_heads = '{"1":1,"2":2}'::jsonb, 'day heads stored: ' || r.day_heads::text;
  reset role;
  raise notice 'ALL ADDON COUNT TESTS PASSED';
end $$;
rollback;
