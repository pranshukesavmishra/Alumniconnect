-- Social links: visibility matrix, blocks, connections, unverified viewers, malicious URLs rejected. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
-- A owner; B verified stranger; C verified connection of A; D verified, blocked by A; U unverified; X admin; R rejected owner
insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-00000000000a', 'a@x.com', '{"full_name":"Anil"}'),
  ('80000000-0000-0000-0000-00000000000b', 'b@x.com', '{"full_name":"Bela"}'),
  ('80000000-0000-0000-0000-00000000000c', 'c@x.com', '{"full_name":"Chetan"}'),
  ('80000000-0000-0000-0000-00000000000d', 'd@x.com', '{"full_name":"Divya"}'),
  ('80000000-0000-0000-0000-0000000000aa', 'u@x.com', '{"full_name":"Unverified"}'),
  ('80000000-0000-0000-0000-0000000000ff', 'x@x.com', '{"full_name":"Admin"}'),
  ('80000000-0000-0000-0000-0000000000ee', 'r@x.com', '{"full_name":"Rejected"}');
update public.profiles set verification = 'verified', onboarded = true
 where id in ('80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000b',
              '80000000-0000-0000-0000-00000000000c', '80000000-0000-0000-0000-00000000000d');
update public.profiles set is_admin = true, verification = 'verified' where id = '80000000-0000-0000-0000-0000000000ff';
insert into public.connections (requester, addressee, status, accepted_at)
  values ('80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000c', 'accepted', now());
insert into public.blocks (blocker, blocked) values ('80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000d');

-- A saves links (as A, through the table's own grants and RLS)
select pg_temp.login('80000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into public.profile_social_links (user_id, instagram_url, facebook_url)
  values (auth.uid(), 'https://www.instagram.com/anil.k/', 'https://www.facebook.com/anil.k');
do $$ begin
  -- cannot write someone else's row
  begin
    insert into public.profile_social_links (user_id, instagram_url) values ('80000000-0000-0000-0000-00000000000b', 'https://www.instagram.com/b/');
    assert false, 'must not insert for another member';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.profile_social_links) = 1, 'owner sees own row only';
end $$;

-- malicious / malformed values are rejected by the database itself
do $$
declare v text;
begin
  foreach v in array array[
    'javascript:alert(1)', 'http://www.instagram.com/x/', 'https://instagram.com/x/', 'https://www.instagram.com.evil.com/x/',
    'https://www.instagram.com/x y/', 'https://www.instagram.com/' || repeat('a', 31) || '/', 'https://www.instagram.com/x/?a=1',
    'https://evil.com/https://www.instagram.com/x/', 'https://www.instagram.com/<script>/', 'data:text/html,x'
  ] loop
    begin
      update public.profile_social_links set instagram_url = v where user_id = auth.uid();
      raise exception 'instagram accepted %', v;
    exception when check_violation then null; end;
  end loop;
  foreach v in array array[
    'javascript:alert(1)', 'http://www.facebook.com/x', 'https://facebook.com.evil.com/x', 'https://www.facebook.com.evil.com/x',
    'https://www.facebook.com/l.php?u=https://evil.com', 'https://www.facebook.com/sharer.php', 'https://www.facebook.com/profile.php?id=abc',
    'https://www.facebook.com/a b', 'https://evil.com/www.facebook.com/x', 'https://www.facebook.com/x?next=evil', 'https://www.facebook.com/a/b/c/d',
    'https://m.facebook.com/x', 'https://www.facebook.com/profile.php?id=12345678&x=y'
  ] loop
    begin
      update public.profile_social_links set facebook_url = v where user_id = auth.uid();
      raise exception 'facebook accepted %', v;
    exception when check_violation then null; end;
  end loop;
  -- valid shapes pass
  update public.profile_social_links set facebook_url = 'https://www.facebook.com/profile.php?id=100012345678901' where user_id = auth.uid();
  update public.profile_social_links set facebook_url = 'https://www.facebook.com/pages/Some-Page/12345' where user_id = auth.uid();
  update public.profile_social_links set facebook_url = 'https://www.facebook.com/anil.k' where user_id = auth.uid();
  begin
    update public.profile_social_links set instagram_visibility = 'public' where user_id = auth.uid();
    assert false, 'visibility is constrained';
  exception when check_violation then null; end;
end $$;
reset role;

-- visibility matrix
create temp table r (who text, ig text, fb text);
grant all on r to authenticated;
create function pg_temp.snap(p_who text, p_viewer uuid) returns void language plpgsql as $$
begin
  perform pg_temp.login(p_viewer);
  delete from r where who = p_who;
  insert into r select p_who, instagram_url, facebook_url
    from public.get_social_links(array['80000000-0000-0000-0000-00000000000a']::uuid[]);
end $$;

-- default 'verified': stranger and connection see both; blocked, unverified and admin-less outsiders per rules
set local role authenticated;
select pg_temp.snap('B', '80000000-0000-0000-0000-00000000000b');
select pg_temp.snap('C', '80000000-0000-0000-0000-00000000000c');
select pg_temp.snap('D', '80000000-0000-0000-0000-00000000000d');
select pg_temp.snap('U', '80000000-0000-0000-0000-0000000000aa');
select pg_temp.snap('A', '80000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select ig from r where who = 'B') = 'https://www.instagram.com/anil.k/', 'verified stranger sees instagram';
  assert (select fb from r where who = 'B') = 'https://www.facebook.com/anil.k', 'verified stranger sees facebook';
  assert (select ig from r where who = 'C') is not null, 'connection sees';
  assert not exists (select 1 from r where who = 'D'), 'blocked member sees nothing';
  assert not exists (select 1 from r where who = 'U'), 'unverified member sees nothing';
  assert (select ig from r where who = 'A') is not null, 'owner sees own';
end $$;

-- instagram: connections only; facebook: hidden
reset role;
select pg_temp.login('80000000-0000-0000-0000-00000000000a');
set local role authenticated;
update public.profile_social_links set instagram_visibility = 'connections', facebook_visibility = 'hidden' where user_id = auth.uid();
select pg_temp.snap('B', '80000000-0000-0000-0000-00000000000b');
select pg_temp.snap('C', '80000000-0000-0000-0000-00000000000c');
select pg_temp.snap('A', '80000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select ig from r where who = 'B') is null and (select fb from r where who = 'B') is null, 'stranger sees neither';
  assert (select ig from r where who = 'C') is not null, 'connection sees instagram';
  assert (select fb from r where who = 'C') is null, 'connection does not see hidden facebook';
  assert (select fb from r where who = 'A') is not null, 'owner still sees own hidden link';
end $$;

-- direct table reads by others return nothing
select pg_temp.login('80000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.profile_social_links) = 0, 'no direct table read for others';
  assert (select count(*) from public.get_social_links(null)) = 0, 'null list is empty';
end $$;
-- B cannot change A's row
update public.profile_social_links set instagram_url = 'https://www.instagram.com/hacked/' where user_id = '80000000-0000-0000-0000-00000000000a';
reset role;
do $$ begin
  assert (select instagram_url from public.profile_social_links where user_id = '80000000-0000-0000-0000-00000000000a') = 'https://www.instagram.com/anil.k/', 'row untouched by others';
end $$;

-- admin may read the table (member view); anon gets nothing
select pg_temp.login('80000000-0000-0000-0000-0000000000ff');
set local role authenticated;
do $$ begin assert (select count(*) from public.profile_social_links) = 1, 'admin reads links'; end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.get_social_links(array['80000000-0000-0000-0000-00000000000a']::uuid[]); assert false, 'anon rpc'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.profile_social_links; assert false, 'anon table'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- a member who is no longer verified is not shown; deleting the profile removes links
update public.profiles set verification = 'rejected' where id = '80000000-0000-0000-0000-00000000000a';
update public.profile_social_links set instagram_visibility = 'verified';
select pg_temp.login('80000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin assert (select count(*) from public.get_social_links(array['80000000-0000-0000-0000-00000000000a']::uuid[])) = 0, 'rejected member hidden'; end $$;
reset role;
delete from auth.users where id = '80000000-0000-0000-0000-00000000000a';
do $$ begin assert (select count(*) from public.profile_social_links) = 0, 'links cascade-deleted'; end $$;
select 'social links ok';
rollback;
