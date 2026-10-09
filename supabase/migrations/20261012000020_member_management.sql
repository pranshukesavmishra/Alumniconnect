-- Member management at scale (admin pass 2): filtered member list with saved views, bulk verify / reject, logged
-- bulk export, CSV import dry-run, duplicate detection and merge, private admin notes, and a per-member timeline.
-- Every function checks the caller itself (admins only), is SECURITY DEFINER with an empty search_path, and writes
-- what it changes to the activity log. Phone numbers and e-mail addresses only leave through logged functions.

-- ------------------------------------------------------------------ tables
-- Private notes the committee keeps about a member ("called on 3 Oct, sending ID proof"). Members never see them.
create table if not exists public.admin_member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  author uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists admin_member_notes_member_idx on public.admin_member_notes (member_id, created_at desc);
alter table public.admin_member_notes enable row level security;
drop policy if exists "admins read member notes" on public.admin_member_notes;
create policy "admins read member notes" on public.admin_member_notes for select to authenticated using (public.is_admin());
grant select on public.admin_member_notes to authenticated;

-- Saved member-list filters, shared by the committee ("Pending, older than 3 days", "2005 batch, Pune").
create table if not exists public.admin_member_views (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  filter jsonb not null check (jsonb_typeof(filter) = 'object' and pg_column_size(filter) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_member_views enable row level security;
drop policy if exists "admins read member views" on public.admin_member_views;
create policy "admins read member views" on public.admin_member_views for select to authenticated using (public.is_admin());
grant select on public.admin_member_views to authenticated;

-- Pairs an admin has looked at and said "these are different people", so they stop being suggested.
create table if not exists public.admin_duplicate_dismissals (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  dismissed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table public.admin_duplicate_dismissals enable row level security;
drop policy if exists "admins read dismissals" on public.admin_duplicate_dismissals;
create policy "admins read dismissals" on public.admin_duplicate_dismissals for select to authenticated using (public.is_admin());
grant select on public.admin_duplicate_dismissals to authenticated;

-- ------------------------------------------------------------------ helpers (internal)
create or replace function public._norm_name(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^[:alpha:]]', '', 'g');
$$;
create or replace function public._norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case when char_length(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')) >= 10
              then right(regexp_replace(p, '[^0-9]', '', 'g'), 10) end;
$$;
-- "asha.rao@gmail.com" -> "as•••ao@gmail.com": enough to tell two accounts apart, not enough to contact anyone.
create or replace function public._mask_email(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p is null or position('@' in p) = 0 then null
              when char_length(split_part(p, '@', 1)) > 5
              then left(split_part(p, '@', 1), 2) || '•••' || right(split_part(p, '@', 1), 2) || '@' || split_part(p, '@', 2)
              else left(split_part(p, '@', 1), 2) || '•••@' || split_part(p, '@', 2) end;
$$;
revoke execute on function public._norm_name(text) from anon, authenticated, public;
revoke execute on function public._norm_phone(text) from anon, authenticated, public;
revoke execute on function public._mask_email(text) from anon, authenticated, public;

create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._require_admin() from anon, authenticated, public;

-- ------------------------------------------------------------------ the member list
-- p_filter keys (all optional): q, status (all|pending|verified|rejected|admins), onboarded (yes|no), older (days since
-- joining), signin (never|yes), branch, batch_from, batch_to, city, type (alumnus|student|faculty),
-- sort (newest|oldest|name|batch). With p_ids_only it returns every matching id (up to 2000) for "select all".
create or replace function public.admin_list_members(p_filter jsonb default '{}', p_limit int default 40, p_offset int default 0, p_ids_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_q text := nullif(lower(btrim(coalesce(f ->> 'q', ''))), '');
  v_status text := coalesce(nullif(f ->> 'status', ''), 'all');
  v_onb text := nullif(f ->> 'onboarded', '');
  v_older int;
  v_signin text := nullif(f ->> 'signin', '');
  v_branch text := nullif(f ->> 'branch', '');
  v_from int;
  v_to int;
  v_city text := nullif(lower(btrim(coalesce(f ->> 'city', ''))), '');
  v_type text := nullif(f ->> 'type', '');
  v_sort text := coalesce(nullif(f ->> 'sort', ''), 'newest');
  v_total int;
  v_out jsonb;
begin
  perform public._require_admin();
  if jsonb_typeof(f) <> 'object' then raise exception 'Those filters are not valid.'; end if;
  if v_status not in ('all', 'pending', 'verified', 'rejected', 'admins') then raise exception 'Unknown status filter.'; end if;
  if v_onb is not null and v_onb not in ('yes', 'no') then raise exception 'Unknown profile filter.'; end if;
  if v_signin is not null and v_signin not in ('yes', 'never') then raise exception 'Unknown sign-in filter.'; end if;
  if v_type is not null and v_type not in ('alumnus', 'student', 'faculty') then raise exception 'Unknown member type.'; end if;
  if v_sort not in ('newest', 'oldest', 'name', 'batch') then raise exception 'Unknown sort order.'; end if;
  if (f ->> 'older') is not null then
    if (f ->> 'older') !~ '^[0-9]{1,4}$' then raise exception 'Days must be a whole number.'; end if;
    v_older := (f ->> 'older')::int;
  end if;
  if (f ->> 'batch_from') is not null then
    if (f ->> 'batch_from') !~ '^[0-9]{4}$' then raise exception 'Batch years look like 2005.'; end if;
    v_from := (f ->> 'batch_from')::int;
  end if;
  if (f ->> 'batch_to') is not null then
    if (f ->> 'batch_to') !~ '^[0-9]{4}$' then raise exception 'Batch years look like 2005.'; end if;
    v_to := (f ->> 'batch_to')::int;
  end if;
  v_q := left(v_q, 100);
  p_limit := least(greatest(coalesce(p_limit, 40), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  with mm as (
    select p.id, p.full_name, p.grad_year, p.created_at, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where (v_q is null or position(v_q in lower(p.full_name)) > 0 or position(v_q in lower(coalesce(p.city, ''))) > 0
            or position(v_q in lower(coalesce(p.current_company, ''))) > 0 or position(v_q in lower(coalesce(p.branch, ''))) > 0)
       and (v_status = 'all' or (v_status = 'admins' and p.is_admin) or p.verification::text = v_status)
       and (v_onb is null or p.onboarded = (v_onb = 'yes'))
       and (v_older is null or p.created_at < now() - make_interval(days => v_older))
       and (v_signin is null or (u.last_sign_in_at is null) = (v_signin = 'never'))
       and (v_branch is null or p.branch = v_branch)
       and (v_from is null or p.grad_year >= v_from)
       and (v_to is null or p.grad_year <= v_to)
       and (v_city is null or position(v_city in lower(coalesce(p.city, ''))) > 0)
       and (v_type is null or p.member_type::text = v_type)
  ), ordered as (
    select mm.*, row_number() over (order by
             case when v_sort = 'name' then lower(mm.full_name) end,
             case when v_sort = 'batch' then mm.grad_year end desc nulls last,
             case when v_sort = 'oldest' then mm.created_at end,
             mm.created_at desc, mm.id) as ord
      from mm
  )
  select (select count(*) from mm),
         case when p_ids_only then
           (select coalesce(jsonb_agg(o.id order by o.ord), '[]'::jsonb) from (select id, ord from ordered order by ord limit 2000) o)
         else
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'member_type', p.member_type, 'branch', p.branch,
                     'grad_year', p.grad_year, 'city', p.city, 'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
                     'created_at', p.created_at, 'last_sign_in_at', o.last_sign_in_at,
                     'notes', (select count(*) from public.admin_member_notes n where n.member_id = p.id)) order by o.ord), '[]'::jsonb)
              from (select * from ordered order by ord limit p_limit offset p_offset) o
              join public.profiles p on p.id = o.id)
         end
    into v_total, v_out;
  if p_ids_only then
    return jsonb_build_object('total', v_total, 'ids', v_out);
  end if;
  return jsonb_build_object('total', v_total, 'rows', v_out);
end;
$$;

-- ------------------------------------------------------------------ bulk verify / reject
create or replace function public.admin_bulk_set_verification(p_ids uuid[], p_verification public.verification_status, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  r record;
  v_changed int := 0;
  v_total int := coalesce(cardinality(p_ids), 0);
begin
  perform public._require_admin();
  if p_verification is null then raise exception 'Choose verify, reject or not yet verified.'; end if;
  if v_total = 0 then raise exception 'Select at least one member.'; end if;
  if v_total > 1000 then raise exception 'At most 1000 members at a time.'; end if;
  for r in
    select p.id, p.verification from public.profiles p
     where p.id = any (p_ids) and p.verification <> p_verification
     for update
  loop
    update public.profiles set verification = p_verification where id = r.id;
    perform public._audit('set_member_flags', 'profiles', r.id,
      jsonb_build_object('verification', jsonb_build_object('from', r.verification, 'to', p_verification), 'bulk', true)
      || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
    v_changed := v_changed + 1;
  end loop;
  return jsonb_build_object('changed', v_changed, 'unchanged', v_total - v_changed);
end;
$$;

-- ------------------------------------------------------------------ export (logged)
create or replace function public.admin_export_members(p_ids uuid[], p_contact boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform public._require_admin();
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one member.'; end if;
  if cardinality(p_ids) > 5000 then raise exception 'At most 5000 members at a time.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', p.full_name, 'member_type', p.member_type, 'branch', p.branch, 'grad_year', p.grad_year, 'join_year', p.join_year,
           'city', p.city, 'country', p.country, 'current_title', p.current_title, 'current_company', p.current_company,
           'linkedin_url', p.linkedin_url, 'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
           'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at)
           || case when coalesce(p_contact, false) then jsonb_build_object('phone', pp.phone, 'email', u.email) else '{}'::jsonb end
           order by p.full_name), '[]'::jsonb)
    into v_rows
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_private pp on pp.id = p.id
   where p.id = any (p_ids);
  perform public._audit('export_members', 'profiles', null,
    jsonb_build_object('count', jsonb_array_length(v_rows), 'contact', coalesce(p_contact, false)));
  return v_rows;
end;
$$;

-- ------------------------------------------------------------------ notes
create or replace function public.admin_add_member_note(p_member uuid, p_body text)
returns public.admin_member_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v public.admin_member_notes;
begin
  perform public._require_admin();
  if char_length(v_body) = 0 then raise exception 'Write a note first.'; end if;
  if char_length(v_body) > 2000 then raise exception 'Notes can be at most 2000 characters.'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'That member no longer exists.'; end if;
  insert into public.admin_member_notes (member_id, author, body) values (p_member, auth.uid(), v_body) returning * into v;
  perform public._audit('add_member_note', 'profiles', p_member, jsonb_build_object('note_id', v.id));
  return v;
end;
$$;

create or replace function public.admin_delete_member_note(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.admin_member_notes;
begin
  perform public._require_admin();
  delete from public.admin_member_notes where id = p_id returning * into v;
  if v.id is null then raise exception 'That note was already removed.'; end if;
  perform public._audit('delete_member_note', 'profiles', v.member_id, jsonb_build_object('note_id', v.id, 'written_by', v.author));
end;
$$;

-- ------------------------------------------------------------------ saved views
create or replace function public.admin_save_member_view(p_name text, p_filter jsonb)
returns public.admin_member_views
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v public.admin_member_views;
begin
  perform public._require_admin();
  if char_length(v_name) = 0 or char_length(v_name) > 60 then raise exception 'Give the view a name (up to 60 characters).'; end if;
  if p_filter is null or jsonb_typeof(p_filter) <> 'object' or pg_column_size(p_filter) > 2000 then raise exception 'Those filters are not valid.'; end if;
  perform public.admin_list_members(p_filter, 1, 0, true); -- validates the filter with the same rules as the list
  insert into public.admin_member_views (name, filter, created_by) values (v_name, p_filter, auth.uid())
  on conflict (name) do update set filter = excluded.filter, created_by = excluded.created_by, created_at = now()
  returning * into v;
  perform public._audit('save_member_view', 'admin_member_views', v.id, jsonb_build_object('name', v.name, 'filter', v.filter));
  return v;
end;
$$;

create or replace function public.admin_delete_member_view(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.admin_member_views;
begin
  perform public._require_admin();
  delete from public.admin_member_views where id = p_id returning * into v;
  if v.id is null then raise exception 'That view was already removed.'; end if;
  perform public._audit('delete_member_view', 'admin_member_views', v.id, jsonb_build_object('name', v.name));
end;
$$;

-- ------------------------------------------------------------------ timeline
-- Everything done to or by one member, newest first: joining and last sign-in, admin actions on them (and on their
-- registrations and payments), registrations, payments, reports they filed or received, and private notes.
create or replace function public.admin_member_timeline(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member jsonb;
  v_regs uuid[];
  v_merged uuid[];
  v_items jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'branch', p.branch, 'grad_year', p.grad_year,
           'city', p.city, 'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded, 'created_at', p.created_at,
           'last_sign_in_at', u.last_sign_in_at, 'added_by_admin', (u.raw_app_meta_data ? 'created_by_admin'))
    into v_member
    from public.profiles p join auth.users u on u.id = p.id where p.id = p_id;
  if v_member is null then raise exception 'That member no longer exists.'; end if;

  select coalesce(array_agg(id), '{}') into v_regs from public.event_registrations where user_id = p_id;
  select coalesce(array_agg((details ->> 'merged_id')::uuid), '{}') into v_merged
    from public.admin_audit where action = 'merge_member' and target_id = p_id and details ? 'merged_id';

  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_items from (
    select x from (
      select jsonb_build_object('at', (v_member ->> 'created_at')::timestamptz, 'kind', 'joined') as x
      union all
      select jsonb_build_object('at', (v_member ->> 'last_sign_in_at')::timestamptz, 'kind', 'signin')
       where v_member ->> 'last_sign_in_at' is not null
      union all
      (select jsonb_build_object('at', a.created_at, 'kind', case when a.target_id = p_id or a.target_id = any (v_merged) then 'admin' else 'admin_registration' end,
                'action', a.action, 'details', a.details, 'actor_id', a.actor, 'actor_name', ap.full_name)
         from public.admin_audit a left join public.profiles ap on ap.id = a.actor
        where a.target_id = p_id or a.target_id = any (v_regs) or a.target_id = any (v_merged)
        order by a.created_at desc limit 200)
      union all
      (select jsonb_build_object('at', a.created_at, 'kind', 'did', 'action', a.action, 'details', a.details, 'target_table', a.target_table)
         from public.admin_audit a
        where a.actor = p_id and a.target_id is distinct from p_id
        order by a.created_at desc limit 50)
      union all
      select jsonb_build_object('at', r.created_at, 'kind', 'registration', 'code', r.code, 'status', r.status, 'amount_paise', r.amount_paise,
               'headcount', r.headcount, 'event_slug', e.slug, 'event_title', e.title, 'checked_in_at', r.checked_in_at)
        from public.event_registrations r join public.events e on e.id = r.event_id where r.user_id = p_id
      union all
      select jsonb_build_object('at', pay.created_at, 'kind', 'payment', 'code', r.code, 'status', pay.status, 'method', pay.method,
               'amount_paise', pay.amount_paise, 'utr', pay.utr, 'event_slug', e.slug, 'event_title', e.title, 'reviewed_at', pay.reviewed_at)
        from public.event_payments pay join public.event_registrations r on r.id = pay.registration_id join public.events e on e.id = r.event_id
       where r.user_id = p_id
      union all
      select jsonb_build_object('at', rp.created_at, 'kind', 'report_by', 'target_type', rp.target_type, 'reason', rp.reason, 'status', rp.status)
        from public.reports rp where rp.reporter = p_id
      union all
      select jsonb_build_object('at', rp.created_at, 'kind', 'report_about', 'target_type', rp.target_type, 'reason', rp.reason, 'status', rp.status,
               'reporter_name', rpp.full_name)
        from public.reports rp left join public.profiles rpp on rpp.id = rp.reporter
       where (rp.target_type = 'profile' and rp.target_id = p_id)
          or (rp.target_type = 'post' and exists (select 1 from public.posts po where po.id = rp.target_id and po.author_id = p_id))
          or (rp.target_type = 'comment' and exists (select 1 from public.comments c where c.id = rp.target_id and c.author_id = p_id))
          or (rp.target_type = 'message' and exists (select 1 from public.messages m where m.id = rp.target_id and m.sender_id = p_id))
      union all
      select jsonb_build_object('at', n.created_at, 'kind', 'note', 'id', n.id, 'body', n.body, 'actor_id', n.author, 'actor_name', np.full_name)
        from public.admin_member_notes n left join public.profiles np on np.id = n.author where n.member_id = p_id
    ) all_items
    order by (x ->> 'at') desc
    limit 400
  ) s;
  return jsonb_build_object('member', v_member, 'items', v_items);
end;
$$;

-- ------------------------------------------------------------------ CSV import: dry run
-- Checks rows before anything is created: invalid data, already a member (same e-mail), possible duplicate (same phone,
-- or same name and batch), repeated in the file. Nothing is written except one activity-log line.
create or replace function public.admin_import_preview(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_name text;
  v_phone text;
  v_grad text;
  v_join text;
  v_type text;
  v_problem text;
  v_status text;
  v_match uuid;
  v_match_name text;
  v_seen text[] := '{}';
  v_counts jsonb := '{"new":0,"exists":0,"duplicate":0,"invalid":0}'::jsonb;
begin
  perform public._require_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to check.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'At most 2000 rows at a time. Split the file.'; end if;

  for r in select e.value as v, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e loop
    v_problem := null; v_match := null; v_match_name := null; v_status := 'new';
    v_email := lower(btrim(coalesce(r.v ->> 'email', '')));
    v_name := btrim(coalesce(r.v ->> 'full_name', ''));
    v_phone := btrim(coalesce(r.v ->> 'phone', ''));
    v_grad := btrim(coalesce(r.v ->> 'grad_year', ''));
    v_join := btrim(coalesce(r.v ->> 'join_year', ''));
    v_type := lower(btrim(coalesce(r.v ->> 'member_type', '')));

    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or char_length(v_email) > 254 then v_problem := 'E-mail address is missing or not valid';
    elsif char_length(v_name) < 2 or char_length(v_name) > 120 then v_problem := 'Full name is missing';
    elsif v_phone <> '' and v_phone !~ '^\+?[0-9 ]{8,16}$' then v_problem := 'Mobile number is not valid';
    elsif v_grad <> '' and v_grad !~ '^(19|20)[0-9]{2}$' then v_problem := 'Passing-out year should look like 2005';
    elsif v_join <> '' and v_join !~ '^(19|20)[0-9]{2}$' then v_problem := 'Joining year should look like 2001';
    elsif v_type <> '' and v_type not in ('alumnus', 'student', 'faculty') then v_problem := 'Member type should be alumnus, student or faculty';
    elsif char_length(coalesce(r.v ->> 'branch', '')) > 80 or char_length(coalesce(r.v ->> 'city', '')) > 80
       or char_length(coalesce(r.v ->> 'current_title', '')) > 120 or char_length(coalesce(r.v ->> 'current_company', '')) > 120 then
      v_problem := 'A field is too long';
    elsif v_email = any (v_seen) then v_problem := 'This e-mail appears earlier in the file';
    end if;

    if v_problem is not null then
      v_status := 'invalid';
    else
      v_seen := v_seen || v_email;
      select p.id, p.full_name into v_match, v_match_name from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = v_email limit 1;
      if v_match is not null then
        v_status := 'exists';
      else
        select p.id, p.full_name into v_match, v_match_name
          from public.profiles p left join public.profile_private pp on pp.id = p.id
         where (public._norm_phone(v_phone) is not null and public._norm_phone(pp.phone) = public._norm_phone(v_phone))
            or (public._norm_name(p.full_name) = public._norm_name(v_name) and public._norm_name(v_name) <> ''
                and (v_grad = '' or p.grad_year is null or p.grad_year = v_grad::int))
         order by (public._norm_phone(pp.phone) is not distinct from public._norm_phone(v_phone)) desc, p.created_at
         limit 1;
        if v_match is not null then v_status := 'duplicate'; end if;
      end if;
    end if;
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts ->> v_status)::int + 1));
    v_out := v_out || jsonb_build_object('row', r.n, 'status', v_status, 'problem', v_problem, 'member_id', v_match, 'member_name', v_match_name);
  end loop;
  perform public._audit('import_preview', 'profiles', null, v_counts);
  return jsonb_build_object('rows', v_out, 'counts', v_counts);
end;
$$;

-- ------------------------------------------------------------------ duplicates
create or replace function public.admin_member_duplicates(p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
  v_out jsonb;
begin
  perform public._require_admin();
  with m as (
    select p.id, p.full_name, lower(p.full_name) as lname, p.grad_year, p.branch, p.city, p.verification, p.is_admin, p.onboarded, p.created_at,
           u.last_sign_in_at, public._norm_name(p.full_name) as n, public._norm_phone(pp.phone) as ph
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.profile_private pp on pp.id = p.id
     where char_length(btrim(p.full_name)) >= 2
  ), pairs as (
    select a.id as a_id, b.id as b_id,
           (a.ph is not null and a.ph = b.ph) as same_phone,
           (a.n <> '' and a.n = b.n) as same_name,
           (a.grad_year = b.grad_year and a.n <> b.n and extensions.similarity(a.lname, b.lname) >= 0.55) as similar_name,
           greatest(a.created_at, b.created_at) as newest
      from m a
      join m b on a.id < b.id
       and ((a.ph is not null and a.ph = b.ph)
         or (a.n <> '' and a.n = b.n and (a.grad_year is null or b.grad_year is null or a.grad_year = b.grad_year))
         or (a.grad_year = b.grad_year and extensions.similarity(a.lname, b.lname) >= 0.55))
     where not exists (select 1 from public.admin_duplicate_dismissals d where d.a = a.id and d.b = b.id)
       and (v_q is null or position(v_q in a.lname) > 0 or position(v_q in b.lname) > 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'a', (select jsonb_build_object('id', id, 'full_name', full_name, 'grad_year', grad_year, 'branch', branch, 'city', city,
                   'verification', verification, 'is_admin', is_admin, 'onboarded', onboarded, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at)
                   from m where m.id = x.a_id),
           'b', (select jsonb_build_object('id', id, 'full_name', full_name, 'grad_year', grad_year, 'branch', branch, 'city', city,
                   'verification', verification, 'is_admin', is_admin, 'onboarded', onboarded, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at)
                   from m where m.id = x.b_id),
           'reasons', to_jsonb(array_remove(array[case when same_phone then 'phone' end, case when same_name then 'name' end,
                                                   case when similar_name then 'similar_name' end], null)))
           order by x.rank, x.newest desc), '[]'::jsonb)
    into v_out
    from (select *, case when same_phone and same_name then 0 when same_phone then 1 when same_name then 2 else 3 end as rank
            from pairs order by rank, newest desc limit 100) x;
  return v_out;
end;
$$;

create or replace function public.admin_dismiss_duplicate(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  if p_a is null or p_b is null or p_a = p_b then raise exception 'Choose two different members.'; end if;
  insert into public.admin_duplicate_dismissals (a, b, dismissed_by) values (least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
  perform public._audit('dismiss_duplicate', 'profiles', least(p_a, p_b), jsonb_build_object('other', greatest(p_a, p_b)));
end;
$$;

-- ------------------------------------------------------------------ merge
-- What a merge would do: both sides (e-mail masked), how many rows of each kind move, and anything that blocks it.
create or replace function public.admin_merge_preview(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fk record;
  n bigint;
  v_moves jsonb := '{}'::jsonb;
  v_blocks text[] := '{}';
  v_side jsonb;
begin
  perform public._require_admin();
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Choose two different members.'; end if;
  for fk in
    select c.conrelid::regclass::text as tbl, (select cl.relname::text from pg_class cl where cl.oid = c.conrelid) as name, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
       and not (c.conrelid = 'public.profile_private'::regclass and a.attname = 'id')
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using p_drop;
    if n > 0 then v_moves := v_moves || jsonb_build_object(fk.name, coalesce((v_moves ->> fk.name)::bigint, 0) + n); end if;
  end loop;
  select coalesce(array_agg('Both are registered for “' || e.title || '”. Cancel or remove one registration first.'), '{}') into v_blocks
    from public.event_registrations k join public.event_registrations d on d.event_id = k.event_id and d.user_id = p_drop
    join public.events e on e.id = k.event_id
   where k.user_id = p_keep;
  if (select is_admin from public.profiles where id = p_drop) then
    v_blocks := v_blocks || 'The profile being removed is an admin. Remove their admin access first.';
  end if;
  if p_drop = auth.uid() then v_blocks := v_blocks || 'You cannot merge away your own account.'; end if;

  select jsonb_object_agg(case when p.id = p_keep then 'keep' else 'drop' end,
           jsonb_build_object('id', p.id, 'full_name', p.full_name, 'branch', p.branch, 'grad_year', p.grad_year, 'city', p.city,
             'current_company', p.current_company, 'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
             'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at, 'email', public._mask_email(u.email),
             'has_phone', pp.phone is not null))
    into v_side
    from public.profiles p join auth.users u on u.id = p.id left join public.profile_private pp on pp.id = p.id
   where p.id in (p_keep, p_drop);
  if v_side is null or not (v_side ? 'keep') or not (v_side ? 'drop') then raise exception 'One of these members no longer exists.'; end if;
  return v_side || jsonb_build_object('moves', v_moves, 'blocks', to_jsonb(v_blocks));
end;
$$;

-- Moves everything that belongs to p_drop onto p_keep, fills the keeper's empty profile fields from the duplicate,
-- then deletes the duplicate account. Rows that would become exact repeats (a circle membership both had, a like on
-- the same post, a follow between the two) are dropped. Refuses when both hold a registration for the same event.
create or replace function public.admin_merge_members(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.profiles;
  d public.profiles;
  v_email text;
  v_dphone text;
  fk record;
  r record;
  r2 record;
  v_other uuid;
  v_existing uuid;
  v_moved jsonb := '{}'::jsonb;
  v_dropped jsonb := '{}'::jsonb;
  v_title text;
begin
  perform public._require_admin();
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Choose two different members.'; end if;
  if p_drop = auth.uid() then raise exception 'You cannot merge away your own account.'; end if;
  select * into k from public.profiles where id = p_keep for update;
  select * into d from public.profiles where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'One of these members no longer exists.'; end if;
  if d.is_admin then raise exception 'The profile being removed is an admin. Remove their admin access first.'; end if;
  select e.title into v_title
    from public.event_registrations a join public.event_registrations b on b.event_id = a.event_id and b.user_id = p_drop
    join public.events e on e.id = a.event_id where a.user_id = p_keep limit 1;
  if v_title is not null then
    raise exception 'Both are registered for “%”. Cancel or remove one registration first.', v_title;
  end if;
  select email into v_email from auth.users where id = p_drop;
  select phone into v_dphone from public.profile_private where id = p_drop;

  -- direct chats: re-point to the keeper; if the keeper already talks to that person, the messages join that chat
  for r in select c.id, case when c.dm_a = p_drop then c.dm_b else c.dm_a end as other
             from public.chats c where c.kind = 'dm' and (c.dm_a = p_drop or c.dm_b = p_drop) loop
    v_other := r.other;
    if v_other = p_keep then
      delete from public.chats where id = r.id;
      v_dropped := v_dropped || jsonb_build_object('chats', coalesce((v_dropped ->> 'chats')::int, 0) + 1);
      continue;
    end if;
    select id into v_existing from public.chats where kind = 'dm' and dm_a = least(p_keep, v_other) and dm_b = greatest(p_keep, v_other);
    if v_existing is not null then
      -- messages, reactions, poll votes, read markers: everything hanging off the chat moves (exact repeats are dropped)
      for fk in
        select c.conrelid::regclass::text as tbl, (select cl.relname::text from pg_class cl where cl.oid = c.conrelid) as name, a.attname as col
          from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and cardinality(c.conkey) = 1 and c.confrelid = 'public.chats'::regclass
      loop
        for r2 in execute format('select ctid as t from %s where %I = $1', fk.tbl, fk.col) using r.id loop
          begin
            execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col) using v_existing, r2.t;
          exception when unique_violation or check_violation then
            execute format('delete from %s where ctid = $1', fk.tbl) using r2.t;
          end;
        end loop;
      end loop;
      delete from public.chats where id = r.id;
    else
      update public.chats set dm_a = least(p_keep, v_other), dm_b = greatest(p_keep, v_other) where id = r.id;
    end if;
    v_moved := v_moved || jsonb_build_object('chats', coalesce((v_moved ->> 'chats')::int, 0) + 1);
  end loop;

  -- every other column that points at a member, found from the schema (so tables added later are covered too)
  for fk in
    select c.conrelid::regclass::text as tbl, (select cl.relname::text from pg_class cl where cl.oid = c.conrelid) as name, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
       and not (c.conrelid = 'public.profile_private'::regclass and a.attname = 'id')
       and not (c.conrelid = 'public.chats'::regclass and a.attname in ('dm_a', 'dm_b'))
  loop
    for r in execute format('select ctid as t from %s where %I = $1', fk.tbl, fk.col) using p_drop loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col) using p_keep, r.t;
        v_moved := v_moved || jsonb_build_object(fk.name, coalesce((v_moved ->> fk.name)::int, 0) + 1);
      exception when unique_violation or check_violation then
        execute format('delete from %s where ctid = $1', fk.tbl) using r.t;
        v_dropped := v_dropped || jsonb_build_object(fk.name, coalesce((v_dropped ->> fk.name)::int, 0) + 1);
      end;
    end loop;
  end loop;

  -- the keeper's empty fields are filled from the duplicate; nothing the keeper already has is overwritten
  update public.profiles p set
    full_name = coalesce(nullif(btrim(k.full_name), ''), d.full_name),
    avatar_url = coalesce(k.avatar_url, d.avatar_url),
    headline = coalesce(nullif(k.headline, ''), d.headline),
    member_type = coalesce(k.member_type, d.member_type),
    branch = coalesce(nullif(k.branch, ''), d.branch),
    join_year = coalesce(k.join_year, d.join_year),
    grad_year = coalesce(k.grad_year, d.grad_year),
    current_title = coalesce(nullif(k.current_title, ''), d.current_title),
    current_company = coalesce(nullif(k.current_company, ''), d.current_company),
    city = coalesce(nullif(k.city, ''), d.city),
    about = coalesce(nullif(k.about, ''), d.about),
    linkedin_url = coalesce(k.linkedin_url, d.linkedin_url),
    website_url = coalesce(k.website_url, d.website_url),
    skills = case when cardinality(k.skills) = 0 then d.skills else k.skills end,
    onboarded = k.onboarded or d.onboarded,
    verification = case when k.verification = 'verified' or d.verification = 'verified' then 'verified'::public.verification_status else k.verification end,
    invited_by = case when k.invited_by = p_keep then null else k.invited_by end
   where p.id = p_keep;
  update public.profile_private set phone = coalesce(phone, v_dphone) where id = p_keep;

  perform public._audit('merge_member', 'profiles', p_keep, jsonb_build_object(
    'merged_id', p_drop, 'name', d.full_name, 'email', public._mask_email(v_email), 'grad_year', d.grad_year,
    'moved', v_moved, 'dropped', v_dropped));
  -- removes the duplicate's sign-in, profile and private details (everything else has moved)
  delete from auth.users where id = p_drop;
  return jsonb_build_object('moved', v_moved, 'dropped', v_dropped);
end;
$$;

-- ------------------------------------------------------------------ search: "see all" asks for more results
drop function if exists public.admin_search(text);
create or replace function public.admin_search(p_q text, p_limit int default 8)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  q text := lower(btrim(coalesce(p_q, '')));
  digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  by_contact boolean;
  v_members jsonb := '[]'::jsonb;
  v_regs jsonb;
  v_pays jsonb;
  v_limit int := least(greatest(coalesce(p_limit, 8), 1), 50);
begin
  if auth.uid() is null
     or not (v_admin or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'manager')) then
    raise exception 'Only admins and event managers can search here' using errcode = '42501';
  end if;
  if char_length(q) < 2 then
    return jsonb_build_object('members', '[]'::jsonb, 'registrations', '[]'::jsonb, 'payments', '[]'::jsonb, 'by_contact', false, 'limit', v_limit);
  end if;
  q := left(q, 100);
  by_contact := position('@' in q) > 0 or char_length(digits) >= 6;
  if char_length(digits) < 6 then digits := null; end if;

  if v_admin then
    select coalesce(jsonb_agg(m), '[]'::jsonb) into v_members from (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'grad_year', p.grad_year, 'branch', p.branch, 'city', p.city,
               'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
               'matched_on', case when position(q in lower(p.full_name)) > 0 then 'name'
                                  when position(q in lower(coalesce(p.current_company, ''))) > 0 then 'company'
                                  when position(q in lower(coalesce(p.city, ''))) > 0 then 'city'
                                  when position('@' in q) > 0 and lower(u.email) like q || '%' then 'email'
                                  else 'phone' end) as m
        from public.profiles p
        join auth.users u on u.id = p.id
        left join public.profile_private pp on pp.id = p.id
       where position(q in lower(p.full_name)) > 0
          or position(q in lower(coalesce(p.current_company, ''))) > 0
          or position(q in lower(coalesce(p.city, ''))) > 0
          or (position('@' in q) > 0 and lower(u.email) like q || '%')
          or (digits is not null and regexp_replace(coalesce(pp.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%')
       order by (position(q in lower(p.full_name)) = 1) desc, p.full_name
       limit v_limit) s;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_regs from (
    select jsonb_build_object('id', r.id, 'code', r.code, 'full_name', r.full_name, 'status', r.status, 'amount_paise', r.amount_paise,
             'headcount', r.headcount, 'event_slug', e.slug, 'event_title', e.title, 'user_id', r.user_id,
             'matched_on', case when lower(r.code) = q or position(q in lower(r.code)) > 0 then 'ticket code'
                                when position(q in lower(r.full_name)) > 0 then 'name'
                                when position('@' in q) > 0 then 'email'
                                else 'phone' end) as m
      from public.event_registrations r
      join public.events e on e.id = r.event_id
     where public.is_event_manager(r.event_id)
       and (position(q in lower(r.code)) > 0
         or position(q in lower(r.full_name)) > 0
         or (position('@' in q) > 0 and lower(coalesce(r.email, '')) like q || '%')
         or (digits is not null and regexp_replace(r.phone, '[^0-9]', '', 'g') like '%' || digits || '%'))
     order by (lower(r.code) = q) desc, r.created_at desc
     limit v_limit) s;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_pays from (
    select jsonb_build_object('id', p.id, 'utr', p.utr, 'amount_paise', p.amount_paise, 'status', p.status, 'method', p.method,
             'payer_name', p.payer_name, 'created_at', p.created_at, 'registration_id', r.id, 'code', r.code, 'full_name', r.full_name,
             'event_slug', e.slug, 'event_title', e.title) as m
      from public.event_payments p
      join public.event_registrations r on r.id = p.registration_id
      join public.events e on e.id = r.event_id
     where public.is_event_manager(r.event_id)
       and ((p.utr is not null and p.utr like '%' || regexp_replace(q, '[^0-9]', '', 'g') || '%' and char_length(regexp_replace(q, '[^0-9]', '', 'g')) >= 4)
         or position(q in lower(coalesce(p.payer_name, ''))) > 0)
     order by p.created_at desc
     limit v_limit) s;

  if by_contact then
    perform public._audit('search_contact', 'profiles', null,
      jsonb_build_object('kind', case when position('@' in q) > 0 then 'email' else 'phone' end,
                         'members', jsonb_array_length(v_members), 'registrations', jsonb_array_length(v_regs)));
  end if;
  return jsonb_build_object('members', v_members, 'registrations', v_regs, 'payments', v_pays, 'by_contact', by_contact, 'limit', v_limit);
end;
$$;

-- ------------------------------------------------------------------ privileges
revoke execute on function public.admin_list_members(jsonb, int, int, boolean) from anon, public;
revoke execute on function public.admin_bulk_set_verification(uuid[], public.verification_status, text) from anon, public;
revoke execute on function public.admin_export_members(uuid[], boolean) from anon, public;
revoke execute on function public.admin_add_member_note(uuid, text) from anon, public;
revoke execute on function public.admin_delete_member_note(uuid) from anon, public;
revoke execute on function public.admin_save_member_view(text, jsonb) from anon, public;
revoke execute on function public.admin_delete_member_view(uuid) from anon, public;
revoke execute on function public.admin_member_timeline(uuid) from anon, public;
revoke execute on function public.admin_import_preview(jsonb) from anon, public;
revoke execute on function public.admin_member_duplicates(text) from anon, public;
revoke execute on function public.admin_dismiss_duplicate(uuid, uuid) from anon, public;
revoke execute on function public.admin_merge_preview(uuid, uuid) from anon, public;
revoke execute on function public.admin_merge_members(uuid, uuid) from anon, public;
revoke execute on function public.admin_search(text, int) from anon, public;
grant execute on function public.admin_list_members(jsonb, int, int, boolean) to authenticated;
grant execute on function public.admin_bulk_set_verification(uuid[], public.verification_status, text) to authenticated;
grant execute on function public.admin_export_members(uuid[], boolean) to authenticated;
grant execute on function public.admin_add_member_note(uuid, text) to authenticated;
grant execute on function public.admin_delete_member_note(uuid) to authenticated;
grant execute on function public.admin_save_member_view(text, jsonb) to authenticated;
grant execute on function public.admin_delete_member_view(uuid) to authenticated;
grant execute on function public.admin_member_timeline(uuid) to authenticated;
grant execute on function public.admin_import_preview(jsonb) to authenticated;
grant execute on function public.admin_member_duplicates(text) to authenticated;
grant execute on function public.admin_dismiss_duplicate(uuid, uuid) to authenticated;
grant execute on function public.admin_merge_preview(uuid, uuid) to authenticated;
grant execute on function public.admin_merge_members(uuid, uuid) to authenticated;
grant execute on function public.admin_search(text, int) to authenticated;
