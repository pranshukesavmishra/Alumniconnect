-- Event operations: targeted messages, finance ledger + refunds, adjustments, waiting list, day-of tools.
-- Who may call what, what really changes, what is logged. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- runs a statement as the current role and returns the error text (null = it worked)
create function public.t97_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end;
$$;
grant execute on function public.t97_fails(text) to authenticated, anon;

-- 0a = admin, 0b = treasurer (manager of e1), 0c = volunteer (check-in of e1), a..h members
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-0000000000a0', 'boss97@x.com', '{"full_name":"Boss Ops"}'),
  ('97000000-0000-0000-0000-0000000000b0', 'treas97@x.com', '{"full_name":"Treasurer Ops"}'),
  ('97000000-0000-0000-0000-0000000000c0', 'vol97@x.com', '{"full_name":"Volunteer Ops"}'),
  ('97000000-0000-0000-0000-00000000000a', 'a97@x.com', '{"full_name":"Asha Quillfeather"}'),
  ('97000000-0000-0000-0000-00000000000b', 'b97@x.com', '{"full_name":"Bela Quillfeather"}'),
  ('97000000-0000-0000-0000-00000000000c', 'c97@x.com', '{"full_name":"Chitra Quillfeather"}'),
  ('97000000-0000-0000-0000-00000000000d', 'd97@x.com', '{"full_name":"Dev Quillfeather"}'),
  ('97000000-0000-0000-0000-00000000000e', 'e97@x.com', '{"full_name":"Esha Quillfeather"}'),
  ('97000000-0000-0000-0000-00000000000f', 'f97@x.com', '{"full_name":"Farid Quillfeather"}'),
  ('97000000-0000-0000-0000-000000000010', 'g97@x.com', '{"full_name":"Gita Quillfeather"}'),
  ('97000000-0000-0000-0000-000000000011', 'h97@x.com', '{"full_name":"Hari Quillfeather"}'),
  ('97000000-0000-0000-0000-000000000012', 'k97@x.com', '{"full_name":"Kavya Quillfeather"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Indore', grad_year = 2001
 where id::text like '97000000-%';
update public.profiles set is_admin = true where id = '97000000-0000-0000-0000-0000000000a0';
update public.profiles set city = 'Zzyx', grad_year = 2003 where id = '97000000-0000-0000-0000-00000000000e';
update public.profiles set verification = 'pending' where id = '97000000-0000-0000-0000-00000000000f';
update public.profile_private set phone = '+91 98765 40001' where id = '97000000-0000-0000-0000-00000000000a';

insert into public.events (id, slug, title, is_published, capacity, eligible_from_year, eligible_to_year) values
  ('97000000-0000-0000-0000-0000000000e1', 'ops-one', 'Ops One', true, 10, 1990, 2020),
  ('97000000-0000-0000-0000-0000000000e2', 'ops-two', 'Ops Two', true, 2, 1990, 2020);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration, sort) values
  ('97000000-0000-0000-0000-0000000000f1', '97000000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true, 1, 0),
  ('97000000-0000-0000-0000-0000000000f2', '97000000-0000-0000-0000-0000000000e1', 'Spouse', 50000, false, 4, 1);
insert into public.event_staff (event_id, user_id, role) values
  ('97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-0000000000b0', 'manager'),
  ('97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-0000000000c0', 'checkin');

-- e1: a unpaid (Pune 2001), b being verified (Indore 2001), c confirmed (Pune 2005), d confirmed x2 + spouse, checked in (2005),
--     g cancelled but holding cash, h confirmed with no verified money, k unpaid (to be transferred)
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise, city, grad_year, branch, checked_in_at) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-00000000000a', 'JEC-OP0001', 'Asha Quillfeather', '+91 98765 40001', 'pending_payment', 1, 100000, 'Pune', 2001, 'CSE', null),
  ('97000000-0000-0000-0000-0000000000a2', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-00000000000b', 'JEC-OP0002', 'Bela Quillfeather', '+91 98765 40002', 'under_review', 1, 100000, 'Indore', 2001, 'CSE', null),
  ('97000000-0000-0000-0000-0000000000a3', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-00000000000c', 'JEC-OP0003', 'Chitra Quillfeather', '+91 98765 40003', 'confirmed', 1, 100000, 'Pune', 2005, 'CSE', null),
  ('97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-00000000000d', 'JEC-OP0004', 'Dev Quillfeather', '+91 98765 40004', 'confirmed', 2, 150000, 'Indore', 2005, 'ECE', now()),
  ('97000000-0000-0000-0000-0000000000a5', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-000000000010', 'JEC-OP0005', 'Gita Quillfeather', '+91 98765 40005', 'cancelled', 1, 100000, 'Indore', 2001, 'CSE', null),
  ('97000000-0000-0000-0000-0000000000a6', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-000000000011', 'JEC-OP0006', 'Hari Quillfeather', '+91 98765 40006', 'confirmed', 1, 100000, 'Indore', 2001, 'CSE', null),
  ('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-000000000012', 'JEC-OP0007', 'Kavya Quillfeather', '+91 98765 40007', 'pending_payment', 1, 100000, 'Indore', 2001, 'CSE', null);
insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-0000000000f1', 'Alumnus', 100000, 1),
  ('97000000-0000-0000-0000-0000000000a3', '97000000-0000-0000-0000-0000000000f1', 'Alumnus', 100000, 1),
  ('97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-0000000000f1', 'Alumnus', 100000, 1),
  ('97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-0000000000f2', 'Spouse', 50000, 1);
insert into public.event_payments (id, registration_id, amount_paise, method, utr, status, reviewed_at) values
  ('97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-0000000000a2', 100000, 'upi', '970000000002', 'submitted', null),
  ('97000000-0000-0000-0000-0000000000b3', '97000000-0000-0000-0000-0000000000a3', 100000, 'upi', '970000000003', 'verified', now()),
  ('97000000-0000-0000-0000-0000000000b4', '97000000-0000-0000-0000-0000000000a4', 150000, 'cash', null, 'verified', now()),
  ('97000000-0000-0000-0000-0000000000b5', '97000000-0000-0000-0000-0000000000a5', 50000, 'cash', null, 'verified', now()),
  ('97000000-0000-0000-0000-0000000000b8', '97000000-0000-0000-0000-0000000000a7', 100000, 'upi', '970000000008', 'submitted', null);
-- a second waiting payment belongs to someone else's event
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
  ('97000000-0000-0000-0000-0000000000a8', '97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-00000000000a', 'JEC-OP0008', 'Asha Other', '+91 98765 40001', 'pending_payment', 1, 100000);
insert into public.event_payments (id, registration_id, amount_paise, method, utr, status) values
  ('97000000-0000-0000-0000-0000000000b9', '97000000-0000-0000-0000-0000000000a8', 100000, 'upi', '970000000009', 'submitted');
delete from public.notifications where user_id::text like '97000000-%';
delete from public.admin_audit where actor::text like '97000000-%';

-- ---------------------------------------------------------------- nobody but managers / volunteers may call anything
select pg_temp.login('97000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    $q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{}')$q$,
    $q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Hello there', 'Body text', '{}')$q$,
    $q$select public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_event_ledger_rows('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_record_refund('97000000-0000-0000-0000-0000000000b3', 100, 'cash', null, 'x y z')$q$,
    $q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-00000000000e', 'because')$q$,
    $q$select public.admin_apply_discount('97000000-0000-0000-0000-0000000000a7', 100, 'because')$q$,
    $q$select public.admin_waitlist('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_run_waitlist('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_event_ops('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_save_event_ops('97000000-0000-0000-0000-0000000000e1', true, '[]')$q$,
    $q$select public.admin_attendance_report('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.checkin_search('97000000-0000-0000-0000-0000000000e1', 'Asha')$q$,
    $q$select public.event_arrivals('97000000-0000-0000-0000-0000000000e1')$q$]
  loop
    assert public.t97_fails(fn) is not null, 'a plain member could run: ' || fn;
  end loop;
  assert (select count(*) from public.event_messages) = 0 and (select count(*) from public.event_refunds) = 0, 'members read no message or refund rows';
end $$;
reset role;
select pg_temp.login('97000000-0000-0000-0000-0000000000c0');
set local role authenticated;
do $$
declare fn text;
begin
  -- the volunteer is staff for the gate, nothing more
  foreach fn in array array[
    $q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{}')$q$,
    $q$select public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_waitlist('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_attendance_report('97000000-0000-0000-0000-0000000000e1')$q$,
    $q$select public.admin_save_event_ops('97000000-0000-0000-0000-0000000000e1', true, '[]')$q$,
    $q$select public.admin_record_refund('97000000-0000-0000-0000-0000000000b3', 100, 'cash', null, 'x y z')$q$]
  loop
    assert public.t97_fails(fn) is not null, 'the volunteer could run: ' || fn;
  end loop;
  assert (select count(*) from public.event_refunds) = 0 and (select count(*) from public.event_day_capacity) = 0, 'volunteer reads no refunds or capacity rows';
end $$;
reset role;
set local role anon;
do $$ begin
  assert public.t97_fails($q$select public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1')$q$) is not null, 'anon ledger';
  assert public.t97_fails($q$select public.checkin_search('97000000-0000-0000-0000-0000000000e1', 'Asha')$q$) is not null, 'anon search';
  assert public.t97_fails($q$select public.join_waitlist('97000000-0000-0000-0000-0000000000e2', 1)$q$) is not null, 'anon waitlist';
  assert public.t97_fails($q$select public.event_seats_left('97000000-0000-0000-0000-0000000000e2')$q$) is not null, 'anon seats';
end $$;
reset role;

-- ---------------------------------------------------------------- audiences and messages
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  e1 constant uuid := '97000000-0000-0000-0000-0000000000e1';
  p jsonb;
begin
  assert (public.admin_message_preview(e1, '{"segment":"registered"}') ->> 'count')::int = 6, 'registered = everyone not cancelled (a b c d h k)';
  assert (public.admin_message_preview(e1, '{"segment":"unpaid"}') ->> 'count')::int = 2, 'unpaid = a and k';
  assert (public.admin_message_preview(e1, '{"segment":"under_review"}') ->> 'count')::int = 1, 'under review = b';
  assert (public.admin_message_preview(e1, '{"segment":"confirmed"}') ->> 'count')::int = 3, 'confirmed = c d h';
  assert (public.admin_message_preview(e1, '{"segment":"not_checked_in"}') ->> 'count')::int = 2, 'not checked in = c h';
  assert (public.admin_message_preview(e1, '{"segment":"checked_in"}') ->> 'count')::int = 1, 'checked in = d';
  assert (public.admin_message_preview(e1, '{"segment":"cancelled"}') ->> 'count')::int = 1, 'cancelled = g';
  assert (public.admin_message_preview(e1, '{"segment":"registered","batch_from":"2005","batch_to":"2005"}') ->> 'count')::int = 2, 'batch filter';
  assert (public.admin_message_preview(e1, '{"segment":"registered","city":"pune"}') ->> 'count')::int = 2, 'city filter is case-insensitive';
  assert (public.admin_message_preview(e1, jsonb_build_object('segment','registered','ticket_type_id','97000000-0000-0000-0000-0000000000f2')) ->> 'count')::int = 1, 'ticket type filter (spouse ticket = d)';
  p := public.admin_message_preview(e1, '{"segment":"not_registered","city":"zzyx"}');
  assert (p ->> 'count')::int = 1 and p -> 'sample' ->> 0 = 'Esha Quillfeather', 'eligible members not yet registered (unverified f never counts)';
  assert (public.admin_message_preview(e1, '{"segment":"not_registered","city":"zzyx","batch_from":"2020","batch_to":"2021"}') ->> 'count')::int = 0, 'batch outside the filter';
  assert public.t97_fails($q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"segment":"everyone"}')$q$) like '%Unknown audience%', 'unknown segment';
  assert public.t97_fails($q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"batch_from":"20x5"}')$q$) like '%Batch years%', 'bad batch';
  assert public.t97_fails($q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"segment":"waitlist","ticket_type_id":"97000000-0000-0000-0000-0000000000f1"}')$q$) like '%only applies%', 'ticket type needs registrations';
  assert public.t97_fails($q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"view_id":"97000000-0000-0000-0000-0000000000ff"}')$q$) like '%admins%', 'a treasurer cannot use saved member views';

  -- validation
  assert public.t97_fails($q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Hi', 'Body text', '{}')$q$) like '%title%', 'short title';
  assert public.t97_fails($q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Hello', 'ab', '{}')$q$) like '%message needs%', 'short body';
  assert public.t97_fails($q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'spam', 'Hello', 'Body text', '{}')$q$) like '%Unknown message type%', 'unknown kind';
  assert public.t97_fails($q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Hello', 'Body text', '{"segment":"cancelled","city":"nowhere"}')$q$) like '%Nobody matches%', 'empty audience';
  assert public.t97_fails($q$select public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Hello', 'Body text', '{}', now() - interval '1 hour')$q$) like '%future%', 'past schedule';
  assert (select count(*) from public.event_messages) = 0, 'failed sends leave nothing behind';

  -- send now to the unpaid
  p := to_jsonb(public.admin_send_event_message(e1, 'payment_reminder', 'Please pay', 'Your seat is not confirmed until you pay.', '{"segment":"unpaid"}'));
  assert p ->> 'status' = 'sent' and (p ->> 'recipient_count')::int = 2, 'sent to two people';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.notifications where user_id::text like '97000000-%' and kind = 'announcement' and body = 'Please pay: Your seat is not confirmed until you pay.') = 2, 'a notification per recipient (this is what push picks up)';
  assert (select count(*) from public.notifications where user_id in ('97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-000000000012') and actor_id = '97000000-0000-0000-0000-0000000000b0') = 2, 'only a and k, from the treasurer';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-00000000000b') = 0, 'b (under review) was not messaged';
  assert (select count(*) from public.event_message_recipients) = 2, 'recipients are kept';
  assert (select count(*) from public.admin_audit where action = 'send_event_message' and actor = '97000000-0000-0000-0000-0000000000b0' and (details ->> 'count')::int = 2) = 1, 'the send is in the activity log';
end $$;

-- scheduled: nothing yet; a reminder to the unpaid skips whoever paid in the meantime
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  e1 constant uuid := '97000000-0000-0000-0000-0000000000e1';
  m public.event_messages;
  m2 public.event_messages;
begin
  m := public.admin_send_event_message(e1, 'reminder', 'Last call', 'Registration closes soon, pay today.', '{"segment":"unpaid"}', now() + interval '1 day');
  assert m.status = 'scheduled' and m.recipient_count is null, 'scheduled, not sent';
  assert public.admin_send_due_messages() = 0, 'nothing is due yet';
  m2 := public.admin_send_event_message(e1, 'reminder', 'Cancel me', 'This one will not go out.', '{"segment":"unpaid"}', now() + interval '2 days');
  perform public.admin_cancel_event_message(m2.id);
  assert (select status from public.event_messages where id = m2.id) = 'cancelled', 'cancelled';
  assert public.t97_fails(format('select public.admin_cancel_event_message(%L)', m2.id)) like '%already been sent or cancelled%', 'cannot cancel twice';
end $$;
reset role;
update public.event_registrations set status = 'under_review' where id = '97000000-0000-0000-0000-0000000000a1'; -- a paid
update public.event_messages set scheduled_for = now() - interval '1 minute' where status in ('scheduled', 'cancelled');
delete from public.notifications where user_id::text like '97000000-%';
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
begin
  assert public.admin_send_due_messages() = 1, 'one scheduled message is due (the cancelled one is not)';
  assert public.admin_send_due_messages() = 0, 'and it goes out only once';
end $$;
reset role;
do $$
begin
  assert (select recipient_count from public.event_messages where title = 'Last call') = 1, 'audience was looked up again at send time: only k is still unpaid';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-00000000000a') = 0, 'a paid in the meantime and was left alone';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-000000000012' and body like 'Last call:%') = 1, 'k got the reminder';
  assert (select count(*) from public.notifications where body like 'Cancel me:%') = 0, 'a cancelled message never goes out';
  assert (select status from public.event_messages where title = 'Cancel me') = 'cancelled', 'still cancelled';
  assert (select count(*) from public.admin_audit where action in ('schedule_event_message', 'cancel_event_message')) = 3, 'schedules and cancel are logged';
  -- the system sender (pg_cron) works without anyone signed in
  insert into public.event_messages (event_id, title, body, audience, status, scheduled_for, created_by)
    values ('97000000-0000-0000-0000-0000000000e1', 'By the clock', 'Sent by the scheduler', '{"segment":"confirmed"}', 'scheduled', now() - interval '1 minute', '97000000-0000-0000-0000-0000000000b0');
  assert public._cron_deliver_due_messages() = 1, 'the scheduler sends what is due';
  assert (select recipient_count from public.event_messages where title = 'By the clock') = 3, 'to the three confirmed';
end $$;

-- a saved member view as the audience: admins only, and the list is fixed when the message is created
insert into public.admin_member_views (id, name, filter) values ('97000000-0000-0000-0000-0000000000ff', 'Zzyx members', '{"city":"zzyx"}');
select pg_temp.login('97000000-0000-0000-0000-0000000000a0');
set local role authenticated;
do $$
declare
  m public.event_messages;
begin
  assert (public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"segment":"not_registered","view_id":"97000000-0000-0000-0000-0000000000ff"}') ->> 'count')::int = 1, 'view + segment';
  m := public.admin_send_event_message('97000000-0000-0000-0000-0000000000e1', 'announcement', 'Come along', 'You are eligible, register now.', '{"segment":"not_registered","view_id":"97000000-0000-0000-0000-0000000000ff"}');
  assert m.recipient_count = 1, 'sent to the one member in the view';
  assert public.t97_fails($q$select public.admin_message_preview('97000000-0000-0000-0000-0000000000e1', '{"view_id":"97000000-0000-0000-0000-0000000000fe"}')$q$) like '%no longer exists%', 'missing view';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-00000000000e' and body like 'Come along:%') = 1, 'Esha was invited';
end $$;

-- ---------------------------------------------------------------- finance: ledger, discrepancy flags, refunds
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  e1 constant uuid := '97000000-0000-0000-0000-0000000000e1';
  l jsonb := public.admin_event_ledger(e1);
  kinds text[];
begin
  assert (l -> 'totals' ->> 'verified')::int = 300000, 'verified gross: c 1000 + d 1500 + g 500 cash';
  assert (l -> 'totals' ->> 'pending')::int = 200000 and (l -> 'totals' ->> 'pending_count')::int = 2, 'pending: b and k';
  assert (l -> 'totals' ->> 'refunded')::int = 0 and (l -> 'totals' ->> 'net')::int = 300000, 'nothing refunded yet';
  assert (l -> 'position' ->> 'booked')::int = 650000, 'booked: not cancelled a b c d h k = 1000+1000+1000+1500+1000+1000';
  assert (l -> 'position' ->> 'outstanding')::int = 100000 + 100000 - 100000 + 100000, 'outstanding: unpaid/under review/underpaid minus waiting money';
  assert jsonb_array_length(l -> 'by_method') = 2, 'upi and cash';
  assert (select (m ->> 'verified')::int from jsonb_array_elements(l -> 'by_method') m where m ->> 'method' = 'upi') = 100000, 'upi verified';
  assert (select (m ->> 'verified')::int from jsonb_array_elements(l -> 'by_method') m where m ->> 'method' = 'cash') = 200000, 'cash verified';
  assert jsonb_array_length(l -> 'by_day') = 1, 'one day of activity';
  assert (select (t ->> 'booked')::int from jsonb_array_elements(l -> 'by_ticket') t where t ->> 'label' = 'Alumnus') = 300000, 'ticket booked value (a c d)';
  assert (select (t ->> 'quantity')::int from jsonb_array_elements(l -> 'by_ticket') t where t ->> 'label' = 'Spouse') = 1, 'ticket quantity';
  select array_agg(distinct f ->> 'kind') into kinds from jsonb_array_elements(l -> 'flags') f;
  assert 'confirmed_underpaid' = any (kinds), 'h is confirmed without money';
  assert 'cancelled_holds_money' = any (kinds), 'g is cancelled but holds cash';
  assert 'status_mismatch' = any (kinds), 'k is marked unpaid but a payment is waiting';
  assert not 'overpaid' = any (kinds), 'nobody overpaid yet';
  -- a different date range excludes today's money flows but not the position
  l := public.admin_event_ledger(e1, current_date - 30, current_date - 20);
  assert (l -> 'totals' ->> 'verified')::int = 0 and (l -> 'position' ->> 'booked')::int = 650000, 'period filter';
  assert public.t97_fails($q$select public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1', current_date, current_date - 1)$q$) like '%before the start%', 'bad range';
  -- the other event's money is not in this ledger
  assert not exists (select 1 from jsonb_array_elements(public.admin_event_ledger_rows(e1)) r where r ->> 'code' = 'JEC-OP0008'), 'rows stay inside the event';
  assert jsonb_array_length(public.admin_event_ledger_rows(e1)) = 5, 'five payments listed';
end $$;

-- refunds: partial, then the rest with the registration cancelled
do $$
declare
  c constant uuid := '97000000-0000-0000-0000-0000000000b3';
  r public.event_registrations;
begin
  assert public.t97_fails(format('select public.admin_record_refund(%L, 0, %L, null, %L)', c, 'cash', 'reason')) like '%between%', 'amount must be positive';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 100001, %L, null, %L)', c, 'cash', 'reason')) like '%still refundable%', 'more than the payment';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 100, %L, null, %L)', c, 'cheque', 'reason')) like '%how the money%', 'unknown method';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 100, %L, null, %L)', c, 'cash', '  ')) like '%reason%', 'reason is required';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 100, %L, null, %L)', '97000000-0000-0000-0000-0000000000b2', 'cash', 'reason')) like '%Only verified%', 'a payment waiting for review cannot be refunded';
  r := public.admin_record_refund(c, 30000, 'bank_transfer', 'REF123', 'Member reduced to a smaller ticket');
  assert r.status = 'confirmed', 'a partial refund leaves the registration as it is';
  assert (select status from public.event_payments where id = c) = 'verified', 'the payment stays verified after a partial refund';
  assert (select sum(amount_paise) from public.event_refunds where payment_id = c) = 30000, 'refund recorded';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 70001, %L, null, %L)', c, 'cash', 'too much')) like '%still refundable%', 'cannot exceed what is left';
  r := public.admin_record_refund(c, 70000, 'upi', 'UPIREF9', 'Cancelled by phone', true);
  assert r.status = 'cancelled', 'refund with cancel';
  assert (select status from public.event_payments where id = c) = 'refunded', 'fully refunded payment is marked refunded';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 1, %L, null, %L)', c, 'cash', 'again')) like '%Only verified%', 'nothing left to refund';
  assert public.t97_fails(format('select public.admin_record_refund(%L, 1, %L, null, %L)', '97000000-0000-0000-0000-0000000000b4', 'cash', 'partial') ) is null, 'a cash payment can be refunded in parts';
end $$;
do $$
declare l jsonb := public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1');
begin
  assert (l -> 'totals' ->> 'refunded')::int = 100001 and (l -> 'totals' ->> 'verified')::int = 300000, 'refunds are counted separately from collections';
  assert (l -> 'totals' ->> 'net')::int = 300000 - 100001, 'net = verified - refunded';
  assert (select (m ->> 'refunded')::int from jsonb_array_elements(l -> 'by_method') m where m ->> 'method' = 'upi') = 70000, 'money out by the way it was returned (upi)';
  assert jsonb_array_length(public.admin_event_ledger_rows('97000000-0000-0000-0000-0000000000e1')) = 8, 'payments + three refunds';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.admin_audit where action = 'record_refund' and actor = '97000000-0000-0000-0000-0000000000b0') = 3, 'each refund has one log line with the reason';
  assert (select details ->> 'reference' from public.admin_audit where action = 'record_refund' and (details ->> 'amount')::int = 30000) = 'REF123', 'reference kept';
  assert (select count(*) from public.admin_audit where action = 'reject_payment' and target_id = '97000000-0000-0000-0000-0000000000a3') = 0, 'a refund is not logged as a rejection';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-00000000000c' and body like 'A refund of%') = 2, 'the member is told';
  insert into public.event_payments (registration_id, amount_paise, method, status, reviewed_at) values ('97000000-0000-0000-0000-0000000000a6', 100000, 'cash', 'verified', now());
  -- overpaid: more verified than the price
  update public.event_registrations set amount_paise = 60000 where id = '97000000-0000-0000-0000-0000000000a6';
end $$;
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare l jsonb := public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1');
begin
  assert exists (select 1 from jsonb_array_elements(l -> 'flags') f where f ->> 'kind' = 'overpaid' and f ->> 'code' = 'JEC-OP0006' and (f ->> 'amount_paise')::int = 40000), 'overpayment flagged with the excess';
  perform public.admin_record_refund((select id from public.event_payments where registration_id = '97000000-0000-0000-0000-0000000000a6' and method = 'cash'), 40000, 'cash', null, 'Returned the excess');
  l := public.admin_event_ledger('97000000-0000-0000-0000-0000000000e1');
  assert not exists (select 1 from jsonb_array_elements(l -> 'flags') f where f ->> 'kind' = 'overpaid'), 'refunding the excess clears the overpaid flag';
  assert public.t97_fails($q$select public.admin_event_ledger_rows('97000000-0000-0000-0000-0000000000e1', null, null, true)$q$) is null, 'export works';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.admin_audit where action = 'export_ledger' and actor = '97000000-0000-0000-0000-0000000000b0') = 1, 'a downloaded ledger is logged';
end $$;

-- ---------------------------------------------------------------- adjustments: transfer, discount + partial payment, bulk review
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  r public.event_registrations;
begin
  assert public.t97_fails($q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-00000000000e', 'swap')$q$) like '%already checked in%', 'checked-in tickets are not transferred';
  assert public.t97_fails($q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a5', '97000000-0000-0000-0000-00000000000e', 'swap')$q$) like '%Cancelled%', 'cancelled tickets are not transferred';
  assert public.t97_fails($q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-000000000012', 'swap')$q$) like '%same person%', 'same person';
  assert public.t97_fails($q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-00000000000b', 'swap')$q$) like '%already has a registration%', 'target is already registered';
  assert public.t97_fails($q$select public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-00000000000e', ' ')$q$) like '%reason%', 'reason is required';
  r := public.admin_transfer_registration('97000000-0000-0000-0000-0000000000a7', '97000000-0000-0000-0000-00000000000e', 'Kavya cannot come; Esha takes the place');
  assert r.user_id = '97000000-0000-0000-0000-00000000000e' and r.full_name = 'Esha Quillfeather' and r.city = 'Zzyx' and r.code = 'JEC-OP0007', 'the registration now belongs to Esha, same code';
  assert (select count(*) from public.event_payments where registration_id = r.id) = 1, 'payments stay with the registration';
end $$;
reset role;
do $$ begin
  assert (select details -> 'from' ->> 'name' from public.admin_audit where action = 'transfer_registration') = 'Kavya Quillfeather', 'log: from';
  assert (select details -> 'to' ->> 'name' from public.admin_audit where action = 'transfer_registration') = 'Esha Quillfeather', 'log: to';
  assert (select details ->> 'reason' from public.admin_audit where action = 'transfer_registration') like 'Kavya cannot come%', 'log: reason';
  assert (select count(*) from public.notifications where user_id in ('97000000-0000-0000-0000-000000000012', '97000000-0000-0000-0000-00000000000e') and body like '%JEC-OP0007%') = 2, 'both people are told';
end $$;

update public.event_registrations set status = 'pending_payment' where id = '97000000-0000-0000-0000-0000000000a1';
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  a constant uuid := '97000000-0000-0000-0000-0000000000a1';
  r public.event_registrations;
begin
  -- a (now under review after "paying") is put back to unpaid with no payment: due 1000
  assert public.t97_fails(format('select public.admin_apply_discount(%L, 100001, %L)', a, 'too big')) like '%still due%', 'discount cannot exceed what is due';
  assert public.t97_fails(format('select public.admin_apply_discount(%L, 5000, %L)', a, ' ')) like '%approved%', 'discount needs an approver';
  r := public.admin_apply_discount(a, 25000, 'Committee member discount, approved by Boss');
  assert r.status = 'pending_payment' and r.amount_paise = 100000, 'discount leaves the price, reduces what is owed';
  assert (select amount_paise from public.event_payments where registration_id = a and method = 'waiver') = 25000, 'a waiver record';
  r := public.record_offline_payment(a, 'cash', 30000, 'part payment at the desk');
  assert r.status = 'pending_payment', 'partial cash payment: still owes the balance';
  r := public.record_offline_payment(a, 'cash', 45000, 'balance');
  assert r.status = 'confirmed', 'discount + two cash payments cover the price';
  assert public.t97_fails(format('select public.admin_apply_discount(%L, 100, %L)', a, 'later')) like '%Nothing is due%', 'nothing left to discount';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.admin_audit where action = 'record_waiver' and details ->> 'note' like 'Discount: Committee member discount%') = 1, 'the discount is in the log';
  assert (select count(*) from public.admin_audit where action = 'record_cash' and target_id = '97000000-0000-0000-0000-0000000000a1') = 2, 'both cash payments are in the log';
end $$;

select pg_temp.login('97000000-0000-0000-0000-0000000000c0');
set local role authenticated;
do $$
declare res jsonb;
begin
  res := public.admin_bulk_review_payments(array['97000000-0000-0000-0000-0000000000b2'::uuid], true, 'x');
  assert (res ->> 'done')::int = 0 and jsonb_array_length(res -> 'failed') = 1, 'a volunteer cannot verify anything through the bulk door either';
end $$;
reset role;
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare res jsonb;
begin
  assert public.t97_fails($q$select public.admin_bulk_review_payments('{}', true, null)$q$) like '%at least one%', 'empty selection';
  res := public.admin_bulk_review_payments(array['97000000-0000-0000-0000-0000000000b2'::uuid, '97000000-0000-0000-0000-0000000000b8'::uuid,
                                                 '97000000-0000-0000-0000-0000000000b9'::uuid, '97000000-0000-0000-0000-0000000000ee'::uuid], true, 'Matched statement');
  assert (res ->> 'done')::int = 2, 'two payments of my event verified';
  assert jsonb_array_length(res -> 'failed') = 2, 'the other event and the unknown id failed, the batch carried on';
end $$;
reset role;
do $$ begin
  assert (select status from public.event_payments where id = '97000000-0000-0000-0000-0000000000b2') = 'verified', 'b verified';
  assert (select status from public.event_registrations where id = '97000000-0000-0000-0000-0000000000a2') = 'confirmed', 'and confirmed';
  assert (select status from public.event_payments where id = '97000000-0000-0000-0000-0000000000b9') = 'submitted', 'someone else''s event untouched';
  assert (select count(*) from public.admin_audit where action = 'verify_payment' and details ->> 'note' = 'Matched statement') = 2, 'each one is logged';
end $$;

-- ---------------------------------------------------------------- waiting list (e2 holds 2: x1 confirmed 1, x2 under review 1 => full)
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
  ('97000000-0000-0000-0000-0000000000c1', '97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-00000000000c', 'JEC-WL0001', 'Chitra WL', '+91 98765 40003', 'confirmed', 1, 0),
  ('97000000-0000-0000-0000-0000000000c2', '97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-00000000000d', 'JEC-WL0002', 'Dev WL', '+91 98765 40004', 'under_review', 1, 0);
delete from public.notifications where user_id::text like '97000000-%';
select pg_temp.login('97000000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$
declare
  e2 constant uuid := '97000000-0000-0000-0000-0000000000e2';
  w jsonb;
begin
  assert public.event_seats_left(e2) = 0, 'full';
  assert public.t97_fails($q$select public.join_waitlist('97000000-0000-0000-0000-0000000000e1', 1)$q$) like '%already registered%', 'registered members do not queue';
  assert public.t97_fails($q$select public.join_waitlist('97000000-0000-0000-0000-0000000000e2', 0)$q$) like '%between 1 and 20%', 'headcount bounds';
  w := public.join_waitlist(e2, 1);
  assert w ->> 'status' = 'waiting' and (w ->> 'position')::int = 1, 'Esha is first in line';
  assert public.t97_fails($q$select public.join_waitlist('97000000-0000-0000-0000-0000000000e2', 1)$q$) like '%already on the waiting list%', 'no double entry';
  assert (select count(*) from public.event_waitlist) = 1, 'a member sees only their own queue entry';
end $$;
reset role;
select pg_temp.login('97000000-0000-0000-0000-00000000000f');
set local role authenticated;
do $$ begin
  assert public.t97_fails($q$select public.join_waitlist('97000000-0000-0000-0000-0000000000e1', 1)$q$) like '%places available%', 'cannot queue while there are places';
  assert public.event_seats_left('97000000-0000-0000-0000-0000000000e1') > 0, 'seats are readable by signed-in members';
end $$;
reset role;
-- others queue up (different transactions in real life: spread the timestamps here)
select pg_temp.login('97000000-0000-0000-0000-000000000010');
set local role authenticated;
select public.join_waitlist('97000000-0000-0000-0000-0000000000e2', 2);
reset role;
select pg_temp.login('97000000-0000-0000-0000-000000000011');
set local role authenticated;
select public.join_waitlist('97000000-0000-0000-0000-0000000000e2', 1);
reset role;
update public.event_waitlist set created_at = now() - interval '30 minutes' where user_id = '97000000-0000-0000-0000-00000000000e';
update public.event_waitlist set created_at = now() - interval '20 minutes' where user_id = '97000000-0000-0000-0000-000000000010';
update public.event_waitlist set created_at = now() - interval '10 minutes' where user_id = '97000000-0000-0000-0000-000000000011';
select pg_temp.login('97000000-0000-0000-0000-000000000011');
set local role authenticated;
do $$ begin
  assert (public.my_waitlist('97000000-0000-0000-0000-0000000000e2') ->> 'position')::int = 3, 'third in line';
  assert public.t97_fails($q$select public.admin_waitlist('97000000-0000-0000-0000-0000000000e2')$q$) is not null, 'a member cannot read the whole queue';
end $$;
reset role;

-- someone cancels; auto-promote is off, so nothing happens by itself
update public.event_registrations set status = 'cancelled' where id = '97000000-0000-0000-0000-0000000000c2';
do $$ begin
  assert (select count(*) from public.event_waitlist where status = 'offered') = 0, 'no automatic offers while the switch is off';
end $$;
select pg_temp.login('97000000-0000-0000-0000-0000000000a0');
set local role authenticated;
do $$
declare
  e2 constant uuid := '97000000-0000-0000-0000-0000000000e2';
  w jsonb;
begin
  w := public.admin_waitlist(e2);
  assert (w ->> 'seats_left')::int = 1 and jsonb_array_length(w -> 'entries') = 3, 'one free place, three waiting';
  assert public.admin_run_waitlist(e2) = 1, 'the next in line that fits is offered the place';
  w := public.admin_waitlist(e2);
  assert (w -> 'entries' -> 0 ->> 'full_name') = 'Esha Quillfeather' and w -> 'entries' -> 0 ->> 'status' = 'offered', 'Esha was offered it (she was first)';
  assert (w ->> 'free_after_offers')::int = 0, 'her place is held';
  -- Gita needs two places: not possible yet
  assert public.t97_fails(format('select public.admin_promote_waitlist(%L)', (select id from public.event_waitlist where user_id = '97000000-0000-0000-0000-000000000010'))) like '%free places%', 'manual promote checks the room';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-00000000000e' and body like 'A place has opened up for you at Ops Two%') = 1, 'Esha was told';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-000000000010') = 0, 'Gita was not';
end $$;

-- more room: raise the capacity, promote Gita by hand; then switch auto-promote on
update public.events set capacity = 5 where id = '97000000-0000-0000-0000-0000000000e2';
select pg_temp.login('97000000-0000-0000-0000-0000000000a0');
set local role authenticated;
do $$
declare
  e2 constant uuid := '97000000-0000-0000-0000-0000000000e2';
  g uuid := (select id from public.event_waitlist where user_id = '97000000-0000-0000-0000-000000000010');
  w jsonb;
begin
  w := public.admin_promote_waitlist(g);
  assert exists (select 1 from jsonb_array_elements(w -> 'entries') x where x ->> 'full_name' = 'Gita Quillfeather' and x ->> 'status' = 'offered'), 'Gita is offered her two places';
  w := public.admin_save_event_ops(e2, true, '[{"day":"2026-12-20","capacity":300,"label":"Saturday"},{"day":"2026-12-21","capacity":150,"label":"Sunday"}]');
  assert (w ->> 'auto_promote')::boolean and jsonb_array_length(w -> 'days') = 2, 'settings saved';
  assert public.t97_fails($q$select public.admin_save_event_ops('97000000-0000-0000-0000-0000000000e2', true, '[{"day":"tomorrow","capacity":3}]')$q$) like '%needs a date%', 'bad day';
  assert public.t97_fails($q$select public.admin_save_event_ops('97000000-0000-0000-0000-0000000000e2', true, '[{"day":"2026-12-20","capacity":0}]')$q$) like '%at least 1%', 'bad capacity';
end $$;
reset role;
-- capacity 5, x1 holds 1, offers hold 1 + 2 => 1 left. Someone cancelling frees another place and Hari (needs 1) is offered automatically
update public.event_registrations set status = 'cancelled' where id = '97000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select status from public.event_waitlist where user_id = '97000000-0000-0000-0000-000000000011') = 'offered', 'auto-promote offered Hari the freed place';
  assert (select count(*) from public.notifications where user_id = '97000000-0000-0000-0000-000000000011' and body like 'A place has opened up%') = 1, 'and told him';
end $$;
-- an offered member registers: the queue entry closes by itself
insert into public.event_registrations (event_id, user_id, code, full_name, phone, status, headcount, amount_paise)
  values ('97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-00000000000e', 'JEC-WL0003', 'Esha WL', '+91 98765 40005', 'pending_payment', 1, 0);
do $$ begin
  assert (select status from public.event_waitlist where user_id = '97000000-0000-0000-0000-00000000000e') = 'registered', 'registered members leave the queue';
end $$;
-- offers expire after 48 hours and stop holding places
update public.event_waitlist set offered_at = now() - interval '49 hours' where user_id = '97000000-0000-0000-0000-000000000011';
select pg_temp.login('97000000-0000-0000-0000-0000000000a0');
set local role authenticated;
do $$
declare
  w jsonb := public.admin_waitlist('97000000-0000-0000-0000-0000000000e2');
  h uuid := (select id from public.event_waitlist where user_id = '97000000-0000-0000-0000-000000000011');
begin
  assert exists (select 1 from jsonb_array_elements(w -> 'entries') x where x ->> 'full_name' = 'Hari Quillfeather' and x ->> 'status' = 'expired'), 'a stale offer shows as expired';
  perform public.admin_remove_waitlist(h, 'Did not respond');
  w := public.admin_add_waitlist('97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-000000000011', 1);
  assert exists (select 1 from jsonb_array_elements(w -> 'entries') x where x ->> 'full_name' = 'Hari Quillfeather' and x ->> 'status' = 'waiting'), 'added back by an organiser';
  assert public.t97_fails($q$select public.admin_add_waitlist('97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-00000000000e', 1)$q$) like '%already registered%', 'registered people are not queued';
end $$;
reset role;
select pg_temp.login('97000000-0000-0000-0000-000000000011');
set local role authenticated;
do $$ begin
  perform public.leave_waitlist('97000000-0000-0000-0000-0000000000e2');
  assert public.t97_fails($q$select public.leave_waitlist('97000000-0000-0000-0000-0000000000e2')$q$) like '%not on the waiting list%', 'nothing to leave';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.admin_audit where action in ('promote_waitlist', 'run_waitlist', 'remove_waitlist', 'add_waitlist', 'save_event_ops')) = 5, 'waitlist and settings actions are logged';
end $$;

-- ---------------------------------------------------------------- day of the event
select pg_temp.login('97000000-0000-0000-0000-0000000000c0');
set local role authenticated;
do $$
declare
  e1 constant uuid := '97000000-0000-0000-0000-0000000000e1';
  r jsonb;
  arr jsonb;
begin
  r := public.checkin_search(e1, 'quillfeather');
  assert jsonb_array_length(r) = 7, 'by name (seven registrations, the cancelled one included and listed last)';
  assert r -> 6 ->> 'status' = 'cancelled', 'cancelled sorted last';
  r := public.checkin_search(e1, 'op0003');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'full_name' = 'Chitra Quillfeather', 'by code';
  r := public.checkin_search(e1, '40004');
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'full_name' = 'Dev Quillfeather', 'by the last digits of the mobile number';
  assert not (r -> 0 ? 'phone') and not (r -> 0 ? 'email') and not (r -> 0 ? 'amount_paise') and not (r -> 0 ? 'notes'), 'no contact or money in the volunteer view';
  assert public.checkin_search(e1, 'a') = '[]'::jsonb, 'one letter is too short';
  assert jsonb_array_length(public.checkin_search(e1, '123')) = 0, 'three digits never match a phone';
  arr := public.event_arrivals(e1);
  assert (arr ->> 'expected_people')::int = 6 and (arr ->> 'arrived_people')::int = 2, 'expected: a b d h and Esha = 1+1+2+1+1; arrived: Dev with his spouse';
  assert (arr ->> 'expected_registrations')::int = 5 and (arr ->> 'arrived_registrations')::int = 1, 'registration counts';
  -- check in Bela through the usual door: the counter follows
  perform public.check_in(e1, 'JEC-OP0002');
  arr := public.event_arrivals(e1);
  assert (arr ->> 'arrived_people')::int = 3 and (arr ->> 'arrived_registrations')::int = 2, 'live arrivals';
  assert exists (select 1 from jsonb_array_elements(arr -> 'recent') x where x ->> 'full_name' = 'Bela Quillfeather'), 'recent arrivals';
  assert jsonb_array_length(arr -> 'hourly') = 1, 'one hour of arrivals';
  assert (public.checkin_search(e1, 'op0002') -> 0 ->> 'checked_in_at') is not null, 'search shows who is already in';
end $$;
reset role;

-- day capacity + attendance report (managers)
select pg_temp.login('97000000-0000-0000-0000-0000000000b0');
set local role authenticated;
do $$
declare
  e1 constant uuid := '97000000-0000-0000-0000-0000000000e1';
  today date := (now() at time zone 'Asia/Kolkata')::date;
  arr jsonb;
  rep jsonb;
begin
  perform public.admin_save_event_ops(e1, false, jsonb_build_array(jsonb_build_object('day', today, 'capacity', 4, 'label', 'Day one'), jsonb_build_object('day', today + 1, 'capacity', 50)));
  arr := public.event_arrivals(e1);
  assert jsonb_array_length(arr -> 'days') = 2, 'a day with capacity but no arrivals still shows';
  assert (arr -> 'days' -> 0 ->> 'people')::int = 3 and (arr -> 'days' -> 0 ->> 'capacity')::int = 4 and arr -> 'days' -> 0 ->> 'label' = 'Day one', 'today: 3 in, capacity 4';
  assert (arr -> 'days' -> 1 ->> 'people')::int = 0 and (arr -> 'days' -> 1 ->> 'capacity')::int = 50, 'tomorrow';
  rep := public.admin_attendance_report(e1);
  assert (select (b ->> 'confirmed')::int from jsonb_array_elements(rep -> 'by_batch') b where (b ->> 'batch')::int = 2001) = 3
     and (select (b ->> 'arrived')::int from jsonb_array_elements(rep -> 'by_batch') b where (b ->> 'batch')::int = 2001) = 1
     and (select (b ->> 'no_show')::int from jsonb_array_elements(rep -> 'by_batch') b where (b ->> 'batch')::int = 2001) = 2, 'batch 2001: 3 confirmed, 1 came, 2 no-shows';
  assert (select (b ->> 'no_show')::int from jsonb_array_elements(rep -> 'by_batch') b where (b ->> 'batch')::int = 2005) = 0, 'batch 2005 all came';
  assert jsonb_array_length(rep -> 'no_shows') = 3 and (rep -> 'no_shows' -> 0) ? 'phone', 'three confirmed people did not come; managers get their phone to call';
  assert (public.admin_event_ops(e1) ->> 'auto_promote')::boolean is false, 'auto promote off';
end $$;
reset role;

-- internal helpers cannot be called directly; nothing is reachable by anon
select pg_temp.login('97000000-0000-0000-0000-0000000000a0');
set local role authenticated;
do $$
begin
  assert public.t97_fails($q$select * from public._event_audience('97000000-0000-0000-0000-0000000000e1', '{}')$q$) is not null, 'audience helper is internal';
  assert public.t97_fails($q$select public._deliver_event_message('97000000-0000-0000-0000-0000000000e1')$q$) is not null, 'delivery is internal';
  assert public.t97_fails($q$select public._waitlist_offer('97000000-0000-0000-0000-0000000000e1')$q$) is not null, 'offering places is internal';
  assert public.t97_fails($q$select public._cron_deliver_due_messages()$q$) is not null, 'the scheduler entry is internal';
  assert public.t97_fails($q$insert into public.event_refunds (payment_id, registration_id, amount_paise, method, note) values ('97000000-0000-0000-0000-0000000000b3', '97000000-0000-0000-0000-0000000000a3', 5, 'cash', 'sneaky')$q$) is not null, 'refunds only through the function';
  assert public.t97_fails($q$update public.event_waitlist set status = 'offered'$q$) is not null, 'queue only through functions';
end $$;
reset role;
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('admin_message_preview', 'admin_send_event_message', 'admin_cancel_event_message', 'admin_send_due_messages',
         'admin_record_refund', 'admin_event_ledger', 'admin_event_ledger_rows', 'admin_transfer_registration', 'admin_apply_discount',
         'admin_bulk_review_payments', 'event_seats_left', 'join_waitlist', 'leave_waitlist', 'my_waitlist', 'admin_waitlist', 'admin_promote_waitlist',
         'admin_run_waitlist', 'admin_remove_waitlist', 'admin_add_waitlist', 'admin_event_ops', 'admin_save_event_ops', 'checkin_search',
         'event_arrivals', 'admin_attendance_report', '_event_audience', '_audience_view_ids', '_deliver_event_message', '_cron_deliver_due_messages',
         '_waitlist_free', '_waitlist_offer')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));
  assert bad is null, 'anon or public can execute: ' || coalesce(bad, '');
  select string_agg(t, ', ') into bad from unnest(array['event_messages', 'event_message_recipients', 'event_refunds', 'event_waitlist', 'event_ops', 'event_day_capacity']) t
   where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert')
      or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete');
  assert bad is null, 'table privileges too wide: ' || coalesce(bad, '');
  assert (select relrowsecurity from pg_class where oid = 'public.event_refunds'::regclass), 'row level security on';
end $$;
select 'ALL EVENT OPERATIONS TESTS PASSED';
rollback;
