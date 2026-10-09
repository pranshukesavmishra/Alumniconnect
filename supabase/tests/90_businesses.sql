-- Business directory rules. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Asha"}'),
  ('90000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela"}'),
  ('90000000-0000-0000-0000-0000000000cc', 'c@x.com', '{"full_name":"Chetan"}'),
  ('90000000-0000-0000-0000-0000000000dd', 'd@x.com', '{"full_name":"Dev"}'),
  ('90000000-0000-0000-0000-0000000000ee', 'e@x.com', '{"full_name":"Esha"}'),
  ('90000000-0000-0000-0000-0000000000ff', 'f@x.com', '{"full_name":"Admin"}'),
  ('90000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '90000000-%' and id <> '90000000-0000-0000-0000-0000000000aa';
update public.profiles set is_admin = true where id = '90000000-0000-0000-0000-0000000000ff';
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

select pg_temp.login('90000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare b public.businesses;
begin
  b := public.add_business('{"name":"Asha Web Studio","category":"IT & Software","city":"Jabalpur","description":"We build fast websites and apps for small businesses.","offer":"10% off for JECians","website_url":"https://asha.example/","phone":"+91 98765 43210","whatsapp":true,"email":"hello@asha.example"}');
  insert into t values ('biz', b.id);
  assert b.owner_id = auth.uid() and b.whatsapp and b.offer = '10% off for JECians' and not b.is_hidden, 'listed as me';
  -- validation
  begin perform public.add_business('{"name":"x","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}'); assert false, 'name too short';
  exception when raise_exception then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"too short","email":"a@b.co"}'); assert false, 'description too short';
  exception when raise_exception then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here"}'); assert false, 'needs a way to reach';
  exception when raise_exception then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Spaceships","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}'); assert false, 'category from the list';
  exception when check_violation then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here","website_url":"javascript:alert(1)"}'); assert false, 'only http(s) links';
  exception when check_violation then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here","phone":"12ab"}'); assert false, 'valid phone';
  exception when check_violation then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"not an email"}'); assert false, 'valid email';
  exception when check_violation then null; end;
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co","whatsapp":true}'); assert false, 'whatsapp needs phone';
  exception when check_violation then null; end;
  begin perform public.add_business(('{"name":"Shop","category":"Other","city":"Pune","email":"a@b.co","description":"' || repeat('x', 1501) || '"}')::jsonb); assert false, 'description max 1500';
  exception when check_violation then null; end;
  -- limit of three
  perform public.add_business('{"name":"Asha Cafe","category":"Food & Hospitality","city":"Pune","description":"Filter coffee and snacks near the old campus.","phone":"9876543210"}');
  perform public.add_business('{"name":"Asha Tours","category":"Travel","city":"Bhopal","description":"Weekend trips and group tours for batch reunions.","email":"tours@asha.example"}');
  begin perform public.add_business('{"name":"Fourth","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}'); assert false, '3 listings';
  exception when raise_exception then assert sqlerrm like 'You can list up to 3 businesses%', 'friendly: ' || sqlerrm; end;
  begin insert into public.businesses (owner_id, name, category, city, description, email) values (auth.uid(), 'Direct', 'Other', 'Pune', 'Twenty characters of description here', 'a@b.co'); assert false, 'no direct insert';
  exception when insufficient_privilege then null; end;
  begin update public.businesses set name = 'Hacked' where id = b.id; assert false, 'no direct update';
  exception when insufficient_privilege then null; end;
  -- owner edits through the function
  b := public.update_my_business(b.id, '{"name":"Asha Web Studio Pro","category":"IT & Software","city":"Jabalpur","description":"We build fast websites and apps for small businesses.","website_url":"https://asha.example/","offer":""}');
  assert b.name = 'Asha Web Studio Pro' and b.offer is null and b.phone is null and not b.whatsapp, 'edited';
  begin perform public.update_my_business(b.id, '{"name":"Asha Web Studio","category":"IT & Software","city":"Jabalpur","description":"short","website_url":"https://asha.example/"}'); assert false, 'edit validated';
  exception when raise_exception then null; end;
end $$;
reset role;

-- unverified members can't list or see
select pg_temp.login('90000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  begin perform public.add_business('{"name":"Shop","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}'); assert false, 'unverified cannot list';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.businesses) = 0, 'unverified see nothing';
  assert (select count(*) from public.search_businesses()) = 0, 'unverified search returns nothing';
end $$;
reset role;

-- another member searches; cannot edit or delete
select pg_temp.login('90000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.search_businesses()) = 3, 'sees all three';
  assert (select count(*) from public.search_businesses('web studio')) = 1, 'name search, any case';
  assert (select count(*) from public.search_businesses('COFFEE')) = 1, 'description search';
  assert (select count(*) from public.search_businesses('bhopal')) = 1, 'city via query';
  assert (select count(*) from public.search_businesses(null, 'Travel')) = 1, 'category filter';
  assert (select count(*) from public.search_businesses(null, null, 'jabal')) = 1, 'city filter';
  assert (select count(*) from public.search_businesses(null, 'Travel', 'Jabalpur')) = 0, 'filters combine';
  assert (select count(*) from public.search_businesses('%')) = 0, 'wildcards are literal (%)';
  assert (select count(*) from public.search_businesses('_')) = 0, 'wildcards are literal (_)';
  assert (select count(*) from public.search_businesses(null, null, '%')) = 0, 'city wildcard literal';
  assert (select owner_name = 'Asha' and offer is null from public.search_businesses('web studio')), 'owner shown';
  assert (select count(*) from public.search_businesses(null, null, null, 2, 0)) = 2 and (select count(*) from public.search_businesses(null, null, null, 2, 2)) = 1, 'paging';
  begin perform public.update_my_business((select v from t where k = 'biz'), '{"name":"Mine now","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}'); assert false, 'only the owner edits';
  exception when insufficient_privilege then null; end;
  delete from public.businesses where id = (select v from t where k = 'biz'); -- not mine: no effect
  assert (select count(*) from public.search_businesses()) = 3, 'others cannot delete';
end $$;
reset role;

-- three reports hide a listing
select pg_temp.login('90000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  perform public.report_business((select v from t where k = 'biz'), 'Fake business');
  perform public.report_business((select v from t where k = 'biz'), 'Fake business'); -- idempotent
  begin perform public.report_business((select v from t where k = 'biz'), 'x'); assert false, 'reason needed';
  exception when raise_exception then null; end;
  assert (select count(*) from public.search_businesses()) = 3, 'two reports (same person) do not hide';
end $$;
reset role;
select pg_temp.login('90000000-0000-0000-0000-0000000000cc');
set local role authenticated;
do $$ begin perform public.report_business((select v from t where k = 'biz'), 'Spam'); end $$;
reset role;
select pg_temp.login('90000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin perform public.report_business((select v from t where k = 'biz'), 'Misleading'); end $$;
reset role;
select pg_temp.login('90000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.search_businesses()) = 2, 'auto-hidden after three reports';
  assert (select count(*) from public.businesses where id = (select v from t where k = 'biz')) = 0, 'hidden from members';
  begin perform public.report_business((select v from t where k = 'biz'), 'late'); assert false, 'cannot report hidden';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('90000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.businesses where id = (select v from t where k = 'biz')) = 1, 'owner still sees their own';
  assert (select is_hidden from public.businesses where id = (select v from t where k = 'biz')), 'flagged hidden';
  begin perform public.report_business((select v from t where k = 'biz'), 'myself'); assert false, 'cannot report own';
  exception when raise_exception or insufficient_privilege then null; end;
  perform public.update_my_business((select v from t where k = 'biz'), '{"name":"Edited while hidden","category":"IT & Software","city":"Jabalpur","description":"We build fast websites and apps for small businesses.","email":"hi@asha.example"}');
  assert (select is_hidden from public.businesses where id = (select v from t where k = 'biz')), 'editing does not unhide';
end $$;
reset role;

-- admin moderation
select pg_temp.login('90000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.businesses) = 3, 'admin sees all rows';
  assert (select report_count from public.admin_reports() where target_id = (select v from t where k = 'biz')) = 3, 'queue shows the business';
  assert (select preview like 'Edited while hidden (IT & Software, Jabalpur)%' and place = 'Businesses' and author_name = 'Asha' and removed from public.admin_reports() where target_type = 'business'), 'preview';
  perform public.moderate('business', (select v from t where k = 'biz'), false, 'dismissed');
  assert (select count(*) from public.search_businesses()) = 3, 'restored by admin';
  assert exists (select 1 from public.admin_audit where action = 'restore_business'), 'audited';
  perform public.moderate('business', (select v from t where k = 'biz'), true);
  assert (select count(*) from public.search_businesses()) = 2, 'hidden by admin';
  assert exists (select 1 from public.admin_audit where action = 'hide_business'), 'hide audited';
  -- existing kinds still work
  assert (select count(*) from public.admin_reports('dismissed')) >= 1, 'admin_reports still lists other statuses';
end $$;
reset role;
select pg_temp.login('90000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin perform public.moderate('business', (select v from t where k = 'biz'), false); assert false, 'members cannot moderate';
  exception when insufficient_privilege then null; end;
  begin perform * from public.admin_reports(); assert false, 'members cannot read the queue';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- owner deletes; frees a slot
select pg_temp.login('90000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  delete from public.businesses where id = (select v from t where k = 'biz');
  assert (select count(*) from public.businesses where owner_id = auth.uid()) = 2, 'owner can delete';
  perform public.add_business('{"name":"Replacement","category":"Other","city":"Pune","description":"Twenty characters of description here","email":"a@b.co"}');
end $$;
reset role;

-- grants: nothing for anon, helpers are private
do $$ begin
  assert not has_function_privilege('anon', 'public.add_business(jsonb)', 'execute'), 'anon add';
  assert not has_function_privilege('anon', 'public.update_my_business(uuid, jsonb)', 'execute'), 'anon update';
  assert not has_function_privilege('anon', 'public.search_businesses(text, text, text, int, int)', 'execute'), 'anon search';
  assert not has_function_privilege('anon', 'public.report_business(uuid, text)', 'execute'), 'anon report';
  assert has_function_privilege('authenticated', 'public.add_business(jsonb)', 'execute'), 'auth add';
  assert has_function_privilege('authenticated', 'public.search_businesses(text, text, text, int, int)', 'execute'), 'auth search';
  assert not has_function_privilege('authenticated', 'public._business_clean(jsonb)', 'execute'), 'helper is private';
  assert not has_function_privilege('authenticated', 'public._auto_hide_businesses()', 'execute'), 'trigger fn is private';
  assert not has_table_privilege('anon', 'public.businesses', 'select'), 'anon table';
  assert not has_table_privilege('authenticated', 'public.businesses', 'insert'), 'no insert grant';
  assert not has_table_privilege('authenticated', 'public.businesses', 'update'), 'no update grant';
  assert has_table_privilege('authenticated', 'public.businesses', 'delete'), 'delete grant';
end $$;
select 'ALL BUSINESS TESTS PASSED';
rollback;
