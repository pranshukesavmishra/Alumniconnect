-- The merge preview explains its refusals in words (it used to crash when the profile to remove was an admin or the caller). Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('96b00000-0000-0000-0000-00000000000a', 'boss96b@x.com', '{"full_name":"Boss Merge"}'),
  ('96b00000-0000-0000-0000-00000000000b', 'bela96b@x.com', '{"full_name":"Bela Merge"}'),
  ('96b00000-0000-0000-0000-00000000000c', 'chitra96b@x.com', '{"full_name":"Chitra Merge"}');
update public.profiles set is_admin = true where id in ('96b00000-0000-0000-0000-00000000000a', '96b00000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.login('96b00000-0000-0000-0000-00000000000a');
do $$
declare v jsonb;
begin
  v := public.admin_merge_preview('96b00000-0000-0000-0000-00000000000b', '96b00000-0000-0000-0000-00000000000c');
  if not (v -> 'blocks')::text like '%is an admin%' then raise exception 'admin block missing: %', v -> 'blocks'; end if;
  v := public.admin_merge_preview('96b00000-0000-0000-0000-00000000000b', '96b00000-0000-0000-0000-00000000000a');
  if not (v -> 'blocks')::text like '%your own account%' then raise exception 'self block missing: %', v -> 'blocks'; end if;
end $$;
rollback;
