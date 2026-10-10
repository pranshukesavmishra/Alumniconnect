-- Super admins and permission-scoped admins: the foundation.
--
--   profiles.is_super_admin   owners. Implies admin and every permission. Only SECURITY DEFINER functions (and the SQL editor) change it.
--   public.admin_grants       one row per LIMITED admin: the permission keys they hold. An admin WITHOUT a row is a full admin
--                             (every admin that existed before this migration keeps working exactly as before).
--   _admin_can(perm)          the one question every admin function, row security policy and storage policy asks.
--
-- Nothing here makes anybody a super admin: the owners run the one-time snippet in docs/ADMIN_ACCESS.md after deploying.

alter table public.profiles add column if not exists is_super_admin boolean not null default false;
alter table public.profiles drop constraint if exists profiles_super_is_admin;
alter table public.profiles add constraint profiles_super_is_admin check (not is_super_admin or is_admin);
-- no column grant for is_super_admin: members cannot write it through the API (the app reads your own status with my_admin_access())

-- ------------------------------------------------------------------ the permission catalogue (the only list of valid keys)
create or replace function public._permission_catalog()
returns table (key text, grp text, label text, description text, sort int)
language sql
stable
set search_path = ''
as $$
  select * from (values
    ('members_view', 'Members', 'See members', 'Search and open members, see their details, notes, timeline and what they see; saved views.', 10),
    ('members_edit', 'Members', 'Edit members', 'Change a member''s profile and phone number, write private notes about them.', 11),
    ('members_verify', 'Members', 'Verify members', 'Approve or reject new members, one by one or in bulk.', 12),
    ('members_import', 'Members', 'Import members', 'Add many members at once from a spreadsheet.', 13),
    ('members_merge', 'Members', 'Merge duplicates', 'Find duplicate members and merge them.', 14),
    ('members_export', 'Members', 'Download member lists', 'Download member lists, with or without phone numbers and e-mail.', 15),
    ('events_create', 'Events', 'Create and delete events', 'Start a new event; delete an event that has no registrations.', 20),
    ('events_edit', 'Events', 'Edit events', 'Change event details, publish or hide an event, programme, questions, photos.', 21),
    ('events_settings', 'Events', 'Event settings', 'Per-event settings such as the Drive archive and reminders.', 22),
    ('events_tickets', 'Events', 'Tickets and fees', 'Ticket types, prices and day passes.', 23),
    ('events_team', 'Events', 'Event teams', 'Give or remove treasurer, content manager and check-in roles for an event.', 24),
    ('events_registrations', 'Events', 'Registrations and waiting list', 'See and edit registrations, waiting list, capacity, attendance report.', 25),
    ('events_checkin', 'Events', 'Check-in', 'Scan tickets at the door and use day-of tools.', 26),
    ('money_payments', 'Money', 'Verify payments', 'Approve or reject payments, record cash and bank payments, see payment proofs.', 30),
    ('money_refunds', 'Money', 'Refunds and discounts', 'Record refunds and give discounts.', 31),
    ('money_finance', 'Money', 'Finance ledger', 'The finance ledger and reconciliation report.', 32),
    ('money_exports', 'Money', 'Money exports', 'Download registration, payment and ledger lists.', 33),
    ('messages_announcements', 'Messages', 'Event announcements', 'Post announcements on an event page.', 40),
    ('messages_send', 'Messages', 'Messages to registrants', 'Send, schedule, cancel and approve messages to registrants.', 41),
    ('moderation_reports', 'Moderation', 'Reports', 'Read member reports and dismiss them.', 50),
    ('moderation_hide', 'Moderation', 'Hide and restore content', 'Hide or restore posts, comments, chat messages and hidden items.', 51),
    ('moderation_slowmode', 'Moderation', 'Slow mode', 'Slow down a busy group.', 52),
    ('moderation_meetups', 'Moderation', 'City meetups', 'Hide, close or restore city meetups.', 53),
    ('community_circles', 'Community', 'Circles and groups', 'Approve circles, manage groups and channels.', 60),
    ('community_spotlight', 'Community', 'Spotlight', 'Choose the members in the spotlight.', 61),
    ('community_batches', 'Community', 'Batch sizes', 'Set how many people each batch has.', 62),
    ('analytics', 'Insight', 'Analytics', 'Growth and activity numbers.', 70),
    ('audit', 'Insight', 'Activity log', 'Read and download the log of everything admins did.', 71),
    ('health', 'Insight', 'Health and backups', 'Backup status, errors, storage, site health.', 72),
    ('admins', 'Admins', 'See who the admins are', 'See the list of admins and owners (changing it is for super admins only).', 80)
  ) as v(key, grp, label, description, sort)
  order by sort;
$$;
revoke execute on function public._permission_catalog() from anon, authenticated, public;

-- what the app shows in the "Make admin" screen; any admin may read it, members may not
create or replace function public.admin_permission_catalog()
returns table (key text, grp text, label text, description text, sort int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can view this' using errcode = '42501';
  end if;
  return query select c.key, c.grp, c.label, c.description, c.sort from public._permission_catalog() c;
end;
$$;
revoke execute on function public.admin_permission_catalog() from anon, public;
grant execute on function public.admin_permission_catalog() to authenticated;

-- ------------------------------------------------------------------ grants table
create table public.admin_grants (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  permissions text[] not null default '{}',
  note text,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_grants enable row level security;

-- ------------------------------------------------------------------ the checks
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- true when the signed-in person holds ANY of the permissions. A trailing * matches a whole family ('events_*').
-- Super admins hold everything; an admin without a grants row is a full admin (the way every admin was before limited admins existed).
create or replace function public._admin_can_any(p_perms text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_super_admin
        or (p.is_admin and (g.user_id is null or exists (
              select 1 from unnest(p_perms) q
               where q = any (g.permissions)
                  or (right(q, 1) = '*' and exists (select 1 from unnest(g.permissions) k where left(k, length(q) - 1) = left(q, length(q) - 1))))))
      from public.profiles p
      left join public.admin_grants g on g.user_id = p.id
     where p.id = auth.uid()), false);
$$;

create or replace function public._admin_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._admin_can_any(array[p_perm]);
$$;

create or replace function public._require_perm(p_perm text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public._admin_can(p_perm) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
end;
$$;

-- row security policies call these as the signed-in role, so both roles may run them (they only ever answer about the caller)
revoke execute on function public.is_super_admin() from public;
revoke execute on function public._admin_can_any(text[]) from public;
revoke execute on function public._admin_can(text) from public;
revoke execute on function public._require_perm(text) from public, anon, authenticated;
grant execute on function public.is_super_admin() to anon, authenticated;
grant execute on function public._admin_can_any(text[]) to anon, authenticated;
grant execute on function public._admin_can(text) to anon, authenticated;

create policy "own grants and super admins" on public.admin_grants for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
grant select on public.admin_grants to authenticated;
-- no insert / update / delete for anyone through the API: only admin_set_admin writes this table

-- your own access, for the app to decide which tiles and buttons to show (the database enforces it either way)
create or replace function public.my_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  g public.admin_grants;
  v_full boolean;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.is_admin then
    return jsonb_build_object('is_admin', false, 'is_super', false, 'full', false, 'permissions', '[]'::jsonb);
  end if;
  select * into g from public.admin_grants where user_id = p.id;
  v_full := p.is_super_admin or not found;
  return jsonb_build_object('is_admin', true, 'is_super', p.is_super_admin, 'full', v_full,
    'permissions', case when v_full then (select coalesce(jsonb_agg(c.key order by c.sort), '[]'::jsonb) from public._permission_catalog() c)
                        else to_jsonb(g.permissions) end);
end;
$$;
revoke execute on function public.my_admin_access() from anon, public;
grant execute on function public.my_admin_access() to authenticated;

-- ------------------------------------------------------------------ nothing can lock the organisation out
create or replace function public._keep_one_super()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- two owners stepping down at the same moment must not both succeed: take turns
  perform pg_advisory_xact_lock(hashtext('jec_super_admins'));
  if old.is_super_admin and (tg_op = 'DELETE' or not new.is_super_admin)
     and not exists (select 1 from public.profiles p where p.is_super_admin and p.id <> old.id) then
    raise exception 'There must always be at least one super admin.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public._keep_one_super() from anon, authenticated, public;
create trigger profiles_keep_one_super before update of is_super_admin on public.profiles for each row execute function public._keep_one_super();
create trigger profiles_keep_one_super_delete before delete on public.profiles for each row execute function public._keep_one_super();

-- a profile that stops being an admin loses its permission row
create or replace function public._drop_grants_with_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_admin and not new.is_admin then
    delete from public.admin_grants where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public._drop_grants_with_admin() from anon, authenticated, public;
create trigger profiles_drop_grants after update of is_admin on public.profiles for each row execute function public._drop_grants_with_admin();
