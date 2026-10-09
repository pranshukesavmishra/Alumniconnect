-- Analytics: admin-only, correct counts, no personal data. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Asha"}'),
  ('93000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela"}'),
  ('93000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Admin"}');
update public.profiles set onboarded = true, verification = 'verified', grad_year = 2005, branch = 'Civil Engineering' where id = '93000000-0000-0000-0000-00000000000a';
update public.profiles set onboarded = true, grad_year = 2005, branch = 'Civil Engineering', help_tags = array['Referrals'], invited_by = '93000000-0000-0000-0000-00000000000a' where id = '93000000-0000-0000-0000-00000000000b';
update public.profiles set is_admin = true, verification = 'verified', onboarded = true where id = '93000000-0000-0000-0000-0000000000ff';
create temp table snap (j jsonb);
grant select, insert on snap to authenticated;

select pg_temp.login('93000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.admin_analytics(); assert false, 'members cannot read analytics';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.admin_analytics(); assert false, 'anon cannot call it';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.login('93000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare j jsonb := public.admin_analytics();
begin
  insert into snap values (j);
  assert (j -> 'members' ->> 'total')::int = (select count(*) from public.profiles), 'total matches';
  assert (j -> 'members' ->> 'verified')::int = (select count(*) from public.profiles where verification = 'verified'), 'verified matches';
  assert (j -> 'members' ->> 'offering_help')::int = (select count(*) from public.profiles where cardinality(help_tags) > 0), 'offering help matches';
  assert jsonb_array_length(j -> 'signups_by_day') = 30, '30 zero-filled days';
  assert (select sum((d ->> 'count')::int) from jsonb_array_elements(j -> 'signups_by_day') d) = (select count(*) from public.profiles where created_at > now() - interval '30 days'), 'daily series adds up';
  assert exists (select 1 from jsonb_array_elements(j -> 'by_batch') b where (b ->> 'year')::int = 2005 and (b ->> 'members')::int = 2 and (b ->> 'verified')::int = 1), 'batch 2005 row';
  assert exists (select 1 from jsonb_array_elements(j -> 'invites' -> 'top_inviters') t where t ->> 'name' = 'Asha' and (t ->> 'joined')::int = 1), 'inviter counted';
  -- counts only: no emails or phone numbers anywhere in the answer
  assert j::text !~ '@x\.com', 'no email addresses in the result';
  assert j::text !~* 'phone', 'no phone data in the result';
end $$;
reset role;
-- numbers move when data changes
insert into auth.users (id, email, raw_user_meta_data) values ('93000000-0000-0000-0000-0000000000cc', 'c@x.com', '{"full_name":"Chetan"}');
select pg_temp.login('93000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare before_j jsonb := (select j from snap limit 1); after_j jsonb := public.admin_analytics();
begin
  assert (after_j -> 'members' ->> 'total')::int = (before_j -> 'members' ->> 'total')::int + 1, 'new member counted';
  assert (after_j -> 'members' ->> 'new_7d')::int = (before_j -> 'members' ->> 'new_7d')::int + 1, 'new in 7 days';
end $$;
reset role;
select 'ALL ANALYTICS TESTS PASSED';
rollback;
