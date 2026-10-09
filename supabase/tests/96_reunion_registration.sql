-- Grand Reunion registration: profile snapshot, day/family rules, Reunion Fund maths and locking, typed answers,
-- organisers' own questions, and who can see what. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- A: complete profile · B: partial profile · V: check-in volunteer · M: event manager (not admin) · X: outsider
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-00000000000a', 'asha96@example.com', '{"full_name":"Asha Reunion"}'),
  ('96000000-0000-0000-0000-00000000000b', 'bharat96@example.com', '{"full_name":"Bharat Partial"}'),
  ('96000000-0000-0000-0000-0000000000dd', 'vol96@example.com', '{"full_name":"Volunteer"}'),
  ('96000000-0000-0000-0000-0000000000ee', 'mgr96@example.com', '{"full_name":"Manager"}'),
  ('96000000-0000-0000-0000-0000000000ff', 'out96@example.com', '{"full_name":"Outsider"}');
update public.profiles set grad_year = 2007, branch = 'B.E. in Computer Science & Engineering', city = 'Pune', country = 'India',
       current_title = 'Engineering Manager', current_company = 'Infosys', onboarded = true
 where id = '96000000-0000-0000-0000-00000000000a';
update public.profile_private set phone = '+91 98765 43210' where id = '96000000-0000-0000-0000-00000000000a';
insert into public.experiences (profile_id, title, company, start_date, end_date, is_current, source) values
  ('96000000-0000-0000-0000-00000000000a', 'Engineering Manager', 'Infosys', '2015-01-01', null, true, 'linkedin'),
  ('96000000-0000-0000-0000-00000000000a', 'Senior Engineer', 'Wipro', '2010-01-01', '2014-12-01', false, 'linkedin'),
  ('96000000-0000-0000-0000-00000000000a', 'Engineer', 'TCS', '2007-07-01', '2009-12-01', false, 'manual');
update public.profiles set grad_year = 2009, branch = 'MCA', city = 'Indore', country = null, onboarded = true
 where id = '96000000-0000-0000-0000-00000000000b';
update public.profile_private set phone = '+91 90000 11111' where id = '96000000-0000-0000-0000-00000000000b';

insert into public.events (id, slug, title, is_published, upi_id, upi_payee_name, starts_at, ends_at, ask_reunion_questions)
values ('96000000-0000-0000-0000-0000000000e1', 'reunion-test', 'Reunion', true, 'jecalumni@okicici', 'JEC Alumni', '2026-12-26 10:00+05:30', '2026-12-27 18:00+05:30', true);
insert into public.event_ticket_types (id, event_id, label, price_paise, is_primary, max_per_registration, sort, days) values
  ('96000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000e1', '26 Dec only', 200000, true, 1, 1, '{1}'),
  ('96000000-0000-0000-0000-0000000000a2', '96000000-0000-0000-0000-0000000000e1', '27 Dec only', 150000, true, 1, 2, '{2}'),
  ('96000000-0000-0000-0000-0000000000a3', '96000000-0000-0000-0000-0000000000e1', 'Both days', 300000, true, 1, 3, null),
  ('96000000-0000-0000-0000-0000000000a4', '96000000-0000-0000-0000-0000000000e1', 'Family adult · 27 Dec', 100000, false, 4, 4, '{2}'),
  ('96000000-0000-0000-0000-0000000000a5', '96000000-0000-0000-0000-0000000000e1', 'Child under 5 · 27 Dec', 0, false, 4, 5, '{2}');
insert into public.event_staff (event_id, user_id, role) values
  ('96000000-0000-0000-0000-0000000000e1', '96000000-0000-0000-0000-0000000000dd', 'checkin'),
  ('96000000-0000-0000-0000-0000000000e1', '96000000-0000-0000-0000-0000000000ee', 'manager');
create temp table t (k text primary key, v uuid);
grant select, insert, update on t to authenticated;

-- answers every strict (reunion) registration needs; tests override pieces of it
create function pg_temp.d(extra jsonb default '{}') returns jsonb language sql as $$
  select '{"accept_terms": true, "full_name": "Asha Reunion", "food_pref": "veg", "tshirt_size": "M",
           "needs_accommodation": false, "needs_local_travel": false, "org_team_interest": false, "fund_interest": false,
           "sponsor_interest": false, "perform_interest": false}'::jsonb || extra;
$$;
create function pg_temp.items(p_primary text, p_adults int default 0, p_infants int default 0) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('ticket_type_id', '96000000-0000-0000-0000-0000000000' || p_primary, 'quantity', 1),
                           jsonb_build_object('ticket_type_id', '96000000-0000-0000-0000-0000000000a4', 'quantity', p_adults),
                           jsonb_build_object('ticket_type_id', '96000000-0000-0000-0000-0000000000a5', 'quantity', p_infants));
$$;
grant execute on function pg_temp.d(jsonb), pg_temp.items(text, int, int) to authenticated;

-- ---------------------------------------------------------------- manager adds the organisers' own questions
select pg_temp.login('96000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$
declare q uuid;
begin
  insert into public.event_questions (event_id, kind, label, options, required, sort)
  values ('96000000-0000-0000-0000-0000000000e1', 'single', 'Which hostel?', array[' Hostel 1 ', 'Hostel 2', 'Day scholar'], true, 1) returning id into q;
  insert into t values ('q_single', q);
  assert (select options[1] from public.event_questions where id = q) = 'Hostel 1', 'options trimmed';
  insert into public.event_questions (event_id, kind, label, options, sort)
  values ('96000000-0000-0000-0000-0000000000e1', 'multi', 'Which sessions interest you?', array['Panel', 'Campus walk', 'Cricket'], 2) returning id into q;
  insert into t values ('q_multi', q);
  insert into public.event_questions (event_id, kind, label, sort)
  values ('96000000-0000-0000-0000-0000000000e1', 'short_text', 'Your favourite canteen dish', 3) returning id into q;
  insert into t values ('q_text', q);
  insert into public.event_questions (event_id, kind, label, sort, is_active)
  values ('96000000-0000-0000-0000-0000000000e1', 'yes_no', 'Old switched-off question', 4, false) returning id into q;
  insert into t values ('q_off', q);
  begin
    insert into public.event_questions (event_id, kind, label, options) values ('96000000-0000-0000-0000-0000000000e1', 'single', 'One option only', array['A']);
    assert false, 'choice questions need two options';
  exception when check_violation then null; end;
  begin
    insert into public.event_questions (event_id, kind, label, options) values ('96000000-0000-0000-0000-0000000000e1', 'multi', 'Duplicates', array['A', 'a']);
    assert false, 'duplicate options';
  exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.admin_audit where action = 'event_questions_insert'), 'question changes are audited';
end $$;

-- members and volunteers cannot write questions
select pg_temp.login('96000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin
  begin
    insert into public.event_questions (event_id, kind, label) values ('96000000-0000-0000-0000-0000000000e1', 'yes_no', 'Volunteer question');
    assert false, 'volunteers cannot add questions';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.event_questions where event_id = '96000000-0000-0000-0000-0000000000e1') = 4, 'staff read questions';
end $$;
reset role;

-- ---------------------------------------------------------------- Asha registers: snapshot, days, family, fund, answers
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.event_registrations; qs uuid := (select v from t where k = 'q_single'); qm uuid := (select v from t where k = 'q_multi');
        qt uuid := (select v from t where k = 'q_text');
begin
  -- family tickets need the 27th: 26-only + family adult is refused
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a1', 1));
    assert false, 'family tickets require the 27th';
  exception when raise_exception then
    assert sqlerrm like '%only for 27 Dec%', sqlerrm;
  end;

  -- custom question validation
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(), pg_temp.items('a3'));
    assert false, 'required custom question';
  exception when raise_exception then assert sqlerrm = 'Please answer: Which hostel?', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 9'))), pg_temp.items('a3'));
    assert false, 'bad single option';
  exception when raise_exception then assert sqlerrm like 'Please choose one of the options%', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1', qm, jsonb_build_array('Panel', 'Dance')))), pg_temp.items('a3'));
    assert false, 'bad multi option';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1', qt, repeat('x', 201)))), pg_temp.items('a3'));
    assert false, 'short text too long';
  exception when raise_exception then assert sqlerrm like '%at most 200 characters', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1', gen_random_uuid(), 'x'))), pg_temp.items('a3'));
    assert false, 'unknown question';
  exception when raise_exception then null; end;

  -- Reunion Fund bounds
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 9900, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'fund minimum ₹100';
  exception when raise_exception then assert sqlerrm like '%between ₹100 and ₹10,00,000', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 100000100, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'fund maximum ₹10,00,000';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'fund yes needs an amount';
  exception when raise_exception then null; end;

  -- teams, sponsorship, performance validation
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('org_team_interest', true, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'team yes needs a team';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('org_team_interest', true, 'org_teams', jsonb_build_array('core', 'catering'), 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'unknown team';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('sponsor_interest', true, 'sponsor_org', 'Acme', 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'sponsor level required';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('sponsor_interest', true, 'sponsor_level', 'main', 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'sponsor organisation required';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('perform_interest', true, 'perform_types', jsonb_build_array('singing'), 'perform_group', false, 'perform_minutes', 31, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'performance at most 30 minutes';
  exception when raise_exception then assert sqlerrm like '%(1 to 30)', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('perform_interest', true, 'perform_types', jsonb_build_array('singing'), 'perform_group', false, 'perform_minutes', 0, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'performance at least 1 minute';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('perform_interest', true, 'perform_types', jsonb_build_array('singing'), 'perform_minutes', 5, 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'solo or group required';
  exception when raise_exception then null; end;
  -- strict event: unanswered yes/no questions are refused
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1'))) - 'sponsor_interest', pg_temp.items('a3'));
    assert false, 'sponsorship must be answered';
  exception when raise_exception then null; end;
  -- extras
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('song_requests', jsonb_build_array('a', 'b', 'c', 'd'), 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'at most 3 songs';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('emergency_name', 'Ravi', 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'emergency contact needs a number';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('feedback', repeat('f', 2001), 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3'));
    assert false, 'feedback at most 2000';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('guests', jsonb_build_array(jsonb_build_object('name', 'Meera', 'food', 'vegan')), 'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3', 1));
    assert false, 'guest food from the list';
  exception when raise_exception then null; end;

  -- the real thing: both days + 2 family adults + 1 infant, ₹2,500 to the fund, two teams, sponsor, performer, extras
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object(
         'food_pref', 'none', 'needs_accommodation', true, 'needs_local_travel', true,
         'guests', jsonb_build_array(jsonb_build_object('name', 'Meera', 'relation', 'Family adult', 'ticket_type_id', '96000000-0000-0000-0000-0000000000a4', 'food', 'jain'),
                                     jsonb_build_object('name', 'Dad', 'relation', 'Family adult', 'food', 'veg'),
                                     jsonb_build_object('name', 'Baby')),
         'fund_interest', true, 'fund_paise', 250000,
         'org_team_interest', true, 'org_teams', jsonb_build_array('core', 'hospitality', 'core'),
         'sponsor_interest', true, 'sponsor_level', 'co', 'sponsor_org', 'Acme Pvt Ltd', 'sponsor_note', 'Banners',
         'perform_interest', true, 'perform_types', jsonb_build_array('singing', 'band'), 'perform_group', true, 'perform_members', 'Ravi, Sunil', 'perform_minutes', 30,
         'nickname', 'Ashu', 'song_requests', jsonb_build_array(' Yaaron ', 'Pal', ''), 'memory', 'Canteen samosas', 'memory_wall_consent', true,
         'arrival_from', 'Pune', 'arrival_date', '2026-12-25', 'arrival_mode', 'train',
         'emergency_name', 'Ravi', 'emergency_phone', '+91 90000 22222', 'medical_notes', 'Diabetic',
         'feedback', 'Great idea!',
         'custom_answers', jsonb_build_object(qs, 'Hostel 1', qm, jsonb_build_array('Panel', 'Cricket', 'Panel'), qt, '  Samosa  '))),
       pg_temp.items('a3', 2, 1));
  insert into t values ('reg_a', r.id);
  assert r.amount_paise = 300000 + 2 * 100000 + 250000, 'total = tickets + fund: ' || r.amount_paise;
  assert r.fund_paise = 250000 and r.fund_interest, 'fund stored separately';
  assert r.headcount = 4 and r.days is null, 'headcount and days';
  assert r.day_heads = '{"1": 1, "2": 4}'::jsonb, 'heads per day ' || r.day_heads::text;
  assert r.phone = '+91 98765 43210' and r.email = 'asha96@example.com', 'phone and email from the profile / sign-in';
  assert r.country = 'India' and r.designation = 'Engineering Manager' and r.company = 'Infosys' and r.city = 'Pune', 'profile snapshot';
  assert r.past_experience = 'Senior Engineer at Wipro (2010–2014); Engineer at TCS (2007–2009)', 'past experience: ' || coalesce(r.past_experience, 'null');
  assert r.branch = 'B.E. in Computer Science & Engineering' and r.grad_year = 2007, 'branch and year from the profile';
  assert r.org_teams = '{core,hospitality}' and r.sponsor_level = 'co' and r.perform_minutes = 30 and r.perform_types = '{singing,band}', 'answers typed';
  assert r.song_requests = '{Yaaron,Pal}' and r.memory_wall_consent and r.food_pref = 'none', 'extras cleaned';
  assert r.guests -> 0 ->> 'food' = 'jain' and r.guests -> 2 ->> 'food' is null, 'guest food kept';
  assert r.custom_answers ->> qt::text = 'Samosa' and jsonb_array_length(r.custom_answers -> qm::text) = 2, 'custom answers cleaned: ' || r.custom_answers::text;
  assert (select count(*) from public.event_registration_items where registration_id = r.id) = 3, 'items saved';

  -- the snapshot does not follow later profile changes
  update public.profiles set current_company = 'Startup' where id = auth.uid();
  assert (select company from public.event_registrations where id = r.id) = 'Infosys', 'snapshot is a snapshot';

  -- fund is changeable before payment; "No" clears it
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a2', 1));
  assert r.fund_paise = 0 and r.amount_paise = 250000 and r.day_heads = '{"1": 0, "2": 2}'::jsonb and r.days = '{2}', '27 only + adult, no fund: ' || r.day_heads::text;
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 500000, 'feedback', 'v1',
         'custom_answers', jsonb_build_object(qs, 'Hostel 1'))), pg_temp.items('a3', 1));
  assert r.amount_paise = 400000 + 500000, 'fund changed before payment';

  -- pay
  perform public.submit_upi_payment(r.id, '961234567890', 'Asha', null);
  assert (select amount_paise from public.event_payments where utr = '961234567890') = 900000, 'payment covers tickets and fund';

  -- locked: feedback and other non-financial answers still editable, fund and tickets are not
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 500000, 'feedback', 'Edited after paying',
         'org_team_interest', true, 'org_teams', jsonb_build_array('media'), 'custom_answers', jsonb_build_object(qs, 'Hostel 2'))), pg_temp.items('a3', 1));
  assert r.feedback = 'Edited after paying' and r.org_teams = '{media}' and r.custom_answers ->> qs::text = 'Hostel 2' and r.status = 'under_review', 'non-financial edits after payment';
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 100000, 'custom_answers', jsonb_build_object(qs, 'Hostel 2'))), pg_temp.items('a3', 1));
    assert false, 'fund locked after payment';
  exception when raise_exception then assert sqlerrm like '%Reunion Fund amount can no longer be changed%', sqlerrm; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('custom_answers', jsonb_build_object(qs, 'Hostel 2'))), pg_temp.items('a3', 1));
    assert false, 'saying no to the fund is a change too';
  exception when raise_exception then null; end;
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 500000, 'custom_answers', jsonb_build_object(qs, 'Hostel 2'))), pg_temp.items('a3', 2));
    assert false, 'tickets locked after payment';
  exception when raise_exception then null; end;
  assert (select amount_paise from public.event_registrations where id = r.id) = 900000, 'amount unchanged';
end $$;
reset role;

-- a switched-off question keeps its earlier answer; the outsider cannot see Asha's registration
update public.event_questions set is_active = true where id = (select v from t where k = 'q_off');
update public.event_registrations set custom_answers = custom_answers || jsonb_build_object((select v from t where k = 'q_off')::text, true)
 where id = (select v from t where k = 'reg_a');
update public.event_questions set is_active = false where id = (select v from t where k = 'q_off');
select pg_temp.login('96000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('fund_interest', true, 'fund_paise', 500000,
         'emergency_name', 'Ravi', 'emergency_phone', '+91 90000 22222', 'medical_notes', 'Diabetic', 'feedback', 'Great idea!',
         'sponsor_interest', true, 'sponsor_level', 'main', 'sponsor_org', 'Acme', 'memory', 'Samosas',
         'custom_answers', jsonb_build_object((select v from t where k = 'q_single'), 'Hostel 2'))), pg_temp.items('a3', 1));
  assert (r.custom_answers ->> (select v from t where k = 'q_off')::text)::boolean, 'inactive answer kept';
end $$;
reset role;

-- ---------------------------------------------------------------- Bharat: partial profile is refused until completed
select pg_temp.login('96000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare r public.event_registrations;
begin
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('full_name', 'Bharat Partial',
              'custom_answers', jsonb_build_object((select v from t where k = 'q_single'), 'Day scholar'))), pg_temp.items('a1'));
    assert false, 'country missing';
  exception when raise_exception then assert sqlerrm like '%city and country%', sqlerrm; end;
  -- the inline mini-form saves to the profile (allowed columns only) and to experiences
  update public.profiles set country = 'India' where id = auth.uid();
  begin
    perform public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('full_name', 'Bharat Partial',
              'custom_answers', jsonb_build_object((select v from t where k = 'q_single'), 'Day scholar'))), pg_temp.items('a1'));
    assert false, 'designation missing';
  exception when raise_exception then assert sqlerrm like '%designation and company%', sqlerrm; end;
  insert into public.experiences (profile_id, title, company, is_current) values (auth.uid(), 'Architect', 'HCL', true);
  r := public.upsert_registration('96000000-0000-0000-0000-0000000000e1', pg_temp.d(jsonb_build_object('full_name', 'Bharat Partial',
            'custom_answers', jsonb_build_object((select v from t where k = 'q_single'), 'Day scholar'))), pg_temp.items('a1'));
  assert r.designation = 'Architect' and r.company = 'HCL' and r.country = 'India' and r.past_experience is null, 'current job from experiences';
  assert r.amount_paise = 200000 and r.day_heads = '{"1": 1, "2": 0}'::jsonb, 'one day';
  assert (select count(*) from public.event_registrations) = 1, 'members see only their own registration';
end $$;
reset role;

-- ---------------------------------------------------------------- who sees what
select pg_temp.login('96000000-0000-0000-0000-0000000000dd');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_registrations) = 0, 'volunteer cannot read the registrations table';
  assert (select count(*) from public.event_attendees('96000000-0000-0000-0000-0000000000e1')) = 2, 'volunteer sees attendees';
  assert not exists (select 1 from public.event_attendees('96000000-0000-0000-0000-0000000000e1')
                      where phone <> '' or email is not null or amount_paise <> 0 or fund_paise <> 0 or fund_interest is not null
                         or emergency_name is not null or emergency_phone is not null or medical_notes is not null
                         or feedback is not null or sponsor_org is not null or sponsor_level is not null or memory is not null
                         or custom_answers <> '{}'::jsonb), 'volunteer list hides contact, money, emergency, medical, feedback, sponsor, memories';
  -- what volunteers need for the day is still there
  assert exists (select 1 from public.event_attendees('96000000-0000-0000-0000-0000000000e1')
                  where full_name = 'Asha Reunion' and day_heads = '{"1": 1, "2": 2}'::jsonb and food_pref = 'veg' and tshirt_size = 'M'), 'volunteer sees headcounts, food and T-shirt';
  assert (select (c.registration).emergency_phone is null from public.check_in('96000000-0000-0000-0000-0000000000e1',
          (select code from public.event_attendees('96000000-0000-0000-0000-0000000000e1') where full_name = 'Asha Reunion')) c), 'check-in result is sanitised';
end $$;
reset role;

select pg_temp.login('96000000-0000-0000-0000-0000000000ee');
set local role authenticated;
do $$
declare r public.event_registrations; reg uuid := (select v from t where k = 'reg_a');
begin
  assert exists (select 1 from public.event_attendees('96000000-0000-0000-0000-0000000000e1')
                  where emergency_phone = '+91 90000 22222' and medical_notes = 'Diabetic' and phone = '+91 98765 43210' and fund_paise = 500000), 'manager sees everything';
  assert (select count(*) from public.event_registrations where event_id = '96000000-0000-0000-0000-0000000000e1') = 2, 'manager reads rows';
  -- confirm the payment, then the manager raises the fund on the member's behalf: the balance becomes due
  r := public.review_payment((select id from public.event_payments where utr = '961234567890'), true, null);
  assert r.status = 'confirmed', 'confirmed';
  begin
    perform public.admin_update_registration(reg, '{"fund_paise": 5000}', null, 'typo');
    assert false, 'admin fund bounds';
  exception when raise_exception then null; end;
  begin
    perform public.admin_update_registration(reg, null, pg_temp.items('a1', 1), 'wrong');
    assert false, 'admin also follows the day rules';
  exception when raise_exception then null; end;
  r := public.admin_update_registration(reg, '{"fund_paise": 1000000, "feedback": "Noted by desk"}', null, 'Raised pledge at the desk');
  assert r.fund_paise = 1000000 and r.amount_paise = 400000 + 1000000 and r.status = 'pending_payment' and r.feedback = 'Noted by desk', 'admin edits fund; status follows money';
  r := public.admin_update_registration(reg, '{"fund_paise": 0}', null, 'Pledge withdrawn');
  assert r.fund_paise = 0 and not r.fund_interest and r.amount_paise = 400000, 'fund removed';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.admin_audit where action = 'update_registration' and details -> 'fund' ->> 'to' = '0'
                   and actor = '96000000-0000-0000-0000-0000000000ee'), 'fund change audited';
end $$;

select pg_temp.login('96000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_attendees('96000000-0000-0000-0000-0000000000e1')) = 0, 'outsiders see nobody';
  begin
    perform public.admin_update_registration((select v from t where k = 'reg_a'), '{"fund_paise": 0}', null, 'x');
    assert false, 'outsider cannot edit';
  exception when insufficient_privilege then null; end;
  begin
    perform public._clean_answers('96000000-0000-0000-0000-0000000000e1', '{}', false);
    assert false, 'internal helpers are not callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- grants
do $$ begin
  assert not has_table_privilege('anon', 'public.event_questions', 'INSERT'), 'anon cannot add questions';
  assert has_table_privilege('anon', 'public.event_questions', 'SELECT'), 'question list is public for published events';
  assert not has_table_privilege('authenticated', 'public.event_registrations', 'UPDATE'), 'registrations change only through functions';
  assert not has_function_privilege('authenticated', 'public._price_items(uuid, jsonb)', 'EXECUTE'), '_price_items private';
  assert not has_function_privilege('authenticated', 'public._clean_custom_answers(uuid, jsonb, jsonb)', 'EXECUTE'), '_clean_custom_answers private';
  assert not has_function_privilege('anon', 'public.upsert_registration(uuid, jsonb, jsonb)', 'EXECUTE'), 'anon cannot register';
  assert has_function_privilege('authenticated', 'public.upsert_registration(uuid, jsonb, jsonb)', 'EXECUTE'), 'members register';
  assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = '_clean_answers'), 'definer with empty search_path';
end $$;

select 'ALL REUNION REGISTRATION TESTS PASSED';
rollback;
