-- Downloading the activity log is itself logged; only admins may call it. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('96a00000-0000-0000-0000-00000000000a', 'boss96a@x.com', '{"full_name":"Boss Audit"}'),
  ('96a00000-0000-0000-0000-00000000000b', 'bela96a@x.com', '{"full_name":"Bela Audit"}');
update public.profiles set is_admin = true, onboarded = true, verification = 'verified' where id = '96a00000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.login('96a00000-0000-0000-0000-00000000000b');
do $$ begin
  begin perform public.admin_log_audit_export(3, '{}'); raise exception 'a member must not be able to log an export';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.login('96a00000-0000-0000-0000-00000000000a');
select public.admin_log_audit_export(7, '{"q":"x"}');
do $$ begin
  if not exists (select 1 from public.admin_audit where action = 'export_audit' and actor = '96a00000-0000-0000-0000-00000000000a' and (details ->> 'count')::int = 7) then
    raise exception 'the export was not logged';
  end if;
end $$;
rollback;
