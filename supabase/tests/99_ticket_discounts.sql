-- Ticket discounts: list_price_paise must be above the selling price; the label is short; the price a member pays is untouched.
do $$
declare v_event uuid; v_t uuid;
begin
  insert into public.events (slug, title, starts_at) values ('disc-test-' || substr(gen_random_uuid()::text, 1, 6), 'Discount test', now() + interval '30 days') returning id into v_event;
  insert into public.event_ticket_types (event_id, label, price_paise, is_primary, list_price_paise, discount_label)
    values (v_event, 'Early bird', 150000, true, 200000, 'Early bird') returning id into v_t;
  assert (select price_paise from public.event_ticket_types where id = v_t) = 150000, 'selling price kept';

  begin
    update public.event_ticket_types set list_price_paise = 150000 where id = v_t;
    assert false, 'list price equal to price must be rejected';
  exception when check_violation then null; end;
  begin
    update public.event_ticket_types set list_price_paise = 100000 where id = v_t;
    assert false, 'list price below price must be rejected';
  exception when check_violation then null; end;
  begin
    update public.event_ticket_types set discount_label = repeat('x', 41) where id = v_t;
    assert false, 'long label must be rejected';
  exception when check_violation then null; end;
  begin
    update public.event_ticket_types set price_paise = 250000 where id = v_t;
    assert false, 'raising the price above the original must be rejected';
  exception when check_violation then null; end;

  update public.event_ticket_types set list_price_paise = null, discount_label = null where id = v_t;
  assert (select list_price_paise from public.event_ticket_types where id = v_t) is null, 'discount can be removed';
  delete from public.events where id = v_event;
  raise notice 'ALL TICKET DISCOUNT TESTS PASSED';
end $$;
