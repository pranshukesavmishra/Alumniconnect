-- Role templates and department / batch scope: templates seeded and expanded, admin_set_admin with a template and a scope,
-- and the scope enforced by the database across the member-facing admin functions. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create function public.t9r_fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end;
$$;
grant execute on function public.t9r_fails(text) to authenticated, anon;

-- s owner; dh department head (MCA); br batch rep (2005); tr treasurer; m1 MCA 2005, m2 MCA 2010, m3 Civil 2005 (pending), m4 Civil 2010 (pending), m5 MCA 2005 (pending)
insert into auth.users (id, email, raw_user_meta_data) values
  ('9c000000-0000-0000-0000-0000000000a1', 's@r9.example', '{"full_name":"Owner Rita"}'),
  ('9c000000-0000-0000-0000-0000000000b1', 'dh@r9.example', '{"full_name":"Head Dev"}'),
  ('9c000000-0000-0000-0000-0000000000b2', 'br@r9.example', '{"full_name":"Rep Bina"}'),
  ('9c000000-0000-0000-0000-0000000000b3', 'tr@r9.example', '{"full_name":"Tre Asurer"}'),
  ('9c000000-0000-0000-0000-0000000000c1', 'm1@r9.example', '{"full_name":"Mca Fiveone"}'),
  ('9c000000-0000-0000-0000-0000000000c2', 'm2@r9.example', '{"full_name":"Mca Tenone"}'),
  ('9c000000-0000-0000-0000-0000000000c3', 'm3@r9.example', '{"full_name":"Civil Fivetwo"}'),
  ('9c000000-0000-0000-0000-0000000000c4', 'm4@r9.example', '{"full_name":"Civil Tentwo"}'),
  ('9c000000-0000-0000-0000-0000000000c5', 'm5@r9.example', '{"full_name":"Mca Fivepending"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', city = 'Pune', branch = 'Civil Engineering', grad_year = 2001
 where id::text like '9c000000-%';
update public.profiles set branch = 'MCA', grad_year = 2005 where id = '9c000000-0000-0000-0000-0000000000c1';
update public.profiles set branch = 'MCA', grad_year = 2010 where id = '9c000000-0000-0000-0000-0000000000c2';
update public.profiles set branch = 'MCA', grad_year = 2005, verification = 'pending' where id = '9c000000-0000-0000-0000-0000000000c5';
update public.profiles set branch = 'B.E. in Civil Engineering', grad_year = 2005, verification = 'pending' where id = '9c000000-0000-0000-0000-0000000000c3';
update public.profiles set branch = 'B.E. in Civil Engineering', grad_year = 2010, verification = 'pending' where id = '9c000000-0000-0000-0000-0000000000c4';
update public.profile_private set phone = '+91 98765 90003' where id = '9c000000-0000-0000-0000-0000000000c3';
update public.profile_private set phone = '+91 98765 90001' where id = '9c000000-0000-0000-0000-0000000000c1';
update public.profiles set is_admin = true, is_super_admin = true where id = '9c000000-0000-0000-0000-0000000000a1';
insert into public.protected_owners (user_id) values ('9c000000-0000-0000-0000-0000000000a1');
insert into public.groups (kind, slug, name, branch, grad_year) values
  ('circle', 'r9-mca', 'R9 MCA', 'MCA', null), ('circle', 'r9-civil', 'R9 Civil', 'B.E. in Civil Engineering', null),
  ('circle', 'r9-2005', 'R9 Batch 2005', null, 2005), ('circle', 'r9-2010', 'R9 Batch 2010', null, 2010);
select set_config('t9r.all', (select count(*)::text from public.profiles), false);
select set_config('t9r.mca', (select count(*)::text from public.profiles where branch = 'MCA'), false);
select set_config('t9r.b05', (select count(*)::text from public.profiles where grad_year = 2005), false);

-- ---------------------------------------------------------------- templates
do $$
declare t jsonb;
begin
  assert (select count(*) from public.admin_role_templates) >= 13, 'thirteen templates are seeded';
  assert (select permissions is null from public.admin_role_templates where key = 'full'), 'Full admin = null (everything)';
  assert (select scope_kind from public.admin_role_templates where key = 'department_head') = 'department'
     and (select scope_kind from public.admin_role_templates where key = 'batch_rep') = 'batch', 'scoped roles';
  assert public._expand_permissions(array['money_*']) @> array['money_payments', 'money_refunds', 'money_finance', 'money_exports'], 'families expand';
  assert public._expand_permissions(array['funds_*', 'nonsense']) = '{}', 'unknown keys and empty families expand to nothing';
  -- every non-empty template only names real permissions
  assert not exists (select 1 from public.admin_role_templates t, unnest(t.permissions) k
                      where k not like '%*' and k not in (select key from public._permission_catalog())), 'templates name real permissions';
end $$;
set local role authenticated;
select pg_temp.login('9c000000-0000-0000-0000-0000000000a1');
do $$
declare t jsonb;
begin
  t := public.admin_role_templates();
  assert jsonb_array_length(t) >= 11, 'the screen gets the templates';
  assert not exists (select 1 from jsonb_array_elements(t) x where x ->> 'key' = 'funds_sponsorship'), 'a role with no permissions yet is hidden';
  assert (select x -> 'permissions' from jsonb_array_elements(t) x where x ->> 'key' = 'treasurer') @> '"money_payments"'::jsonb, 'permissions are expanded';
  assert public.t9r_fails($q$select public.admin_role_templates()$q$) is null, 'admins can read them';
end $$;
reset role;
select pg_temp.login('9c000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t9r_fails($q$select public.admin_role_templates()$q$) like '42501%', 'members cannot';
  assert public.t9r_fails($q$select * from public.admin_role_templates$q$) like '42501%', 'nor read the table';
end $$;
reset role;

-- ---------------------------------------------------------------- make admins from templates (owner)
select pg_temp.login('9c000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare r jsonb; g public.admin_grants;
begin
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b1', true, null, null, 'department_head')$q$) like '%Choose the department%'
     or public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b1', true, null, null, 'department_head')$q$) like '%one department%', 'a department role needs its department';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b1', true, null, null, 'department_head', 'batch', '2005')$q$) like '%one department%', 'and the right kind of scope';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b2', true, null, null, 'batch_rep', 'batch', 'soon')$q$) like '%batch year%', 'a batch must be a year';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'treasurer', 'department', 'MCA')$q$) like '%not limited%', 'a treasurer is not scoped';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'nope')$q$) like '%Unknown role%', 'unknown role';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'funds_sponsorship')$q$) like '%no permissions%', 'an empty role cannot be given';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, null, 'department', 'MCA')$q$) like '%list of permissions%', 'scope needs limited permissions';

  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b1', true, null, 'MCA HOD', 'department_head', 'department', 'MCA');
  assert (r ->> 'changed')::boolean and not (r ->> 'full')::boolean, 'dept head made';
  select * into g from public.admin_grants where user_id = '9c000000-0000-0000-0000-0000000000b1';
  assert g.permissions = array['members_verify', 'members_view'] and g.template_key = 'department_head' and g.scope_kind = 'department' and g.scope_value = 'MCA', 'grant row carries role and scope';
  assert (select details ->> 'role' from public.admin_audit where action = 'admin_granted' and target_id = g.user_id) = 'department_head', 'audit names the role';
  assert not (public.admin_set_admin('9c000000-0000-0000-0000-0000000000b1', true, null, 'MCA HOD', 'department_head', 'department', 'MCA') ->> 'changed')::boolean, 'idempotent';
  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b2', true, null, null, 'batch_rep', 'batch', '2005');
  assert (select scope_kind || scope_value from public.admin_grants where user_id = '9c000000-0000-0000-0000-0000000000b2') = 'batch2005', 'batch rep made';
  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'treasurer');
  assert (select permissions @> array['money_payments', 'money_refunds'] and scope_kind = 'all' and scope_value is null from public.admin_grants where user_id = '9c000000-0000-0000-0000-0000000000b3'), 'treasurer made';
  -- customised permissions on top of a role keep the role label
  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, array['money_payments'], null, 'treasurer');
  assert (select permissions from public.admin_grants where user_id = '9c000000-0000-0000-0000-0000000000b3') = array['money_payments'], 'custom list wins';
  -- full admin template removes the limiting row
  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'full');
  assert (r ->> 'full')::boolean and not exists (select 1 from public.admin_grants where user_id = '9c000000-0000-0000-0000-0000000000b3'), 'Full admin template';
  r := public.admin_set_admin('9c000000-0000-0000-0000-0000000000b3', true, null, null, 'treasurer');
  -- the admin list shows role and scope
  assert (select x ->> 'role_label' from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'full_name' = 'Head Dev') = 'Department head', 'list: role label';
  assert (select x ->> 'scope_value' from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'full_name' = 'Head Dev') = 'MCA', 'list: scope';
  assert (select (x ->> 'is_owner')::boolean from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'full_name' = 'Owner Rita'), 'list: owner flag';
  assert (select x ->> 'role_label' from jsonb_array_elements(public.admin_list_admins() -> 'admins') x where x ->> 'full_name' = 'Owner Rita') = 'Owner', 'list: Owner label';
end $$;
reset role;

-- ---------------------------------------------------------------- the department head sees and verifies only MCA
select pg_temp.login('9c000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$
declare r jsonb;
begin
  assert (public.my_admin_access() ->> 'scope_kind') = 'department' and (public.my_admin_access() ->> 'scope_value') = 'MCA', 'my_admin_access carries the scope';
  r := public.admin_list_members('{}'::jsonb, 200, 0, false);
  assert (r ->> 'total')::int = current_setting('t9r.mca')::int, 'list total is the department only: ' || r::text;
  assert not exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'branch' is distinct from 'MCA'), 'no row from another department';
  assert jsonb_array_length(public.admin_list_members('{"status":"pending"}'::jsonb, 50, 0, false) -> 'rows') = 1, 'filters stay inside the scope';
  assert jsonb_array_length(public.admin_list_members('{}'::jsonb, 50, 0, true) -> 'ids') = current_setting('t9r.mca')::int, 'ids-only too';
  assert jsonb_array_length(public.admin_search('Civil', 20) -> 'members') = 0, 'search finds nobody outside the department';
  assert jsonb_array_length(public.admin_search('Mca', 20) -> 'members') = 3, 'search finds the department''s people';
  assert jsonb_array_length(public.admin_search('JEC', 20) -> 'registrations') = 0, 'and no registrations';
  assert (public.admin_attention() -> 'global' ->> 'members_pending')::int = 1, 'attention counts only their pending member: ' || public.admin_attention()::text;
  assert public.t9r_fails($q$select public.admin_member_timeline('9c000000-0000-0000-0000-0000000000c1')$q$) is null, 'timeline of an own member';
  assert public.t9r_fails($q$select public.admin_member_timeline('9c000000-0000-0000-0000-0000000000c3')$q$) like '42501%outside%', 'timeline of another department refused';
  assert public.t9r_fails($q$select public.admin_view_as_member('9c000000-0000-0000-0000-0000000000c1')$q$) is null, 'view as an own member';
  assert public.t9r_fails($q$select public.admin_view_as_member('9c000000-0000-0000-0000-0000000000c3')$q$) like '42501%outside%', 'view as another department refused';
  assert public.t9r_fails($q$select public.admin_member_email('9c000000-0000-0000-0000-0000000000c3')$q$) like '%outside%', 'no e-mail outside the scope';
  assert public.t9r_fails($q$select public.admin_set_member('9c000000-0000-0000-0000-0000000000c3', null, 'verified')$q$) like '42501%outside%', 'cannot verify outside the scope';
  assert public.t9r_fails($q$select public.admin_bulk_set_verification(array['9c000000-0000-0000-0000-0000000000c5', '9c000000-0000-0000-0000-0000000000c3']::uuid[], 'verified')$q$) like '42501%outside%', 'bulk with one outsider is refused whole';
  assert (select verification from public.profiles where id = '9c000000-0000-0000-0000-0000000000c5') = 'pending', 'and nothing in it changed';
  assert public.t9r_fails($q$select public.admin_update_member('9c000000-0000-0000-0000-0000000000c3', '{"city":"X"}'::jsonb, null)$q$) like '42501%', 'edit needs a permission they lack';
  assert public.t9r_fails($q$select public.admin_export_members(array['9c000000-0000-0000-0000-0000000000c1']::uuid[], true)$q$) like '42501%', 'export is not theirs';
  -- direct table reads follow the scope
  assert (select count(*) from public.profile_private where id = '9c000000-0000-0000-0000-0000000000c3') = 0, 'phone of an outsider is not readable';
  assert (select count(*) from public.profile_private where id = '9c000000-0000-0000-0000-0000000000c1') = 1, 'phone of an own member is';
  perform public.admin_set_member('9c000000-0000-0000-0000-0000000000c5', null, 'verified');
  assert (select verification from public.profiles where id = '9c000000-0000-0000-0000-0000000000c5') = 'verified', 'and really verifies';
  assert (public.admin_bulk_set_verification(array['9c000000-0000-0000-0000-0000000000c5']::uuid[], 'pending') ->> 'changed')::int = 1, 'bulk inside the scope works';
  -- groups
  assert public.is_group_admin((select id from public.groups where slug = 'r9-mca')), 'group admin of the department group';
  assert not public.is_group_admin((select id from public.groups where slug = 'r9-civil')), 'not of another department''s';
  assert not public.is_group_admin((select id from public.groups where slug = 'r9-2005')), 'nor of a batch group';
  -- admin powers beyond the role stay closed
  assert public.t9r_fails($q$select public.admin_analytics()$q$) like '42501%', 'no analytics';
  assert public.t9r_fails($q$select public.admin_set_admin('9c000000-0000-0000-0000-0000000000c1', true, array['members_view'])$q$) like '42501%', 'cannot make admins';
end $$;
reset role;

-- ---------------------------------------------------------------- the batch rep sees only batch 2005
select pg_temp.login('9c000000-0000-0000-0000-0000000000b2');
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.admin_list_members('{}'::jsonb, 200, 0, false);
  assert (r ->> 'total')::int = current_setting('t9r.b05')::int, 'batch list total';
  assert not exists (select 1 from jsonb_array_elements(r -> 'rows') x where (x ->> 'grad_year')::int <> 2005), 'only 2005';
  assert public.t9r_fails($q$select public.admin_member_timeline('9c000000-0000-0000-0000-0000000000c2')$q$) like '42501%outside%', 'another batch refused';
  assert public.t9r_fails($q$select public.admin_member_timeline('9c000000-0000-0000-0000-0000000000c3')$q$) is null, 'same batch, other department: allowed';
  assert public.t9r_fails($q$select public.admin_set_member('9c000000-0000-0000-0000-0000000000c3', null, 'verified')$q$) like '42501%', 'members_verify is not part of a batch rep''s role';
  assert (public.admin_attention() ->> 'global') is null or true, 'attention does not error';
  assert public.is_group_admin((select id from public.groups where slug = 'r9-2005')), 'group admin of the batch group';
  assert not public.is_group_admin((select id from public.groups where slug = 'r9-2010')), 'not of another batch';
  assert (select count(*) from public.profile_private where id = '9c000000-0000-0000-0000-0000000000c2') = 0, 'phone from another batch hidden';
end $$;
reset role;

-- ---------------------------------------------------------------- unscoped admins are unaffected
select pg_temp.login('9c000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert (public.admin_list_members('{}'::jsonb, 1, 0, false) ->> 'total')::int = current_setting('t9r.all')::int, 'the owner still sees everyone';
  perform public.admin_set_member('9c000000-0000-0000-0000-0000000000c4', null, 'verified');
  assert (select verification from public.profiles where id = '9c000000-0000-0000-0000-0000000000c4') = 'verified', 'and verifies anyone';
end $$;
reset role;
select pg_temp.login('9c000000-0000-0000-0000-0000000000b3');
set local role authenticated;
do $$ begin
  assert public.t9r_fails($q$select public.admin_list_members('{}'::jsonb, 1, 0, false)$q$) like '42501%', 'a treasurer has no member access';
end $$;
reset role;
select 'ALL ROLE SCOPE TESTS PASSED';
rollback;
