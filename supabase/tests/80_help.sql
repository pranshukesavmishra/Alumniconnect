-- Ask JEC rules. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Asker"}'),
  ('80000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Helper"}'),
  ('80000000-0000-0000-0000-00000000000c', 'c@x.com', '{"full_name":"Other"}'),
  ('80000000-0000-0000-0000-0000000000bb', 'd@x.com', '{"full_name":"Blocked Helper"}'),
  ('80000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}'),
  ('80000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Admin"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '80000000-%' and id <> '80000000-0000-0000-0000-0000000000aa';
update public.profiles set is_admin = true where id = '80000000-0000-0000-0000-0000000000ff';
update public.profiles set help_tags = array['Referrals', 'Startups'] where id in ('80000000-0000-0000-0000-00000000000b', '80000000-0000-0000-0000-0000000000bb');
update public.profiles set help_tags = array['Hiring'] where id = '80000000-0000-0000-0000-00000000000c';
insert into public.blocks (blocker, blocked) values ('80000000-0000-0000-0000-0000000000bb', '80000000-0000-0000-0000-00000000000a');
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

select pg_temp.login('80000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.help_requests;
begin
  r := public.ask_for_help('Referrals', 'Looking for a referral to a Pune product company', 'Backend engineer, 4 years, Go and Java.');
  insert into t values ('req', r.id);
  assert r.author_id = auth.uid() and not r.is_resolved, 'asked as me';
  begin perform public.ask_for_help('Referrals', 'hey', null); assert false, 'title too short';
  exception when check_violation then null; end;
  begin perform public.ask_for_help('', 'A proper question title here', null); assert false, 'topic needed';
  exception when raise_exception then null; end;
  perform public.ask_for_help('Startups', 'How do I validate a startup idea cheaply?', null);
  perform public.ask_for_help('Hiring', 'Who is hiring freshers in Bhopal?', null);
  begin perform public.ask_for_help('Hiring', 'A fourth question today please', null); assert false, '3 a day';
  exception when raise_exception then assert sqlerrm like 'You can ask up to 3 questions a day%', 'friendly: ' || sqlerrm; end;
  begin insert into public.help_requests (author_id, tag, title) values (auth.uid(), 'x', 'direct insert here'); assert false, 'no direct insert';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  -- the right people were told: Referrals offerers (not the blocker, not the asker), once
  assert (select count(*) from public.notifications where kind = 'help_request' and target_id = (select v from t where k = 'req')) = 1, 'one helper notified for Referrals';
  assert exists (select 1 from public.notifications where kind = 'help_request' and user_id = '80000000-0000-0000-0000-00000000000b' and target_id = (select v from t where k = 'req')), 'the helper';
  assert not exists (select 1 from public.notifications where kind = 'help_request' and user_id = '80000000-0000-0000-0000-0000000000bb'), 'blocked helper not notified';
  assert not exists (select 1 from public.notifications where kind = 'help_request' and user_id = '80000000-0000-0000-0000-00000000000a'), 'asker not notified';
end $$;

select pg_temp.login('80000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.list_help_requests()) = 3, 'helper sees the board';
  assert (select count(*) from public.list_help_requests(null, true)) = 2, '"for me": only Referrals and Startups';
  assert (select count(*) from public.list_help_requests('Referrals')) = 1, 'tag filter';
  assert (select matches_me from public.list_help_requests('Referrals')), 'matches flag';
  begin perform public.resolve_help_request((select v from t where k = 'req')); assert (select not is_resolved from public.help_requests where id = (select v from t where k = 'req')), 'only the asker resolves';
  end;
end $$;
reset role;
select pg_temp.login('80000000-0000-0000-0000-0000000000bb');
set local role authenticated;
do $$ begin assert (select count(*) from public.list_help_requests()) = 0, 'blocked members do not see the asker''s requests'; end $$;
reset role;
select pg_temp.login('80000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.list_help_requests()) = 0 and (select count(*) from public.help_requests) = 0, 'unverified see nothing';
  begin perform public.ask_for_help('Referrals', 'Can an unverified member ask?', null); assert false, 'unverified cannot ask';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- three reports hide; admin queue; asker resolves and deletes
select pg_temp.login('80000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  perform public.report_help_request((select v from t where k = 'req'), 'Looks like spam');
  perform public.report_help_request((select v from t where k = 'req'), 'Looks like spam');
  begin perform public.report_help_request((select v from t where k = 'req'), 'x'); assert false, 'reason';
  exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.login('80000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin perform public.report_help_request((select v from t where k = 'req'), 'Spam'); end $$;
reset role;
select pg_temp.login('80000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin
  perform public.report_help_request((select v from t where k = 'req'), 'Third report'); -- admin counts as a member too
  assert (select count(*) from public.list_help_requests()) = 2, 'auto-hidden after three reports';
  assert (select report_count from public.admin_reports() where target_id = (select v from t where k = 'req')) = 3, 'queue shows it';
  assert (select place from public.admin_reports() where target_type = 'help') = 'Ask JEC', 'place';
  perform public.moderate('help', (select v from t where k = 'req'), false, 'dismissed');
  assert (select count(*) from public.list_help_requests()) = 3, 'restored';
end $$;
reset role;
select pg_temp.login('80000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  perform public.resolve_help_request((select v from t where k = 'req'));
  assert (select is_resolved from public.help_requests where id = (select v from t where k = 'req')), 'resolved by the asker';
  assert (select count(*) from public.list_help_requests()) = 2, 'resolved leave the board';
  assert (select count(*) from public.list_help_requests(null, false, true)) = 3, 'unless asked for';
  delete from public.help_requests where id = (select v from t where k = 'req');
  assert (select count(*) from public.help_requests where id = (select v from t where k = 'req')) = 0, 'asker deletes';
end $$;
reset role;
select 'ALL HELP TESTS PASSED';
rollback;
