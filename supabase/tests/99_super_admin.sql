-- Super admins and permission-scoped admins: last-super protection, who may grant, step-down, ownership transfer, legacy admins stay full,
-- grants are audited and notify, clients cannot write the flags or the grants table. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t9s_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end;
$$;
grant execute on function public.t9s_fails(text) to authenticated, anon;
-- notifications are private to their owner; the test reads them as the owner of the database
create function public.t9s_notes(p_user uuid, p_like text default '%') returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.notifications where user_id = p_user and kind = 'admin_access' and body like p_like;
$$;
grant execute on function public.t9s_notes(uuid, text) to authenticated;

-- s1, s2 = super admins; a1 = legacy full admin (no grants row); l1 = limited admin (members_view); l2 = limited (events_team + moderation_hide)
-- n = member, p = another member
insert into auth.users (id, email, raw_user_meta_data) values
  ('9a000000-0000-0000-0000-0000000000a1', 's1@sa.example', '{"full_name":"Super One"}'),
  ('9a000000-0000-0000-0000-0000000000a2', 's2@sa.example', '{"full_name":"Super Two"}'),
  ('9a000000-0000-0000-0000-0000000000a3', 'a1@sa.example', '{"full_name":"Legacy Admin"}'),
  ('9a000000-0000-0000-0000-0000000000b1', 'l1@sa.example', '{"full_name":"Limited One"}'),
  ('9a000000-0000-0000-0000-0000000000b2', 'l2@sa.example', '{"full_name":"Limited Two"}'),
  ('9a000000-0000-0000-0000-0000000000c1', 'n@sa.example', '{"full_name":"Nina Member"}'),
  ('9a000000-0000-0000-0000-0000000000c2', 'p@sa.example', '{"full_name":"Paul Member"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001
 where id::text like '9a000000-%';
insert into public.events (id, slug, title, is_published) values ('9a000000-0000-0000-0000-0000000000e1', 'sa-one', 'SA One', true);

-- ---------------------------------------------------------------- the database starts with no super admin; the first one is made in SQL
do $$ begin
  assert (select count(*) from public.profiles where is_super_admin) = 0, 'no super admin is seeded by any migration';
  assert not exists (select 1 from public.admin_audit where action like 'super%'), 'nothing logged yet';
end $$;
update public.profiles set is_admin = true where id in ('9a000000-0000-0000-0000-0000000000a1', '9a000000-0000-0000-0000-0000000000a3',
  '9a000000-0000-0000-0000-0000000000b1', '9a000000-0000-0000-0000-0000000000b2');
-- a super admin must be an admin
do $$ begin
  begin update public.profiles set is_super_admin = true where id = '9a000000-0000-0000-0000-0000000000c1'; assert false, 'super without admin';
  exception when check_violation then null; end;
end $$;
update public.profiles set is_super_admin = true where id = '9a000000-0000-0000-0000-0000000000a1';   -- the owners' recovery snippet
insert into public.admin_grants (user_id, permissions, granted_by) values
  ('9a000000-0000-0000-0000-0000000000b1', array['members_view'], '9a000000-0000-0000-0000-0000000000a1'),
  ('9a000000-0000-0000-0000-0000000000b2', array['events_team', 'moderation_hide'], '9a000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------- the permission test itself
select set_config('t9s.n', (select count(*)::text from public._permission_catalog()), false);
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert public._admin_can('members_view') and public._admin_can('money_payments') and public._admin_can('anything'), 'a super admin holds every permission';
  assert (public.my_admin_access() ->> 'is_super')::boolean and (public.my_admin_access() ->> 'full')::boolean, 'my_admin_access: super';
  assert jsonb_array_length(public.my_admin_access() -> 'permissions') = current_setting('t9s.n')::int, 'and lists them all';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert public._admin_can('members_view') and public._admin_can('money_payments') and public._admin_can_any(array['events_*']), 'legacy admin (no grants row) keeps every permission';
  assert not public.is_super_admin(), 'but is not a super admin';
  assert (public.my_admin_access() ->> 'full')::boolean and not (public.my_admin_access() ->> 'is_super')::boolean, 'my_admin_access: full admin';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  assert public._admin_can('members_view'), 'limited admin holds the granted permission';
  assert not public._admin_can('members_edit') and not public._admin_can('money_payments') and not public._admin_can_any(array['events_*', 'money_*']), 'and nothing else';
  assert public._admin_can_any(array['members_*']), 'wildcard matches a family they hold';
  assert public.is_admin(), 'is_admin still opens the admin area';
  assert public.my_admin_access() -> 'permissions' = '["members_view"]'::jsonb and not (public.my_admin_access() ->> 'full')::boolean, 'my_admin_access: limited';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert not public._admin_can('members_view') and not public.is_super_admin(), 'a member holds nothing';
  assert (public.my_admin_access() ->> 'is_admin')::boolean = false, 'my_admin_access: member';
end $$;
reset role;
set local role anon;
do $$ begin assert not public._admin_can('members_view'), 'anon holds nothing'; end $$;
reset role;

-- ---------------------------------------------------------------- an ordinary admin can never grant or change admin / super status
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, array['members_view'])$q$) like '42501%', 'legacy admin cannot make admins';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000a3', false)$q$) like '42501%', 'or remove admin access';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000a3', true, null)$q$) like '42501%', 'not even their own';
  assert public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000a3', true)$q$) like '42501%', 'cannot make themselves super';
  assert public.t9s_fails($q$select public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000a3', true)$q$) like '42501%', 'cannot take ownership';
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'admin')$q$) like '42501%', 'the old role door is closed';
  assert public.t9s_fails($q$select public.admin_set_member('9a000000-0000-0000-0000-0000000000c1', true, null)$q$) like '42501%', 'and the member-flag door';
  assert public.t9s_fails($q$update public.profiles set is_admin = true where id = '9a000000-0000-0000-0000-0000000000c1'$q$) like '42501%', 'no direct admin flag';
  assert public.t9s_fails($q$update public.profiles set is_super_admin = true where id = '9a000000-0000-0000-0000-0000000000a3'$q$) like '42501%', 'no direct super flag';
  assert public.t9s_fails($q$insert into public.admin_grants (user_id, permissions) values ('9a000000-0000-0000-0000-0000000000c1', '{members_view}')$q$) like '42501%', 'no direct grants';
  assert public.t9s_fails($q$delete from public.admin_grants$q$) like '42501%', 'no deleting grants';
  -- ... but the list of who the admins are is theirs to see, without other people's permission lists
  assert jsonb_array_length(public.admin_list_admins() -> 'admins') = 4, 'legacy admin sees the four admins';
  assert not (public.admin_list_admins() ->> 'viewer_is_super')::boolean, 'and knows they are not super';
  assert (select count(*) from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x -> 'permissions' is not null and x -> 'permissions' <> 'null'::jsonb) = 1,
    'only their own permission list is shown to them';
  assert not exists (select 1 from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'note' is not null or x ->> 'granted_by' is not null), 'no notes or granters';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_list_admins()$q$) like '42501%', 'a limited admin without the admins view cannot list admins';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000b1', true, null)$q$) like '42501%', 'and cannot widen themselves';
  assert public.t9s_fails($q$update public.admin_grants set permissions = '{members_view,money_payments}' where user_id = '9a000000-0000-0000-0000-0000000000b1'$q$) like '42501%', 'or edit the grants table';
  assert (select count(*) from public.admin_grants) = 1, 'a limited admin reads only their own grant row';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true)$q$) like '42501%', 'a member cannot make themselves admin';
  assert public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000c1', true)$q$) like '42501%', 'or super';
  assert (select count(*) from public.admin_grants) = 0, 'a member sees no grants';
end $$;
reset role;

-- ---------------------------------------------------------------- event roles and moderator need their permission
select pg_temp.login('9a000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'treasurer', '9a000000-0000-0000-0000-0000000000e1')$q$) like '42501%', 'members_view cannot give event roles';
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'moderator')$q$) like '42501%', 'nor moderator';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000b2');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000b2', 'treasurer', '9a000000-0000-0000-0000-0000000000e1')$q$) like '42501%', 'but never to themselves (a role carries powers beyond their own list)';
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000b2', 'moderator')$q$) like '42501%', 'nor moderator';
  assert public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'treasurer', '9a000000-0000-0000-0000-0000000000e1') = true, 'events_team gives an event role';
  assert public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'moderator') = true, 'a moderation permission gives moderator';
  assert public.t9s_fails($q$select public.admin_grant_role('9a000000-0000-0000-0000-0000000000c1', 'admin')$q$) like '42501%', 'nobody gives admin through the role door';
end $$;
reset role;

-- ---------------------------------------------------------------- the last super admin cannot go
do $$ begin
  begin update public.profiles set is_super_admin = false where id = '9a000000-0000-0000-0000-0000000000a1'; assert false, 'last super removed';
  exception when others then assert sqlerrm like '%at least one super admin%', sqlerrm; end;
  begin delete from public.profiles where id = '9a000000-0000-0000-0000-0000000000a1'; assert false, 'last super deleted';
  exception when others then assert sqlerrm like '%at least one super admin%', sqlerrm; end;
  begin delete from auth.users where id = '9a000000-0000-0000-0000-0000000000a1'; assert false, 'last super account deleted';
  exception when others then assert sqlerrm like '%at least one super admin%', sqlerrm; end;
end $$;

-- ---------------------------------------------------------------- a super admin gives, changes and removes admin access
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare r jsonb;
begin
  assert public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000a1', false)$q$) like 'P0001%last%' or
         public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000a1', false)$q$) like '%at least one super admin%', 'the only super cannot step down';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, array['not_a_permission'])$q$) like '%Unknown permission%', 'unknown keys are refused';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, '{}')$q$) like '%at least one%', 'an empty list is refused';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000a1', false)$q$) like '%super admin%', 'a super admin is not removed as an admin, not even by themselves';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000a1', true, array['members_view'])$q$) like '%super admin%', 'a super admin cannot be limited';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000ff', true, array['members_view'])$q$) like '%no longer exists%', 'unknown member';

  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, array['moderation_reports', 'moderation_hide', 'moderation_hide'], 'Moderator for batch 2001');
  assert (r ->> 'changed')::boolean and (r ->> 'is_admin')::boolean and not (r ->> 'full')::boolean, 'Nina is a limited admin: ' || r::text;
  assert (select is_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000c1'), 'flag set';
  assert (select permissions from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000c1') = array['moderation_hide', 'moderation_reports'], 'sorted, de-duplicated';
  assert (select note from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000c1') = 'Moderator for batch 2001', 'note kept';
  assert (select granted_by from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000c1') = '9a000000-0000-0000-0000-0000000000a1', 'granter kept';
  assert (select count(*) from public.admin_audit where action = 'admin_granted' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'logged';
  assert (select details ->> 'name' from public.admin_audit where action = 'admin_granted' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 'Nina Member', 'log names the person';
  assert (select details -> 'permissions' from public.admin_audit where action = 'admin_granted' and target_id = '9a000000-0000-0000-0000-0000000000c1') = '["moderation_hide","moderation_reports"]'::jsonb, 'and the permissions';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000c1') = 1, 'the person is told';
  -- idempotent
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, array['moderation_hide', 'moderation_reports'], 'Moderator for batch 2001');
  assert not (r ->> 'changed')::boolean, 'same again changes nothing';
  assert (select count(*) from public.admin_audit where target_id = '9a000000-0000-0000-0000-0000000000c1' and action like 'admin%') = 1, 'and logs nothing';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000c1') = 1, 'and tells nobody';
  -- change the permissions
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, array['moderation_hide', 'analytics'], null);
  assert (r ->> 'changed')::boolean, 'changed';
  assert (select permissions from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000c1') = array['analytics', 'moderation_hide'], 'replaced';
  assert (select count(*) from public.admin_audit where action = 'admin_permissions_changed' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'logged as a change';
  assert (select details -> 'was_permissions' from public.admin_audit where action = 'admin_permissions_changed' and target_id = '9a000000-0000-0000-0000-0000000000c1') = '["moderation_hide","moderation_reports"]'::jsonb, 'with the old list';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000c1') = 2, 'told again';
  -- full admin (null list)
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', true, null);
  assert (r ->> 'changed')::boolean and (r ->> 'full')::boolean, 'now full';
  assert not exists (select 1 from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000c1'), 'no grants row = full admin';
  -- the list the super sees
  assert (select count(*) from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x -> 'permissions' is not null) = 5, 'a super admin sees every permission list';
  assert (select x ->> 'granted_by' from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'full_name' = 'Limited Two') = 'Super One', 'who granted';
  assert (public.admin_list_admins() ->> 'viewer_is_super')::boolean, 'viewer is super';
  assert not exists (select 1 from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x::text like '%@%'), 'no e-mail in the list';
  -- remove
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', false);
  assert (r ->> 'changed')::boolean, 'removed';
  assert not (select is_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000c1'), 'flag cleared';
  assert (select count(*) from public.admin_audit where action = 'admin_removed' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'logged';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000c1') = 4, 'told';
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', false);
  assert not (r ->> 'changed')::boolean, 'removing twice changes nothing';
  assert (select count(*) from public.admin_audit where action = 'admin_removed' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'one log line';
  -- limiting a legacy full admin
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000a3', true, array['audit']);
  assert (r ->> 'changed')::boolean, 'a full admin can be limited';
  assert (select details ->> 'was_full' from public.admin_audit where action = 'admin_permissions_changed' and target_id = '9a000000-0000-0000-0000-0000000000a3') = 'true', 'the log says they were full';
  -- the member stops being able to do things at once
  r := public.admin_set_admin('9a000000-0000-0000-0000-0000000000a3', true, null);
end $$;
reset role;
-- removing admin access removes the grants row (direct update as the owner too)
do $$ begin
  update public.profiles set is_admin = false where id = '9a000000-0000-0000-0000-0000000000b2';
  assert not exists (select 1 from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000b2'), 'grants go with the admin flag';
  update public.profiles set is_admin = true where id = '9a000000-0000-0000-0000-0000000000b2';
  assert not exists (select 1 from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000b2'), 'a re-made admin starts as a full admin until limited';
end $$;

-- ---------------------------------------------------------------- the limited admin's reach changes at once
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c2', true, array['members_view'], null);
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_list_members('{}'::jsonb, 5, 0, false)$q$) is null, 'members_view lists members';
  assert public.t9s_fails($q$select public.admin_analytics()$q$) like '42501%', 'but not analytics';
  assert public.t9s_fails($q$select * from public.admin_audit_search(null, null, null, null, null, 5, null)$q$) like '42501%', 'nor the activity log';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c2', true, array['analytics'], null);
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_list_members('{}'::jsonb, 5, 0, false)$q$) like '42501%', 'after the change members are closed';
  assert public.t9s_fails($q$select public.admin_analytics()$q$) is null, 'and analytics are open';
end $$;
reset role;

-- ---------------------------------------------------------------- making and removing super admins, stepping down
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000c1', true);
  assert (r ->> 'changed')::boolean, 'Nina is super';
  assert (select is_super_admin and is_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000c1'), 'super implies admin';
  assert (select count(*) from public.admin_audit where action = 'super_admin_granted' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'logged';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000c1', '%super admin%') >= 1, 'told';
  r := public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000c1', true);
  assert not (r ->> 'changed')::boolean, 'idempotent';
  assert (select count(*) from public.admin_audit where action = 'super_admin_granted' and target_id = '9a000000-0000-0000-0000-0000000000c1') = 1, 'no second log line';
  assert public.t9s_fails($q$select public.admin_set_admin('9a000000-0000-0000-0000-0000000000c1', false)$q$) like '%super admin%', 'a super admin is not removed as an admin';
  -- with a second super, the first may step down (and stays a full admin)
  r := public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000a1', false);
  assert (r ->> 'changed')::boolean, 'stepped down';
  assert (select is_admin and not is_super_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000a1'), 'still a full admin';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000c1', true)$q$) like '42501%', 'the stepped-down owner cannot act as super any more';
  assert public._admin_can('members_view'), 'but keeps full admin';
end $$;
reset role;
-- the remaining super cannot remove themselves either
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_set_super_admin('9a000000-0000-0000-0000-0000000000c1', false)$q$) like '%at least one super admin%', 'the last super stays';
  assert public.t9s_fails($q$select public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000c1', true)$q$) like '%another person%', 'cannot transfer to yourself';
  assert public.t9s_fails($q$select public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000ff', true)$q$) like '%no longer exists%', 'unknown person';
end $$;
reset role;

-- ---------------------------------------------------------------- transfer ownership
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
declare r jsonb;
begin
  -- keep both
  r := public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000a1', false);
  assert (r ->> 'changed')::boolean and not (r ->> 'stepped_down')::boolean, 'shared ownership';
  assert (select count(*) from public.profiles where is_super_admin) = 2, 'two owners';
  assert (select count(*) from public.admin_audit where action = 'ownership_transferred' and target_id = '9a000000-0000-0000-0000-0000000000a1') = 1, 'logged';
  assert public.t9s_notes('9a000000-0000-0000-0000-0000000000a1', '%super admin%') >= 1, 'new owner told';
  r := public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000a1', false);
  assert not (r ->> 'changed')::boolean, 'again: nothing changes';
  assert (select count(*) from public.admin_audit where action = 'ownership_transferred') = 1, 'one log line';
  -- hand over and step down in one go, to a limited admin
  r := public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000b1', true);
  assert (r ->> 'changed')::boolean and (r ->> 'stepped_down')::boolean, 'handed over';
  assert (select is_super_admin and is_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000b1'), 'the new owner is super';
  assert not exists (select 1 from public.admin_grants where user_id = '9a000000-0000-0000-0000-0000000000b1'), 'their limited grant is gone (all access)';
  assert (select not is_super_admin and is_admin from public.profiles where id = '9a000000-0000-0000-0000-0000000000c1'), 'the old owner stepped down, still admin';
  assert (select count(*) from public.profiles where is_super_admin) = 2, 'two owners remain (a1 and the new one)';
end $$;
reset role;
-- an owner who handed over can no longer act as one
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t9s_fails($q$select public.admin_transfer_ownership('9a000000-0000-0000-0000-0000000000c2', true)$q$) like '42501%', 'a stepped-down owner cannot transfer again';
end $$;
reset role;

-- ---------------------------------------------------------------- admins removed by the SQL snippet still leave an owner behind
do $$ begin
  update public.profiles set is_super_admin = false where id = '9a000000-0000-0000-0000-0000000000a1';
  begin update public.profiles set is_super_admin = false where id = '9a000000-0000-0000-0000-0000000000b1'; assert false, 'last owner removed';
  exception when others then assert sqlerrm like '%at least one super admin%', sqlerrm; end;
end $$;

select 'ALL SUPER ADMIN TESTS PASSED';
rollback;
