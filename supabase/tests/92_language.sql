-- Interface language: members set their own to en/hi only. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Lang A"}'),
  ('92000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Lang B"}');

do $$ begin
  assert (select language from public.profiles where id = '92000000-0000-0000-0000-00000000000a') = 'en', 'defaults to en';
end $$;

select pg_temp.login('92000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare n int;
begin
  update public.profiles set language = 'hi' where id = auth.uid();
  assert (select language from public.profiles where id = auth.uid()) = 'hi', 'set hi';
  update public.profiles set language = 'en' where id = auth.uid();
  assert (select language from public.profiles where id = auth.uid()) = 'en', 'set en';
  begin update public.profiles set language = 'fr' where id = auth.uid(); assert false, 'fr rejected';
  exception when check_violation then null; end;
  update public.profiles set language = 'hi' where id = '92000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'cannot change someone else''s';
end $$;
reset role;
do $$ begin
  assert (select language from public.profiles where id = '92000000-0000-0000-0000-00000000000b') = 'en', 'B unchanged';
end $$;

set local role anon;
do $$ begin
  begin update public.profiles set language = 'hi'; assert false, 'anon cannot update';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
