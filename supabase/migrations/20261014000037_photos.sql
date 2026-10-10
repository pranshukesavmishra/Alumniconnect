-- PHOTOS, part 1: the event photo area ("Reunion Photos").
--
--   event_photos            + source (official | member), status (approved | pending), sort_order, caption_hi, alt_text, content_hash
--   event_photo_settings    per event: member uploads show immediately | need approval
--   photo_hearts / photo_tags / photo_votes (+ candidates, ballots)
--   permissions             gallery_manage (college gallery, part 2) and photos_moderate (approve / hide event photos)
--
-- Who may do what (the database decides, the screens only follow):
--   see photos      verified members, and people registered for that event (can_view_event_photos), never anon
--   upload          the same people. A person who holds the 'photos' capability of that event (admin with events_edit, moderation_hide or
--                   photos_moderate, or the event's content manager) uploads as OFFICIAL and is never rate-limited; everyone else uploads
--                   as a member, 60 photos an hour per event, and the photo waits for approval when the event is set to "need approval".
--   approve / hide / reorder / delete / settings / vote / zip log     the 'photos' capability
--   heart, tag, report   anyone who can see the photo; a tagged person is notified and can remove the tag
-- Every admin action is written to the activity log through public._audit.

-- ------------------------------------------------------------------ patch helper (same idea as migration 34)
create or replace function pg_temp.patch(p_fn text, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f';
  new_def := replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

-- ------------------------------------------------------------------ the two new permissions
select pg_temp.patch('_permission_catalog', $$    ('admins', 'Admins', 'See who$$,
$$    ('gallery_manage', 'Photos', 'College gallery', 'Curate the college gallery: add, edit, feature and remove photos, albums and chips, and review member suggestions.', 65),
    ('photos_moderate', 'Photos', 'Event photos', 'Approve, hide, delete and reorder event photos, choose who may upload, open photo votes and download an event photo ZIP.', 66),
    ('admins', 'Admins', 'See who$$);

-- the event "photos" capability: events_edit, moderation_hide and now photos_moderate (and the event's content manager)
select pg_temp.patch('has_event_cap', $$when 'photos' then array['events_edit', 'moderation_hide']$$,
                                       $$when 'photos' then array['events_edit', 'moderation_hide', 'photos_moderate']$$);

drop policy if exists "delete own event photos" on storage.objects;
create policy "delete own event photos" on storage.objects for delete to authenticated using (
  bucket_id = 'event-photos' and ((storage.foldername(name))[1] = auth.uid()::text
    or public._admin_can_any(array['events_edit', 'moderation_hide', 'photos_moderate'])));
-- only people who may see an event's photos may put files in its folder: <member id>/<event id>/<file>
drop policy if exists "upload own event photos" on storage.objects;
create policy "upload own event photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'event-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and case when (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$' then public.can_view_event_photos(((storage.foldername(name))[2])::uuid) else false end);

-- ------------------------------------------------------------------ event_photos
alter table public.event_photos
  add column source text not null default 'member' check (source in ('official', 'member')),
  add column status text not null default 'approved' check (status in ('approved', 'pending')),
  add column sort_order int not null default 0,
  add column caption_hi text check (char_length(caption_hi) <= 300),
  add column alt_text text check (char_length(alt_text) <= 300),
  add column content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;
create unique index event_photos_hash_unique on public.event_photos (event_id, content_hash) where content_hash is not null;
create index event_photos_status_idx on public.event_photos (event_id, status, kind);

create table public.event_photo_settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  member_uploads text not null default 'immediate' check (member_uploads in ('immediate', 'approval')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.event_photo_settings enable row level security;
create policy "viewers read photo settings" on public.event_photo_settings for select to authenticated
  using (public.can_view_event_photos(event_id) or public.has_event_cap('photos', event_id));
grant select on public.event_photo_settings to authenticated;

create or replace function public._photo_mode(p_event uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select s.member_uploads from public.event_photo_settings s where s.event_id = p_event), 'immediate');
$$;
revoke execute on function public._photo_mode(uuid) from anon, authenticated, public;

-- members insert only the columns they may choose; source / status / order / hash flags are decided here, never by the client
revoke insert on public.event_photos from authenticated;
grant insert (id, event_id, uploaded_by, storage_path, thumb_path, width, height, caption, caption_hi, alt_text, kind, content_hash) on public.event_photos to authenticated;
grant update (caption, caption_hi, alt_text) on public.event_photos to authenticated;

drop policy if exists "community sees visible photos" on public.event_photos;
create policy "community sees approved photos" on public.event_photos for select to authenticated using (
  uploaded_by = auth.uid() or public.has_event_cap('photos', event_id)
  or (not is_hidden and status = 'approved' and public.can_view_event_photos(event_id)));
drop policy if exists "community adds photos" on public.event_photos;
create policy "community adds photos" on public.event_photos for insert to authenticated with check (
  uploaded_by = auth.uid()
  and public.can_view_event_photos(event_id)
  and (exists (select 1 from public.events e where e.id = event_id and e.is_published) or public.has_event_cap('photos', event_id))
  and (public.has_event_cap('photos', event_id)
       or (select count(*) from public.event_photos p where p.event_id = event_photos.event_id and p.uploaded_by = auth.uid()) < 300));
drop policy if exists "owners or content managers delete photos" on public.event_photos;
create policy "owners or photo managers delete photos" on public.event_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_event_cap('photos', event_id));

create or replace function public._photo_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_official boolean := public.has_event_cap('photos', new.event_id);
begin
  new.source := case when v_official then 'official' else 'member' end;
  new.status := case when v_official or public._photo_mode(new.event_id) = 'immediate' then 'approved' else 'pending' end;
  new.is_hidden := false;
  new.sort_order := 0;
  new.reviewed_by := null;
  new.reviewed_at := null;
  if not v_official and (select count(*) from public.event_photos p
        where p.uploaded_by = new.uploaded_by and p.event_id = new.event_id and p.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'You can add up to 60 photos an hour. Please try again a little later.' using errcode = 'P0001', hint = 'photos.errRate';
  end if;
  return new;
end $$;
revoke execute on function public._photo_before_insert() from anon, authenticated, public;
create trigger event_photos_before_insert before insert on public.event_photos for each row execute function public._photo_before_insert();

-- an admin removing somebody else's photo is written to the activity log
create or replace function public._photo_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.uploaded_by then
    perform public._audit('delete_photo', 'event_photos', old.id, jsonb_build_object('event', old.event_id, 'source', old.source));
  end if;
  return null;
end $$;
revoke execute on function public._photo_after_delete() from anon, authenticated, public;
create trigger event_photos_after_delete after delete on public.event_photos for each row execute function public._photo_after_delete();

-- ------------------------------------------------------------------ hearts and tags
create table public.photo_hearts (
  photo_id uuid not null references public.event_photos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
alter table public.photo_hearts enable row level security;
create policy "own hearts" on public.photo_hearts for select to authenticated using (user_id = auth.uid());
grant select on public.photo_hearts to authenticated;

create table public.photo_tags (
  photo_id uuid not null references public.event_photos (id) on delete cascade,
  tagged_user uuid not null references public.profiles (id) on delete cascade,
  tagged_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, tagged_user)
);
create index photo_tags_user_idx on public.photo_tags (tagged_user);
create index photo_tags_by_idx on public.photo_tags (tagged_by, created_at);
alter table public.photo_tags enable row level security;
create policy "tags about me or by me" on public.photo_tags for select to authenticated using (tagged_user = auth.uid() or tagged_by = auth.uid());
grant select on public.photo_tags to authenticated;

-- ------------------------------------------------------------------ votes
create table public.photo_votes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  closes_at timestamptz not null,
  closed_at timestamptz,
  winner_photo uuid references public.event_photos (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index photo_votes_one_open on public.photo_votes (event_id) where closed_at is null;
create table public.photo_vote_candidates (
  vote_id uuid not null references public.photo_votes (id) on delete cascade,
  photo_id uuid not null references public.event_photos (id) on delete cascade,
  primary key (vote_id, photo_id)
);
create table public.photo_vote_ballots (
  vote_id uuid not null references public.photo_votes (id) on delete cascade,
  voter uuid not null references public.profiles (id) on delete cascade,
  photo_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (vote_id, voter),
  foreign key (vote_id, photo_id) references public.photo_vote_candidates (vote_id, photo_id) on delete cascade
);
alter table public.photo_votes enable row level security;
alter table public.photo_vote_candidates enable row level security;
alter table public.photo_vote_ballots enable row level security;
create policy "viewers read votes" on public.photo_votes for select to authenticated using (public.can_view_event_photos(event_id));
create policy "viewers read candidates" on public.photo_vote_candidates for select to authenticated
  using (exists (select 1 from public.photo_votes v where v.id = vote_id and public.can_view_event_photos(v.event_id)));
create policy "own ballot" on public.photo_vote_ballots for select to authenticated using (voter = auth.uid());
grant select on public.photo_votes, public.photo_vote_candidates, public.photo_vote_ballots to authenticated;

-- ------------------------------------------------------------------ reports: photos join the one moderation pipeline
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'profile', 'message', 'job', 'help', 'business', 'photo'));

select pg_temp.patch('_auto_hide', $$elsif new.target_type = 'comment' then update public.comments set is_hidden = true where id = new.target_id;$$,
  $$elsif new.target_type = 'comment' then update public.comments set is_hidden = true where id = new.target_id;
    elsif new.target_type = 'photo' then update public.event_photos set is_hidden = true where id = new.target_id;$$);
select pg_temp.patch('moderate', $$if not public._can_moderate('moderation_hide') then raise exception 'Only admins can moderate' using errcode = '42501'; end if;$$,
  $$if not (public._can_moderate('moderation_hide') or (p_type = 'photo' and public._admin_can('photos_moderate'))) then raise exception 'Only admins can moderate' using errcode = '42501'; end if;$$);
select pg_temp.patch('moderate', $$elsif p_type = 'business' then update public.businesses set is_hidden = p_hide where id = p_id;$$,
  $$elsif p_type = 'business' then update public.businesses set is_hidden = p_hide where id = p_id;
  elsif p_type = 'photo' then update public.event_photos set is_hidden = p_hide where id = p_id;$$);
select pg_temp.patch('admin_dismiss_reports', $$if not public._can_moderate('moderation_reports') then raise exception 'Only admins can moderate' using errcode = '42501'; end if;$$,
  $$if not (public._can_moderate('moderation_reports') or (p_type = 'photo' and public._admin_can('photos_moderate'))) then raise exception 'Only admins can moderate' using errcode = '42501'; end if;$$);
select pg_temp.patch('admin_reports', $$        when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)$$,
  $$        when 'photo' then (select coalesce(nullif(ph.caption, ''), 'Photo') || ' (' || ev.title || ')' from public.event_photos ph join public.events ev on ev.id = ph.event_id where ph.id = g.target_id)
        when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)$$);
select pg_temp.patch('admin_reports', $$        when 'profile' then g.target_id$$,
  $$        when 'photo' then (select ph.uploaded_by from public.event_photos ph where ph.id = g.target_id)
        when 'profile' then g.target_id$$);
select pg_temp.patch('admin_reports', $$        when 'business' then coalesce((select bu.is_hidden from public.businesses bu where bu.id = g.target_id), true)$$,
  $$        when 'business' then coalesce((select bu.is_hidden from public.businesses bu where bu.id = g.target_id), true)
        when 'photo' then coalesce((select ph.is_hidden from public.event_photos ph where ph.id = g.target_id), true)$$);
select pg_temp.patch('admin_reports', $$        when 'business' then 'Businesses'$$,
  $$        when 'business' then 'Businesses'
        when 'photo' then 'Event photos'$$);

create or replace function public.report_photo(p_photo uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph public.event_photos;
begin
  select * into ph from public.event_photos where id = p_photo and not is_hidden and status = 'approved';
  if not found or not public.can_view_event_photos(ph.event_id) then raise exception 'Photo not found' using errcode = '42501'; end if;
  if ph.uploaded_by = auth.uid() then raise exception 'You can’t report your own photo' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong' using errcode = 'P0001'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'photo', p_photo, left(btrim(p_reason), 500), left(coalesce(nullif(ph.caption, ''), 'Event photo'), 500))
  on conflict (reporter, target_type, target_id) do nothing;
end $$;

-- ------------------------------------------------------------------ reading
create or replace function public.photo_caps(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'view', coalesce(public.can_view_event_photos(p_event), false),
    'official', public.has_event_cap('photos', p_event),
    'gallery', public._admin_can('gallery_manage'),
    'member_uploads', public._photo_mode(p_event));
end $$;

create or replace function public.event_photos_list(
  p_event uuid, p_scope text default 'approved', p_kind text default null, p_source text default null,
  p_batch int default null, p_order text default 'curated', p_id uuid default null, p_limit int default 48, p_offset int default 0)
returns table (id uuid, event_id uuid, event_slug text, event_title text, uploaded_by uuid, uploader_name text, storage_path text, thumb_path text,
  width int, height int, caption text, caption_hi text, alt_text text, kind text, source text, status text, is_hidden boolean, sort_order int,
  created_at timestamptz, hearts int, hearted boolean, tag_count int, report_count int, tagged_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_cap boolean := false;
  v_verified boolean := public.is_verified();
begin
  if v_me is null then raise exception 'Please sign in' using errcode = '42501'; end if;
  if p_event is null then
    if p_scope <> 'tagged' then raise exception 'Choose an event' using errcode = '22023'; end if;
  else
    if not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
    v_cap := public.has_event_cap('photos', p_event);
  end if;
  if p_scope in ('pending', 'hidden', 'reported') and not v_cap then raise exception 'You do not have permission to do this' using errcode = '42501'; end if;
  return query
  select p.id, p.event_id, e.slug, e.title, p.uploaded_by, case when p.source = 'member' and (v_verified or v_cap) then u.full_name else null end,  -- names are for verified members; a registered guest sees "From members"
         p.storage_path, p.thumb_path, p.width, p.height, p.caption, p.caption_hi, p.alt_text, p.kind, p.source, p.status, p.is_hidden, p.sort_order, p.created_at,
         (select count(*)::int from public.photo_hearts h where h.photo_id = p.id),
         exists (select 1 from public.photo_hearts h where h.photo_id = p.id and h.user_id = v_me),
         (select count(*)::int from public.photo_tags t where t.photo_id = p.id),
         case when v_cap then (select count(*)::int from public.reports r where r.target_type = 'photo' and r.target_id = p.id and r.status = 'open') else 0 end,
         exists (select 1 from public.photo_tags t where t.photo_id = p.id and t.tagged_user = v_me)
    from public.event_photos p
    join public.profiles u on u.id = p.uploaded_by
    join public.events e on e.id = p.event_id
   where (p_event is null or p.event_id = p_event)
     and (p_event is not null or public.can_view_event_photos(p.event_id))
     and (p_id is null or p.id = p_id)
     and (p_kind is null or p.kind = p_kind)
     and (p_source is null or p.source = p_source)
     and case p_scope
           when 'approved' then (not p.is_hidden and p.status = 'approved') or (p_id is not null and (p.uploaded_by = v_me or v_cap))
           when 'pending' then p.status = 'pending' and not p.is_hidden
           when 'hidden' then p.is_hidden
           when 'reported' then exists (select 1 from public.reports r where r.target_type = 'photo' and r.target_id = p.id and r.status = 'open')
           when 'mine' then p.uploaded_by = v_me
           when 'tagged' then not p.is_hidden and p.status = 'approved' and exists (select 1 from public.photo_tags t where t.photo_id = p.id and t.tagged_user = v_me)
           else false end
     and (p_batch is null or exists (select 1 from public.photo_tags t join public.profiles tp on tp.id = t.tagged_user where t.photo_id = p.id and tp.grad_year = p_batch))
   order by case when p_order = 'curated' then (p.sort_order = 0) end, case when p_order = 'curated' then p.sort_order end, p.created_at desc, p.id
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.photo_summary(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved'),
    'official', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved' and p.source = 'official'),
    'members', (select count(*) from public.event_photos p where p.event_id = p_event and not p.is_hidden and p.status = 'approved' and p.source = 'member'),
    'pending', case when public.has_event_cap('photos', p_event) then (select count(*) from public.event_photos p where p.event_id = p_event and p.status = 'pending' and not p.is_hidden) end,
    'hidden', case when public.has_event_cap('photos', p_event) then (select count(*) from public.event_photos p where p.event_id = p_event and p.is_hidden) end,
    'reported', case when public.has_event_cap('photos', p_event) then (select count(distinct r.target_id) from public.reports r join public.event_photos p on p.id = r.target_id
                                                                          where r.target_type = 'photo' and r.status = 'open' and p.event_id = p_event) end);
end $$;

-- which of these file hashes does the event already hold (so the app skips duplicates before sending them)
create or replace function public.photo_hashes_taken(p_event uuid, p_hashes text[])
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
  return query select p.content_hash from public.event_photos p where p.event_id = p_event and p.content_hash = any (p_hashes);
end $$;

-- ------------------------------------------------------------------ hearts
create or replace function public.heart_photo(p_photo uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ph public.event_photos;
  v_on boolean;
begin
  select * into ph from public.event_photos where id = p_photo and not is_hidden and status = 'approved';
  if not found or not public.can_view_event_photos(ph.event_id) then raise exception 'Photo not found' using errcode = '42501'; end if;
  delete from public.photo_hearts where photo_id = p_photo and user_id = auth.uid();
  if found then v_on := false; else insert into public.photo_hearts (photo_id, user_id) values (p_photo, auth.uid()); v_on := true; end if;
  return jsonb_build_object('hearted', v_on, 'count', (select count(*) from public.photo_hearts where photo_id = p_photo));
end $$;

-- ------------------------------------------------------------------ tags
create or replace function public.tag_photo(p_photo uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph public.event_photos;
  v_title text;
  v_new int;
begin
  select * into ph from public.event_photos where id = p_photo and not is_hidden and status = 'approved';
  if not found or not public.can_view_event_photos(ph.event_id) or not public.is_verified() then raise exception 'Photo not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles t where t.id = p_user and t.onboarded and t.verification = 'verified') then
    raise exception 'You can tag verified members only' using errcode = 'P0001';
  end if;
  if public.is_blocked_between(auth.uid(), p_user) then raise exception 'You can’t tag this member' using errcode = 'P0001'; end if;
  if (select count(*) from public.photo_tags where photo_id = p_photo) >= 30 then raise exception 'This photo already has 30 tags' using errcode = 'P0001'; end if;
  if exists (select 1 from public.photo_tags where photo_id = p_photo and tagged_user = p_user) then return; end if;
  if (select count(*) from public.photo_tags t where t.tagged_by = auth.uid() and t.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You are tagging a lot of people. Please try again a little later.' using errcode = 'P0001', hint = 'photos.errTagRate';
  end if;
  insert into public.photo_tags (photo_id, tagged_user, tagged_by) values (p_photo, p_user, auth.uid()) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 and p_user <> auth.uid() then
    select e.title into v_title from public.events e where e.id = ph.event_id;
    perform public._notify(p_user, 'photo_tag', auth.uid(), p_photo, v_title);
  end if;
end $$;

create or replace function public.untag_photo(p_photo uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.photo_tags;
  ph public.event_photos;
begin
  select * into ph from public.event_photos where id = p_photo;
  select * into t from public.photo_tags where photo_id = p_photo and tagged_user = p_user;
  if not found then return; end if;
  -- the tagged person, whoever tagged them, the photo's owner, and the event's photo managers
  if auth.uid() is null or not (auth.uid() = t.tagged_user or auth.uid() = t.tagged_by or auth.uid() = ph.uploaded_by or public.has_event_cap('photos', ph.event_id)) then
    raise exception 'You can’t remove this tag' using errcode = '42501';
  end if;
  delete from public.photo_tags where photo_id = p_photo and tagged_user = p_user;
end $$;

create or replace function public.photo_tags_of(p_photo uuid)
returns table (user_id uuid, full_name text, avatar_url text, grad_year int, tagged_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_verified() or not exists (select 1 from public.event_photos p where p.id = p_photo and (p.uploaded_by = auth.uid() or public.has_event_cap('photos', p.event_id)
                   or (not p.is_hidden and p.status = 'approved' and public.can_view_event_photos(p.event_id)))) then
    raise exception 'Photo not found' using errcode = '42501';
  end if;
  return query select t.tagged_user, u.full_name, u.avatar_url, u.grad_year, t.tagged_by
                 from public.photo_tags t join public.profiles u on u.id = t.tagged_user
                where t.photo_id = p_photo order by t.created_at;
end $$;

-- ------------------------------------------------------------------ admin: settings, review, reorder, export log
create or replace function public.admin_set_photo_settings(p_event uuid, p_member_uploads text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_event_cap('photos', p_event) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  if p_member_uploads is null or p_member_uploads not in ('immediate', 'approval') then raise exception 'Choose how member photos are shown' using errcode = 'P0001'; end if;
  insert into public.event_photo_settings (event_id, member_uploads, updated_by, updated_at) values (p_event, p_member_uploads, auth.uid(), now())
  on conflict (event_id) do update set member_uploads = excluded.member_uploads, updated_by = excluded.updated_by, updated_at = now();
  perform public._audit('photo_settings', 'event_photo_settings', p_event, jsonb_build_object('member_uploads', p_member_uploads));
end $$;

create or replace function public.admin_review_photos(p_event uuid, p_ids uuid[], p_action text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  r record;
begin
  if auth.uid() is null or not public.has_event_cap('photos', p_event) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  if p_action not in ('approve', 'hide', 'unhide') then raise exception 'Unknown action' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then raise exception 'Choose between 1 and 500 photos' using errcode = 'P0001'; end if;
  if p_action = 'approve' then
    for r in update public.event_photos p set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
              where p.event_id = p_event and p.id = any (p_ids) and p.status = 'pending' returning p.id, p.uploaded_by loop
      n := n + 1;
      perform public._notify(r.uploaded_by, 'photo_approved', null, r.id, null);
    end loop;
  else
    update public.event_photos p set is_hidden = (p_action = 'hide'), reviewed_by = auth.uid(), reviewed_at = now()
     where p.event_id = p_event and p.id = any (p_ids) and p.is_hidden is distinct from (p_action = 'hide');
    get diagnostics n = row_count;
    if p_action = 'unhide' then
      update public.reports set status = 'actioned', handled_by = auth.uid() where target_type = 'photo' and target_id = any (p_ids) and status = 'open';
    end if;
  end if;
  perform public._audit('photo_' || p_action, 'event_photos', p_event, jsonb_build_object('photos', n, 'ids', to_jsonb(p_ids)));
  return n;
end $$;

create or replace function public.admin_reorder_photos(p_event uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  n int := coalesce(array_length(p_ids, 1), 0);
begin
  if auth.uid() is null or not public.has_event_cap('photos', p_event) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  if n = 0 or n > 500 then raise exception 'Choose between 1 and 500 photos' using errcode = 'P0001'; end if;
  update public.event_photos p set sort_order = sort_order + n where p.event_id = p_event and p.sort_order > 0 and not (p.id = any (p_ids));
  update public.event_photos p set sort_order = o.ord from unnest(p_ids) with ordinality as o(pid, ord) where p.id = o.pid and p.event_id = p_event;
  perform public._audit('photo_reorder', 'event_photos', p_event, jsonb_build_object('photos', n));
end $$;

create or replace function public.admin_edit_photo(p_photo uuid, p_caption text, p_caption_hi text, p_alt text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ph public.event_photos;
begin
  select * into ph from public.event_photos where id = p_photo;
  if not found or auth.uid() is null or not (ph.uploaded_by = auth.uid() or public.has_event_cap('photos', ph.event_id)) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  update public.event_photos set caption = nullif(btrim(left(p_caption, 300)), ''), caption_hi = nullif(btrim(left(p_caption_hi, 300)), ''), alt_text = nullif(btrim(left(p_alt, 300)), '')
   where id = p_photo;
  if ph.uploaded_by <> auth.uid() then perform public._audit('photo_edit', 'event_photos', p_photo, '{}'::jsonb); end if;
end $$;

create or replace function public.admin_log_photo_export(p_event uuid, p_count int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_event_cap('photos', p_event) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  perform public._audit('photo_export', 'event_photos', p_event, jsonb_build_object('photos', greatest(coalesce(p_count, 0), 0), 'format', 'zip'));
end $$;

-- ------------------------------------------------------------------ votes
create or replace function public._close_photo_vote(p_vote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.photo_votes;
  w uuid;
  ph public.event_photos;
begin
  select * into v from public.photo_votes where id = p_vote and closed_at is null for update;
  if not found then return; end if;
  select c.photo_id into w
    from public.photo_vote_candidates c
    join public.event_photos p on p.id = c.photo_id
   where c.vote_id = p_vote
   order by (select count(*) from public.photo_vote_ballots b where b.vote_id = c.vote_id and b.photo_id = c.photo_id) desc, p.created_at, p.id
   limit 1;
  if w is not null and not exists (select 1 from public.photo_vote_ballots b where b.vote_id = p_vote and b.photo_id = w) then w := null; end if; -- nobody voted
  update public.photo_votes set closed_at = now(), winner_photo = w where id = p_vote;
  if w is not null then
    select * into ph from public.event_photos where id = w;
    perform public._notify(ph.uploaded_by, 'photo_winner', null, w, v.title);
    insert into public.notifications (user_id, kind, actor_id, target_id, body)
      select b.voter, 'photo_vote_result', null, w, left(v.title, 200) from public.photo_vote_ballots b where b.vote_id = p_vote and b.voter <> ph.uploaded_by;
  end if;
end $$;
revoke execute on function public._close_photo_vote(uuid) from anon, authenticated, public;

create or replace function public.admin_open_photo_vote(p_event uuid, p_title text, p_photos uuid[], p_hours int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n int := coalesce(array_length(p_photos, 1), 0);
begin
  if auth.uid() is null or not public.has_event_cap('photos', p_event) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Give the vote a short title' using errcode = 'P0001'; end if;
  if n < 2 or n > 24 then raise exception 'Choose between 2 and 24 photos' using errcode = 'P0001'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'Choose how long the vote stays open' using errcode = 'P0001'; end if;
  if (select count(*) from public.event_photos p where p.event_id = p_event and p.id = any (p_photos) and not p.is_hidden and p.status = 'approved') <> n then
    raise exception 'Choose approved photos of this event' using errcode = 'P0001';
  end if;
  -- a vote that ran out of time is closed first, so a new one can start
  perform public._close_photo_vote(v.id) from public.photo_votes v where v.event_id = p_event and v.closed_at is null and v.closes_at <= now();
  if exists (select 1 from public.photo_votes v where v.event_id = p_event and v.closed_at is null) then raise exception 'A vote is already open for this event' using errcode = 'P0001'; end if;
  insert into public.photo_votes (event_id, title, closes_at, created_by) values (p_event, btrim(p_title), now() + make_interval(hours => p_hours), auth.uid()) returning id into v_id;
  insert into public.photo_vote_candidates (vote_id, photo_id) select v_id, x from unnest(p_photos) x;
  perform public._audit('photo_vote_open', 'photo_votes', v_id, jsonb_build_object('event', p_event, 'photos', n, 'hours', p_hours));
  return v_id;
end $$;

create or replace function public.admin_close_photo_vote(p_vote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.photo_votes;
begin
  select * into v from public.photo_votes where id = p_vote;
  if not found or auth.uid() is null or not public.has_event_cap('photos', v.event_id) then raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501'; end if;
  perform public._close_photo_vote(p_vote);
  perform public._audit('photo_vote_close', 'photo_votes', p_vote, jsonb_build_object('event', v.event_id));
end $$;

create or replace function public.cast_photo_vote(p_vote uuid, p_photo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.photo_votes;
begin
  select * into v from public.photo_votes where id = p_vote;
  if not found or auth.uid() is null or not public.can_view_event_photos(v.event_id) or not public.is_verified() then raise exception 'Vote not found' using errcode = '42501'; end if;
  if v.closed_at is null and v.closes_at <= now() then perform public._close_photo_vote(p_vote); end if;
  if v.closed_at is not null or v.closes_at <= now() then raise exception 'This vote has closed' using errcode = 'P0001', hint = 'photos.errVoteClosed'; end if;
  if not exists (select 1 from public.photo_vote_candidates c where c.vote_id = p_vote and c.photo_id = p_photo) then raise exception 'Choose one of the photos in the vote' using errcode = 'P0001'; end if;
  begin
    insert into public.photo_vote_ballots (vote_id, voter, photo_id) values (p_vote, auth.uid(), p_photo);
  exception when unique_violation then
    raise exception 'You have already voted' using errcode = 'P0001', hint = 'photos.errVoted';
  end;
end $$;

-- the open vote, or the latest finished one; closes a vote whose time has run out. Counts are shown after it closes (and to managers).
create or replace function public.current_photo_vote(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.photo_votes;
  v_cap boolean;
begin
  if auth.uid() is null or not public.can_view_event_photos(p_event) then raise exception 'Photos are for verified members and people registered for this event' using errcode = '42501'; end if;
  perform public._close_photo_vote(x.id) from public.photo_votes x where x.event_id = p_event and x.closed_at is null and x.closes_at <= now();
  select * into v from public.photo_votes x where x.event_id = p_event order by (x.closed_at is null) desc, x.created_at desc limit 1;
  if not found then return null; end if;
  v_cap := public.has_event_cap('photos', p_event);
  return jsonb_build_object('id', v.id, 'title', v.title, 'closes_at', v.closes_at, 'closed', v.closed_at is not null, 'winner', v.winner_photo,
    'my_vote', (select b.photo_id from public.photo_vote_ballots b where b.vote_id = v.id and b.voter = auth.uid()),
    'total', case when v.closed_at is not null or v_cap then (select count(*) from public.photo_vote_ballots b where b.vote_id = v.id) end,
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'thumb_path', p.thumb_path, 'storage_path', p.storage_path, 'alt', coalesce(p.alt_text, p.caption),
        'votes', case when v.closed_at is not null or v_cap then (select count(*) from public.photo_vote_ballots b where b.vote_id = v.id and b.photo_id = p.id) end) order by p.created_at, p.id), '[]'::jsonb)
        from public.photo_vote_candidates c join public.event_photos p on p.id = c.photo_id where c.vote_id = v.id));
end $$;

-- ------------------------------------------------------------------ grants: explicit, authenticated only
do $$
declare
  f text;
begin
  foreach f in array array[
    'photo_caps(uuid)', 'event_photos_list(uuid,text,text,text,int,text,uuid,int,int)', 'photo_summary(uuid)', 'photo_hashes_taken(uuid,text[])',
    'heart_photo(uuid)', 'tag_photo(uuid,uuid)', 'untag_photo(uuid,uuid)', 'photo_tags_of(uuid)', 'report_photo(uuid,text)',
    'admin_set_photo_settings(uuid,text)', 'admin_review_photos(uuid,uuid[],text)', 'admin_reorder_photos(uuid,uuid[])',
    'admin_edit_photo(uuid,text,text,text)', 'admin_log_photo_export(uuid,int)', 'admin_open_photo_vote(uuid,text,uuid[],int)',
    'admin_close_photo_vote(uuid)', 'cast_photo_vote(uuid,uuid)', 'current_photo_vote(uuid)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
