-- PERMANENT OWNERS + ROLE TEMPLATES WITH SCOPE.
--
-- Part 1. The owner accounts (everyone who is a super admin when this runs) become permanent. Nobody can remove, demote,
-- un-verify, restrict or delete them: not another admin, not the owner themself, not an account deletion, not a delete of the
-- user in the Supabase dashboard. The only way out is the deliberate break-glass procedure in docs/ADMIN_ACCESS.md.
-- Part 2. Role templates (Treasurer, Event manager, ...) on top of the permission keys, and department / batch scope that the
-- database enforces for every member-facing admin function.

-- ================================================================== PART 1: the owner lock
create table public.protected_owners (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now()
);
alter table public.protected_owners enable row level security;
revoke all on public.protected_owners from public, anon, authenticated;
-- no policy and no grant: the table is invisible to the API. Only SECURITY DEFINER code and the postgres role read it.

insert into public.protected_owners (user_id) select p.id from public.profiles p where p.is_super_admin on conflict do nothing;

create or replace function public._is_protected_owner(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.protected_owners o where o.user_id = p_user);
$$;
revoke execute on function public._is_protected_owner(uuid) from public, anon, authenticated;

-- profiles: an owner row can only ever be edited in ways that keep it an owner, verified, and present
create or replace function public._protect_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._is_protected_owner(old.id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Ownership is locked: an owner account is permanent and cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id then
    raise exception 'Ownership is locked: an owner account cannot be changed to another identity.' using errcode = 'P0001';
  end if;
  if new.is_super_admin is not true or new.is_admin is not true then
    raise exception 'Ownership is locked: an owner cannot be demoted or have admin access removed.' using errcode = 'P0001';
  end if;
  if new.verification is distinct from 'verified'::public.verification_status then
    raise exception 'Ownership is locked: an owner stays verified and cannot be rejected, un-verified or restricted.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public._protect_owner_profile() from public, anon, authenticated;

-- admin_grants: owners always hold every permission, so they never get (or lose, or change) a limiting row
create or replace function public._protect_owner_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if public._is_protected_owner(v_user) then
    raise exception 'Ownership is locked: an owner always holds every permission and cannot be limited.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public._protect_owner_grants() from public, anon, authenticated;

-- protected_owners itself: no update, no delete, no truncate. Insert stays possible (adding an owner) for the postgres role.
create or replace function public._protect_owner_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Ownership is locked: the list of permanent owners cannot be changed from here. See "Removing an owner (emergency only)" in docs/ADMIN_ACCESS.md.' using errcode = 'P0001';
end;
$$;
revoke execute on function public._protect_owner_list() from public, anon, authenticated;

-- (re)creates every lock trigger. The migration uses it; so does the last step of the break-glass procedure in the docs.
create or replace function public._restore_owner_locks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  drop trigger if exists profiles_00_protect_owner on public.profiles;
  create trigger profiles_00_protect_owner before update or delete on public.profiles
    for each row execute function public._protect_owner_profile();
  drop trigger if exists admin_grants_protect_owner on public.admin_grants;
  create trigger admin_grants_protect_owner before insert or update or delete on public.admin_grants
    for each row execute function public._protect_owner_grants();
  drop trigger if exists protected_owners_no_change on public.protected_owners;
  create trigger protected_owners_no_change before update or delete on public.protected_owners
    for each row execute function public._protect_owner_list();
  drop trigger if exists protected_owners_no_truncate on public.protected_owners;
  create trigger protected_owners_no_truncate before truncate on public.protected_owners
    for each statement execute function public._protect_owner_list();
end;
$$;
revoke execute on function public._restore_owner_locks() from public, anon, authenticated;
select public._restore_owner_locks();

-- retire the two functions that could change ownership
drop function if exists public.admin_set_super_admin(uuid, boolean);
drop function if exists public.admin_transfer_ownership(uuid, boolean);

-- ================================================================== PART 2: role templates and scope
create table public.admin_role_templates (
  key text primary key check (key ~ '^[a-z][a-z_]{1,40}$'),
  label text not null,
  description text not null,
  -- null = a FULL admin (everything, including permissions added later). Entries ending in * are families ('money_*').
  permissions text[],
  scope_kind text not null default 'none' check (scope_kind in ('none', 'department', 'batch')),
  sort int not null default 100
);
alter table public.admin_role_templates enable row level security;
revoke all on public.admin_role_templates from public, anon, authenticated;

insert into public.admin_role_templates (key, label, description, permissions, scope_kind, sort) values
  ('full', 'Full admin', 'Everything an admin can do, including things added later. Cannot make or remove admins.', null, 'none', 10),
  ('treasurer', 'Treasurer', 'Handles the money: verifies payments, refunds, the finance ledger and money exports (and funds, once that module exists).', array['money_*', 'funds_*'], 'none', 20),
  ('event_manager', 'Event manager', 'Runs events: creates and edits them, tickets, teams, registrations, check-in, announcements and event photos.', array['events_*', 'photos_moderate'], 'none', 30),
  ('registration_desk', 'Registration desk', 'Works the door: sees registrations and scans tickets. Nothing else.', array['events_checkin', 'events_registrations'], 'none', 40),
  ('communications', 'Communications officer', 'Writes to people: event announcements and messages to registrants.', array['messages_*'], 'none', 50),
  ('moderator', 'Moderator', 'Keeps the community safe: reads reports, hides posts, slows down busy groups, handles city meetups.', array['moderation_*'], 'none', 60),
  ('community_manager', 'Community manager', 'Looks after circles and groups, the spotlight and batch sizes.', array['community_*'], 'none', 70),
  ('photographer', 'Photographer / gallery curator', 'Event photos and the college gallery: approve, hide, feature and arrange.', array['photos_moderate', 'gallery_manage'], 'none', 80),
  ('funds_sponsorship', 'Funds and sponsorship manager', 'Runs fundraising and sponsors (appears once the Give Back module is installed).', array['funds_*', 'sponsors_*'], 'none', 90),
  ('membership_officer', 'Membership officer', 'Looks after the member list: view, edit, verify, import and download.', array['members_view', 'members_edit', 'members_verify', 'members_import', 'members_export'], 'none', 100),
  ('auditor', 'Auditor / viewer', 'Read-only insight: growth numbers, the activity log and site health.', array['analytics', 'audit', 'health'], 'none', 110),
  ('department_head', 'Department head', 'Sees and verifies only the members of ONE department, and runs that department''s groups and announcements.', array['members_view', 'members_verify'], 'department', 120),
  ('batch_rep', 'Batch representative', 'Sees only the members of ONE batch year and runs that batch''s groups.', array['members_view'], 'batch', 130);

-- expands families ('money_*') against the catalogue; unknown plain keys are dropped
create or replace function public._expand_permissions(p_perms text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.key order by c.key), '{}')
    from public._permission_catalog() c
   where exists (select 1 from unnest(coalesce(p_perms, '{}')) q
                  where q = c.key or (right(q, 1) = '*' and left(c.key, length(q) - 1) = left(q, length(q) - 1)));
$$;
revoke execute on function public._expand_permissions(text[]) from public, anon, authenticated;

alter table public.admin_grants add column template_key text references public.admin_role_templates (key) on delete set null;
alter table public.admin_grants add column scope_kind text not null default 'all' check (scope_kind in ('all', 'department', 'batch'));
alter table public.admin_grants add column scope_value text;
alter table public.admin_grants add constraint admin_grants_scope_shape check (
  (scope_kind = 'all' and scope_value is null)
  or (scope_kind = 'department' and char_length(btrim(scope_value)) between 2 and 120)
  or (scope_kind = 'batch' and scope_value ~ '^[0-9]{4}$'));

-- the templates for the "Make admin" screen (any admin may read them; permissions are expanded; empty families are hidden)
create or replace function public.admin_role_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can view this' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label, 'description', t.description,
            'full', t.permissions is null, 'permissions', to_jsonb(public._expand_permissions(t.permissions)),
            'scope_kind', t.scope_kind) order by t.sort), '[]'::jsonb)
            from public.admin_role_templates t
           where t.permissions is null or cardinality(public._expand_permissions(t.permissions)) > 0);
end;
$$;
revoke execute on function public.admin_role_templates() from public, anon;
grant execute on function public.admin_role_templates() to authenticated;

-- ------------------------------------------------------------------ scope checks (answer about the signed-in admin)
-- true for owners, full admins and admins whose scope is "all"
create or replace function public._scope_is_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin and (p.is_super_admin or g.user_id is null or g.scope_kind = 'all')
                     from public.profiles p left join public.admin_grants g on g.user_id = p.id where p.id = auth.uid()), false);
$$;

-- may the signed-in admin see or change a member of this department / batch?
create or replace function public._scope_ok(p_branch text, p_grad int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin and (p.is_super_admin or g.user_id is null or g.scope_kind = 'all'
                          or (g.scope_kind = 'department' and g.scope_value is not distinct from p_branch)
                          or (g.scope_kind = 'batch' and g.scope_value is not distinct from p_grad::text))
                     from public.profiles p left join public.admin_grants g on g.user_id = p.id where p.id = auth.uid()), false);
$$;

create or replace function public._scope_ok_member(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles m where m.id = p_member and public._scope_ok(m.branch, m.grad_year));
$$;

create or replace function public._require_scope(p_member uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles m where m.id = p_member) and not public._scope_ok_member(p_member) then
    raise exception 'That member is outside your department or batch.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._require_scope_all()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._scope_is_all() then
    raise exception 'This is only for admins who look after all members, not one department or batch.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._require_scope(uuid) from public, anon, authenticated;
revoke execute on function public._require_scope_all() from public, anon, authenticated;
revoke execute on function public._scope_is_all() from public;
revoke execute on function public._scope_ok(text, int) from public;
revoke execute on function public._scope_ok_member(uuid) from public;
grant execute on function public._scope_is_all() to anon, authenticated;
grant execute on function public._scope_ok(text, int) to anon, authenticated;
grant execute on function public._scope_ok_member(uuid) to anon, authenticated;

-- direct table reads/writes by admins follow the same scope
drop policy "own private details" on public.profile_private;
create policy "own private details" on public.profile_private for select to authenticated
  using (id = auth.uid() or (public._admin_can('members_view') and ((select public._scope_is_all()) or public._scope_ok_member(id))));
drop policy "admins update private details" on public.profile_private;
create policy "admins update private details" on public.profile_private for update to authenticated
  using (public._admin_can('members_edit') and ((select public._scope_is_all()) or public._scope_ok_member(id)));
drop policy "admins update any profile" on public.profiles;
create policy "admins update any profile" on public.profiles for update to authenticated
  using (public._admin_can('members_edit') and ((select public._scope_is_all()) or public._scope_ok(branch, grad_year)));
drop policy "admins read member notes" on public.admin_member_notes;
create policy "admins read member notes" on public.admin_member_notes for select to authenticated
  using (public._admin_can('members_view') and ((select public._scope_is_all()) or public._scope_ok_member(member_id)));

-- ------------------------------------------------------------------ patch the member-facing admin functions in place
-- Matches the text exactly first; if the live function differs only in spacing or indentation (it can, depending on the
-- order older migrations were applied), match it again treating every run of whitespace as equivalent.
create or replace function pg_temp.flex_replace(def text, p_from text, p_to text)
returns text
language plpgsql
as $$
declare
  rx text;
begin
  if position(p_from in def) > 0 then return replace(def, p_from, p_to); end if;
  rx := regexp_replace(p_from, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g');
  rx := regexp_replace(rx, '\s+', '\s+', 'g');
  if def !~ rx then return def; end if;
  return regexp_replace(def, rx, replace(p_to, '\', '\\'));
end $$;

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
  new_def := pg_temp.flex_replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

create or replace function pg_temp.patch2(p_fn text, a1 text, b1 text, a2 text, b2 text)
returns void
language plpgsql
as $$
declare
  def text;
  d1 text;
  d2 text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f';
  d1 := pg_temp.flex_replace(def, a1, b1);
  if d1 = def then raise exception 'function % has nothing to replace (first part)', p_fn; end if;
  d2 := pg_temp.flex_replace(d1, a2, b2);
  if d2 = d1 then raise exception 'function % has nothing to replace (second part)', p_fn; end if;
  execute d2;
end $$;

do $$
declare
  r record;
begin
  -- list: only members inside the scope
  perform pg_temp.patch('admin_list_members', 'where (v_q is null or', 'where ((select public._scope_is_all()) or public._scope_ok(p.branch, p.grad_year)) and (v_q is null or');
  -- search: members inside the scope; registrations and payments only for admins of everyone
  perform pg_temp.patch2('admin_search',
    E'where position(q in lower(p.full_name)) > 0\n          or position(q in lower(coalesce(p.current_company',
    E'where ((select public._scope_is_all()) or public._scope_ok(p.branch, p.grad_year)) and (position(q in lower(p.full_name)) > 0\n          or position(q in lower(coalesce(p.current_company',
    E'like \'%\' || digits || \'%\')\n       order by (position(q in lower(p.full_name)) = 1)',
    E'like \'%\' || digits || \'%\'))\n       order by (position(q in lower(p.full_name)) = 1)');
  perform pg_temp.patch('admin_search', 'where public.has_event_cap(''finance'', r.event_id)', 'where (public._scope_is_all() or not public.is_admin()) and public.has_event_cap(''finance'', r.event_id)');
end $$;

do $$
declare
  r record;
begin
  -- one member by id
  perform pg_temp.patch('admin_member_timeline', 'perform public._require_perm(''members_view'');', 'perform public._require_perm(''members_view'');
  perform public._require_scope(p_id);');
  perform pg_temp.patch('admin_view_as_member', 'select jsonb_build_object(''id'', p.id, ''full_name'', p.full_name, ''avatar_url'', p.avatar_url, ''headline''',
    'perform public._require_scope(p_member);
  select jsonb_build_object(''id'', p.id, ''full_name'', p.full_name, ''avatar_url'', p.avatar_url, ''headline''');
  perform pg_temp.patch('admin_member_email', 'select email into v from auth.users where id = p_id;', 'perform public._require_scope(p_id);
  select email into v from auth.users where id = p_id;');
  -- an owner can edit their own profile; nobody else edits an owner
  perform pg_temp.patch('admin_update_member', 'select * into before from public.profiles where id = p_id for update;',
    'perform public._require_scope(p_id);
  if public._is_protected_owner(p_id) and p_id is distinct from auth.uid() then
    raise exception ''Ownership is locked: owner accounts are permanent and only the owner edits their own profile.'' using errcode = ''42501'';
  end if;
  select * into before from public.profiles where id = p_id for update;');
  -- bulk verification: all inside scope, and never move an owner away from verified
  perform pg_temp.patch('admin_bulk_set_verification', 'if v_total > 1000 then raise exception ''At most 1000 members at a time.''; end if;',
    'if v_total > 1000 then raise exception ''At most 1000 members at a time.''; end if;
  if exists (select 1 from public.profiles p where p.id = any (p_ids) and not public._scope_ok(p.branch, p.grad_year)) then
    raise exception ''Some of these members are outside your department or batch.'' using errcode = ''42501'';
  end if;
  if p_verification <> ''verified'' and exists (select 1 from public.protected_owners o where o.user_id = any (p_ids)) then
    raise exception ''Ownership is locked: an owner cannot be rejected or un-verified.'' using errcode = ''42501'';
  end if;');
  -- the counts a scoped admin sees are their own members
  perform pg_temp.patch('admin_attention', 'from public.profiles where onboarded and verification = ''pending''', 'from public.profiles where ((select public._scope_is_all()) or public._scope_ok(branch, grad_year)) and onboarded and verification = ''pending''');
  -- merging: both people inside the scope, never an owner
  perform pg_temp.patch('admin_merge_members', 'if d.is_admin then raise exception',
    'if public._is_protected_owner(p_drop) then
    raise exception ''Ownership is locked: an owner account can never be merged away.'' using errcode = ''42501'';
  end if;
  if not (public._scope_ok(k.branch, k.grad_year) and public._scope_ok(d.branch, d.grad_year)) then
    raise exception ''Both members must be inside your department or batch.'' using errcode = ''42501'';
  end if;
  if d.is_admin then raise exception');
  perform pg_temp.patch('admin_merge_preview', 'perform public._require_perm(''members_merge'');', 'perform public._require_perm(''members_merge'');
  perform public._require_scope_all();');
  -- whole-list tools are for admins of everyone
  for r in select * from (values ('admin_member_duplicates', 'members_merge'), ('admin_dismiss_duplicate', 'members_merge'),
      ('admin_export_members', 'members_export'), ('admin_import_preview', 'members_import'), ('admin_import_start', 'members_import'),
      ('admin_add_member_note', 'members_edit'), ('admin_delete_member_note', 'members_edit'),
      ('admin_save_member_view', 'members_view'), ('admin_delete_member_view', 'members_view')) as v(fn, perm) loop
    perform pg_temp.patch(r.fn, format('public._require_perm(%L);', r.perm), format('public._require_perm(%L);
  perform public._require_scope_all();', r.perm));
  end loop;
end $$;

-- ------------------------------------------------------------------ admin_set_member: verification only; owners and scope guarded
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
  perform public._require_scope(p_id);
  if public._is_protected_owner(p_id) and (p_is_admin is distinct from null and p_is_admin is distinct from true
                                           or p_verification is not null and p_verification <> 'verified') then
    raise exception 'Ownership is locked: an owner cannot be demoted, rejected or un-verified.' using errcode = '42501';
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

-- ------------------------------------------------------------------ groups: a department head runs that department's groups, a batch rep that batch's
create or replace function public.is_group_admin(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._admin_can('community_circles')
      or exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid() and m.role = 'admin')
      or exists (select 1 from public.groups gr
                   join public.admin_grants ag on ag.user_id = auth.uid()
                   join public.profiles me on me.id = ag.user_id and me.is_admin
                  where gr.id = p_group
                    and ((ag.scope_kind = 'department' and gr.branch is not distinct from ag.scope_value)
                      or (ag.scope_kind = 'batch' and gr.grad_year::text is not distinct from ag.scope_value)));
$$;

-- ------------------------------------------------------------------ make / change / remove an admin (now with role templates and scope)
drop function if exists public.admin_set_admin(uuid, boolean, text[], text);
create or replace function public.admin_set_admin(p_user uuid, p_enabled boolean, p_permissions text[] default null, p_note text default null,
                                                  p_template text default null, p_scope_kind text default null, p_scope_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.profiles;
  g public.admin_grants;
  tpl public.admin_role_templates;
  v_had_grant boolean;
  v_perms text[];
  v_tpl text;
  v_skind text := coalesce(nullif(btrim(coalesce(p_scope_kind, '')), ''), 'all');
  v_sval text := nullif(btrim(coalesce(p_scope_value, '')), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_body text;
  v_changed boolean := false;
  v_action text;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only a super admin can do this' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Choose whether to give or remove admin access.'; end if;
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.is_super_admin or public._is_protected_owner(p_user) then
    raise exception 'Ownership is locked: owners are permanent and their access cannot be changed.' using errcode = '42501';
  end if;
  select * into g from public.admin_grants where user_id = p_user;
  v_had_grant := found;

  if p_enabled then
    if p_template is not null then
      select * into tpl from public.admin_role_templates where key = p_template;
      if not found then raise exception 'Unknown role.'; end if;
      v_tpl := tpl.key;
      if p_permissions is null and tpl.permissions is not null then
        v_perms := public._expand_permissions(tpl.permissions);
        if cardinality(v_perms) = 0 then raise exception 'This role has no permissions to give yet.'; end if;
      end if;
    end if;
    if p_permissions is not null then
      v_perms := public._clean_permissions(p_permissions);
      if cardinality(v_perms) = 0 then raise exception 'Choose at least one thing this admin may do, or give full admin access.'; end if;
    end if;
    if v_skind not in ('all', 'department', 'batch') then raise exception 'Unknown scope.'; end if;
    if v_skind = 'all' then
      v_sval := null;
    elsif v_skind = 'batch' and (v_sval is null or v_sval !~ '^[0-9]{4}$') then
      raise exception 'Choose the batch year (for example 2005).';
    elsif v_skind = 'department' and (v_sval is null or char_length(v_sval) not between 2 and 120) then
      raise exception 'Choose the department.';
    end if;
    if tpl.key is not null and tpl.scope_kind <> 'none' and v_skind is distinct from tpl.scope_kind then
      raise exception 'This role is for one %: choose which.', case tpl.scope_kind when 'department' then 'department' else 'batch' end;
    end if;
    if tpl.key is not null and tpl.scope_kind = 'none' and v_skind <> 'all' then
      raise exception 'This role is not limited to a department or batch.';
    end if;
    if v_skind <> 'all' and v_perms is null then raise exception 'A department or batch admin needs a list of permissions.'; end if;
    if v_perms is null then v_tpl := case when v_tpl = 'full' then null else v_tpl end; end if;

    if not t.is_admin then
      update public.profiles set is_admin = true where id = p_user;
      v_changed := true;
      v_action := 'admin_granted';
    end if;
    if v_perms is null then
      if v_had_grant then delete from public.admin_grants where user_id = p_user; v_changed := true; end if;
    elsif not v_had_grant then
      insert into public.admin_grants (user_id, permissions, note, granted_by, template_key, scope_kind, scope_value)
        values (p_user, v_perms, v_note, auth.uid(), v_tpl, v_skind, v_sval);
      v_changed := true;
    elsif g.permissions is distinct from v_perms or g.note is distinct from v_note or g.template_key is distinct from v_tpl
          or g.scope_kind is distinct from v_skind or g.scope_value is distinct from v_sval then
      update public.admin_grants set permissions = v_perms, note = v_note, granted_by = auth.uid(), updated_at = now(),
             template_key = v_tpl, scope_kind = v_skind, scope_value = v_sval where user_id = p_user;
      v_changed := true;
    end if;
    if t.is_admin and v_changed then v_action := 'admin_permissions_changed'; end if;
    if v_changed then
      perform public._audit(v_action, 'profiles', p_user, jsonb_build_object('name', t.full_name, 'full', v_perms is null,
        'permissions', to_jsonb(v_perms), 'role', coalesce(v_tpl, case when v_perms is null then 'full' end), 'scope_kind', v_skind, 'scope_value', v_sval,
        'was_admin', t.is_admin, 'was_full', t.is_admin and not v_had_grant,
        'was_permissions', case when v_had_grant then to_jsonb(g.permissions) end, 'note', v_note));
      v_body := case when v_action = 'admin_granted'
                     then 'You now have admin access' || case when v_perms is null then ' (full admin).' else format(' (%s permissions).', cardinality(v_perms)) end
                     else 'Your admin permissions were changed' || case when v_perms is null then ': you are now a full admin.' else format(': %s permissions.', cardinality(v_perms)) end end;
      perform public._notify(p_user, 'admin_access', auth.uid(), null, v_body);
    end if;
  else
    if p_user = auth.uid() then raise exception 'You cannot remove your own admin access.'; end if;
    if t.is_admin then
      update public.profiles set is_admin = false where id = p_user;   -- the grants row goes with it
      v_changed := true;
      perform public._audit('admin_removed', 'profiles', p_user, jsonb_build_object('name', t.full_name,
        'was_full', not v_had_grant, 'was_permissions', case when v_had_grant then to_jsonb(g.permissions) end, 'note', v_note));
      perform public._notify(p_user, 'admin_access', auth.uid(), null, 'Your admin access was removed.');
    end if;
  end if;

  return jsonb_build_object('changed', v_changed, 'is_admin', p_enabled, 'full', p_enabled and v_perms is null, 'permissions', to_jsonb(v_perms));
end;
$$;
revoke execute on function public.admin_set_admin(uuid, boolean, text[], text, text, text, text) from anon, public;
grant execute on function public.admin_set_admin(uuid, boolean, text[], text, text, text, text) to authenticated;

-- ------------------------------------------------------------------ who holds access (role label, scope, permanent owners)
create or replace function public.admin_list_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_super boolean := public.is_super_admin();
begin
  if auth.uid() is null or not public._admin_can('admins') then
    raise exception 'You do not have permission to see this. Ask a super admin.' using errcode = '42501';
  end if;
  return jsonb_build_object('viewer_is_super', v_super, 'admins', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'grad_year', p.grad_year, 'branch', p.branch,
        'is_super', p.is_super_admin, 'is_owner', public._is_protected_owner(p.id),
        'full', p.is_super_admin or g.user_id is null,
        'role_key', g.template_key, 'role_label', case when p.is_super_admin then 'Owner' when g.user_id is null then 'Full admin'
                                                       else coalesce(tp.label, 'Custom') end,
        'scope_kind', coalesce(g.scope_kind, 'all'), 'scope_value', g.scope_value,
        'permission_count', case when p.is_super_admin or g.user_id is null then (select count(*) from public._permission_catalog())
                                 else cardinality(g.permissions) end,
        'permissions', case when v_super or p.id = auth.uid()
                            then (case when p.is_super_admin or g.user_id is null then (select jsonb_agg(c.key order by c.sort) from public._permission_catalog() c)
                                       else to_jsonb(g.permissions) end) end,
        'note', case when v_super then g.note end,
        'granted_at', case when v_super then coalesce(g.granted_at, h.at) end,
        'granted_by', case when v_super then coalesce(gb.full_name, hb.full_name) end)
      order by p.is_super_admin desc, p.full_name), '[]'::jsonb)
    from public.profiles p
    left join public.admin_grants g on g.user_id = p.id
    left join public.admin_role_templates tp on tp.key = g.template_key
    left join public.profiles gb on gb.id = g.granted_by
    left join lateral (select a.actor, a.created_at as at from public.admin_audit a
                        where a.target_id = p.id and a.action in ('admin_granted', 'admin_permissions_changed')
                        order by a.id desc limit 1) h on true
    left join public.profiles hb on hb.id = h.actor
   where p.is_admin));
end;
$$;

-- your own access, with your role and scope
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
    return jsonb_build_object('is_admin', false, 'is_super', false, 'full', false, 'permissions', '[]'::jsonb, 'scope_kind', 'all', 'scope_value', null);
  end if;
  select * into g from public.admin_grants where user_id = p.id;
  v_full := p.is_super_admin or not found;
  return jsonb_build_object('is_admin', true, 'is_super', p.is_super_admin, 'full', v_full,
    'role_key', case when not v_full then g.template_key end,
    'scope_kind', case when v_full then 'all' else g.scope_kind end, 'scope_value', case when v_full then null else g.scope_value end,
    'permissions', case when v_full then (select coalesce(jsonb_agg(c.key order by c.sort), '[]'::jsonb) from public._permission_catalog() c)
                        else to_jsonb(g.permissions) end);
end;
$$;
