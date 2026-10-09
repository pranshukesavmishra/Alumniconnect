-- Admin pass 4: granular roles enforced in the database, moderation, message safety, unified inbox, audit search, view-as-member.
--
-- Roles
--   admin           profiles.is_admin: everything.
--   treasurer       per event: payments, refunds, finance ledger, registrations, waiting list, capacity, attendance.
--   content         per event: messages to attendees, programme, announcements, event questions, photos.
--   checkin         per event: scan tickets and see names (as before).
--   moderator       site-wide (site_roles): reports, hide content, slow mode, hide city meetups.
-- The old all-purpose event "manager" is gone: existing manager rows became treasurer + content for the same event, so
-- nobody loses access. Inserting 'manager' still works (a compatibility trigger writes the two new rows) so older
-- scripts keep working, but the app and every function check the specific capability.

-- ------------------------------------------------------------------ event_staff: several roles per person and event
drop trigger if exists event_staff_audit on public.event_staff;
drop policy if exists "staff see staff list" on public.event_staff;
drop policy if exists "admins manage staff" on public.event_staff;

alter table public.event_staff drop constraint event_staff_pkey;
alter table public.event_staff alter column role drop default;
alter table public.event_staff alter column role type text using role::text;
alter table public.event_staff alter column role set default 'checkin';
alter table public.event_staff add column if not exists granted_by uuid references public.profiles (id) on delete set null;
alter table public.event_staff add column if not exists granted_at timestamptz not null default now();

-- existing managers keep what they could do: finance and registrations (treasurer) plus messages and programme (content)
insert into public.event_staff (event_id, user_id, role, granted_at)
  select event_id, user_id, 'content', now() from public.event_staff where role = 'manager';
update public.event_staff set role = 'treasurer' where role = 'manager';

alter table public.event_staff add constraint event_staff_role_check check (role in ('checkin', 'treasurer', 'content'));
alter table public.event_staff add primary key (event_id, user_id, role);
create index if not exists event_staff_user_idx on public.event_staff (user_id);

create or replace function public._event_staff_legacy_manager()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'manager' then
    insert into public.event_staff (event_id, user_id, role, granted_by)
      values (new.event_id, new.user_id, 'treasurer', new.granted_by), (new.event_id, new.user_id, 'content', new.granted_by)
      on conflict do nothing;
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public._event_staff_legacy_manager() from anon, authenticated, public;
create trigger event_staff_legacy_manager before insert on public.event_staff for each row execute function public._event_staff_legacy_manager();

-- Site-wide roles that are not tied to one event.
create table public.site_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('moderator')),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.site_roles enable row level security;
alter table public.event_staff enable row level security;

-- ------------------------------------------------------------------ capability helpers
create or replace function public.has_event_cap(p_cap text, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.event_staff s
     where s.event_id = p_event and s.user_id = auth.uid()
       and s.role = any (case p_cap
         when 'finance' then array['treasurer']
         when 'registrations' then array['treasurer']
         when 'messages' then array['content']
         when 'programme' then array['content']
         when 'manage' then array['treasurer', 'content']
         when 'checkin' then array['checkin', 'treasurer', 'content']
         else array[]::text[] end));
$$;

create or replace function public.is_event_manager(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_event_cap('manage', p_event);
$$;

create or replace function public.is_event_staff(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_event_cap('checkin', p_event);
$$;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (select 1 from public.site_roles r where r.user_id = auth.uid() and r.role = 'moderator');
$$;

drop function if exists public.event_role(uuid);
drop type if exists public.staff_role;

revoke execute on function public.has_event_cap(text, uuid) from anon, public;
revoke execute on function public.is_moderator() from anon, public;
grant execute on function public.has_event_cap(text, uuid) to authenticated;
grant execute on function public.is_moderator() to authenticated;

-- people see their own roles; admins see everyone's. Nobody writes these tables directly: only admin_grant_role / admin_revoke_role.
create policy "own roles or admin" on public.event_staff for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "own site roles or admin" on public.site_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.event_staff from authenticated;
grant select on public.site_roles to authenticated;

-- ------------------------------------------------------------------ point every function at the specific capability
do $$
declare
  r record;
  def text;
  new_def text;
begin
  for r in
    select * from (values
      ('_sanitized_registration', 'finance'), ('admin_apply_discount', 'finance'), ('admin_event_ledger', 'finance'),
      ('admin_event_ledger_rows', 'finance'), ('admin_record_refund', 'finance'), ('admin_set_registration_status', 'finance'),
      ('admin_transfer_registration', 'finance'), ('admin_update_registration', 'finance'), ('record_offline_payment', 'finance'),
      ('review_payment', 'finance'), ('admin_search', 'finance'),
      ('admin_add_waitlist', 'registrations'), ('admin_attendance_report', 'registrations'), ('admin_event_ops', 'registrations'),
      ('admin_promote_waitlist', 'registrations'), ('admin_remove_waitlist', 'registrations'), ('admin_run_waitlist', 'registrations'),
      ('admin_save_event_ops', 'registrations'), ('admin_waitlist', 'registrations'),
      ('admin_cancel_event_message', 'messages'), ('admin_send_due_messages', 'messages'),
      ('post_announcement', 'programme'), ('moderate_photo', 'programme')
    ) as v(fn, cap)
  loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if def is null then raise exception 'function % not found', r.fn; end if;
    new_def := replace(def, 'public.is_event_manager(', format('public.has_event_cap(%L, ', r.cap));
    if r.fn = 'admin_search' then
      new_def := replace(new_def, 's.role = ''manager''', 's.role = ''treasurer''');
    end if;
    if r.fn = 'admin_cancel_event_message' then
      new_def := replace(new_def, 'if m.status <> ''scheduled'' then', 'if m.status not in (''scheduled'', ''pending_approval'') then');
    end if;
    if new_def = def then raise exception 'function % had nothing to replace', r.fn; end if;
    execute new_def;
  end loop;

  -- moderation: moderators as well as admins
  for r in select * from (values ('admin_reports'), ('admin_dismiss_reports'), ('admin_remove_message'), ('moderate'), ('admin_set_meetup')) as v(fn)
  loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    new_def := replace(def, 'public.is_admin()', 'public.is_moderator()');
    if new_def = def then raise exception 'function % had nothing to replace', r.fn; end if;
    execute new_def;
  end loop;
end $$;

-- policies
drop policy if exists "managers write programme" on public.event_programme;
create policy "content managers write programme" on public.event_programme for all to authenticated
  using (public.has_event_cap('programme', event_id)) with check (public.has_event_cap('programme', event_id));
drop policy if exists "managers write announcements" on public.event_announcements;
create policy "content managers write announcements" on public.event_announcements for all to authenticated
  using (public.has_event_cap('programme', event_id)) with check (public.has_event_cap('programme', event_id));
drop policy if exists "managers manage questions" on public.event_questions;
create policy "content managers manage questions" on public.event_questions for all to authenticated
  using (public.has_event_cap('programme', event_id)) with check (public.has_event_cap('programme', event_id));
drop policy if exists "own registration or manager" on public.event_registrations;
create policy "own registration or treasurer" on public.event_registrations for select to authenticated
  using (user_id = auth.uid() or public.has_event_cap('finance', event_id));
drop policy if exists "own items or managers" on public.event_registration_items;
create policy "own items or treasurers" on public.event_registration_items for select to authenticated using (
  exists (select 1 from public.event_registrations r where r.id = event_registration_items.registration_id
          and (r.user_id = auth.uid() or public.has_event_cap('finance', r.event_id))));
drop policy if exists "own payments or managers" on public.event_payments;
create policy "own payments or treasurers" on public.event_payments for select to authenticated using (
  exists (select 1 from public.event_registrations r where r.id = event_payments.registration_id
          and (r.user_id = auth.uid() or public.has_event_cap('finance', r.event_id))));
drop policy if exists "read own payment proof or managers" on storage.objects;
create policy "read own payment proof or treasurers" on storage.objects for select to authenticated using (
  bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.event_payments p join public.event_registrations r on r.id = p.registration_id
                where p.proof_path = objects.name and public.has_event_cap('finance', r.event_id))));
drop policy if exists "owners or staff delete photos" on public.event_photos;
create policy "owners or content managers delete photos" on public.event_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_event_cap('programme', event_id));
drop policy if exists "managers read messages" on public.event_messages;
create policy "content managers read messages" on public.event_messages for select to authenticated using (public.has_event_cap('messages', event_id));
drop policy if exists "managers read message recipients" on public.event_message_recipients;
create policy "content managers read message recipients" on public.event_message_recipients for select to authenticated using (
  exists (select 1 from public.event_messages m where m.id = message_id and public.has_event_cap('messages', m.event_id)));
drop policy if exists "managers read refunds" on public.event_refunds;
create policy "treasurers read refunds" on public.event_refunds for select to authenticated using (
  exists (select 1 from public.event_registrations r where r.id = registration_id and public.has_event_cap('finance', r.event_id)));
drop policy if exists "own waitlist or managers" on public.event_waitlist;
create policy "own waitlist or treasurers" on public.event_waitlist for select to authenticated
  using (user_id = auth.uid() or public.has_event_cap('registrations', event_id));
drop policy if exists "managers read event ops" on public.event_ops;
create policy "treasurers read event ops" on public.event_ops for select to authenticated using (public.has_event_cap('registrations', event_id));
drop policy if exists "managers read day capacity" on public.event_day_capacity;
create policy "treasurers read day capacity" on public.event_day_capacity for select to authenticated using (public.has_event_cap('registrations', event_id));

-- ------------------------------------------------------------------ at least one admin, always
create or replace function public._keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_admin and not new.is_admin and not exists (select 1 from public.profiles p where p.is_admin and p.id <> old.id) then
    raise exception 'There must always be at least one admin.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public._keep_one_admin() from anon, authenticated, public;
create trigger profiles_keep_one_admin before update of is_admin on public.profiles for each row execute function public._keep_one_admin();

-- ------------------------------------------------------------------ granting and removing roles (admins only)
create or replace function public.admin_grant_role(p_user uuid, p_role text, p_event uuid default null, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_title text;
  v_changed boolean := false;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can give roles' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'moderator', 'treasurer', 'content', 'checkin') then raise exception 'Unknown role.'; end if;
  select full_name into v_name from public.profiles where id = p_user;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_role in ('treasurer', 'content', 'checkin') then
    select title into v_title from public.events where id = p_event;
    if not found then raise exception 'Choose the event this role is for.'; end if;
    insert into public.event_staff (event_id, user_id, role, granted_by) values (p_event, p_user, p_role, auth.uid()) on conflict do nothing;
    v_changed := found;
  elsif p_role = 'moderator' then
    insert into public.site_roles (user_id, role, granted_by) values (p_user, 'moderator', auth.uid()) on conflict do nothing;
    v_changed := found;
  else
    update public.profiles set is_admin = true where id = p_user and not is_admin;
    v_changed := found;
  end if;
  if v_changed then
    perform public._audit('role_grant', 'profiles', p_user,
      jsonb_build_object('role', p_role, 'name', v_name, 'event_id', p_event, 'event', v_title, 'note', v_note));
  end if;
  return v_changed;
end;
$$;

create or replace function public.admin_revoke_role(p_user uuid, p_role text, p_event uuid default null, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_title text;
  v_changed boolean := false;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can remove roles' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'moderator', 'treasurer', 'content', 'checkin') then raise exception 'Unknown role.'; end if;
  select full_name into v_name from public.profiles where id = p_user;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_role in ('treasurer', 'content', 'checkin') then
    select title into v_title from public.events where id = p_event;
    delete from public.event_staff where user_id = p_user and event_id = p_event and role = p_role;
    v_changed := found;
  elsif p_role = 'moderator' then
    delete from public.site_roles where user_id = p_user and role = 'moderator';
    v_changed := found;
  else
    if p_user = auth.uid() then
      raise exception 'You cannot remove your own admin access. Ask another admin.';
    end if;
    if (select count(*) from public.profiles where is_admin) <= 1 then
      raise exception 'There must always be at least one admin.';
    end if;
    update public.profiles set is_admin = false where id = p_user and is_admin;
    v_changed := found;
  end if;
  if v_changed then
    perform public._audit('role_revoke', 'profiles', p_user,
      jsonb_build_object('role', p_role, 'name', v_name, 'event_id', p_event, 'event', v_title, 'note', v_note));
  end if;
  return v_changed;
end;
$$;

create or replace function public.admin_roles_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                 'grad_year', p.grad_year, 'branch', p.branch) order by p.full_name), '[]'::jsonb)
                 from public.profiles p where p.is_admin),
    'moderators', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                 'grad_year', p.grad_year, 'branch', p.branch, 'granted_at', r.granted_at) order by p.full_name), '[]'::jsonb)
                 from public.site_roles r join public.profiles p on p.id = r.user_id where r.role = 'moderator'),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                 'role', s.role, 'event_id', e.id, 'event_slug', e.slug, 'event_title', e.title, 'is_admin', p.is_admin, 'granted_at', s.granted_at)
                 order by e.starts_at desc nulls last, s.role, p.full_name), '[]'::jsonb)
                 from public.event_staff s
                 join public.profiles p on p.id = s.user_id
                 join public.events e on e.id = s.event_id),
    'circle_admins', (select count(*) from public.group_members where role = 'admin'));
end;
$$;

revoke execute on function public.admin_grant_role(uuid, text, uuid, text) from anon, public;
revoke execute on function public.admin_revoke_role(uuid, text, uuid, text) from anon, public;
grant execute on function public.admin_grant_role(uuid, text, uuid, text) to authenticated;
grant execute on function public.admin_revoke_role(uuid, text, uuid, text) to authenticated;

-- ------------------------------------------------------------------ moderation: slow mode for any group (moderators)
create or replace function public.admin_set_slow_mode(p_group uuid, p_seconds int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_moderator() then
    raise exception 'Only moderators can change slow mode' using errcode = '42501';
  end if;
  if p_seconds is null or p_seconds < 0 or p_seconds > 3600 then raise exception 'Slow mode can be 0 to 3600 seconds.'; end if;
  update public.groups set slow_mode_seconds = p_seconds where id = p_group;
  if not found then raise exception 'That group no longer exists.'; end if;
  perform public._audit('slow_mode', 'groups', p_group, jsonb_build_object('seconds', p_seconds, 'by_moderator', true));
end;
$$;
revoke execute on function public.admin_set_slow_mode(uuid, int) from anon, public;
grant execute on function public.admin_set_slow_mode(uuid, int) to authenticated;

-- groups a moderator can pick for slow mode (names only)
create or replace function public.admin_groups_for_moderation()
returns table (id uuid, name text, kind text, slow_mode_seconds int, members bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_moderator() then
    raise exception 'Only moderators can view this' using errcode = '42501';
  end if;
  return query
    select g.id, g.name, g.kind::text, g.slow_mode_seconds, (select count(*) from public.group_members m where m.group_id = g.id)
      from public.groups g where g.is_approved order by g.name limit 300;
end;
$$;
revoke execute on function public.admin_groups_for_moderation() from anon, public;
grant execute on function public.admin_groups_for_moderation() to authenticated;

-- ------------------------------------------------------------------ message safety: rate limit, approval for big audiences
alter table public.event_messages drop constraint if exists event_messages_status_check;
alter table public.event_messages add constraint event_messages_status_check
  check (status in ('pending_approval', 'scheduled', 'sending', 'sent', 'cancelled', 'rejected'));
alter table public.event_messages add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;
alter table public.event_messages add column if not exists reviewed_at timestamptz;
alter table public.event_messages add column if not exists review_note text;
create index if not exists event_messages_pending_idx on public.event_messages (created_at) where status = 'pending_approval';

create or replace function public.admin_message_preview(p_event uuid, p_audience jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count int;
  v_sample jsonb;
begin
  if not public.has_event_cap('messages', p_event) then
    raise exception 'Only content managers can do this' using errcode = '42501';
  end if;
  v_ids := public._audience_view_ids(p_audience);
  with aud as (select distinct t.uid from public._event_audience(p_event, p_audience, auth.uid(), v_ids) as t(uid))
  select (select count(*) from aud),
         coalesce((select jsonb_agg(s.full_name order by s.full_name) from (
                     select p.full_name from aud join public.profiles p on p.id = aud.uid order by p.full_name limit 5) s), '[]'::jsonb)
    into v_count, v_sample;
  return jsonb_build_object('count', v_count, 'sample', v_sample, 'needs_approval', v_count > 200, 'approval_over', 200);
end;
$$;

create or replace function public.admin_send_event_message(p_event uuid, p_kind text, p_title text, p_body text, p_audience jsonb, p_send_at timestamptz default null)
returns public.event_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_aud jsonb := coalesce(p_audience, '{}'::jsonb);
  v_ids uuid[];
  v_count int;
  v_approval boolean;
  m public.event_messages;
begin
  if not public.has_event_cap('messages', p_event) then
    raise exception 'Only content managers can send messages' using errcode = '42501';
  end if;
  if coalesce(p_kind, 'announcement') not in ('announcement', 'payment_reminder', 'reminder') then raise exception 'Unknown message type.'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 60 then raise exception 'The title needs 3 to 60 characters.'; end if;
  if char_length(v_body) < 3 or char_length(v_body) > 130 then raise exception 'The message needs 3 to 130 characters (it is shown as a notification).'; end if;
  if jsonb_typeof(v_aud) <> 'object' or pg_column_size(v_aud) > 2000 then raise exception 'That audience is not valid.'; end if;
  if p_send_at is not null and (p_send_at <= now() or p_send_at > now() + interval '90 days') then
    raise exception 'Pick a time in the future (up to 90 days ahead), or send it now.';
  end if;
  -- per-sender limit first (one person cannot flood everyone), then the per-event limit
  if (select count(*) from public.event_messages where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have sent 10 messages in the last hour, which is the limit. Please wait a little before sending more.';
  end if;
  if (select count(*) from public.event_messages where event_id = p_event and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'That is a lot of messages in an hour. Please wait a little before sending more.';
  end if;
  v_ids := public._audience_view_ids(v_aud);
  select count(*) into v_count from (select distinct t.uid from public._event_audience(p_event, v_aud, auth.uid(), v_ids) as t(uid)) s;
  if v_count = 0 then
    raise exception 'Nobody matches this audience right now.';
  end if;
  v_approval := v_count > 200;

  insert into public.event_messages (event_id, kind, title, body, audience, status, scheduled_for, created_by)
  values (p_event, coalesce(p_kind, 'announcement'), v_title, v_body, v_aud, case when v_approval then 'pending_approval' else 'scheduled' end,
          coalesce(p_send_at, now()), auth.uid())
  returning * into m;
  if v_ids is not null then
    insert into public.event_message_recipients (message_id, user_id) select m.id, unnest(v_ids) on conflict do nothing;
  end if;
  if v_approval then
    perform public._audit('message_needs_approval', 'event_messages', m.id,
      jsonb_build_object('title', v_title, 'count', v_count, 'audience', v_aud, 'event_id', p_event));
  elsif p_send_at is null then
    perform public._deliver_event_message(m.id);
  else
    perform public._audit('schedule_event_message', 'event_messages', m.id,
      jsonb_build_object('title', v_title, 'audience', v_aud, 'send_at', p_send_at, 'event_id', p_event));
  end if;
  select * into m from public.event_messages where id = m.id;
  return m;
end;
$$;

-- A second admin approves (or rejects) a message to more than 200 people before anyone receives it.
create or replace function public.admin_review_event_message(p_id uuid, p_approve boolean, p_note text default null)
returns public.event_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.event_messages;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can approve messages' using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject.'; end if;
  select * into m from public.event_messages where id = p_id for update;
  if not found then raise exception 'That message no longer exists.'; end if;
  if m.status <> 'pending_approval' then raise exception 'This message has already been approved, rejected, sent or cancelled.'; end if;
  if m.created_by = auth.uid() then
    raise exception 'A second admin must approve this message. You wrote it.';
  end if;
  update public.event_messages
     set status = case when p_approve then 'scheduled' else 'rejected' end,
         scheduled_for = case when p_approve then greatest(scheduled_for, now()) else scheduled_for end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where id = p_id;
  perform public._audit(case when p_approve then 'approve_event_message' else 'reject_event_message' end, 'event_messages', p_id,
    jsonb_build_object('title', m.title, 'count', null, 'event_id', m.event_id, 'note', v_note));
  if p_approve and (select scheduled_for from public.event_messages where id = p_id) <= now() then
    perform public._deliver_event_message(p_id);
  end if;
  select * into m from public.event_messages where id = p_id;
  return m;
end;
$$;
revoke execute on function public.admin_review_event_message(uuid, boolean, text) from anon, public;
grant execute on function public.admin_review_event_message(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------------ attention queue: moderators get reports, admins get approvals
create or replace function public.admin_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_mod boolean := public.is_moderator();
  v_events jsonb;
  v_global jsonb := null;
begin
  if auth.uid() is null
     or not (v_admin or v_mod or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role in ('treasurer', 'content'))) then
    raise exception 'Only admins and event teams can view this' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'starts_at') nulls last), '[]'::jsonb) into v_events
    from (
      select jsonb_build_object(
        'id', e.id, 'slug', e.slug, 'title', e.title, 'is_published', e.is_published,
        'starts_at', e.starts_at, 'registration_closes_at', e.registration_closes_at, 'capacity', e.capacity,
        'payments_to_verify', case when public.has_event_cap('finance', e.id) then
            (select count(*) from public.event_payments p join public.event_registrations r on r.id = p.registration_id
              where r.event_id = e.id and p.status = 'submitted') else 0 end,
        'oldest_payment_at', case when public.has_event_cap('finance', e.id) then
            (select min(p.created_at) from public.event_payments p join public.event_registrations r on r.id = p.registration_id
              where r.event_id = e.id and p.status = 'submitted') end,
        'unpaid', (select count(*) from public.event_registrations r where r.event_id = e.id and r.status = 'pending_payment'),
        'seats_taken', (select coalesce(sum(r.headcount), 0) from public.event_registrations r
                         where r.event_id = e.id and r.status in ('under_review', 'confirmed')),
        'closes_soon', e.registration_closes_at is not null and e.registration_closes_at > now() and e.registration_closes_at <= now() + interval '7 days',
        'closed', e.registration_closes_at is not null and e.registration_closes_at <= now(),
        'missing_upi', e.is_published and e.upi_id is null
                        and exists (select 1 from public.event_ticket_types t where t.event_id = e.id and t.price_paise > 0)
      ) as x
      from public.events e
     where public.is_event_manager(e.id)
       and coalesce(e.ends_at, e.starts_at, now()) > now() - interval '3 days'
    ) q;

  if v_admin then
    v_global := jsonb_build_object(
      'members_pending', (select count(*) from public.profiles where onboarded and verification = 'pending'),
      'oldest_member_pending_at', (select min(created_at) from public.profiles where onboarded and verification = 'pending'),
      'reports_open', (select count(*) from (select 1 from public.reports where status = 'open' group by target_type, target_id) g),
      'circles_waiting', (select count(*) from public.groups where kind = 'circle' and not is_approved),
      'jobs_expiring', (select count(*) from public.jobs where not is_closed and not is_hidden
                         and expires_at > now() and expires_at <= now() + interval '7 days'),
      'messages_to_approve', (select count(*) from public.event_messages where status = 'pending_approval' and created_by is distinct from auth.uid()));
  elsif v_mod then
    v_global := jsonb_build_object(
      'reports_open', (select count(*) from (select 1 from public.reports where status = 'open' group by target_type, target_id) g));
  end if;

  return jsonb_build_object('generated_at', now(), 'is_admin', v_admin, 'global', v_global, 'events', v_events);
end;
$$;

-- ------------------------------------------------------------------ one inbox for everything waiting for a decision
-- Reports and flagged content (moderators), refunds still owed and waiting lists (treasurers, for their events),
-- messages waiting for a second admin (admins). Each caller only gets the kinds their role may act on.
create or replace function public.admin_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_mod boolean := public.is_moderator();
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
     or not (v_admin or v_mod or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'treasurer')) then
    raise exception 'Only admins and the people who handle reports or money can view this' using errcode = '42501';
  end if;

  if v_mod then
    -- three or more reports on a post or comment hid it until someone looks: that is "flagged"
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', case when g.n >= 3 and g.target_type in ('post', 'comment') then 'flagged' else 'report' end,
               'key', g.target_type || ':' || g.target_id, 'at', g.last_at, 'count', g.n,
               'title', initcap(g.target_type) || ' reported', 'detail', g.reasons,
               'href', '/admin/reports') order by g.last_at desc)
        from (select r.target_type, r.target_id, count(*) as n, max(r.created_at) as last_at, string_agg(distinct r.reason, ' · ') as reasons
                from public.reports r where r.status = 'open' group by r.target_type, r.target_id order by max(r.created_at) desc limit 100) g), '[]'::jsonb);
  end if;

  -- cancelled registrations that still hold verified money: a refund is owed or the money is kept on purpose
  v_items := v_items || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'refund', 'key', 'refund:' || r.id, 'at', r.updated_at, 'count', 1,
             'title', 'Refund to consider: ' || r.full_name,
             'detail', e.title || ' · ' || r.code || ' · ₹' || round(h.held / 100.0, 2)::text || ' held',
             'href', '/admin/events/' || e.slug || '?tab=finance', 'event_slug', e.slug) order by r.updated_at desc)
      from public.event_registrations r
      join public.events e on e.id = r.event_id
      join lateral (
        select coalesce(sum(p.amount_paise), 0) - coalesce((select sum(f.amount_paise) from public.event_refunds f where f.registration_id = r.id), 0) as held
          from public.event_payments p where p.registration_id = r.id and p.status = 'verified' and p.method <> 'waiver') h on h.held > 0
     where r.status = 'cancelled' and public.has_event_cap('finance', r.event_id)), '[]'::jsonb);

  v_items := v_items || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'waitlist', 'key', 'waitlist:' || w.event_id, 'at', w.oldest, 'count', w.n,
             'title', w.n || (case when w.n = 1 then ' person' else ' people' end) || ' waiting for a place',
             'detail', e.title, 'href', '/admin/events/' || e.slug || '?tab=waitlist', 'event_slug', e.slug) order by w.oldest)
      from (select event_id, count(*) as n, min(created_at) as oldest from public.event_waitlist where status in ('waiting', 'offered') group by event_id) w
      join public.events e on e.id = w.event_id
     where public.has_event_cap('registrations', w.event_id)), '[]'::jsonb);

  if v_admin then
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'approval', 'key', 'approval:' || m.id, 'at', m.created_at, 'count', 1,
               'title', 'Message to approve: ' || m.title, 'detail', e.title || (case when m.created_by = auth.uid() then ' · yours, needs another admin' else '' end),
               'href', '/admin/events/' || e.slug || '?tab=messages', 'event_slug', e.slug) order by m.created_at)
        from public.event_messages m join public.events e on e.id = m.event_id where m.status = 'pending_approval'), '[]'::jsonb);
  end if;

  return jsonb_build_object('generated_at', now(), 'items', v_items);
end;
$$;
revoke execute on function public.admin_inbox() from anon, public;
grant execute on function public.admin_inbox() to authenticated;

-- ------------------------------------------------------------------ activity log: filter and search (admins)
create or replace function public.admin_audit_search(p_actions text[] default null, p_actor uuid default null, p_q text default null,
                                                    p_from timestamptz default null, p_to timestamptz default null,
                                                    p_limit int default 50, p_before bigint default null)
returns table (id bigint, action text, target_table text, target_id uuid, details jsonb, created_at timestamptz, actor uuid, actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can read the activity log' using errcode = '42501';
  end if;
  return query
    select a.id, a.action, a.target_table, a.target_id, a.details, a.created_at, a.actor, p.full_name
      from public.admin_audit a left join public.profiles p on p.id = a.actor
     where (p_actions is null or cardinality(p_actions) = 0 or a.action = any (p_actions))
       and (p_actor is null or a.actor = p_actor)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
       and (p_before is null or a.id < p_before)
       and (v_q is null or position(v_q in lower(a.action)) > 0 or position(v_q in lower(a.details::text)) > 0
            or position(v_q in lower(coalesce(p.full_name, ''))) > 0
            or exists (select 1 from public.profiles t where t.id = a.target_id and position(v_q in lower(t.full_name)) > 0))
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 1000);
end;
$$;
revoke execute on function public.admin_audit_search(text[], uuid, text, timestamptz, timestamptz, int, bigint) from anon, public;
grant execute on function public.admin_audit_search(text[], uuid, text, timestamptz, timestamptz, int, bigint) to authenticated;

-- ------------------------------------------------------------------ view as member (read-only)
-- What a member sees of their own account: profile card, registrations and payments, circles, notifications. Nothing is
-- changed, nothing is written as the member, and no phone number or e-mail is returned. The look-up is logged.
create or replace function public.admin_view_as_member(p_member uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_regs jsonb;
  v_groups jsonb;
  v_notes jsonb;
  v_unread int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can preview a member''s view' using errcode = '42501';
  end if;
  select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'headline', p.headline, 'branch', p.branch,
           'grad_year', p.grad_year, 'city', p.city, 'current_title', p.current_title, 'current_company', p.current_company,
           'verification', p.verification, 'onboarded', p.onboarded, 'is_admin', p.is_admin, 'language', p.language,
           'roles', coalesce((select jsonb_agg(distinct s.role) from public.event_staff s where s.user_id = p.id), '[]'::jsonb)
                    || coalesce((select jsonb_agg(r.role) from public.site_roles r where r.user_id = p.id), '[]'::jsonb))
    into v_profile from public.profiles p where p.id = p_member;
  if v_profile is null then raise exception 'That member no longer exists.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'headcount', r.headcount,
           'amount_paise', r.amount_paise, 'event_title', e.title, 'event_slug', e.slug, 'starts_at', e.starts_at,
           'checked_in', r.checked_in_at is not null,
           'payments', coalesce((select jsonb_agg(jsonb_build_object('status', p.status, 'amount_paise', p.amount_paise, 'method', p.method) order by p.created_at)
                                   from public.event_payments p where p.registration_id = r.id), '[]'::jsonb))
           order by r.created_at desc), '[]'::jsonb)
    into v_regs from public.event_registrations r join public.events e on e.id = r.event_id where r.user_id = p_member;

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'role', m.role) order by g.name), '[]'::jsonb)
    into v_groups from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = p_member and g.is_approved;

  select count(*) into v_unread from public.notifications where user_id = p_member and read_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'body', left(n.body, 200), 'created_at', n.created_at, 'unread', n.read_at is null)
           order by n.created_at desc), '[]'::jsonb)
    into v_notes from (select * from public.notifications where user_id = p_member order by created_at desc limit 8) n;

  perform public._audit('view_as_member', 'profiles', p_member, jsonb_build_object('name', v_profile ->> 'full_name'));
  return jsonb_build_object('profile', v_profile, 'registrations', v_regs, 'groups', v_groups, 'notifications', v_notes, 'unread', v_unread);
end;
$$;
revoke execute on function public.admin_view_as_member(uuid) from anon, public;
grant execute on function public.admin_view_as_member(uuid) to authenticated;
