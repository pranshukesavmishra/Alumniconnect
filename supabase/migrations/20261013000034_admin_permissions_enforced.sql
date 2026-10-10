-- Permission-scoped admins, part 2: every admin function, row security policy and storage policy asks _admin_can('<permission>')
-- instead of the blanket is_admin(). is_admin() still means "has some admin access" (it opens the admin area); WHAT an admin may do
-- is decided by _admin_can. A legacy admin (no admin_grants row) and a super admin hold every permission, so nothing changes for them.
--
-- Event-scoped roles (treasurer / content / checkin) and the site moderator keep working next to the permissions:
--   has_event_cap(cap, event) = the admin holds one of the permissions of that cap, OR holds the matching event role.

-- ------------------------------------------------------------------ capability helpers
create or replace function public.has_event_cap(p_cap text, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._admin_can_any(case p_cap
           when 'finance' then array['money_payments', 'money_refunds', 'money_finance', 'money_exports', 'events_registrations']
           when 'payments' then array['money_payments']
           when 'refunds' then array['money_refunds']
           when 'ledger' then array['money_finance']
           when 'exports' then array['money_exports', 'events_registrations']
           when 'registrations' then array['events_registrations']
           when 'messages' then array['messages_send']
           when 'announce' then array['messages_announcements']
           when 'programme' then array['events_edit']
           when 'photos' then array['events_edit', 'moderation_hide']
           when 'manage' then array['events_*', 'money_*', 'messages_*']
           when 'checkin' then array['events_checkin', 'events_registrations']
           else array[]::text[] end)
         or exists (
    select 1 from public.event_staff s
     where s.event_id = p_event and s.user_id = auth.uid()
       and s.role = any (case p_cap
         when 'finance' then array['treasurer']
         when 'payments' then array['treasurer']
         when 'refunds' then array['treasurer']
         when 'ledger' then array['treasurer']
         when 'exports' then array['treasurer']
         when 'registrations' then array['treasurer']
         when 'messages' then array['content']
         when 'announce' then array['content']
         when 'programme' then array['content']
         when 'photos' then array['content']
         when 'manage' then array['treasurer', 'content']
         when 'checkin' then array['checkin', 'treasurer', 'content']
         else array[]::text[] end));
$$;

-- a site moderator holds every moderation permission; an admin holds the ones in their grant
create or replace function public._can_moderate(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._admin_can(p_perm) or exists (select 1 from public.site_roles r where r.user_id = auth.uid() and r.role = 'moderator');
$$;
revoke execute on function public._can_moderate(text) from public, anon, authenticated;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._admin_can('moderation_*') or exists (select 1 from public.site_roles r where r.user_id = auth.uid() and r.role = 'moderator');
$$;

-- ------------------------------------------------------------------ patch the existing functions in place
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

do $$
declare
  r record;
begin
  -- members
  for r in select * from (values
    ('admin_add_member_note', 'members_edit'), ('admin_delete_member_note', 'members_edit'),
    ('admin_delete_member_view', 'members_view'), ('admin_save_member_view', 'members_view'),
    ('admin_dismiss_duplicate', 'members_merge'), ('admin_member_duplicates', 'members_merge'),
    ('admin_merge_members', 'members_merge'), ('admin_merge_preview', 'members_merge'),
    ('admin_bulk_set_verification', 'members_verify'),
    ('admin_export_members', 'members_export'), ('admin_list_members', 'members_view'), ('admin_member_timeline', 'members_view'),
    ('admin_import_claim', 'members_import'), ('admin_import_jobs', 'members_import'), ('admin_import_mark', 'members_import'),
    ('admin_import_preview', 'members_import'), ('admin_import_retry', 'members_import'), ('admin_import_start', 'members_import'),
    ('admin_log_audit_export', 'audit')
  ) as v(fn, perm) loop
    perform pg_temp.patch(r.fn, 'public._require_admin()', format('public._require_perm(%L)', r.perm));
  end loop;

  for r in select * from (values
    ('_audience_view_ids', 'members_view'), ('admin_member_email', 'members_view'), ('admin_update_member', 'members_edit'),
    ('admin_view_as_member', 'members_view'), ('admin_analytics', 'analytics'), ('admin_audit_search', 'audit'), ('admin_health', 'health'),
    ('admin_review_event_message', 'messages_send'), ('admin_bulk_review_payments', 'money_payments'),
    ('propose_circle', 'community_circles'), ('is_group_admin', 'community_circles'),
    ('close_meetup', 'moderation_meetups'), ('remove_meetup_member', 'moderation_meetups')
  ) as v(fn, perm) loop
    perform pg_temp.patch(r.fn, 'public.is_admin()', format('public._admin_can(%L)', r.perm));
  end loop;

  -- moderation
  for r in select * from (values
    ('admin_reports', 'moderation_reports'), ('admin_dismiss_reports', 'moderation_reports'),
    ('moderate', 'moderation_hide'), ('admin_remove_message', 'moderation_hide'),
    ('admin_set_meetup', 'moderation_meetups'), ('city_meetups', 'moderation_meetups'),
    ('admin_set_slow_mode', 'moderation_slowmode'), ('admin_groups_for_moderation', 'moderation_slowmode')
  ) as v(fn, perm) loop
    perform pg_temp.patch(r.fn, 'public.is_moderator()', format('public._can_moderate(%L)', r.perm));
  end loop;

  -- money and registrations: which capability each function needs
  for r in select * from (values
    ('admin_apply_discount', 'refunds'), ('admin_record_refund', 'refunds'),
    ('admin_event_ledger', 'ledger'), ('admin_event_ledger_rows', 'ledger'),
    ('review_payment', 'payments'), ('record_offline_payment', 'payments'),
    ('admin_set_registration_status', 'registrations'), ('admin_transfer_registration', 'registrations'),
    ('admin_update_registration', 'registrations')
  ) as v(fn, cap) loop
    perform pg_temp.patch(r.fn, 'public.has_event_cap(''finance''', format('public.has_event_cap(%L', r.cap));
  end loop;
  perform pg_temp.patch('admin_log_event_export', 'not public.has_event_cap(''finance'', p_event)', 'not public.has_event_cap(''exports'', p_event)');
  perform pg_temp.patch('admin_log_event_export', 'not public.has_event_cap(''checkin'', p_event)',
    'not (public.has_event_cap(''checkin'', p_event) or public.has_event_cap(''exports'', p_event))');
  perform pg_temp.patch('post_announcement', 'public.has_event_cap(''programme''', 'public.has_event_cap(''announce''');
  perform pg_temp.patch('event_announcement_audience', 'public.has_event_cap(''programme''', 'public.has_event_cap(''announce''');
  perform pg_temp.patch('moderate_photo', 'public.has_event_cap(''programme''', 'public.has_event_cap(''photos''');

  -- cancelling with "money was returned outside the app" marks payments refunded: that needs the refunds permission as well
  perform pg_temp.patch('admin_set_registration_status', 'before_status := reg.status;',
    'if coalesce(p_refunded, false) and p_cancel and not public.has_event_cap(''refunds'', reg.event_id) then
    raise exception ''Only people who handle refunds can mark money as returned.'' using errcode = ''42501'';
  end if;
  before_status := reg.status;');
  -- a ledger download is a money export
  perform pg_temp.patch('admin_event_ledger_rows', 'if coalesce(p_log, false) then',
    'if coalesce(p_log, false) then
    if not public.has_event_cap(''exports'', p_event) then
      raise exception ''Only people who may export money lists can do this'' using errcode = ''42501'';
    end if;');

  -- group chats and group content: the moderation and circle permissions
  perform pg_temp.patch('can_read_chat', 'public.is_admin() or not exists', 'public._admin_can(''moderation_meetups'') or not exists');
  perform pg_temp.patch('can_read_chat', 'public.is_admin()', 'public._admin_can(''moderation_hide'')');
  perform pg_temp.patch('can_see_group_content', 'public.is_admin()', 'public._admin_can_any(array[''moderation_hide'', ''community_circles''])');

  -- search: members need members_view; registrations and payments need a money or registrations permission (or the treasurer role)
  perform pg_temp.patch('admin_search', 'v_admin boolean := public.is_admin();', 'v_admin boolean := public._admin_can(''members_view'');');
  perform pg_temp.patch('admin_search', 'not (v_admin or exists (select 1 from public.event_staff s',
    'not (v_admin or public._admin_can_any(array[''money_*'', ''events_registrations'']) or exists (select 1 from public.event_staff s');
end $$;

-- ------------------------------------------------------------------ admin_set_member: verification only; admin access has one door
create or replace function public.admin_set_member(p_id uuid, p_is_admin boolean, p_verification public.verification_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before public.profiles;
begin
  perform public._require_perm('members_verify');
  select * into before from public.profiles where id = p_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_id = auth.uid() and p_is_admin is false then
    raise exception 'You cannot remove your own admin access. Ask another admin.';
  end if;
  if p_is_admin is not null and p_is_admin is distinct from before.is_admin then
    raise exception 'Admin access is given and removed by a super admin only (Admin > Who can do what > Admins and owners).' using errcode = '42501';
  end if;
  update public.profiles set verification = coalesce(p_verification, verification) where id = p_id;
  perform public._audit('set_member_flags', 'profiles', p_id,
    jsonb_build_object('is_admin', jsonb_build_object('from', before.is_admin, 'to', before.is_admin),
                       'verification', jsonb_build_object('from', before.verification, 'to', coalesce(p_verification, before.verification))));
end;
$$;

-- ------------------------------------------------------------------ roles: event roles need events_team, moderator needs moderation, admin has its own door
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
  if p_role = 'admin' then
    raise exception 'Admin access is given by a super admin only (Admin > Who can do what > Admins and owners).' using errcode = '42501';
  end if;
  -- an event or moderator role carries powers beyond a limited admin's own list, so nobody hands them to themselves
  if p_user = auth.uid() and not public.is_super_admin() then
    raise exception 'You cannot give yourself a role. Ask a super admin.' using errcode = '42501';
  end if;
  if p_role in ('treasurer', 'content', 'checkin') and not public._admin_can('events_team') then
    raise exception 'You need the permission to manage event teams to give this role. Ask a super admin.' using errcode = '42501';
  end if;
  if p_role = 'moderator' and not public._admin_can('moderation_*') then
    raise exception 'You need a moderation permission to give this role. Ask a super admin.' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_user;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_role in ('treasurer', 'content', 'checkin') then
    select title into v_title from public.events where id = p_event;
    if not found then raise exception 'Choose the event this role is for.'; end if;
    insert into public.event_staff (event_id, user_id, role, granted_by) values (p_event, p_user, p_role, auth.uid()) on conflict do nothing;
    v_changed := found;
  else
    insert into public.site_roles (user_id, role, granted_by) values (p_user, 'moderator', auth.uid()) on conflict do nothing;
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
  if p_role = 'admin' then
    raise exception 'Admin access is removed by a super admin only (Admin > Who can do what > Admins and owners).' using errcode = '42501';
  end if;
  if p_role in ('treasurer', 'content', 'checkin') and not public._admin_can('events_team') then
    raise exception 'You need the permission to manage event teams to remove this role. Ask a super admin.' using errcode = '42501';
  end if;
  if p_role = 'moderator' and not public._admin_can('moderation_*') then
    raise exception 'You need a moderation permission to remove this role. Ask a super admin.' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_user;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_role in ('treasurer', 'content', 'checkin') then
    select title into v_title from public.events where id = p_event;
    delete from public.event_staff where user_id = p_user and event_id = p_event and role = p_role;
    v_changed := found;
  else
    delete from public.site_roles where user_id = p_user and role = 'moderator';
    v_changed := found;
  end if;
  if v_changed then
    perform public._audit('role_revoke', 'profiles', p_user,
      jsonb_build_object('role', p_role, 'name', v_name, 'event_id', p_event, 'event', v_title, 'note', v_note));
  end if;
  return v_changed;
end;
$$;

-- the overview: staff and moderators for anyone who manages teams or may see the admins; the admin list itself is admin_list_admins()
create or replace function public.admin_roles_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public._admin_can_any(array['admins', 'events_team', 'moderation_*']) then
    raise exception 'Only admins who manage roles can view this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'admins', case when public._admin_can('admins') then
                (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                   'grad_year', p.grad_year, 'branch', p.branch, 'is_super', p.is_super_admin) order by p.full_name), '[]'::jsonb)
                   from public.profiles p where p.is_admin)
              else '[]'::jsonb end,
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

-- ------------------------------------------------------------------ the attention queue and the inbox show only what the viewer may act on
create or replace function public.admin_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_mod boolean := public._can_moderate('moderation_reports');
  v_events jsonb;
  v_global jsonb := '{}'::jsonb;
begin
  if auth.uid() is null
     or not (v_admin or public.is_moderator() or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role in ('treasurer', 'content'))) then
    raise exception 'Only admins and event teams can view this' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'starts_at') nulls last), '[]'::jsonb) into v_events
    from (
      select jsonb_build_object(
        'id', e.id, 'slug', e.slug, 'title', e.title, 'is_published', e.is_published,
        'starts_at', e.starts_at, 'registration_closes_at', e.registration_closes_at, 'capacity', e.capacity,
        'payments_to_verify', case when public.has_event_cap('payments', e.id) then
            (select count(*) from public.event_payments p join public.event_registrations r on r.id = p.registration_id
              where r.event_id = e.id and p.status = 'submitted') else 0 end,
        'oldest_payment_at', case when public.has_event_cap('payments', e.id) then
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

  -- only the counts this person may act on are included
  if public._admin_can('members_verify') then
    v_global := v_global || jsonb_build_object(
      'members_pending', (select count(*) from public.profiles where onboarded and verification = 'pending'),
      'oldest_member_pending_at', (select min(created_at) from public.profiles where onboarded and verification = 'pending'));
  end if;
  if v_mod then
    v_global := v_global || jsonb_build_object(
      'reports_open', (select count(*) from (select 1 from public.reports where status = 'open' group by target_type, target_id) g));
  end if;
  if public._admin_can('community_circles') then
    v_global := v_global || jsonb_build_object('circles_waiting', (select count(*) from public.groups where kind = 'circle' and not is_approved));
  end if;
  if public._admin_can('moderation_hide') then
    v_global := v_global || jsonb_build_object('jobs_expiring', (select count(*) from public.jobs where not is_closed and not is_hidden
                         and expires_at > now() and expires_at <= now() + interval '7 days'));
  end if;
  if public._admin_can('messages_send') then
    v_global := v_global || jsonb_build_object('messages_to_approve',
      (select count(*) from public.event_messages where status = 'pending_approval' and created_by is distinct from auth.uid()));
  end if;
  if v_global = '{}'::jsonb then v_global := null; end if;

  return jsonb_build_object('generated_at', now(), 'is_admin', v_admin, 'global', v_global, 'events', v_events);
end;
$$;

create or replace function public.admin_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rep boolean := public._can_moderate('moderation_reports');
  v_approve boolean := public._admin_can('messages_send');
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
     or not (v_rep or v_approve or public._admin_can_any(array['money_refunds', 'events_registrations'])
             or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'treasurer')) then
    raise exception 'Only admins and the people who handle reports or money can view this' using errcode = '42501';
  end if;

  if v_rep then
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
     where r.status = 'cancelled' and public.has_event_cap('refunds', r.event_id)), '[]'::jsonb);

  v_items := v_items || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'waitlist', 'key', 'waitlist:' || w.event_id, 'at', w.oldest, 'count', w.n,
             'title', w.n || (case when w.n = 1 then ' person' else ' people' end) || ' waiting for a place',
             'detail', e.title, 'href', '/admin/events/' || e.slug || '?tab=waitlist', 'event_slug', e.slug) order by w.oldest)
      from (select event_id, count(*) as n, min(created_at) as oldest from public.event_waitlist where status in ('waiting', 'offered') group by event_id) w
      join public.events e on e.id = w.event_id
     where public.has_event_cap('registrations', w.event_id)), '[]'::jsonb);

  if v_approve then
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'approval', 'key', 'approval:' || m.id, 'at', m.created_at, 'count', 1,
               'title', 'Message to approve: ' || m.title, 'detail', e.title || (case when m.created_by = auth.uid() then ' · yours, needs another admin' else '' end),
               'href', '/admin/events/' || e.slug || '?tab=messages', 'event_slug', e.slug) order by m.created_at)
        from public.event_messages m join public.events e on e.id = m.event_id where m.status = 'pending_approval'), '[]'::jsonb);
  end if;

  return jsonb_build_object('generated_at', now(), 'items', v_items);
end;
$$;

-- ------------------------------------------------------------------ row security policies
-- admin tables
drop policy if exists "admins read audit" on public.admin_audit;
create policy "admins read audit" on public.admin_audit for select to authenticated using (public._admin_can('audit'));
drop policy if exists "admins read dismissals" on public.admin_duplicate_dismissals;
create policy "admins read dismissals" on public.admin_duplicate_dismissals for select to authenticated using (public._admin_can('members_merge'));
drop policy if exists "admins read member notes" on public.admin_member_notes;
create policy "admins read member notes" on public.admin_member_notes for select to authenticated using (public._admin_can('members_view'));
drop policy if exists "admins read member views" on public.admin_member_views;
create policy "admins read member views" on public.admin_member_views for select to authenticated using (public._admin_can('members_view'));

-- community content
drop policy if exists "admins manage batch sizes" on public.batch_sizes;
create policy "admins manage batch sizes" on public.batch_sizes for all to authenticated
  using (public._admin_can('community_batches')) with check (public._admin_can('community_batches'));
drop policy if exists "admins manage spotlights" on public.spotlights;
create policy "admins manage spotlights" on public.spotlights for all to authenticated
  using (public._admin_can('community_spotlight')) with check (public._admin_can('community_spotlight'));
drop policy if exists "verified see spotlights" on public.spotlights;
create policy "verified see spotlights" on public.spotlights for select to authenticated using (public.is_verified() or public._admin_can('community_spotlight'));
drop policy if exists "admins manage groups" on public.groups;
create policy "admins manage groups" on public.groups for all to authenticated
  using (public._admin_can('community_circles')) with check (public._admin_can('community_circles'));
drop policy if exists "verified see approved groups" on public.groups;
create policy "verified see approved groups" on public.groups for select to authenticated
  using ((public.is_verified() and (is_approved or created_by = auth.uid())) or public._admin_can_any(array['community_circles', 'moderation_*']));

-- hidden content is visible to those who may moderate it
drop policy if exists "see businesses" on public.businesses;
create policy "see businesses" on public.businesses for select to authenticated
  using (public._admin_can('moderation_hide') or owner_id = auth.uid() or (public.is_verified() and not is_hidden));
drop policy if exists "see help requests" on public.help_requests;
create policy "see help requests" on public.help_requests for select to authenticated
  using (public._admin_can('moderation_hide') or author_id = auth.uid() or (public.is_verified() and not is_hidden));
drop policy if exists "see open jobs" on public.jobs;
create policy "see open jobs" on public.jobs for select to authenticated
  using (public._admin_can('moderation_hide') or posted_by = auth.uid()
         or (public.is_verified() and not is_hidden and not is_closed and expires_at > now()));
drop policy if exists "delete own comments" on public.comments;
create policy "delete own comments" on public.comments for delete to authenticated using (author_id = auth.uid() or public._admin_can('moderation_hide'));
drop policy if exists "see comments" on public.comments;
create policy "see comments" on public.comments for select to authenticated using (
  author_id = auth.uid() or public._admin_can('moderation_hide')
  or (not is_hidden and not public.is_blocked_between(auth.uid(), author_id)
      and exists (select 1 from public.posts p where p.id = comments.post_id and not p.is_hidden and public.can_see_group_content(p.group_id))));
drop policy if exists "delete own posts" on public.posts;
create policy "delete own posts" on public.posts for delete to authenticated
  using (author_id = auth.uid() or public._admin_can('moderation_hide') or (group_id is not null and public.is_group_admin(group_id)));
drop policy if exists "see posts" on public.posts;
create policy "see posts" on public.posts for select to authenticated using (
  author_id = auth.uid() or public._admin_can('moderation_hide')
  or (not is_hidden and public.can_see_group_content(group_id) and not public.is_blocked_between(auth.uid(), author_id)));
drop policy if exists "write posts" on public.posts;
create policy "write posts" on public.posts for insert to authenticated with check (
  author_id = auth.uid() and public.is_verified() and (group_id is null or public.is_group_member(group_id) or public._admin_can('community_circles')));
drop policy if exists "see own or all (admins)" on public.reports;
create policy "see own or all (admins)" on public.reports for select to authenticated using (reporter = auth.uid() or public._admin_can('moderation_reports'));

-- members
drop policy if exists "own private details" on public.profile_private;
create policy "own private details" on public.profile_private for select to authenticated using (id = auth.uid() or public._admin_can('members_view'));
drop policy if exists "admins update private details" on public.profile_private;
create policy "admins update private details" on public.profile_private for update to authenticated
  using (public._admin_can('members_edit')) with check (public._admin_can('members_edit'));
drop policy if exists "admins update any profile" on public.profiles;
create policy "admins update any profile" on public.profiles for update to authenticated using (public._admin_can('members_edit')) with check (true);
drop policy if exists "vouches visible to admins and the member" on public.vouches;
create policy "vouches visible to admins and the member" on public.vouches for select to authenticated
  using (member = auth.uid() or voucher = auth.uid() or public._admin_can('members_view'));

-- roles
drop policy if exists "own roles or admin" on public.event_staff;
create policy "own roles or admin" on public.event_staff for select to authenticated
  using (user_id = auth.uid() or public._admin_can_any(array['admins', 'events_team']));
drop policy if exists "own site roles or admin" on public.site_roles;
create policy "own site roles or admin" on public.site_roles for select to authenticated
  using (user_id = auth.uid() or public._admin_can_any(array['admins', 'moderation_*']));

-- events: creating and deleting, editing, tickets, settings are separate permissions
drop policy if exists "admins manage events" on public.events;
create policy "admins create events" on public.events for insert to authenticated with check (public._admin_can('events_create'));
create policy "admins edit events" on public.events for update to authenticated using (public._admin_can('events_edit')) with check (public._admin_can('events_edit'));
create policy "admins delete events" on public.events for delete to authenticated using (public._admin_can('events_create'));
drop policy if exists "published events are public" on public.events;
create policy "published events are public" on public.events for select using (is_published or public._admin_can_any(array['events_*', 'money_*', 'messages_*']));
drop policy if exists "admins manage ticket types" on public.event_ticket_types;
create policy "admins manage ticket types" on public.event_ticket_types for all to authenticated
  using (public._admin_can('events_tickets')) with check (public._admin_can('events_tickets'));
drop policy if exists "ticket types are public" on public.event_ticket_types;
create policy "ticket types are public" on public.event_ticket_types for select using (
  exists (select 1 from public.events e where e.id = event_ticket_types.event_id
          and (e.is_published or public._admin_can_any(array['events_*', 'money_*', 'messages_*']))));
drop policy if exists "admins manage event settings" on public.event_settings;
create policy "admins manage event settings" on public.event_settings for all to authenticated
  using (public._admin_can('events_settings')) with check (public._admin_can('events_settings'));

-- announcements are their own permission (post_announcement uses the same capability)
drop policy if exists "content managers write announcements" on public.event_announcements;
create policy "content managers write announcements" on public.event_announcements for all to authenticated
  using (public.has_event_cap('announce', event_id)) with check (public.has_event_cap('announce', event_id));

-- storage
drop policy if exists "delete own event photos" on storage.objects;
create policy "delete own event photos" on storage.objects for delete to authenticated using (
  bucket_id = 'event-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public._admin_can_any(array['events_edit', 'moderation_hide'])));
drop policy if exists "delete own post media" on storage.objects;
create policy "delete own post media" on storage.objects for delete to authenticated using (
  bucket_id = 'post-media' and ((storage.foldername(name))[1] = auth.uid()::text or public._admin_can('moderation_hide')));
drop policy if exists "read own payment proof or treasurers" on storage.objects;
create policy "read own payment proof or treasurers" on storage.objects for select to authenticated using (
  bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = auth.uid()::text or public._admin_can('money_payments')
    or exists (select 1 from public.event_payments p join public.event_registrations r on r.id = p.registration_id
                where p.proof_path = objects.name and public.has_event_cap('payments', r.event_id))));

-- reading a registration needs a money or registrations permission; it used to be the one 'finance' capability, which still means that
