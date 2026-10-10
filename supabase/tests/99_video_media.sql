-- Videos in the event photo area and the gallery: validation, Drive-only playback state, moderation inheritance, "uploads off", photos-only
-- votes, the gallery from an event video, and the private Drive folder table. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function public.t95_try(q text) returns text language plpgsql as $$
declare h text;
begin execute q; return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
end $$;
grant execute on function public.t95_try(text) to authenticated, anon;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;

-- a photo moderator (photos_moderate), g gallery curator, 1 2 verified members
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-0000000000a1', 'p@v95.com', '{"full_name":"Photo Mod"}'),
  ('95000000-0000-0000-0000-0000000000a2', 'g@v95.com', '{"full_name":"Gallery Curator"}'),
  ('95000000-0000-0000-0000-0000000000c1', 'm1@v95.com', '{"full_name":"Asha One"}'),
  ('95000000-0000-0000-0000-0000000000c2', 'm2@v95.com', '{"full_name":"Bala Two"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001 where id::text like '95000000-%';
update public.profiles set is_admin = true where id in ('95000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-0000000000a2');
insert into public.admin_grants (user_id, permissions) values
  ('95000000-0000-0000-0000-0000000000a1', array['photos_moderate']),
  ('95000000-0000-0000-0000-0000000000a2', array['gallery_manage']);
insert into public.events (id, slug, title, is_published) values
  ('95000000-0000-0000-0000-0000000000e1', 'v95-drive', 'V95 With Drive', true),
  ('95000000-0000-0000-0000-0000000000e2', 'v95-nodrive', 'V95 No Drive', true);
insert into public.event_settings (event_id, drive_folder_id) values ('95000000-0000-0000-0000-0000000000e1', 'folderfolder12345');

-- ---------------------------------------------------------------- member video: stored as a member video, not playable until Drive has it
select pg_temp.login('95000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path, kind, media_kind, mime_type, size_bytes, duration_ms, content_hash)
  values ('95000000-0000-0000-0000-00000000b001', '95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/v1.mov', auth.uid() || '/e1/v1_t.webp', 'event',
          'video', 'video/quicktime', 150000000, 31000, repeat('b', 64));
  assert (select source from public.event_photos where id = '95000000-0000-0000-0000-00000000b001') = 'member', 'a member video is marked From members';
  assert (select status from public.event_photos where id = '95000000-0000-0000-0000-00000000b001') = 'approved', 'immediate mode shows it';
  assert (select drive_file_id from public.event_photos where id = '95000000-0000-0000-0000-00000000b001') is null, 'no Drive file yet';
  -- the client cannot set the Drive file, nor the source / status
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes, drive_file_id) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/x.mp4', auth.uid() || '/e1/x_t.webp', 'video', 'video/mp4', 1000, 'abcdefghij12345')$q$) like '42501%', 'drive_file_id is not insertable';
  assert public.t95_try($q$update public.event_photos set drive_file_id = 'abcdefghij12345' where id = '95000000-0000-0000-0000-00000000b001'$q$) like '42501%', 'nor updatable';
  -- limits and shape
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/big.mp4', auth.uid() || '/e1/big_t.webp', 'video', 'video/mp4', 524288001)$q$) like 'P0001|photos.errVideoBig|%', 'over 500 MB is refused by the table';
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/avi.avi', auth.uid() || '/e1/avi_t.webp', 'video', 'video/x-msvideo', 1000)$q$) like '23514%', 'only mp4, mov and webm';
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/nodet.mp4', auth.uid() || '/e1/nodet_t.webp', 'video')$q$) like 'P0001|photos.errVideoFormat|%', 'a video needs its details';
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes) values ('95000000-0000-0000-0000-0000000000e2', auth.uid(), auth.uid() || '/e2/v.mp4', auth.uid() || '/e2/v_t.webp', 'video', 'video/mp4', 1000)$q$) like 'P0001|photos.errVideoNoDrive|%', 'no Drive folder: no videos';
  -- photos are unchanged: media fields are ignored for a photo
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path, size_bytes, mime_type)
  values ('95000000-0000-0000-0000-00000000b002', '95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/p.webp', auth.uid() || '/e1/p_t.webp', 5, 'video/mp4');
  assert (select media_kind || coalesce(mime_type, '-') from public.event_photos where id = '95000000-0000-0000-0000-00000000b002') = 'photo-', 'a photo carries no video fields';
  -- 10 videos an hour for members
  for i in 1..9 loop
    insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes)
    values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/r' || i || '.mp4', auth.uid() || '/e1/r' || i || '_t.webp', 'video', 'video/mp4', 1000);
  end loop;
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/r10.mp4', auth.uid() || '/e1/r10_t.webp', 'video', 'video/mp4', 1000)$q$) like 'P0001|photos.errVideoRate|%', 'ten videos an hour';
end $$;

-- ---------------------------------------------------------------- listing: unfinished videos are the owner's and the managers' only
do $$ begin
  assert (select playable from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'mine', p_id => '95000000-0000-0000-0000-00000000b001')) = false, 'the owner sees it, not playable yet';
  assert (select count(*) from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'mine', p_media => 'video')) = 10, 'the media filter finds the videos';
  assert (select count(*) from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'mine', p_media => 'photo')) = 1, 'and the photos';
  assert (select (public.photo_caps('95000000-0000-0000-0000-0000000000e1') ->> 'drive')::boolean), 'caps say Drive is set up';
  assert not (select (public.photo_caps('95000000-0000-0000-0000-0000000000e2') ->> 'drive')::boolean), 'and not here';
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'approved', p_media => 'video')) = 0, 'other members do not see unfinished videos';
  assert (select count(*) from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'approved')) = 1, 'only the photo';
end $$;
reset role;

-- the drive-upload function (service role) records the Drive file once it has verified it
update public.event_photos set drive_file_id = 'driveFileId123456' where id = '95000000-0000-0000-0000-00000000b001';
select pg_temp.login('95000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert (select playable from public.event_photos_list('95000000-0000-0000-0000-0000000000e1', 'approved', p_id => '95000000-0000-0000-0000-00000000b001')) = true, 'now everyone can play it';
  assert (public.photo_summary('95000000-0000-0000-0000-0000000000e1') ->> 'videos')::int = 1, 'the summary counts finished videos';
  -- hearts and reports work on videos like on photos
  assert (public.heart_photo('95000000-0000-0000-0000-00000000b001') ->> 'count')::int = 1, 'hearts';
  perform public.report_photo('95000000-0000-0000-0000-00000000b001', 'not appropriate');
  assert exists (select 1 from public.reports where target_type = 'photo' and target_id = '95000000-0000-0000-0000-00000000b001'), 'reports';
end $$;
reset role;

-- ---------------------------------------------------------------- moderation: photos_moderate hides and deletes videos; the gallery curator cannot
select pg_temp.login('95000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$ begin
  assert public.t95_try($q$select public.admin_review_photos('95000000-0000-0000-0000-0000000000e1', array['95000000-0000-0000-0000-00000000b001']::uuid[], 'hide')$q$) like '42501%', 'gallery_manage does not moderate event videos';
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert public.admin_review_photos('95000000-0000-0000-0000-0000000000e1', array['95000000-0000-0000-0000-00000000b001']::uuid[], 'hide') = 1, 'photos_moderate hides a video';
  assert (select is_hidden from public.event_photos where id = '95000000-0000-0000-0000-00000000b001'), 'hidden';
  perform public.admin_review_photos('95000000-0000-0000-0000-0000000000e1', array['95000000-0000-0000-0000-00000000b001']::uuid[], 'unhide');
  -- an official video: approved at once, never rate limited
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path, media_kind, mime_type, size_bytes)
  values ('95000000-0000-0000-0000-00000000b003', '95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/o.mp4', auth.uid() || '/e1/o_t.webp', 'video', 'video/mp4', 2000);
  assert (select source from public.event_photos where id = '95000000-0000-0000-0000-00000000b003') = 'official', 'official video';
  -- votes are for photos only
  assert public.t95_try($q$select public.admin_open_photo_vote('95000000-0000-0000-0000-0000000000e1', 'Best', array['95000000-0000-0000-0000-00000000b001', '95000000-0000-0000-0000-00000000b002']::uuid[], 24)$q$) like 'P0001%', 'a video cannot be in a vote';
  -- uploads off: members are refused, the team is not
  perform public.admin_set_photo_settings('95000000-0000-0000-0000-0000000000e1', 'off');
  delete from public.event_photos where id = '95000000-0000-0000-0000-00000000b003';
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert public.t95_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path) values ('95000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/off.webp', auth.uid() || '/e1/off_t.webp')$q$) like 'P0001|photos.errUploadsOff|%', 'uploads off: a member cannot add';
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  perform public.admin_set_photo_settings('95000000-0000-0000-0000-0000000000e1', 'immediate');
  assert public.t95_try($q$select public.admin_set_photo_settings('95000000-0000-0000-0000-0000000000e1', 'nobody')$q$) like 'P0001%', 'unknown modes are refused';
end $$;
reset role;

-- ---------------------------------------------------------------- the gallery: an event video is shared, a new upload waits for Drive
insert into storage.objects (bucket_id, name, owner) values ('gallery', 'gallery/gv1_t.webp', null), ('gallery', 'gallery/gv2_t.webp', null);
select pg_temp.login('95000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$
declare a uuid; b uuid;
begin
  a := public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv1.mp4","thumb_path":"gallery/gv1_t.webp","source_photo_id":"95000000-0000-0000-0000-00000000b001","title":"From event"}'::jsonb);
  assert (select drive_file_id from public.gallery_photos where id = a) = 'driveFileId123456', 'the gallery shares the event video''s Drive file';
  assert (select media_kind || mime_type || size_bytes from public.gallery_photos where id = a) = 'videovideo/quicktime150000000', 'and its details';
  assert public.t95_try($q$select public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv3.mp4","thumb_path":"gallery/gv1_t.webp","source_photo_id":"95000000-0000-0000-0000-00000000b002"}'::jsonb)$q$) like 'P0001%', 'a photo id is not a video';
  assert public.t95_try($q$select public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv4.mp4","thumb_path":"gallery/missing.webp","mime_type":"video/mp4","size_bytes":1000}'::jsonb)$q$) like 'P0001%', 'the poster must exist';
  assert public.t95_try($q$select public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv5.mp4","thumb_path":"gallery/gv2_t.webp","mime_type":"video/mp4","size_bytes":524288001}'::jsonb)$q$) like 'P0001|gallery.errVideo|%', 'over 500 MB';
  b := public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv6.mp4","thumb_path":"gallery/gv2_t.webp","mime_type":"video/mp4","size_bytes":9000000,"duration_ms":20000}'::jsonb);
  assert (select drive_file_id is null from public.gallery_photos where id = b), 'a new upload waits for Drive';
  assert (select count(*) from public.gallery_photos where media_kind = 'video') = 2, 'curators see both';
end $$;
reset role;
select pg_temp.login('95000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.gallery_photos where media_kind = 'video') = 1, 'members see only the finished gallery video';
  assert (select count(*) from public.gallery_on_this_day(50)) = 0, 'on this day works';
  assert public.t95_try($q$select public.admin_gallery_add('{"media_kind":"video","storage_path":"gallery/gv9.mp4","thumb_path":"gallery/gv1_t.webp","mime_type":"video/mp4","size_bytes":1000}'::jsonb)$q$) like '42501%', 'members cannot add gallery videos';
  assert public.t95_try($q$select * from public.drive_roots$q$) like '42501%', 'the Drive folder table is private';
end $$;
reset role;
select pg_temp.login(null);
set local role anon;
do $$ begin
  assert public.t95_try($q$select count(*) from public.gallery_photos$q$) like '42501%', 'anon never reads the gallery';
  assert public.t95_try($q$select * from public.drive_roots$q$) like '42501%', 'nor the Drive folders';
end $$;
reset role;
do $$ begin
  assert not has_table_privilege('authenticated', 'public.drive_roots', 'SELECT') and not has_table_privilege('anon', 'public.drive_roots', 'SELECT'), 'drive_roots has no API grants';
  assert (select relrowsecurity from pg_class where oid = 'public.drive_roots'::regclass), 'with row security on';
  assert (select file_size_limit from storage.buckets where id = 'glimpses') = 2 * 1024 * 1024, 'glimpse posters are tiny';
end $$;
select 'ALL VIDEO TESTS PASSED';
rollback;
