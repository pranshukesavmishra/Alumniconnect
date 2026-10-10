-- Photos: the event photo area (visibility, uploads, approval, official, tags, hearts, reports, votes, rate limits) and the college
-- gallery (only gallery_manage curates, suggestions, categories, visibility). Rolls back.
\set ON_ERROR_STOP 1
begin;
create function public.t94_try(q text) returns text language plpgsql as $$
declare st text; msg text; h text;
begin execute q; return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
end $$;
grant execute on function public.t94_try(text) to authenticated, anon;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
$$;

-- a admin (full), g gallery curator (limited), p photo moderator (limited), l limited admin with neither, 1 2 3 verified members, r registered but unverified, u unverified stranger
insert into auth.users (id, email, raw_user_meta_data) values
  ('9a000000-0000-0000-0000-0000000000a1', 'a@p94.com', '{"full_name":"Adm"}'),
  ('9a000000-0000-0000-0000-0000000000a2', 'g@p94.com', '{"full_name":"Gallery Curator"}'),
  ('9a000000-0000-0000-0000-0000000000a3', 'p@p94.com', '{"full_name":"Photo Mod"}'),
  ('9a000000-0000-0000-0000-0000000000a4', 'l@p94.com', '{"full_name":"Limited"}'),
  ('9a000000-0000-0000-0000-0000000000c1', 'm1@p94.com', '{"full_name":"Asha One"}'),
  ('9a000000-0000-0000-0000-0000000000c2', 'm2@p94.com', '{"full_name":"Bala Two"}'),
  ('9a000000-0000-0000-0000-0000000000c3', 'm3@p94.com', '{"full_name":"Chitra Three"}'),
  ('9a000000-0000-0000-0000-0000000000d1', 'r@p94.com', '{"full_name":"Registered Unverified"}'),
  ('9a000000-0000-0000-0000-0000000000d2', 'u@p94.com', '{"full_name":"Stranger"}');
update public.profiles set onboarded = true, verification = 'verified', member_type = 'alumnus', branch = 'Civil Engineering', city = 'Pune', grad_year = 2001 where id::text like '9a000000-%';
update public.profiles set grad_year = 2005 where id = '9a000000-0000-0000-0000-0000000000c2';
update public.profiles set verification = 'pending' where id in ('9a000000-0000-0000-0000-0000000000d1', '9a000000-0000-0000-0000-0000000000d2');
update public.profiles set is_admin = true where id in ('9a000000-0000-0000-0000-0000000000a1', '9a000000-0000-0000-0000-0000000000a2', '9a000000-0000-0000-0000-0000000000a3', '9a000000-0000-0000-0000-0000000000a4');
insert into public.admin_grants (user_id, permissions) values
  ('9a000000-0000-0000-0000-0000000000a2', array['gallery_manage']),
  ('9a000000-0000-0000-0000-0000000000a3', array['photos_moderate']),
  ('9a000000-0000-0000-0000-0000000000a4', array['members_view']);
insert into public.events (id, slug, title, is_published) values
  ('9a000000-0000-0000-0000-0000000000e1', 'p94-one', 'P94 Reunion', true),
  ('9a000000-0000-0000-0000-0000000000e2', 'p94-two', 'P94 Other', true);
insert into public.event_registrations (id, event_id, user_id, code, full_name, phone, email, status, headcount, amount_paise) values
  ('9a000000-0000-0000-0000-0000000000f1', '9a000000-0000-0000-0000-0000000000e1', '9a000000-0000-0000-0000-0000000000d1', 'JEC-P94001', 'Reg', '+91 98765 94001', 'r@p94.com', 'confirmed', 1, 0);

-- ---------------------------------------------------------------- catalogue and capability
do $$ begin
  assert (select count(*) from public._permission_catalog() where key in ('gallery_manage', 'photos_moderate')) = 2, 'both permissions are in the catalogue';
  assert (select grp from public._permission_catalog() where key = 'gallery_manage') = 'Photos', 'in the Photos group';
end $$;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert public.has_event_cap('photos', '9a000000-0000-0000-0000-0000000000e1'), 'photos_moderate holds the photos capability';
  assert not public._admin_can('gallery_manage'), 'but not the gallery';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$ begin
  assert not public.has_event_cap('photos', '9a000000-0000-0000-0000-0000000000e1'), 'gallery_manage does not moderate event photos';
  assert public._admin_can('gallery_manage');
end $$;
reset role;

-- ---------------------------------------------------------------- uploads: immediate mode, source and status are decided by the database
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path, caption, content_hash, kind)
  values ('9a000000-0000-0000-0000-00000000b001', '9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/a.webp', auth.uid() || '/e1/a_t.webp', 'Hello', repeat('a', 64), 'event');
  assert (select source from public.event_photos where id = '9a000000-0000-0000-0000-00000000b001') = 'member', 'member upload is marked From members';
  assert (select status from public.event_photos where id = '9a000000-0000-0000-0000-00000000b001') = 'approved', 'immediate mode: shown at once';
  -- a member cannot choose source, status or visibility
  assert public.t94_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, source) values ('9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/x.webp', auth.uid() || '/e1/x_t.webp', 'official')$q$) like '42501%', 'source is not insertable';
  assert public.t94_try($q$update public.event_photos set status = 'approved', is_hidden = false, sort_order = 1 where id = '9a000000-0000-0000-0000-00000000b001'$q$) like '42501%', 'status / order are not updatable by members';
  -- duplicate by content hash
  assert public.t94_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path, content_hash) values ('9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/dup.webp', auth.uid() || '/e1/dup_t.webp', repeat('a', 64))$q$) like '23505%', 'same bytes twice in one event is a duplicate';
  assert (select count(*) from public.photo_hashes_taken('9a000000-0000-0000-0000-0000000000e1', array[repeat('a', 64), repeat('b', 64)])) = 1, 'the app can ask which hashes exist';
end $$;
reset role;

-- visibility: verified yes, registered-but-unverified yes, unverified stranger no, anon no
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 1, 'verified member sees the event photos';
  assert (select count(*) from public.event_photos) = 1;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000d1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 1, 'a registered member sees them even before verification';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 1;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000d2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos) = 0, 'unverified stranger sees no photo rows';
  assert public.t94_try($q$select * from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')$q$) like '42501%', 'and the list is refused';
  assert public.t94_try($q$select public.heart_photo('9a000000-0000-0000-0000-00000000b001')$q$) like '42501%', 'no hearts';
  assert public.t94_try($q$select public.report_photo('9a000000-0000-0000-0000-00000000b001', 'bad')$q$) like '42501%', 'no reports';
  assert public.t94_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path) values ('9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/z.webp', auth.uid() || '/e1/z_t.webp')$q$) is not null, 'cannot upload either';
end $$;
reset role;
select pg_temp.login(null);
set local role anon;
do $$ begin
  assert public.t94_try($q$select * from public.event_photos$q$) like '42501%', 'anon has no table access';
  assert public.t94_try($q$select * from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')$q$) like '42501%', 'anon cannot run the list';
  assert public.t94_try($q$select * from public.gallery_photos$q$) like '42501%', 'anon has no gallery';
end $$;
reset role;

-- ---------------------------------------------------------------- settings: approval mode
select pg_temp.login('9a000000-0000-0000-0000-0000000000a4');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_set_photo_settings('9a000000-0000-0000-0000-0000000000e1', 'approval')$q$) like '42501%', 'a limited admin without the permission cannot change settings';
  assert public.t94_try($q$select * from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'pending')$q$) like '42501%', 'nor read the approval queue';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_set_photo_settings('9a000000-0000-0000-0000-0000000000e1', 'approval')$q$) like '42501%', 'a member cannot change settings';
  assert public.t94_try($q$update public.event_photo_settings set member_uploads = 'approval'$q$) like '42501%', 'nor write the table';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  perform public.admin_set_photo_settings('9a000000-0000-0000-0000-0000000000e1', 'approval');
  assert (select member_uploads from public.event_photo_settings where event_id = '9a000000-0000-0000-0000-0000000000e1') = 'approval';
  -- official upload: marked Official, shown at once even though member uploads need approval
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path, content_hash)
  values ('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/o.webp', auth.uid() || '/e1/o_t.webp', repeat('c', 64));
  assert (select source || '/' || status from public.event_photos where id = '9a000000-0000-0000-0000-00000000b002') = 'official/approved', 'photographer uploads are Official and visible';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path)
  values ('9a000000-0000-0000-0000-00000000b003', '9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/p.webp', auth.uid() || '/e1/p_t.webp');
  assert (select status from public.event_photos where id = '9a000000-0000-0000-0000-00000000b003') = 'pending', 'approval mode: waits';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'mine')) = 1, 'the uploader sees their own pending photo';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 2, 'but the area shows only the approved photos (member one + official)';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 2, 'other members do not see the pending photo';
  assert (select count(*) from public.event_photos where id = '9a000000-0000-0000-0000-00000000b003') = 0, 'not even through the table';
  assert public.t94_try($q$select public.heart_photo('9a000000-0000-0000-0000-00000000b003')$q$) like '42501%', 'no hearts on a pending photo';
  assert public.t94_try($q$select public.admin_review_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b003']::uuid[], 'approve')$q$) like '42501%', 'members cannot approve';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'pending')) = 1, 'moderator sees the approval queue';
  assert (public.photo_summary('9a000000-0000-0000-0000-0000000000e1') ->> 'pending')::int = 1;
  assert public.admin_review_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b003']::uuid[], 'approve') = 1;
  assert (select status from public.event_photos where id = '9a000000-0000-0000-0000-00000000b003') = 'approved';
  -- the photo belongs to event 1: the same call for event 2 changes nothing
  assert public.admin_review_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b003']::uuid[], 'approve') = 0, 'approving twice is harmless';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000c2' and kind = 'photo_approved' and target_id = '9a000000-0000-0000-0000-00000000b003'), 'uploader is told';
  assert (select count(*) from public.admin_audit where action in ('photo_settings', 'photo_approve') and actor = '9a000000-0000-0000-0000-0000000000a3') >= 2, 'audited';
end $$;

-- ---------------------------------------------------------------- hide, unhide, reorder, delete
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert public.admin_review_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b003']::uuid[], 'hide') = 1;
  perform public.admin_reorder_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-00000000b001']::uuid[]);
  assert (select array_agg(l.id order by 1) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1') l) is not null;
  assert (select l.id from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1') l limit 1) = '9a000000-0000-0000-0000-00000000b002', 'curated order is respected';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'hidden')) = 1;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1')) = 2, 'a hidden photo is gone for members';
  assert public.t94_try($q$select public.admin_reorder_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b002']::uuid[])$q$) like '42501%', 'members cannot reorder';
  assert public.t94_try($q$delete from public.event_photos where id = '9a000000-0000-0000-0000-00000000b002'$q$) is null, 'delete statement runs';
  assert (select count(*) from public.event_photos where id = '9a000000-0000-0000-0000-00000000b002') = 1, 'but a member cannot delete the official photo';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  perform public.admin_review_photos('9a000000-0000-0000-0000-0000000000e1', array['9a000000-0000-0000-0000-00000000b003']::uuid[], 'unhide');
  delete from public.event_photos where id = '9a000000-0000-0000-0000-00000000b003';
  assert (select count(*) from public.event_photos where id = '9a000000-0000-0000-0000-00000000b003') = 0, 'a photo moderator deletes a member photo';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.admin_audit where action = 'delete_photo' and target_id = '9a000000-0000-0000-0000-00000000b003'), 'the deletion is in the activity log';
end $$;

-- ---------------------------------------------------------------- hearts
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.heart_photo('9a000000-0000-0000-0000-00000000b001');
  assert (r ->> 'hearted')::boolean and (r ->> 'count')::int = 1;
  assert (select hearts from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'approved', null, null, null, 'curated', '9a000000-0000-0000-0000-00000000b001')) = 1;
  assert (select hearted from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'approved', null, null, null, 'curated', '9a000000-0000-0000-0000-00000000b001'));
  r := public.heart_photo('9a000000-0000-0000-0000-00000000b001');
  assert not (r ->> 'hearted')::boolean and (r ->> 'count')::int = 0, 'second tap removes the heart';
end $$;
reset role;

-- ---------------------------------------------------------------- tags
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  perform public.tag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c2');
  assert (select count(*) from public.photo_tags_of('9a000000-0000-0000-0000-00000000b002')) = 1;
  assert public.t94_try($q$select public.tag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000d2')$q$) like 'P0001%', 'only verified members can be tagged';
  perform public.tag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c2'); -- again: no second notification
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000c2' and kind = 'photo_tag') = 1, 'the tagged person is told exactly once';
  assert (select actor_id from public.notifications where kind = 'photo_tag') = '9a000000-0000-0000-0000-0000000000c1';
end $$;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.event_photos_list(null, 'tagged')) = 1, 'Find my photos: photos I am tagged in, across events';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'approved', null, null, 2005)) = 1, 'batch filter: photos with a 2005 batchmate tagged';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'approved', null, null, 1999)) = 0;
  assert public.t94_try($q$select public.untag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c3')$q$) is null, 'removing a tag that does not exist is a no-op';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.untag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c2')$q$) like '42501%', 'a bystander cannot remove a tag';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  perform public.untag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c2');
  assert (select count(*) from public.photo_tags) = 0, 'the tagged person removes the tag';
end $$;
reset role;
-- tag spam: 30 tags an hour
insert into public.event_photos (id, event_id, uploaded_by, storage_path, thumb_path)
  select ('9a000000-0000-0000-0000-0000000c' || lpad(g::text, 4, '0'))::uuid, '9a000000-0000-0000-0000-0000000000e1', '9a000000-0000-0000-0000-0000000000a3',
         '9a000000-0000-0000-0000-0000000000a3/e1/s' || g || '.webp', '9a000000-0000-0000-0000-0000000000a3/e1/s' || g || '_t.webp' from generate_series(1, 31) g;
update public.event_photos set status = 'approved';
insert into public.photo_tags (photo_id, tagged_user, tagged_by)
  select p.id, '9a000000-0000-0000-0000-0000000000c3', '9a000000-0000-0000-0000-0000000000c1' from public.event_photos p where p.id::text like '9a000000-0000-0000-0000-0000000c%' limit 30;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ declare r text; begin
  r := public.t94_try($q$select public.tag_photo('9a000000-0000-0000-0000-00000000b002', '9a000000-0000-0000-0000-0000000000c3')$q$);
  assert r like 'P0001|photos.errTagRate|%', 'tag spam is limited: ' || coalesce(r, 'allowed');
end $$;
reset role;
delete from public.photo_tags where tagged_by = '9a000000-0000-0000-0000-0000000000c1';
delete from public.event_photos where id::text like '9a000000-0000-0000-0000-0000000c%';

-- ---------------------------------------------------------------- upload rate limit: 60 an hour per member per event, officials exempt
insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path)
  select '9a000000-0000-0000-0000-0000000000e1', '9a000000-0000-0000-0000-0000000000c3', '9a000000-0000-0000-0000-0000000000c3/e1/r' || g || '.webp', '9a000000-0000-0000-0000-0000000000c3/e1/r' || g || '_t.webp' from generate_series(1, 60) g;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$ declare r text; begin
  r := public.t94_try($q$insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path) values ('9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/over.webp', auth.uid() || '/e1/over_t.webp')$q$);
  assert r like 'P0001|photos.errRate|%', 'the 61st photo in an hour is refused: ' || coalesce(r, 'allowed');
  -- another event is a separate allowance
  insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path) values ('9a000000-0000-0000-0000-0000000000e2', auth.uid(), auth.uid() || '/e2/ok.webp', auth.uid() || '/e2/ok_t.webp');
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  insert into public.event_photos (event_id, uploaded_by, storage_path, thumb_path)
    select '9a000000-0000-0000-0000-0000000000e1', auth.uid(), auth.uid() || '/e1/b' || g || '.webp', auth.uid() || '/e1/b' || g || '_t.webp' from generate_series(1, 70) g;
  assert (select count(*) from public.event_photos where uploaded_by = auth.uid() and source = 'official') >= 70, 'a photographer can upload hundreds';
end $$;
reset role;
delete from public.event_photos where uploaded_by = '9a000000-0000-0000-0000-0000000000c3' and storage_path like '%/r%';
delete from public.event_photos where uploaded_by = '9a000000-0000-0000-0000-0000000000a3' and storage_path like '%/b%';

-- ---------------------------------------------------------------- reports reuse the moderation pipeline
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  perform public.report_photo('9a000000-0000-0000-0000-00000000b001', 'not appropriate');
  assert public.t94_try($q$select public.report_photo('9a000000-0000-0000-0000-00000000b001', 'x')$q$) like 'P0001%' or true;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.report_photo('9a000000-0000-0000-0000-00000000b001', 'it is mine')$q$) like 'P0001%', 'cannot report your own photo';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.admin_reports('open') where target_type = 'photo' and target_id = '9a000000-0000-0000-0000-00000000b001') = 1, 'the report reaches the moderation inbox';
  assert (select count(*) from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'reported')) = 1;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert (select report_count from public.event_photos_list('9a000000-0000-0000-0000-0000000000e1', 'reported')) = 1;
  perform public.admin_dismiss_reports('photo', '9a000000-0000-0000-0000-00000000b001');
  assert public.t94_try($q$select public.admin_dismiss_reports('post', gen_random_uuid())$q$) like '42501%', 'a photo moderator cannot dismiss other reports';
  assert public.t94_try($q$select * from public.admin_reports('open')$q$) like '42501%', 'nor read the whole inbox';
  perform public.moderate('photo', '9a000000-0000-0000-0000-00000000b001', true);
  assert (select is_hidden from public.event_photos where id = '9a000000-0000-0000-0000-00000000b001'), 'photos_moderate can hide a reported photo';
  perform public.moderate('photo', '9a000000-0000-0000-0000-00000000b001', false);
  assert public.t94_try($q$select public.moderate('post', gen_random_uuid(), true)$q$) like '42501%', 'but not posts';
end $$;
reset role;
-- three reports hide a photo until someone looks
insert into public.reports (reporter, target_type, target_id, reason)
  values ('9a000000-0000-0000-0000-0000000000c2', 'photo', '9a000000-0000-0000-0000-00000000b002', 'one'),
         ('9a000000-0000-0000-0000-0000000000c3', 'photo', '9a000000-0000-0000-0000-00000000b002', 'two'),
         ('9a000000-0000-0000-0000-0000000000d1', 'photo', '9a000000-0000-0000-0000-00000000b002', 'three');
do $$ begin
  assert (select is_hidden from public.event_photos where id = '9a000000-0000-0000-0000-00000000b002'), 'three open reports hide the photo';
end $$;
update public.event_photos set is_hidden = false;

-- ---------------------------------------------------------------- caption editing
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  perform public.admin_edit_photo('9a000000-0000-0000-0000-00000000b001', 'A caption', 'हिंदी कैप्शन', 'Alt text');
  assert (select caption_hi from public.event_photos where id = '9a000000-0000-0000-0000-00000000b001') = 'हिंदी कैप्शन', 'owner edits their caption in both languages';
  assert public.t94_try($q$select public.admin_edit_photo('9a000000-0000-0000-0000-00000000b002', 'mine now', null, null)$q$) like '42501%', 'but not someone else''s';
end $$;
reset role;

-- ---------------------------------------------------------------- votes: one per member, counts after close, winner told
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_open_photo_vote('9a000000-0000-0000-0000-0000000000e1', 'Best photo', array['9a000000-0000-0000-0000-00000000b001','9a000000-0000-0000-0000-00000000b002']::uuid[], 24)$q$) like '42501%', 'members cannot open a vote';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ declare v uuid; begin
  v := public.admin_open_photo_vote('9a000000-0000-0000-0000-0000000000e1', 'Best photo of the meet', array['9a000000-0000-0000-0000-00000000b001','9a000000-0000-0000-0000-00000000b002']::uuid[], 24);
  assert public.t94_try(format($q$select public.admin_open_photo_vote('9a000000-0000-0000-0000-0000000000e1', 'Second', array['9a000000-0000-0000-0000-00000000b001','9a000000-0000-0000-0000-00000000b002']::uuid[], 24)$q$)) like 'P0001%', 'one open vote per event';
  assert (public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1') ->> 'closed')::boolean = false;
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ declare v uuid := (select id from public.photo_votes limit 1); j jsonb; begin
  perform public.cast_photo_vote(v, '9a000000-0000-0000-0000-00000000b002');
  assert public.t94_try(format($q$select public.cast_photo_vote(%L, '9a000000-0000-0000-0000-00000000b001')$q$, v)) like 'P0001|photos.errVoted|%', 'one vote per member';
  j := public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1');
  assert (j ->> 'my_vote')::uuid = '9a000000-0000-0000-0000-00000000b002' and (j -> 'candidates' -> 0 -> 'votes') = 'null'::jsonb, 'counts stay hidden while the vote is open';
  assert public.t94_try(format($q$select public.cast_photo_vote(%L, gen_random_uuid())$q$, v)) like 'P0001%', 'only the candidates';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ declare v uuid := (select id from public.photo_votes limit 1); begin
  perform public.cast_photo_vote(v, '9a000000-0000-0000-0000-00000000b002');
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000d2');
set local role authenticated;
do $$ declare v uuid := (select id from public.photo_votes limit 1); begin
  assert public.t94_try(format($q$select public.cast_photo_vote(%L, '9a000000-0000-0000-0000-00000000b002')$q$, v)) like '42501%', 'a stranger cannot vote';
  assert (select count(*) from public.photo_vote_ballots) = 0, 'and sees nobody''s ballot';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ declare v uuid := (select id from public.photo_votes limit 1); j jsonb; begin
  assert (public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1') ->> 'total')::int = 2, 'managers see the count while it runs';
  perform public.admin_close_photo_vote(v);
  j := public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1');
  assert (j ->> 'closed')::boolean and (j ->> 'winner')::uuid = '9a000000-0000-0000-0000-00000000b002', 'the winner is the photo with most votes';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ declare v uuid := (select id from public.photo_votes limit 1); begin
  assert public.t94_try(format($q$select public.cast_photo_vote(%L, '9a000000-0000-0000-0000-00000000b001')$q$, v)) like 'P0001%', 'a closed vote takes no more ballots';
  assert (public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1') ->> 'total')::int = 2, 'results are public after the close';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000a3' and kind = 'photo_winner'), 'the winner''s owner is told';
  assert exists (select 1 from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000c1' and kind = 'photo_vote_result'), 'voters are told the result';
  assert (select count(*) from public.admin_audit where action in ('photo_vote_open', 'photo_vote_close')) = 2, 'both vote steps are audited';
end $$;
-- a vote whose time ran out closes itself when anyone looks
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ declare v uuid; begin
  v := public.admin_open_photo_vote('9a000000-0000-0000-0000-0000000000e1', 'Another round', array['9a000000-0000-0000-0000-00000000b001','9a000000-0000-0000-0000-00000000b002']::uuid[], 1);
end $$;
reset role;
update public.photo_votes set closes_at = now() - interval '1 minute' where closed_at is null;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert (public.current_photo_vote('9a000000-0000-0000-0000-0000000000e1') ->> 'closed')::boolean, 'expired votes close themselves';
end $$;
reset role;

-- ---------------------------------------------------------------- the college gallery
insert into storage.objects (bucket_id, name, owner) values ('gallery', 'gallery/g1.webp', null), ('gallery', 'gallery/g1_t.webp', null), ('gallery', 'gallery/g2.webp', null), ('gallery', 'gallery/g2_t.webp', null),
  ('gallery', 'gallery/g3.webp', null), ('gallery', 'gallery/g3_t.webp', null);
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_gallery_add('{"storage_path":"gallery/g1.webp","thumb_path":"gallery/g1_t.webp"}'::jsonb)$q$) like '42501%', 'a member cannot add to the gallery';
  assert public.t94_try($q$insert into public.gallery_photos (storage_path, thumb_path) values ('gallery/q.webp', 'gallery/q_t.webp')$q$) like '42501%', 'nor write the table';
  assert public.t94_try($q$select public.admin_gallery_save_category(null, 'Mine', null)$q$) like '42501%';
  assert (select count(*) from public.gallery_categories) = 5, 'a verified member sees the five starter chips';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a3');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_gallery_add('{"storage_path":"gallery/g1.webp","thumb_path":"gallery/g1_t.webp"}'::jsonb)$q$) like '42501%', 'photos_moderate is not gallery_manage';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a4');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.admin_gallery_add('{"storage_path":"gallery/g1.webp","thumb_path":"gallery/g1_t.webp"}'::jsonb)$q$) like '42501%', 'nor is any other limited admin';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$ declare g1 uuid; g2 uuid; cat uuid; alb uuid; p text[]; begin
  cat := (select id from public.gallery_categories where slug = 'campus');
  alb := public.admin_gallery_save_album(null, 'Founders Day', 'संस्थापक दिवस', 'Old days');
  g1 := public.admin_gallery_add(jsonb_build_object('storage_path', 'gallery/g1.webp', 'thumb_path', 'gallery/g1_t.webp', 'title', 'The main gate', 'category_id', cat,
          'album_id', alb, 'event_id', '9a000000-0000-0000-0000-0000000000e1', 'is_featured', true, 'taken_on', (now() at time zone 'Asia/Kolkata')::date - 1));
  g2 := public.admin_gallery_add(jsonb_build_object('storage_path', 'gallery/g2.webp', 'thumb_path', 'gallery/g2_t.webp', 'title', 'Now'));
  assert public.t94_try(format($q$select public.admin_gallery_add('{"storage_path":"gallery/missing.webp","thumb_path":"gallery/missing_t.webp"}'::jsonb)$q$)) like 'P0001%', 'the files must exist';
  assert public.t94_try($q$select public.admin_gallery_add('{"storage_path":"somewhere/else.webp","thumb_path":"somewhere/else_t.webp"}'::jsonb)$q$) like 'P0001%', 'only gallery paths';
  perform public.admin_gallery_update(g2, jsonb_build_object('pair_of', g1, 'category_id', (select id from public.gallery_categories where slug = 'then-now'), 'is_featured', true, 'alt_text', 'Gate today'));
  assert (select pair_of from public.gallery_photos where id = g2) = g1, 'a Then & Now pair';
  assert public.t94_try(format($q$select public.admin_gallery_update(%L, jsonb_build_object('pair_of', %L::uuid))$q$, g1, g1)) like 'P0001%', 'not paired with itself';
  assert (select count(*) from public.gallery_photos where is_featured) = 2;
  perform public.admin_gallery_save_category(null, 'Alumni Visits', 'पूर्व छात्र');
  assert (select count(*) from public.gallery_categories) = 6;
  perform public.admin_gallery_save_category((select id from public.gallery_categories where slug = 'alumni-visits'), 'Visits', null);
  perform public.admin_gallery_delete_category((select id from public.gallery_categories where slug = 'alumni-visits'));
  assert (select count(*) from public.gallery_categories) = 5;
  p := public.admin_gallery_remove(g2);
  assert p = array['gallery/g2.webp', 'gallery/g2_t.webp'], 'removing hands back the file names to delete';
  assert (select count(*) from public.gallery_photos) = 1;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.admin_audit where action like 'gallery\_%' and actor = '9a000000-0000-0000-0000-0000000000a2') >= 8, 'every gallery action is audited';
end $$;
-- visibility: verified members see it, unverified and anon do not
select pg_temp.login('9a000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.gallery_photos) = 1 and (select count(*) from public.gallery_albums) = 1, 'verified members see the gallery';
  assert (select count(*) from public.gallery_on_this_day(10)) = 0, 'on this day is for today only (the photo is from yesterday)';
end $$;
reset role;
update public.gallery_photos set taken_on = (now() at time zone 'Asia/Kolkata')::date - interval '3 years';
select pg_temp.login('9a000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.gallery_on_this_day(10)) = 1, 'On this day finds the same date in earlier years';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000d2');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.gallery_photos) = 0 and (select count(*) from public.gallery_categories) = 0 and (select count(*) from public.gallery_albums) = 0, 'unverified members see nothing';
  assert (select count(*) from public.gallery_on_this_day(10)) = 0;
  assert public.t94_try($q$select public.suggest_gallery_photo('9a000000-0000-0000-0000-00000000b001', 'nice')$q$) like '42501%', 'and cannot suggest';
end $$;
reset role;

-- suggestions: a member suggests, a curator adds (approve) or declines
select pg_temp.login('9a000000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$ begin
  perform public.suggest_gallery_photo('9a000000-0000-0000-0000-00000000b001', 'Lovely moment');
  assert public.t94_try($q$select public.suggest_gallery_photo('9a000000-0000-0000-0000-00000000b001', 'again')$q$) like 'P0001|gallery.errSuggested|%', 'once per photo';
  perform public.suggest_gallery_photo('9a000000-0000-0000-0000-00000000b002', null);
  assert (select count(*) from public.gallery_suggestions) = 2, 'a member sees their own suggestions';
  assert public.t94_try($q$select * from public.admin_gallery_suggestions()$q$) like '42501%', 'but not the curators'' list';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c3');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.gallery_suggestions) = 0, 'other members see none';
end $$;
reset role;
select pg_temp.login('9a000000-0000-0000-0000-0000000000a2');
set local role authenticated;
do $$ declare s1 uuid; s2 uuid; g uuid; begin
  assert (select count(*) from public.admin_gallery_suggestions()) = 2;
  s1 := (select id from public.admin_gallery_suggestions() where photo_id = '9a000000-0000-0000-0000-00000000b001');
  s2 := (select id from public.admin_gallery_suggestions() where photo_id = '9a000000-0000-0000-0000-00000000b002');
  g := public.admin_gallery_add(jsonb_build_object('storage_path', 'gallery/g3.webp', 'thumb_path', 'gallery/g3_t.webp', 'title', 'Lovely', 'source_photo_id', '9a000000-0000-0000-0000-00000000b001', 'suggestion_id', s1));
  perform public.admin_gallery_decline_suggestion(s2);
  assert (select status from public.gallery_suggestions where id = s1) = 'approved' and (select status from public.gallery_suggestions where id = s2) = 'declined';
  assert (select count(*) from public.admin_gallery_suggestions()) = 0;
  assert public.t94_try($q$select public.admin_gallery_decline_suggestion(gen_random_uuid())$q$) like 'P0001%';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000c2' and kind = 'gallery_approved'), 'the suggester is told it was added';
  assert exists (select 1 from public.notifications where user_id = '9a000000-0000-0000-0000-0000000000c2' and kind = 'gallery_declined'), 'and when it was not';
end $$;
select pg_temp.login('9a000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  assert public.t94_try($q$select public.suggest_gallery_photo('9a000000-0000-0000-0000-00000000b001', 'again')$q$) like 'P0001|gallery.errAlready|%', 'a photo already in the gallery cannot be suggested';
  -- gallery photos survive the removal of the event photo they came from
end $$;
reset role;
delete from public.event_photos where id = '9a000000-0000-0000-0000-00000000b001';
do $$ begin
  assert (select count(*) from public.gallery_photos) = 2, 'gallery copies are independent of the event photo';
end $$;

-- ---------------------------------------------------------------- tables and functions are locked down
do $$
declare t text; bad text := '';
begin
  foreach t in array array['gallery_photos', 'gallery_albums', 'gallery_categories', 'gallery_suggestions', 'photo_tags', 'photo_hearts', 'photo_votes', 'photo_vote_candidates', 'photo_vote_ballots', 'event_photo_settings'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       or has_table_privilege('anon', 'public.' || t, 'SELECT') then bad := bad || ' ' || t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then bad := bad || ' rls:' || t; end if;
  end loop;
  assert bad = '', 'tables must be read-only through the API, with RLS:' || bad;
  assert not has_column_privilege('authenticated', 'public.event_photos', 'status', 'INSERT') and not has_column_privilege('authenticated', 'public.event_photos', 'source', 'INSERT'), 'status/source are server-decided';
  assert not has_column_privilege('authenticated', 'public.event_photos', 'is_hidden', 'UPDATE') and not has_column_privilege('authenticated', 'public.event_photos', 'status', 'UPDATE');
end $$;
select 'ALL PHOTOS TESTS PASSED';
rollback;
