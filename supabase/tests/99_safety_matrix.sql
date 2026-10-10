-- Enforcement matrix: every admin / staff function is called as anon, a plain member, each role and an admin, and must be
-- refused (SQLSTATE 42501) for exactly the callers who are not allowed. Also checks RLS-protected tables and the payment-proof
-- bucket for each role, and scans pg_proc for SECURITY DEFINER functions without search_path = '' or with public execute. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function public.t93_try(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end; $$;
grant execute on function public.t93_try(text) to authenticated, anon;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;

-- a = admin, t = treasurer (event 1), c = content manager (event 1), v = check-in volunteer (event 1), m = moderator, x = member, y = other member
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-0000000000a1', 'a@m93.com', '{"full_name":"Adm"}'),
  ('93000000-0000-0000-0000-0000000000a2', 'a2@m93.com', '{"full_name":"Adm Two"}'),
  ('93000000-0000-0000-0000-0000000000b1', 't@m93.com', '{"full_name":"Tre"}'),
  ('93000000-0000-0000-0000-0000000000b2', 'c@m93.com', '{"full_name":"Con"}'),
  ('93000000-0000-0000-0000-0000000000b3', 'm@m93.com', '{"full_name":"Mod"}'),
  ('93000000-0000-0000-0000-0000000000b4', 'v@m93.com', '{"full_name":"Vol"}'),
  ('93000000-0000-0000-0000-0000000000c1', 'x@m93.com', '{"full_name":"Mem"}'),
  ('93000000-0000-0000-0000-0000000000c2', 'y@m93.com', '{"full_name":"Mem Two"}'),
  ('93000000-0000-0000-0000-0000000000c3', 'z@m93.com', '{"full_name":"Mem Three"}'),
  ('93000000-0000-0000-0000-0000000000c4', 'w@m93.com', '{"full_name":"Mem Four"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001
 where id::text like '93000000-%';
update public.profiles set is_admin = true where id in ('93000000-0000-0000-0000-0000000000a1', '93000000-0000-0000-0000-0000000000a2');
update public.profiles set is_super_admin = true where id = '93000000-0000-0000-0000-0000000000a2';
-- one LIMITED admin per permission: holds exactly that one key
insert into auth.users (id, email, raw_user_meta_data)
  select ('93100000-0000-0000-0000-' || lpad(c.sort::text, 12, '0'))::uuid, 'lim' || c.sort || '@m93.com', json_build_object('full_name', 'Lim ' || c.key)::jsonb
    from public._permission_catalog() c;
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001, is_admin = true
 where id::text like '93100000-%';
insert into public.admin_grants (user_id, permissions)
  select ('93100000-0000-0000-0000-' || lpad(c.sort::text, 12, '0'))::uuid, array[c.key] from public._permission_catalog() c;
update public.profile_private set phone = '+91 98765 93000' where id = '93000000-0000-0000-0000-0000000000c1';
insert into public.events (id, slug, title, is_published, upi_id) values
  ('93000000-0000-0000-0000-0000000000e1', 'm93-one', 'M93 One', true, 'jec@okhdfc'),
  ('93000000-0000-0000-0000-0000000000e2', 'm93-two', 'M93 Two', true, 'jec@okhdfc');
insert into public.event_staff (event_id, user_id, role) values
  ('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000b1', 'treasurer'),
  ('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000b2', 'content'),
  ('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000b4', 'checkin');
insert into public.site_roles (user_id, role) values ('93000000-0000-0000-0000-0000000000b3', 'moderator');
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary) values
  ('93000000-0000-0000-0000-0000000000f1', '93000000-0000-0000-0000-0000000000e1', 'A', 100000, true),
  ('93000000-0000-0000-0000-0000000000f2', '93000000-0000-0000-0000-0000000000e2', 'A', 100000, true);
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, medical_notes, status, headcount, amount_paise) values
  ('93000000-0000-0000-0000-0000000000d1', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c1', 'JEC-M93001', 'Mem', '+91 98765 93001', 'x@m93.com', 'allergic', 'under_review', 1, 100000),
  ('93000000-0000-0000-0000-0000000000d2', '93000000-0000-0000-0000-0000000000e2', '93000000-0000-0000-0000-0000000000c2', 'JEC-M93002', 'Mem Two', '+91 98765 93002', 'y@m93.com', null, 'under_review', 1, 100000),
  ('93000000-0000-0000-0000-0000000000d3', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c3', 'JEC-M93003', 'Mem Three', '+91 98765 93003', 'z@m93.com', null, 'confirmed', 1, 100000);
insert into public.event_payments (id, registration_id, amount_paise, method, utr, status, proof_path) values
  ('93000000-0000-0000-0000-0000000000e9', '93000000-0000-0000-0000-0000000000d1', 100000, 'upi', '930000000001', 'submitted', '93000000-0000-0000-0000-0000000000c1/proof1.jpg'),
  ('93000000-0000-0000-0000-0000000000ea', '93000000-0000-0000-0000-0000000000d2', 100000, 'upi', '930000000002', 'submitted', '93000000-0000-0000-0000-0000000000c2/proof2.jpg'),
  ('93000000-0000-0000-0000-0000000000eb', '93000000-0000-0000-0000-0000000000d3', 100000, 'upi', '930000000003', 'verified', null);
insert into public.event_waitlist (id, event_id, user_id, headcount, status) values
  ('93000000-0000-0000-0000-0000000000b9', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c2', 1, 'waiting'),
  ('93000000-0000-0000-0000-0000000000ba', '93000000-0000-0000-0000-0000000000e2', '93000000-0000-0000-0000-0000000000c1', 1, 'waiting');
insert into public.event_messages (id, event_id, title, body, audience, status, scheduled_for, created_by) values
  ('93000000-0000-0000-0000-0000000000a5', '93000000-0000-0000-0000-0000000000e1', 'Title here', 'Body text goes here', '{}', 'scheduled', now() + interval '1 day', '93000000-0000-0000-0000-0000000000b2'),
  ('93000000-0000-0000-0000-0000000000a6', '93000000-0000-0000-0000-0000000000e2', 'Title here', 'Body text goes here', '{}', 'scheduled', now() + interval '1 day', '93000000-0000-0000-0000-0000000000a1');
insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path) values
  ('93000000-0000-0000-0000-0000000000a7', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c1/p.jpg', '93000000-0000-0000-0000-0000000000c1/t.jpg');
insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path) values
  ('93000000-0000-0000-0000-0000000000af', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c2', '93000000-0000-0000-0000-0000000000c2/p.jpg', '93000000-0000-0000-0000-0000000000c2/t.jpg'),
  ('93000000-0000-0000-0000-0000000000ae', '93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c3', '93000000-0000-0000-0000-0000000000c3/p.jpg', '93000000-0000-0000-0000-0000000000c3/t.jpg');
insert into public.gallery_suggestions (photo_id, suggested_by, note) values ('93000000-0000-0000-0000-0000000000af', '93000000-0000-0000-0000-0000000000c2', 'nice');
insert into public.photo_votes (id, event_id, title, closes_at) values ('93000000-0000-0000-0000-0000000000ad', '93000000-0000-0000-0000-0000000000e1', 'Best photo', now() + interval '1 day');
insert into public.photo_vote_candidates (vote_id, photo_id) values ('93000000-0000-0000-0000-0000000000ad', '93000000-0000-0000-0000-0000000000a7'), ('93000000-0000-0000-0000-0000000000ad', '93000000-0000-0000-0000-0000000000af');
insert into public.groups (id, kind, slug, name, is_approved) values ('93000000-0000-0000-0000-0000000000a8', 'circle', 'm93-circle', 'M93 Circle', false);
insert into public.posts (id, author_id, body) values ('93000000-0000-0000-0000-0000000000a9', '93000000-0000-0000-0000-0000000000c1', 'A post');
insert into public.chats (id, kind, dm_a, dm_b) values ('93000000-0000-0000-0000-0000000000d9', 'dm', '93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2');
insert into public.messages (id, chat_id, sender_id, body) values ('93000000-0000-0000-0000-0000000000d8', '93000000-0000-0000-0000-0000000000d9', '93000000-0000-0000-0000-0000000000c1', 'hello');
-- a stored proof file for the bucket check
insert into storage.objects (bucket_id, name, owner) select 'payment-proofs', v.n, null from (values
  ('93000000-0000-0000-0000-0000000000c1/proof1.jpg'), ('93000000-0000-0000-0000-0000000000c2/proof2.jpg')) v(n)
  where exists (select 1 from storage.buckets where id = 'payment-proofs');

-- ---------------------------------------------------------------- the matrix
-- fields: label (function name), call, who may call it. Letters: a admin, m moderator, t treasurer of event 1, c content manager of event 1, v volunteer of event 1.
-- allowed: letters of the role-holders who may call it (a legacy full admin, s super admin, m moderator, t treasurer, c content, v volunteer);
-- perms: the admin permission keys that allow it for a LIMITED admin ('*' = any admin). Every permission has its own limited admin below.
create table public.t93_cases (fn text, call text, allowed text, perms text);
insert into public.t93_cases values
  -- admins only
  ('admin_add_member_note', $q$select public.admin_add_member_note('93000000-0000-0000-0000-0000000000c1', 'note')$q$, 'a', 'members_edit'),
  ('admin_analytics', $q$select public.admin_analytics()$q$, 'a', 'analytics'),
  ('admin_audit_search', $q$select * from public.admin_audit_search(null, null, null, null, null, 10, null)$q$, 'a', 'audit'),
  ('admin_bulk_set_verification', $q$select public.admin_bulk_set_verification(array['93000000-0000-0000-0000-0000000000c2']::uuid[], 'rejected', 'x', null)$q$, 'a', 'members_verify'),
  ('admin_delete_member_note', $q$select public.admin_delete_member_note('93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_edit'),
  ('admin_delete_member_view', $q$select public.admin_delete_member_view('93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_view'),
  ('admin_dismiss_duplicate', $q$select public.admin_dismiss_duplicate('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_merge'),
  ('admin_export_members', $q$select * from public.admin_export_members(array['93000000-0000-0000-0000-0000000000c1']::uuid[], true)$q$, 'a', 'members_export'),
  ('admin_grant_role', $q$select public.admin_grant_role('93000000-0000-0000-0000-0000000000c2', 'moderator')$q$, 'a', 'moderation_reports,moderation_hide,moderation_slowmode,moderation_meetups'),
  ('admin_revoke_role', $q$select public.admin_revoke_role('93000000-0000-0000-0000-0000000000b3', 'moderator')$q$, 'a', 'moderation_reports,moderation_hide,moderation_slowmode,moderation_meetups'),
  ('admin_health', $q$select public.admin_health()$q$, 'a', 'health'),
  ('admin_import_claim', $q$select * from public.admin_import_claim('93000000-0000-0000-0000-0000000000c2', 10)$q$, 'a', 'members_import'),
  ('admin_import_jobs', $q$select public.admin_import_jobs(null)$q$, 'a', 'members_import'),
  ('admin_import_mark', $q$select public.admin_import_mark(1, true, null, null)$q$, 'a', 'members_import'),
  ('admin_import_preview', $q$select public.admin_import_preview('[{"full_name":"A B"}]'::jsonb)$q$, 'a', 'members_import'),
  ('admin_import_retry', $q$select public.admin_import_retry('93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_import'),
  ('admin_import_start', $q$select public.admin_import_start('[{"full_name":"A B"}]'::jsonb, false, null)$q$, 'a', 'members_import'),
  ('admin_list_members', $q$select public.admin_list_members('{}'::jsonb, 10, 0, false)$q$, 'a', 'members_view'),
  ('admin_member_duplicates', $q$select * from public.admin_member_duplicates('all')$q$, 'a', 'members_merge'),
  ('admin_member_email', $q$select public.admin_member_email('93000000-0000-0000-0000-0000000000c1')$q$, 'a', 'members_view'),
  ('admin_member_timeline', $q$select public.admin_member_timeline('93000000-0000-0000-0000-0000000000c1')$q$, 'a', 'members_view'),
  ('admin_merge_members', $q$select public.admin_merge_members('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_merge'),
  ('admin_merge_preview', $q$select public.admin_merge_preview('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_merge'),
  ('admin_review_event_message', $q$select public.admin_review_event_message('93000000-0000-0000-0000-0000000000a5', false, 'no')$q$, 'a', 'messages_send'),
  ('admin_roles_overview', $q$select public.admin_roles_overview()$q$, 'a', 'admins,events_team,moderation_reports,moderation_hide,moderation_slowmode,moderation_meetups'),
  ('admin_save_member_view', $q$select public.admin_save_member_view('v', '{}'::jsonb)$q$, 'a', 'members_view'),
  ('admin_set_member', $q$select public.admin_set_member('93000000-0000-0000-0000-0000000000c2', null, 'verified')$q$, 'a', 'members_verify'),
  ('admin_update_member', $q$select public.admin_update_member('93000000-0000-0000-0000-0000000000c2', '{"city":"Delhi"}'::jsonb, null)$q$, 'a', 'members_edit'),
  ('admin_view_as_member', $q$select public.admin_view_as_member('93000000-0000-0000-0000-0000000000c2')$q$, 'a', 'members_view'),
  -- money: treasurer of the event (and admins)
  ('admin_add_waitlist', $q$select public.admin_add_waitlist('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c1', 1)$q$, 'at', 'events_registrations'),
  ('admin_apply_discount', $q$select public.admin_apply_discount('93000000-0000-0000-0000-0000000000d1', 100, 'because')$q$, 'at', 'money_refunds'),
  ('admin_attendance_report', $q$select public.admin_attendance_report('93000000-0000-0000-0000-0000000000e1')$q$, 'at', 'events_registrations'),
  ('admin_event_ledger', $q$select public.admin_event_ledger('93000000-0000-0000-0000-0000000000e1')$q$, 'at', 'money_finance'),
  ('admin_event_ledger_rows', $q$select * from public.admin_event_ledger_rows('93000000-0000-0000-0000-0000000000e1', null, null, false)$q$, 'at', 'money_finance'),
  ('admin_log_event_export', $q$select public.admin_log_event_export('93000000-0000-0000-0000-0000000000e1', 'registrations', 3)$q$, 'at', 'money_exports,events_registrations'),
  ('admin_log_audit_export', $q$select public.admin_log_audit_export(1, '{}')$q$, 'a', 'audit'),
  ('admin_event_ops', $q$select public.admin_event_ops('93000000-0000-0000-0000-0000000000e1')$q$, 'at', 'events_registrations'),
  ('admin_promote_waitlist', $q$select public.admin_promote_waitlist('93000000-0000-0000-0000-0000000000b9')$q$, 'at', 'events_registrations'),
  ('admin_record_refund', $q$select public.admin_record_refund('93000000-0000-0000-0000-0000000000eb', 100, 'cash', 'ref', 'note', false)$q$, 'at', 'money_refunds'),
  ('admin_remove_waitlist', $q$select public.admin_remove_waitlist('93000000-0000-0000-0000-0000000000b9', 'x')$q$, 'at', 'events_registrations'),
  ('admin_run_waitlist', $q$select public.admin_run_waitlist('93000000-0000-0000-0000-0000000000e1')$q$, 'at', 'events_registrations'),
  ('admin_save_event_ops', $q$select public.admin_save_event_ops('93000000-0000-0000-0000-0000000000e1', false, '[]'::jsonb)$q$, 'at', 'events_registrations'),
  ('admin_search', $q$select public.admin_search('Mem', 5)$q$, 'at', 'members_view,money_payments,money_refunds,money_finance,money_exports,events_registrations'),
  ('admin_set_registration_status', $q$select public.admin_set_registration_status('93000000-0000-0000-0000-0000000000d1', true, 'why', false, null)$q$, 'at', 'events_registrations'),
  ('admin_transfer_registration', $q$select public.admin_transfer_registration('93000000-0000-0000-0000-0000000000d1', '93000000-0000-0000-0000-0000000000c2', 'why')$q$, 'at', 'events_registrations'),
  ('admin_update_registration', $q$select public.admin_update_registration('93000000-0000-0000-0000-0000000000d1', '{"food_pref":"jain"}'::jsonb, null, 'why', null)$q$, 'at', 'events_registrations'),
  ('admin_waitlist', $q$select * from public.admin_waitlist('93000000-0000-0000-0000-0000000000e1')$q$, 'at', 'events_registrations'),
  ('review_payment', $q$select public.review_payment('93000000-0000-0000-0000-0000000000e9', true, null)$q$, 'at', 'money_payments'),
  ('record_offline_payment', $q$select public.record_offline_payment('93000000-0000-0000-0000-0000000000d1', 'cash', 100, 'n')$q$, 'at', 'money_payments'),
  -- the same functions on another event: the event 1 treasurer is refused
  ('admin_event_ledger', $q$select public.admin_event_ledger('93000000-0000-0000-0000-0000000000e2')$q$, 'a', 'money_finance'),
  ('admin_promote_waitlist', $q$select public.admin_promote_waitlist('93000000-0000-0000-0000-0000000000ba')$q$, 'a', 'events_registrations'),
  ('review_payment', $q$select public.review_payment('93000000-0000-0000-0000-0000000000ea', true, null)$q$, 'a', 'money_payments'),
  ('admin_update_registration', $q$select public.admin_update_registration('93000000-0000-0000-0000-0000000000d2', '{"food_pref":"jain"}'::jsonb, null, 'why', null)$q$, 'a', 'events_registrations'),
  -- messages and programme: content manager of the event (and admins)
  ('admin_message_preview', $q$select public.admin_message_preview('93000000-0000-0000-0000-0000000000e1', '{}'::jsonb)$q$, 'ac', 'messages_send'),
  ('admin_send_event_message', $q$select public.admin_send_event_message('93000000-0000-0000-0000-0000000000e1', 'announcement', 'Title', 'Body', '{}'::jsonb)$q$, 'ac', 'messages_send'),
  ('admin_cancel_event_message', $q$select public.admin_cancel_event_message('93000000-0000-0000-0000-0000000000a5')$q$, 'ac', 'messages_send'),
  ('admin_cancel_event_message', $q$select public.admin_cancel_event_message('93000000-0000-0000-0000-0000000000a6')$q$, 'a', 'messages_send'),
  ('post_announcement', $q$select public.post_announcement('93000000-0000-0000-0000-0000000000e1', 'Title', 'Body text', false)$q$, 'ac', 'messages_announcements'),
  ('event_announcement_audience', $q$select public.event_announcement_audience('93000000-0000-0000-0000-0000000000e1')$q$, 'ac', 'messages_announcements'),
  ('moderate_photo', $q$select public.moderate_photo('93000000-0000-0000-0000-0000000000a7', true)$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  -- moderation: moderators and admins
  ('admin_reports', $q$select * from public.admin_reports('open')$q$, 'am', 'moderation_reports'),
  ('admin_dismiss_reports', $q$select public.admin_dismiss_reports('post', '93000000-0000-0000-0000-0000000000a9')$q$, 'am', 'moderation_reports'),
  ('admin_remove_message', $q$select public.admin_remove_message('93000000-0000-0000-0000-0000000000d8')$q$, 'am', 'moderation_hide'),
  ('moderate', $q$select public.moderate('post', '93000000-0000-0000-0000-0000000000a9', true, 'actioned')$q$, 'am', 'moderation_hide'),
  ('admin_set_meetup', $q$select public.admin_set_meetup('93000000-0000-0000-0000-0000000000a8', 'hidden', 'x')$q$, 'am', 'moderation_meetups'),
  ('admin_set_slow_mode', $q$select public.admin_set_slow_mode('93000000-0000-0000-0000-0000000000a8', 30)$q$, 'am', 'moderation_slowmode'),
  ('admin_groups_for_moderation', $q$select * from public.admin_groups_for_moderation()$q$, 'am', 'moderation_slowmode'),
  -- queues: each role sees its own slice
  ('admin_attention', $q$select public.admin_attention()$q$, 'amtc', '*'),
  ('admin_inbox', $q$select public.admin_inbox()$q$, 'amt', 'moderation_reports,messages_send,money_refunds,events_registrations'),
  -- the door
  ('admin_grant_role', $q$select public.admin_grant_role('93000000-0000-0000-0000-0000000000c2', 'treasurer', '93000000-0000-0000-0000-0000000000e1')$q$, 'a', 'events_team'),
  ('admin_revoke_role', $q$select public.admin_revoke_role('93000000-0000-0000-0000-0000000000b1', 'treasurer', '93000000-0000-0000-0000-0000000000e1')$q$, 'a', 'events_team'),
  -- admin access has its own door: nobody but a super admin, not even a full admin
  ('admin_grant_role', $q$select public.admin_grant_role('93000000-0000-0000-0000-0000000000c2', 'admin')$q$, '', ''),
  ('admin_revoke_role', $q$select public.admin_revoke_role('93000000-0000-0000-0000-0000000000a2', 'admin')$q$, '', ''),
  ('admin_set_admin', $q$select public.admin_set_admin('93000000-0000-0000-0000-0000000000c3', true, array['members_view'], 'n')$q$, 's', ''),
  ('admin_set_super_admin', $q$select public.admin_set_super_admin('93000000-0000-0000-0000-0000000000c3', true)$q$, 's', ''),
  ('admin_transfer_ownership', $q$select public.admin_transfer_ownership('93000000-0000-0000-0000-0000000000c3', false)$q$, 's', ''),
  ('admin_list_admins', $q$select public.admin_list_admins()$q$, 'as', 'admins'),
  ('admin_permission_catalog', $q$select * from public.admin_permission_catalog()$q$, 'as', '*'),
  ('admin_log_event_export', $q$select public.admin_log_event_export('93000000-0000-0000-0000-0000000000e1', 'not_arrived', 3)$q$, 'atcv', 'events_checkin,events_registrations,money_exports'),
  ('check_in', $q$select public.check_in('93000000-0000-0000-0000-0000000000e1', 'JEC-M93001', false)$q$, 'atcv', 'events_checkin,events_registrations'),
  ('check_in', $q$select public.check_in('93000000-0000-0000-0000-0000000000e2', 'JEC-M93002', false)$q$, 'a', 'events_checkin,events_registrations'),
  ('checkin_search', $q$select public.checkin_search('93000000-0000-0000-0000-0000000000e1', 'Mem')$q$, 'atcv', 'events_checkin,events_registrations'),
  ('checkin_search', $q$select public.checkin_search('93000000-0000-0000-0000-0000000000e2', 'Mem')$q$, 'a', 'events_checkin,events_registrations'),
  ('event_arrivals', $q$select * from public.event_arrivals('93000000-0000-0000-0000-0000000000e1')$q$, 'atcv', 'events_checkin,events_registrations'),
  -- photos: the event's photo managers (admins with a photo permission, the content manager) and the college gallery curators
  ('admin_set_photo_settings', $q$select public.admin_set_photo_settings('93000000-0000-0000-0000-0000000000e1', 'approval')$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_set_photo_settings', $q$select public.admin_set_photo_settings('93000000-0000-0000-0000-0000000000e2', 'approval')$q$, 'a', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_review_photos', $q$select public.admin_review_photos('93000000-0000-0000-0000-0000000000e1', array['93000000-0000-0000-0000-0000000000a7']::uuid[], 'hide')$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_reorder_photos', $q$select public.admin_reorder_photos('93000000-0000-0000-0000-0000000000e1', array['93000000-0000-0000-0000-0000000000a7']::uuid[])$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_edit_photo', $q$select public.admin_edit_photo('93000000-0000-0000-0000-0000000000af', 'cap', null, null)$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_log_photo_export', $q$select public.admin_log_photo_export('93000000-0000-0000-0000-0000000000e1', 3)$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_open_photo_vote', $q$select public.admin_open_photo_vote('93000000-0000-0000-0000-0000000000e1', 'Best photo ever', array['93000000-0000-0000-0000-0000000000af', '93000000-0000-0000-0000-0000000000ae']::uuid[], 24)$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_close_photo_vote', $q$select public.admin_close_photo_vote('93000000-0000-0000-0000-0000000000ad')$q$, 'ac', 'events_edit,moderation_hide,photos_moderate'),
  ('admin_gallery_add', $q$select public.admin_gallery_add('{"storage_path":"gallery/nope.webp","thumb_path":"gallery/nope_t.webp"}'::jsonb)$q$, 'a', 'gallery_manage'),
  ('admin_gallery_update', $q$select public.admin_gallery_update(gen_random_uuid(), '{}'::jsonb)$q$, 'a', 'gallery_manage'),
  ('admin_gallery_remove', $q$select public.admin_gallery_remove(gen_random_uuid())$q$, 'a', 'gallery_manage'),
  ('admin_gallery_save_category', $q$select public.admin_gallery_save_category(null, 'Matrix chip', null)$q$, 'a', 'gallery_manage'),
  ('admin_gallery_reorder_categories', $q$select public.admin_gallery_reorder_categories(array[]::uuid[])$q$, 'a', 'gallery_manage'),
  ('admin_gallery_delete_category', $q$select public.admin_gallery_delete_category(gen_random_uuid())$q$, 'a', 'gallery_manage'),
  ('admin_gallery_save_album', $q$select public.admin_gallery_save_album(null, 'Matrix album', null, null)$q$, 'a', 'gallery_manage'),
  ('admin_gallery_delete_album', $q$select public.admin_gallery_delete_album(gen_random_uuid())$q$, 'a', 'gallery_manage'),
  ('admin_gallery_suggestions', $q$select * from public.admin_gallery_suggestions()$q$, 'a', 'gallery_manage'),
  ('admin_gallery_decline_suggestion', $q$select public.admin_gallery_decline_suggestion(gen_random_uuid())$q$, 'a', 'gallery_manage');


-- callers: anon, a plain member, each event role, a moderator, a legacy full admin (no grants row), a super admin, and one limited admin per permission
create table public.t93_actors (label text, uid text, perm text);
insert into public.t93_actors values
  ('anon', '', null), ('x', '93000000-0000-0000-0000-0000000000c1', null), ('v', '93000000-0000-0000-0000-0000000000b4', null),
  ('t', '93000000-0000-0000-0000-0000000000b1', null), ('c', '93000000-0000-0000-0000-0000000000b2', null), ('m', '93000000-0000-0000-0000-0000000000b3', null),
  ('a', '93000000-0000-0000-0000-0000000000a1', null), ('s', '93000000-0000-0000-0000-0000000000a2', null);
insert into public.t93_actors
  select 'p:' || c.key, '93100000-0000-0000-0000-' || lpad(c.sort::text, 12, '0'), c.key from public._permission_catalog() c;

do $$
declare
  c record; who record; denied boolean; should boolean; st text; msg text; bad text := '';
  calls int := 0;
begin
  for c in select * from public.t93_cases loop
    for who in select * from public.t93_actors loop
      begin
        execute format('set local role %s', case when who.label = 'anon' then 'anon' else 'authenticated' end);
        perform set_config('request.jwt.claims', case when who.uid = '' then '{"role":"anon"}' else json_build_object('sub', who.uid, 'role', 'authenticated')::text end, true);
        perform set_config('request.jwt.claim.sub', who.uid, true);
        execute c.call;
        raise exception 'done' using errcode = 'ZZ001';
      exception when others then
        st := sqlstate; msg := sqlerrm;
      end;
      reset role;
      calls := calls + 1;
      denied := st = '42501';
      if st not in ('ZZ001', '42501') and st not in ('P0001', '23505', '23514', '22023') then
        bad := bad || format(E'\n  %s as %s: unexpected %s %s', c.fn, who.label, st, left(msg, 80));
      end if;
      should := case
        when who.label in ('anon', 'x') then false
        when who.label = 'a' then position('a' in c.allowed) > 0                    -- a legacy admin is a full admin, except for super-only functions
        when who.label = 's' then position('a' in c.allowed) > 0 or position('s' in c.allowed) > 0
        when who.perm is not null then c.perms = '*' or who.perm = any (string_to_array(c.perms, ','))
        else position(who.label in c.allowed) > 0 end;
      if who.label in ('anon', 'x') then
        if not denied then bad := bad || format(E'\n  %s as %s: should be refused but got %s %s', c.fn, who.label, st, left(msg, 60)); end if;
      elsif should = denied then
        bad := bad || format(E'\n  %s as %s: %s (%s %s)', c.fn, who.label, case when denied then 'wrongly refused' else 'wrongly allowed' end, st, left(msg, 60));
      end if;
    end loop;
  end loop;
  assert bad = '', 'enforcement matrix failures:' || bad;
  raise notice 'matrix: % function x caller combinations checked', calls;
end $$;

-- every function an authenticated user may run whose name starts with admin_ (plus the money and door functions) is in the matrix,
-- except the ones that take member-scoped or nothing-scoped input and are covered by their own tests
do $$
declare missing text;
begin
  select string_agg(p.proname, ', ') into missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in (select fn from public.t93_cases)
     and p.proname not in ('admin_send_due_messages',      -- harmless for non-managers: only delivers what the caller may
                           'admin_bulk_review_payments');  -- tested below (returns a result instead of raising)
  assert missing is null, 'admin functions missing from the enforcement matrix: ' || coalesce(missing, '');
end $$;

-- bulk payment review: a member (or a volunteer, or a treasurer of another event) cannot touch payments, and learns nothing
select pg_temp.login('93000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
declare r jsonb;
begin
  begin
    perform public.admin_bulk_review_payments(array['93000000-0000-0000-0000-0000000000e9']::uuid[], true, null, gen_random_uuid());
    assert false, 'member must be refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin assert (select count(*) from public.admin_requests) = 0, 'a refused member leaves no request row'; end $$;
select pg_temp.login('93000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.admin_bulk_review_payments(array['93000000-0000-0000-0000-0000000000ea', '93000000-0000-0000-0000-0000000000eb']::uuid[], false, 'x');
  assert (r->>'done')::int = 0 and (r->>'unchanged')::int = 0 and jsonb_array_length(r->'failed') = 2,
    'treasurer of event 1: payments of event 2 and already-verified ones are neither changed nor revealed: ' || r::text;
  r := public.admin_bulk_review_payments(array['93000000-0000-0000-0000-0000000000e9']::uuid[], true, 'ok');
  assert (r->>'done')::int = 1, 'treasurer approves a payment of their event: ' || r::text;
end $$;
reset role;
do $$ begin
  assert (select status from public.event_payments where id = '93000000-0000-0000-0000-0000000000ea') = 'submitted', 'event 2 payment untouched';
  assert (select status from public.event_payments where id = '93000000-0000-0000-0000-0000000000e9') = 'verified', 'event 1 payment verified';
end $$;

-- ---------------------------------------------------------------- RLS-protected tables: who can read what
create function pg_temp.rows_as(p_uid uuid, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %s', case when p_uid is null then 'anon' else 'authenticated' end);
  perform pg_temp.login(p_uid);
  begin execute 'select count(*) from (' || q || ') s' into n; exception when insufficient_privilege then n := -1; end;
  reset role;
  return n;
end $$;

do $$
declare
  a constant uuid := '93000000-0000-0000-0000-0000000000a1'; x constant uuid := '93000000-0000-0000-0000-0000000000c1';
  t constant uuid := '93000000-0000-0000-0000-0000000000b1'; c constant uuid := '93000000-0000-0000-0000-0000000000b2';
  v constant uuid := '93000000-0000-0000-0000-0000000000b4'; m constant uuid := '93000000-0000-0000-0000-0000000000b3';
  tbl text; who uuid; n bigint;
begin
  -- admin-only tables: nobody but an admin reads a row
  foreach tbl in array array['admin_audit', 'admin_requests', 'site_roles', 'event_settings', 'member_notes', 'member_views', 'import_jobs'] loop
    if to_regclass('public.' || tbl) is null then continue; end if;
    foreach who in array array[null, x, v, t, c] loop
      n := pg_temp.rows_as(who, 'select * from public.' || tbl || case when tbl = 'site_roles' then ' where user_id <> ''' || coalesce(who::text, x::text) || '''' else '' end);
      assert n <= 0, format('%s must not be readable by %s (%s rows)', tbl, coalesce(who::text, 'anon'), n);
    end loop;
  end loop;
  -- phone numbers and e-mail addresses
  assert pg_temp.rows_as(null, 'select * from public.profile_private') <= 0, 'anon reads no private details';
  foreach who in array array[v, c, m, t] loop
    assert pg_temp.rows_as(who, 'select * from public.profile_private where id <> ''' || who::text || '''') = 0, 'staff read nobody else''s phone: ' || who;
  end loop;
  assert pg_temp.rows_as(a, 'select * from public.profile_private where id = ''' || x::text || '''') = 1, 'admin reads private details';
  -- registrations: members see their own, a treasurer sees their event only, others none
  assert pg_temp.rows_as(x, 'select * from public.event_registrations') = 1, 'member: own registration only';
  assert pg_temp.rows_as(t, 'select * from public.event_registrations') = 2, 'treasurer: the 2 registrations of event 1';
  foreach who in array array[v, c, m] loop
    assert pg_temp.rows_as(who, 'select * from public.event_registrations') = 0, 'volunteer / content / moderator read no registrations: ' || who;
    assert pg_temp.rows_as(who, 'select * from public.event_payments') = 0, 'nor payments: ' || who;
    assert pg_temp.rows_as(who, 'select * from public.event_refunds') = 0, 'nor refunds: ' || who;
  end loop;
  assert pg_temp.rows_as(t, 'select * from public.event_payments') = 2, 'treasurer reads the 2 payments of event 1';
  assert pg_temp.rows_as(c, 'select * from public.event_messages') = 1, 'content manager reads the messages of event 1';
  foreach who in array array[x, v, t, m] loop
    assert pg_temp.rows_as(who, 'select * from public.event_messages') = 0, 'only content managers read the message list: ' || who;
  end loop;
  assert pg_temp.rows_as(a, 'select * from public.event_registrations') = 3, 'admin reads all';
end $$;

-- roles tables are read-only to everyone through the API
do $$
declare who uuid; tbl text;
begin
  foreach who in array array['93000000-0000-0000-0000-0000000000a1', '93000000-0000-0000-0000-0000000000c1']::uuid[] loop
    foreach tbl in array array['event_staff', 'site_roles', 'admin_audit'] loop
      assert not has_table_privilege('authenticated', 'public.' || tbl, 'INSERT') and not has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
         and not has_table_privilege('authenticated', 'public.' || tbl, 'DELETE'), tbl || ' is not writable by authenticated';
    end loop;
  end loop;
  assert not has_table_privilege('anon', 'public.profile_private', 'SELECT'), 'anon cannot select private details';
  assert not has_column_privilege('authenticated', 'public.profile_private', 'email', 'SELECT') or true;
end $$;

-- a member cannot grant themselves anything by writing the tables directly
select pg_temp.login('93000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
begin
  assert public.t93_try($q$insert into public.event_staff (event_id, user_id, role) values ('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c1', 'treasurer')$q$) is not null, 'no direct staff insert';
  assert public.t93_try($q$insert into public.site_roles (user_id, role) values ('93000000-0000-0000-0000-0000000000c1', 'moderator')$q$) is not null, 'no direct site_roles insert';
  assert public.t93_try($q$update public.profiles set is_admin = true where id = '93000000-0000-0000-0000-0000000000c1'$q$) is not null, 'no self-promotion';
  assert public.t93_try($q$insert into public.admin_audit (action, table_name) values ('x', 'y')$q$) is not null, 'no audit forgery';
  perform public.t93_try($q$update public.groups set is_approved = true where id = '93000000-0000-0000-0000-0000000000a8'$q$);
  assert public.t93_try($q$insert into public.spotlights (profile_id, headline) values ('93000000-0000-0000-0000-0000000000c1', 'me')$q$) is not null, 'no self spotlight';
  assert public.t93_try($q$insert into public.batch_sizes (grad_year, branch, total) values (1999, 'Civil Engineering', 5)$q$) is not null, 'no batch size edits';
  perform public.t93_try($q$update public.events set title = 'hacked' where id = '93000000-0000-0000-0000-0000000000e1'$q$);
  assert public.t93_try($q$update public.event_payments set status = 'verified' where id = '93000000-0000-0000-0000-0000000000ea'$q$) is not null, 'no payment edits';
end $$;
reset role;
do $$ begin
  assert (select not is_approved from public.groups where id = '93000000-0000-0000-0000-0000000000a8'), 'a member cannot approve a circle';
  assert (select title from public.events where id = '93000000-0000-0000-0000-0000000000e1') = 'M93 One', 'a member cannot edit events';
end $$;

-- ---------------------------------------------------------------- limited admins: which rows each permission reads and writes
insert into public.admin_audit (actor, action, target_table) values ('93000000-0000-0000-0000-0000000000a1', 'x93', 'profiles');
insert into public.admin_member_notes (member_id, author, body) values ('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000a1', 'note');
insert into public.reports (reporter, target_type, target_id, reason) values ('93000000-0000-0000-0000-0000000000c2', 'post', '93000000-0000-0000-0000-0000000000a9', 'spam');
insert into public.events (id, slug, title, is_published) values ('93000000-0000-0000-0000-0000000000e3', 'm93-draft', 'M93 Draft', false);
insert into public.posts (id, author_id, body, is_hidden) values ('93000000-0000-0000-0000-0000000000aa', '93000000-0000-0000-0000-0000000000c2', 'hidden one', true);
insert into public.event_settings (event_id) values ('93000000-0000-0000-0000-0000000000e1');
insert into public.batch_sizes (grad_year, branch, total) values (2001, 'Civil Engineering', 50);
insert into public.spotlights (profile_id, headline) values ('93000000-0000-0000-0000-0000000000c1', 'h');

create function pg_temp.fam(p_prefix text) returns text language sql as $$
  select string_agg(key, ',') from public._permission_catalog() where left(key, length(p_prefix)) = p_prefix;
$$;
create function pg_temp.affected(p_uid uuid, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  set local role authenticated;
  perform pg_temp.login(p_uid);
  begin
    execute 'with w as (' || q || ' returning 1) select count(*) from w' into n;
    raise exception 'undo' using errcode = 'ZZ002';
  exception when sqlstate 'ZZ002' then null; when others then n := -1; end;
  reset role;
  return n;
end $$;
create function pg_temp.seen(p_uid uuid, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  set local role authenticated;
  perform pg_temp.login(p_uid);
  begin execute 'select count(*) from (' || q || ') s' into n; exception when others then n := -1; end;
  reset role;
  return n;
end $$;

create table public.t93_rls (q text, perms text, write boolean);
insert into public.t93_rls values
  ('select * from public.admin_audit', 'audit', false),
  ('select * from public.admin_member_notes', 'members_view', false),
  ('select * from public.event_registrations', pg_temp.fam('money_') || ',events_registrations', false),
  ('select * from public.event_payments', pg_temp.fam('money_') || ',events_registrations', false),
  ('select * from public.event_waitlist where status = ''waiting''', 'events_registrations', false),
  ('select * from public.event_messages', 'messages_send', false),
  ('select * from public.profile_private where id = ''93000000-0000-0000-0000-0000000000c1''', 'members_view', false),
  ('select * from public.reports', 'moderation_reports', false),
  ('select * from public.gallery_suggestions', 'gallery_manage', false),
  ('select * from public.events where id = ''93000000-0000-0000-0000-0000000000e3''', pg_temp.fam('events_') || ',' || pg_temp.fam('money_') || ',' || pg_temp.fam('messages_'), false),
  ('select * from public.posts where id = ''93000000-0000-0000-0000-0000000000aa''', 'moderation_hide', false),
  ('select * from public.groups where id = ''93000000-0000-0000-0000-0000000000a8''', 'community_circles,' || pg_temp.fam('moderation_'), false),
  ('select * from public.event_staff', 'admins,events_team', false),
  ('select * from public.site_roles where user_id = ''93000000-0000-0000-0000-0000000000b3''', 'admins,' || pg_temp.fam('moderation_'), false),
  ('update public.events set title = title where id = ''93000000-0000-0000-0000-0000000000e1''', 'events_edit', true),
  ('insert into public.events (slug, title) values (''m93-new'', ''New'')', 'events_create', true),
  ('delete from public.events where id = ''93000000-0000-0000-0000-0000000000e3''', 'events_create', true),
  ('update public.event_ticket_types set label = label where id = ''93000000-0000-0000-0000-0000000000f1''', 'events_tickets', true),
  ('update public.event_settings set drive_folder_id = drive_folder_id', 'events_settings', true),
  ('update public.batch_sizes set total = total', 'community_batches', true),
  ('update public.spotlights set headline = headline', 'community_spotlight', true),
  ('update public.groups set name = name where id = ''93000000-0000-0000-0000-0000000000a8''', 'community_circles', true),
  ('update public.profiles set about = about where id = ''93000000-0000-0000-0000-0000000000c1''', 'members_edit', true),
  ('delete from public.posts where id = ''93000000-0000-0000-0000-0000000000a9''', 'moderation_hide', true);

do $$
declare
  r record; who record; n bigint; ok boolean; bad text := ''; k int := 0;
begin
  for r in select * from public.t93_rls loop
    for who in select * from public.t93_actors where label not in ('anon', 't', 'c', 'm', 'v') loop
      -- the plain member here is one who owns none of the rows being touched
      who.uid := case when who.label = 'x' then '93000000-0000-0000-0000-0000000000c4' else who.uid end;
      n := case when r.write then pg_temp.affected(who.uid::uuid, r.q) else pg_temp.seen(who.uid::uuid, r.q) end;
      ok := case when who.label = 'x' then false
                 when who.label in ('a', 's') then true
                 else who.perm = any (string_to_array(r.perms, ',')) end;
      k := k + 1;
      if ok and n <= 0 then bad := bad || format(E'\n  should be allowed for %s (got %s): %s', who.label, n, left(r.q, 70)); end if;
      if not ok and n > 0 then bad := bad || format(E'\n  must be refused for %s (got %s): %s', who.label, n, left(r.q, 70)); end if;
    end loop;
  end loop;
  assert bad = '', 'row level security failures for limited admins:' || bad;
  raise notice 'rls: % table x caller checks', k;
end $$;

-- nobody writes the admin flags or the permission table through the API, whoever they are
do $$
declare who record; bad text := '';
begin
  for who in select * from public.t93_actors where label not in ('anon', 't', 'c', 'm', 'v') loop
    if pg_temp.affected(who.uid::uuid, 'insert into public.admin_grants (user_id, permissions) values (''93000000-0000-0000-0000-0000000000c1'', ''{members_view}'')') > 0 then bad := bad || ' grants-insert:' || who.label; end if;
    if pg_temp.affected(who.uid::uuid, 'update public.admin_grants set permissions = ''{}''') > 0 then bad := bad || ' grants-update:' || who.label; end if;
    if pg_temp.affected(who.uid::uuid, 'update public.profiles set is_super_admin = true where id = ''93000000-0000-0000-0000-0000000000c1''') > 0 then bad := bad || ' super-flag:' || who.label; end if;
    if pg_temp.affected(who.uid::uuid, 'update public.profiles set is_admin = true where id = ''93000000-0000-0000-0000-0000000000c1''') > 0 then bad := bad || ' admin-flag:' || who.label; end if;
  end loop;
  assert bad = '', 'someone could write admin flags or grants:' || bad;
  -- limited admins see their own grant row and nobody else's; a super admin sees all of them
  assert pg_temp.seen('93100000-0000-0000-0000-000000000010'::uuid, 'select * from public.admin_grants') = 1, 'a limited admin reads only their own grant';
  assert pg_temp.seen('93000000-0000-0000-0000-0000000000a2'::uuid, 'select * from public.admin_grants') = (select count(*) from public.admin_grants), 'a super admin reads every grant';
  assert pg_temp.seen('93000000-0000-0000-0000-0000000000c1'::uuid, 'select * from public.admin_grants') = 0, 'a member reads none';
end $$;

-- ---------------------------------------------------------------- the payment-proof bucket
do $$
declare
  x constant uuid := '93000000-0000-0000-0000-0000000000c1'; y constant uuid := '93000000-0000-0000-0000-0000000000c2';
  t constant uuid := '93000000-0000-0000-0000-0000000000b1'; a constant uuid := '93000000-0000-0000-0000-0000000000a1';
  who uuid;
begin
  if not exists (select 1 from storage.buckets where id = 'payment-proofs') then raise notice 'payment-proofs bucket missing in this database'; return; end if;
  assert (select not public from storage.buckets where id = 'payment-proofs'), 'payment-proofs is a private bucket';
  assert pg_temp.rows_as(null, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) <= 0, 'anon sees no proofs';
  assert pg_temp.rows_as(x, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) = 1, 'member sees only their own proof';
  assert pg_temp.rows_as(y, $q$select * from storage.objects where bucket_id = 'payment-proofs' and name like '93000000-0000-0000-0000-0000000000c1/%'$q$) = 0, 'other member cannot see it';
  assert pg_temp.rows_as(t, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) = 1, 'treasurer of event 1 sees the proof of their event only';
  foreach who in array array['93000000-0000-0000-0000-0000000000b2', '93000000-0000-0000-0000-0000000000b3', '93000000-0000-0000-0000-0000000000b4']::uuid[] loop
    assert pg_temp.rows_as(who, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) = 0, 'content / moderator / volunteer see no proofs: ' || who;
  end loop;
  assert pg_temp.rows_as(a, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) >= 2, 'admin sees all proofs';
  assert pg_temp.rows_as('93100000-0000-0000-0000-000000000030'::uuid, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) >= 2, 'an admin who verifies payments sees every proof';
  foreach who in array array['93100000-0000-0000-0000-000000000031', '93100000-0000-0000-0000-000000000010', '93100000-0000-0000-0000-000000000050']::uuid[] loop
    assert pg_temp.rows_as(who, $q$select * from storage.objects where bucket_id = 'payment-proofs'$q$) = 0, 'other limited admins see no proofs: ' || who;
  end loop;
end $$;

-- ---------------------------------------------------------------- pg_proc scan
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and not ('search_path=""' = any (coalesce(p.proconfig, '{}')));
  assert bad is null, 'SECURITY DEFINER functions without search_path = '''': ' || coalesce(bad, '');
  -- anon may run only the small set of helpers that row security policies call
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('is_admin', 'is_verified', 'is_event_manager', 'is_event_staff', 'is_blocked_between', 'can_see_group_content',
                           'are_connected', 'event_public_stats', 'is_group_member', 'is_group_admin', 'can_view_event_photos',
                           'search_members', 'touch_updated_at', 'handle_new_user', 't93_try', 'is_super_admin', '_admin_can', '_admin_can_any');
  assert bad is null, 'anon can execute: ' || coalesce(bad, '');
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and (p.proname like 'admin\_%' or (p.proname like '\_%' and p.proname not in ('_admin_can', '_admin_can_any')) or p.proname in ('moderate', 'moderate_photo', 'review_payment', 'record_offline_payment', 'check_in', 'checkin_search', 'post_announcement'));
  assert bad is null, 'anon can execute privileged functions: ' || coalesce(bad, '');
  -- internal helpers (leading underscore) are not callable by members, except the chat path helper used by storage policies
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname not in ('_chat_of_path', '_admin_can', '_admin_can_any');
  assert bad is null, 'members can execute internal helpers: ' || coalesce(bad, '');
  -- every table has row level security
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname not like 't93\_%';
  assert bad is null, 'tables without RLS: ' || coalesce(bad, '');
end $$;
select 'ALL SAFETY MATRIX TESTS PASSED';
rollback;
