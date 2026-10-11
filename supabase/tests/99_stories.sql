-- Stories and highlights: the permission, who sees what (official to all / one event / a group, personal to everyone / connections only),
-- blocks, unverified and rejected owners, expiry, moderation, highlights that outlive a story, the rate limit, owner-only delete, one view
-- and one heart per person, malicious links, the notification limit, the cleanup. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;
-- run a statement as a person: null when it worked, else "sqlstate|hint|message"
create function pg_temp.exec(p_uid uuid, q text) returns text language plpgsql as $$
declare h text;
begin
  execute format('set local role %s', case when p_uid is null then 'anon' else 'authenticated' end);
  perform pg_temp.login(p_uid);
  begin execute q;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    reset role;
    return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
  end;
  reset role;
  return null;
end $$;
-- a scalar as a person (text), or "ERR|..." when it failed
create function pg_temp.val(p_uid uuid, q text) returns text language plpgsql as $$
declare r text; h text;
begin
  execute format('set local role %s', case when p_uid is null then 'anon' else 'authenticated' end);
  perform pg_temp.login(p_uid);
  begin execute q into r;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    reset role;
    return 'ERR|' || sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
  end;
  reset role;
  return r;
end $$;
-- how many rows a query returns for a person (-1 = refused)
create function pg_temp.n(p_uid uuid, q text) returns bigint language plpgsql as $$
declare c bigint;
begin
  execute format('set local role %s', case when p_uid is null then 'anon' else 'authenticated' end);
  perform pg_temp.login(p_uid);
  begin execute 'select count(*) from (' || q || ') s' into c; exception when others then c := -1; end;
  reset role;
  return c;
end $$;

-- people: a owner, b connection of a, c stranger, d blocked by a, e blocked a, u unverified, r rejected owner, g group member,
-- v confirmed for the event, w only pending payment, s stories_post admin, o admin with another permission, f full admin, m a second stranger
insert into auth.users (id, email, raw_user_meta_data) values
  ('81000000-0000-0000-0000-0000000000a1', 'a@st81.com', '{"full_name":"Anil Owner"}'),
  ('81000000-0000-0000-0000-0000000000b1', 'b@st81.com', '{"full_name":"Bela Friend"}'),
  ('81000000-0000-0000-0000-0000000000c1', 'c@st81.com', '{"full_name":"Chetan Stranger"}'),
  ('81000000-0000-0000-0000-0000000000d1', 'd@st81.com', '{"full_name":"Divya Blocked"}'),
  ('81000000-0000-0000-0000-0000000000e1', 'e@st81.com', '{"full_name":"Esha Blocker"}'),
  ('81000000-0000-0000-0000-0000000000f1', 'u@st81.com', '{"full_name":"Umesh Unverified"}'),
  ('81000000-0000-0000-0000-000000000011', 'r@st81.com', '{"full_name":"Rohit Rejected"}'),
  ('81000000-0000-0000-0000-000000000012', 'g@st81.com', '{"full_name":"Gita Group"}'),
  ('81000000-0000-0000-0000-000000000013', 'v@st81.com', '{"full_name":"Vikas Registered"}'),
  ('81000000-0000-0000-0000-000000000014', 'w@st81.com', '{"full_name":"Veena Pending"}'),
  ('81000000-0000-0000-0000-000000000015', 'm@st81.com', '{"full_name":"Mohan Stranger"}'),
  ('81000000-0000-0000-0000-0000000000a5', 's@st81.com', '{"full_name":"Sneha Stories"}'),
  ('81000000-0000-0000-0000-0000000000a6', 'o@st81.com', '{"full_name":"Om Other"}'),
  ('81000000-0000-0000-0000-0000000000a7', 'f@st81.com', '{"full_name":"Farah Full"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001
 where id::text like '81000000-%' and id <> '81000000-0000-0000-0000-0000000000f1';
update public.profiles set is_admin = true where id in ('81000000-0000-0000-0000-0000000000a5', '81000000-0000-0000-0000-0000000000a6', '81000000-0000-0000-0000-0000000000a7');
insert into public.admin_grants (user_id, permissions) values
  ('81000000-0000-0000-0000-0000000000a5', array['stories_post']),
  ('81000000-0000-0000-0000-0000000000a6', array['photos_moderate']);
insert into public.connections (requester, addressee, status, accepted_at) values ('81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000b1', 'accepted', now());
insert into public.blocks (blocker, blocked) values
  ('81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000d1'),
  ('81000000-0000-0000-0000-0000000000e1', '81000000-0000-0000-0000-0000000000a1');
insert into public.events (id, slug, title, is_published, upi_id) values ('81000000-0000-0000-0000-0000000000ee', 'st81-meet', 'ST81 Meet', true, 'jec@okhdfc');
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise) values
  ('81000000-0000-0000-0000-0000000000d3', '81000000-0000-0000-0000-0000000000ee', '81000000-0000-0000-0000-000000000013', 'JEC-S81003', 'Vikas', '+91 98765 81003', 'v@st81.com', 'confirmed', 1, 100000),
  ('81000000-0000-0000-0000-0000000000d4', '81000000-0000-0000-0000-0000000000ee', '81000000-0000-0000-0000-000000000014', 'JEC-S81004', 'Veena', '+91 98765 81004', 'w@st81.com', 'pending_payment', 1, 100000);
insert into public.groups (id, kind, slug, name, is_approved) values ('81000000-0000-0000-0000-0000000000f2', 'circle', 'st81-circle', 'ST81 Circle', true);
insert into public.group_members (group_id, user_id) values ('81000000-0000-0000-0000-0000000000f2', '81000000-0000-0000-0000-000000000012');
insert into storage.objects (bucket_id, name, owner) values
  ('stories', '81000000-0000-0000-0000-0000000000a1/p1-main.webp', null), ('stories', '81000000-0000-0000-0000-0000000000a1/p1-thumb.webp', null),
  ('stories', '81000000-0000-0000-0000-0000000000a1/v1-poster.webp', null),
  ('stories', '81000000-0000-0000-0000-0000000000a5/o1-main.webp', null), ('stories', '81000000-0000-0000-0000-0000000000a5/o1-thumb.webp', null);

-- ---------------------------------------------------------------- the permission, in the right place, on the right roles
do $$
begin
  assert (select count(*) from public._permission_catalog() where key = 'stories_post') = 1, 'stories_post is in the catalogue';
  assert (select sort from public._permission_catalog() where key = 'stories_post') = 67, 'sorted just after the photo permissions';
  assert (select array_agg(key order by sort) from public._permission_catalog() where key in ('gallery_manage', 'photos_moderate', 'stories_post', 'analytics'))
         = array['gallery_manage', 'photos_moderate', 'stories_post', 'analytics'], 'stories_post follows photos_moderate in the list';
  assert (select grp from public._permission_catalog() where key = 'stories_post') = 'Stories', 'in the Stories group';
  assert (select permissions @> array['stories_post'] from public.admin_role_templates where key = 'communications'), 'the Communications role carries it';
  assert (select permissions @> array['stories_post'] from public.admin_role_templates where key = 'content_manager'), 'so does the Content manager role';
  assert public._expand_permissions(array['stories_post', 'photos_moderate', 'nonsense']) = array['photos_moderate', 'stories_post'], 'it expands like any permission';
  assert not exists (select 1 from public.admin_role_templates t, unnest(t.permissions) k where k not like '%*' and k not in (select key from public._permission_catalog())), 'templates only name real permissions';
  assert (select count(*) from public.admin_role_templates where permissions @> array['stories_post'] or 'stories_*' = any (permissions)) >= 2, 'at least two roles can post';
end $$;

-- ---------------------------------------------------------------- posting rules
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  u constant uuid := '81000000-0000-0000-0000-0000000000f1'; s constant uuid := '81000000-0000-0000-0000-0000000000a5';
  o constant uuid := '81000000-0000-0000-0000-0000000000a6'; e text; bad text;
begin
  -- an unverified person cannot post; anon cannot even call it
  assert pg_temp.exec(u, $q$select public.create_story('{"kind":"text","text_body":"hi","audience":"all"}'::jsonb)$q$) like '42501%', 'unverified cannot post';
  assert pg_temp.exec(null, $q$select public.create_story('{"kind":"text","text_body":"hi"}'::jsonb)$q$) like '42501%', 'anon cannot post';
  -- a member: text, photo; audience defaults to connections
  assert pg_temp.exec(a, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005a1","kind":"text","text_body":"Namaste <b>JEC</b>","bg_key":"teal","caption":"  hello  "}'::jsonb)$q$) is null, 'a member posts a text card';
  assert (select audience = 'connections' and caption = 'hello' and text_body = 'Namaste <b>JEC</b>' and not is_official and expires_at > now() + interval '23 hours' and expires_at <= now() + interval '24 hours 1 minute'
            from public.stories where id = '81000000-0000-0000-0000-0000000005a1'), 'defaults: connections, trimmed caption, text kept as plain text, expires in 24 h';
  assert pg_temp.exec(a, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005a2","kind":"photo","audience":"all","media_path":"81000000-0000-0000-0000-0000000000a1/p1-main.webp","thumb_path":"81000000-0000-0000-0000-0000000000a1/p1-thumb.webp"}'::jsonb)$q$) is null, 'a member posts a photo for everyone';
  -- files must be the poster's own and exist
  assert pg_temp.exec(c, $q$select public.create_story('{"kind":"photo","media_path":"81000000-0000-0000-0000-0000000000a1/p1-main.webp","thumb_path":"81000000-0000-0000-0000-0000000000a1/p1-thumb.webp"}'::jsonb)$q$) like 'P0001|stories.errFile%', 'someone else''s files cannot be used';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"photo","media_path":"81000000-0000-0000-0000-0000000000a1/nope.webp","thumb_path":"81000000-0000-0000-0000-0000000000a1/p1-thumb.webp"}'::jsonb)$q$) like 'P0001|stories.errFile%', 'a missing file is refused';
  -- text card limits and bad audience
  assert pg_temp.exec(a, $q$select public.create_story(jsonb_build_object('kind','text','text_body',repeat('x',281)))$q$) like 'P0001|stories.errText%', 'text over 280 characters refused';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"text","text_body":"   "}'::jsonb)$q$) like 'P0001|stories.errText%', 'empty text refused';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"text","text_body":"x","audience":"event"}'::jsonb)$q$) like 'P0001|stories.errAudience%', 'a member cannot pick an event audience';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"nope","text_body":"x"}'::jsonb)$q$) like 'P0001|stories.errKind%', 'unknown kind';
  -- video rules: format, size, length, impossible claims
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"video","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/x-flv","size_bytes":1000000,"duration_ms":5000}'::jsonb)$q$) like 'P0001|stories.errVideoFormat%', 'video format';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"video","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/mp4","size_bytes":41943041,"duration_ms":5000}'::jsonb)$q$) like 'P0001|stories.errVideoBig%', 'video over 40 MB';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"video","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/mp4","size_bytes":1000000,"duration_ms":61000}'::jsonb)$q$) like 'P0001|stories.errVideoLong%', 'video over 60 s';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"video","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/mp4","size_bytes":1000000}'::jsonb)$q$) like 'P0001|stories.errVideoLength%', 'a video must claim a length';
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"video","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/mp4","size_bytes":40000000,"duration_ms":1000}'::jsonb)$q$) like 'P0001|stories.errVideoLength%', 'an impossible bitrate is refused';
  assert pg_temp.exec(a, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005a3","kind":"video","audience":"all","thumb_path":"81000000-0000-0000-0000-0000000000a1/v1-poster.webp","mime_type":"video/mp4","size_bytes":8000000,"duration_ms":30000}'::jsonb)$q$) is null, 'a good video row is saved (waiting for Drive)';
  assert (select not is_ready and drive_file_id is null from public.stories where id = '81000000-0000-0000-0000-0000000005a3'), 'a video is not ready until Drive has it';
  -- links: official only, https only, plain addresses
  assert pg_temp.exec(a, $q$select public.create_story('{"kind":"text","text_body":"x","link_url":"https://example.org/a"}'::jsonb)$q$) like 'P0001|stories.errLinkOfficial%', 'a member cannot add a link';
  assert pg_temp.exec(c, $q$select public.create_story('{"kind":"text","text_body":"x","official":true}'::jsonb)$q$) like '42501%', 'a member cannot post official';
  assert pg_temp.exec(o, $q$select public.create_story('{"kind":"text","text_body":"x","official":true}'::jsonb)$q$) like '42501%', 'an admin without stories_post cannot post official';
  assert pg_temp.exec(s, $q$select public.create_story('{"kind":"text","text_body":"x","official":true,"audience":"connections"}'::jsonb)$q$) like 'P0001|stories.errAudience%', 'official stories have no connections audience';
  assert pg_temp.exec(s, $q$select public.create_story('{"kind":"text","text_body":"x","official":true,"audience":"event"}'::jsonb)$q$) like 'P0001|stories.errEvent%', 'an event audience needs an event';
  assert pg_temp.exec(s, $q$select public.create_story('{"kind":"text","text_body":"x","official":true,"audience":"group"}'::jsonb)$q$) like 'P0001|stories.errGroup%', 'a group audience needs a group';
  foreach bad in array array['javascript:alert(1)', 'http://example.org/a', 'https://user:pw@example.org/a', 'https://exa mple.org/a', 'data:text/html,x',
      'https://example.org/<script>', 'https://example.org/a"b', 'ftp://example.org/a', 'https:/example.org', 'https://', 'https://-bad.org/', '//example.org/a',
      'https://example.org/' || repeat('a', 500)] loop
    e := pg_temp.exec(s, format($q$select public.create_story(jsonb_build_object('kind','text','text_body','x','official',true,'link_url',%L))$q$, bad));
    assert e like 'P0001|stories.errLink%', 'malicious link accepted: ' || bad || ' -> ' || coalesce(e, 'ok');
  end loop;
  -- the table itself also refuses them, even to the database owner
  begin
    insert into public.stories (owner_id, is_official, kind, audience, text_body, bg_key, link_url) values ('81000000-0000-0000-0000-0000000000a5', true, 'text', 'all', 'x', 'teal', 'javascript:alert(1)');
    assert false, 'table accepted a javascript link';
  exception when check_violation then null; end;
  assert pg_temp.exec(s, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005b1","kind":"text","text_body":"Reunion is on!","bg_key":"amber","official":true,"audience":"all","link_url":"https://jecjabalpur.ac.in/news?id=1","link_label":"Read more"}'::jsonb)$q$) is null, 'an official story with a good link';
  assert (select link_url = 'https://jecjabalpur.ac.in/news?id=1' and is_official from public.stories where id = '81000000-0000-0000-0000-0000000005b1'), 'saved';
  -- members cannot write the tables directly
  assert pg_temp.exec(a, $q$insert into public.stories (owner_id, kind, text_body, bg_key) values (auth.uid(), 'text', 'x', 'teal')$q$) like '42501%', 'no direct insert';
  assert pg_temp.exec(a, $q$update public.stories set expires_at = now() + interval '30 days'$q$) like '42501%', 'no direct update (expiry cannot be stretched)';
  assert pg_temp.exec(a, $q$delete from public.stories$q$) like '42501%', 'no direct delete';
  assert pg_temp.exec(a, $q$insert into public.story_views (story_id, viewer_id) values ('81000000-0000-0000-0000-0000000005a1', auth.uid())$q$) like '42501%', 'no direct view insert';
  assert pg_temp.exec(a, $q$insert into public.story_hearts (story_id, user_id) values ('81000000-0000-0000-0000-0000000005a1', auth.uid())$q$) like '42501%', 'no direct heart insert';
  assert pg_temp.exec(a, $q$insert into public.story_highlights (owner_id, title) values (auth.uid(), 'x')$q$) like '42501%', 'no direct highlight insert';
end $$;

-- ---------------------------------------------------------------- who sees what
-- more stories: official for the event, official for the group; the rejected owner's; a connections-only one
select pg_temp.exec('81000000-0000-0000-0000-0000000000a5', $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005b2","kind":"text","text_body":"Registered people only","official":true,"audience":"event","event_id":"81000000-0000-0000-0000-0000000000ee"}'::jsonb)$q$);
select pg_temp.exec('81000000-0000-0000-0000-0000000000a5', $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005b3","kind":"text","text_body":"Circle only","official":true,"audience":"group","group_id":"81000000-0000-0000-0000-0000000000f2"}'::jsonb)$q$);
select pg_temp.exec('81000000-0000-0000-0000-0000000000a1', $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005a4","kind":"text","text_body":"Friends only","audience":"connections"}'::jsonb)$q$);
select pg_temp.exec('81000000-0000-0000-0000-000000000011', $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005c1","kind":"text","text_body":"From the rejected one","audience":"all"}'::jsonb)$q$);
update public.profiles set verification = 'rejected' where id = '81000000-0000-0000-0000-000000000011';

create function pg_temp.sees(p_uid uuid, p_story uuid) returns boolean language sql as $$
  select pg_temp.n(p_uid, format('select 1 from public.stories where id = %L', p_story)) = 1;
$$;
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; b constant uuid := '81000000-0000-0000-0000-0000000000b1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  d constant uuid := '81000000-0000-0000-0000-0000000000d1'; e constant uuid := '81000000-0000-0000-0000-0000000000e1'; u constant uuid := '81000000-0000-0000-0000-0000000000f1';
  g constant uuid := '81000000-0000-0000-0000-000000000012'; v constant uuid := '81000000-0000-0000-0000-000000000013'; w constant uuid := '81000000-0000-0000-0000-000000000014';
  s constant uuid := '81000000-0000-0000-0000-0000000000a5'; o constant uuid := '81000000-0000-0000-0000-0000000000a6'; f constant uuid := '81000000-0000-0000-0000-0000000000a7';
  off_all constant uuid := '81000000-0000-0000-0000-0000000005b1'; off_ev constant uuid := '81000000-0000-0000-0000-0000000005b2'; off_gr constant uuid := '81000000-0000-0000-0000-0000000005b3';
  p_all constant uuid := '81000000-0000-0000-0000-0000000005a2'; p_con constant uuid := '81000000-0000-0000-0000-0000000005a4'; p_vid constant uuid := '81000000-0000-0000-0000-0000000005a3';
  p_rej constant uuid := '81000000-0000-0000-0000-0000000005c1'; x uuid;
begin
  -- official, everyone: every verified member (blocked or not), not the unverified, not anon
  foreach x in array array[a, b, c, d, e, g, v, w] loop assert pg_temp.sees(x, off_all), 'official-for-all visible to ' || x; end loop;
  assert not pg_temp.sees(u, off_all), 'an unverified person sees nothing';
  assert pg_temp.n(null, 'select 1 from public.stories') <= 0, 'anon reads nothing';
  -- official, one event: only registered (confirmed / under review), never someone pending payment, never a stranger
  assert pg_temp.sees(v, off_ev), 'confirmed registrant sees the event story';
  foreach x in array array[w, c, a, b, d, g, u] loop assert not pg_temp.sees(x, off_ev), 'event story hidden from ' || x; end loop;
  assert pg_temp.sees(s, off_ev) and pg_temp.sees(f, off_ev), 'story admins can read it to manage it';
  assert not pg_temp.sees(o, off_ev), 'an admin without stories_post cannot';
  update public.event_registrations set status = 'under_review' where id = '81000000-0000-0000-0000-0000000000d4';
  assert pg_temp.sees(w, off_ev), 'payment under review counts as registered';
  update public.event_registrations set status = 'cancelled' where id = '81000000-0000-0000-0000-0000000000d4';
  assert not pg_temp.sees(w, off_ev), 'a cancelled registration does not';
  -- official, one group
  assert pg_temp.sees(g, off_gr) and not pg_temp.sees(c, off_gr) and not pg_temp.sees(v, off_gr), 'group story: members only';
  -- personal, for everyone: not the person A blocked, not the person who blocked A, not unverified
  foreach x in array array[a, b, c, g] loop assert pg_temp.sees(x, p_all), 'personal-for-all visible to ' || x; end loop;
  foreach x in array array[d, e, u] loop assert not pg_temp.sees(x, p_all), 'personal-for-all hidden from blocked / unverified ' || x; end loop;
  -- personal, connections only
  assert pg_temp.sees(b, p_con) and pg_temp.sees(a, p_con), 'a connection sees a connections-only story';
  foreach x in array array[c, d, e, g, u] loop assert not pg_temp.sees(x, p_con), 'connections-only hidden from ' || x; end loop;
  assert not pg_temp.sees(s, p_con) and not pg_temp.sees(f, p_con), 'not even admins read someone''s personal story';
  -- a rejected / unverified owner's stories disappear
  assert not pg_temp.sees(c, p_rej) and not pg_temp.sees(b, p_rej), 'a rejected owner''s story is hidden';
  -- a video that has not reached Drive is for the owner only
  assert pg_temp.sees(a, p_vid) and not pg_temp.sees(c, p_vid), 'an unfinished video is private to its owner';
  update public.stories set drive_file_id = 'FAKEDRIVEFILEID0001' where id = p_vid;
  assert pg_temp.sees(c, p_vid) and not pg_temp.sees(d, p_vid), 'once in Drive it follows the audience';
  -- the media proxy asks the same function
  assert pg_temp.val(c, format($q$select drive_file_id from public.story_media_ref(%L)$q$, p_vid)) = 'FAKEDRIVEFILEID0001', 'story_media_ref answers an allowed viewer';
  assert pg_temp.val(d, format($q$select drive_file_id from public.story_media_ref(%L)$q$, p_vid)) is null, 'and nobody else (blocked)';
  assert pg_temp.val(u, format($q$select drive_file_id from public.story_media_ref(%L)$q$, p_vid)) is null, 'nor an unverified person';
  assert pg_temp.val(null, format($q$select drive_file_id from public.story_media_ref(%L)$q$, p_vid)) like 'ERR|42501%', 'anon cannot call it';
  -- an event-only VIDEO: the media proxy refuses everyone but registrants
  insert into public.stories (id, owner_id, is_official, kind, audience, event_id, thumb_path, mime_type, size_bytes, duration_ms, drive_file_id)
    values ('81000000-0000-0000-0000-0000000005b4', s, true, 'video', 'event', '81000000-0000-0000-0000-0000000000ee', '81000000-0000-0000-0000-0000000000a5/o1-thumb.webp', 'video/mp4', 5000000, 20000, 'FAKEDRIVEFILEID0002');
  assert pg_temp.val(v, $q$select drive_file_id from public.story_media_ref('81000000-0000-0000-0000-0000000005b4')$q$) = 'FAKEDRIVEFILEID0002', 'registrant gets the event video reference';
  assert pg_temp.val(c, $q$select drive_file_id from public.story_media_ref('81000000-0000-0000-0000-0000000005b4')$q$) is null, 'a stranger does not';
  assert pg_temp.val(w, $q$select drive_file_id from public.story_media_ref('81000000-0000-0000-0000-0000000005b4')$q$) is null, 'nor someone not registered';
  -- photos: the storage rule is the same rule
  insert into public.stories (id, owner_id, is_official, kind, audience, event_id, media_path, thumb_path)
    values ('81000000-0000-0000-0000-0000000005b5', s, true, 'photo', 'event', '81000000-0000-0000-0000-0000000000ee', '81000000-0000-0000-0000-0000000000a5/o1-main.webp', '81000000-0000-0000-0000-0000000000a5/o1-thumb.webp');
  assert pg_temp.val(v, $q$select public.story_path_readable('81000000-0000-0000-0000-0000000000a5/o1-main.webp')::text$q$) = 'true', 'the registrant may read the photo file';
  assert pg_temp.val(c, $q$select public.story_path_readable('81000000-0000-0000-0000-0000000000a5/o1-main.webp')::text$q$) = 'false', 'a stranger may not';
  assert pg_temp.n(v, $q$select 1 from storage.objects where bucket_id = 'stories' and name = '81000000-0000-0000-0000-0000000000a5/o1-main.webp'$q$) = 1, 'the storage policy lets the registrant see the file';
  assert pg_temp.n(c, $q$select 1 from storage.objects where bucket_id = 'stories' and name = '81000000-0000-0000-0000-0000000000a5/o1-main.webp'$q$) = 0, 'and hides it from a stranger';
  assert pg_temp.n(null, $q$select 1 from storage.objects where bucket_id = 'stories'$q$) <= 0, 'anon sees no story files';
  assert pg_temp.n(a, $q$select 1 from storage.objects where bucket_id = 'stories' and name like '81000000-0000-0000-0000-0000000000a1/%'$q$) = 3, 'an owner sees their own files';
  assert pg_temp.exec(c, $q$insert into storage.objects (bucket_id, name, owner) values ('stories', '81000000-0000-0000-0000-0000000000a1/evil.webp', auth.uid())$q$) like '42501%', 'nobody uploads into another member''s folder';
  assert pg_temp.exec(c, $q$insert into storage.objects (bucket_id, name, owner) values ('stories', '81000000-0000-0000-0000-0000000000c1/ok.webp', auth.uid())$q$) is null, 'but into their own';
  assert pg_temp.exec(u, $q$insert into storage.objects (bucket_id, name, owner) values ('stories', '81000000-0000-0000-0000-0000000000f1/ok.webp', auth.uid())$q$) like '42501%', 'an unverified person cannot upload';
  assert (select not public from storage.buckets where id = 'stories'), 'the bucket is private';
end $$;

-- ---------------------------------------------------------------- the rings on Home
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; b constant uuid := '81000000-0000-0000-0000-0000000000b1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  d constant uuid := '81000000-0000-0000-0000-0000000000d1'; v constant uuid := '81000000-0000-0000-0000-000000000013'; u constant uuid := '81000000-0000-0000-0000-0000000000f1';
  q text := 'select section || '':'' || coalesce(owner_id::text, ''official'') || '':'' || story_count || '':'' || unseen_count from public.stories_feed()';
begin
  -- B: official first, then A (connected, 3 active: text, photo, video + friends-only = a1 a2 a3 a4), C is a stranger with none
  assert pg_temp.val(b, 'select (select string_agg(section, '','' order by case section when ''official'' then 0 when ''mine'' then 1 when ''connections'' then 2 else 3 end) from public.stories_feed())') = 'official,connections',
    'B sees the official ring, then connections: ' || coalesce(pg_temp.val(b, 'select string_agg(section, '','') from public.stories_feed()'), 'none');
  assert pg_temp.val(b, 'select story_count::text from public.stories_feed() where section = ''official''') = '1', 'official story count for B (all only)';
  assert pg_temp.val(b, 'select story_count::text from public.stories_feed() where section = ''connections''') = '4', 'B sees all four active stories of A';
  assert pg_temp.val(v, 'select story_count::text from public.stories_feed() where section = ''official''') = '4', 'the registrant sees the all-story, the event text, the event video and photo: ' || coalesce(pg_temp.val(v, 'select story_count::text from public.stories_feed() where section = ''official'''), 'none');
  -- C is a stranger: A's "everyone" stories land in "More stories", the friends-only one is not counted
  assert pg_temp.val(c, 'select story_count::text from public.stories_feed() where section = ''more'' and owner_id = ''81000000-0000-0000-0000-0000000000a1''') = '2', 'a stranger sees two of A''s stories in More';
  assert pg_temp.val(c, 'select count(*)::text from public.stories_feed() where section = ''connections''') = '0', 'no connections ring for a stranger';
  assert pg_temp.val(a, 'select story_count::text from public.stories_feed() where section = ''mine''') = '4', 'my own ring';
  assert pg_temp.val(d, 'select count(*)::text from public.stories_feed() where owner_id = ''81000000-0000-0000-0000-0000000000a1''') = '0', 'the blocked person never gets A''s ring';
  assert pg_temp.val(u, 'select count(*)::text from public.stories_feed()') = '0', 'an unverified person gets no rings';
  assert pg_temp.val(null, 'select count(*)::text from public.stories_feed()') like 'ERR|42501%', 'anon cannot call stories_feed';
  assert pg_temp.val(c, 'select count(*)::text from public.stories_feed() where owner_id = ''81000000-0000-0000-0000-000000000011''') = '0', 'the rejected owner has no ring';
  -- the rings for avatars
  assert pg_temp.val(b, 'select unseen_count::text from public.story_rings(array[''81000000-0000-0000-0000-0000000000a1'']::uuid[])') = '4', 'avatar ring for a connection';
  assert pg_temp.val(c, 'select unseen_count::text from public.story_rings(array[''81000000-0000-0000-0000-0000000000a1'']::uuid[])') = '2', 'avatar ring for a stranger counts only what they may watch';
  assert pg_temp.val(d, 'select count(*)::text from public.story_rings(array[''81000000-0000-0000-0000-0000000000a1'']::uuid[])') = '0', 'no ring across a block';
  -- stories_of
  assert pg_temp.val(b, $q$select jsonb_array_length(public.stories_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$) = '4', 'stories_of for a connection';
  assert pg_temp.val(c, $q$select jsonb_array_length(public.stories_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$) = '2', 'stories_of for a stranger';
  assert pg_temp.val(d, $q$select jsonb_array_length(public.stories_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$) = '0', 'stories_of across a block';
  assert pg_temp.val(c, $q$select jsonb_array_length(public.stories_of(null, true))::text$q$) = '1', 'official stories for a stranger: just the all-story';
  assert pg_temp.val(v, $q$select (public.stories_of(null, true) -> 0 ->> 'seen')$q$) = 'false', 'unseen to begin with';
  assert pg_temp.val(c, $q$select (public.stories_of(null, true) -> 0 ->> 'views')$q$) is null, 'a viewer never gets the view count';
end $$;

-- ---------------------------------------------------------------- views, hearts, mute: one each, owner sees the counts
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; b constant uuid := '81000000-0000-0000-0000-0000000000b1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  d constant uuid := '81000000-0000-0000-0000-0000000000d1'; s constant uuid := '81000000-0000-0000-0000-0000000000a5'; v constant uuid := '81000000-0000-0000-0000-000000000013';
  st constant uuid := '81000000-0000-0000-0000-0000000005a2';
begin
  assert pg_temp.exec(b, format('select public.mark_story_seen(%L)', st)) is null, 'B watches';
  assert pg_temp.exec(b, format('select public.mark_story_seen(%L)', st)) is null, 'B watches again';
  assert pg_temp.exec(c, format('select public.mark_story_seen(%L)', st)) is null, 'C watches';
  assert pg_temp.exec(a, format('select public.mark_story_seen(%L)', st)) is null, 'the owner watching is not counted';
  assert pg_temp.exec(d, format('select public.mark_story_seen(%L)', st)) is null, 'a blocked person is silently ignored';
  assert (select count(*) from public.story_views where story_id = st) = 2, 'one view per person (B, C), none for the owner or the blocked';
  assert pg_temp.val(b, format($q$select (public.stories_of('81000000-0000-0000-0000-0000000000a1', false) -> 1 ->> 'seen')$q$)) is not null, 'B has a seen flag';
  assert pg_temp.val(b, 'select unseen_count::text from public.stories_feed() where section = ''connections''') = '3', 'one story moved to seen in the ring';
  assert pg_temp.val(a, format('select views::text from jsonb_to_recordset(public.my_stories()) as x(id uuid, views int) where id = %L', st)) = '2', 'the owner sees 2 views';
  -- hearts: one per person, toggles, not on your own story
  assert pg_temp.val(b, format($q$select public.toggle_story_heart(%L)::text$q$, st)) like '%"hearted": true%', 'heart on';
  assert pg_temp.val(c, format($q$select public.toggle_story_heart(%L)::text$q$, st)) like '%"hearted": true%', 'a second person hearts';
  assert pg_temp.val(b, format($q$select public.toggle_story_heart(%L)::text$q$, st)) like '%"hearted": false%', 'heart off';
  assert pg_temp.val(b, format($q$select public.toggle_story_heart(%L)::text$q$, st)) like '%"hearted": true%', 'and on again';
  assert (select count(*) from public.story_hearts where story_id = st) = 2, 'one heart per person';
  assert pg_temp.exec(a, format('select public.toggle_story_heart(%L)', st)) like 'P0001|stories.errOwnHeart%', 'no heart on your own story';
  assert pg_temp.exec(d, format('select public.toggle_story_heart(%L)', st)) like '42501%', 'no heart across a block';
  assert pg_temp.val(a, format('select hearts::text from jsonb_to_recordset(public.my_stories()) as x(id uuid, hearts int) where id = %L', st)) = '2', 'the owner sees 2 hearts';
  begin
    insert into public.story_views (story_id, viewer_id) values (st, '81000000-0000-0000-0000-0000000000b1');
    assert false, 'duplicate view accepted';
  exception when unique_violation then null; end;
  -- the viewer list: owner only (and official admins for official stories)
  assert pg_temp.val(a, format('select count(*)::text from public.story_viewers(%L)', st)) = '2', 'the owner lists the viewers';
  assert pg_temp.val(b, format('select count(*)::text from public.story_viewers(%L)', st)) like 'ERR|42501%', 'a viewer cannot';
  assert pg_temp.exec(c, $q$select public.mark_story_seen('81000000-0000-0000-0000-0000000005b1')$q$) is null and pg_temp.exec(v, $q$select public.mark_story_seen('81000000-0000-0000-0000-0000000005b1')$q$) is null, 'two members watch the official story';
  assert pg_temp.val(s, $q$select count(*)::text from public.story_viewers('81000000-0000-0000-0000-0000000005b1')$q$) = '2', 'a stories_post admin sees who watched an official story';
  assert pg_temp.val(c, $q$select count(*)::text from public.story_viewers('81000000-0000-0000-0000-0000000005b1')$q$) like 'ERR|42501%', 'a member cannot';
  assert pg_temp.val(s, $q$select views::text from jsonb_to_recordset(public.admin_story_list('all')) as x(id uuid, views int) where id = '81000000-0000-0000-0000-0000000005b1'$q$) = '2', 'the admin list carries the counts';
  -- mute: hidden from the ring, still reachable from the profile; unmute brings it back
  assert pg_temp.exec(c, $q$select public.mute_story_owner('81000000-0000-0000-0000-0000000000a1', true)$q$) is null, 'C mutes A';
  assert pg_temp.val(c, 'select count(*)::text from public.stories_feed() where owner_id = ''81000000-0000-0000-0000-0000000000a1''') = '0', 'muted: no ring';
  assert pg_temp.val(c, $q$select jsonb_array_length(public.stories_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$) = '2', 'but their profile still opens the stories';
  assert pg_temp.val(c, 'select count(*)::text from public.my_story_mutes()') = '1', 'listed under muted people';
  assert pg_temp.exec(c, $q$select public.mute_story_owner('81000000-0000-0000-0000-0000000000a1', false)$q$) is null, 'unmute';
  assert pg_temp.val(c, 'select count(*)::text from public.stories_feed() where owner_id = ''81000000-0000-0000-0000-0000000000a1''') = '1', 'back in the row';
  assert pg_temp.exec(c, $q$select public.mute_story_owner('81000000-0000-0000-0000-000000000015', true)$q$) is null and pg_temp.exec(c, $q$select public.mute_story_owner('81000000-0000-0000-0000-000000000015', false)$q$) is null, 'muting someone else works too';
  assert pg_temp.exec(c, $q$select public.mute_story_owner('81000000-0000-0000-0000-0000000000c1', true)$q$) like 'P0001%', 'you cannot mute yourself';
end $$;

-- ---------------------------------------------------------------- expiry, moderation, owner-only delete
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; b constant uuid := '81000000-0000-0000-0000-0000000000b1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  s constant uuid := '81000000-0000-0000-0000-0000000000a5'; o constant uuid := '81000000-0000-0000-0000-0000000000a6'; f constant uuid := '81000000-0000-0000-0000-0000000000a7';
  m constant uuid := '81000000-0000-0000-0000-000000000015';
  sid uuid;
begin
  -- a story that has expired vanishes from every read (no job needed)
  assert pg_temp.exec(m, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005e1","kind":"text","text_body":"short lived","audience":"all"}'::jsonb)$q$) is null;
  assert pg_temp.sees(b, '81000000-0000-0000-0000-0000000005e1'), 'visible while active';
  update public.stories set expires_at = now() - interval '1 minute' where id = '81000000-0000-0000-0000-0000000005e1';
  assert not pg_temp.sees(b, '81000000-0000-0000-0000-0000000005e1'), 'gone after 24 h for everyone else';
  assert pg_temp.val(b, 'select count(*)::text from public.stories_feed() where owner_id = ''81000000-0000-0000-0000-000000000015''') = '0', 'no ring';
  assert pg_temp.exec(b, $q$select public.toggle_story_heart('81000000-0000-0000-0000-0000000005e1')$q$) like '42501%', 'no heart on an expired story';
  assert pg_temp.sees(m, '81000000-0000-0000-0000-0000000005e1'), 'the owner still has it (to save it into a highlight)';
  assert pg_temp.val(m, $q$select count(*)::text from jsonb_array_elements(public.my_stories()) x where x ->> 'id' = '81000000-0000-0000-0000-0000000005e1'$q$) = '1', 'in my archive';
  -- reports: own refused, needs a reason, three reports hide it
  assert pg_temp.exec(a, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'spam spam')$q$) like 'P0001%', 'cannot report your own story';
  assert pg_temp.exec(b, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'x')$q$) like 'P0001|stories.errReason%', 'a reason is needed';
  assert pg_temp.exec(b, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'looks like spam')$q$) is null, 'B reports';
  assert pg_temp.exec(b, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'looks like spam')$q$) is null, 'a repeat from the same person is ignored';
  assert (select count(*) from public.reports where target_type = 'story' and target_id = '81000000-0000-0000-0000-0000000005a2') = 1, 'one report per person';
  assert pg_temp.exec(c, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'looks like spam')$q$) is null;
  assert pg_temp.exec(m, $q$select public.report_story('81000000-0000-0000-0000-0000000005a2', 'looks like spam')$q$) is null;
  assert (select is_hidden from public.stories where id = '81000000-0000-0000-0000-0000000005a2'), 'three reports hide the story';
  assert not pg_temp.sees(c, '81000000-0000-0000-0000-0000000005a2') and pg_temp.sees(a, '81000000-0000-0000-0000-0000000005a2'), 'hidden from others, still the owner''s';
  assert pg_temp.exec(m, $q$select public.report_story('81000000-0000-0000-0000-0000000005a4', 'not for me')$q$) like '42501%', 'cannot report what you cannot see';
  -- the moderation queue knows stories
  insert into public.site_roles (user_id, role) values ('81000000-0000-0000-0000-0000000000a6', 'moderator');
  assert pg_temp.val(o, $q$select count(*)::text from public.admin_reports('open') where target_type = 'story' and removed$q$) = '1', 'the report queue lists the hidden story';
  assert pg_temp.exec(o, $q$select public.moderate('story', '81000000-0000-0000-0000-0000000005a2', false, 'actioned')$q$) is null, 'a moderator restores it';
  assert (select not is_hidden from public.stories where id = '81000000-0000-0000-0000-0000000005a2'), 'restored';
  update public.stories set is_hidden = true where id = '81000000-0000-0000-0000-0000000005a2';
  delete from public.site_roles where user_id = '81000000-0000-0000-0000-0000000000a6';
  -- delete: owner only; official ones by a stories_post admin
  assert pg_temp.exec(b, $q$select public.delete_story('81000000-0000-0000-0000-0000000005a4')$q$) like '42501%', 'a friend cannot delete it';
  assert pg_temp.exec(c, $q$select public.delete_story('81000000-0000-0000-0000-0000000005b1')$q$) like '42501%', 'a member cannot delete an official story';
  assert pg_temp.exec(o, $q$select public.delete_story('81000000-0000-0000-0000-0000000005b1')$q$) like '42501%', 'an admin without stories_post cannot';
  assert pg_temp.exec(s, $q$select public.delete_story('81000000-0000-0000-0000-0000000005a4')$q$) like '42501%', 'a story admin cannot delete a personal story';
  assert pg_temp.exec(a, $q$select public.delete_story('81000000-0000-0000-0000-0000000005a4')$q$) is null, 'the owner deletes any time';
  assert not exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005a4'), 'it is gone';
  assert pg_temp.val(s, $q$select array_length(public.delete_story('81000000-0000-0000-0000-0000000005b5'), 1)::text$q$) = '2', 'a story admin deletes an official story and gets the files to remove';
  assert (select count(*) from public.admin_audit where action in ('story_post', 'story_delete')) >= 3, 'official posts and deletes are in the activity log';
end $$;

-- ---------------------------------------------------------------- the rate limit: 20 a day
do $$
declare
  m constant uuid := '81000000-0000-0000-0000-000000000015'; i int; e text;
begin
  -- m has one (expired) story already from above; 19 more fit
  for i in 1..19 loop
    e := pg_temp.exec(m, format($q$select public.create_story('{"kind":"text","text_body":"story %s","audience":"all"}'::jsonb)$q$, i));
    assert e is null, 'story ' || i || ' should fit: ' || coalesce(e, '');
  end loop;
  e := pg_temp.exec(m, $q$select public.create_story('{"kind":"text","text_body":"one too many","audience":"all"}'::jsonb)$q$);
  assert e like 'P0001|stories.errRate%', 'the 21st story in a day is refused: ' || coalesce(e, 'accepted');
  update public.stories set created_at = now() - interval '25 hours' where owner_id = m and text_body = 'story 1';
  assert pg_temp.exec(m, $q$select public.create_story('{"kind":"text","text_body":"after a day","audience":"all"}'::jsonb)$q$) is null, 'the limit is a rolling day';
  assert pg_temp.exec('81000000-0000-0000-0000-0000000000a5', $q$select public.create_story('{"kind":"text","text_body":"official ones have a much higher limit","official":true,"audience":"all"}'::jsonb)$q$) is null, 'official posts are not held to 20';
end $$;

-- ---------------------------------------------------------------- highlights outlive the story
do $$
declare
  a constant uuid := '81000000-0000-0000-0000-0000000000a1'; b constant uuid := '81000000-0000-0000-0000-0000000000b1'; c constant uuid := '81000000-0000-0000-0000-0000000000c1';
  d constant uuid := '81000000-0000-0000-0000-0000000000d1'; v constant uuid := '81000000-0000-0000-0000-000000000013'; s constant uuid := '81000000-0000-0000-0000-0000000000a5';
  o constant uuid := '81000000-0000-0000-0000-0000000000a6'; w constant uuid := '81000000-0000-0000-0000-000000000014'; g constant uuid := '81000000-0000-0000-0000-000000000012';
  h uuid; ho uuid; n int; paths jsonb;
begin
  -- A: a connections-only story and an everyone story, both expired
  perform pg_temp.exec(a, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005d1","kind":"text","text_body":"old friends","audience":"connections"}'::jsonb)$q$);
  perform pg_temp.exec(a, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005d2","kind":"text","text_body":"old public","audience":"all"}'::jsonb)$q$);
  update public.stories set expires_at = now() - interval '3 days' where id in ('81000000-0000-0000-0000-0000000005d1', '81000000-0000-0000-0000-0000000005d2');
  h := pg_temp.val(a, $q$select public.save_highlight(null, '  Campus days  ')::text$q$)::uuid;
  assert (select title from public.story_highlights where id = h) = 'Campus days', 'created and trimmed';
  assert pg_temp.exec(a, $q$select public.save_highlight(null, '')$q$) like 'P0001|stories.errTitle%', 'a name is needed';
  assert pg_temp.exec(a, format($q$select public.add_story_to_highlight(%L, '81000000-0000-0000-0000-0000000005d1')$q$, h)) is null, 'add the friends-only story';
  assert pg_temp.exec(c, format($q$select public.add_story_to_highlight(%L, '81000000-0000-0000-0000-0000000005d2')$q$, h)) like '42501%', 'only the owner adds to it';
  assert pg_temp.exec(a, format($q$select public.add_story_to_highlight(%L, '81000000-0000-0000-0000-0000000005b1')$q$, h)) like 'P0001%', 'and only their own stories';
  -- inherit: the most restricted item decides
  assert pg_temp.val(b, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '1', 'a connection sees the highlight';
  assert pg_temp.val(c, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '0', 'a stranger does not (connections-only item)';
  assert pg_temp.val(b, format($q$select jsonb_array_length(public.highlight_stories(%L) -> 'stories')::text$q$, h)) = '1', 'an expired story still plays from a highlight';
  assert pg_temp.val(c, format($q$select public.highlight_stories(%L)::text$q$, h)) like 'ERR|42501%', 'a stranger cannot open it by id';
  assert pg_temp.sees(b, '81000000-0000-0000-0000-0000000005d1') and not pg_temp.sees(c, '81000000-0000-0000-0000-0000000005d1'), 'the story row follows the highlight: the connection can read the expired story, the stranger cannot';
  -- mixed items: still the strictest
  perform pg_temp.exec(a, format($q$select public.add_story_to_highlight(%L, '81000000-0000-0000-0000-0000000005d2')$q$, h));
  assert pg_temp.val(c, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '0', 'one restricted item keeps the whole highlight restricted';
  -- the owner explicitly re-shares: everyone
  assert pg_temp.exec(a, format($q$select public.save_highlight(%L, 'Campus days', 'all')$q$, h)) is null, 're-share with everyone';
  assert pg_temp.val(c, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '1', 'a stranger sees it now';
  assert pg_temp.val(c, format($q$select jsonb_array_length(public.highlight_stories(%L) -> 'stories')::text$q$, h)) = '2', 'and both stories';
  assert pg_temp.sees(c, '81000000-0000-0000-0000-0000000005d1'), 'its media is readable too';
  assert pg_temp.val(d, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '0', 'still not across a block';
  assert pg_temp.val('81000000-0000-0000-0000-0000000000f1', format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '0', 'nor for an unverified person';
  -- connections: re-shared with connections only
  assert pg_temp.exec(a, format($q$select public.save_highlight(%L, 'Campus days', 'connections')$q$, h)) is null;
  assert pg_temp.val(b, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '1' and
         pg_temp.val(c, format($q$select jsonb_array_length(public.highlights_of('81000000-0000-0000-0000-0000000000a1', false))::text$q$)) = '0', 'connections only';
  -- cover, rename, reorder, remove an item
  assert pg_temp.exec(a, format($q$select public.save_highlight(%L, 'Campus days 2', 'all', '81000000-0000-0000-0000-0000000005d2')$q$, h)) is null, 'choose a cover';
  assert pg_temp.exec(a, format($q$select public.save_highlight(%L, 'x', 'all', '81000000-0000-0000-0000-0000000005a1')$q$, h)) like 'P0001|stories.errCover%', 'the cover must be one of its stories';
  assert pg_temp.exec(a, format($q$select public.set_highlight_items(%L, array['81000000-0000-0000-0000-0000000005d1']::uuid[])$q$, h)) is null, 'replace the items';
  assert (select cover_story_id is null from public.story_highlights where id = h), 'a removed story stops being the cover';
  -- cleanup: the story in a highlight stays; the loose expired one goes
  update public.stories set expires_at = now() - interval '10 days' where id in ('81000000-0000-0000-0000-0000000005e1', '81000000-0000-0000-0000-0000000005d1', '81000000-0000-0000-0000-0000000005d2');
  assert public.stories_cleanup() >= 2, 'cleanup removes old stories';
  assert exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005d1'), 'the story in a highlight is kept';
  assert not exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005d2'), 'the loose expired story is gone';
  assert not exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005e1'), 'so is the other loose one';
  assert public.stories_cleanup() = 0, 'running it again changes nothing';
  assert pg_temp.val(a, format($q$select jsonb_array_length(public.highlight_stories(%L) -> 'stories')::text$q$, h)) = '1', 'the highlight still works after cleanup';
  assert pg_temp.exec(b, $q$select public.stories_cleanup()$q$) like '42501%', 'members cannot run the cleanup';
  assert pg_temp.exec(s, $q$select public.stories_cleanup()$q$) like '42501%', 'nor admins directly';
  -- an unfinished video older than a day goes too, a highlight does not save it from being "not ready" only if unused
  update public.stories set created_at = now() - interval '2 days' where id = '81000000-0000-0000-0000-0000000005a3';
  update public.stories set drive_file_id = null where id = '81000000-0000-0000-0000-0000000005a3';
  n := public.stories_cleanup();
  assert n >= 1 and not exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005a3'), 'a video that never reached Drive is cleaned up';
  assert exists (select 1 from private.story_trash), 'the files of removed stories are queued for removal';
  -- delete a highlight: only mine; the stories stay
  assert pg_temp.exec(c, format($q$select public.delete_highlight(%L)$q$, h)) like '42501%', 'not someone else''s';
  assert pg_temp.exec(a, format($q$select public.delete_highlight(%L)$q$, h)) is null, 'mine';
  assert exists (select 1 from public.stories where id = '81000000-0000-0000-0000-0000000005d1'), 'deleting a highlight keeps the story';
  -- limit: 20 highlights
  for n in 1..20 loop perform pg_temp.exec(a, format($q$select public.save_highlight(null, 'H%s')$q$, n)); end loop;
  assert pg_temp.exec(a, $q$select public.save_highlight(null, 'one more')$q$) like 'P0001|stories.errHighlightMax%', 'at most 20 highlights';
  assert pg_temp.exec(a, $q$select public.reorder_highlights((select array_agg(id order by title desc) from public.story_highlights where owner_id = auth.uid()))$q$) is null, 'reorder';

  -- OFFICIAL highlights: event-only items keep their rule, or are made public to verified members
  perform pg_temp.exec(s, $q$select public.create_story('{"id":"81000000-0000-0000-0000-0000000005f1","kind":"text","text_body":"Reunion 2025 memories","official":true,"audience":"event","event_id":"81000000-0000-0000-0000-0000000000ee"}'::jsonb)$q$);
  update public.stories set expires_at = now() - interval '2 days' where id = '81000000-0000-0000-0000-0000000005f1';
  assert pg_temp.exec(a, $q$select public.admin_highlight_save(null, 'Reunion 2025')$q$) like '42501%', 'a member cannot make official highlights';
  assert pg_temp.exec(o, $q$select public.admin_highlight_save(null, 'Reunion 2025')$q$) like '42501%', 'nor an admin without stories_post';
  ho := pg_temp.val(s, $q$select public.admin_highlight_save(null, 'Reunion 2025', 'inherit')::text$q$)::uuid;
  assert pg_temp.exec(s, format($q$select public.admin_highlight_items(%L, array['81000000-0000-0000-0000-0000000005f1']::uuid[])$q$, ho)) is null, 'add the event-only story';
  assert pg_temp.exec(s, format($q$select public.admin_highlight_items(%L, array['81000000-0000-0000-0000-0000000005a1']::uuid[])$q$, ho)) like 'P0001%', 'a personal story cannot go into an official highlight';
  assert pg_temp.exec(s, format($q$select public.admin_highlight_save(%L, 'Reunion 2025', 'connections')$q$, ho)) like 'P0001|stories.errAudience%', 'official highlights have no connections audience';
  assert pg_temp.val(v, $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '1', 'the registrant sees the official highlight';
  assert pg_temp.val(c, $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '0', 'a stranger does not (it keeps its event rule)';
  assert pg_temp.val(w, $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '0', 'neither does someone not registered';
  assert pg_temp.val(s, $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '1', 'the admin sees it to manage it';
  assert pg_temp.exec(s, format($q$select public.admin_highlight_save(%L, 'Reunion 2025', 'all')$q$, ho)) is null, 'set to public-to-verified';
  assert pg_temp.val(c, $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '1', 'now every verified member sees it';
  assert pg_temp.val(c, format($q$select jsonb_array_length(public.highlight_stories(%L) -> 'stories')::text$q$, ho)) = '1', 'and can play it';
  assert pg_temp.val('81000000-0000-0000-0000-0000000000f1', $q$select jsonb_array_length(public.highlights_of(null, true))::text$q$) = '0', 'but not an unverified person';
  assert pg_temp.exec(s, $q$select public.add_story_to_highlight((select id from public.story_highlights where is_official limit 1), '81000000-0000-0000-0000-0000000005b1')$q$) is null, 'add_story_to_highlight works for official ones';
  assert pg_temp.exec(c, $q$select public.add_story_to_highlight((select id from public.story_highlights where is_official limit 1), '81000000-0000-0000-0000-0000000005b1')$q$) like '42501%', 'but not for members';
  assert pg_temp.exec(s, $q$select public.admin_highlight_items(gen_random_uuid(), array[]::uuid[])$q$) like 'P0001%', 'an unknown highlight is a plain error, not a permission one';
  assert pg_temp.exec(s, format($q$select public.admin_highlight_reorder(array[%L]::uuid[])$q$, ho)) is null, 'reorder';
  paths := pg_temp.val(s, $q$select public.admin_stories_cleanup()::text$q$)::jsonb;
  assert paths ? 'paths' and (paths ->> 'deleted') is not null, 'the admin cleanup returns the files to remove';
  assert pg_temp.exec(c, $q$select public.admin_stories_cleanup()$q$) like '42501%', 'not for members';
  assert pg_temp.exec(s, format($q$select public.admin_highlight_delete(%L)$q$, ho)) is null, 'delete the official highlight';
  assert pg_temp.exec(a, format($q$select public.admin_highlight_delete(%L)$q$, ho)) like '42501%', 'members cannot';
  assert (select count(*) from public.admin_audit where action like 'highlight_%' or action = 'stories_cleanup') >= 5, 'highlight work is in the activity log';
end $$;

-- ---------------------------------------------------------------- the admin list, the audience count, the notification limit
do $$
declare
  s constant uuid := '81000000-0000-0000-0000-0000000000a5'; c constant uuid := '81000000-0000-0000-0000-0000000000c1'; o constant uuid := '81000000-0000-0000-0000-0000000000a6';
  v constant uuid := '81000000-0000-0000-0000-000000000013'; n int;
begin
  assert pg_temp.val(c, $q$select admin_story_list::text from public.admin_story_list('all')$q$) like 'ERR|42501%', 'a member cannot list';
  assert pg_temp.val(o, $q$select admin_story_list::text from public.admin_story_list('all')$q$) like 'ERR|42501%', 'nor an admin without stories_post';
  assert pg_temp.val(s, $q$select jsonb_array_length(public.admin_story_list('active'))::text$q$)::int >= 3, 'the story admin lists the active official stories';
  assert pg_temp.val(s, $q$select count(*)::text from jsonb_array_elements(public.admin_story_list('expired')) x where (x ->> 'is_official')::boolean = false$q$) = '0', 'only official stories are listed';
  assert pg_temp.val(s, $q$select public.admin_story_audience_count('event', '81000000-0000-0000-0000-0000000000ee', null)::text$q$) = '1', 'one person is registered (the payment-pending one was cancelled)';
  assert pg_temp.val(s, $q$select public.admin_story_audience_count('group', null, '81000000-0000-0000-0000-0000000000f2')::text$q$) = '1', 'one group member';
  assert pg_temp.val(s, $q$select (public.admin_story_audience_count('all') >= 8)::text$q$) = 'true', 'many for everyone';
  assert pg_temp.val(c, $q$select public.admin_story_audience_count('all')::text$q$) like 'ERR|42501%', 'members cannot ask';
  -- notify: only the people who can see it; once per story; one blast an hour
  n := pg_temp.val(s, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005b2')::text$q$)::int;
  assert n = 1, 'only the registered person is told about the event story: ' || n;
  assert (select count(*) from public.notifications where kind = 'story' and target_id = '81000000-0000-0000-0000-0000000005b2' and user_id = v) = 1, 'a notification row exists for them';
  assert not exists (select 1 from public.notifications where kind = 'story' and user_id = '81000000-0000-0000-0000-0000000000c1'), 'and for nobody else';
  assert pg_temp.exec(s, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005b2')$q$) like 'P0001|stories.errNotified%', 'not twice for one story';
  assert pg_temp.exec(s, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005b1')$q$) like 'P0001|stories.errNotify%', 'one blast an hour';
  update public.stories set notified_at = now() - interval '2 hours' where id = '81000000-0000-0000-0000-0000000005b2';
  assert pg_temp.exec(s, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005b1')$q$) is null, 'allowed again an hour later';
  assert pg_temp.exec(c, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005b1')$q$) like '42501%', 'members cannot';
  assert pg_temp.exec(s, $q$select public.admin_story_notify('81000000-0000-0000-0000-0000000005a2')$q$) like 'P0001%', 'only official stories';
end $$;

-- ---------------------------------------------------------------- every function is locked to the right callers
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%story%' or p.proname like '%stories%' or p.proname like '%highlight%')
     and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, 'anon can execute: ' || coalesce(bad, '');
  select string_agg(p.proname, ', ') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace
     and (p.proname like '\_story%' or p.proname like '\_highlight%') and has_function_privilege('authenticated', p.oid, 'execute');
  assert bad is null, 'members can execute internal helpers: ' || coalesce(bad, '');
  select string_agg(p.proname, ', ') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and (p.proname like '%story%' or p.proname like '%stories%' or p.proname like '%highlight%') and not ('search_path=""' = any (coalesce(p.proconfig, '{}')));
  assert bad is null, 'story functions without search_path: ' || coalesce(bad, '');
  assert not has_function_privilege('authenticated', 'public.stories_cleanup(interval)', 'execute'), 'members cannot run the cleanup directly';
  assert not has_table_privilege('authenticated', 'public.stories', 'INSERT') and not has_table_privilege('authenticated', 'public.stories', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.stories', 'DELETE'), 'stories are not writable through the API';
  assert not has_table_privilege('anon', 'public.stories', 'SELECT'), 'anon cannot select stories';
  assert (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'stor%' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'row security is on';
  assert 'stories' = any (array(select key from (select unnest(array['gallery', 'glimpses', 'stories']) key) x)), 'sanity';
  insert into public.drive_roots (key, folder_id) values ('stories', 'FAKEFOLDERID000001');
end $$;
select 'ALL STORIES TESTS PASSED';
rollback;
