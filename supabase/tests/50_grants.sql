-- Privileges: nothing is granted by default; tables carry only what the app needs. Rolls back.
\set ON_ERROR_STOP 1
begin;
do $$
declare bad text;
begin
  -- anon (not signed in) can never write, truncate or reference anything
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
  assert bad is null, 'anon has write privileges: ' || coalesce(bad, '');

  -- signed-in members never get TRUNCATE / REFERENCES / TRIGGER
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  assert bad is null, 'authenticated has dangerous privileges: ' || coalesce(bad, '');

  -- members cannot change moderation / counter columns by hand
  assert not has_column_privilege('authenticated', 'public.posts', 'is_hidden', 'UPDATE'), 'posts.is_hidden writable';
  assert not has_column_privilege('authenticated', 'public.posts', 'like_count', 'UPDATE'), 'posts.like_count writable';
  assert not has_column_privilege('authenticated', 'public.posts', 'group_id', 'UPDATE'), 'posts.group_id writable';
  assert not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE'), 'profiles.is_admin writable';
  assert not has_column_privilege('authenticated', 'public.profiles', 'verification', 'UPDATE'), 'profiles.verification writable';
  assert not has_column_privilege('authenticated', 'public.profiles', 'is_super_admin', 'UPDATE'), 'profiles.is_super_admin writable';
  assert not has_column_privilege('anon', 'public.profiles', 'is_super_admin', 'SELECT'), 'profiles.is_super_admin readable by anon';
  assert not has_table_privilege('authenticated', 'public.admin_grants', 'INSERT') and not has_table_privilege('authenticated', 'public.admin_grants', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.admin_grants', 'DELETE'), 'admin_grants writable through the API';
  assert not has_table_privilege('anon', 'public.admin_grants', 'SELECT'), 'admin_grants readable by anon';
  assert not has_table_privilege('authenticated', 'public.admin_audit', 'INSERT'), 'audit log writable';
  assert not has_table_privilege('authenticated', 'public.messages', 'INSERT'), 'messages must go through send_message';
  assert not has_table_privilege('authenticated', 'public.reports', 'UPDATE'), 'reports are changed only by admins through functions';
end $$;
select 'ALL GRANT TESTS PASSED';
rollback;
