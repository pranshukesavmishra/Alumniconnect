-- Give Back: appeals, donations, verification, anonymity, items, milestones, pledges, receipts, permissions, no PII leaks, and sponsorship
-- (packages and slots, tiers, leads from registrations, pipeline, payments through the same queue, in-kind kept out of cash). Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;
-- runs one statement that returns one value as that person; failures come back as 'ERR:<sqlstate>:<message>'
create function pg_temp.q(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.login(p_uid);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  reset role;
  return coalesce(r, 'null');
end $$;
create function pg_temp.err(t text) returns boolean language sql as $$ select t like 'ERR:%' $$;

-- a admin (full), m funds_manage, v funds_verify, r funds_reports, s sponsors_manage, 1 2 4 verified members, 3 unverified
insert into auth.users (id, email, raw_user_meta_data) values
  ('9b000000-0000-0000-0000-0000000000a1', 'a@g95.com', '{"full_name":"Adm"}'),
  ('9b000000-0000-0000-0000-0000000000a2', 'm@g95.com', '{"full_name":"Manager"}'),
  ('9b000000-0000-0000-0000-0000000000a3', 'v@g95.com', '{"full_name":"Verifier"}'),
  ('9b000000-0000-0000-0000-0000000000a4', 'r@g95.com', '{"full_name":"Reporter"}'),
  ('9b000000-0000-0000-0000-0000000000a5', 's@g95.com', '{"full_name":"Sponsor Lead"}'),
  ('9b000000-0000-0000-0000-0000000000c1', 'm1@g95.com', '{"full_name":"Asha One"}'),
  ('9b000000-0000-0000-0000-0000000000c2', 'm2@g95.com', '{"full_name":"Bala Two"}'),
  ('9b000000-0000-0000-0000-0000000000c3', 'm3@g95.com', '{"full_name":"Chitra Three"}'),
  ('9b000000-0000-0000-0000-0000000000c4', 'm4@g95.com', '{"full_name":"Dev Four"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001 where id::text like '9b000000-%';
update public.profiles set grad_year = 2005, branch = 'Computer Science & Engineering' where id = '9b000000-0000-0000-0000-0000000000c2';
update public.profiles set verification = 'pending' where id = '9b000000-0000-0000-0000-0000000000c3';
update public.profiles set is_admin = true where id::text like '9b000000-0000-0000-0000-0000000000a%';
insert into public.admin_grants (user_id, permissions) values
  ('9b000000-0000-0000-0000-0000000000a2', array['funds_manage']),
  ('9b000000-0000-0000-0000-0000000000a3', array['funds_verify']),
  ('9b000000-0000-0000-0000-0000000000a4', array['funds_reports']),
  ('9b000000-0000-0000-0000-0000000000a5', array['sponsors_manage']);
update public.profile_private set phone = '+91 98765 95001' where id = '9b000000-0000-0000-0000-0000000000c1';
insert into public.giving_prefs (user_id, notify_new) values ('9b000000-0000-0000-0000-0000000000c4', false);
insert into public.events (id, slug, title, is_published, upi_id) values ('9b000000-0000-0000-0000-0000000000e1', 'g95-meet', 'G95 Meet', true, 'jec@okhdfc');
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise, fund_paise, sponsor_interest, sponsor_level, sponsor_org, sponsor_note) values
  ('9b000000-0000-0000-0000-0000000000d1', '9b000000-0000-0000-0000-0000000000e1', '9b000000-0000-0000-0000-0000000000c1', 'JEC-G95001', 'Asha One', '+91 98765 95001', 'm1@g95.com', 'confirmed', 1, 200000, 100000, true, 'main', 'Asha Builders Pvt Ltd', 'Happy to talk'),
  ('9b000000-0000-0000-0000-0000000000d2', '9b000000-0000-0000-0000-0000000000e1', '9b000000-0000-0000-0000-0000000000c2', 'JEC-G95002', 'Bala Two', '+91 98765 95002', 'm2@g95.com', 'under_review', 1, 150000, 50000, null, null, null, null);
insert into public.event_payments (registration_id, amount_paise, method, utr, status) values ('9b000000-0000-0000-0000-0000000000d1', 200000, 'upi', '950000000001', 'verified');

-- ---------------------------------------------------------------- catalogue, presets, grants
do $$ begin
  assert (select count(*) from public._permission_catalog() where key in ('funds_manage', 'funds_verify', 'funds_reports', 'sponsors_manage')) = 4, 'four new permissions in the catalog';
  assert not has_table_privilege('authenticated', 'public.giving_donations', 'SELECT') and not has_table_privilege('authenticated', 'public.giving_campaigns', 'SELECT')
     and not has_table_privilege('authenticated', 'public.sponsors', 'SELECT') and not has_table_privilege('authenticated', 'public.giving_settings', 'SELECT'), 'no direct reads';
  assert not has_table_privilege('authenticated', 'public.giving_donations', 'INSERT') and not has_table_privilege('authenticated', 'public.giving_donations', 'UPDATE'), 'no direct writes';
  assert not has_table_privilege('anon', 'public.sponsors', 'SELECT'), 'anon reads nothing';
  assert not has_function_privilege('anon', 'public.giving_hub()', 'execute'), 'anon cannot open the hub';
  assert not has_function_privilege('authenticated', 'public._giving_run_reminders()', 'execute'), 'internal helpers closed';
end $$;

-- ---------------------------------------------------------------- permissions
do $$
declare
  a constant uuid := '9b000000-0000-0000-0000-0000000000a1'; m constant uuid := '9b000000-0000-0000-0000-0000000000a2'; v constant uuid := '9b000000-0000-0000-0000-0000000000a3';
  r constant uuid := '9b000000-0000-0000-0000-0000000000a4'; c1 constant uuid := '9b000000-0000-0000-0000-0000000000c1';
  call text := $c$select public.admin_giving_save_campaign(null, '{"type":"project","title":"Perm check","goal_paise":100000}'::jsonb)::text$c$;
begin
  assert pg_temp.err(pg_temp.q(c1, call)), 'a member cannot create an appeal';
  assert pg_temp.q(c1, call) like 'ERR:42501%', 'refused with 42501';
  assert pg_temp.err(pg_temp.q(v, call)) and pg_temp.err(pg_temp.q(r, call)), 'verify / reports admins cannot create appeals';
  assert not pg_temp.err(pg_temp.q(m, call)), 'funds_manage can';
  assert not pg_temp.err(pg_temp.q(a, call)), 'a full admin can';
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_verify(array[gen_random_uuid()])::text$c$)), 'funds_manage cannot verify';
  assert not pg_temp.err(pg_temp.q(v, $c$select public.admin_giving_verify(array[gen_random_uuid()])::text$c$)), 'funds_verify can';
  assert pg_temp.err(pg_temp.q(v, $c$select public.admin_giving_report('campaign')::text$c$)), 'funds_verify cannot read reports';
  assert not pg_temp.err(pg_temp.q(r, $c$select public.admin_giving_report('campaign')::text$c$)), 'funds_reports can';
  assert pg_temp.err(pg_temp.q(r, $c$select public.admin_giving_donations()::text$c$)), 'reports admin cannot see the queue';
  delete from public.giving_campaigns where title = 'Perm check';
end $$;

-- ---------------------------------------------------------------- lifecycle: draft, publish, visibility, notifications
do $$
declare
  a constant uuid := '9b000000-0000-0000-0000-0000000000a1'; m constant uuid := '9b000000-0000-0000-0000-0000000000a2';
  c1 constant uuid := '9b000000-0000-0000-0000-0000000000c1'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2';
  c3 constant uuid := '9b000000-0000-0000-0000-0000000000c3'; c4 constant uuid := '9b000000-0000-0000-0000-0000000000c4';
  v_id uuid; v_out text; j jsonb;
begin
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"project","title":"X","goal_paise":100000}'::jsonb)::text$c$)), 'title too short';
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"project","title":"Too small","goal_paise":5000}'::jsonb)::text$c$)), 'goal too small';
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"nope","title":"Bad type","goal_paise":500000}'::jsonb)::text$c$)), 'bad type';
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"project","title":"Bad upi","goal_paise":500000,"upi_id":"nonsense"}'::jsonb)::text$c$)), 'bad upi';
  v_out := pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"project","title":"Build the Convocation Hall","summary":"A hall for all of us","story":"Our dream","goal_paise":500000000,
     "suggested_paise":[100000,250000],"department":"Civil Engineering",
     "items":[{"name":"Stage","price_paise":6000000},{"name":"Lights","price_paise":200000}],
     "milestones":[{"percent":25,"title":"Foundation","unlocks":"Foundation laid"},{"percent":50,"title":"Walls"}]}'::jsonb)::text$c$);
  assert not pg_temp.err(v_out), 'campaign created: ' || v_out;
  v_id := v_out::uuid;
  assert (select status from public.giving_campaigns where id = v_id) = 'draft', 'starts as a draft';
  assert (select count(*) from public.giving_items where campaign_id = v_id) = 2 and (select count(*) from public.giving_milestones where campaign_id = v_id) = 2, 'items and milestones saved';
  assert (select count(*) from public.admin_audit where action = 'giving_campaign_create' and target_id = v_id) = 1, 'audited';
  -- members cannot see a draft
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_campaign(%L)::text$c$, (select slug from public.giving_campaigns where id = v_id)))), 'draft hidden from members';
  assert (pg_temp.q(c1, 'select public.giving_hub()::text')::jsonb -> 'campaigns') = '[]'::jsonb, 'draft not in the hub';
  -- cannot publish without a UPI id
  assert pg_temp.q(m, format($c$select public.admin_giving_set_status(%L, 'live')::text$c$, v_id)) like 'ERR:%UPI%', 'needs a UPI id';
  assert not pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_settings('{"default_upi_id":"jecalumni@okicici","payee_name":"JEC Alumni","assoc_name":"JEC Alumni Association"}'::jsonb)::text$c$)), 'settings saved';
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_save_settings('{"default_upi_id":"bad id"}'::jsonb)::text$c$)), 'bad default UPI refused';
  assert not pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_set_status(%L, 'live')::text$c$, v_id))), 'published';
  assert (select published_at is not null from public.giving_campaigns where id = v_id), 'published_at set';
  -- notifications: verified members get 'new appeal', the one who opted out and the unverified do not
  assert exists (select 1 from public.notifications where user_id = c1 and kind = 'giving_new' and target_id = v_id), 'member 1 told';
  assert exists (select 1 from public.notifications where user_id = c2 and kind = 'giving_new' and target_id = v_id), 'member 2 told';
  assert not exists (select 1 from public.notifications where user_id = c4 and kind = 'giving_new'), 'opted-out member not told';
  assert not exists (select 1 from public.notifications where user_id = c3 and kind = 'giving_new'), 'unverified member not told';
  assert not exists (select 1 from public.notifications where user_id = m and kind = 'giving_new'), 'publisher not told';
  -- visible now; an unverified member sees nothing
  j := pg_temp.q(c1, 'select public.giving_hub()::text')::jsonb;
  assert jsonb_array_length(j -> 'campaigns') = 1 and (j -> 'campaigns' -> 0 ->> 'title') = 'Build the Convocation Hall', 'hub lists the live appeal';
  assert pg_temp.err(pg_temp.q(c3, 'select public.giving_hub()::text')), 'unverified members cannot open the hub';
  assert (pg_temp.q(c1, 'select public.giving_featured()::text')::jsonb ->> 'title') = 'Build the Convocation Hall', 'featured';
  -- a published appeal cannot go back to draft once it has gifts; delete only drafts
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_delete_campaign(%L)::text$c$, v_id))), 'a live appeal cannot be deleted';
  assert not pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_set_featured(%L, true)::text$c$, v_id))), 'featured';
  assert (select count(*) from public.admin_audit where target_id = v_id and action in ('giving_campaign_status', 'giving_campaign_feature')) = 2, 'status and feature audited';
end $$;

-- ---------------------------------------------------------------- donations: validation, UTR rules, rate limit
do $$
declare
  c1 constant uuid := '9b000000-0000-0000-0000-0000000000c1'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2';
  c3 constant uuid := '9b000000-0000-0000-0000-0000000000c3'; c4 constant uuid := '9b000000-0000-0000-0000-0000000000c4';
  camp uuid := (select id from public.giving_campaigns where title = 'Build the Convocation Hall');
  res text;
begin
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 999, '950000000010', null, false, null, null)::text$c$, camp))), 'below ₹10';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 100000001, '950000000010', null, false, null, null)::text$c$, camp))), 'above ₹10,00,000';
  assert not pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 1000, '950000000011', null, false, null, null)::text$c$, camp))), '₹10 is the lowest';
  assert not pg_temp.err(pg_temp.q(c2, format($c$select public.giving_submit(%L, null, 100000000, '950000000012', null, false, null, null)::text$c$, camp))), '₹10,00,000 is the highest';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 50000, '12345', null, false, null, null)::text$c$, camp))), 'UTR must be 12 digits';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 50000, '95000000001x', null, false, null, null)::text$c$, camp))), 'UTR digits only';
  assert pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 50000, '950000000011', null, false, null, null)::text$c$, camp)) like 'ERR:%already been used%', 'UTR used by another donation';
  assert pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 50000, '950000000001', null, false, null, null)::text$c$, camp)) like 'ERR:%already been used%', 'UTR used by an event payment';
  assert pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 50000, ' 9500 0000 0011 ', null, false, null, null)::text$c$, camp)) like 'ERR:%already been used%', 'spaces do not hide a reuse';
  assert pg_temp.err(pg_temp.q(c3, format($c$select public.giving_submit(%L, null, 50000, '950000000013', null, false, null, null)::text$c$, camp))), 'unverified cannot give';
  -- the reverse: an event payment cannot reuse a donation UTR
  assert exists (select 1 from public.giving_donations where utr = '950000000011'), 'donation exists';
  insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise)
    values ('9b000000-0000-0000-0000-0000000000d3', '9b000000-0000-0000-0000-0000000000e1', c4, 'JEC-G95003', 'Dev Four', '+91 98765 95003', 'm4@g95.com', 'pending_payment', 1, 100000);
  assert pg_temp.q(c4, $c$select public.submit_upi_payment('9b000000-0000-0000-0000-0000000000d3', '950000000011', 'Dev', null)::text$c$) like 'ERR:%already been used%', 'event payment cannot reuse a donation UTR';
  assert not pg_temp.err(pg_temp.q(c4, $c$select public.submit_upi_payment('9b000000-0000-0000-0000-0000000000d3', '950000000014', 'Dev', null)::text$c$)), 'a fresh UTR still works for events';
  -- the snapshot of batch and department, not trusted from the client
  assert (select donor_batch from public.giving_donations where utr = '950000000012') = 2005, 'batch snapshot';
  -- rate limit: 5 an hour
  for i in 20..23 loop
    res := pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 10000, '9500000000%s', null, false, null, null)::text$c$, camp, i));
    assert not pg_temp.err(res), 'gift ' || i || ': ' || res;
  end loop;
  assert pg_temp.q(c1, format($c$select public.giving_submit(%L, null, 10000, '950000000030', null, false, null, null)::text$c$, camp)) like 'ERR:%', 'sixth gift in the hour refused';
  -- a paused appeal takes no gifts
  update public.giving_campaigns set status = 'paused' where id = camp;
  assert pg_temp.q(c2, format($c$select public.giving_submit(%L, null, 10000, '950000000031', null, false, null, null)::text$c$, camp)) like 'ERR:%paused%', 'paused';
  update public.giving_campaigns set status = 'live' where id = camp;
end $$;

-- ---------------------------------------------------------------- verification, totals, anonymity
do $$
declare
  a constant uuid := '9b000000-0000-0000-0000-0000000000a1'; m constant uuid := '9b000000-0000-0000-0000-0000000000a2'; v constant uuid := '9b000000-0000-0000-0000-0000000000a3';
  r constant uuid := '9b000000-0000-0000-0000-0000000000a4';
  c1 constant uuid := '9b000000-0000-0000-0000-0000000000c1'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2'; c4 constant uuid := '9b000000-0000-0000-0000-0000000000c4';
  camp uuid := (select id from public.giving_campaigns where title = 'Build the Convocation Hall');
  d1 uuid := (select id from public.giving_donations where utr = '950000000011');
  d2 uuid := (select id from public.giving_donations where utr = '950000000012');
  d3 uuid; j jsonb; res text;
begin
  assert (public._giving_raised(camp)) = 0, 'nothing counted before verification';
  update public.giving_donations set is_anonymous = true, message = 'secret love', dedication = 'in honour of Prof. X' where id = d2;
  update public.giving_donations set message = 'for the hall', dedication = 'in honour of Prof. Rao' where id = d1;
  -- queue: only funds_verify, and it sees the names even for anonymous gifts
  assert pg_temp.err(pg_temp.q(m, $c$select public.admin_giving_donations()::text$c$)), 'funds_manage cannot see the queue';
  j := pg_temp.q(v, $c$select public.admin_giving_donations('submitted')::text$c$)::jsonb;
  assert j @> format('[{"id":"%s","donor_name":"Bala Two","is_anonymous":true}]', d2)::jsonb, 'verifier sees the anonymous donor';
  -- bulk verify
  res := pg_temp.q(m, format($c$select public.admin_giving_verify(array[%L::uuid])::text$c$, d1));
  assert res like 'ERR:42501%', 'funds_manage cannot verify';
  res := pg_temp.q(v, format($c$select public.admin_giving_verify(array[%L::uuid, %L::uuid, gen_random_uuid()])::text$c$, d1, d2));
  assert (res::jsonb ->> 'verified') = '2' and jsonb_array_length(res::jsonb -> 'skipped') = 1, 'two verified, unknown one skipped: ' || res;
  assert (select receipt_no from public.giving_donations where id = d1) ~ '^JEC-GV-\d{4}-\d{6}$', 'receipt numbers';
  assert (select count(distinct receipt_no) from public.giving_donations where id in (d1, d2)) = 2, 'unique receipts';
  assert public._giving_raised(camp) = 1000 + 100000000, 'totals follow verified gifts only';
  assert exists (select 1 from public.notifications where user_id = c1 and kind = 'donation_verified' and target_id = d1), 'thank-you notification';
  assert (select count(*) from public.admin_audit where action = 'giving_verify') = 2, 'verification audited';
  -- verifying twice does nothing
  assert (pg_temp.q(v, format($c$select public.admin_giving_verify(array[%L::uuid])::text$c$, d1))::jsonb ->> 'verified') = '0', 'idempotent';
  -- donor wall hides the anonymous donor completely
  res := pg_temp.q(c4, format($c$select public.giving_donors(%L)::text$c$, camp)); assert res not like 'ERR%', res; j := res::jsonb;
  assert jsonb_array_length(j) = 2, 'two gifts on the wall';
  assert exists (select 1 from jsonb_array_elements(j) e where (e ->> 'anonymous')::boolean and e ->> 'name' is null and e ->> 'batch' is null and e ->> 'message' is null and e ->> 'dedication' is null), 'anonymous donor is anonymous';
  assert exists (select 1 from jsonb_array_elements(j) e where e ->> 'name' = 'Asha One' and (e ->> 'batch') = '2001' and e ->> 'dedication' = 'in honour of Prof. Rao'), 'named donor shows name, batch, dedication';
  assert j::text not like '%Bala%' and j::text not like '%secret love%' and j::text not like '%2005%', 'no trace of the anonymous donor';
  -- leaderboard: batch 2001 only; the anonymous amount is separate, batch 2005 is not revealed
  j := pg_temp.q(c4, format($c$select public.giving_leaderboard(%L)::text$c$, camp))::jsonb;
  assert jsonb_array_length(j -> 'batches') = 1 and (j -> 'batches' -> 0 ->> 'batch') = '2001' and (j -> 'batches' -> 0 ->> 'raised_paise') = '1000', 'leaderboard batch 2001';
  assert (j ->> 'anonymous_paise') = '100000000', 'anonymous total separate';
  -- reports: names masked for a reports-only admin, visible when the admin also verifies
  j := pg_temp.q(r, format($c$select public.admin_giving_report('donor', %L)::text$c$, camp))::jsonb;
  assert exists (select 1 from jsonb_array_elements(j) e where e ->> 'name' = 'A JECian') and j::text not like '%Bala%', 'reports mask anonymous donors';
  j := pg_temp.q(a, format($c$select public.admin_giving_report('donor', %L)::text$c$, camp))::jsonb;
  assert j::text like '%Bala Two%', 'a full admin sees the name';
  j := pg_temp.q(r, $c$select public.admin_giving_report('campaign')::text$c$)::jsonb;
  assert (j -> 0 ->> 'raised_paise')::bigint = 100001000 and (j -> 0 ->> 'pending_paise')::bigint = 40000, 'campaign report';
  j := pg_temp.q(r, $c$select public.admin_giving_report('batch')::text$c$)::jsonb;
  assert jsonb_array_length(j) = 2, 'batch report';
  assert jsonb_typeof(pg_temp.q(r, $c$select public.admin_giving_report('month')::text$c$)::jsonb) = 'array' and jsonb_typeof(pg_temp.q(r, $c$select public.admin_giving_report('department')::text$c$)::jsonb) = 'array', 'month and department reports';
  assert pg_temp.err(pg_temp.q(r, $c$select public.admin_giving_report('nonsense')::text$c$)), 'unknown report refused';
  res := pg_temp.q(r, $c$select public.admin_giving_log_export('campaign', 3)::text$c$); assert not pg_temp.err(res), res; assert exists (select 1 from public.admin_audit where action = 'export_giving_data'), 'export logged';
  assert pg_temp.err(pg_temp.q(v, $c$select public.admin_giving_log_export('campaign', 3)::text$c$)), 'export needs funds_reports';
  -- reject one: not counted, donor told, UTR free again
  d3 := (select id from public.giving_donations where utr = '950000000020');
  assert pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_reject(%L, '')::text$c$, d3))), 'a reason is required';
  assert not pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_reject(%L, 'Not in the statement')::text$c$, d3))), 'rejected';
  assert exists (select 1 from public.notifications where user_id = c1 and kind = 'donation_rejected' and target_id = d3), 'donor told';
  assert not pg_temp.err(pg_temp.q(c2, format($c$select public.giving_submit(%L, null, 10000, '950000000020', null, false, null, null)::text$c$, camp))), 'a rejected UTR can be submitted again';
  -- refund lowers the total
  assert pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_refund(%L, '')::text$c$, d2))), 'refund needs a reason';
  assert not pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_refund(%L, 'Donor asked')::text$c$, d2))), 'refunded';
  assert public._giving_raised(camp) = 1000, 'refund removes it from the total';
  assert (select status from public.giving_donations where id = d2) = 'refunded', 'status refunded';
  assert pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_refund(%L, 'again')::text$c$, d2))), 'cannot refund twice';
  -- receipts: owner, verifier; not another member
  assert pg_temp.q(c1, format($c$select public.giving_receipt(%L)::text$c$, d1))::jsonb ->> 'receipt_no' is not null, 'owner reads the receipt';
  assert pg_temp.err(pg_temp.q(c4, format($c$select public.giving_receipt(%L)::text$c$, d1))), 'another member cannot';
  assert not pg_temp.err(pg_temp.q(v, format($c$select public.giving_receipt(%L)::text$c$, d1))), 'a verifier can';
  assert (pg_temp.q(c1, format($c$select public.giving_receipt(%L)::text$c$, d1))::jsonb -> 'tax_text') = 'null'::jsonb, 'no tax text unless the admin entered it';
  perform pg_temp.q(m, $c$select public.admin_giving_save_settings('{"default_upi_id":"jecalumni@okicici","tax_text":"Donations are exempt under 80G (test)","foreign_notice":"Foreign donors: contact the committee","receipt_footer":"Thank you","assoc_name":"JEC Alumni Association"}'::jsonb)::text$c$);
  j := pg_temp.q(c1, format($c$select public.giving_receipt(%L)::text$c$, d1))::jsonb;
  assert j ->> 'tax_text' like '%80G%' and j ->> 'foreign_notice' like 'Foreign%' and j ->> 'footer' = 'Thank you', 'receipt carries the configured texts';
  assert j::text not like '%98765%' and j::text not like '%@g95.com%', 'no donor phone or email on the receipt';
  -- offline gifts
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_record_offline(jsonb_build_object('campaign_id', %L, 'donor_name', 'Cash Donor', 'amount_paise', 500000, 'method', 'cash', 'reason', 'Handed over at the office'))::text$c$, camp))), 'funds_manage cannot record gifts';
  assert pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_record_offline(jsonb_build_object('campaign_id', %L, 'donor_name', 'Cash Donor', 'amount_paise', 500000, 'method', 'cash', 'reason', ''))::text$c$, camp))), 'reason required';
  assert not pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_record_offline(jsonb_build_object('campaign_id', %L, 'donor_name', 'Cash Donor', 'amount_paise', 500000, 'method', 'cash', 'reason', 'Handed over at the office'))::text$c$, camp))), 'recorded';
  assert public._giving_raised(camp) = 501000, 'offline gift counted at once';
end $$;

-- ---------------------------------------------------------------- items, milestones, completion
do $$
declare
  v constant uuid := '9b000000-0000-0000-0000-0000000000a3'; c1 constant uuid := '9b000000-0000-0000-0000-0000000000c4'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2';
  m constant uuid := '9b000000-0000-0000-0000-0000000000a2';
  camp uuid; stage uuid; lights uuid; res text; j jsonb; d uuid;
begin
  -- a small adopt-a-lab appeal: goal ₹1,000
  camp := pg_temp.q(m, $c$select public.admin_giving_save_campaign(null, '{"type":"adopt","title":"Adopt the Civil Lab","goal_paise":100000,"items":[{"name":"Smart board","price_paise":60000},{"name":"Projector","price_paise":30000}],
        "milestones":[{"percent":25,"title":"First quarter","unlocks":"Order the board"},{"percent":100,"title":"Done"}]}'::jsonb)::text$c$)::uuid;
  perform pg_temp.q(m, format($c$select public.admin_giving_set_status(%L, 'live')::text$c$, camp));
  select id into stage from public.giving_items where campaign_id = camp and name = 'Smart board';
  select id into lights from public.giving_items where campaign_id = camp and name = 'Projector';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, %L, 60001, '950000000040', null, false, null, null)::text$c$, camp, stage))), 'more than the item needs';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, %L, 10000, '950000000041', null, false, null, null)::text$c$, camp, gen_random_uuid()))), 'unknown item';
  res := pg_temp.q(c1, format($c$select public.giving_submit(%L, %L, 30000, '950000000042', null, false, null, null)::text$c$, camp, stage));
  assert not pg_temp.err(res), 'part of an item: ' || res;
  d := (res::jsonb ->> 'id')::uuid;
  res := pg_temp.q(c2, format($c$select public.giving_campaign(%L)::text$c$, (select slug from public.giving_campaigns where id = camp))); assert res not like 'ERR%', res; j := res::jsonb;
  assert (select (i ->> 'pending_paise')::bigint from jsonb_array_elements(j -> 'items') i where i ->> 'name' = 'Smart board') = 30000 and
         (select (i ->> 'funded_paise')::bigint from jsonb_array_elements(j -> 'items') i where i ->> 'name' = 'Smart board') = 0, 'pending is not funded';
  assert not (j -> 'milestones' -> 0 ->> 'reached')::boolean, 'milestone not reached yet';
  res := pg_temp.q(v, format($c$select public.admin_giving_verify(array[%L::uuid])::text$c$, d)); assert res like '%"verified": 1%', res;
  j := pg_temp.q(c2, format($c$select public.giving_campaign(%L)::text$c$, (select slug from public.giving_campaigns where id = camp)))::jsonb;
  assert (select (i ->> 'funded_paise')::bigint from jsonb_array_elements(j -> 'items') i where i ->> 'name' = 'Smart board') = 30000, 'verified gift funds the item';
  assert (j ->> 'raised_paise') = '30000' and (j -> 'milestones' -> 0 ->> 'reached')::boolean and not (j -> 'milestones' -> 1 ->> 'reached')::boolean, '30% reached the 25% milestone only';
  assert exists (select 1 from public.notifications where user_id = c1 and kind = 'giving_milestone' and target_id = camp), 'donor told about the milestone';
  assert (select count(*) from public.notifications where user_id = c1 and kind = 'giving_milestone' and target_id = camp) = 1, 'once';
  assert (j ->> 'accepting')::boolean and j ->> 'upi_id' = 'jecalumni@okicici', 'accepting with the default UPI id';
  -- fund the rest of the item, then it is full
  assert not pg_temp.err(pg_temp.q(c2, format($c$select public.giving_submit(%L, %L, 30000, '950000000043', null, false, null, null)::text$c$, camp, stage))), 'the rest of the item';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit(%L, %L, 1000, '950000000044', null, false, null, null)::text$c$, camp, stage))), 'a fully funded item takes no more';
  -- an item with gifts cannot be removed through the editor
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_save_campaign(%L, '{"type":"adopt","title":"Adopt the Civil Lab","goal_paise":100000,"items":[{"name":"Projector","price_paise":30000}]}'::jsonb)::text$c$, camp))), 'item with gifts cannot be dropped';
  -- ending soon + pledges
  update public.giving_campaigns set ends_at = now() + interval '2 days' where id = camp;
  assert pg_temp.err(pg_temp.q(c2, format($c$select public.giving_pledge_set(%L, current_date - 1, false, null)::text$c$, camp))), 'pledge date in the past';
  assert not pg_temp.err(pg_temp.q(c2, format($c$select public.giving_pledge_set(%L, (now() at time zone 'Asia/Kolkata')::date, false, 50000)::text$c$, camp))), 'pledge';
  assert not pg_temp.err(pg_temp.q(c1, format($c$select public.giving_pledge_set(%L, (now() at time zone 'Asia/Kolkata')::date, true, null)::text$c$, camp))), 'monthly pledge';
  perform public._giving_run_reminders();
  assert exists (select 1 from public.notifications where user_id = c2 and kind = 'pledge_reminder' and target_id = camp), 'pledge reminder sent';
  assert not (select active from public.giving_pledges where user_id = c2 and campaign_id = camp), 'one-off pledge is done';
  assert (select active and remind_on > current_date + 27 from public.giving_pledges where user_id = c1 and campaign_id = camp), 'monthly pledge moves on';
  assert exists (select 1 from public.notifications where user_id = c1 and kind = 'giving_ending' and target_id = camp), 'donors told it ends within 3 days';
  assert (select count(*) from public.notifications where kind = 'giving_ending' and target_id = camp and user_id = c1) = 1, 'ending notice sent once';
  perform public._giving_run_reminders();
  assert (select count(*) from public.notifications where kind = 'giving_ending' and target_id = camp and user_id = c1) = 1, 'and not again';
  -- the appeal has ended: no more gifts
  update public.giving_campaigns set ends_at = now() - interval '1 hour', starts_at = now() - interval '2 days' where id = camp;
  assert pg_temp.q(c2, format($c$select public.giving_submit(%L, null, 10000, '950000000045', null, false, null, null)::text$c$, camp)) like 'ERR:%', 'ended appeals take no gifts';
  -- my giving
  j := pg_temp.q(c1, 'select public.giving_my_donations()::text')::jsonb;
  assert jsonb_array_length(j -> 'donations') >= 1, 'my giving lists my gifts';
  perform pg_temp.q(c1, 'select public.giving_set_prefs(true)::text');
  assert (pg_temp.q(c1, 'select public.giving_my_donations()::text')::jsonb ->> 'notify_new')::boolean, 'opt-in saved';
  perform pg_temp.q(c1, 'select public.giving_set_prefs(false)::text');
  assert not (pg_temp.q(c1, 'select public.giving_my_donations()::text')::jsonb ->> 'notify_new')::boolean, 'opt-out saved';
end $$;

-- ---------------------------------------------------------------- no PII anywhere a member can read
do $$
declare c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2'; camp uuid := (select id from public.giving_campaigns where title = 'Build the Convocation Hall'); t text;
begin
  t := pg_temp.q(c2, 'select public.giving_hub()::text') || pg_temp.q(c2, format($c$select public.giving_donors(%L)::text$c$, camp))
    || pg_temp.q(c2, format($c$select public.giving_campaign(%L)::text$c$, (select slug from public.giving_campaigns where id = camp)))
    || pg_temp.q(c2, format($c$select public.giving_leaderboard(%L)::text$c$, camp)) || pg_temp.q(c2, 'select public.giving_transparency()::text');
  assert t not like '%98765%' and t not like '%@g95.com%' and t not like '%950000000011%', 'no phone, email or UTR in what members read';
  assert not pg_temp.err(pg_temp.q(c2, 'select public.giving_transparency()::text')), 'transparency opens';
end $$;

-- ---------------------------------------------------------------- Reunion Fund card: from registrations, never from donations
do $$
declare c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2'; j jsonb; base bigint; camp uuid := (select id from public.giving_campaigns where title = 'Build the Convocation Hall');
begin
  j := pg_temp.q(c2, 'select public.giving_hub()::text')::jsonb -> 'reunion';
  assert (j ->> 'raised_paise')::bigint >= 100000 and (j ->> 'pending_paise')::bigint >= 50000, 'reunion fund from registrations: ' || j::text;
  base := (j ->> 'raised_paise')::bigint;
  assert public._giving_raised(camp) = 501000, 'campaign totals do not include the reunion fund';
  assert (pg_temp.q(c2, 'select public.giving_transparency()::text')::jsonb -> 'reunion' ->> 'raised_paise')::bigint = base, 'same figure on the transparency page';
end $$;

-- ---------------------------------------------------------------- expenses (where the money went)
do $$
declare
  m constant uuid := '9b000000-0000-0000-0000-0000000000a2'; v constant uuid := '9b000000-0000-0000-0000-0000000000a3'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2';
  camp uuid := (select id from public.giving_campaigns where title = 'Build the Convocation Hall'); e uuid; j jsonb;
begin
  assert pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_save_expense(null, jsonb_build_object('campaign_id', %L, 'description', 'Cement', 'amount_paise', 100000, 'spent_on', current_date))::text$c$, camp))), 'funds_verify cannot add expenses';
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_save_expense(null, jsonb_build_object('campaign_id', %L, 'description', 'Cement', 'amount_paise', 100000, 'spent_on', current_date + 3))::text$c$, camp))), 'no future dates';
  e := pg_temp.q(m, format($c$select public.admin_giving_save_expense(null, jsonb_build_object('campaign_id', %L, 'description', 'Cement for the foundation', 'amount_paise', 250000, 'spent_on', current_date, 'receipt_path', 'giving/r1.jpg'))::text$c$, camp))::uuid;
  j := pg_temp.q(c2, 'select public.giving_transparency()::text')::jsonb;
  assert (j ->> 'total_spent_paise') = '250000' and j -> 'expenses' -> 0 ->> 'description' = 'Cement for the foundation', 'members see the expense';
  assert exists (select 1 from jsonb_array_elements(j -> 'campaigns') c where c ->> 'title' = 'Build the Convocation Hall' and (c ->> 'spent_paise') = '250000'), 'spent per campaign';
  assert exists (select 1 from public.admin_audit where action = 'giving_expense_add' and target_id = e), 'audited';
  assert not pg_temp.err(pg_temp.q(m, format($c$select public.admin_giving_delete_expense(%L)::text$c$, e))), 'deleted';
end $$;

-- ---------------------------------------------------------------- SPONSORSHIP
do $$
declare
  a constant uuid := '9b000000-0000-0000-0000-0000000000a1'; s constant uuid := '9b000000-0000-0000-0000-0000000000a5'; m constant uuid := '9b000000-0000-0000-0000-0000000000a2';
  v constant uuid := '9b000000-0000-0000-0000-0000000000a3'; r constant uuid := '9b000000-0000-0000-0000-0000000000a4';
  c1 constant uuid := '9b000000-0000-0000-0000-0000000000c1'; c2 constant uuid := '9b000000-0000-0000-0000-0000000000c2';
  ev constant uuid := '9b000000-0000-0000-0000-0000000000e1';
  gold uuid; inkind uuid; sp1 uuid; sp2 uuid; sp3 uuid; sp4 uuid; j jsonb; pay uuid; res text;
begin
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_sponsor_save_package(null, jsonb_build_object('event_id', %L, 'name', 'Gold', 'price_paise', 5000000, 'slots', 1))::text$c$, ev))), 'funds_manage alone cannot make packages';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.admin_sponsor_packages(%L)::text$c$, ev))), 'members cannot list admin packages';
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_save_package(null, jsonb_build_object('event_id', %L, 'name', 'Free', 'price_paise', 500, 'slots', 1))::text$c$, ev))), 'price below ₹10 refused for cash packages';
  gold := pg_temp.q(s, format($c$select public.admin_sponsor_save_package(null, jsonb_build_object('event_id', %L, 'name', 'Gold', 'rank', 2, 'price_paise', 5000000, 'slots', 1,
            'benefits', jsonb_build_array('Logo on banner', 'Stage mention')))::text$c$, ev))::uuid;
  inkind := pg_temp.q(s, format($c$select public.admin_sponsor_save_package(null, jsonb_build_object('event_id', %L, 'name', 'In-kind', 'rank', 5, 'price_paise', 0, 'is_in_kind', true, 'slots', 5))::text$c$, ev))::uuid;
  -- leads from registrations: admin only, with contact details
  j := pg_temp.q(s, format($c$select public.admin_sponsor_suggested_leads(%L)::text$c$, ev))::jsonb;
  assert jsonb_array_length(j) = 1 and j -> 0 ->> 'org' = 'Asha Builders Pvt Ltd' and j -> 0 ->> 'phone' = '+91 98765 95001', 'suggested lead with contact details for the admin';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.admin_sponsor_suggested_leads(%L)::text$c$, ev))), 'members cannot see leads';
  sp1 := pg_temp.q(s, $c$select public.admin_sponsor_import_lead('9b000000-0000-0000-0000-0000000000d1')::text$c$)::uuid;
  assert (select stage from public.sponsors where id = sp1) = 'lead' and (select alumni_id from public.sponsors where id = sp1) = c1, 'lead imported with the alumni link';
  assert jsonb_array_length(pg_temp.q(s, format($c$select public.admin_sponsor_suggested_leads(%L)::text$c$, ev))::jsonb) = 0, 'imported leads leave the suggestions';
  assert pg_temp.err(pg_temp.q(s, $c$select public.admin_sponsor_import_lead('9b000000-0000-0000-0000-0000000000d1')::text$c$)), 'not imported twice';
  assert pg_temp.err(pg_temp.q(s, $c$select public.admin_sponsor_import_lead('9b000000-0000-0000-0000-0000000000d2')::text$c$)), 'only registrations that asked';
  -- pipeline
  assert pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'committed')::text$c$, sp1)) like 'ERR:%', 'cannot commit without a package or amount';
  res := pg_temp.q(s, format($c$select public.admin_sponsor_save(%L, jsonb_build_object('event_id', %L, 'name', 'Asha Builders Pvt Ltd', 'package_id', %L, 'website', 'https://asha.example.com', 'blurb', 'Builders', 'contact_phone', '+91 98765 95001', 'alumni_id', '9b000000-0000-0000-0000-0000000000c1', 'follow_up_on', current_date::text))::text$c$, sp1, ev, gold)); assert not pg_temp.err(res), res;
  perform pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'contacted', 'Called')::text$c$, sp1));
  perform pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'proposal_sent')::text$c$, sp1));
  res := pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'committed')::text$c$, sp1)); assert not pg_temp.err(res), res;
  assert (select committed_paise from public.sponsors where id = sp1) = 5000000, 'agreed amount defaults to the package price';
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'paid')::text$c$, sp1))), 'paid only through a verified payment';
  -- slot limit: Gold has one slot
  sp2 := pg_temp.q(s, format($c$select public.admin_sponsor_save(null, jsonb_build_object('event_id', %L, 'name', 'Second Gold Co', 'package_id', %L))::text$c$, ev, gold))::uuid;
  assert pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'committed')::text$c$, sp2)) like 'ERR:%No slots left%', 'slot limit enforced: ' || pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'committed')::text$c$, sp2));
  assert pg_temp.q(s, format($c$select public.admin_sponsor_save_package(%L, jsonb_build_object('event_id', %L, 'name', 'Gold', 'price_paise', 5000000, 'slots', 1, 'rank', 2))::text$c$, gold, ev)) not like 'ERR:%', 'package can be saved';
  assert (select (k ->> 'sold')::int || '/' || (k ->> 'available')::int from jsonb_array_elements(pg_temp.q(s, format($c$select public.admin_sponsor_packages(%L)::text$c$, ev))::jsonb) k where k ->> 'name' = 'Gold') = '1/0', 'tier counters: sold 1, available 0';
  assert (select (k ->> 'available')::int from jsonb_array_elements(pg_temp.q(c2, format($c$select public.giving_sponsor_packages(%L)::text$c$, ev))::jsonb) k where k ->> 'name' = 'Gold') = 0, 'members see the available count';
  assert pg_temp.q(s, format($c$select public.admin_sponsor_save_package(%L, jsonb_build_object('event_id', %L, 'name', 'Gold', 'price_paise', 5000000, 'slots', 1))::text$c$, gold, ev)) not like 'ERR:%', 'same slots fine';
  delete from public.sponsors where id = sp2;
  -- not on the wall before payment
  assert pg_temp.q(c2, format($c$select public.giving_sponsor_wall(%L)::text$c$, ev))::jsonb = '[]'::jsonb, 'committed but unpaid: not on the wall';
  -- payment: UPI waits in the queue; the UTR rules are the same
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 5000000, 'upi', '950000000001', null)::text$c$, sp1))), 'UTR used by an event payment';
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 5000000, 'upi', '950000000011', null)::text$c$, sp1))), 'UTR used by a donation';
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 5000000, 'upi', 'abc', null)::text$c$, sp1))), 'UTR must be 12 digits';
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 5000000, 'cash', null, 'handed over')::text$c$, sp1))), 'cash needs funds_verify as well';
  pay := pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 5000000, 'upi', '950000000060', null)::text$c$, sp1))::uuid;
  assert (select status || kind from public.giving_donations where id = pay) = 'submittedsponsorship', 'waits in the same queue';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.giving_submit((select id from public.giving_campaigns where title = 'Adopt the Civil Lab'), null, 10000, '950000000060', null, false, null, null)::text$c$))), 'a donor cannot reuse the sponsor UTR';
  assert (select stage from public.sponsors where id = sp1) = 'committed', 'still committed until verified';
  assert jsonb_path_exists(pg_temp.q(v, $c$select public.admin_giving_donations('submitted')::text$c$)::jsonb, '$[*] ? (@.kind == "sponsorship")'), 'the verifier sees it';
  assert not pg_temp.err(pg_temp.q(v, format($c$select public.admin_giving_verify(array[%L::uuid])::text$c$, pay))), 'verified';
  assert (select stage from public.sponsors where id = sp1) = 'paid', 'verified payment marks the sponsor paid';
  -- the wall, with no contact details
  j := pg_temp.q(c2, format($c$select public.giving_sponsor_wall(%L)::text$c$, ev))::jsonb;
  assert j -> 0 ->> 'tier' = 'Gold' and j -> 0 -> 'sponsors' -> 0 ->> 'name' = 'Asha Builders Pvt Ltd' and j -> 0 -> 'sponsors' -> 0 ->> 'website' = 'https://asha.example.com', 'on the wall under Gold';
  assert j::text not like '%98765%' and j::text not like '%contact%' and j::text not like '%@g95.com%', 'the wall has no contact details';
  assert pg_temp.q(c2, format($c$select public.giving_sponsor_wall(%L)::text$c$, gen_random_uuid()))::jsonb = '[]'::jsonb, 'other events show nothing';
  assert pg_temp.err(pg_temp.q(c2, 'select count(*)::text from public.sponsors')), 'members cannot read sponsor rows';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.admin_sponsor(%L)::text$c$, sp1))), 'members cannot read sponsor contact details';
  assert pg_temp.q(s, format($c$select public.admin_sponsor(%L)::text$c$, sp1))::jsonb ->> 'contact_phone' = '+91 98765 95001', 'admins read the contact details';
  assert pg_temp.err(pg_temp.q(m, format($c$select public.admin_sponsor(%L)::text$c$, sp1))), 'other admins cannot';
  -- refund re-opens the sponsor
  perform pg_temp.q(v, format($c$select public.admin_giving_refund(%L, 'Sponsor withdrew')::text$c$, pay));
  assert (select stage from public.sponsors where id = sp1) = 'committed', 'refund returns the sponsor to committed';
  assert pg_temp.q(c2, format($c$select public.giving_sponsor_wall(%L)::text$c$, ev))::jsonb = '[]'::jsonb, 'and off the wall';
  -- in-kind: counted apart, never in cash totals
  sp3 := pg_temp.q(s, format($c$select public.admin_sponsor_save(null, jsonb_build_object('event_id', %L, 'name', 'Print Shop', 'package_id', %L, 'is_in_kind', true, 'in_kind_value_paise', 2500000, 'in_kind_description', 'All banners'))::text$c$, ev, inkind))::uuid;
  perform pg_temp.q(s, format($c$select public.admin_sponsor_set_stage(%L, 'committed')::text$c$, sp3));
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_record_payment(%L, 100000, 'upi', '950000000061', null)::text$c$, sp3))), 'in-kind sponsors take no cash payment';
  assert pg_temp.q(c2, format($c$select public.giving_sponsor_wall(%L)::text$c$, ev))::jsonb -> 0 ->> 'tier' = 'In-kind', 'a committed in-kind sponsor is on the wall';
  j := pg_temp.q(r, format($c$select public.admin_sponsor_report('event', %L)::text$c$, ev))::jsonb;
  assert (j -> 0 ->> 'in_kind_paise')::bigint = 2500000 and (j -> 0 ->> 'paid_paise')::bigint = 0 and (j -> 0 ->> 'committed_paise')::bigint = 5000000 and (j -> 0 ->> 'target_paise')::bigint = 5000000, 'report: in-kind apart, cash zero after refund: ' || j::text;
  assert (pg_temp.q(c2, 'select public.giving_transparency()::text')::jsonb -> 'sponsorship' ->> 'in_kind_paise')::bigint = 2500000 and
         (pg_temp.q(c2, 'select public.giving_transparency()::text')::jsonb -> 'sponsorship' ->> 'cash_paise')::bigint = 0, 'transparency: in-kind apart from cash';
  j := pg_temp.q(r, format($c$select public.admin_sponsor_report('outstanding', %L)::text$c$, ev))::jsonb;
  assert (j -> 0 ->> 'outstanding_paise')::bigint = 5000000, 'outstanding commitments';
  assert jsonb_array_length(pg_temp.q(r, $c$select public.admin_sponsor_report('tier')::text$c$)::jsonb) = 2, 'tier report';
  assert pg_temp.err(pg_temp.q(s, $c$select public.admin_sponsor_report('tier')::text$c$)), 'sponsors_manage alone does not open reports';
  -- deliverables
  assert not pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_save_deliverable(%L, null, 'Logo received', current_date + 5, false)::text$c$, sp3))), 'deliverable added';
  assert (select count(*) from public.sponsor_deliverables where sponsor_id = sp3) = 1, 'saved';
  -- follow-up reminders go to the owner
  update public.sponsors set follow_up_on = (now() at time zone 'Asia/Kolkata')::date, owner_id = s where id = sp1;
  perform public._sponsor_run_reminders();
  assert exists (select 1 from public.notifications where user_id = s and kind = 'sponsor_followup' and target_id = sp1), 'follow-up reminder to the owner';
  perform public._sponsor_run_reminders();
  assert (select count(*) from public.notifications where user_id = s and kind = 'sponsor_followup' and target_id = sp1) = 1, 'once a day';
  -- a member can tell the committee they want to sponsor: it becomes a lead
  assert not pg_temp.err(pg_temp.q(c2, format($c$select public.giving_sponsor_interest(%L, null, %L, 'Bala Traders', 'Please call')::text$c$, ev, gold))), 'member interest';
  assert exists (select 1 from public.sponsors where name = 'Bala Traders' and stage = 'lead' and alumni_id = c2), 'lead created';
  -- the printable documents
  j := pg_temp.q(s, format($c$select public.admin_sponsor_document(%L)::text$c$, sp1))::jsonb;
  assert j ->> 'package' = 'Gold' and (j ->> 'agreed_paise') = '5000000' and j ->> 'assoc_name' is not null, 'agreement data';
  assert pg_temp.err(pg_temp.q(c1, format($c$select public.admin_sponsor_document(%L)::text$c$, sp1))), 'members cannot print agreements';
  -- sponsors with payments cannot be deleted; others can
  assert pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_delete(%L)::text$c$, sp1))), 'sponsor with payments stays';
  assert not pg_temp.err(pg_temp.q(s, format($c$select public.admin_sponsor_delete(%L)::text$c$, sp3))), 'sponsor without payments can go';
  assert (select count(*) from public.admin_audit where action like 'sponsor\_%') >= 8, 'sponsorship is audited';
end $$;

select 'ALL GIVING TESTS PASSED';
rollback;
