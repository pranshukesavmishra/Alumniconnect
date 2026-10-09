-- Mentorship rules. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('91000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Mentor"}'),
  ('91000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Mentee One"}'),
  ('91000000-0000-0000-0000-00000000000c', 'c@x.com', '{"full_name":"Mentee Two"}'),
  ('91000000-0000-0000-0000-00000000000d', 'd@x.com', '{"full_name":"Bystander"}'),
  ('91000000-0000-0000-0000-0000000000bb', 'e@x.com', '{"full_name":"Blocked Mentee"}'),
  ('91000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '91000000-%' and id <> '91000000-0000-0000-0000-0000000000aa';
insert into public.blocks (blocker, blocked) values ('91000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-0000000000bb');
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

-- become a mentor: validation
select pg_temp.login('91000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.become_mentor('{"topics":[],"bio":"I have twelve years in product engineering."}'); assert false, 'topic needed';
  exception when raise_exception then assert sqlerrm = 'Choose 1 to 5 topics', sqlerrm; end;
  begin perform public.become_mentor('{"topics":["Career growth","Interview prep","Higher studies","Startups","Leadership","Work abroad"],"bio":"I have twelve years in product engineering."}'); assert false, 'max 5 topics';
  exception when raise_exception then null; end;
  begin perform public.become_mentor('{"topics":["Astrology"],"bio":"I have twelve years in product engineering."}'); assert false, 'fixed topic list';
  exception when raise_exception then assert sqlerrm = 'Unknown topic', sqlerrm; end;
  begin perform public.become_mentor('{"topics":["Startups"],"bio":"too short"}'); assert false, 'bio too short';
  exception when raise_exception then null; end;
  begin perform public.become_mentor(('{"topics":["Startups"],"bio":"' || repeat('x', 601) || '"}')::jsonb); assert false, 'bio too long';
  exception when raise_exception then null; end;
  begin perform public.become_mentor('{"topics":["Startups"],"bio":"I have twelve years in product engineering.","max_mentees":11}'); assert false, 'max mentees';
  exception when raise_exception then null; end;
  begin perform public.become_mentor(('{"topics":["Startups"],"bio":"I have twelve years in product engineering.","availability":"' || repeat('y', 81) || '"}')::jsonb); assert false, 'availability length';
  exception when raise_exception then null; end;
  begin insert into public.mentor_profiles (user_id, topics, bio) values (auth.uid(), array['Startups'], 'direct insert is not allowed here'); assert false, 'no direct insert';
  exception when insufficient_privilege then null; end;
  begin perform public.pause_mentoring(false); assert false, 'needs a profile first';
  exception when raise_exception then null; end;
  perform public.become_mentor('{"topics":["Startups","Career growth"],"bio":"I have twelve years in product engineering.","availability":"2 hours a month","max_mentees":1}');
  assert (select max_mentees from public.mentor_profiles where user_id = auth.uid()) = 1, 'created';
  -- editing keeps one row
  perform public.become_mentor('{"topics":["Startups","Career growth","Startups"],"bio":"I have twelve years in product engineering, mostly startups."}');
  assert (select count(*) from public.mentor_profiles) = 1 and (select cardinality(topics) from public.mentor_profiles) = 2, 'upsert, topics deduplicated';
  assert (select max_mentees from public.mentor_profiles) = 1, 'omitted max_mentees keeps the old one';
end $$;
reset role;

-- unverified members cannot take part
select pg_temp.login('91000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  begin perform public.become_mentor('{"topics":["Startups"],"bio":"I have twelve years in product engineering."}'); assert false, 'unverified mentor';
  exception when insufficient_privilege then null; end;
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'I would love guidance on founding a company.'); assert false, 'unverified mentee';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.list_mentors()) = 0, 'unverified see no mentors';
end $$;
reset role;

-- requesting: validation and refusals
select pg_temp.login('91000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare r public.mentorships;
begin
  assert (select count(*) from public.mentor_profiles) = 0, 'other members'' mentor profiles are not readable directly';
  assert (select count(*) from public.list_mentors()) = 1 and (select open_slots from public.list_mentors()) = 1, 'directory shows one open slot';
  assert (select my_status from public.list_mentors()) is null, 'no request yet';
  assert (select count(*) from public.list_mentors('Startups')) = 1 and (select count(*) from public.list_mentors('Leadership')) = 0, 'topic filter';
  assert (select count(*) from public.list_mentors(null, 'twelve years')) = 1 and (select count(*) from public.list_mentors(null, 'nonexistent')) = 0, 'query';
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000b', 'Startups', 'I would love guidance on founding a company.'); assert false, 'not self';
  exception when raise_exception then null; end;
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'short'); assert false, 'message length';
  exception when raise_exception then null; end;
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Leadership', 'I would love guidance on founding a company.'); assert false, 'topic the mentor does not cover';
  exception when raise_exception then null; end;
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000d', 'Startups', 'I would love guidance on founding a company.'); assert false, 'not a mentor';
  exception when raise_exception then assert sqlerrm = 'Mentor not found', sqlerrm; end;
  r := public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'I would love guidance on founding a company.');
  insert into t values ('r1', r.id);
  assert r.status = 'requested' and r.mentee_id = auth.uid(), 'requested';
  assert (select my_status from public.list_mentors()) = 'requested', 'my_status';
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'I would love guidance on founding a company.'); assert false, 'duplicate';
  exception when raise_exception then assert sqlerrm like 'You already have an open request%', sqlerrm; end;
  begin update public.mentorships set status = 'accepted' where id = r.id; assert false, 'no direct update';
  exception when insufficient_privilege then null; end;
  begin insert into public.mentorships (mentor_id, mentee_id, topic, message, status) values ('91000000-0000-0000-0000-00000000000a', auth.uid(), 'Startups', 'a long enough message for the check', 'accepted'); assert false, 'no direct insert';
  exception when insufficient_privilege then null; end;
  begin perform public.respond_mentorship(r.id, true); assert false, 'mentee cannot accept';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where kind = 'mentor_request' and user_id = '91000000-0000-0000-0000-00000000000a'
          and actor_id = '91000000-0000-0000-0000-00000000000b' and target_id = (select v from t where k = 'r1') and body = 'Startups') = 1, 'mentor notified once';
end $$;

-- blocked pairs
select pg_temp.login('91000000-0000-0000-0000-0000000000bb');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.list_mentors()) = 0, 'blocked: mentor hidden';
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'I would love guidance on founding a company.'); assert false, 'blocked';
  exception when raise_exception then assert sqlerrm = 'Mentor not found', sqlerrm; end;
end $$;
reset role;

-- privacy: bystander sees neither the request nor the other people's data
select pg_temp.login('91000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.mentorships) = 0 and (select count(*) from public.my_mentorships()) = 0, 'bystander sees no mentorships';
  begin perform public.respond_mentorship((select v from t where k = 'r1'), true); assert false, 'bystander cannot accept';
  exception when insufficient_privilege then null; end;
  begin perform public.end_mentorship((select v from t where k = 'r1')); assert false, 'bystander cannot end';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- mentee two asks too; the single slot goes to whoever is accepted first
select pg_temp.login('91000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ declare r public.mentorships; begin
  r := public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Career growth', 'Could you help me plan the next five years?');
  insert into t values ('r2', r.id);
end $$;
reset role;

select pg_temp.login('91000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ declare m uuid; begin
  assert (select count(*) from public.my_mentorships() where status = 'requested' and role = 'mentor') = 2, 'two incoming requests';
  m := public.respond_mentorship((select v from t where k = 'r1'), true);
  assert m = '91000000-0000-0000-0000-00000000000b', 'returns the mentee';
  assert (select open_slots from public.list_mentors() where user_id = auth.uid()) = 0, 'slot taken';
  -- the second accept (one slot, already used) is refused and the request stays open
  begin perform public.respond_mentorship((select v from t where k = 'r2'), true); assert false, 'oversubscribed';
  exception when raise_exception then assert sqlerrm like 'You have no free mentoring slots%', sqlerrm; end;
  assert (select status from public.mentorships where id = (select v from t where k = 'r2')) = 'requested', 'still requested';
  begin perform public.respond_mentorship((select v from t where k = 'r1'), false); assert false, 'already answered';
  exception when raise_exception then null; end;
  assert (select chat_id from public.my_mentorships() where id = (select v from t where k = 'r1')) is not null, 'a DM exists';
  assert not (select is_request from public.chats where id = (select chat_id from public.my_mentorships() where id = (select v from t where k = 'r1'))), 'DM is not a message request';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'mentor_accepted' and user_id = '91000000-0000-0000-0000-00000000000b' and actor_id = '91000000-0000-0000-0000-00000000000a'), 'mentee told: accepted';
end $$;

-- a full mentor refuses new requests; the pending one can be declined
select pg_temp.login('91000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ begin
  assert (select open_slots from public.list_mentors()) = 0, 'full';
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'I would love guidance on founding a company.'); assert false, 'no free slot';
  exception when raise_exception then assert sqlerrm like 'This mentor has no free slots%', sqlerrm; end;
end $$;
reset role;
select pg_temp.login('91000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  perform public.respond_mentorship((select v from t where k = 'r2'), false);
  assert (select status from public.mentorships where id = (select v from t where k = 'r2')) = 'declined', 'declined';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'mentor_declined' and user_id = '91000000-0000-0000-0000-00000000000c'), 'mentee told: declined';
end $$;

-- ending frees the slot; pausing hides availability; a declined mentee may ask again
select pg_temp.login('91000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select my_status from public.list_mentors()) = 'accepted', 'accepted status shown';
  perform public.end_mentorship((select v from t where k = 'r1'));
  assert (select status from public.mentorships where id = (select v from t where k = 'r1')) = 'ended', 'mentee ended';
  begin perform public.end_mentorship((select v from t where k = 'r1')); assert false, 'already over';
  exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.login('91000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert (select open_slots from public.list_mentors() where user_id = auth.uid()) = 1, 'slot free again';
  perform public.pause_mentoring(false);
end $$;
reset role;
select pg_temp.login('91000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ declare r public.mentorships; begin
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'Please can I ask again after the pause?'); assert false, 'paused';
  exception when raise_exception then assert sqlerrm like 'This mentor is not taking new mentees%', sqlerrm; end;
end $$;
reset role;
select pg_temp.login('91000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin perform public.pause_mentoring(true); end $$;
reset role;
select pg_temp.login('91000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ declare r public.mentorships; begin
  r := public.request_mentor('91000000-0000-0000-0000-00000000000a', 'Startups', 'Please can I ask again after the decline?');
  insert into t values ('r3', r.id);
  assert (select count(*) from public.mentorships where mentee_id = auth.uid()) = 2, 'history kept';
  -- the mentee can withdraw an open request; the mentor must answer instead
  perform public.end_mentorship(r.id);
  assert (select status from public.mentorships where id = r.id) = 'ended', 'withdrawn';
end $$;
reset role;

-- a mentee may have at most 3 open requests
update public.mentor_profiles set max_mentees = 10;
insert into auth.users (id, email, raw_user_meta_data) values
  ('91000000-0000-0000-0000-0000000000e1', 'm1@x.com', '{"full_name":"M1"}'),
  ('91000000-0000-0000-0000-0000000000e2', 'm2@x.com', '{"full_name":"M2"}'),
  ('91000000-0000-0000-0000-0000000000e3', 'm3@x.com', '{"full_name":"M3"}');
update public.profiles set verification = 'verified', onboarded = true where id::text like '91000000-0000-0000-0000-0000000000e%';
insert into public.mentor_profiles (user_id, topics, bio) select id, array['Leadership'], 'Twenty characters of bio, at least.' from public.profiles where id::text like '91000000-0000-0000-0000-0000000000e%';
insert into public.mentor_profiles (user_id, topics, bio) values ('91000000-0000-0000-0000-00000000000d', array['Leadership'], 'Twenty characters of bio, at least.');
select pg_temp.login('91000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  perform public.request_mentor('91000000-0000-0000-0000-0000000000e1', 'Leadership', 'Please mentor me in leading a small team.');
  perform public.request_mentor('91000000-0000-0000-0000-0000000000e2', 'Leadership', 'Please mentor me in leading a small team.');
  perform public.request_mentor('91000000-0000-0000-0000-0000000000e3', 'Leadership', 'Please mentor me in leading a small team.');
  begin perform public.request_mentor('91000000-0000-0000-0000-00000000000d', 'Leadership', 'Please mentor me in leading a small team.'); assert false, 'max 3 open';
  exception when raise_exception then assert sqlerrm like 'You can have up to 3 open mentor requests%', sqlerrm; end;
end $$;
reset role;

-- grants: no anon access, members cannot write the tables
do $$
declare f text;
begin
  foreach f in array array['become_mentor(jsonb)', 'pause_mentoring(boolean)', 'list_mentors(text, text, int, int)',
    'request_mentor(uuid, text, text)', 'respond_mentorship(uuid, boolean)', 'end_mentorship(uuid)', 'my_mentorships()'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), 'anon can execute ' || f;
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), 'authenticated cannot execute ' || f;
  end loop;
  assert not has_table_privilege('authenticated', 'public.mentor_profiles', 'INSERT') and not has_table_privilege('authenticated', 'public.mentor_profiles', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.mentor_profiles', 'DELETE'), 'mentor_profiles writable';
  assert not has_table_privilege('authenticated', 'public.mentorships', 'INSERT') and not has_table_privilege('authenticated', 'public.mentorships', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.mentorships', 'DELETE'), 'mentorships writable';
  assert not has_table_privilege('anon', 'public.mentorships', 'SELECT') and not has_table_privilege('anon', 'public.mentor_profiles', 'SELECT'), 'anon reads';
end $$;
select 'ALL MENTORSHIP TESTS PASSED';
rollback;
