-- Community: groups, feed, connections, messages, blocks, reports, invites/vouches, birthdays, badges. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- A, B: CSE 2016 verified; C: ME 2010 verified; U: unverified; X: admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Anil"}'),
  ('40000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela"}'),
  ('40000000-0000-0000-0000-00000000000c', 'c@x.com', '{"full_name":"Chetan"}'),
  ('40000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}'),
  ('40000000-0000-0000-0000-0000000000ff', 'x@x.com', '{"full_name":"Admin"}');
update public.profiles set verification = 'verified', onboarded = true, grad_year = 2016, branch = 'Computer Science & Engineering'
 where id in ('40000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b');
update public.profiles set verification = 'verified', onboarded = true, grad_year = 2010, branch = 'Mechanical Engineering'
 where id = '40000000-0000-0000-0000-00000000000c';
update public.profiles set onboarded = true, grad_year = 2016, branch = 'Computer Science & Engineering' where id = '40000000-0000-0000-0000-0000000000aa';
update public.profiles set is_admin = true, verification = 'verified' where id = '40000000-0000-0000-0000-0000000000ff';
-- birthday tomorrow for B
update public.profiles set birth_day = extract(day from (now() at time zone 'Asia/Kolkata')::date + 1), birth_month = extract(month from (now() at time zone 'Asia/Kolkata')::date + 1)
 where id = '40000000-0000-0000-0000-00000000000b';

create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

do $$ begin
  assert (select count(*) from public.group_members m join public.groups g on g.id = m.group_id
           where m.user_id = '40000000-0000-0000-0000-00000000000a' and g.kind in ('batch', 'year')) = 2, 'auto-joined batch + year';
  assert (select member_count from public.groups where slug = 'computer-science-engineering-2016') = 3, 'batch has A, B, U';
end $$;

-- A posts publicly and to the batch
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  insert into public.posts (author_id, body) values (auth.uid(), 'Hello JEC!');
  insert into public.posts (author_id, group_id, body) select auth.uid(), id, 'Hello batch!' from public.groups where slug = 'computer-science-engineering-2016';
  insert into t select 'pub', id from public.posts where body = 'Hello JEC!';
  insert into t select 'batch', id from public.posts where body = 'Hello batch!';
  begin
    insert into public.posts (author_id, group_id, body) select auth.uid(), id, 'spam' from public.groups where slug = 'jec-official';
    assert false, 'channel needs admin';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.posts (author_id, group_id, body) select auth.uid(), id, 'x' from public.groups where slug = 'mechanical-engineering-2010';
    assert false, 'cannot post in another batch';
  exception when insufficient_privilege then null; end;
  perform public.join_group((select id from public.groups where slug = 'trekking'), true);
  begin perform public.join_group((select id from public.groups where slug = 'mechanical-engineering-2010'), true); assert false, 'no joining batches';
  exception when raise_exception then null; end;
end $$;
reset role;

-- C (other batch) sees the public post, not the batch post; U (unverified) sees nothing
select pg_temp.login('40000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.posts where id = (select v from t where k = 'pub')) = 1, 'C sees public';
  assert (select count(*) from public.posts where id = (select v from t where k = 'batch')) = 0, 'C cannot see other batch';
  insert into public.post_likes (post_id, user_id) values ((select v from t where k = 'pub'), auth.uid());
  insert into public.comments (post_id, author_id, body) values ((select v from t where k = 'pub'), auth.uid(), 'Welcome!');
  assert public.request_connection('40000000-0000-0000-0000-00000000000a') = 'pending', 'request sent';
end $$;
reset role;
select pg_temp.login('40000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.posts) = 0, 'unverified sees no posts';
  begin insert into public.posts (author_id, body) values (auth.uid(), 'x'); assert false, 'unverified cannot post';
  exception when insufficient_privilege then null; end;
  begin perform public.start_dm('40000000-0000-0000-0000-00000000000a'); assert false, 'unverified cannot message';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A: counts, notifications, accepts C; messaging rules
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare c public.chats;
begin
  assert (select like_count from public.posts where id = (select v from t where k = 'pub')) = 1, 'like counted';
  assert (select comment_count from public.posts where id = (select v from t where k = 'pub')) = 1, 'comment counted';
  assert (select count(*) from public.notifications where user_id = auth.uid()) = 3, 'like + comment + connection request notified';
  perform public.respond_connection('40000000-0000-0000-0000-00000000000c', true);
  assert public.are_connected(auth.uid(), '40000000-0000-0000-0000-00000000000c'), 'connected';
  -- B restricts messages to connections; A (same batch, not connected) cannot start
  update public.profiles set message_policy = 'jec' where id = auth.uid();
end $$;
reset role;
update public.profiles set message_policy = 'connections' where id = '40000000-0000-0000-0000-00000000000b';
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare c public.chats;
begin
  begin perform public.start_dm('40000000-0000-0000-0000-00000000000b'); assert false, 'policy respected';
  exception when raise_exception then null; end;
  c := public.start_dm('40000000-0000-0000-0000-00000000000c');
  assert not c.is_request, 'connected: not a request';
  assert (public.start_dm('40000000-0000-0000-0000-00000000000c')).id = c.id, 'same DM reused';
  perform public.send_message(c.id, 'Hi Chetan');
  assert (select last_message from public.chats where id = c.id) = 'Hi Chetan', 'last message';
  begin perform public.send_message(c.id, null, 'image', '[{"path":"40000000-0000-0000-0000-00000000000c/x/a.jpg"}]'); assert false, 'foreign attachment path';
  exception when raise_exception then null; end;
  assert (select unread from public.my_chats() where id = c.id) = 0, 'own message is not unread';
  insert into t values ('conv', c.id);
end $$;
reset role;

-- C sees the message + notification; blocks A -> A's posts vanish for C and A can't message C
select pg_temp.login('40000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.messages where chat_id = (select v from t where k = 'conv')) = 1, 'C reads message';
  assert (select unread from public.my_chats() where id = (select v from t where k = 'conv')) = 1, 'C has 1 unread';
  perform public.mark_chat_read((select v from t where k = 'conv'));
  assert (select unread from public.my_chats() where id = (select v from t where k = 'conv')) = 0, 'read clears unread';
  assert exists (select 1 from public.notifications where user_id = auth.uid() and kind = 'message'), 'message notification';
  insert into public.blocks (blocker, blocked) values (auth.uid(), '40000000-0000-0000-0000-00000000000a');
  assert (select count(*) from public.posts where author_id = '40000000-0000-0000-0000-00000000000a') = 0, 'blocked posts hidden';
end $$;
reset role;
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform public.send_message((select v from t where k = 'conv'), 'hello?'); assert false, 'blocked cannot message';
  exception when insufficient_privilege then null; end;
  begin perform public.start_dm('40000000-0000-0000-0000-00000000000c'); assert false, 'blocked cannot start';
  exception when raise_exception then null; end;
end $$;
reset role;

-- group chat: history is visible to everyone in the group, including people who join later
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare ch uuid; m public.messages;
begin
  select c.id into ch from public.chats c join public.groups g on g.id = c.group_id where g.slug = 'trekking';
  insert into t values ('trek', ch);
  m := public.send_message(ch, 'First trek plan: Bhedaghat in Jan');
  perform public.send_message(ch, 'Who is in?', 'text', '[]', m.id);
  perform public.send_message(ch, null, 'poll', '[]', null, '{"question":"Which date?","options":["4 Jan","11 Jan"]}');
  begin
    perform public.send_message((select c.id from public.chats c join public.groups g on g.id = c.group_id where g.slug = 'jec-official'), 'spam');
    assert false, 'channel chat is admin-only';
  exception when insufficient_privilege then null; end;
  begin
    perform public.send_message((select c.id from public.chats c join public.groups g on g.id = c.group_id where g.slug = 'mechanical-engineering-2010'), 'hi');
    assert false, 'not a member of that batch';
  exception when insufficient_privilege then null; end;
  perform public.edit_message(m.id, 'First trek plan: Bhedaghat, 11 Jan');
  assert (select edited_at is not null from public.messages where id = m.id), 'edited';
end $$;
reset role;
-- B joins the circle later: sees all 3 earlier messages, but they don't count as unread; @mention notifies
select pg_temp.login('40000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare ch uuid := (select v from t where k = 'trek'); p uuid;
begin
  assert (select count(*) from public.messages where chat_id = ch) = 0, 'non-member cannot read circle chat';
  perform public.join_group((select id from public.groups where slug = 'trekking'), true);
  assert (select count(*) from public.messages where chat_id = ch) = 3, 'new member sees past history';
  assert (select unread from public.my_chats() where id = ch) = 0, 'history is not unread for late joiner';
  select id into p from public.messages where chat_id = ch and kind = 'poll';
  perform public.vote_poll(p, array[1]);
  begin perform public.vote_poll(p, array[0, 1]); assert false, 'single choice';
  exception when raise_exception then null; end;
  perform public.react_to_message(p, '👍');
  perform public.send_message(ch, 'Count me in @anil');
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = '40000000-0000-0000-0000-00000000000a' and kind = 'mention'), 'mention notified';
  assert (select count(*) from public.poll_votes) = 1 and (select count(*) from public.message_reactions) = 1, 'vote + reaction';
end $$;
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert (select unread from public.my_chats() where id = (select v from t where k = 'trek')) = 1, 'A has 1 unread in circle';
  begin perform public.delete_message((select id from public.messages where body = 'Count me in @anil')); assert false, 'cannot delete others';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- search (one chat / all chats), mention suggestions, pin rules
select pg_temp.login('40000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$
declare ch uuid := (select v from t where k = 'trek');
begin
  assert (select count(*) from public.search_messages('trek plan', ch)) = 1, 'search finds message in chat';
  assert (select count(*) from public.search_messages('trek plan')) = 1, 'search across my chats';
  assert (select count(*) from public.search_messages('%', ch)) = 0, 'wildcards are literal';
  assert exists (select 1 from public.mention_candidates(ch, 'an') where full_name = 'Anil'), 'mention prefix';
  assert not exists (select 1 from public.mention_candidates(ch, '') where full_name = 'Bela'), 'not myself';
  assert (select count(*) from public.mention_candidates((select v from t where k = 'conv'), '')) = 0, 'no mentions in DMs';
  begin perform public.pin_message(ch, (select id from public.messages where chat_id = ch limit 1)); assert false, 'member cannot pin';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('40000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare ch uuid := (select v from t where k = 'trek'); m uuid := (select id from public.messages where chat_id = ch order by created_at limit 1);
begin
  perform public.pin_message(ch, m);
  assert (select pinned_message from public.chats where id = ch) = m, 'admin pins';
  perform public.delete_message(m);
  assert (select pinned_message from public.chats where id = ch) is null, 'deleting a pinned message unpins it';
end $$;
reset role;

-- slow mode (admin only; members limited, admins exempt) and reporting a chat message
select pg_temp.login('40000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  begin perform public.set_slow_mode((select id from public.groups where slug = 'trekking'), 60); assert false, 'member cannot set slow mode';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('40000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin
  perform public.set_slow_mode((select id from public.groups where slug = 'trekking'), 60);
  begin perform public.set_slow_mode((select id from public.groups where slug = 'trekking'), 99999); assert false, 'range checked';
  exception when raise_exception then null; end;
  assert (select slow_mode_seconds from public.my_chats((select v from t where k = 'trek'))) = 60, 'slow mode visible in chat info';
  perform public.join_group((select id from public.groups where slug = 'trekking'), true);
  perform public.send_message((select v from t where k = 'trek'), 'admin 1');
  perform public.send_message((select v from t where k = 'trek'), 'admin 2'); -- admins are exempt
end $$;
reset role;
update public.messages set created_at = now() - interval '2 hours' where sender_id = '40000000-0000-0000-0000-00000000000a'; -- earlier chatter is long ago
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare ch uuid := (select v from t where k = 'trek');
begin
  perform public.send_message(ch, 'first after slow mode');
  begin perform public.send_message(ch, 'too soon'); assert false, 'slow mode blocks second message';
  exception when raise_exception then assert sqlerrm like 'Slow mode is on%', 'friendly message: ' || sqlerrm; end;
  begin perform public.report_message((select id from public.messages where chat_id = ch and sender_id = auth.uid() limit 1), 'spam'); assert false, 'cannot report own';
  exception when raise_exception then null; end;
  perform public.report_message((select id from public.messages where chat_id = ch and body = 'admin 1'), 'Not appropriate');
  perform public.report_message((select id from public.messages where chat_id = ch and body = 'admin 1'), 'Not appropriate'); -- idempotent
  begin perform public.report_message((select id from public.messages where chat_id = ch limit 1), 'x'); assert false, 'reason required';
  exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.reports where target_type = 'message') = 1, 'one report stored';
end $$;
-- moderation queue: only admins; remove a reported message; dismiss
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin perform * from public.admin_reports(); assert false, 'members cannot read the queue';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_remove_message((select id from public.messages where body = 'admin 1')); assert false, 'members cannot remove';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('40000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$
declare mid uuid := (select id from public.messages where body = 'admin 1');
begin
  assert (select report_count from public.admin_reports() where target_id = mid) = 1, 'queue lists reported message';
  assert (select preview from public.admin_reports() where target_id = mid) = 'admin 1', 'preview';
  perform public.admin_remove_message(mid);
  assert (select deleted_at is not null and body is null from public.messages where id = mid), 'removed';
  assert not exists (select 1 from public.admin_reports() where target_id = mid), 'closed reports leave the open queue';
  assert (select preview from public.admin_reports('actioned') where target_id = mid) = 'admin 1', 'snapshot survives removal';
  assert exists (select 1 from public.admin_audit where action = 'remove_message'), 'audited';
end $$;
reset role;

-- DM outsiders cannot report messages they cannot read
select pg_temp.login('40000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  begin perform public.report_message((select id from public.messages where chat_id = (select v from t where k = 'conv') limit 1), 'nosy'); assert false, 'cannot report unreadable message';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- profile data rules: impossible birthdays and non-web links are refused by the database itself
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  begin update public.profiles set birth_day = 31, birth_month = 2 where id = auth.uid(); assert false, '31 Feb refused';
  exception when check_violation then null; end;
  begin update public.profiles set birth_day = 5, birth_month = null where id = auth.uid(); assert false, 'day without month refused';
  exception when check_violation then null; end;
  update public.profiles set birth_day = 29, birth_month = 2 where id = auth.uid(); -- leap day is a real birthday
  begin update public.profiles set website_url = 'javascript:alert(1)' where id = auth.uid(); assert false, 'javascript: link refused';
  exception when check_violation then null; end;
  begin update public.profiles set website_url = 'https://not a website' where id = auth.uid(); assert false, 'spaces refused';
  exception when check_violation then null; end;
  update public.profiles set website_url = 'https://asha.example.com/', linkedin_url = 'https://www.linkedin.com/in/asha' where id = auth.uid();
end $$;
reset role;

-- reports: three reports hide a post
insert into auth.users (id, email) values ('40000000-0000-0000-0000-0000000000d1', 'd1@x.com'), ('40000000-0000-0000-0000-0000000000d2', 'd2@x.com');
update public.profiles set verification = 'verified' where id in ('40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d2');
do $$
declare u uuid;
begin
  foreach u in array array['40000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d2']::uuid[] loop
    insert into public.reports (reporter, target_type, target_id, reason) values (u, 'post', (select v from t where k = 'pub'), 'spam');
  end loop;
  assert (select is_hidden from public.posts where id = (select v from t where k = 'pub')), 'auto-hidden after 3 reports';
end $$;

-- invites + vouches verify U
select pg_temp.login('40000000-0000-0000-0000-0000000000aa');
set local role authenticated;
do $$ begin
  perform public.claim_invite((select invite_code from public.profiles where id = auth.uid())); -- own code ignored
  assert (select invited_by from public.profiles where id = auth.uid()) is null, 'own code ignored';
end $$;
reset role;
do $$ begin
  -- simulate: U claims A's invite (as U)
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-0000000000aa', true);
  perform public.claim_invite((select invite_code from public.profiles where id = '40000000-0000-0000-0000-00000000000a'));
  assert (select invited_by from public.profiles where id = '40000000-0000-0000-0000-0000000000aa') = '40000000-0000-0000-0000-00000000000a', 'invite claimed';
  assert (select verification from public.profiles where id = '40000000-0000-0000-0000-0000000000aa') = 'pending', 'one vouch is not enough';
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-00000000000b', true);
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  perform public.vouch_for('40000000-0000-0000-0000-0000000000aa');
  assert (select verification from public.profiles where id = '40000000-0000-0000-0000-0000000000aa') = 'verified', 'two vouches verify';
  assert exists (select 1 from public.notifications where user_id = '40000000-0000-0000-0000-00000000000a' and kind = 'invite_joined'), 'inviter notified';
end $$;

-- birthdays (A sees batchmate B tomorrow), badges, leaderboard
select pg_temp.login('40000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  assert (select days_away from public.upcoming_birthdays() where full_name = 'Bela') = 1, 'birthday tomorrow';
  assert jsonb_array_length(public.member_badges(auth.uid())) >= 1, 'founding badge';
  assert (select joined from public.invite_leaderboard() where id = auth.uid()) = 1, 'leaderboard counts onboarded invitee';
end $$;
reset role;
do $$ begin
  assert public._next_birthday(29::smallint, 2::smallint, '2026-03-01') = '2028-02-29', 'leap day';
  assert public._next_birthday(2::smallint, 1::smallint, '2026-12-30') = '2027-01-02', 'new year';
end $$;

select 'ALL COMMUNITY TESTS PASSED';
rollback;
