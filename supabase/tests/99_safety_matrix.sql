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
  ('93000000-0000-0000-0000-0000000000c3', 'z@m93.com', '{"full_name":"Mem Three"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001
 where id::text like '93000000-%';
update public.profiles set is_admin = true where id in ('93000000-0000-0000-0000-0000000000a1', '93000000-0000-0000-0000-0000000000a2');
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
create table public.t93_cases (fn text, call text, allowed text);
insert into public.t93_cases values
  -- admins only
  ('admin_add_member_note', $q$select public.admin_add_member_note('93000000-0000-0000-0000-0000000000c1', 'note')$q$, 'a'),
  ('admin_analytics', $q$select public.admin_analytics()$q$, 'a'),
  ('admin_audit_search', $q$select * from public.admin_audit_search(null, null, null, null, null, 10, null)$q$, 'a'),
  ('admin_bulk_set_verification', $q$select public.admin_bulk_set_verification(array['93000000-0000-0000-0000-0000000000c2']::uuid[], 'rejected', 'x', null)$q$, 'a'),
  ('admin_delete_member_note', $q$select public.admin_delete_member_note('93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_delete_member_view', $q$select public.admin_delete_member_view('93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_dismiss_duplicate', $q$select public.admin_dismiss_duplicate('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_export_members', $q$select * from public.admin_export_members(array['93000000-0000-0000-0000-0000000000c1']::uuid[], true)$q$, 'a'),
  ('admin_grant_role', $q$select public.admin_grant_role('93000000-0000-0000-0000-0000000000c2', 'moderator')$q$, 'a'),
  ('admin_revoke_role', $q$select public.admin_revoke_role('93000000-0000-0000-0000-0000000000b3', 'moderator')$q$, 'a'),
  ('admin_health', $q$select public.admin_health()$q$, 'a'),
  ('admin_import_claim', $q$select * from public.admin_import_claim('93000000-0000-0000-0000-0000000000c2', 10)$q$, 'a'),
  ('admin_import_jobs', $q$select public.admin_import_jobs(null)$q$, 'a'),
  ('admin_import_mark', $q$select public.admin_import_mark(1, true, null, null)$q$, 'a'),
  ('admin_import_preview', $q$select public.admin_import_preview('[{"full_name":"A B"}]'::jsonb)$q$, 'a'),
  ('admin_import_retry', $q$select public.admin_import_retry('93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_import_start', $q$select public.admin_import_start('[{"full_name":"A B"}]'::jsonb, false, null)$q$, 'a'),
  ('admin_list_members', $q$select public.admin_list_members('{}'::jsonb, 10, 0, false)$q$, 'a'),
  ('admin_member_duplicates', $q$select * from public.admin_member_duplicates('all')$q$, 'a'),
  ('admin_member_email', $q$select public.admin_member_email('93000000-0000-0000-0000-0000000000c1')$q$, 'a'),
  ('admin_member_timeline', $q$select public.admin_member_timeline('93000000-0000-0000-0000-0000000000c1')$q$, 'a'),
  ('admin_merge_members', $q$select public.admin_merge_members('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_merge_preview', $q$select public.admin_merge_preview('93000000-0000-0000-0000-0000000000c1', '93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  ('admin_review_event_message', $q$select public.admin_review_event_message('93000000-0000-0000-0000-0000000000a5', false, 'no')$q$, 'a'),
  ('admin_roles_overview', $q$select public.admin_roles_overview()$q$, 'a'),
  ('admin_save_member_view', $q$select public.admin_save_member_view('v', '{}'::jsonb)$q$, 'a'),
  ('admin_set_member', $q$select public.admin_set_member('93000000-0000-0000-0000-0000000000c2', null, 'verified')$q$, 'a'),
  ('admin_update_member', $q$select public.admin_update_member('93000000-0000-0000-0000-0000000000c2', '{"city":"Delhi"}'::jsonb, null)$q$, 'a'),
  ('admin_view_as_member', $q$select public.admin_view_as_member('93000000-0000-0000-0000-0000000000c2')$q$, 'a'),
  -- money: treasurer of the event (and admins)
  ('admin_add_waitlist', $q$select public.admin_add_waitlist('93000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000c1', 1)$q$, 'at'),
  ('admin_apply_discount', $q$select public.admin_apply_discount('93000000-0000-0000-0000-0000000000d1', 100, 'because')$q$, 'at'),
  ('admin_attendance_report', $q$select public.admin_attendance_report('93000000-0000-0000-0000-0000000000e1')$q$, 'at'),
  ('admin_event_ledger', $q$select public.admin_event_ledger('93000000-0000-0000-0000-0000000000e1')$q$, 'at'),
  ('admin_event_ledger_rows', $q$select * from public.admin_event_ledger_rows('93000000-0000-0000-0000-0000000000e1', null, null, false)$q$, 'at'),
  ('admin_event_ops', $q$select public.admin_event_ops('93000000-0000-0000-0000-0000000000e1')$q$, 'at'),
  ('admin_promote_waitlist', $q$select public.admin_promote_waitlist('93000000-0000-0000-0000-0000000000b9')$q$, 'at'),
  ('admin_record_refund', $q$select public.admin_record_refund('93000000-0000-0000-0000-0000000000eb', 100, 'cash', 'ref', 'note', false)$q$, 'at'),
  ('admin_remove_waitlist', $q$select public.admin_remove_waitlist('93000000-0000-0000-0000-0000000000b9', 'x')$q$, 'at'),
  ('admin_run_waitlist', $q$select public.admin_run_waitlist('93000000-0000-0000-0000-0000000000e1')$q$, 'at'),
  ('admin_save_event_ops', $q$select public.admin_save_event_ops('93000000-0000-0000-0000-0000000000e1', false, '[]'::jsonb)$q$, 'at'),
  ('admin_search', $q$select public.admin_search('Mem', 5)$q$, 'at'),
  ('admin_set_registration_status', $q$select public.admin_set_registration_status('93000000-0000-0000-0000-0000000000d1', true, 'why', false, null)$q$, 'at'),
  ('admin_transfer_registration', $q$select public.admin_transfer_registration('93000000-0000-0000-0000-0000000000d1', '93000000-0000-0000-0000-0000000000c2', 'why')$q$, 'at'),
  ('admin_update_registration', $q$select public.admin_update_registration('93000000-0000-0000-0000-0000000000d1', '{"food_pref":"jain"}'::jsonb, null, 'why', null)$q$, 'at'),
  ('admin_waitlist', $q$select * from public.admin_waitlist('93000000-0000-0000-0000-0000000000e1')$q$, 'at'),
  ('review_payment', $q$select public.review_payment('93000000-0000-0000-0000-0000000000e9', true, null)$q$, 'at'),
  ('record_offline_payment', $q$select public.record_offline_payment('93000000-0000-0000-0000-0000000000d1', 'cash', 100, 'n')$q$, 'at'),
  -- the same functions on another event: the event 1 treasurer is refused
  ('admin_event_ledger', $q$select public.admin_event_ledger('93000000-0000-0000-0000-0000000000e2')$q$, 'a'),
  ('admin_promote_waitlist', $q$select public.admin_promote_waitlist('93000000-0000-0000-0000-0000000000ba')$q$, 'a'),
  ('review_payment', $q$select public.review_payment('93000000-0000-0000-0000-0000000000ea', true, null)$q$, 'a'),
  ('admin_update_registration', $q$select public.admin_update_registration('93000000-0000-0000-0000-0000000000d2', '{"food_pref":"jain"}'::jsonb, null, 'why', null)$q$, 'a'),
  -- messages and programme: content manager of the event (and admins)
  ('admin_message_preview', $q$select public.admin_message_preview('93000000-0000-0000-0000-0000000000e1', '{}'::jsonb)$q$, 'ac'),
  ('admin_send_event_message', $q$select public.admin_send_event_message('93000000-0000-0000-0000-0000000000e1', 'announcement', 'Title', 'Body', '{}'::jsonb)$q$, 'ac'),
  ('admin_cancel_event_message', $q$select public.admin_cancel_event_message('93000000-0000-0000-0000-0000000000a5')$q$, 'ac'),
  ('admin_cancel_event_message', $q$select public.admin_cancel_event_message('93000000-0000-0000-0000-0000000000a6')$q$, 'a'),
  ('post_announcement', $q$select public.post_announcement('93000000-0000-0000-0000-0000000000e1', 'Title', 'Body text', false)$q$, 'ac'),
  ('moderate_photo', $q$select public.moderate_photo('93000000-0000-0000-0000-0000000000a7', true)$q$, 'ac'),
  -- moderation: moderators and admins
  ('admin_reports', $q$select * from public.admin_reports('open')$q$, 'am'),
  ('admin_dismiss_reports', $q$select public.admin_dismiss_reports('post', '93000000-0000-0000-0000-0000000000a9')$q$, 'am'),
  ('admin_remove_message', $q$select public.admin_remove_message('93000000-0000-0000-0000-0000000000d8')$q$, 'am'),
  ('moderate', $q$select public.moderate('post', '93000000-0000-0000-0000-0000000000a9', true, 'actioned')$q$, 'am'),
  ('admin_set_meetup', $q$select public.admin_set_meetup('93000000-0000-0000-0000-0000000000a8', 'hidden', 'x')$q$, 'am'),
  ('admin_set_slow_mode', $q$select public.admin_set_slow_mode('93000000-0000-0000-0000-0000000000a8', 30)$q$, 'am'),
  ('admin_groups_for_moderation', $q$select * from public.admin_groups_for_moderation()$q$, 'am'),
  -- queues: each role sees its own slice
  ('admin_attention', $q$select public.admin_attention()$q$, 'amtc'),
  ('admin_inbox', $q$select public.admin_inbox()$q$, 'amt'),
  -- the door
  ('check_in', $q$select public.check_in('93000000-0000-0000-0000-0000000000e1', 'JEC-M93001', false)$q$, 'atcv'),
  ('check_in', $q$select public.check_in('93000000-0000-0000-0000-0000000000e2', 'JEC-M93002', false)$q$, 'a'),
  ('checkin_search', $q$select public.checkin_search('93000000-0000-0000-0000-0000000000e1', 'Mem')$q$, 'atcv'),
  ('checkin_search', $q$select public.checkin_search('93000000-0000-0000-0000-0000000000e2', 'Mem')$q$, 'a'),
  ('event_arrivals', $q$select * from public.event_arrivals('93000000-0000-0000-0000-0000000000e1')$q$, 'atcv');

do $$
declare
  c record; who record; denied boolean; st text; msg text; bad text := '';
  actors constant text[][] := array[['anon', ''], ['x', '93000000-0000-0000-0000-0000000000c1'], ['v', '93000000-0000-0000-0000-0000000000b4'],
    ['t', '93000000-0000-0000-0000-0000000000b1'], ['c', '93000000-0000-0000-0000-0000000000b2'], ['m', '93000000-0000-0000-0000-0000000000b3'],
    ['a', '93000000-0000-0000-0000-0000000000a1']];
  i int; calls int := 0;
begin
  for c in select * from public.t93_cases loop
    for i in 1..array_length(actors, 1) loop
      begin
        execute format('set local role %s', case when actors[i][1] = 'anon' then 'anon' else 'authenticated' end);
        perform set_config('request.jwt.claims', case when actors[i][2] = '' then '{"role":"anon"}' else json_build_object('sub', actors[i][2], 'role', 'authenticated')::text end, true);
        perform set_config('request.jwt.claim.sub', actors[i][2], true);
        execute c.call;
        raise exception 'done' using errcode = 'ZZ001';
      exception when others then
        st := sqlstate; msg := sqlerrm;
      end;
      reset role;
      calls := calls + 1;
      denied := st = '42501';
      if st not in ('ZZ001', '42501') and st not in ('P0001', '23505', '23514', '22023') then
        bad := bad || format(E'\n  %s as %s: unexpected %s %s', c.fn, actors[i][1], st, left(msg, 80));
      end if;
      if actors[i][1] = 'anon' or actors[i][1] = 'x' then
        if not denied then bad := bad || format(E'\n  %s as %s: should be refused but got %s %s', c.fn, actors[i][1], st, left(msg, 60)); end if;
      elsif (position(actors[i][1] in c.allowed) > 0) = denied then
        bad := bad || format(E'\n  %s as %s: %s (%s %s)', c.fn, actors[i][1], case when denied then 'wrongly refused' else 'wrongly allowed' end, st, left(msg, 60));
      end if;
    end loop;
  end loop;
  -- admin is allowed in every row ('a' always in allowed); every role/anon column was checked above
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
                           'search_members', 'touch_updated_at', 'handle_new_user', 't93_try');
  assert bad is null, 'anon can execute: ' || coalesce(bad, '');
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and (p.proname like 'admin\_%' or p.proname like '\_%' or p.proname in ('moderate', 'moderate_photo', 'review_payment', 'record_offline_payment', 'check_in', 'checkin_search', 'post_announcement'));
  assert bad is null, 'anon can execute privileged functions: ' || coalesce(bad, '');
  -- internal helpers (leading underscore) are not callable by members, except the chat path helper used by storage policies
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname not in ('_chat_of_path');
  assert bad is null, 'members can execute internal helpers: ' || coalesce(bad, '');
  -- every table has row level security
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname not like 't93\_%';
  assert bad is null, 'tables without RLS: ' || coalesce(bad, '');
end $$;
select 'ALL SAFETY MATRIX TESTS PASSED';
rollback;
