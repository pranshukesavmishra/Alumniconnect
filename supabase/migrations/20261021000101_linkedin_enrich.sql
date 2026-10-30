-- "Fill my profile from LinkedIn" through a licensed data provider (linkedin-enrich edge function), and the identity
-- signal it gives: when the professional profile lists Jabalpur Engineering College, the function records a
-- verification hint that admins approve with one tap. Members are never verified automatically unless a super admin
-- switches on auto_verify_linkedin_jec (off by default). The provider's raw answer is never stored.
-- Idempotent: safe to run twice.

-- ------------------------------------------------------------------ limits (counts only)
alter table public.ai_fill_usage add column if not exists enrich_lookups int not null default 0;

-- Called by the edge function with the service key after it verified the member: 3 look-ups per member per day and a
-- global daily cap (each match costs a provider credit).
create or replace function public.enrich_take(p_user uuid, p_global_cap int default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := public._india_today();
  v_used int;
  v_total bigint;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end if;
  perform pg_advisory_xact_lock(hashtext('enrich_take'));
  select coalesce(sum(enrich_lookups), 0) into v_total from public.ai_fill_usage where day = v_day;
  if v_total >= greatest(coalesce(p_global_cap, 50), 0) then
    return jsonb_build_object('ok', false, 'reason', 'global_limit');
  end if;
  select enrich_lookups into v_used from public.ai_fill_usage where user_id = p_user and day = v_day;
  if coalesce(v_used, 0) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'user_limit', 'used', v_used, 'limit', 3);
  end if;
  insert into public.ai_fill_usage (user_id, day, enrich_lookups) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set enrich_lookups = public.ai_fill_usage.enrich_lookups + 1
  returning enrich_lookups into v_used;
  return jsonb_build_object('ok', true, 'used', v_used, 'limit', 3);
end;
$$;
revoke execute on function public.enrich_take(uuid, int) from anon, authenticated, public;
grant execute on function public.enrich_take(uuid, int) to service_role;

-- ------------------------------------------------------------------ feature switches
create table if not exists public.app_flags (
  key text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  enabled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated, public;
grant all on public.app_flags to service_role;
drop policy if exists "admins read flags" on public.app_flags;
create policy "admins read flags" on public.app_flags for select to authenticated using (public.is_admin());
grant select on public.app_flags to authenticated;
insert into public.app_flags (key, enabled) values ('auto_verify_linkedin_jec', false) on conflict (key) do nothing;

create or replace function public.admin_set_flag(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change this' using errcode = '42501';
  end if;
  update public.app_flags set enabled = coalesce(p_enabled, false), updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting'; end if;
  insert into public.admin_audit (actor, action, target_table, details)
  values (auth.uid(), 'set_flag', 'app_flags', jsonb_build_object('key', p_key, 'enabled', coalesce(p_enabled, false)));
end;
$$;
revoke execute on function public.admin_set_flag(text, boolean) from anon, public;
grant execute on function public.admin_set_flag(text, boolean) to authenticated;

-- ------------------------------------------------------------------ verification hints
create table if not exists public.verification_hints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('linkedin_enrich')),
  school text not null check (char_length(school) <= 200),
  degree text check (char_length(degree) <= 160),
  field text check (char_length(field) <= 160),
  branch text check (char_length(branch) <= 80),
  start_year int check (start_year between 1940 and 2100),
  end_year int check (end_year between 1940 and 2100),
  linkedin_url text check (linkedin_url is null or linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]+$'),
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed', 'auto_approved')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists verification_hints_open_key on public.verification_hints (user_id, source) where status = 'open';
alter table public.verification_hints enable row level security;
revoke all on public.verification_hints from anon, authenticated, public;
grant all on public.verification_hints to service_role;

-- Called by the edge function (service key) when the provider's education lists JEC. Fills batch / branch only when
-- empty; verifies only when auto_verify_linkedin_jec is on.
create or replace function public.record_verification_hint(
  p_user uuid, p_school text, p_degree text, p_field text, p_branch text, p_start int, p_end int, p_linkedin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto boolean := coalesce((select enabled from public.app_flags where key = 'auto_verify_linkedin_jec'), false);
  v_status text;
  v_url text := case when p_linkedin ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]+$' then p_linkedin end;
begin
  if p_user is null or coalesce(btrim(p_school), '') = '' then
    return null;
  end if;
  select p.verification::text into v_status from public.profiles p where p.id = p_user;
  if v_status is null then return null; end if;
  delete from public.verification_hints where user_id = p_user and source = 'linkedin_enrich' and status = 'open';
  insert into public.verification_hints (user_id, source, school, degree, field, branch, start_year, end_year, linkedin_url, status)
  values (p_user, 'linkedin_enrich', left(p_school, 200), left(p_degree, 160), left(p_field, 160), left(p_branch, 80),
          case when p_start between 1940 and 2100 then p_start end, case when p_end between 1940 and 2100 then p_end end, v_url,
          case when v_auto and v_status = 'pending' then 'auto_approved' else 'open' end);
  update public.profiles p set
    grad_year = coalesce(p.grad_year, case when p_end between 1947 and 2100 then p_end end),
    branch = coalesce(nullif(btrim(p.branch), ''), nullif(btrim(p_branch), '')),
    verification = case when v_auto and p.verification = 'pending' then 'verified'::public.verification_status else p.verification end
  where p.id = p_user;
  if v_auto and v_status = 'pending' then
    insert into public.admin_audit (actor, action, target_table, target_id, details)
    values (null, 'auto_verify_linkedin_jec', 'profiles', p_user, jsonb_build_object('school', left(p_school, 200), 'end_year', p_end));
    return 'auto_approved';
  end if;
  return 'open';
end;
$$;
revoke execute on function public.record_verification_hint(uuid, text, text, text, text, int, int, text) from anon, authenticated, public;
grant execute on function public.record_verification_hint(uuid, text, text, text, text, int, int, text) to service_role;

-- The queue for admins: open hints of members who are still pending.
create or replace function public.admin_verification_hints()
returns table (id uuid, user_id uuid, full_name text, avatar_url text, school text, degree text, field text, branch text,
               start_year int, end_year int, linkedin_url text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_perm('members_verify');
  return query
    select h.id, h.user_id, p.full_name, p.avatar_url, h.school, h.degree, h.field, h.branch, h.start_year, h.end_year, h.linkedin_url, h.created_at
      from public.verification_hints h
      join public.profiles p on p.id = h.user_id
     where h.status = 'open' and p.verification = 'pending'
     order by h.created_at
     limit 200;
end;
$$;
revoke execute on function public.admin_verification_hints() from anon, public;
grant execute on function public.admin_verification_hints() to authenticated;

create or replace function public.admin_review_hint(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.verification_hints;
begin
  perform public._require_perm('members_verify');
  update public.verification_hints x set status = case when p_approve then 'approved' else 'dismissed' end, reviewed_by = auth.uid(), reviewed_at = now()
   where x.id = p_id and x.status = 'open'
  returning * into h;
  if not found then raise exception 'This hint was already handled'; end if;
  if p_approve then
    update public.profiles set verification = 'verified' where id = h.user_id and verification = 'pending';
  end if;
  insert into public.admin_audit (actor, action, target_table, target_id, details)
  values (auth.uid(), case when p_approve then 'approve_linkedin_hint' else 'dismiss_linkedin_hint' end, 'profiles', h.user_id,
          jsonb_build_object('school', h.school, 'start_year', h.start_year, 'end_year', h.end_year));
end;
$$;
revoke execute on function public.admin_review_hint(uuid, boolean) from anon, public;
grant execute on function public.admin_review_hint(uuid, boolean) to authenticated;

-- "Fill from LinkedIn" is offered to members only once a super admin switches it on (after setting the provider
-- secrets), so the app never calls a function that is not deployed.
insert into public.app_flags (key, enabled) values ('linkedin_fill', false) on conflict (key) do nothing;

create or replace function public.quick_profile_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('linkedin_fill', coalesce((select enabled from public.app_flags where key = 'linkedin_fill'), false));
$$;
revoke execute on function public.quick_profile_flags() from anon, public;
grant execute on function public.quick_profile_flags() to authenticated;
