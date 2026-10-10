-- Glimpses (public autoplay clips) and the past-meets archive: who reads, who writes, the 4-visible rule, replace / reorder / remove, the
-- archive event and its photo setting, the draft Alumni Meet 2025 row. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function public.t96_try(q text) returns text language plpgsql as $$
declare h text;
begin execute q; return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
end $$;
grant execute on function public.t96_try(text) to authenticated, anon;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;

-- g curator (gallery_manage), l limited admin without it, 1 verified member
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-0000000000a1', 'g@g96.com', '{"full_name":"Curator"}'),
  ('96000000-0000-0000-0000-0000000000a2', 'l@g96.com', '{"full_name":"Limited"}'),
  ('96000000-0000-0000-0000-0000000000c1', 'm1@g96.com', '{"full_name":"Asha One"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001 where id::text like '96000000-%';
update public.profiles set is_admin = true where id in ('96000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000a2');
insert into public.admin_grants (user_id, permissions) values
  ('96000000-0000-0000-0000-0000000000a1', array['gallery_manage']),
  ('96000000-0000-0000-0000-0000000000a2', array['members_view']);
insert into storage.objects (bucket_id, name, owner) values
  ('glimpses', 'glimpses/a_p.webp', null), ('glimpses', 'glimpses/b_p.webp', null), ('glimpses', 'glimpses/c_p.webp', null), ('glimpses', 'glimpses/d_p.webp', null),
  ('glimpses', 'glimpses/e_p.webp', null), ('glimpses', 'glimpses/f_p.webp', null), ('gallery', 'gallery/meets/cover1.webp', null);

-- ---------------------------------------------------------------- glimpses: only curators write
select pg_temp.login('96000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/a_p.webp","mime_type":"video/mp4","size_bytes":1000}'::jsonb)$q$) like '42501%', 'a member cannot add a glimpse';
  assert public.t96_try($q$insert into public.glimpses (poster_path, mime_type, size_bytes) values ('glimpses/a_p.webp', 'video/mp4', 10)$q$) like '42501%', 'nor write the table';
end $$;
reset role;
select pg_temp.login('96000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$ begin
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/a_p.webp","mime_type":"video/mp4","size_bytes":1000}'::jsonb)$q$) like '42501%', 'another permission is not enough';
  assert public.t96_try($q$select public.admin_glimpse_reorder(array[gen_random_uuid()])$q$) like '42501%';
  assert public.t96_try($q$select public.admin_glimpse_remove(gen_random_uuid())$q$) like '42501%';
  assert public.t96_try($q$select public.admin_save_past_meet('{"title":"Alumni Meet 2024","year":2024}'::jsonb)$q$) like '42501%', 'nor can it write meets';
end $$;
reset role;

-- ---------------------------------------------------------------- the curator: add, the 4-visible rule, finished vs pending
select pg_temp.login('96000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare ids uuid[] := '{}'; g uuid; old text[];
begin
  foreach g in array array[]::uuid[] loop null; end loop;
  for i in 1..4 loop
    ids := ids || public.admin_glimpse_add(format('{"poster_path":"glimpses/%s_p.webp","mime_type":"video/mp4","size_bytes":5000000,"duration_ms":20000,"caption":"Clip %s","year":%s}', chr(96 + i), i, 2020 + i)::jsonb);
  end loop;
  assert (select count(*) from public.glimpses where is_visible) = 4, 'four visible';
  g := public.admin_glimpse_add('{"poster_path":"glimpses/e_p.webp","mime_type":"video/webm","size_bytes":5000000}'::jsonb);
  assert (select not is_visible from public.glimpses where id = g), 'the fifth starts hidden';
  assert public.t96_try(format($q$select public.admin_glimpse_update(%L, '{"is_visible":true}'::jsonb)$q$, g)) like 'P0001|glimpses.errMax|%', 'at most 4 shown';
  perform public.admin_glimpse_update(ids[1], '{"is_visible":false}'::jsonb);
  perform public.admin_glimpse_update(g, '{"is_visible":true,"caption":"Fifth","caption_hi":"पाँचवाँ","year":2019}'::jsonb);
  assert (select caption || caption_hi || year from public.glimpses where id = g) = 'Fifthपाँचवाँ2019', 'caption, Hindi caption and year are saved';
  -- limits
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/f_p.webp","mime_type":"video/mp4","size_bytes":62914561}'::jsonb)$q$) like 'P0001|glimpses.errFile|%', 'over 60 MB';
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/f_p.webp","mime_type":"video/mp4","size_bytes":1000,"duration_ms":91000}'::jsonb)$q$) like 'P0001|glimpses.errLong|%', 'over 90 seconds';
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/nothere.webp","mime_type":"video/mp4","size_bytes":1000}'::jsonb)$q$) like 'P0001%', 'poster must exist';
  assert public.t96_try($q$select public.admin_glimpse_add('{"poster_path":"glimpses/f_p.webp","mime_type":"video/avi","size_bytes":1000}'::jsonb)$q$) like 'P0001|glimpses.errFile|%', 'file type';
  -- reorder
  perform public.admin_glimpse_reorder(array[ids[4], ids[3], ids[2], ids[1], g]);
  assert (select sort_order from public.glimpses where id = ids[4]) = 1 and (select sort_order from public.glimpses where id = g) = 5, 'order saved';
  -- replace the clip: the old poster is returned, the glimpse leaves the public list until the new file is in Drive
  old := public.admin_glimpse_update(ids[2], '{"poster_path":"glimpses/f_p.webp","mime_type":"video/mp4","size_bytes":4000000,"duration_ms":15000}'::jsonb);
  assert old = array['glimpses/b_p.webp'], 'the old poster is handed back for deletion';
  assert (select drive_file_id is null and poster_path = 'glimpses/f_p.webp' from public.glimpses where id = ids[2]), 'pending';
  assert (public.admin_glimpse_remove(g)) = array['glimpses/e_p.webp'], 'remove returns the poster';
  assert (select count(*) from public.glimpses) = 4;
  perform set_config('app.test_ids', array_to_string(ids, ','), true);
end $$;
reset role;

-- ---------------------------------------------------------------- the public (anon) sees only visible, finished glimpses
update public.glimpses set drive_file_id = 'driveglimpse' || lpad(sort_order::text, 3, '0') where drive_file_id is null and poster_path <> 'glimpses/f_p.webp';
select pg_temp.login(null);
set local role anon;
do $$ begin
  assert (select count(*) from public.glimpses) = 2, 'anon sees only the visible and finished ones (one hidden, one pending)';
  assert public.t96_try($q$update public.glimpses set caption = 'x'$q$) like '42501%', 'anon cannot write';
  assert public.t96_try($q$select public.admin_glimpse_add('{}'::jsonb)$q$) like '42501%', 'nor call the admin functions';
end $$;
reset role;
select pg_temp.login('96000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.glimpses) = 4, 'the curator sees all of them';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.admin_audit where action = 'glimpse_add'), 'adding is in the activity log';
  assert exists (select 1 from public.admin_audit where action = 'glimpse_reorder'), 'and so is reordering';
end $$;

-- ---------------------------------------------------------------- past meets
do $$ begin
  assert (select title || year::text || is_published::text from public.past_meets where slug = 'alumni-meet-2025') = 'Alumni Meet 2025' || '2025' || 'false', 'Alumni Meet 2025 is a draft with a title and a year only';
  assert (select venue is null and description is null and held_on is null and highlights is null and attendance is null and event_id is null from public.past_meets where slug = 'alumni-meet-2025'), 'nothing invented';
end $$;
select pg_temp.login(null);
set local role anon;
do $$ begin
  assert (select count(*) from public.past_meets) = 0, 'anon does not see the draft';
end $$;
reset role;
select pg_temp.login('96000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare m uuid; m2 uuid; ev uuid;
begin
  assert (select count(*) from public.past_meets) = 1, 'curators see drafts';
  m := (select id from public.past_meets where slug = 'alumni-meet-2025');
  assert public.t96_try($q$select public.admin_save_past_meet('{"title":"x","year":2024}'::jsonb)$q$) like 'P0001|meets.errTitle|%', 'title needed';
  assert public.t96_try($q$select public.admin_save_past_meet('{"title":"Alumni Meet","year":1900}'::jsonb)$q$) like 'P0001|meets.errYear|%', 'sensible year';
  assert public.t96_try($q$select public.admin_save_past_meet('{"title":"Alumni Meet 2024","year":2024,"cover_path":"gallery/meets/missing.webp"}'::jsonb)$q$) like 'P0001%', 'the cover must exist';
  perform public.admin_save_past_meet(jsonb_build_object('id', m, 'title', 'Alumni Meet 2025', 'title_hi', 'पूर्व छात्र सम्मेलन 2025', 'year', 2025, 'held_on', '2025-12-27',
      'venue', 'Campus lawns', 'description', 'A day together.', 'highlights', 'Reunion lunch', 'attendance', 120, 'cover_path', 'gallery/meets/cover1.webp',
      'members_can_add', true, 'is_published', true));
  ev := (select event_id from public.past_meets where id = m);
  assert ev is not null, 'saving makes the archive event';
  assert (select archive_event from public.past_meets where id = m), 'marked as ours';
  assert (select is_published from public.events where id = ev), 'the archive event is published so members can open its photos';
  assert (select member_uploads from public.event_photo_settings where event_id = ev) = 'approval', 'members can add: with approval';
  perform public.admin_save_past_meet(jsonb_build_object('id', m, 'title', 'Alumni Meet 2025', 'year', 2025, 'members_can_add', false, 'is_published', true));
  assert (select member_uploads from public.event_photo_settings where event_id = ev) = 'off', 'members cannot add: only the team';
  assert (select event_id from public.past_meets where id = m) = ev, 'the same event is kept';
  m2 := public.admin_save_past_meet('{"title":"Alumni Meet 2024","year":2024,"is_published":false}'::jsonb);
  assert (select slug from public.past_meets where id = m2) = 'alumni-meet-2024', 'the web address is made from the title';
  m2 := public.admin_save_past_meet('{"title":"Alumni Meet 2024","year":2024}'::jsonb);
  assert (select slug from public.past_meets where id = m2) <> 'alumni-meet-2024', 'a second one gets its own address';
  -- a glimpse can belong to a meet
  perform public.admin_glimpse_set_meet((select id from public.glimpses limit 1), m);
  assert public.t96_try(format($q$select public.admin_glimpse_set_meet((select id from public.glimpses limit 1), %L)$q$, gen_random_uuid())) like 'P0001%', 'the meet must exist';
end $$;
reset role;
select pg_temp.login(null);
set local role anon;
do $$ begin
  assert (select count(*) from public.past_meets) = 1, 'anon sees the published meet only';
  assert public.t96_try($q$update public.past_meets set title = 'x'$q$) like '42501%', 'anon cannot write meets';
end $$;
reset role;
-- members: read published, cannot write, see the photos through the event
select pg_temp.login('96000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.past_meets) = 1, 'members read published meets';
  assert public.t96_try($q$select public.admin_delete_past_meet(gen_random_uuid())$q$) like '42501%', 'but cannot delete';
  assert public.t96_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path) select event_id, auth.uid(), auth.uid() || '/m.webp', auth.uid() || '/m_t.webp' from public.past_meets where is_published$q$) like 'P0001|photos.errUploadsOff|%', 'with members off, a member cannot add to the archive';
end $$;
reset role;
select pg_temp.login('96000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
declare m uuid := (select id from public.past_meets where slug = 'alumni-meet-2025');
begin
  assert public.admin_delete_past_meet(m) = array['gallery/meets/cover1.webp'], 'delete hands the cover back';
  assert (select count(*) from public.events where slug = 'meet-archive-alumni-meet-2025') = 1, 'the archive event and its photos are left alone';
  assert (select count(*) from public.glimpses where meet_id is not null) = 0, 'glimpses are kept, only unlinked';
end $$;
reset role;
do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.past_meets'::regclass) and (select relrowsecurity from pg_class where oid = 'public.glimpses'::regclass), 'row security on';
  assert not has_table_privilege('authenticated', 'public.glimpses', 'INSERT') and not has_table_privilege('authenticated', 'public.past_meets', 'UPDATE')
     and not has_table_privilege('anon', 'public.glimpses', 'DELETE'), 'read-only through the API';
end $$;
select 'ALL GLIMPSE AND MEET TESTS PASSED';
rollback;
