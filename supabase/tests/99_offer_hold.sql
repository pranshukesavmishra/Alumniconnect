-- A place offered from the waiting list is held for 48 hours; an expired offer holds nothing; the offered person is not blocked. Rolls back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('99b00000-0000-0000-0000-0000000000a1', 'h@o99.com', '{"full_name":"Holder"}'),
  ('99b00000-0000-0000-0000-0000000000a2', 'w@o99.com', '{"full_name":"Waiter"}'),
  ('99b00000-0000-0000-0000-0000000000a3', 'x@o99.com', '{"full_name":"Other"}');
insert into public.events (id, slug, title, is_published, upi_id, capacity) values ('99b00000-0000-0000-0000-0000000000e1', 'hold-one', 'Hold One', true, 'jec@okhdfc', 2);
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
  ('99b00000-0000-0000-0000-0000000000d1', '99b00000-0000-0000-0000-0000000000e1', '99b00000-0000-0000-0000-0000000000a1', 'JEC-HD0001', 'Holder', '+91 98765 00001', 'confirmed', 1, 0);
insert into public.event_waitlist (event_id, user_id, headcount, status, offered_at) values
  ('99b00000-0000-0000-0000-0000000000e1', '99b00000-0000-0000-0000-0000000000a2', 1, 'offered', now());

do $$ begin
  -- someone else cannot take the held place
  begin
    perform public._assert_capacity('99b00000-0000-0000-0000-0000000000e1', null, 1);
    -- no registration, no auth user: treated as "someone else"
    assert false, 'the held place was taken';
  exception when others then
    assert sqlerrm like '%being held for people on the waiting list%', 'refused with the right message: ' || sqlerrm;
  end;
  -- an offer older than 48 hours holds nothing
  update public.event_waitlist set offered_at = now() - interval '49 hours' where user_id = '99b00000-0000-0000-0000-0000000000a2';
  perform public._assert_capacity('99b00000-0000-0000-0000-0000000000e1', null, 1);
  -- the offered person is not blocked by their own offer
  update public.event_waitlist set offered_at = now() where user_id = '99b00000-0000-0000-0000-0000000000a2';
  insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
    ('99b00000-0000-0000-0000-0000000000d2', '99b00000-0000-0000-0000-0000000000e1', '99b00000-0000-0000-0000-0000000000a2', 'JEC-HD0002', 'Waiter', '+91 98765 00002', 'pending_payment', 1, 0);
  update public.event_waitlist set status = 'offered' where user_id = '99b00000-0000-0000-0000-0000000000a2'; -- (the registration trigger marked it registered)
  perform public._assert_capacity('99b00000-0000-0000-0000-0000000000e1', '99b00000-0000-0000-0000-0000000000d2', 1);
end $$;
select 'ALL OFFER HOLD TESTS PASSED';
rollback;
