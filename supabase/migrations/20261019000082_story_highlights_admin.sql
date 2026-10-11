-- STORIES, part 2: highlights (personal and official), reporting and moderation, the official-stories admin functions
-- (permission stories_post, written to the activity log), the optional notification, and the cleanup of old stories.
-- Idempotent and line-ending safe (patched fragments sit on one line).

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
  if position(p_to in def) > 0 then return; end if;  -- already applied
  new_def := replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

-- ------------------------------------------------------------------ reports: stories join the one moderation pipeline
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'profile', 'message', 'job', 'help', 'business', 'photo', 'story'));

select pg_temp.patch('_auto_hide', $$elsif new.target_type = 'photo' then update public.event_photos set is_hidden = true where id = new.target_id;$$,
  $$elsif new.target_type = 'photo' then update public.event_photos set is_hidden = true where id = new.target_id; elsif new.target_type = 'story' then update public.stories set is_hidden = true where id = new.target_id;$$);
select pg_temp.patch('moderate', $$elsif p_type = 'photo' then update public.event_photos set is_hidden = p_hide where id = p_id;$$,
  $$elsif p_type = 'photo' then update public.event_photos set is_hidden = p_hide where id = p_id; elsif p_type = 'story' then update public.stories set is_hidden = p_hide where id = p_id;$$);
select pg_temp.patch('admin_reports', $$when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)$$,
  $$when 'story' then (select coalesce(nullif(st.caption, ''), nullif(st.text_body, ''), 'Story (' || st.kind || ')') from public.stories st where st.id = g.target_id) when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)$$);
select pg_temp.patch('admin_reports', $$when 'photo' then (select ph.uploaded_by from public.event_photos ph where ph.id = g.target_id)$$,
  $$when 'photo' then (select ph.uploaded_by from public.event_photos ph where ph.id = g.target_id) when 'story' then (select st.owner_id from public.stories st where st.id = g.target_id)$$);
select pg_temp.patch('admin_reports', $$when 'photo' then coalesce((select ph.is_hidden from public.event_photos ph where ph.id = g.target_id), true)$$,
  $$when 'photo' then coalesce((select ph.is_hidden from public.event_photos ph where ph.id = g.target_id), true) when 'story' then coalesce((select st.is_hidden from public.stories st where st.id = g.target_id), true)$$);
select pg_temp.patch('admin_reports', $$when 'photo' then 'Event photos'$$,
  $$when 'photo' then 'Event photos' when 'story' then 'Stories'$$);

create or replace function public.report_story(p_story uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.stories;
begin
  select * into s from public.stories where id = p_story;
  if not found or not public._story_active_ok(s) then raise exception 'Story not found' using errcode = '42501'; end if;
  if s.owner_id = auth.uid() then raise exception 'You can’t report your own story' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong' using errcode = 'P0001', hint = 'stories.errReason'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'story', p_story, left(btrim(p_reason), 500),
          left(coalesce(nullif(s.caption, ''), nullif(s.text_body, ''), 'Story (' || s.kind || ')'), 500))
  on conflict (reporter, target_type, target_id) do nothing;
end $$;

-- ------------------------------------------------------------------ highlights: reading
create or replace function public._highlight_cover(h public.story_highlights)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', s.kind, 'thumb_path', s.thumb_path, 'bg_key', s.bg_key, 'text_body', left(s.text_body, 80))
    from public.stories s
   where not s.is_hidden and s.is_ready
     and s.id = coalesce((select c.id from public.stories c where c.id = h.cover_story_id and not c.is_hidden and c.is_ready),
                         (select i.story_id from public.story_highlight_items i join public.stories x on x.id = i.story_id and not x.is_hidden and x.is_ready
                           where i.highlight_id = h.id order by i.position, i.added_at limit 1));
$$;

create or replace function public.highlights_of(p_owner uuid default null, p_official boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'title', h.title, 'audience', h.audience, 'is_official', h.is_official, 'owner_id', h.owner_id,
           'mine', h.owner_id = auth.uid(), 'sort_order', h.sort_order, 'cover_story_id', h.cover_story_id,
           'count', (select count(*)::int from public.story_highlight_items i join public.stories s on s.id = i.story_id and not s.is_hidden and s.is_ready where i.highlight_id = h.id),
           'cover', public._highlight_cover(h)) order by h.sort_order, h.created_at), '[]'::jsonb)
    from public.story_highlights h
   where auth.uid() is not null and public.is_verified()
     and ((p_official and h.is_official) or (not p_official and not h.is_official and h.owner_id = p_owner))
     and public._highlight_visible(h);
$$;

create or replace function public.highlight_stories(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  h public.story_highlights;
begin
  select * into h from public.story_highlights where id = p_id;
  if not found or not public._highlight_visible(h) then raise exception 'Highlight not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'highlight', jsonb_build_object('id', h.id, 'title', h.title, 'audience', h.audience, 'is_official', h.is_official, 'owner_id', h.owner_id,
                                    'mine', h.owner_id = auth.uid(), 'cover_story_id', h.cover_story_id),
    'stories', (select coalesce(jsonb_agg(public._story_card(s) order by i.position, i.added_at), '[]'::jsonb)
                  from public.story_highlight_items i join public.stories s on s.id = i.story_id
                 where i.highlight_id = h.id and not s.is_hidden and s.is_ready));
end $$;

-- ------------------------------------------------------------------ highlights: writing (members for their own, admins for official ones)
create or replace function public._highlight_write(p_official boolean, p_id uuid, p_title text, p_audience text, p_cover uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_aud text := coalesce(nullif(p_audience, ''), 'inherit');
  h public.story_highlights;
  v_id uuid;
  v_max int;
begin
  if char_length(v_title) < 1 or char_length(v_title) > 40 then raise exception 'Give the highlight a name (up to 40 characters)' using errcode = 'P0001', hint = 'stories.errTitle'; end if;
  if v_aud not in ('inherit', 'all', 'connections') or (p_official and v_aud = 'connections') then raise exception 'Choose who can see this highlight' using errcode = 'P0001', hint = 'stories.errAudience'; end if;
  if p_id is null then
    v_max := case when p_official then 50 else 20 end;
    if (select count(*) from public.story_highlights x where x.is_official = p_official and (p_official or x.owner_id = me)) >= v_max then
      raise exception 'That is the most highlights you can keep. Remove one first.' using errcode = 'P0001', hint = 'stories.errHighlightMax';
    end if;
    insert into public.story_highlights (owner_id, is_official, title, audience, sort_order)
    values (me, p_official, v_title, v_aud,
            coalesce((select max(x.sort_order) from public.story_highlights x where x.is_official = p_official and (p_official or x.owner_id = me)), 0) + 1)
    returning id into v_id;
  else
    select * into h from public.story_highlights where id = p_id and is_official = p_official and (p_official or owner_id = me) for update;
    if not found then raise exception 'Highlight not found' using errcode = 'P0001'; end if;
    update public.story_highlights set title = v_title, audience = v_aud, updated_at = now() where id = p_id;
    v_id := p_id;
  end if;
  if p_cover is not null then
    if not exists (select 1 from public.story_highlight_items i where i.highlight_id = v_id and i.story_id = p_cover) then
      raise exception 'The cover must be one of the stories in this highlight' using errcode = 'P0001', hint = 'stories.errCover';
    end if;
    update public.story_highlights set cover_story_id = p_cover where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.save_highlight(p_id uuid, p_title text, p_audience text default 'inherit', p_cover uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Only verified members can keep highlights' using errcode = '42501'; end if;
  return public._highlight_write(false, p_id, p_title, p_audience, p_cover);
end $$;

create or replace function public.admin_highlight_save(p_id uuid, p_title text, p_audience text default 'inherit', p_cover uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public._require_perm('stories_post');
  v_id := public._highlight_write(true, p_id, p_title, p_audience, p_cover);
  perform public._audit('highlight_save', 'story_highlights', v_id, jsonb_build_object('title', left(btrim(p_title), 40), 'audience', p_audience));
  return v_id;
end $$;

-- replaces the stories of a highlight (in this order); members may only use their own stories, admins only official ones
create or replace function public._highlight_items_write(p_official boolean, p_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  h public.story_highlights;
  v_ids uuid[] := coalesce(p_ids, '{}');
begin
  select * into h from public.story_highlights where id = p_id and is_official = p_official and (p_official or owner_id = me) for update;
  if not found then raise exception 'Highlight not found' using errcode = 'P0001'; end if;
  if coalesce(array_length(v_ids, 1), 0) > 100 then raise exception 'A highlight can hold up to 100 stories' using errcode = 'P0001', hint = 'stories.errItemsMax'; end if;
  if (select count(distinct x) from unnest(v_ids) x) <> coalesce(array_length(v_ids, 1), 0) then raise exception 'A story can be in a highlight only once' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (
        select 1 from public.stories s where s.id = x and s.is_official = p_official and (p_official or s.owner_id = me) and s.is_ready)) then
    raise exception 'Story not found' using errcode = 'P0001';
  end if;
  delete from public.story_highlight_items where highlight_id = p_id and story_id <> all (v_ids);
  insert into public.story_highlight_items (highlight_id, story_id, position)
  select p_id, o.sid, o.ord from unnest(v_ids) with ordinality as o(sid, ord)
  on conflict (highlight_id, story_id) do update set position = excluded.position;
  update public.story_highlights set updated_at = now(),
         cover_story_id = case when cover_story_id = any (v_ids) then cover_story_id else null end
   where id = p_id;
end $$;

create or replace function public.set_highlight_items(p_id uuid, p_story_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Only verified members can keep highlights' using errcode = '42501'; end if;
  perform public._highlight_items_write(false, p_id, p_story_ids);
end $$;

create or replace function public.admin_highlight_items(p_id uuid, p_story_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_perm('stories_post');
  perform public._highlight_items_write(true, p_id, p_story_ids);
  perform public._audit('highlight_items', 'story_highlights', p_id, jsonb_build_object('stories', coalesce(array_length(p_story_ids, 1), 0)));
end $$;

-- adds one story at the end (a member to one of their highlights with one of their stories; an admin an official story to an official highlight)
create or replace function public.add_story_to_highlight(p_highlight uuid, p_story uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.story_highlights;
begin
  select * into h from public.story_highlights where id = p_highlight;
  if not found then raise exception 'Highlight not found' using errcode = '42501'; end if;
  if h.is_official then perform public._require_perm('stories_post'); elsif h.owner_id is distinct from auth.uid() or not public.is_verified() then
    raise exception 'Highlight not found' using errcode = '42501';
  end if;
  perform public._highlight_items_write(h.is_official, p_highlight,
    (select coalesce(array_agg(i.story_id order by i.position, i.added_at), '{}') from public.story_highlight_items i where i.highlight_id = p_highlight and i.story_id <> p_story) || p_story);
  if h.is_official then perform public._audit('highlight_items', 'story_highlights', p_highlight, jsonb_build_object('added', p_story)); end if;
end $$;

create or replace function public.delete_highlight(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Only verified members can keep highlights' using errcode = '42501'; end if;
  delete from public.story_highlights where id = p_id and owner_id = auth.uid() and not is_official;
  if not found then raise exception 'Highlight not found' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_highlight_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_perm('stories_post');
  delete from public.story_highlights where id = p_id and is_official;
  if not found then raise exception 'Highlight not found' using errcode = 'P0001'; end if;
  perform public._audit('highlight_delete', 'story_highlights', p_id, '{}'::jsonb);
end $$;

create or replace function public.reorder_highlights(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Only verified members can keep highlights' using errcode = '42501'; end if;
  update public.story_highlights h set sort_order = o.ord
    from unnest(coalesce(p_ids, '{}')) with ordinality as o(hid, ord)
   where h.id = o.hid and h.owner_id = auth.uid() and not h.is_official;
end $$;

create or replace function public.admin_highlight_reorder(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_perm('stories_post');
  update public.story_highlights h set sort_order = o.ord
    from unnest(coalesce(p_ids, '{}')) with ordinality as o(hid, ord)
   where h.id = o.hid and h.is_official;
  perform public._audit('highlight_reorder', 'story_highlights', null, jsonb_build_object('highlights', coalesce(array_length(p_ids, 1), 0)));
end $$;

-- ------------------------------------------------------------------ official stories: the admin screen
create or replace function public.admin_story_list(p_scope text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('stories_post');
  return (select coalesce(jsonb_agg(q.c order by q.ca desc), '[]'::jsonb)
            from (select public._story_card(s) || jsonb_build_object(
                    'active', s.expires_at > now() and not s.is_hidden and s.is_ready,
                    'event_title', (select e.title from public.events e where e.id = s.event_id),
                    'group_name', (select g.name from public.groups g where g.id = s.group_id),
                    'notified_at', s.notified_at, 'notified_count', s.notified_count,
                    'highlights', (select count(*)::int from public.story_highlight_items i where i.story_id = s.id)) as c,
                         s.created_at as ca
                    from public.stories s
                   where s.is_official
                     and (coalesce(p_scope, 'all') = 'all'
                          or (p_scope = 'active' and s.expires_at > now()) or (p_scope = 'expired' and s.expires_at <= now()))
                   order by s.created_at desc limit 200) q);
end $$;

-- who would be told about / can see a story with this audience (the composer shows "about N people will see this")
create or replace function public._story_recipients(p_audience text, p_event uuid, p_group uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.verification = 'verified' and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and case p_audience
           when 'all' then true
           when 'event' then exists (select 1 from public.event_registrations r where r.event_id = p_event and r.user_id = p.id and r.status in ('under_review', 'confirmed'))
           when 'group' then exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p.id)
           else false end;
$$;

create or replace function public.admin_story_audience_count(p_audience text, p_event uuid default null, p_group uuid default null)
returns int language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('stories_post');
  if p_audience not in ('all', 'event', 'group') then raise exception 'Choose who can see this story' using errcode = 'P0001', hint = 'stories.errAudience'; end if;
  return (select count(*)::int from public._story_recipients(p_audience, p_event, p_group));
end $$;

-- "also notify members": one in-app notification (and push, where it is on) per person who can see the story; one such blast an hour
create or replace function public.admin_story_notify(p_story uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.stories;
  n int;
begin
  perform public._require_perm('stories_post');
  select * into s from public.stories where id = p_story and is_official for update;
  if not found then raise exception 'Story not found' using errcode = 'P0001'; end if;
  if s.expires_at <= now() or s.is_hidden or not s.is_ready then raise exception 'This story is not live' using errcode = 'P0001', hint = 'stories.errNotLive'; end if;
  if s.notified_at is not null then raise exception 'Members were already told about this story' using errcode = 'P0001', hint = 'stories.errNotified'; end if;
  if exists (select 1 from public.stories x where x.notified_at > now() - interval '1 hour') then
    raise exception 'Only one notification an hour can be sent. Please try again later.' using errcode = 'P0001', hint = 'stories.errNotify';
  end if;
  insert into public.notifications (user_id, kind, actor_id, target_id, body)
  select r.user_id, 'story', auth.uid(), s.id, left(coalesce(nullif(s.caption, ''), nullif(s.text_body, ''), ''), 120)
    from public._story_recipients(s.audience, s.event_id, s.group_id) r
   where not public.is_blocked_between(r.user_id, auth.uid());
  get diagnostics n = row_count;
  update public.stories set notified_at = now(), notified_count = n where id = s.id;
  perform public._audit('story_notify', 'stories', s.id, jsonb_build_object('recipients', n));
  return n;
end $$;

-- ------------------------------------------------------------------ cleanup of old stories (safe to run any time, any number of times)
create schema if not exists private;
create table if not exists private.story_trash (
  path text primary key,
  queued_at timestamptz not null default now()
);
revoke all on private.story_trash from public, anon, authenticated;

-- deletes expired stories that are in no highlight (after a grace period), and videos that never finished uploading; queues their files
create or replace function public.stories_cleanup(p_grace interval default interval '2 days')
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with gone as (
    delete from public.stories s
     where (s.expires_at < now() - p_grace and not exists (select 1 from public.story_highlight_items i where i.story_id = s.id))
        or (not s.is_ready and s.created_at < now() - interval '1 day' and not exists (select 1 from public.story_highlight_items i where i.story_id = s.id))
    returning s.media_path, s.thumb_path),
  queued as (
    insert into private.story_trash (path)
    select distinct x from gone g, unnest(array[g.media_path, g.thumb_path]) x where x is not null
    on conflict do nothing returning 1)
  select count(*)::int into n from gone;
  return n;
end $$;
revoke execute on function public.stories_cleanup(interval) from public, anon, authenticated;
grant execute on function public.stories_cleanup(interval) to service_role;

-- the admin button: runs the cleanup and hands back the files to remove from storage (the app removes them with the Storage API)
create or replace function public.admin_stories_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n int;
  v_paths text[];
begin
  perform public._require_perm('stories_post');
  n := public.stories_cleanup();
  select coalesce(array_agg(t.path), '{}') into v_paths from (select path from private.story_trash order by queued_at limit 500) t;
  delete from private.story_trash where path = any (v_paths);
  perform public._audit('stories_cleanup', 'stories', null, jsonb_build_object('deleted', n, 'files', coalesce(array_length(v_paths, 1), 0)));
  return jsonb_build_object('deleted', n, 'paths', to_jsonb(v_paths));
end $$;

-- optional: a daily run where the pg_cron extension is on (Supabase: Database, Extensions). Files are removed the next time an admin opens Stories.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'jec-stories-cleanup') then
    perform cron.schedule('jec-stories-cleanup', '17 21 * * *', 'select public.stories_cleanup()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $$;

-- ------------------------------------------------------------------ grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'report_story(uuid,text)', 'highlights_of(uuid,boolean)', 'highlight_stories(uuid)', 'save_highlight(uuid,text,text,uuid)',
    'set_highlight_items(uuid,uuid[])', 'add_story_to_highlight(uuid,uuid)', 'delete_highlight(uuid)', 'reorder_highlights(uuid[])',
    'admin_highlight_save(uuid,text,text,uuid)', 'admin_highlight_items(uuid,uuid[])', 'admin_highlight_delete(uuid)', 'admin_highlight_reorder(uuid[])',
    'admin_story_list(text)', 'admin_story_audience_count(text,uuid,uuid)', 'admin_story_notify(uuid)', 'admin_stories_cleanup()'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    '_highlight_cover(public.story_highlights)', '_highlight_write(boolean,uuid,text,text,uuid)', '_highlight_items_write(boolean,uuid,uuid[])',
    '_story_recipients(text,uuid,uuid)'] loop
    execute format('revoke execute on function public.%s from anon, authenticated, public', f);
  end loop;
end $$;
