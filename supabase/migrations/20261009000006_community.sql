-- Community (product plan M5–M9, M17–M19): groups (batch / year / circle / channel), feed, comments,
-- likes, connections, follows, blocks, reports, notifications, invites + vouches, birthdays, spotlight.
-- Visibility rule of thumb: community content is for VERIFIED members (public.is_verified()).

-- ------------------------------------------------------------------ profiles additions
alter table public.profiles
  add column birth_day smallint check (birth_day between 1 and 31),
  add column birth_month smallint check (birth_month between 1 and 12),
  add constraint birthday_is_a_real_date check ((birth_day is null) = (birth_month is null)
    and (birth_day is null or birth_day <= (array[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])[birth_month])),
  add column invite_code text unique,
  add column invited_by uuid references public.profiles (id) on delete set null,
  add column message_policy text not null default 'jec' check (message_policy in ('jec', 'batch_and_connections', 'connections'));
grant update (birth_day, birth_month, message_policy) on public.profiles to authenticated;

update public.profiles set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) where invite_code is null;
alter table public.profiles alter column invite_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

-- ------------------------------------------------------------------ groups
create type public.group_kind as enum ('batch', 'year', 'circle', 'channel');
create type public.group_role as enum ('member', 'admin');

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  kind public.group_kind not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 500),
  icon text check (char_length(icon) <= 8),
  grad_year int,
  branch text,
  is_official boolean not null default false,
  is_approved boolean not null default true, -- member-proposed circles need admin approval
  created_by uuid references public.profiles (id) on delete set null,
  member_count int not null default 0,
  created_at timestamptz not null default now()
);
create index groups_kind_idx on public.groups (kind);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid());
$$;
create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid() and m.role = 'admin');
$$;

create or replace function public._group_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(member_count - 1, 0) where id = old.group_id;
  end if;
  return null;
end;
$$;
create trigger group_members_count after insert or delete on public.group_members for each row execute function public._group_count();

-- Every onboarded alumnus/student is automatically in their branch batch ("CSE 2016") and year ("JEC 2016").
create or replace function public._ensure_batch_groups(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  y_slug text;
  b_slug text;
  gid uuid;
begin
  select * into p from public.profiles where id = p_user;
  if not found or not p.onboarded or p.grad_year is null then
    return;
  end if;
  y_slug := 'jec-' || p.grad_year;
  insert into public.groups (kind, slug, name, description, icon, grad_year, is_official)
  values ('year', y_slug, 'JEC ' || p.grad_year, 'Everyone who graduated from JEC in ' || p.grad_year, '🎓', p.grad_year, true)
  on conflict (slug) do nothing;
  select id into gid from public.groups where slug = y_slug;
  insert into public.group_members (group_id, user_id) values (gid, p_user) on conflict do nothing;

  if p.branch is not null and p.branch <> 'Other' then
    b_slug := left(regexp_replace(lower(p.branch), '[^a-z0-9]+', '-', 'g'), 60) || '-' || p.grad_year;
    b_slug := regexp_replace(b_slug, '(^-+|-+$)', '', 'g');
    insert into public.groups (kind, slug, name, description, icon, grad_year, branch, is_official)
    values ('batch', b_slug, p.branch || ' ' || p.grad_year, p.branch || ', batch of ' || p.grad_year, '🏛️', p.grad_year, p.branch, true)
    on conflict (slug) do nothing;
    select id into gid from public.groups where slug = b_slug;
    insert into public.group_members (group_id, user_id) values (gid, p_user) on conflict do nothing;
  end if;
end;
$$;

create or replace function public._profile_batch_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.onboarded and (tg_op = 'INSERT' or old.onboarded is distinct from new.onboarded
       or old.grad_year is distinct from new.grad_year or old.branch is distinct from new.branch) then
    -- leave old batch groups when the batch changes
    if tg_op = 'UPDATE' and (old.grad_year is distinct from new.grad_year or old.branch is distinct from new.branch) then
      delete from public.group_members m using public.groups g
       where m.group_id = g.id and m.user_id = new.id and g.kind in ('batch', 'year');
    end if;
    perform public._ensure_batch_groups(new.id);
  end if;
  return null;
end;
$$;
create trigger profiles_batch_groups after insert or update on public.profiles for each row execute function public._profile_batch_trigger();

-- Join / leave circles and channels (batch & year groups are automatic).
create or replace function public.join_group(p_group uuid, p_join boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if not public.is_verified() then
    raise exception 'Groups are for verified members' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group;
  if not found or g.kind in ('batch', 'year') or not g.is_approved then
    raise exception 'You can’t join or leave this group';
  end if;
  if p_join then
    insert into public.group_members (group_id, user_id) values (p_group, auth.uid()) on conflict do nothing;
  else
    delete from public.group_members where group_id = p_group and user_id = auth.uid();
  end if;
end;
$$;

-- Members propose circles; admins approve. Channels are created by admins only.
create or replace function public.propose_circle(p_name text, p_description text, p_icon text)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  base text := regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g');
begin
  if not public.is_verified() then
    raise exception 'Only verified members can propose circles' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Please give the circle a name';
  end if;
  base := regexp_replace(left(base, 60), '(^-+|-+$)', '', 'g');
  insert into public.groups (kind, slug, name, description, icon, created_by, is_approved)
  values ('circle', base || '-' || substr(md5(random()::text), 1, 4), left(btrim(p_name), 80), left(nullif(btrim(p_description), ''), 500),
          left(nullif(btrim(p_icon), ''), 8), auth.uid(), public.is_admin())
  returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, auth.uid(), 'admin');
  return g;
end;
$$;

-- ------------------------------------------------------------------ blocks
create table public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

-- ------------------------------------------------------------------ posts, comments, likes
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade, -- null = all of JEC
  body text not null check (char_length(body) between 1 and 5000),
  link_url text check (link_url ~ '^https?://' and char_length(link_url) <= 1000),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4),
  is_pinned boolean not null default false,
  is_hidden boolean not null default false,
  like_count int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index posts_feed_idx on public.posts (created_at desc) where not is_hidden;
create index posts_group_idx on public.posts (group_id, created_at desc);
create index posts_author_idx on public.posts (author_id, created_at desc);

create or replace function public.can_see_group_content(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_verified() and (
    p_group is null
    or public.is_admin()
    or exists (select 1 from public.groups g where g.id = p_group and g.kind in ('channel'))  -- channels are readable by all verified
    or public.is_group_member(p_group));
$$;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create or replace function public._post_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'post_likes' then
    update public.posts set like_count = like_count + (case when tg_op = 'INSERT' then 1 else -1 end)
     where id = coalesce(new.post_id, old.post_id);
  else
    update public.posts set comment_count = comment_count + (case when tg_op = 'INSERT' then 1 else -1 end)
     where id = coalesce(new.post_id, old.post_id);
  end if;
  return null;
end;
$$;
create trigger post_likes_count after insert or delete on public.post_likes for each row execute function public._post_counts();
create trigger comments_count after insert or delete on public.comments for each row execute function public._post_counts();

-- Posting limits keep spam out: 20 posts and 100 comments a day per member.
create or replace function public._rate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if tg_table_name = 'posts' then
    select count(*) into n from public.posts where author_id = new.author_id and created_at > now() - interval '1 day';
    if n >= 20 then raise exception 'You’ve reached today’s posting limit. Please try again tomorrow.'; end if;
    if new.group_id is not null and exists (select 1 from public.groups g where g.id = new.group_id and g.kind = 'channel')
       and not public.is_group_admin(new.group_id) then
      raise exception 'Only channel admins can post here' using errcode = '42501';
    end if;
  else
    select count(*) into n from public.comments where author_id = new.author_id and created_at > now() - interval '1 day';
    if n >= 100 then raise exception 'You’ve reached today’s comment limit. Please try again tomorrow.'; end if;
  end if;
  return new;
end;
$$;
create trigger posts_rate before insert on public.posts for each row execute function public._rate_limit();
create trigger comments_rate before insert on public.comments for each row execute function public._rate_limit();

-- ------------------------------------------------------------------ connections & follows
create table public.connections (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index connections_addressee_idx on public.connections (addressee, status);
create unique index connections_pair_idx on public.connections (least(requester, addressee), greatest(requester, addressee));

create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.connections c where c.status = 'accepted'
                  and ((c.requester = a and c.addressee = b) or (c.requester = b and c.addressee = a)));
$$;

create table public.follows (
  follower uuid not null references public.profiles (id) on delete cascade,
  followee uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);

create or replace function public.request_connection(p_other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  existing public.connections;
  n int;
begin
  if not public.is_verified() then raise exception 'Only verified members can connect' using errcode = '42501'; end if;
  if p_other = auth.uid() then raise exception 'That’s you!'; end if;
  if public.is_blocked_between(auth.uid(), p_other) then raise exception 'You can’t connect with this member'; end if;
  select * into existing from public.connections
   where (requester = auth.uid() and addressee = p_other) or (requester = p_other and addressee = auth.uid());
  if found then
    if existing.status = 'accepted' then return 'connected'; end if;
    if existing.requester = p_other then -- they asked me already: accept
      update public.connections set status = 'accepted', accepted_at = now() where requester = p_other and addressee = auth.uid();
      return 'connected';
    end if;
    return 'pending';
  end if;
  select count(*) into n from public.connections where requester = auth.uid() and created_at > now() - interval '1 day';
  if n >= 30 then raise exception 'You’ve sent many requests today. Please try again tomorrow.'; end if;
  insert into public.connections (requester, addressee) values (auth.uid(), p_other);
  return 'pending';
end;
$$;

create or replace function public.respond_connection(p_other uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_accept then
    update public.connections set status = 'accepted', accepted_at = now()
     where requester = p_other and addressee = auth.uid() and status = 'pending';
  else
    delete from public.connections
     where (requester = p_other and addressee = auth.uid()) or (requester = auth.uid() and addressee = p_other);
  end if;
end;
$$;

-- (messages live in 20261009000008_chat.sql)

-- ------------------------------------------------------------------ reports
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'profile', 'message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reporter, target_type, target_id)
);

-- Three reports hide a post or comment until a moderator looks.
create or replace function public._auto_hide()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  select count(*) into n from public.reports where target_type = new.target_type and target_id = new.target_id and status = 'open';
  if n >= 3 then
    if new.target_type = 'post' then update public.posts set is_hidden = true where id = new.target_id;
    elsif new.target_type = 'comment' then update public.comments set is_hidden = true where id = new.target_id;
    end if;
  end if;
  return null;
end;
$$;
create trigger reports_auto_hide after insert on public.reports for each row execute function public._auto_hide();

create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_report_status text default 'actioned')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  if p_type = 'post' then update public.posts set is_hidden = p_hide where id = p_id;
  elsif p_type = 'comment' then update public.comments set is_hidden = p_hide where id = p_id;
  end if;
  update public.reports set status = p_report_status, handled_by = auth.uid() where target_type = p_type and target_id = p_id and status = 'open';
  perform public._audit(case when p_hide then 'hide_' else 'restore_' end || p_type, p_type || 's', p_id, jsonb_build_object('reports', p_report_status));
end;
$$;

-- ------------------------------------------------------------------ notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  actor_id uuid references public.profiles (id) on delete cascade,
  target_id uuid,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public._notify(p_user uuid, p_kind text, p_actor uuid, p_target uuid, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, actor_id, target_id, body)
  select p_user, p_kind, p_actor, p_target, left(p_body, 200)
   where p_user is not null and p_user is distinct from p_actor and not public.is_blocked_between(p_user, p_actor);
$$;

create or replace function public._notify_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'post_likes' then
    perform public._notify((select author_id from public.posts where id = new.post_id), 'like', new.user_id, new.post_id, null);
  elsif tg_table_name = 'comments' then
    perform public._notify((select author_id from public.posts where id = new.post_id), 'comment', new.author_id, new.post_id, new.body);
  elsif tg_table_name = 'connections' then
    if tg_op = 'INSERT' then
      perform public._notify(new.addressee, 'connection_request', new.requester, null, null);
    elsif new.status = 'accepted' and old.status <> 'accepted' then
      perform public._notify(new.requester, 'connection_accepted', new.addressee, null, null);
    end if;
  elsif tg_table_name = 'profiles' then
    -- someone joined using my invite
    if new.invited_by is not null and old.invited_by is null then
      perform public._notify(new.invited_by, 'invite_joined', new.id, null, null);
    end if;
  end if;
  return null;
end;
$$;
create trigger post_likes_notify after insert on public.post_likes for each row execute function public._notify_trigger();
create trigger comments_notify after insert on public.comments for each row execute function public._notify_trigger();
create trigger connections_notify after insert or update on public.connections for each row execute function public._notify_trigger();
create trigger profiles_invite_notify after update of invited_by on public.profiles for each row execute function public._notify_trigger();

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- ------------------------------------------------------------------ invites & vouches (M18, M2 route B)
create table public.vouches (
  voucher uuid not null references public.profiles (id) on delete cascade,
  member uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voucher, member),
  check (voucher <> member)
);

-- Two vouches from verified members verify a member automatically.
create or replace function public._apply_vouches(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.vouches v join public.profiles p on p.id = v.voucher
       where v.member = p_member and p.verification = 'verified') >= 2 then
    update public.profiles set verification = 'verified' where id = p_member and verification = 'pending';
  end if;
end;
$$;

create or replace function public.vouch_for(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_verified() then raise exception 'Only verified members can vouch' using errcode = '42501'; end if;
  insert into public.vouches (voucher, member) values (auth.uid(), p_member) on conflict do nothing;
  perform public._apply_vouches(p_member);
end;
$$;

-- Called once after sign-up when the member arrived through an invite link (?invite=CODE).
-- The inviter's invite counts as one vouch if the inviter is verified.
create or replace function public.claim_invite(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  inviter public.profiles;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.invited_by is not null or me.created_at < now() - interval '7 days' then return; end if;
  select * into inviter from public.profiles where invite_code = upper(btrim(p_code));
  if not found or inviter.id = me.id then return; end if;
  update public.profiles set invited_by = inviter.id where id = me.id;
  if inviter.verification = 'verified' then
    insert into public.vouches (voucher, member) values (inviter.id, me.id) on conflict do nothing;
    perform public._apply_vouches(me.id);
  end if;
end;
$$;

-- ------------------------------------------------------------------ spotlight (JECian of the Week)
create table public.spotlights (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  headline text not null check (char_length(headline) <= 160),
  story text check (char_length(story) <= 2000),
  starts_on date not null default current_date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ read-side helpers
-- Members with a birthday today or in the next 7 days, among my connections and my batch.
create or replace function public._next_birthday(p_day smallint, p_month smallint, p_today date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  y int := extract(year from p_today)::int;
  d date;
begin
  for i in 0..4 loop  -- 29 Feb only exists in leap years: look ahead until it does
    begin
      d := make_date(y + i, p_month, p_day);
      if d >= p_today then return d; end if;
    exception when others then null;
    end;
  end loop;
  return null;
end;
$$;

create or replace function public.upcoming_birthdays()
returns table (id uuid, full_name text, avatar_url text, grad_year int, branch text, birth_day smallint, birth_month smallint, days_away int)
language sql stable security definer set search_path = '' as $$
  with me as (select * from public.profiles where id = auth.uid()),
  today as (select (now() at time zone 'Asia/Kolkata')::date as t),
  cand as (
    select p.*, public._next_birthday(p.birth_day, p.birth_month, today.t) - today.t as d
      from public.profiles p, me, today
     where public.is_verified() and p.id <> me.id and p.birth_month is not null and p.birth_day is not null
       and (public.are_connected(me.id, p.id) or (me.grad_year is not null and p.grad_year = me.grad_year and p.branch is not distinct from me.branch))
  )
  select id, full_name, avatar_url, grad_year, branch, birth_day, birth_month, d::int from cand where d between 0 and 7 order by d, full_name limit 20;
$$;

-- Badges are computed, never stored, so they can't drift.
create or replace function public.member_badges(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with invites as (select count(*) n from public.profiles where invited_by = p_member and onboarded),
       p as (select * from public.profiles where id = p_member)
  select case when not public.is_verified() and p_member <> auth.uid() then '[]'::jsonb else
    coalesce(jsonb_agg(b) filter (where b is not null), '[]'::jsonb) end
  from p, invites,
  lateral (values
    (case when (select n from invites) >= 5 then jsonb_build_object('id', 'connector', 'label', 'Connector', 'hint', '5 friends joined through your invite') end),
    (case when (select n from invites) >= 25 then jsonb_build_object('id', 'champion', 'label', 'Batch Champion', 'hint', '25 friends joined through your invite') end),
    (case when p.created_at < '2027-01-01' then jsonb_build_object('id', 'founding', 'label', 'Founding Member', 'hint', 'Joined in the first season') end),
    (case when p.avatar_url is not null and p.about is not null and (p.current_title is not null or p.headline is not null) then jsonb_build_object('id', 'complete', 'label', 'All-Star Profile', 'hint', 'Profile fully completed') end),
    (case when exists (select 1 from public.event_registrations r where r.user_id = p.id and r.status = 'confirmed') then jsonb_build_object('id', 'meet2026', 'label', 'Alumni Meet 2026', 'hint', 'Registered for the meet') end)
  ) as v(b);
$$;

-- How many of a batch are on the app ("CSE 2016: 38% on board" needs the batch size from college records).
create table public.batch_sizes (
  grad_year int not null,
  branch text not null,
  total int not null check (total > 0),
  primary key (grad_year, branch)
);
create or replace function public.batch_progress(p_year int, p_branch text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'joined', (select count(*) from public.profiles where onboarded and grad_year = p_year and (p_branch is null or branch = p_branch)),
    'total', (select sum(total) from public.batch_sizes where grad_year = p_year and (p_branch is null or branch = p_branch)));
$$;

-- Top inviters (leaderboard), verified members only.
create or replace function public.invite_leaderboard(p_year int default null)
returns table (id uuid, full_name text, avatar_url text, grad_year int, branch text, joined bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url, p.grad_year, p.branch, count(i.id)
    from public.profiles p join public.profiles i on i.invited_by = p.id and i.onboarded
   where public.is_verified() and (p_year is null or p.grad_year = p_year)
   group by p.id order by count(i.id) desc, p.full_name limit 20;
$$;

-- ------------------------------------------------------------------ RLS
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.connections enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.vouches enable row level security;
alter table public.spotlights enable row level security;
alter table public.batch_sizes enable row level security;

create policy "verified see approved groups" on public.groups for select to authenticated
  using ((public.is_verified() and (is_approved or created_by = auth.uid())) or public.is_admin());
create policy "admins manage groups" on public.groups for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see members of visible groups" on public.group_members for select to authenticated
  using (user_id = auth.uid() or public.is_verified());
create policy "group admins manage members" on public.group_members for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy "own blocks" on public.blocks for all to authenticated using (blocker = auth.uid()) with check (blocker = auth.uid());

create policy "see posts" on public.posts for select to authenticated using (
  author_id = auth.uid() or public.is_admin()
  or (not is_hidden and public.can_see_group_content(group_id) and not public.is_blocked_between(auth.uid(), author_id)));
create policy "write posts" on public.posts for insert to authenticated with check (
  author_id = auth.uid() and public.is_verified() and (group_id is null or public.is_group_member(group_id) or public.is_admin()));
create policy "edit own posts" on public.posts for update to authenticated using (author_id = auth.uid() or public.is_group_admin(group_id))
  with check (author_id = auth.uid() or public.is_group_admin(group_id));
create policy "delete own posts" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin() or public.is_group_admin(group_id));

create policy "see comments" on public.comments for select to authenticated using (
  author_id = auth.uid() or public.is_admin()
  or (not is_hidden and not public.is_blocked_between(auth.uid(), author_id)
      and exists (select 1 from public.posts p where p.id = post_id and not p.is_hidden and public.can_see_group_content(p.group_id))));
create policy "write comments" on public.comments for insert to authenticated with check (
  author_id = auth.uid() and public.is_verified()
  and exists (select 1 from public.posts p where p.id = post_id and not p.is_hidden and public.can_see_group_content(p.group_id)
              and not public.is_blocked_between(auth.uid(), p.author_id)));
create policy "delete own comments" on public.comments for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "see likes" on public.post_likes for select to authenticated using (public.is_verified());
create policy "like" on public.post_likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and public.can_see_group_content(p.group_id)));
create policy "unlike" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy "own connections" on public.connections for select to authenticated using (auth.uid() in (requester, addressee));
create policy "follows visible" on public.follows for select to authenticated using (public.is_verified());
create policy "follow" on public.follows for insert to authenticated with check (follower = auth.uid() and public.is_verified());
create policy "unfollow" on public.follows for delete to authenticated using (follower = auth.uid());


create policy "file reports" on public.reports for insert to authenticated with check (reporter = auth.uid() and public.is_verified());
create policy "see own or all (admins)" on public.reports for select to authenticated using (reporter = auth.uid() or public.is_admin());

create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());

create policy "vouches visible to admins and the member" on public.vouches for select to authenticated using (member = auth.uid() or voucher = auth.uid() or public.is_admin());

create policy "verified see spotlights" on public.spotlights for select to authenticated using (public.is_verified() or public.is_admin());
create policy "admins manage spotlights" on public.spotlights for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins manage batch sizes" on public.batch_sizes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------------ grants
grant select on public.groups, public.group_members, public.posts, public.comments, public.post_likes, public.connections,
  public.follows, public.reports, public.notifications, public.vouches, public.spotlights to authenticated;
grant insert, update, delete on public.groups, public.spotlights, public.batch_sizes to authenticated;          -- RLS: admins
grant select on public.batch_sizes to authenticated;
grant update (role) on public.group_members to authenticated;                                                    -- RLS: group admins
grant select, insert, delete on public.blocks to authenticated;
grant insert, delete on public.posts, public.comments, public.post_likes, public.follows to authenticated;
grant update (body, link_url, media, edited_at, is_pinned) on public.posts to authenticated;
grant insert on public.reports to authenticated;

-- RPCs: authenticated only
do $$
declare f text;
begin
  foreach f in array array[
    'join_group(uuid, boolean)', 'propose_circle(text, text, text)', 'request_connection(uuid)', 'respond_connection(uuid, boolean)',
    'moderate(text, uuid, boolean, text)', 'mark_notifications_read()', 'vouch_for(uuid)', 'claim_invite(text)',
    'upcoming_birthdays()', 'member_badges(uuid)', 'batch_progress(int, text)', 'invite_leaderboard(int)']
  loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_group_count()', '_ensure_batch_groups(uuid)', '_profile_batch_trigger()', '_post_counts()', '_rate_limit()',
    '_auto_hide()', '_notify(uuid, text, uuid, uuid, text)', '_notify_trigger()', '_apply_vouches(uuid)', '_next_birthday(smallint, smallint, date)']
  loop
    execute format('revoke execute on function public.%s from anon, authenticated, public', f);
  end loop;
end $$;

-- Starter circles and official channels (product plan M17).
insert into public.groups (kind, slug, name, description, icon, is_official) values
  ('channel', 'jec-official', 'JEC Official', 'Announcements from the alumni association and the college', '📣', true),
  ('channel', 'placement-updates', 'Placement Updates', 'Openings and placement news for students', '💼', true),
  ('circle', 'travel', 'Travel', 'Trips, tips and travel buddies', '✈️', true),
  ('circle', 'trekking', 'Trekking', 'Treks and the outdoors', '🥾', true),
  ('circle', 'yoga', 'Yoga & Wellness', 'Yoga, meditation and staying fit', '🧘', true),
  ('circle', 'photography', 'Photography', 'Share your best shots', '📷', true),
  ('circle', 'cricket', 'Cricket', 'Matches, fantasy leagues and banter', '🏏', true),
  ('circle', 'startups', 'Startups', 'Founders, builders and investors', '🚀', true),
  ('circle', 'coding', 'Coding', 'Software, AI and tech talk', '💻', true),
  ('circle', 'music', 'Music', 'Musicians and music lovers', '🎵', true),
  ('circle', 'books', 'Books', 'What are you reading?', '📚', true),
  ('circle', 'higher-studies', 'Higher Studies Abroad', 'MS, MBA, PhD applications and life abroad', '🌍', true),
  ('circle', 'govt-exams', 'UPSC, GATE & Govt Jobs', 'Preparation, guidance and success stories', '🏛️', true),
  ('circle', 'running', 'Running & Fitness', 'Runs, marathons and fitness challenges', '🏃', true),
  ('circle', 'jabalpur', 'JECians in Jabalpur', 'Meetups and news from Jabalpur', '📍', true)
on conflict (slug) do nothing;

-- Backfill batch groups for members who onboarded before this migration.
do $$ declare r record; begin
  for r in select id from public.profiles where onboarded loop perform public._ensure_batch_groups(r.id); end loop;
end $$;

-- Admin changes to circles, the spotlight and batch sizes go in the activity log (circle creation by members is not logged).
create trigger groups_audit after update or delete on public.groups for each row execute function public._audit_config_change();
create trigger spotlights_audit after insert or update or delete on public.spotlights for each row execute function public._audit_config_change();
create trigger batch_sizes_audit after insert or update or delete on public.batch_sizes for each row execute function public._audit_config_change();
