-- Official group + department groups: auto-join, move on branch change, backfill, post mode, group admins, unverified members. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
create temp table t (k text primary key, v uuid);
grant select, insert on t to authenticated;
-- a admin (circles), p plain admin without the circles permission, h head of department (faculty), m member, n member (other branch),
-- u unverified member, o moderator
insert into auth.users (id, email, raw_user_meta_data) values
  ('d9000000-0000-0000-0000-0000000000a1', 'a@d9.com', '{"full_name":"Adm"}'),
  ('d9000000-0000-0000-0000-0000000000a2', 'p@d9.com', '{"full_name":"Plain"}'),
  ('d9000000-0000-0000-0000-0000000000b1', 'h@d9.com', '{"full_name":"Head Mechatronics"}'),
  ('d9000000-0000-0000-0000-0000000000c1', 'm@d9.com', '{"full_name":"Mem One"}'),
  ('d9000000-0000-0000-0000-0000000000c2', 'n@d9.com', '{"full_name":"Mem Two"}'),
  ('d9000000-0000-0000-0000-0000000000c3', 'u@d9.com', '{"full_name":"Unver"}'),
  ('d9000000-0000-0000-0000-0000000000d1', 'o@d9.com', '{"full_name":"Mod"}');
update public.profiles set is_admin = true, verification = 'verified', onboarded = true, member_type = 'alumnus', branch = 'MCA', grad_year = 2010
 where id in ('d9000000-0000-0000-0000-0000000000a1', 'd9000000-0000-0000-0000-0000000000a2');
insert into public.admin_grants (user_id, permissions) values
  ('d9000000-0000-0000-0000-0000000000a1', array['community_circles']),
  ('d9000000-0000-0000-0000-0000000000a2', array['analytics']);
insert into public.site_roles (user_id, role) values ('d9000000-0000-0000-0000-0000000000d1', 'moderator');
update public.profiles set verification = 'verified', onboarded = true, member_type = 'alumnus', branch = 'MCA', grad_year = 2010 where id = 'd9000000-0000-0000-0000-0000000000d1';

do $$
declare
  n int;
begin
  assert (select count(*) from public.groups where kind = 'official') = 1, 'one official group';
  assert (select post_mode from public.groups where kind = 'official') = 'staff_only', 'official is staff only';
  assert (select count(*) from public.groups where kind = 'department') = 18, 'one department per branch (not Other)';
  assert (select name from public.groups where kind = 'department' and branch = 'Mechatronics') = 'Mechatronics Department', 'department name';
  assert (select name from public.groups where kind = 'department' and branch = 'B.E. in Mechanical Engineering') = 'Mechanical Engineering Department', 'B.E. name';
  assert (select count(*) from public.groups where kind = 'department' and post_mode <> 'everyone') = 0, 'departments are open';
end $$;

-- ---------------------------------------------------------------- auto-join on onboarding, moved on a branch change
update public.profiles set member_type = 'faculty', branch = 'Mechatronics', grad_year = 2000, verification = 'verified', onboarded = true where id = 'd9000000-0000-0000-0000-0000000000b1';
update public.profiles set member_type = 'alumnus', branch = 'Mechatronics', grad_year = 2028, verification = 'verified', onboarded = true where id = 'd9000000-0000-0000-0000-0000000000c1';
update public.profiles set member_type = 'alumnus', branch = 'B.E. in Civil Engineering', grad_year = 2028, verification = 'verified', onboarded = true where id = 'd9000000-0000-0000-0000-0000000000c2';
update public.profiles set member_type = 'alumnus', branch = 'Mechatronics', grad_year = 2028, verification = 'pending', onboarded = true where id = 'd9000000-0000-0000-0000-0000000000c3';
do $$
declare
  mech uuid := (select id from public.groups where kind = 'department' and branch = 'Mechatronics');
  civil uuid := (select id from public.groups where kind = 'department' and branch = 'B.E. in Civil Engineering');
  off uuid := (select id from public.groups where kind = 'official');
  m uuid := 'd9000000-0000-0000-0000-0000000000c1';
begin
  assert exists (select 1 from public.group_members where group_id = off and user_id = m), 'in official';
  assert exists (select 1 from public.group_members where group_id = mech and user_id = m), 'in department';
  assert exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id where gm.user_id = m and g.slug = 'mechatronics-2028'), 'batch group kept';
  assert exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id where gm.user_id = m and g.slug = 'jec-2028'), 'year group kept';
  assert exists (select 1 from public.group_members where group_id = civil and user_id = 'd9000000-0000-0000-0000-0000000000c2'), 'other member in civil';
  -- the unverified member is in the groups too (so everything is there once verified)
  assert exists (select 1 from public.group_members where group_id = off and user_id = 'd9000000-0000-0000-0000-0000000000c3'), 'unverified auto-joined official';
  assert exists (select 1 from public.group_members where group_id = mech and user_id = 'd9000000-0000-0000-0000-0000000000c3'), 'unverified auto-joined department';
  -- an un-onboarded profile joins nothing
  assert not exists (select 1 from public.group_members where user_id = 'd9000000-0000-0000-0000-0000000000a1' and group_id = mech), 'admin is not in mechatronics';

  -- branch change moves the member
  update public.profiles set branch = 'B.E. in Civil Engineering' where id = m;
  assert not exists (select 1 from public.group_members where group_id = mech and user_id = m), 'left old department';
  assert exists (select 1 from public.group_members where group_id = civil and user_id = m), 'joined new department';
  assert exists (select 1 from public.group_members where group_id = off and user_id = m), 'still in official';
  assert exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id where gm.user_id = m and g.slug = 'b-e-in-civil-engineering-2028'), 'moved batch group';
  -- 'Other' has no department
  update public.profiles set branch = 'Other' where id = m;
  assert not exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id where gm.user_id = m and g.kind = 'department'), 'Other: no department';
  update public.profiles set branch = 'Mechatronics' where id = m;
  assert exists (select 1 from public.group_members where group_id = mech and user_id = m), 'back in mechatronics';
  -- the counter matches reality
  assert (select member_count from public.groups where id = mech) = (select count(*) from public.group_members where group_id = mech), 'member_count matches';
  assert (select member_count from public.groups where id = off) = (select count(*) from public.group_members where group_id = off), 'official count matches';

  -- backfill: someone who somehow lost their rows gets them back
  delete from public.group_members where user_id = m and group_id in (off, mech);
  insert into public.group_members (group_id, user_id)
    select g.id, p.id from public.profiles p join public.groups g on g.kind = 'official' where p.onboarded on conflict do nothing;
  insert into public.group_members (group_id, user_id)
    select g.id, p.id from public.profiles p join public.groups g on g.kind = 'department' and g.branch = p.branch where p.onboarded on conflict do nothing;
  assert exists (select 1 from public.group_members where group_id = off and user_id = m) and exists (select 1 from public.group_members where group_id = mech and user_id = m), 'backfill';
  -- members cannot leave or join these groups themselves
end $$;

-- ---------------------------------------------------------------- group admins (assignment, audit, notification, permissions)
select pg_temp.login('d9000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
begin
  begin perform public.admin_set_group_admin((select id from public.groups where kind = 'official'), 'd9000000-0000-0000-0000-0000000000c1', true); assert false, 'member is refused';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_group((select id from public.groups where kind = 'official'), 'Hacked', null, 'everyone', true); assert false, 'member cannot edit';
  exception when insufficient_privilege then null; end;
  begin perform * from public.admin_department_groups(); assert false, 'member cannot list admin view';
  exception when insufficient_privilege then null; end;
  begin perform public.join_group((select id from public.groups where kind = 'department' and branch = 'MCA'), true); assert false, 'cannot join a department by hand';
  exception when raise_exception then null; end;
  begin perform public.join_group((select id from public.groups where kind = 'official'), false); assert false, 'cannot leave official';
  exception when raise_exception then null; end;
end $$;
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$
begin
  begin perform public.admin_set_group_admin((select id from public.groups where kind = 'official'), 'd9000000-0000-0000-0000-0000000000b1', true); assert false, 'admin without circles refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare
  off uuid := (select id from public.groups where kind = 'official');
  mech uuid := (select id from public.groups where kind = 'department' and branch = 'Mechatronics');
  r record;
begin
  perform public.admin_set_group_admin(mech, 'd9000000-0000-0000-0000-0000000000b1', true);
  perform public.admin_set_group_admin(off, 'd9000000-0000-0000-0000-0000000000b1', true);
  assert (select role from public.group_members where group_id = mech and user_id = 'd9000000-0000-0000-0000-0000000000b1') = 'admin', 'hod is admin';
  select * into r from public.admin_department_groups() where id = mech;
  assert r.member_count >= 3 and jsonb_array_length(r.admins) = 1, 'overview shows counts and admins';
  assert (select count(*) from public.admin_department_groups()) = 19, 'overview lists official + departments';
  begin perform public.admin_update_group(off, 'x', null, 'everyone', true); assert false, 'name too short';
  exception when raise_exception then null; end;
  begin perform public.admin_update_group(off, 'JEC Alumni Connect · Official', null, 'nobody', true); assert false, 'bad mode';
  exception when raise_exception then null; end;
  begin perform public.admin_set_group_admin(mech, 'd9000000-0000-0000-0000-0000000000c3', true); perform public.admin_set_group_admin(mech, 'd9000000-0000-0000-0000-0000000000c3', false);
  exception when others then assert false, 'unverified can be assigned and removed: ' || sqlerrm; end;
  perform public.admin_update_group(mech, 'Mechatronics Department', 'All batches of Mechatronics', 'everyone', true);
  assert (select description from public.groups where id = mech) = 'All batches of Mechatronics', 'described';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = 'd9000000-0000-0000-0000-0000000000b1' and kind = 'group_admin' and target_id = (select id from public.groups where kind = 'department' and branch = 'Mechatronics')), 'hod notified';
  assert exists (select 1 from public.admin_audit where action = 'group_admin_added' and target_id = (select id from public.groups where kind = 'department' and branch = 'Mechatronics')), 'audited';
  assert exists (select 1 from public.admin_audit where action = 'update_group'), 'update audited';
end $$;

-- a branch change must not strip a department admin
update public.profiles set branch = 'MCA' where id = 'd9000000-0000-0000-0000-0000000000b1';
do $$ begin
  assert (select role from public.group_members where group_id = (select id from public.groups where kind = 'department' and branch = 'Mechatronics') and user_id = 'd9000000-0000-0000-0000-0000000000b1') = 'admin', 'admin role kept on branch change';
  assert exists (select 1 from public.group_members where group_id = (select id from public.groups where kind = 'department' and branch = 'MCA') and user_id = 'd9000000-0000-0000-0000-0000000000b1'), 'and joined the new department';
end $$;

-- ---------------------------------------------------------------- post mode in the official group
select pg_temp.login('d9000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$
declare
  off uuid := (select id from public.groups where kind = 'official');
  chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
  m public.messages;
begin
  assert public.can_post_chat(chat), 'group admin may post';
  m := public.send_message(chat, 'Welcome to JEC Alumni Connect');
  insert into t values ('msg', m.id);
  perform public.pin_message(chat, m.id);
  assert (select pinned_message from public.chats where id = chat) = m.id, 'group admin pins';
  perform public.set_slow_mode(off, 30);
  perform public.set_slow_mode(off, 0);
  insert into public.posts (author_id, group_id, body) values (auth.uid(), off, 'An announcement');
end $$;
reset role;

select pg_temp.login('d9000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
declare
  off uuid := (select id from public.groups where kind = 'official');
  chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
  mech uuid := (select id from public.groups where kind = 'department' and branch = 'Mechatronics');
  mchat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'department' and branch = 'Mechatronics'));
  mid uuid := (select v from t where k = 'msg');
  r record;
begin
  assert public.can_read_chat(chat), 'member reads official';
  assert not public.can_post_chat(chat), 'member cannot post in official';
  begin perform public.send_message(chat, 'Hello everyone'); assert false, 'non-staff post refused';
  exception when insufficient_privilege then null; end;
  begin insert into public.posts (author_id, group_id, body) values (auth.uid(), off, 'Mine'); assert false, 'non-staff feed post refused';
  exception when insufficient_privilege then null; end;
  -- replies are allowed while comments are on
  perform public.send_message(chat, 'Thank you!', 'text', '[]', mid);
  assert (select can_reply from public.my_chats(chat)) and (select post_mode from public.my_chats(chat)) = 'staff_only', 'my_chats says reply-only';
  perform public.react_to_message(mid, '👍');
  begin perform public.pin_message(chat, mid); assert false, 'member cannot pin';
  exception when insufficient_privilege then null; end;
  begin perform public.set_slow_mode(off, 10); assert false, 'member cannot set slow mode';
  exception when insufficient_privilege then null; end;
  -- the department group is open
  perform public.send_message(mchat, 'Hello department');
  insert into public.posts (author_id, group_id, body) values (auth.uid(), mech, 'Department post');
  -- comments on an announcement post
  insert into public.comments (post_id, author_id, body) select p.id, auth.uid(), 'Nice' from public.posts p where p.group_id = off limit 1;
end $$;
reset role;

-- the moderator and an admin with community_circles are staff too
select pg_temp.login('d9000000-0000-0000-0000-0000000000d1');
set local role authenticated;
do $$ declare chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official')); begin
  perform public.send_message(chat, 'Moderator notice');
end $$;
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare
  off uuid := (select id from public.groups where kind = 'official');
  chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
begin
  perform public.send_message(chat, 'Admin notice');
  -- switching replies off, and then everyone-mode
  perform public.admin_update_group(off, 'JEC Alumni Connect · Official', null, 'staff_only', false);
end $$;
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$
declare
  chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
  mid uuid := (select v from t where k = 'msg');
begin
  begin perform public.send_message(chat, 'Reply when off', 'text', '[]', mid); assert false, 'replies off';
  exception when insufficient_privilege then null; end;
  assert not (select can_reply from public.my_chats(chat)), 'my_chats: no reply';
  begin insert into public.comments (post_id, author_id, body) select p.id, auth.uid(), 'No' from public.posts p where p.group_id = (select id from public.groups where kind = 'official') limit 1; assert false, 'comment refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.admin_update_group((select id from public.groups where kind = 'official'), 'JEC Alumni Connect · Official', null, 'everyone', true);
reset role;
select pg_temp.login('d9000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin perform public.send_message((select id from public.chats where group_id = (select id from public.groups where kind = 'official')), 'Now everyone may post'); end $$;
reset role;

-- ---------------------------------------------------------------- unverified members see nothing, then everything once verified
select pg_temp.login('d9000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$
declare chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
begin
  assert not public.can_read_chat(chat), 'unverified cannot read official';
  assert not public.can_read_chat((select id from public.chats where group_id = (select id from public.groups where kind = 'department' and branch = 'Mechatronics'))), 'unverified cannot read department';
  assert (select count(*) from public.my_chats()) = 0, 'unverified: no chats';
  assert not public.can_post_chat(chat), 'unverified cannot post';
  assert (select count(*) from public.messages where chat_id = chat) = 0, 'no messages leak through RLS';
end $$;
reset role;
update public.profiles set verification = 'verified' where id = 'd9000000-0000-0000-0000-0000000000c3';
select pg_temp.login('d9000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$
declare chat uuid := (select id from public.chats where group_id = (select id from public.groups where kind = 'official'));
begin
  assert public.can_read_chat(chat), 'verified: reads at once';
  assert (select count(*) from public.my_chats() where group_kind::text in ('official', 'department')) = 2, 'both groups appear at once';
  assert (select count(*) from public.messages where chat_id = chat) >= 3, 'history visible';
end $$;
reset role;
rollback;
