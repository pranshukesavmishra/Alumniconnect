-- Member management at scale: filtered list, bulk verification, logged export, notes, saved views, timeline,
-- CSV import dry run, duplicate detection and merge. Who may call, what really changes, what is logged. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- a = admin, b = plain member, c/d = waiting members, k/x = the same person twice (x was added by an admin), t = a third person
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at) values
  ('96000000-0000-0000-0000-00000000000a', 'boss96@x.com', '{"full_name":"Boss Xyloquent"}', '{}', now()),
  ('96000000-0000-0000-0000-00000000000b', 'bela96@x.com', '{"full_name":"Bela Xyloquent"}', '{}', now()),
  ('96000000-0000-0000-0000-00000000000c', 'chandra96@x.com', '{"full_name":"Chandra Xyloquent"}', '{}', now()),
  ('96000000-0000-0000-0000-00000000000d', 'devika96@x.com', '{"full_name":"Devika Xyloquent"}', '{}', null),
  ('96000000-0000-0000-0000-0000000000c1', 'kiran.real96@x.com', '{"full_name":"Kiran Zephyrwood"}', '{}', now()),
  ('96000000-0000-0000-0000-0000000000c2', 'kiran.old96@x.com', '{"full_name":"Kiran Zephyrwood"}', '{"created_by_admin":"96000000-0000-0000-0000-00000000000a"}', null),
  ('96000000-0000-0000-0000-0000000000c3', 'tara96@x.com', '{"full_name":"Tara Xyloquent"}', '{}', now());
update public.profiles set onboarded = true, verification = 'verified', grad_year = 2001, branch = 'Civil Engineering', city = 'Indore', member_type = 'alumnus'
 where id::text like '96000000-%';
update public.profiles set is_admin = true where id = '96000000-0000-0000-0000-00000000000a';
update public.profiles set verification = 'pending', created_at = now() - interval '10 days', grad_year = 1999 where id = '96000000-0000-0000-0000-00000000000c';
update public.profiles set verification = 'pending', onboarded = false, grad_year = 2010, city = 'Pune' where id = '96000000-0000-0000-0000-00000000000d';
update public.profiles set city = null, current_company = null where id = '96000000-0000-0000-0000-0000000000c1';
update public.profiles set city = 'Jabalpur', current_company = 'Zephyr Works', verification = 'pending', onboarded = false where id = '96000000-0000-0000-0000-0000000000c2';
update public.profile_private set phone = '+91 99887 76655' where id in ('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-0000000000c2');
update public.profile_private set phone = '+91 99887 11111' where id = '96000000-0000-0000-0000-00000000000c';
-- the duplicate has history: a registration with a payment, a circle both are in, a follow between the two, a DM with Tara
insert into public.events (id, slug, title, is_published) values
  ('96000000-0000-0000-0000-0000000000e1', 'mm-one', 'MM One', true),
  ('96000000-0000-0000-0000-0000000000e2', 'mm-two', 'MM Two', true);
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, amount_paise) values
  ('96000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000e1', '96000000-0000-0000-0000-0000000000c2', 'JEC-MM0001', 'Kiran Z', '+91 99887 76655', 'under_review', 100000);
insert into public.event_payments (registration_id, amount_paise, utr, status) values ('96000000-0000-0000-0000-0000000000a1', 100000, '969696969696', 'submitted');
insert into public.groups (id, kind, slug, name) values ('96000000-0000-0000-0000-0000000000f1', 'circle', 'mm-circle', 'MM Circle');
insert into public.group_members (group_id, user_id) values
  ('96000000-0000-0000-0000-0000000000f1', '96000000-0000-0000-0000-0000000000c1'),
  ('96000000-0000-0000-0000-0000000000f1', '96000000-0000-0000-0000-0000000000c2');
insert into public.follows (follower, followee) values ('96000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c1');
insert into public.chats (id, kind, dm_a, dm_b) values ('96000000-0000-0000-0000-0000000000d1', 'dm', '96000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c3');
insert into public.messages (chat_id, sender_id, body) values ('96000000-0000-0000-0000-0000000000d1', '96000000-0000-0000-0000-0000000000c3', 'hello old kiran');
insert into public.reports (reporter, target_type, target_id, reason) values
  ('96000000-0000-0000-0000-00000000000b', 'profile', '96000000-0000-0000-0000-0000000000c1', 'fake profile?');

-- members and anon cannot call any of it, nor read notes or views
select pg_temp.login('96000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'select public.admin_list_members(''{}'')',
    'select public.admin_bulk_set_verification(array[''96000000-0000-0000-0000-00000000000c''::uuid], ''verified'')',
    'select public.admin_export_members(array[''96000000-0000-0000-0000-00000000000c''::uuid], true)',
    'select public.admin_add_member_note(''96000000-0000-0000-0000-00000000000c'', ''hi'')',
    'select public.admin_save_member_view(''x'', ''{}'')',
    'select public.admin_member_timeline(''96000000-0000-0000-0000-00000000000c'')',
    'select public.admin_import_preview(''[]'')',
    'select public.admin_member_duplicates()',
    'select public.admin_dismiss_duplicate(''96000000-0000-0000-0000-0000000000c1'', ''96000000-0000-0000-0000-0000000000c2'')',
    'select public.admin_merge_preview(''96000000-0000-0000-0000-0000000000c1'', ''96000000-0000-0000-0000-0000000000c2'')',
    'select public.admin_merge_members(''96000000-0000-0000-0000-0000000000c1'', ''96000000-0000-0000-0000-0000000000c2'')']
  loop
    begin execute fn; assert false, 'member could run: ' || fn;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.admin_list_members('{}'); assert false, 'anon list';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.admin_member_notes (member_id, author, body) values ('96000000-0000-0000-0000-00000000000c', '96000000-0000-0000-0000-00000000000a', 'seeded note');
insert into public.admin_member_views (name, filter) values ('seeded view 96', '{}');
select pg_temp.login('96000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.admin_member_notes) = 0, 'members cannot read admin notes';
  assert (select count(*) from public.admin_member_views) = 0, 'members cannot read saved views';
  begin insert into public.admin_member_notes (member_id, body) values ('96000000-0000-0000-0000-00000000000b', 'x'); assert false, 'notes insert';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- the admin
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r jsonb; ids uuid[]; n int; v public.admin_member_views; note public.admin_member_notes;
begin
  -- filters
  r := public.admin_list_members('{"q":"xyloquent"}');
  assert (r ->> 'total')::int = 5, 'five Xyloquents, got ' || (r ->> 'total');
  assert r::text !~ '99887' and r::text !~ 'x\.com', 'no phone or e-mail in the list';
  r := public.admin_list_members('{"q":"xyloquent","status":"pending"}');
  assert (r ->> 'total')::int = 2, 'two waiting';
  r := public.admin_list_members('{"q":"xyloquent","status":"pending","older":"3","onboarded":"yes"}');
  assert (r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'full_name' = 'Chandra Xyloquent', 'pending older than 3 days';
  r := public.admin_list_members('{"q":"xyloquent","signin":"never"}');
  assert (r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'full_name' = 'Devika Xyloquent', 'never signed in';
  r := public.admin_list_members('{"q":"xyloquent","batch_from":"2000","batch_to":"2005"}');
  assert (r ->> 'total')::int = 3, 'batch range';
  r := public.admin_list_members('{"q":"xyloquent","city":"pun"}');
  assert (r ->> 'total')::int = 1, 'city';
  r := public.admin_list_members('{"q":"xyloquent","status":"admins"}');
  assert (r ->> 'total')::int = 1, 'admins';
  r := public.admin_list_members('{"q":"xyloquent","sort":"name"}', 2, 0);
  assert jsonb_array_length(r -> 'rows') = 2 and r -> 'rows' -> 0 ->> 'full_name' = 'Bela Xyloquent', 'sorted by name, paged';
  r := public.admin_list_members('{"q":"xyloquent","sort":"name"}', 2, 2);
  assert r -> 'rows' -> 0 ->> 'full_name' = 'Chandra Xyloquent', 'second page';
  r := public.admin_list_members('{"q":"xyloquent","status":"pending"}', 40, 0, true);
  assert jsonb_array_length(r -> 'ids') = 2, 'select all matching';
  assert (public.admin_list_members('{"q":"xyloquent","status":"pending"}') -> 'rows' -> 0 ->> 'notes')::int >= 0, 'note counts';
  begin perform public.admin_list_members('{"status":"bogus"}'); assert false, 'bad status';
  exception when raise_exception then null; end;
  begin perform public.admin_list_members('{"older":"3; drop table x"}'); assert false, 'bad days';
  exception when raise_exception then null; end;

  -- bulk verification: only real changes are made and logged, one log line per member
  n := (select count(*) from public.admin_audit where action = 'set_member_flags');
  r := public.admin_bulk_set_verification(array['96000000-0000-0000-0000-00000000000c', '96000000-0000-0000-0000-00000000000d', '96000000-0000-0000-0000-00000000000b']::uuid[], 'verified', 'Checked the batch register');
  assert (r ->> 'changed')::int = 2 and (r ->> 'unchanged')::int = 1, 'two changed, one already verified: ' || r::text;
  assert (select count(*) from public.profiles where id in ('96000000-0000-0000-0000-00000000000c', '96000000-0000-0000-0000-00000000000d') and verification = 'verified') = 2, 'really verified';
  assert (select count(*) from public.admin_audit where action = 'set_member_flags') = n + 2, 'one log line per changed member';
  assert exists (select 1 from public.admin_audit where action = 'set_member_flags' and target_id = '96000000-0000-0000-0000-00000000000c'
                  and details ->> 'bulk' = 'true' and details ->> 'note' = 'Checked the batch register' and details -> 'verification' ->> 'to' = 'verified'), 'bulk log details';
  r := public.admin_bulk_set_verification(array['96000000-0000-0000-0000-00000000000d']::uuid[], 'rejected');
  assert (select verification from public.profiles where id = '96000000-0000-0000-0000-00000000000d') = 'rejected', 'bulk reject';
  begin perform public.admin_bulk_set_verification('{}'::uuid[], 'verified'); assert false, 'empty selection';
  exception when raise_exception then null; end;

  -- export: contact details only when asked, and always logged
  r := public.admin_export_members(array['96000000-0000-0000-0000-00000000000c']::uuid[], false);
  assert jsonb_array_length(r) = 1 and not (r -> 0 ? 'phone') and not (r -> 0 ? 'email'), 'no contact details by default';
  r := public.admin_export_members(array['96000000-0000-0000-0000-00000000000c']::uuid[], true);
  assert r -> 0 ->> 'phone' = '+91 99887 11111' and r -> 0 ->> 'email' = 'chandra96@x.com', 'contact details when asked';
  assert exists (select 1 from public.admin_audit where action = 'export_members' and details ->> 'contact' = 'true' and (details ->> 'count')::int = 1), 'export logged';

  -- notes
  note := public.admin_add_member_note('96000000-0000-0000-0000-00000000000c', '  Called on 3 Oct, sending ID proof  ');
  assert note.body = 'Called on 3 Oct, sending ID proof' and note.author = '96000000-0000-0000-0000-00000000000a', 'note saved, trimmed, signed';
  assert (select count(*) from public.admin_member_notes where member_id = '96000000-0000-0000-0000-00000000000c') = 2, 'admins read notes';
  assert exists (select 1 from public.admin_audit where action = 'add_member_note' and target_id = '96000000-0000-0000-0000-00000000000c'), 'note logged';
  begin perform public.admin_add_member_note('96000000-0000-0000-0000-00000000000c', '   '); assert false, 'empty note';
  exception when raise_exception then null; end;

  -- saved views
  v := public.admin_save_member_view('Waiting 3+ days 96', '{"status":"pending","older":"3"}');
  v := public.admin_save_member_view('Waiting 3+ days 96', '{"status":"pending","older":"5"}');
  assert (select count(*) from public.admin_member_views where name = 'Waiting 3+ days 96') = 1 and v.filter ->> 'older' = '5', 'same name updates';
  begin perform public.admin_save_member_view('Bad 96', '{"status":"nope"}'); assert false, 'invalid view';
  exception when raise_exception then null; end;
  perform public.admin_delete_member_view(v.id);
  assert not exists (select 1 from public.admin_member_views where id = v.id), 'view removed';
  assert exists (select 1 from public.admin_audit where action = 'delete_member_view' and details ->> 'name' = 'Waiting 3+ days 96'), 'view removal logged';

  -- timeline of Chandra: joined, bulk verification by the admin, notes
  r := public.admin_member_timeline('96000000-0000-0000-0000-00000000000c');
  assert r -> 'member' ->> 'full_name' = 'Chandra Xyloquent', 'timeline member';
  assert exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'joined'), 'joined';
  assert exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'admin' and i ->> 'action' = 'set_member_flags' and i ->> 'actor_name' = 'Boss Xyloquent'), 'admin action with actor';
  assert exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'note' and i ->> 'body' = 'Called on 3 Oct, sending ID proof'), 'note in timeline';
  assert r::text !~ '99887' and r::text !~ 'chandra96@', 'no contact details in the timeline';
  -- the admin's own timeline shows what they did to others
  r := public.admin_member_timeline('96000000-0000-0000-0000-00000000000a');
  assert exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'did' and i ->> 'action' = 'export_members'), 'what the admin did';

  -- CSV dry run
  r := public.admin_import_preview(jsonb_build_array(
    jsonb_build_object('email', 'new.person96@x.com', 'full_name', 'Nalini Brandnew', 'grad_year', '2004'),
    jsonb_build_object('email', 'CHANDRA96@x.com', 'full_name', 'Chandra X'),
    jsonb_build_object('email', 'other96@x.com', 'full_name', 'Someone', 'phone', '9988776655'),
    jsonb_build_object('email', 'other97@x.com', 'full_name', 'Tara  Xyloquent', 'grad_year', '2001'),
    jsonb_build_object('email', 'not-an-email', 'full_name', 'Bad Row'),
    jsonb_build_object('email', 'new.person96@x.com', 'full_name', 'Nalini Again'),
    jsonb_build_object('email', 'yr96@x.com', 'full_name', 'Year Bad', 'grad_year', '05'),
    jsonb_build_object('email', 'type96@x.com', 'full_name', 'Type Bad', 'member_type', 'guest')));
  assert r -> 'rows' -> 0 ->> 'status' = 'new', 'new row';
  assert r -> 'rows' -> 1 ->> 'status' = 'exists' and r -> 'rows' -> 1 ->> 'member_name' = 'Chandra Xyloquent', 'existing e-mail (any case)';
  assert r -> 'rows' -> 2 ->> 'status' = 'duplicate', 'same phone is a possible duplicate';
  assert r -> 'rows' -> 3 ->> 'status' = 'duplicate' and r -> 'rows' -> 3 ->> 'member_name' = 'Tara Xyloquent', 'same name and batch';
  assert r -> 'rows' -> 4 ->> 'status' = 'invalid', 'bad e-mail';
  assert r -> 'rows' -> 5 ->> 'problem' = 'This e-mail appears earlier in the file', 'repeated in file';
  assert r -> 'rows' -> 6 ->> 'status' = 'invalid' and r -> 'rows' -> 7 ->> 'status' = 'invalid', 'bad year, bad type';
  assert r -> 'counts' ->> 'new' = '1' and r -> 'counts' ->> 'invalid' = '4', 'counts';
  assert r::text !~ '99887', 'no phone echoed';
  assert exists (select 1 from public.admin_audit where action = 'import_preview'), 'dry run logged';

  -- duplicates: Kiran twice (same name, same phone)
  r := public.admin_member_duplicates('zephyrwood');
  assert exists (select 1 from jsonb_array_elements(r) p where p -> 'a' ->> 'full_name' = 'Kiran Zephyrwood' and p -> 'b' ->> 'full_name' = 'Kiran Zephyrwood'
                  and p -> 'reasons' ? 'phone' and p -> 'reasons' ? 'name'), 'the pair, with both reasons';
  assert r -> 0 -> 'a' ->> 'full_name' = 'Kiran Zephyrwood' and r -> 0 -> 'b' ->> 'full_name' = 'Kiran Zephyrwood', 'strongest match first';
  r := public.admin_member_duplicates('xyloquent');
  assert not exists (select 1 from jsonb_array_elements(r) p where (p -> 'a' ->> 'full_name') like 'Kiran%'), 'search narrows pairs';
end $$;
reset role;

-- merge: blocked when both registered for the same event; the admin cannot be merged away
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, status, amount_paise) values
  ('96000000-0000-0000-0000-0000000000a2', '96000000-0000-0000-0000-0000000000e1', '96000000-0000-0000-0000-0000000000c1', 'JEC-MM0002', 'Kiran', '+91 99887 76655', 'pending_payment', 0);
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare p jsonb;
begin
  p := public.admin_merge_preview('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-0000000000c2');
  assert jsonb_array_length(p -> 'blocks') = 1 and p -> 'blocks' ->> 0 like '%MM One%', 'preview shows the block';
  assert p -> 'drop' ->> 'email' = 'ki•••96@x.com', 'e-mail masked in the preview';
  assert (p -> 'moves' ->> 'event_registrations')::int = 1 and (p -> 'moves' ->> 'group_members')::int >= 1, 'preview counts';
  begin perform public.admin_merge_members('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-0000000000c2'); assert false, 'same-event block';
  exception when raise_exception then null; end;
  begin perform public.admin_merge_members('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-00000000000a'); assert false, 'cannot merge self away';
  exception when raise_exception then null; end;
end $$;
reset role;
delete from public.event_registrations where id = '96000000-0000-0000-0000-0000000000a2';
update public.profiles set is_admin = true where id = '96000000-0000-0000-0000-00000000000b';
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r jsonb; t jsonb;
begin
  begin perform public.admin_merge_members('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-00000000000b'); assert false, 'admin merged away';
  exception when raise_exception then null; end;

  -- dismissing a pair hides it; the merge still works on request
  perform public.admin_dismiss_duplicate('96000000-0000-0000-0000-0000000000c2', '96000000-0000-0000-0000-0000000000c1');
  assert not exists (select 1 from jsonb_array_elements(public.admin_member_duplicates('zephyrwood')) p
                      where p -> 'a' ->> 'full_name' = 'Kiran Zephyrwood' and p -> 'b' ->> 'full_name' = 'Kiran Zephyrwood'), 'dismissed pair hidden';

  r := public.admin_merge_members('96000000-0000-0000-0000-0000000000c1', '96000000-0000-0000-0000-0000000000c2');
  assert (r -> 'moved' ->> 'event_registrations')::int = 1, 'registration moved';
  assert (r -> 'dropped' ->> 'group_members')::int >= 1, 'repeat circle membership dropped';
  assert (r -> 'dropped' ->> 'follows')::int = 1, 'follow between the two dropped';
  assert (r -> 'moved' ->> 'chats')::int = 1, 'dm moved';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from auth.users where email = 'new.person96@x.com'), 'dry run creates nothing';
  assert not exists (select 1 from auth.users where id = '96000000-0000-0000-0000-0000000000c2'), 'duplicate account removed';
  assert not exists (select 1 from public.profiles where id = '96000000-0000-0000-0000-0000000000c2'), 'duplicate profile removed';
  assert (select user_id from public.event_registrations where id = '96000000-0000-0000-0000-0000000000a1') = '96000000-0000-0000-0000-0000000000c1', 'registration belongs to the keeper';
  assert (select count(*) from public.event_payments where registration_id = '96000000-0000-0000-0000-0000000000a1') = 1, 'payment kept';
  assert (select count(*) from public.group_members where group_id = '96000000-0000-0000-0000-0000000000f1') = 1, 'one membership';
  assert exists (select 1 from public.chats where id = '96000000-0000-0000-0000-0000000000d1'
                  and dm_a = least('96000000-0000-0000-0000-0000000000c1'::uuid, '96000000-0000-0000-0000-0000000000c3'::uuid)), 'dm re-pointed';
  assert (select count(*) from public.messages where chat_id = '96000000-0000-0000-0000-0000000000d1') = 1, 'messages kept';
  assert (select city from public.profiles where id = '96000000-0000-0000-0000-0000000000c1') = 'Jabalpur', 'empty city filled';
  assert (select current_company from public.profiles where id = '96000000-0000-0000-0000-0000000000c1') = 'Zephyr Works', 'empty company filled';
  assert (select verification from public.profiles where id = '96000000-0000-0000-0000-0000000000c1') = 'verified', 'keeper stays verified';
  assert exists (select 1 from public.admin_audit where action = 'merge_member' and target_id = '96000000-0000-0000-0000-0000000000c1'
                  and details ->> 'merged_id' = '96000000-0000-0000-0000-0000000000c2' and details ->> 'email' = 'ki•••96@x.com'), 'merge logged, e-mail masked';
end $$;
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare t jsonb := public.admin_member_timeline('96000000-0000-0000-0000-0000000000c1');
begin
  assert exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'kind' = 'admin' and i ->> 'action' = 'merge_member'), 'merge in timeline';
  assert exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'kind' = 'registration' and i ->> 'code' = 'JEC-MM0001'), 'moved registration in timeline';
  assert exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'kind' = 'payment' and i ->> 'utr' = '969696969696'), 'payment in timeline';
  assert exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'kind' = 'report_about' and i ->> 'reason' = 'fake profile?'), 'report about them';
  assert exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'kind' = 'signin'), 'last sign-in';
  -- search asks for more on "see all"
  assert (public.admin_search('xyloquent', 2) -> 'members') is not null and jsonb_array_length(public.admin_search('xyloquent', 2) -> 'members') = 2, 'search limit';
  assert jsonb_array_length(public.admin_search('xyloquent', 50) -> 'members') = 5, 'see all';
  assert (public.admin_search('xyloquent', 999) ->> 'limit')::int = 50, 'limit capped';
end $$;
reset role;
select 'MEMBER MANAGEMENT TESTS PASSED';
rollback;
