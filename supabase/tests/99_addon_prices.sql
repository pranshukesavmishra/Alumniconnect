-- Optional extras priced per person type: overrides, unavailable types, counts per type, default fallback, legacy rows. Rolls back.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  v_event uuid; v_alumnus uuid; v_spouse uuid; v_child uuid; v_tour uuid; v_dinner uuid; v_other_event uuid; v_other_tt uuid;
  p jsonb;
  msg text;
  u uuid; r uuid;
  function_text text;
begin
  insert into public.events (slug, title, starts_at, ends_at)
    values ('addonp-' || substr(gen_random_uuid()::text, 1, 6), 'Addon price test', '2026-12-26 10:00+05:30', '2026-12-27 18:00+05:30') returning id into v_event;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Alumnus', 400000, true, 1, 1, null) returning id into v_alumnus;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Spouse', 50000, false, 1, 2, null) returning id into v_spouse;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Child', 30000, false, 4, 3, null) returning id into v_child;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, is_addon, max_per_registration, sort, days)
    values (v_event, 'Outdoor tour', 65000, false, true, 10, 4, '{2}') returning id into v_tour;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, is_addon, max_per_registration, sort, days)
    values (v_event, 'Gala dinner', 100000, false, true, 10, 5, '{1}') returning id into v_dinner;

  -- overrides: child 350, spouse not available; alumnus has none (default 650)
  insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise, available) values (v_tour, v_child, v_event, 35000, true);
  insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise, available) values (v_tour, v_spouse, v_event, null, false);

  -- validation trigger: wrong kinds / other events are refused
  begin
    insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise) values (v_child, v_alumnus, v_event, 1);
    assert false, 'override on a non-extra must be rejected';
  exception when raise_exception then null; end;
  begin
    insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise) values (v_tour, v_dinner, v_event, 1);
    assert false, 'override for an extra person type must be rejected';
  exception when raise_exception then null; end;
  begin
    insert into public.event_addon_prices (addon_id, ticket_type_id, event_id, price_paise) values (v_tour, v_child, v_event, -5);
    assert false, 'negative price must be rejected';
  exception when check_violation then null; end;

  -- alumnus (default 650) + child (350) + spouse without the tour
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_child, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
  assert (p ->> 'total')::int = 400000 + 50000 + 30000 + 65000 + 35000, 'total with two typed tours: ' || (p ->> 'total');
  assert (p ->> 'heads')::int = 3, 'heads exclude extras';
  assert p -> 'day_heads' = '{"1":3,"2":5}'::jsonb, 'day heads count each ticked person: ' || (p ->> 'day_heads');
  assert (select count(*) from jsonb_array_elements(p -> 'lines') l where (l ->> 'addon')::boolean) = 2, 'two extra lines';
  assert exists (select 1 from jsonb_array_elements(p -> 'lines') l where l ->> 'for' = v_child::text and (l ->> 'price')::int = 35000 and l ->> 'label' = 'Outdoor tour (Child)'), 'child line price and label';

  -- free for a person type (0 is a real price, not "use the default")
  update public.event_addon_prices set price_paise = 0 where addon_id = v_tour and ticket_type_id = v_child;
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_child, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
  assert (p ->> 'total')::int = 400000 + 30000, 'free for children: ' || (p ->> 'total');
  update public.event_addon_prices set price_paise = 35000 where addon_id = v_tour and ticket_type_id = v_child;

  -- spouse cannot take the tour
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_spouse, 'quantity', 1)));
    assert false, 'unavailable person type must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%is not available for%', 'unavailable message: ' || msg;
  end;

  -- the spouse can still take a different extra that has no override
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_dinner, 'for_ticket_type_id', v_spouse, 'quantity', 1)));
  assert (p ->> 'total')::int = 400000 + 50000 + 100000, 'default fallback for an extra without an override';

  -- count per person type must not exceed the people of that type (2 children tours with 1 child)
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_child, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 2)));
    assert false, 'more child tours than children must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%one per person%', 'per type message: ' || msg;
  end;
  -- ... but a tour for a person type that is not in the registration at all is refused too
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
    assert false, 'a tour for an absent person type must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%one per person%', 'absent type message: ' || msg;
  end;
  -- the main alumnus counts as one person of the main ticket type
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 2)));
    assert false, 'two tours for one alumnus must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%one per person%', 'alumnus message: ' || msg;
  end;

  -- total extras of one kind never exceed the people (alumnus + 1 child = 2, three lines of 1 each is impossible anyway)
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
    assert false, 'more extras than people must be rejected';
  exception when raise_exception then null; end;

  -- same extra twice for the same person type is a malformed selection
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1)));
    assert false, 'duplicate must be rejected';
  exception when raise_exception then null; end;

  -- a person type given on a normal ticket, an unknown person type, or another event's ticket is refused
  select id into v_other_event from public.events where id <> v_event limit 1;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'for_ticket_type_id', v_alumnus, 'quantity', 1)));
    assert false, 'for on a normal ticket must be rejected';
  exception when raise_exception then null; end;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', gen_random_uuid(), 'quantity', 1)));
    assert false, 'unknown person type must be rejected';
  exception when raise_exception then null; end;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_dinner, 'quantity', 1)));
    assert false, 'an extra as person type must be rejected';
  exception when raise_exception then null; end;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', 'not-a-uuid', 'quantity', 1)));
    assert false, 'malformed person type must be rejected';
  exception when raise_exception then null; end;

  -- max per registration applies to the extra over all person types together
  update public.event_ticket_types set max_per_registration = 1 where id = v_tour;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_child, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_alumnus, 'quantity', 1),
      jsonb_build_object('ticket_type_id', v_tour, 'for_ticket_type_id', v_child, 'quantity', 1)));
    assert false, 'above the overall max must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like 'You can choose at most 1%', 'max message: ' || msg;
  end;
  update public.event_ticket_types set max_per_registration = 10 where id = v_tour;

  -- legacy item without a person type: default price, one per person
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_child, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'quantity', 2)));
  assert (p ->> 'total')::int = 400000 + 30000 + 2 * 65000, 'legacy untyped extras use the default price: ' || (p ->> 'total');
  assert exists (select 1 from jsonb_array_elements(p -> 'lines') l where (l ->> 'addon')::boolean and l ->> 'for' is null and l ->> 'label' = 'Outdoor tour'), 'legacy label unchanged';
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 2)));
    assert false, 'legacy: more than the people must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%one per person%', 'legacy message: ' || msg;
  end;

  -- an override never changes a normal ticket price and the unavailable flag only matters for typed lines
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_alumnus, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_tour, 'quantity', 1)));
  assert (p ->> 'total')::int = 400000 + 50000 + 65000, 'untyped extra ignores overrides';

  -- items table: two rows of one extra (one per person type) next to a legacy untyped row
  u := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data) values (u, 'addonp-' || substr(u::text, 1, 6) || '@x.com', '{"full_name":"Addon Price"}');
  begin
    insert into public.event_registrations (event_id, user_id, code, full_name, phone, status)
      values (v_event, u, 'JEC-' || substr(u::text, 1, 6), 'Addon Price', '+91 98765 43210', 'pending_payment') returning id into r;
    insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity) values (r, v_tour, 'Outdoor tour', 65000, 1);
    insert into public.event_registration_items (registration_id, ticket_type_id, for_ticket_type_id, label, unit_price_paise, quantity) values (r, v_tour, v_child, 'Outdoor tour (Child)', 35000, 1);
    assert (select sum(unit_price_paise * quantity) from public.event_registration_items where registration_id = r) = 100000, 'item amounts add up';
    begin
      insert into public.event_registration_items (registration_id, ticket_type_id, for_ticket_type_id, label, unit_price_paise, quantity) values (r, v_tour, v_child, 'dup', 1, 1);
      assert false, 'same extra and person type twice must be rejected';
    exception when unique_violation then null; end;
    begin
      insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity) values (r, v_tour, 'dup', 1, 1);
      assert false, 'two untyped rows of one extra must be rejected';
    exception when unique_violation then null; end;
  end;

  -- the register functions carry the person type
  select pg_get_functiondef('public.upsert_registration(uuid,jsonb,jsonb)'::regprocedure) into function_text;
  assert function_text like '%for_ticket_type_id%', 'upsert_registration stores the person type';
  select pg_get_functiondef(p.oid) into function_text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_update_registration';
  assert function_text like '%for_ticket_type_id%', 'admin_update_registration stores the person type';

  raise notice 'ALL ADDON PRICE TESTS PASSED';
end $$;
rollback;
