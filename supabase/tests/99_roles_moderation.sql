-- Granular roles enforced by the database, moderation, message safety, unified inbox, audit search, view-as-member. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t99_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end;
$$;
grant execute on function public.t99_fails(text) to authenticated, anon;

-- a1 = admin, a2 = second admin, t = treasurer, c = content manager, m = moderator, v = volunteer (check-in), x = member, l = legacy manager
insert into auth.users (id, email, raw_user_meta_data) values
  ('99000000-0000-0000-0000-0000000000a1', 'a1@x99.com', '{"full_name":"Admin One"}'),
  ('99000000-0000-0000-0000-0000000000a2', 'a2@x99.com', '{"full_name":"Admin Two"}'),
  ('99000000-0000-0000-0000-0000000000b1', 't@x99.com', '{"full_name":"Tara Treasurer"}'),
  ('99000000-0000-0000-0000-0000000000b2', 'c@x99.com', '{"full_name":"Chetan Content"}'),
  ('99000000-0000-0000-0000-0000000000b3', 'm@x99.com', '{"full_name":"Meera Moderator"}'),
  ('99000000-0000-0000-0000-0000000000b4', 'v@x99.com', '{"full_name":"Vikas Volunteer"}'),
  ('99000000-0000-0000-0000-0000000000b5', 'l@x99.com', '{"full_name":"Legacy Manager"}'),
  ('99000000-0000-0000-0000-0000000000c1', 'x@x99.com', '{"full_name":"Xavier Member"}'),
  ('99000000-0000-0000-0000-0000000000c2', 'y@x99.com', '{"full_name":"Yash Reporter"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001
 where id::text like '99000000-%';
update public.profiles set is_admin = true where id in ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a2');

insert into public.events (id, slug, title, is_published, upi_id) values
  ('99000000-0000-0000-0000-0000000000e1', 'roles-one', 'Roles One', true, 'jec@okhdfc'),
  ('99000000-0000-0000-0000-0000000000e2', 'roles-two', 'Roles Two', true, 'jec@okhdfc');
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary) values
  ('99000000-0000-0000-0000-0000000000f1', '99000000-0000-0000-0000-0000000000e1', 'Alumnus', 100000, true),
  ('99000000-0000-0000-0000-0000000000f2', '99000000-0000-0000-0000-0000000000e2', 'Alumnus', 100000, true);
-- direct inserts (as the test owner): roles for e1 only, and the legacy 'manager' value
insert into public.event_staff (event_id, user_id, role) values
  ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000b1', 'treasurer'),
  ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000b2', 'content'),
  ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000b4', 'checkin'),
  ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000b5', 'manager');
insert into public.site_roles (user_id, role) values ('99000000-0000-0000-0000-0000000000b3', 'moderator');

do $$ begin
  assert (select count(*) from public.event_staff where user_id = '99000000-0000-0000-0000-0000000000b5') = 2, 'legacy manager insert became two rows';
  assert (select string_agg(role, ',' order by role) from public.event_staff where user_id = '99000000-0000-0000-0000-0000000000b5') = 'content,treasurer', 'treasurer + content';
  assert not exists (select 1 from public.event_staff where role = 'manager'), 'no manager rows remain';
  begin insert into public.event_staff (event_id, user_id, role) values ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000c1', 'bogus'); assert false, 'bogus role';
  exception when check_violation then null; end;
end $$;

insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, headcount, amount_paise) values
  ('99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000c1', 'JEC-RL0001', 'Xavier Member', '+91 98765 99001', 'under_review', 1, 100000),
  ('99000000-0000-0000-0000-0000000000d2', '99000000-0000-0000-0000-0000000000e2', '99000000-0000-0000-0000-0000000000c2', 'JEC-RL0002', 'Yash Reporter', '+91 98765 99002', 'under_review', 1, 100000);
insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity) values
  ('99000000-0000-0000-0000-0000000000d1', '99000000-0000-0000-0000-0000000000f1', 'Alumnus', 100000, 1),
  ('99000000-0000-0000-0000-0000000000d2', '99000000-0000-0000-0000-0000000000f2', 'Alumnus', 100000, 1);
insert into public.event_payments (id, registration_id, amount_paise, method, utr, status) values
  ('99000000-0000-0000-0000-0000000000e9', '99000000-0000-0000-0000-0000000000d1', 100000, 'upi', '990000000001', 'submitted'),
  ('99000000-0000-0000-0000-0000000000ea', '99000000-0000-0000-0000-0000000000d2', 100000, 'upi', '990000000002', 'submitted');
insert into public.posts (id, author_id, body) values ('99000000-0000-0000-0000-0000000000a9', '99000000-0000-0000-0000-0000000000c1', 'A post to report');
insert into public.reports (reporter, target_type, target_id, reason) values ('99000000-0000-0000-0000-0000000000c2', 'post', '99000000-0000-0000-0000-0000000000a9', 'spammy post');
insert into public.groups (id, kind, slug, name) values ('99000000-0000-0000-0000-0000000000a8', 'circle', 'roles-circle', 'Roles Circle');
delete from public.admin_audit where actor::text like '99000000-%';

-- ---------------------------------------------------------------- treasurer: money yes, messages / programme / moderation / roles no
select pg_temp.login('99000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_registrations) = 1, 'treasurer sees the registrations of their own event only';
  assert (select count(*) from public.event_payments) = 1, 'and its payments';
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e1')$q$) is null, 'treasurer reads the ledger';
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e2')$q$) is not null, 'not another event''s ledger';
  assert public.t99_fails($q$select public.admin_waitlist('99000000-0000-0000-0000-0000000000e1')$q$) is null, 'treasurer reads the waiting list';
  assert public.t99_fails($q$select public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{}')$q$) is not null, 'treasurer cannot message';
  assert public.t99_fails($q$select public.admin_send_event_message('99000000-0000-0000-0000-0000000000e1', 'announcement', 'Hello all', 'Body text', '{}')$q$) is not null, 'treasurer cannot send';
  assert public.t99_fails($q$select public.post_announcement('99000000-0000-0000-0000-0000000000e1', 'Title', 'Body', false)$q$) is not null, 'treasurer cannot post announcements';
  assert public.t99_fails($q$insert into public.event_programme (event_id, title, starts_at) values ('99000000-0000-0000-0000-0000000000e1', 'x', now())$q$) is not null, 'treasurer cannot edit the programme';
  assert public.t99_fails($q$select * from public.admin_reports('open')$q$) is not null, 'treasurer cannot read reports';
  assert public.t99_fails($q$select public.moderate('post', '99000000-0000-0000-0000-0000000000a9', true)$q$) is not null, 'treasurer cannot hide content';
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'moderator')$q$) is not null, 'treasurer cannot give roles';
  assert public.t99_fails($q$update public.profiles set is_admin = true where id = '99000000-0000-0000-0000-0000000000b1'$q$) is not null, 'cannot make oneself admin';
  assert public.t99_fails($q$insert into public.event_staff (event_id, user_id, role) values ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000b1', 'content')$q$) is not null, 'no direct role writes';
  assert public.t99_fails($q$select public.admin_inbox()$q$) is null, 'treasurer has an inbox';
  assert (select count(*) from jsonb_array_elements(public.admin_inbox() -> 'items') x where x ->> 'kind' in ('report', 'flagged', 'approval')) = 0, 'but no reports or approvals in it';
  -- they can verify a payment on their event
  perform public.review_payment('99000000-0000-0000-0000-0000000000e9', true, null);
  assert (select status from public.event_payments where id = '99000000-0000-0000-0000-0000000000e9') = 'verified', 'treasurer verified the payment';
  assert public.t99_fails($q$select public.review_payment('99000000-0000-0000-0000-0000000000ea', true, null)$q$) is not null, 'not on another event';
end $$;
reset role;

-- ---------------------------------------------------------------- content manager: messages and programme yes, money no
select pg_temp.login('99000000-0000-0000-0000-0000000000b2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_registrations) = 0, 'content manager does not see registrations';
  assert (select count(*) from public.event_payments) = 0, 'or payments';
  assert public.t99_fails($q$select public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{}')$q$) is null, 'content manager previews messages';
  assert public.t99_fails($q$select public.post_announcement('99000000-0000-0000-0000-0000000000e1', 'Title', 'Body', false)$q$) is null, 'and posts announcements';
  assert public.t99_fails($q$insert into public.event_programme (event_id, title, starts_at) values ('99000000-0000-0000-0000-0000000000e1', 'Opening', now())$q$) is null, 'and edits the programme';
  assert public.t99_fails($q$insert into public.event_programme (event_id, title, starts_at) values ('99000000-0000-0000-0000-0000000000e2', 'Opening', now())$q$) is not null, 'not on another event';
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e1')$q$) is not null, 'content manager cannot read the ledger';
  assert public.t99_fails($q$select public.review_payment('99000000-0000-0000-0000-0000000000ea', true, null)$q$) is not null, 'cannot verify payments';
  assert public.t99_fails($q$select public.admin_record_refund('99000000-0000-0000-0000-0000000000e9', 100, 'cash', null, 'x y z')$q$) is not null, 'cannot refund';
  assert public.t99_fails($q$select public.admin_waitlist('99000000-0000-0000-0000-0000000000e1')$q$) is not null, 'cannot touch the waiting list';
  assert public.t99_fails($q$select * from public.admin_reports('open')$q$) is not null, 'cannot read reports';
  assert public.t99_fails($q$select public.admin_inbox()$q$) is not null, 'no inbox for content managers';
end $$;
reset role;

-- ---------------------------------------------------------------- moderator: reports, hiding, slow mode; nothing else
select pg_temp.login('99000000-0000-0000-0000-0000000000b3');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.admin_reports('open')) = 1, 'moderator reads the reports';
  assert (select count(*) from jsonb_array_elements(public.admin_inbox() -> 'items') x where x ->> 'kind' = 'report') = 1, 'and sees them in the inbox';
  assert (select count(*) from jsonb_array_elements(public.admin_inbox() -> 'items') x where x ->> 'kind' in ('refund', 'waitlist', 'approval')) = 0, 'but not money or approvals';
  assert public.t99_fails($q$select public.admin_set_slow_mode('99000000-0000-0000-0000-0000000000a8', 30)$q$) is null, 'moderator sets slow mode';
  assert (select slow_mode_seconds from public.groups where id = '99000000-0000-0000-0000-0000000000a8') = 30, 'slow mode changed';
  assert public.t99_fails($q$select public.admin_set_slow_mode('99000000-0000-0000-0000-0000000000a8', 99999)$q$) is not null, 'slow mode is validated';
  perform public.moderate('post', '99000000-0000-0000-0000-0000000000a9', true);
  assert public.t99_fails($q$select public.admin_update_member('99000000-0000-0000-0000-0000000000c1', '{"headline":"x"}')$q$) is not null, 'moderator cannot edit members';
  assert public.t99_fails($q$select public.admin_set_member('99000000-0000-0000-0000-0000000000c1', null, 'rejected')$q$) is not null, 'or verify them';
  assert public.t99_fails($q$select public.review_payment('99000000-0000-0000-0000-0000000000ea', true, null)$q$) is not null, 'or verify payments';
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e1')$q$) is not null, 'or read ledgers';
  assert public.t99_fails($q$select public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{}')$q$) is not null, 'or message attendees';
  assert public.t99_fails($q$select public.admin_audit_search()$q$) is not null, 'or read the activity log';
  assert public.t99_fails($q$select public.admin_roles_overview()$q$) is not null, 'or see roles';
  assert public.t99_fails($q$select public.admin_view_as_member('99000000-0000-0000-0000-0000000000c1')$q$) is not null, 'or preview a member';
  assert (public.admin_attention() -> 'global' ->> 'reports_open')::int = 0 and not ((public.admin_attention() -> 'global') ? 'members_pending'), 'attention shows a moderator only reports';
end $$;
reset role;
do $$ begin
  assert (select is_hidden from public.posts where id = '99000000-0000-0000-0000-0000000000a9'), 'moderator hid the post';
  assert (select status from public.reports where target_id = '99000000-0000-0000-0000-0000000000a9') = 'actioned', 'and closed its reports';
  assert exists (select 1 from public.admin_audit where action = 'hide_post' and actor = '99000000-0000-0000-0000-0000000000b3'), 'hiding is logged against the moderator';
  assert exists (select 1 from public.admin_audit where action = 'slow_mode' and actor = '99000000-0000-0000-0000-0000000000b3'), 'slow mode is logged';
end $$;

-- ---------------------------------------------------------------- check-in volunteer: as before (gate only)
select pg_temp.login('99000000-0000-0000-0000-0000000000b4');
set local role authenticated;
do $$ begin
  assert public.t99_fails($q$select * from public.event_attendees('99000000-0000-0000-0000-0000000000e1')$q$) is null, 'volunteer reads attendee names';
  assert (select count(*) from public.event_registrations) = 0, 'but no registration rows';
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e1')$q$) is not null, 'no ledger';
  assert public.t99_fails($q$select public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{}')$q$) is not null, 'no messages';
  assert public.t99_fails($q$select * from public.admin_reports('open')$q$) is not null, 'no reports';
  assert public.t99_fails($q$select public.admin_attention()$q$) is not null, 'no attention queue';
end $$;
reset role;

-- ---------------------------------------------------------------- legacy manager keeps both
select pg_temp.login('99000000-0000-0000-0000-0000000000b5');
set local role authenticated;
do $$ begin
  assert public.t99_fails($q$select public.admin_event_ledger('99000000-0000-0000-0000-0000000000e1')$q$) is null, 'migrated manager still reads the ledger';
  assert public.t99_fails($q$select public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{}')$q$) is null, 'and still messages';
end $$;
reset role;

-- ---------------------------------------------------------------- granting and removing roles
select pg_temp.login('99000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'admin')$q$) is not null, 'a member cannot make themselves admin';
  assert public.t99_fails($q$select public.admin_revoke_role('99000000-0000-0000-0000-0000000000b1', 'treasurer', '99000000-0000-0000-0000-0000000000e1')$q$) is not null, 'or remove roles';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'admin'); assert false, 'anon grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.login('99000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare n0 int;
begin
  assert public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'treasurer', '99000000-0000-0000-0000-0000000000e2') = true, 'granted';
  assert public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'treasurer', '99000000-0000-0000-0000-0000000000e2') = false, 'granting twice changes nothing';
  assert (select count(*) from public.admin_audit where action = 'role_grant' and target_id = '99000000-0000-0000-0000-0000000000c1') = 1, 'one log line, not two';
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'treasurer')$q$) is not null, 'an event role needs an event';
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'wizard')$q$) is not null, 'unknown role';
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000ff', 'moderator')$q$) is not null, 'unknown member';
  assert public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'moderator') = true, 'moderator granted';
  assert exists (select 1 from public.site_roles where user_id = '99000000-0000-0000-0000-0000000000c1'), 'row exists';
  assert public.admin_revoke_role('99000000-0000-0000-0000-0000000000c1', 'moderator') = true, 'moderator removed';
  assert public.admin_revoke_role('99000000-0000-0000-0000-0000000000c1', 'moderator') = false, 'removing twice changes nothing';
  assert public.admin_revoke_role('99000000-0000-0000-0000-0000000000c1', 'treasurer', '99000000-0000-0000-0000-0000000000e2') = true, 'event role removed';
  assert not exists (select 1 from public.event_staff where user_id = '99000000-0000-0000-0000-0000000000c1'), 'gone from the table';
  -- admins
  assert public.t99_fails($q$select public.admin_revoke_role('99000000-0000-0000-0000-0000000000a1', 'admin')$q$) like '%super admin only%', 'admin access has its own door: super admins only';
  assert public.t99_fails($q$select public.admin_grant_role('99000000-0000-0000-0000-0000000000c1', 'admin')$q$) like '%super admin only%', 'an ordinary admin cannot make an admin';
  assert not (select is_admin from public.profiles where id = '99000000-0000-0000-0000-0000000000c1'), 'flag untouched';
  assert (select count(*) from public.admin_audit where action in ('role_grant', 'role_revoke')) = 4, 'every change logged';
  assert (select details ->> 'event' from public.admin_audit where action = 'role_grant' and details ->> 'role' = 'treasurer') = 'Roles Two', 'log names the event';
  -- overview lists the new roles
  assert exists (select 1 from jsonb_array_elements(public.admin_roles_overview() -> 'moderators') x where x ->> 'full_name' = 'Meera Moderator'), 'moderator listed';
  assert exists (select 1 from jsonb_array_elements(public.admin_roles_overview() -> 'staff') x where x ->> 'full_name' = 'Tara Treasurer' and x ->> 'role' = 'treasurer'), 'treasurer listed';
end $$;
reset role;
-- the last admin can never be removed, not even by a direct update
update public.profiles set is_admin = false where id = '99000000-0000-0000-0000-0000000000a2';
do $$ begin
  begin update public.profiles set is_admin = false where is_admin; assert false, 'last admin removed';
  exception when others then assert sqlerrm like '%at least one admin%', sqlerrm; end;
end $$;
update public.profiles set is_admin = true where id = '99000000-0000-0000-0000-0000000000a2';

-- ---------------------------------------------------------------- message safety
-- 205 members in the eligible batches with no registration: a big audience
insert into auth.users (id, email, raw_user_meta_data)
  select ('99100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'bulk' || g || '@x99.com', '{"full_name":"Bulk Member"}' from generate_series(1, 205) g;
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', grad_year = 2001, branch = 'Civil Engineering', city = 'Bulkton'
 where id::text like '99100000-%';
update public.events set eligible_from_year = 1990, eligible_to_year = 2020 where id = '99000000-0000-0000-0000-0000000000e1';

select pg_temp.login('99000000-0000-0000-0000-0000000000b2');
set local role authenticated;
do $$
declare
  p jsonb;
  m public.event_messages;
begin
  p := public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{"segment":"not_registered","city":"Bulkton"}');
  assert (p ->> 'count')::int = 205 and (p ->> 'needs_approval')::boolean, 'preview says approval is needed';
  p := public.admin_message_preview('99000000-0000-0000-0000-0000000000e1', '{"segment":"registered"}');
  assert not (p ->> 'needs_approval')::boolean, 'a small audience needs no approval';

  m := public.admin_send_event_message('99000000-0000-0000-0000-0000000000e1', 'announcement', 'Big news', 'Everyone should know this', '{"segment":"not_registered","city":"Bulkton"}');
  assert m.status = 'pending_approval', 'big audience waits for approval, got ' || m.status;
  assert public.t99_fails(format($q$select public.admin_review_event_message(%L, true)$q$, m.id)) is not null, 'a content manager cannot approve';
  perform set_config('t99.big', m.id::text, true);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id::text like '99100000-%') = 0, 'nobody was notified yet';
end $$;

select pg_temp.login('99000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare
  big uuid := current_setting('t99.big')::uuid;
  m public.event_messages;
begin
  assert (select count(*) from jsonb_array_elements(public.admin_inbox() -> 'items') x where x ->> 'kind' = 'approval') = 1, 'admin sees it in the inbox';
  assert (public.admin_attention() -> 'global' ->> 'messages_to_approve')::int = 1, 'and in the attention queue';
  m := public.admin_review_event_message(big, true, 'looks fine');
  assert m.status = 'sent' and m.recipient_count = 205, 'approved and sent to everyone: ' || m.status || ' ' || coalesce(m.recipient_count, -1);
  assert m.reviewed_by = '99000000-0000-0000-0000-0000000000a1', 'reviewer recorded';
  assert public.t99_fails(format($q$select public.admin_review_event_message(%L, true)$q$, big)) like '%already%', 'cannot approve twice';
  assert exists (select 1 from public.admin_audit where action = 'approve_event_message' and actor = '99000000-0000-0000-0000-0000000000a1'), 'approval logged';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id::text like '99100000-%') = 205, 'all 205 were notified';
end $$;

-- an admin cannot approve their own big message; a rejected one is never sent; the author can still withdraw it
select pg_temp.login('99000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare
  m public.event_messages;
begin
  m := public.admin_send_event_message('99000000-0000-0000-0000-0000000000e1', 'announcement', 'Second big', 'Another note for all', '{"segment":"not_registered","city":"Bulkton"}');
  assert m.status = 'pending_approval', 'admin too needs a second admin';
  assert public.t99_fails(format($q$select public.admin_review_event_message(%L, true)$q$, m.id)) like '%second admin%', 'cannot approve own message';
  perform set_config('t99.big2', m.id::text, true);
  m := public.admin_send_event_message('99000000-0000-0000-0000-0000000000e1', 'announcement', 'Third big', 'Yet another note', '{"segment":"not_registered","city":"Bulkton"}');
  perform public.admin_cancel_event_message(m.id);
  assert (select status from public.event_messages where id = m.id) = 'cancelled', 'author withdrew a pending message';
end $$;
reset role;
select pg_temp.login('99000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$
declare m public.event_messages;
begin
  m := public.admin_review_event_message(current_setting('t99.big2')::uuid, false, 'not now');
  assert m.status = 'rejected' and m.review_note = 'not now', 'rejected with a note';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id::text like '99100000-%' and body like 'Second big%') = 0, 'a rejected message is never delivered';
end $$;

-- per-sender rate limit: ten messages an hour
select pg_temp.login('99000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$
declare i int;
begin
  for i in 1..10 loop
    perform public.admin_send_event_message('99000000-0000-0000-0000-0000000000e2', 'announcement', 'Msg ' || i, 'Text number ' || i, '{"segment":"registered"}');
  end loop;
  assert public.t99_fails($q$select public.admin_send_event_message('99000000-0000-0000-0000-0000000000e2', 'announcement', 'Msg 11', 'One too many', '{"segment":"registered"}')$q$) like '%10 messages in the last hour%', 'the eleventh message is refused';
end $$;
reset role;

-- ---------------------------------------------------------------- activity log: filter and search
select pg_temp.login('99000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.admin_audit_search(array['role_grant', 'role_revoke'])) >= 4, 'filter by action';
  assert (select count(*) from public.admin_audit_search(array['role_grant', 'role_revoke'])) = (select count(*) from public.admin_audit where action in ('role_grant', 'role_revoke')), 'only those actions';
  assert (select count(*) from public.admin_audit_search(null, '99000000-0000-0000-0000-0000000000b3')) >= 2, 'filter by actor (the moderator)';
  assert (select count(*) from public.admin_audit_search(null, null, 'meera')) >= 1, 'search by a person''s name (the actor)';
  assert (select count(*) from public.admin_audit_search(null, null, 'Roles Two')) >= 1, 'search inside the details';
  assert (select count(*) from public.admin_audit_search(null, null, 'zzzz-nothing')) = 0, 'no match, no rows';
  assert (select count(*) from public.admin_audit_search(null, null, null, now() + interval '1 day')) = 0, 'date filter';
  assert (select count(*) from public.admin_audit_search(null, null, null, null, null, 3)) = 3, 'limit respected';
  assert (select count(*) from public.admin_audit_search(null, null, null, null, null, 3, (select max(id) from public.admin_audit))) = 3, 'paging by id';
end $$;
reset role;

-- ---------------------------------------------------------------- view as member: read-only, no contact details, logged
select pg_temp.login('99000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare v jsonb; n0 bigint;
begin
  select count(*) into n0 from public.event_payments;
  v := public.admin_view_as_member('99000000-0000-0000-0000-0000000000c1');
  assert v -> 'profile' ->> 'full_name' = 'Xavier Member', 'the member''s own card';
  assert jsonb_array_length(v -> 'registrations') = 1 and v -> 'registrations' -> 0 ->> 'code' = 'JEC-RL0001', 'their registration';
  assert v::text !~ '98765' and v::text !~ 'x99\.com', 'no phone or e-mail';
  assert exists (select 1 from public.admin_audit where action = 'view_as_member' and target_id = '99000000-0000-0000-0000-0000000000c1'), 'logged';
  assert (select count(*) from public.event_payments) = n0, 'changes nothing';
  assert public.t99_fails($q$select public.admin_view_as_member('99000000-0000-0000-0000-0000000000ff')$q$) like '%no longer exists%', 'unknown member';
end $$;
reset role;

-- ---------------------------------------------------------------- unified inbox for a treasurer: refund owed + waiting list
update public.event_registrations set status = 'cancelled' where id = '99000000-0000-0000-0000-0000000000d1';
insert into public.event_waitlist (event_id, user_id, headcount, status) values ('99000000-0000-0000-0000-0000000000e1', '99000000-0000-0000-0000-0000000000c2', 1, 'waiting');
select pg_temp.login('99000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$
declare items jsonb;
begin
  items := public.admin_inbox() -> 'items';
  assert exists (select 1 from jsonb_array_elements(items) x where x ->> 'kind' = 'refund' and x ->> 'title' like '%Xavier%'), 'refund owed shows up';
  assert exists (select 1 from jsonb_array_elements(items) x where x ->> 'kind' = 'waitlist'), 'waiting list shows up';
end $$;
reset role;

select 'ALL ROLES AND MODERATION TESTS PASSED';
rollback;
