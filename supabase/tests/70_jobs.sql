-- Jobs board rules. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Asha"}'),
  ('70000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela"}'),
  ('70000000-0000-0000-0000-0000000000cc', 'c@x.com', '{"full_name":"Chetan"}'),
  ('70000000-0000-0000-0000-0000000000dd', 'd@x.com', '{"full_name":"Dev"}'),
  ('70000000-0000-0000-0000-0000000000ee', 'e@x.com', '{"full_name":"Esha"}'),
  ('70000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Admin"}'),
  ('70000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '70000000-%' and id <> '70000000-0000-0000-0000-0000000000aa';
update public.profiles set is_admin = true where id = '70000000-0000-0000-0000-0000000000ff';
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

select pg_temp.login('70000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare j public.jobs;
begin
  j := public.post_job('{"title":"Senior Backend Engineer","company":"Acme Pune","location":"Pune","job_type":"full_time","work_mode":"hybrid","experience":"5+ years","description":"Build payment systems in Go. Referrals welcome from JEC alumni.","apply_url":"https://acme.example/careers/1","can_refer":true}');
  insert into t values ('job', j.id);
  assert j.posted_by = auth.uid() and j.work_mode = 'hybrid' and j.can_refer, 'posted as me';
  assert j.expires_at between now() + interval '44 days' and now() + interval '46 days', 'default 45 days';
  -- validation
  begin perform public.post_job('{"title":"x","company":"Acme","description":"too short","apply_url":"https://a.example/"}'); assert false, 'title too short';
  exception when check_violation then null; end;
  begin perform public.post_job('{"title":"Engineer","company":"Acme","description":"Twenty characters of description here"}'); assert false, 'needs a way to apply';
  exception when check_violation then null; end;
  begin perform public.post_job('{"title":"Engineer","company":"Acme","description":"Twenty characters of description here","apply_url":"javascript:alert(1)"}'); assert false, 'only http(s) links';
  exception when check_violation then null; end;
  begin perform public.post_job('{"title":"Engineer","company":"Acme","description":"Twenty characters of description here","apply_email":"not an email"}'); assert false, 'valid email';
  exception when check_violation then null; end;
  begin perform public.post_job('{"title":"Engineer","company":"Acme","description":"Twenty characters of description here","apply_email":"hr@acme.example","days":500}'); assert false, 'days range';
  exception when raise_exception then null; end;
  perform public.post_job('{"title":"Data Analyst","company":"Beta","description":"Twenty characters of description here","apply_email":"hr@beta.example"}');
  perform public.post_job('{"title":"Support Engineer","company":"Gamma","description":"Twenty characters of description here","apply_email":"hr@gamma.example"}');
  perform public.post_job('{"title":"QA Engineer","company":"Delta","description":"Twenty characters of description here","apply_email":"hr@delta.example"}');
  perform public.post_job('{"title":"DevOps Engineer","company":"Eps","description":"Twenty characters of description here","apply_email":"hr@eps.example"}');
  begin perform public.post_job('{"title":"Sixth job today","company":"Zeta","description":"Twenty characters of description here","apply_email":"hr@zeta.example"}'); assert false, '5 a day';
  exception when raise_exception then assert sqlerrm like 'You can post up to 5 jobs a day%', 'friendly: ' || sqlerrm; end;
  begin insert into public.jobs (posted_by, title, company, description, apply_email) values (auth.uid(), 'Direct', 'X', 'Twenty characters of description here', 'a@b.co'); assert false, 'no direct insert';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- unverified members can't post or see
select pg_temp.login('70000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  begin perform public.post_job('{"title":"Engineer","company":"Acme","description":"Twenty characters of description here","apply_email":"hr@acme.example"}'); assert false, 'unverified cannot post';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.jobs) = 0, 'unverified see nothing';
  assert (select count(*) from public.search_jobs()) = 0, 'unverified search returns nothing';
end $$;
reset role;

-- another member searches, filters, saves
select pg_temp.login('70000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.search_jobs()) = 5, 'sees all five';
  assert (select count(*) from public.search_jobs('backend')) = 1, 'title search';
  assert (select count(*) from public.search_jobs('ACME')) = 1, 'company search, any case';
  assert (select count(*) from public.search_jobs('%')) = 0, 'wildcards are literal';
  assert (select count(*) from public.search_jobs(null, 'full_time', 'hybrid')) = 1, 'type + mode filter';
  assert (select can_refer and poster_name = 'Asha' from public.search_jobs('backend')), 'poster shown with referral flag';
  insert into public.job_saves (job_id, user_id) values ((select v from t where k = 'job'), auth.uid());
  assert (select saved from public.search_jobs('backend')), 'saved flag';
  assert (select count(*) from public.search_jobs(null, null, null, true)) = 1, 'saved-only filter';
  begin perform public.update_my_job((select v from t where k = 'job'), true); assert false, 'only the poster edits';
  exception when insufficient_privilege then null; end;
  delete from public.jobs where id = (select v from t where k = 'job'); -- not mine: no effect
  assert (select count(*) from public.search_jobs()) = 5, 'others cannot delete';
end $$;
reset role;

-- three reports hide a posting; poster can close and extend
select pg_temp.login('70000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  perform public.report_job((select v from t where k = 'job'), 'Looks like a scam');
  perform public.report_job((select v from t where k = 'job'), 'Looks like a scam'); -- idempotent
  begin perform public.report_job((select v from t where k = 'job'), 'x'); assert false, 'reason needed';
  exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.login('70000000-0000-0000-0000-0000000000cc');
set local role authenticated;
do $$ begin perform public.report_job((select v from t where k = 'job'), 'Spam'); end $$;
reset role;
select pg_temp.login('70000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin perform public.report_job((select v from t where k = 'job'), 'Misleading'); end $$;
reset role;
select pg_temp.login('70000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.search_jobs()) = 4, 'auto-hidden after three reports';
  assert (select count(*) from public.jobs where id = (select v from t where k = 'job')) = 0, 'hidden from members';
end $$;
reset role;
select pg_temp.login('70000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare j public.jobs;
begin
  assert (select count(*) from public.jobs where id = (select v from t where k = 'job')) = 1, 'poster still sees their own';
  begin perform public.report_job((select v from t where k = 'job'), 'myself'); assert false, 'cannot report own';
  exception when raise_exception or insufficient_privilege then null; end;
end $$;
reset role;

-- admin moderation: queue lists it, restore, then poster closes/extends
select pg_temp.login('70000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin
  assert (select report_count from public.admin_reports() where target_id = (select v from t where k = 'job')) = 3, 'queue shows the job';
  assert (select preview like 'Senior Backend Engineer at Acme Pune%' from public.admin_reports() where target_type = 'job'), 'preview';
  perform public.moderate('job', (select v from t where k = 'job'), false, 'dismissed');
  assert (select count(*) from public.search_jobs()) = 5, 'restored by admin';
  assert exists (select 1 from public.admin_audit where action = 'restore_job'), 'audited';
end $$;
reset role;
select pg_temp.login('70000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare j public.jobs;
begin
  j := public.update_my_job((select v from t where k = 'job'), true);
  assert j.is_closed, 'closed';
  assert (select count(*) from public.search_jobs()) = 4, 'closed jobs leave the board';
  j := public.update_my_job((select v from t where k = 'job'), false, 30);
  assert not j.is_closed and j.expires_at > now() + interval '70 days', 'reopened and extended';
  assert j.expires_at <= j.created_at + interval '120 days', 'never beyond 120 days in total';
  delete from public.jobs where id = (select v from t where k = 'job');
  assert (select count(*) from public.jobs where id = (select v from t where k = 'job')) = 0, 'poster can delete';
end $$;
reset role;
-- expired postings disappear
update public.jobs set created_at = now() - interval '60 days', expires_at = now() - interval '1 day' where company = 'Beta';
select pg_temp.login('70000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin assert (select count(*) from public.search_jobs('Beta')) = 0, 'expired postings are not listed'; end $$;
reset role;
select 'ALL JOBS TESTS PASSED';
rollback;
