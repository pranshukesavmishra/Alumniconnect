-- Department-wide groups: one OFFICIAL group everybody is in (announcements: only staff post, members read, react and may comment)
-- and one DEPARTMENT group per branch (all batches together). Members are put in automatically and moved when their branch changes.
-- Admin controls (permission community_circles): group admins, post mode, name/description, counts.

alter table public.groups
  add column if not exists post_mode text not null default 'everyone' check (post_mode in ('everyone', 'staff_only')),
  add column if not exists comments_allowed boolean not null default true;

-- ------------------------------------------------------------------ who is staff of a group, and what members may do in it
-- staff = a platform admin who holds community_circles, a moderator, or the group's own admin
create or replace function public.is_group_staff(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_group_admin(p_group) or public.is_moderator();
$$;

create or replace function public.group_allows_post(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.groups g where g.id = p_group and g.post_mode = 'staff_only') or public.is_group_staff(p_group);
$$;

create or replace function public.group_allows_comment(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_group is null
      or not exists (select 1 from public.groups g where g.id = p_group and g.post_mode = 'staff_only' and not g.comments_allowed)
      or public.is_group_staff(p_group);
$$;

-- members of a staff_only group may answer (reply to a message) when comments are on
create or replace function public.can_comment_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c join public.groups g on g.id = c.group_id
     where c.id = p_chat and c.kind = 'group' and g.post_mode = 'staff_only' and g.comments_allowed
       and public.is_verified() and public.is_group_member(g.id));
$$;

create or replace function public.can_post_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c left join public.groups g on g.id = c.group_id
     where c.id = p_chat and (
       (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b) and public.is_verified()
          and not public.is_blocked_between(c.dm_a, c.dm_b))
       or (c.kind = 'group' and public.is_verified() and (
             (g.kind = 'channel' and public.is_group_admin(c.group_id))
             or (g.kind <> 'channel' and public.is_group_member(c.group_id) and public.group_allows_post(c.group_id)))
           and not exists (select 1 from public.city_meetups mt where mt.group_id = c.group_id and mt.status <> 'active'))
     ));
$$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'send_message' and p.pronamespace = 'public'::regnamespace;
  if position('not public.can_post_chat(p_chat)' in d) = 0 then raise exception 'send_message patch target missing'; end if;
  execute replace(d, 'not public.can_post_chat(p_chat)', 'not (public.can_post_chat(p_chat) or (p_reply_to is not null and public.can_comment_chat(p_chat)))');

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'join_group' and p.pronamespace = 'public'::regnamespace;
  if position('''batch'', ''year'', ''meetup''' in d) = 0 then raise exception 'join_group patch target missing'; end if;
  execute replace(d, '''batch'', ''year'', ''meetup''', '''batch'', ''year'', ''meetup'', ''official'', ''department''');

  -- my_chats: two more columns (the group's post mode, and whether I may answer in an announcements-style group)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'my_chats' and p.pronamespace = 'public'::regnamespace;
  if position('slow_mode_seconds integer)' in d) = 0 or position('coalesce(g.slow_mode_seconds, 0)' in d) = 0 then raise exception 'my_chats patch target missing'; end if;
  drop function public.my_chats(uuid);
  d := replace(d, 'slow_mode_seconds integer)', 'slow_mode_seconds integer, post_mode text, can_reply boolean)');
  d := replace(d, 'coalesce(g.slow_mode_seconds, 0)', 'coalesce(g.slow_mode_seconds, 0), coalesce(g.post_mode, ''everyone''), public.can_comment_chat(c.id)');
  execute d;
end $$;
revoke execute on function public.my_chats(uuid) from public, anon;
grant execute on function public.my_chats(uuid) to authenticated;

-- feed posts and comments follow the same rule
drop policy "write posts" on public.posts;
create policy "write posts" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and public.is_verified()
    and (group_id is null or ((public.is_group_member(group_id) or public._admin_can('community_circles')) and public.group_allows_post(group_id))));
drop policy "write comments" on public.comments;
create policy "write comments" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_verified() and exists (
    select 1 from public.posts p
     where p.id = comments.post_id and not p.is_hidden and public.can_see_group_content(p.group_id)
       and public.group_allows_comment(p.group_id) and not public.is_blocked_between(auth.uid(), p.author_id)));

-- ------------------------------------------------------------------ the groups themselves
create or replace function public._department_name(p_branch text)
returns text language sql immutable set search_path = '' as $$
  select case when p_branch ~ '^B\.E\. ' then regexp_replace(p_branch, '^B\.E\. (in )?', '') || ' Department'
              when p_branch ~ '^M\.E\. in ' then regexp_replace(p_branch, '^M\.E\. in ', '') || ' (M.E.) Department'
              else p_branch || ' Department' end;
$$;
create or replace function public._department_slug(p_branch text)
returns text language sql immutable set search_path = '' as $$
  select 'dept-' || trim(both '-' from left(regexp_replace(lower(p_branch), '[^a-z0-9]+', '-', 'g'), 60));
$$;

insert into public.groups (kind, slug, name, description, icon, is_official, post_mode)
values ('official', 'jec-alumni-connect-official', 'JEC Alumni Connect · Official',
        'Announcements from the JEC Alumni Connect team. Everyone is here; the team posts, you can read and react.', '📣', true, 'staff_only')
on conflict (slug) do nothing;

insert into public.groups (kind, slug, name, description, icon, branch, is_official, post_mode)
select 'department', public._department_slug(b), public._department_name(b),
       'Everyone from ' || b || ', all batches together.', '🏛️', b, true, 'everyone'
  from unnest(array[
    'B.E. in Electronics & Telecommunications', 'B.E. in Computer Science & Engineering', 'B.E. in Mechanical Engineering',
    'B.E. in Information Technology', 'B.E. in Electrical Engineering', 'B.E. in Civil Engineering',
    'B.E. Industrial & Production Engineering', 'M.E. in Structural Engineering', 'M.E. in Communication Systems',
    'M.E. in Environmental Engineering', 'M.E. in High Voltage Engineering', 'M.E. in Power Systems Engineering',
    'M.E. in Heat Power Engineering / Machine Design', 'MCA', 'Artificial Intelligence & Data Science', 'Mechatronics',
    'M.E. / M.Tech. (other specialisation)', 'M.Sc. (Applied Sciences)']) b
on conflict (slug) do nothing;

-- Everyone onboarded is in the official group and in the department of their branch (moved when the branch changes; admins of a department stay).
create or replace function public._ensure_department_groups(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_user;
  if not found or not p.onboarded then return; end if;
  insert into public.group_members (group_id, user_id)
  select g.id, p_user from public.groups g where g.kind = 'official' on conflict do nothing;
  delete from public.group_members m using public.groups g
   where m.group_id = g.id and m.user_id = p_user and g.kind = 'department' and m.role = 'member' and g.branch is distinct from p.branch;
  insert into public.group_members (group_id, user_id)
  select g.id, p_user from public.groups g where g.kind = 'department' and g.branch = p.branch on conflict do nothing;
end;
$$;

create or replace function public._profile_department_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.onboarded and (tg_op = 'INSERT' or old.onboarded is distinct from new.onboarded or old.branch is distinct from new.branch) then
    perform public._ensure_department_groups(new.id);
  end if;
  return null;
end;
$$;
create trigger profiles_department_groups after insert or update of onboarded, branch on public.profiles
  for each row execute function public._profile_department_trigger();

-- backfill every existing member
insert into public.group_members (group_id, user_id)
select g.id, p.id from public.profiles p join public.groups g on g.kind = 'official' where p.onboarded on conflict do nothing;
insert into public.group_members (group_id, user_id)
select g.id, p.id from public.profiles p join public.groups g on g.kind = 'department' and g.branch = p.branch where p.onboarded on conflict do nothing;

-- ------------------------------------------------------------------ admin controls (permission community_circles)
create or replace function public.admin_department_groups()
returns table (id uuid, kind text, slug text, name text, description text, icon text, branch text, post_mode text,
               comments_allowed boolean, slow_mode_seconds int, member_count int, admins jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('community_circles');
  return query
  select g.id, g.kind::text, g.slug, g.name, g.description, g.icon, g.branch, g.post_mode, g.comments_allowed, g.slow_mode_seconds, g.member_count,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', pr.full_name) order by pr.full_name)
                     from public.group_members m join public.profiles pr on pr.id = m.user_id
                    where m.group_id = g.id and m.role = 'admin'), '[]'::jsonb)
    from public.groups g
   where g.kind::text in ('official', 'department')
   order by (g.kind::text = 'official') desc, g.name;
end;
$$;

create or replace function public.admin_update_group(p_group uuid, p_name text, p_description text, p_post_mode text, p_comments_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  perform public._require_perm('community_circles');
  select * into g from public.groups where id = p_group;
  if not found or g.kind::text not in ('official', 'department', 'batch', 'year', 'circle', 'channel') then raise exception 'Group not found'; end if;
  if coalesce(btrim(p_name), '') = '' or char_length(btrim(p_name)) not between 2 and 80 then raise exception 'The name needs 2 to 80 letters'; end if;
  if char_length(coalesce(p_description, '')) > 500 then raise exception 'The description is too long (500 letters at most)'; end if;
  if p_post_mode not in ('everyone', 'staff_only') then raise exception 'Choose who may post'; end if;
  update public.groups set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
         post_mode = p_post_mode, comments_allowed = coalesce(p_comments_allowed, comments_allowed)
   where id = p_group;
  perform public._audit('update_group', 'groups', p_group, jsonb_build_object(
    'name', jsonb_build_object('from', g.name, 'to', btrim(p_name)),
    'post_mode', jsonb_build_object('from', g.post_mode, 'to', p_post_mode),
    'comments_allowed', jsonb_build_object('from', g.comments_allowed, 'to', coalesce(p_comments_allowed, g.comments_allowed))));
end;
$$;

create or replace function public.admin_set_group_admin(p_group uuid, p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  pr public.profiles;
begin
  perform public._require_perm('community_circles');
  select * into g from public.groups where id = p_group;
  if not found or g.kind::text not in ('official', 'department', 'batch', 'year', 'circle', 'channel') then raise exception 'Group not found'; end if;
  select * into pr from public.profiles where id = p_user;
  if not found or not pr.onboarded then raise exception 'Member not found'; end if;
  if p_admin then
    insert into public.group_members (group_id, user_id, role) values (p_group, p_user, 'admin')
    on conflict (group_id, user_id) do update set role = 'admin';
    perform public._notify(p_user, 'group_admin', auth.uid(), p_group, 'You are now an admin of ' || g.name || '. You can pin and remove messages and use slow mode.');
  else
    update public.group_members set role = 'member' where group_id = p_group and user_id = p_user;
  end if;
  perform public._audit(case when p_admin then 'group_admin_added' else 'group_admin_removed' end, 'groups', p_group,
    jsonb_build_object('user', p_user, 'name', pr.full_name, 'group', g.name));
end;
$$;

revoke execute on function public.is_group_staff(uuid), public.group_allows_post(uuid), public.group_allows_comment(uuid), public.can_comment_chat(uuid),
  public._ensure_department_groups(uuid), public._profile_department_trigger(), public._department_name(text), public._department_slug(text),
  public.admin_department_groups(), public.admin_update_group(uuid, text, text, text, boolean), public.admin_set_group_admin(uuid, uuid, boolean)
  from public, anon, authenticated;
-- policies call the helper functions as the signed-in member
grant execute on function public.group_allows_post(uuid), public.group_allows_comment(uuid), public.can_comment_chat(uuid), public.is_group_staff(uuid) to authenticated;
grant execute on function public.admin_department_groups(), public.admin_update_group(uuid, text, text, text, boolean),
  public.admin_set_group_admin(uuid, uuid, boolean) to authenticated;
