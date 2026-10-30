-- Quick profile: AI limits, quick save, reunion-list matching privacy, claim once, registration -> profile,
-- LinkedIn enrich limits and verification hints. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- A: e-mail on the list. B: phone on the list. C: stranger. D: admin. E: another stranger with B's initial.
insert into auth.users (id, email, raw_user_meta_data) values
  ('99a00000-0000-0000-0000-00000000000a', 'Asha.Rao@Example.com', '{"full_name":""}'),
  ('99a00000-0000-0000-0000-00000000000b', 'bela@x99.com', '{"full_name":"Bela Shah"}'),
  ('99a00000-0000-0000-0000-00000000000c', 'chetan@x99.com', '{"full_name":"Chetan"}'),
  ('99a00000-0000-0000-0000-00000000000d', 'admin@x99.com', '{"full_name":"Admin"}'),
  ('99a00000-0000-0000-0000-00000000000e', 'bharat@x99.com', '{"full_name":"Bharat"}');
update public.profiles set is_admin = true, verification = 'verified' where id = '99a00000-0000-0000-0000-00000000000d';
update public.profiles set city = 'Mumbai' where id = '99a00000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------- admin-only import
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  begin
    perform public.admin_prefill_import('[{"full_name":"X Y","email":"xy@x99.com"}]'::jsonb, 'List');
    assert false, 'a member must not import';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.prefill_records;
    assert false, 'members cannot read the list';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.login('99a00000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.admin_prefill_import(jsonb_build_array(
    jsonb_build_object('full_name', 'Asha Rao', 'email', 'asha.rao@example.com', 'phone', '+919876500001', 'grad_year', '2008', 'branch', 'B.E. in Mechanical Engineering',
                       'city', 'Pune', 'organisation', 'L&T', 'designation', 'Senior Manager', 'member_type', 'alumnus'),
    jsonb_build_object('full_name', 'Dr. Bela Shah', 'phone', '+919876500002', 'grad_year', '2005', 'organisation', 'TCS', 'designation', 'Architect'),
    jsonb_build_object('full_name', 'No Contact', 'email', 'not-an-email'),
    jsonb_build_object('full_name', 'X')), 'Grand Reunion form');
  assert (r ->> 'added')::int = 2, 'two added: ' || r::text;
  assert jsonb_array_length(r -> 'problems') = 2, 'two problems';
  -- importing again updates instead of duplicating
  r := public.admin_prefill_import('[{"full_name":"Asha Rao","email":"ASHA.RAO@example.com","city":"Pune"}]'::jsonb, 'Grand Reunion form');
  assert (r ->> 'updated')::int = 1 and (r ->> 'added')::int = 0, 'updated: ' || r::text;
  assert (select count(*) from public.admin_prefill_list(null, 'all', 50, 0)) = 2, 'admin sees the list';
  assert (select email_masked from public.admin_prefill_list('Asha', 'all', 50, 0)) = 'as•••ao@example.com', 'e-mail masked';
  assert (select phone_tail from public.admin_prefill_list('Bela', 'all', 50, 0)) = '••0002', 'phone masked';
end $$;
reset role;
do $$ begin assert (select count(*) from public.admin_audit where action = 'prefill_import') >= 2, 'import logged'; end $$;

-- ---------------------------------------------------------------- matching privacy
-- C (no match) sees nothing, even guessing B's number with the wrong initial
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.my_prefill_match(null, null)) = 0, 'stranger: nothing';
  assert (select count(*) from public.my_prefill_match('+919876500002', 'Chetan')) = 0, 'wrong initial: nothing';
  assert (select count(*) from public.my_prefill_match('+919876500002', 'C B')) = 0, 'wrong initial (first letter counts): nothing';
  -- claiming without a match is refused and reveals nothing
  begin
    perform public.claim_prefill((select id from public.prefill_records limit 1), null, null);
    assert false, 'claim without match';
  exception when others then null; end;
end $$;
reset role;
-- (the record ids were read as postgres above only because the claim is refused anyway)

-- A: matched by sign-in e-mail (case-insensitive); the record's e-mail and phone are not returned
select pg_temp.login('99a00000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare m record; filled text[];
begin
  select * into m from public.my_prefill_match(null, null);
  assert m.match_kind = 'email' and m.full_name = 'Asha Rao' and m.organisation = 'L&T', 'email match: ' || coalesce(m.full_name, 'none');
  filled := public.claim_prefill(m.id, null, null);
  assert 'full_name' = any (filled) and 'current_company' = any (filled) and 'phone' = any (filled), 'filled: ' || filled::text;
  assert not ('city' = any (filled)), 'city was not empty: not overwritten';
  assert (select city from public.profiles where id = auth.uid()) = 'Mumbai', 'city kept';
  assert (select current_title || '|' || current_company || '|' || grad_year || '|' || branch || '|' || full_name from public.profiles where id = auth.uid())
       = 'Senior Manager|L&T|2008|B.E. in Mechanical Engineering|Asha Rao', 'profile filled';
  assert (select phone from public.profile_private where id = auth.uid()) = '+919876500001', 'phone filled';
  assert (select count(*) from public.my_prefill_match(null, null)) = 0, 'nothing more to offer after a claim';
  begin
    perform public.claim_prefill(m.id, null, null);
    assert false, 'claim twice';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- B: matched by typed phone + same initial (title "Dr." ignored); E with the same number but another initial gets nothing
select pg_temp.login('99a00000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.my_prefill_match('+919876500002', 'Bharat')) = 1, 'same initial b matches (that is the rule)';
end $$;
reset role;
select pg_temp.login('99a00000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare m record;
begin
  select * into m from public.my_prefill_match('+919876500002', 'Bela Shah');
  assert m.match_kind = 'phone', 'phone match';
  perform public.claim_prefill(m.id, '+919876500002', 'Bela Shah');
  assert (select current_company from public.profiles where id = auth.uid()) = 'TCS', 'filled from list';
  assert (select full_name from public.profiles where id = auth.uid()) = 'Bela Shah', 'own name kept';
end $$;
reset role;
-- claim once: E can no longer get B's record
select pg_temp.login('99a00000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.my_prefill_match('+919876500002', 'Bharat')) = 0, 'claimed records are never offered again';
end $$;
reset role;

-- phone look-ups are limited to 10 a day
update public.ai_fill_usage set prefill_lookups = 0 where user_id = '99a00000-0000-0000-0000-00000000000c';
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  for i in 1..10 loop perform * from public.my_prefill_match('+91987650' || lpad(i::text, 4, '0'), 'Chetan'); end loop;
  assert (select prefill_lookups from public.ai_fill_usage where user_id = auth.uid()) = 10, 'counted';
end $$;
reset role;
insert into public.prefill_records (full_name, phone) values ('Chandan', '+919876509999');
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.my_prefill_match('+919876509999', 'Chetan')) = 0, '11th look-up gets nothing';
end $$;
reset role;
-- "Not me" hides it
update public.ai_fill_usage set prefill_lookups = 0 where user_id = '99a00000-0000-0000-0000-00000000000c';
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare m record;
begin
  select * into m from public.my_prefill_match('+919876509999', 'Chetan');
  assert m.id is not null, 'match before dismissal';
  perform public.dismiss_prefill(m.id);
  assert (select count(*) from public.my_prefill_match('+919876509999', 'Chetan')) = 0, 'dismissed';
end $$;
reset role;

-- admins see claimed / unclaimed
select pg_temp.login('99a00000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.admin_prefill_list(null, 'claimed', 50, 0)) = 2, 'two claimed';
  assert (select claimed_by_name from public.admin_prefill_list('Asha', 'all', 50, 0)) = 'Asha Rao', 'claimed by';
  assert (select claimed_total from public.admin_prefill_list(null, 'unclaimed', 50, 0) limit 1) = 2, 'claimed total';
  perform public.admin_prefill_delete((select id from public.admin_prefill_list('Asha', 'all', 50, 0)));
  assert (select count(*) from public.admin_prefill_list('Asha', 'all', 50, 0)) = 1, 'claimed records cannot be deleted';
end $$;
reset role;

-- ---------------------------------------------------------------- AI limits (service role only)
do $$
declare r jsonb;
begin
  for i in 1..10 loop
    r := public.ai_fill_take('99a00000-0000-0000-0000-00000000000c', 500, 100);
    assert (r ->> 'ok')::boolean, 'call ' || i;
  end loop;
  r := public.ai_fill_take('99a00000-0000-0000-0000-00000000000c', 500, 100);
  assert not (r ->> 'ok')::boolean and r ->> 'reason' = 'user_limit', '11th refused: ' || r::text;
  assert (select input_chars from public.ai_fill_usage where user_id = '99a00000-0000-0000-0000-00000000000c' and day = public._india_today()) = 1000, 'only counts stored';
  for i in 1..11 loop r := public.ai_fill_take('99a00000-0000-0000-0000-00000000000d', 500, 0); end loop;
  assert (r ->> 'ok')::boolean and (r ->> 'limit')::int = 60, 'admins get 60';
  r := public.ai_fill_take('99a00000-0000-0000-0000-00000000000b', 21, 0);
  assert not (r ->> 'ok')::boolean and r ->> 'reason' = 'global_limit', 'global cap: ' || r::text;
  r := public.ai_fill_take(gen_random_uuid(), 500, 0);
  assert not (r ->> 'ok')::boolean, 'unknown user';
end $$;
-- the raw text has nowhere to go: no text column in the usage table
do $$ begin
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_fill_usage' and data_type = 'text'), 'no text stored';
end $$;
-- members see only their own counters
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.ai_fill_usage) = 1, 'own row only';
end $$;
reset role;

-- ---------------------------------------------------------------- quick save
select pg_temp.login('99a00000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  perform public.save_my_quick_profile(
    '{"current_title":"CTO","current_company":"Acme","city":"Indore","grad_year":2009,"branch":"B.E. in Computer Science & Engineering","skills":["Go","Go","SQL"],"help_tags":["Referrals"],"about":"I build things.","linkedin_url":"https://www.linkedin.com/in/chetan"}'::jsonb,
    '[{"title":"CTO","company":"Acme","start_year":2019,"end_year":null,"is_current":true},{"title":"Engineer","company":"Infosys","start_year":2009,"end_year":2015,"is_current":false},{"title":"","company":"Nope"}]'::jsonb,
    '[{"school":"IIM Indore","degree":"MBA","field":null,"start_year":2016,"end_year":2018}]'::jsonb);
  assert (select current_title || '|' || city || '|' || grad_year || '|' || array_length(skills, 1) || '|' || linkedin_url from public.profiles where id = auth.uid())
       = 'CTO|Indore|2009|2|https://www.linkedin.com/in/chetan', 'profile saved';
  assert (select count(*) from public.experiences where profile_id = auth.uid() and source = 'ai') = 2, 'two jobs, empty one skipped';
  assert (select end_date from public.experiences where profile_id = auth.uid() and company = 'Infosys') = '2015-01-01', 'years to dates';
  assert (select count(*) from public.educations where profile_id = auth.uid() and source = 'ai') = 1, 'education saved';
  -- saving again does not duplicate; a bad LinkedIn link is ignored; keys not sent are not touched
  perform public.save_my_quick_profile('{"linkedin_url":"https://evil.example/in/x"}'::jsonb, '[{"title":"cto","company":"ACME","is_current":true}]'::jsonb, '[]'::jsonb);
  assert (select count(*) from public.experiences where profile_id = auth.uid()) = 2, 'no duplicate job';
  assert (select linkedin_url || '|' || city from public.profiles where id = auth.uid()) = 'https://www.linkedin.com/in/chetan|Indore', 'untouched';
end $$;
reset role;

-- ---------------------------------------------------------------- registration answers fill empty profile fields
insert into public.events (id, slug, title, is_published) values ('99a00000-0000-0000-0000-0000000000e1', 'qp99', 'QP99', true);
update public.profiles set city = null, current_title = null, current_company = 'Keep Ltd' where id = '99a00000-0000-0000-0000-00000000000e';
insert into public.event_registrations (event_id, user_id, code, full_name, phone, city, designation, company)
  values ('99a00000-0000-0000-0000-0000000000e1', '99a00000-0000-0000-0000-00000000000e', 'JEC-QP991', 'Bharat', '+919876511111', 'Bhopal', 'Director', 'Other Co');
do $$ begin
  assert (select city || '|' || current_title || '|' || current_company from public.profiles where id = '99a00000-0000-0000-0000-00000000000e') = 'Bhopal|Director|Keep Ltd',
    'empty fields filled, filled ones kept';
  assert (select phone from public.profile_private where id = '99a00000-0000-0000-0000-00000000000e') = '+919876511111', 'phone filled';
end $$;
update public.event_registrations set city = 'Delhi' where code = 'JEC-QP991';
do $$ begin
  assert (select city from public.profiles where id = '99a00000-0000-0000-0000-00000000000e') = 'Bhopal', 'never overwritten';
end $$;

-- ---------------------------------------------------------------- LinkedIn enrich limits and verification hints
do $$
declare r jsonb;
begin
  for i in 1..3 loop r := public.enrich_take('99a00000-0000-0000-0000-00000000000e', 50); assert (r ->> 'ok')::boolean, 'look-up ' || i; end loop;
  r := public.enrich_take('99a00000-0000-0000-0000-00000000000e', 50);
  assert r ->> 'reason' = 'user_limit', '3 a day';
  r := public.enrich_take('99a00000-0000-0000-0000-00000000000b', 3);
  assert r ->> 'reason' = 'global_limit', 'global cap';
  -- a JEC education: hint for admins, batch/branch only when empty, NOT verified (switch is off)
  update public.profiles set grad_year = null, branch = null, verification = 'pending' where id = '99a00000-0000-0000-0000-00000000000e';
  assert public.record_verification_hint('99a00000-0000-0000-0000-00000000000e', 'Jabalpur Engineering College', 'B.E.', 'Mechanical', 'B.E. in Mechanical Engineering', 2004, 2008, 'https://www.linkedin.com/in/bharat') = 'open', 'open hint';
  assert (select verification::text || '|' || grad_year || '|' || branch from public.profiles where id = '99a00000-0000-0000-0000-00000000000e') = 'pending|2008|B.E. in Mechanical Engineering', 'not auto-verified';
end $$;
-- members cannot see hints; admins approve with one tap
select pg_temp.login('99a00000-0000-0000-0000-00000000000e');
set local role authenticated;
do $$ begin
  begin perform * from public.admin_verification_hints(); assert false, 'members cannot list hints'; exception when insufficient_privilege then null; end;
  begin perform * from public.verification_hints; assert false, 'no table access'; exception when insufficient_privilege then null; end;
  begin perform public.admin_set_flag('auto_verify_linkedin_jec', true); assert false, 'members cannot switch'; exception when insufficient_privilege then null; end;
  assert (public.quick_profile_flags() ->> 'linkedin_fill')::boolean = false, 'LinkedIn fill is off by default';
end $$;
reset role;
select pg_temp.login('99a00000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$
declare h record;
begin
  select * into h from public.admin_verification_hints() where user_id = '99a00000-0000-0000-0000-00000000000e';
  assert h.school = 'Jabalpur Engineering College' and h.end_year = 2008, 'hint listed';
  begin perform public.admin_set_flag('auto_verify_linkedin_jec', true); assert false, 'only super admins switch'; exception when insufficient_privilege then null; end;
  perform public.admin_review_hint(h.id, true);
  assert (select verification from public.profiles where id = '99a00000-0000-0000-0000-00000000000e') = 'verified', 'approved';
  assert (select count(*) from public.admin_verification_hints()) = 0, 'queue empty';
end $$;
reset role;
-- with the switch on (super admin), a pending member with JEC on LinkedIn is verified automatically and it is logged
update public.app_flags set enabled = true where key = 'auto_verify_linkedin_jec';
update public.profiles set verification = 'pending' where id = '99a00000-0000-0000-0000-00000000000b';
do $$ begin
  assert public.record_verification_hint('99a00000-0000-0000-0000-00000000000b', 'GEC Jabalpur', null, null, null, 2001, 2005, null) = 'auto_approved', 'auto';
  assert (select verification from public.profiles where id = '99a00000-0000-0000-0000-00000000000b') = 'verified', 'verified';
  assert exists (select 1 from public.admin_audit where action = 'auto_verify_linkedin_jec' and target_id = '99a00000-0000-0000-0000-00000000000b'), 'logged';
end $$;

-- experience sources accept 'ai' and 'prefill' but nothing else
do $$ begin
  begin
    insert into public.experiences (profile_id, title, company, source) values ('99a00000-0000-0000-0000-00000000000c', 'X', 'Y', 'scraped');
    assert false, 'unknown source';
  exception when check_violation then null; end;
end $$;

select 'ALL QUICK PROFILE TESTS PASSED';
rollback;
