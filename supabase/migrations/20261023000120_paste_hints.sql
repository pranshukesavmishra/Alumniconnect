-- Paste your profile: when the education a member pasted shows the college (either of its names), the admin queue gets a
-- one-tap hint "Education shows Govt. Engg. College, Jabalpur, 1985-1990 -> batch 1990".
--   * verification_hints.source also accepts 'paste' and 'ai_suggest'
--   * submit_my_education_hint: the member's own hint (never verifies anyone; only pending members; one open hint per source)
--   * admin_verification_hints also returns the source so the queue can word the line
-- Idempotent: safe to run twice. CRLF-safe: no line-ending dependent constructs.

do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname = 'verification_hints' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ~ 'linkedin_enrich'
  loop
    execute format('alter table public.verification_hints drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.verification_hints drop constraint if exists verification_hints_source_check;
alter table public.verification_hints add constraint verification_hints_source_check check (source in ('linkedin_enrich', 'paste', 'ai_suggest'));

create or replace function public.submit_my_education_hint(p_school text, p_degree text, p_field text, p_start int, p_end int, p_source text default 'paste')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_branch text;
  v_end int := case when p_end between 1940 and 2100 then p_end end;
  v_start int := case when p_start between 1940 and 2100 then p_start end;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if p_source not in ('paste', 'ai_suggest') then raise exception 'Unknown source'; end if;
  if coalesce(btrim(p_school), '') = '' then return; end if;
  -- only members still waiting for verification; an already verified member needs no hint
  select p.branch into v_branch from public.profiles p where p.id = v_uid and p.verification = 'pending';
  if not found then return; end if;
  delete from public.verification_hints where user_id = v_uid and source = p_source and status = 'open';
  insert into public.verification_hints (user_id, source, school, degree, field, branch, start_year, end_year, status)
  values (v_uid, p_source, left(btrim(p_school), 200), left(nullif(btrim(coalesce(p_degree, '')), ''), 160), left(nullif(btrim(coalesce(p_field, '')), ''), 160),
          left(v_branch, 80), v_start, coalesce(v_end, case when v_start is not null then v_start + 4 end), 'open');
end;
$$;
revoke execute on function public.submit_my_education_hint(text, text, text, int, int, text) from anon, public;
grant execute on function public.submit_my_education_hint(text, text, text, int, int, text) to authenticated;

drop function if exists public.admin_verification_hints();
create function public.admin_verification_hints()
returns table (id uuid, user_id uuid, full_name text, avatar_url text, school text, degree text, field text, branch text,
               start_year int, end_year int, linkedin_url text, created_at timestamptz, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_perm('members_verify');
  return query
    select h.id, h.user_id, p.full_name, p.avatar_url, h.school, h.degree, h.field, h.branch, h.start_year, h.end_year,
           coalesce(h.linkedin_url, p.linkedin_url), h.created_at, h.source
      from public.verification_hints h
      join public.profiles p on p.id = h.user_id
     where h.status = 'open' and p.verification = 'pending'
     order by h.created_at
     limit 200;
end;
$$;
revoke execute on function public.admin_verification_hints() from anon, public;
grant execute on function public.admin_verification_hints() to authenticated;

-- "Suggest my profile" allowance: 3 a day per member (10 for admins), also counted in the daily total of ai_fill_take
alter table public.ai_fill_usage add column if not exists suggest_calls int not null default 0;

create or replace function public.ai_suggest_take(p_user uuid, p_global_cap int default 500)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := public._india_today();
  v_admin boolean;
  v_limit int;
  v_used int;
  v_total bigint;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end if;
  select coalesce(p.is_admin, false) or coalesce(p.is_super_admin, false) into v_admin from public.profiles p where p.id = p_user;
  v_limit := case when v_admin then 10 else 3 end;
  perform pg_advisory_xact_lock(hashtext('ai_fill_take'));
  select coalesce(sum(calls), 0) into v_total from public.ai_fill_usage where day = v_day;
  if v_total >= greatest(coalesce(p_global_cap, 500), 0) then
    return jsonb_build_object('ok', false, 'reason', 'global_limit');
  end if;
  select suggest_calls into v_used from public.ai_fill_usage where user_id = p_user and day = v_day;
  if coalesce(v_used, 0) >= v_limit then
    return jsonb_build_object('ok', false, 'reason', 'user_limit', 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.ai_fill_usage (user_id, day, calls, suggest_calls)
  values (p_user, v_day, 1, 1)
  on conflict (user_id, day) do update
    set calls = public.ai_fill_usage.calls + 1, suggest_calls = public.ai_fill_usage.suggest_calls + 1
  returning suggest_calls into v_used;
  return jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit);
end;
$$;
revoke execute on function public.ai_suggest_take(uuid, int) from anon, authenticated, public;
grant execute on function public.ai_suggest_take(uuid, int) to service_role;
