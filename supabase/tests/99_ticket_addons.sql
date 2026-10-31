-- Optional add-on tickets: price calculation, day rules, headcount and day heads. Rolls back.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  v_event uuid; v_d1 uuid; v_both uuid; v_spouse uuid; v_child uuid; v_tour uuid; v_g2 uuid;
  p jsonb;
  msg text;
begin
  insert into public.events (slug, title, starts_at, ends_at)
    values ('addon-test-' || substr(gen_random_uuid()::text, 1, 6), 'Addon test', '2026-12-26 10:00+05:30', '2026-12-27 18:00+05:30') returning id into v_event;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Alumnus day 1', 250000, true, 1, 1, '{1}') returning id into v_d1;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Both days', 400000, true, 1, 2, null) returning id into v_both;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Spouse', 50000, false, 1, 3, '{1}') returning id into v_spouse;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Child', 50000, false, 4, 4, '{1}') returning id into v_child;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, is_addon, max_per_registration, sort, days)
    values (v_event, 'Outdoor tour', 65000, false, true, 10, 5, '{2}') returning id into v_tour;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, max_per_registration, sort, days)
    values (v_event, 'Day 2 guest', 100000, false, 4, 6, '{2}') returning id into v_g2;

  begin
    update public.event_ticket_types set is_primary = true where id = v_tour;
    assert false, 'add-on main must be rejected';
  exception when check_violation then null; end;

  -- alumnus alone + 1 add-on
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 1)));
  assert (p ->> 'total')::int = 315000, 'alumnus + 1 tour total';
  assert (p ->> 'heads')::int = 1, 'heads exclude add-ons';
  assert p -> 'day_heads' = '{"1":1,"2":1}'::jsonb, 'day heads union: ' || (p ->> 'day_heads');
  assert p -> 'days' = '[1]'::jsonb, 'main days unchanged';

  -- alumnus + spouse + 2 children with 3 add-ons
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1),
    jsonb_build_object('ticket_type_id', v_child, 'quantity', 2), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 3)));
  assert (p ->> 'total')::int = 250000 + 50000 + 100000 + 195000, 'family + 3 tours total';
  assert (p ->> 'heads')::int = 4, 'family heads 4';
  assert p -> 'day_heads' = '{"1":4,"2":3}'::jsonb, 'family day heads: ' || (p ->> 'day_heads');

  -- 0 add-ons
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 0)));
  assert (p ->> 'total')::int = 250000 and p -> 'day_heads' = '{"1":1,"2":0}'::jsonb, 'zero add-ons';

  -- both-days main plus add-on: day 2 counts main + add-on
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_both, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 1)));
  assert p -> 'day_heads' = '{"1":1,"2":2}'::jsonb, 'both-days main plus add-on';

  -- add-on people are independent of the ticket: 2 add-on people with 1 main person are allowed and count as attendees
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_tour, 'quantity', 2)));
  assert (p ->> 'heads')::int = 2 and p -> 'day_heads' = '{"1":1,"2":2}'::jsonb, 'extra-only people counted: ' || (p ->> 'heads');

  -- max_per_registration still applies
  update public.event_ticket_types set max_per_registration = 2 where id = v_tour;
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_child, 'quantity', 4),
      jsonb_build_object('ticket_type_id', v_tour, 'quantity', 3)));
    assert false, 'above max must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like 'You can choose at most 2%', 'max message: ' || msg;
  end;
  update public.event_ticket_types set max_per_registration = 10 where id = v_tour;

  -- add-on without a main ticket refused
  begin
    perform public._price_items(v_event, jsonb_build_array(jsonb_build_object('ticket_type_id', v_tour, 'quantity', 1)));
    assert false, 'add-on alone must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%exactly one main%', 'main message: ' || msg;
  end;

  -- a normal day-2 guest with a day-1 main ticket is still refused
  begin
    perform public._price_items(v_event, jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_g2, 'quantity', 1)));
    assert false, 'day-2 guest with day-1 main must be rejected';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like '%is only for%', 'day message: ' || msg;
  end;

  -- a plain day-1 guest still works
  p := public._price_items(v_event, jsonb_build_array(
    jsonb_build_object('ticket_type_id', v_d1, 'quantity', 1), jsonb_build_object('ticket_type_id', v_spouse, 'quantity', 1)));
  assert (p ->> 'heads')::int = 2 and (p ->> 'total')::int = 300000, 'plain guest unchanged';

  raise notice 'ALL TICKET ADD-ON TESTS PASSED';
end $$;
rollback;
