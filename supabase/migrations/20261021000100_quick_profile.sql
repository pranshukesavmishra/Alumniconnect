-- Quick profile: profiles that fill themselves in one or two steps.
--   * Magic fill: the profile-ai-fill edge function turns "what do you do?" text into fields. Per-member and global daily
--     limits live here (ai_fill_usage + ai_fill_take). The raw text is never stored: only call and character counts.
--   * save_my_quick_profile: the reviewed preview, written in one transaction (experiences/education source = 'ai').
--   * Reunion list prefill: organisers upload their Google Form responses into prefill_records WITHOUT creating
--     accounts. A member who signs in with the same e-mail (or enters the same mobile number and has the same name
--     initial) is offered "is this you?"; claiming fills only EMPTY profile fields, once. Nobody else's data is shown
--     on a mismatch.
--   * Registration -> profile: answers given in the reunion registration fill empty profile fields (never overwrite).
-- Idempotent: safe to run twice. Every function is SECURITY DEFINER with an empty search_path and checks the caller.

-- ------------------------------------------------------------------ sources of experience / education rows
do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and rel.relname in ('experiences', 'educations') and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ~ '\msource\M'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;
alter table public.experiences add constraint experiences_source_check check (source in ('manual', 'linkedin', 'ai', 'prefill'));
alter table public.educations add constraint educations_source_check check (source in ('manual', 'linkedin', 'ai', 'prefill'));

-- ------------------------------------------------------------------ AI usage (counts only, never the text)
create table if not exists public.ai_fill_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  calls int not null default 0,
  input_chars bigint not null default 0,
  prefill_lookups int not null default 0,
  primary key (user_id, day)
);
create index if not exists ai_fill_usage_day_idx on public.ai_fill_usage (day);
alter table public.ai_fill_usage enable row level security;
revoke all on public.ai_fill_usage from anon, authenticated, public;
grant all on public.ai_fill_usage to service_role;
-- members may see their own counters (nothing else is in the row)
drop policy if exists "own ai usage" on public.ai_fill_usage;
create policy "own ai usage" on public.ai_fill_usage for select to authenticated using (user_id = auth.uid());
grant select on public.ai_fill_usage to authenticated;

create or replace function public._india_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
revoke execute on function public._india_today() from anon, authenticated, public;

-- Called by the edge function with the service key, after it has verified the member's token. Takes one call from the
-- member's daily allowance (10, admins 60) and from the global daily cap. Returns {ok, used, limit} or {ok:false, reason}.
create or replace function public.ai_fill_take(p_user uuid, p_global_cap int default 500, p_chars int default 0)
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
  v_limit := case when v_admin then 60 else 10 end;
  -- one at a time, so two parallel calls cannot both take the last slot
  perform pg_advisory_xact_lock(hashtext('ai_fill_take'));
  select coalesce(sum(calls), 0) into v_total from public.ai_fill_usage where day = v_day;
  if v_total >= greatest(coalesce(p_global_cap, 500), 0) then
    return jsonb_build_object('ok', false, 'reason', 'global_limit');
  end if;
  select calls into v_used from public.ai_fill_usage where user_id = p_user and day = v_day;
  if coalesce(v_used, 0) >= v_limit then
    return jsonb_build_object('ok', false, 'reason', 'user_limit', 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.ai_fill_usage (user_id, day, calls, input_chars)
  values (p_user, v_day, 1, greatest(coalesce(p_chars, 0), 0))
  on conflict (user_id, day) do update
    set calls = public.ai_fill_usage.calls + 1, input_chars = public.ai_fill_usage.input_chars + greatest(coalesce(p_chars, 0), 0)
  returning calls into v_used;
  return jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit);
end;
$$;
revoke execute on function public.ai_fill_take(uuid, int, int) from anon, authenticated, public;
grant execute on function public.ai_fill_take(uuid, int, int) to service_role;

-- ------------------------------------------------------------------ save a reviewed magic-fill preview
-- p_profile holds only the fields the member ticked (the app decides; empty fields are filled, others only when the
-- member chose to replace them). Experiences / education are added with source 'ai'; exact repeats are skipped.
create or replace function public.save_my_quick_profile(p_profile jsonb, p_experiences jsonb default '[]'::jsonb, p_educations jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e jsonb;
  v_start int;
  v_end int;
begin
  if me is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object'
     or jsonb_typeof(coalesce(p_experiences, '[]')) <> 'array' or jsonb_typeof(coalesce(p_educations, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_experiences, '[]')) > 20 or jsonb_array_length(coalesce(p_educations, '[]')) > 10 then
    raise exception 'These details are not valid';
  end if;

  update public.profiles p set
    full_name = case when p_profile ? 'full_name' and char_length(btrim(p_profile ->> 'full_name')) >= 2
                     then left(regexp_replace(btrim(p_profile ->> 'full_name'), '\s+', ' ', 'g'), 120) else p.full_name end,
    headline = case when p_profile ? 'headline' then left(nullif(btrim(p_profile ->> 'headline'), ''), 160) else p.headline end,
    current_title = case when p_profile ? 'current_title' then left(nullif(btrim(p_profile ->> 'current_title'), ''), 120) else p.current_title end,
    current_company = case when p_profile ? 'current_company' then left(nullif(btrim(p_profile ->> 'current_company'), ''), 120) else p.current_company end,
    city = case when p_profile ? 'city' then left(nullif(btrim(p_profile ->> 'city'), ''), 80) else p.city end,
    country = case when p_profile ? 'country' then left(nullif(btrim(p_profile ->> 'country'), ''), 80) else p.country end,
    branch = case when p_profile ? 'branch' then left(nullif(btrim(p_profile ->> 'branch'), ''), 80) else p.branch end,
    grad_year = case when p_profile ? 'grad_year' and (p_profile ->> 'grad_year') ~ '^(19|20)[0-9]{2}$' then (p_profile ->> 'grad_year')::int else p.grad_year end,
    about = case when p_profile ? 'about' then left(nullif(btrim(p_profile ->> 'about'), ''), 3000) else p.about end,
    linkedin_url = case when p_profile ? 'linkedin_url' and (p_profile ->> 'linkedin_url') ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]+$'
                             and char_length(p_profile ->> 'linkedin_url') <= 300
                        then p_profile ->> 'linkedin_url' else p.linkedin_url end,
    skills = case when jsonb_typeof(p_profile -> 'skills') = 'array'
                  then (select coalesce(array_agg(distinct left(btrim(x), 80)), '{}') from (select jsonb_array_elements_text(p_profile -> 'skills') x limit 50) s where btrim(x) <> '')
                  else p.skills end,
    help_tags = case when jsonb_typeof(p_profile -> 'help_tags') = 'array'
                     then (select coalesce(array_agg(distinct left(btrim(x), 60)), '{}') from (select jsonb_array_elements_text(p_profile -> 'help_tags') x limit 12) s where btrim(x) <> '')
                     else p.help_tags end,
    interests = case when jsonb_typeof(p_profile -> 'interests') = 'array'
                     then (select coalesce(array_agg(distinct left(btrim(x), 60)), '{}') from (select jsonb_array_elements_text(p_profile -> 'interests') x limit 30) s where btrim(x) <> '')
                     else p.interests end,
    updated_at = now()
  where p.id = me;

  for e in select * from jsonb_array_elements(coalesce(p_experiences, '[]')) loop
    continue when coalesce(btrim(e ->> 'title'), '') = '' or coalesce(btrim(e ->> 'company'), '') = '';
    continue when exists (select 1 from public.experiences x where x.profile_id = me
                            and lower(x.title) = lower(btrim(e ->> 'title')) and lower(x.company) = lower(btrim(e ->> 'company')));
    v_start := case when (e ->> 'start_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'start_year')::int end;
    v_end := case when (e ->> 'end_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'end_year')::int end;
    insert into public.experiences (profile_id, title, company, location, start_date, end_date, is_current, source)
    values (me, left(btrim(e ->> 'title'), 160), left(btrim(e ->> 'company'), 160), left(nullif(btrim(e ->> 'location'), ''), 120),
            case when v_start is not null then make_date(v_start, 1, 1) end,
            case when v_end is not null and not coalesce((e ->> 'is_current')::boolean, false) then make_date(v_end, 1, 1) end,
            coalesce((e ->> 'is_current')::boolean, false), 'ai');
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_educations, '[]')) loop
    continue when coalesce(btrim(e ->> 'school'), '') = '';
    continue when exists (select 1 from public.educations x where x.profile_id = me and lower(x.school) = lower(btrim(e ->> 'school'))
                            and coalesce(lower(x.degree), '') = coalesce(lower(nullif(btrim(e ->> 'degree'), '')), ''));
    insert into public.educations (profile_id, school, degree, field, start_year, end_year, source)
    values (me, left(btrim(e ->> 'school'), 200), left(nullif(btrim(e ->> 'degree'), ''), 160), left(nullif(btrim(e ->> 'field'), ''), 160),
            case when (e ->> 'start_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'start_year')::int end,
            case when (e ->> 'end_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'end_year')::int end, 'ai');
  end loop;
end;
$$;
revoke execute on function public.save_my_quick_profile(jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.save_my_quick_profile(jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------------ reunion list (prefill) records
create table if not exists public.prefill_records (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text check (email is null or (char_length(email) <= 254 and email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  member_type public.member_type,
  grad_year int check (grad_year between 1947 and 2100),
  join_year int check (join_year between 1947 and 2100),
  branch text check (char_length(branch) <= 80),
  city text check (char_length(city) <= 80),
  country text check (char_length(country) <= 80),
  organisation text check (char_length(organisation) <= 120),
  designation text check (char_length(designation) <= 120),
  source text not null default 'Reunion list' check (char_length(source) <= 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  check (email is not null or phone is not null)
);
create unique index if not exists prefill_records_email_key on public.prefill_records (email) where email is not null;
create index if not exists prefill_records_phone_idx on public.prefill_records (phone) where phone is not null;
create unique index if not exists prefill_records_claimed_by_key on public.prefill_records (claimed_by) where claimed_by is not null;
alter table public.prefill_records enable row level security;
-- no policies: members never read this table directly; admins and members go through the functions below
revoke all on public.prefill_records from anon, authenticated, public;
grant all on public.prefill_records to service_role;

create table if not exists public.prefill_dismissals (
  record_id uuid not null references public.prefill_records (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (record_id, user_id)
);
alter table public.prefill_dismissals enable row level security;
revoke all on public.prefill_dismissals from anon, authenticated, public;
grant all on public.prefill_dismissals to service_role;

create or replace function public._name_initial(p text)
returns text language sql immutable set search_path = '' as $$
  -- "Dr. Asha Rao" and "asha rao" both give "a" (titles first, then anything that is not a letter is ignored)
  select left(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^(dr|er|mr|mrs|ms|prof|shri|smt)\.?\s+', ''), '[^[:alpha:]]', '', 'g'), 1);
$$;
revoke execute on function public._name_initial(text) from anon, authenticated, public;

-- The one record this member may see: same sign-in e-mail, or (when given) the same E.164 mobile number AND the same
-- first letter of the name. Unclaimed, not dismissed by them, and only while they have not claimed one already.
create or replace function public._prefill_candidate(p_user uuid, p_phone text, p_name text)
returns table (id uuid, match_kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_user is null or exists (select 1 from public.prefill_records r where r.claimed_by = p_user) then
    return;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is not null then
    return query
      select r.id, 'email'::text from public.prefill_records r
       where r.email = v_email and r.claimed_by is null
         and not exists (select 1 from public.prefill_dismissals d where d.record_id = r.id and d.user_id = p_user)
       limit 1;
    if found then return; end if;
  end if;
  if p_phone ~ '^\+[1-9][0-9]{6,14}$' and public._name_initial(p_name) <> '' then
    return query
      select r.id, 'phone'::text from public.prefill_records r
       where r.phone = p_phone and r.claimed_by is null
         and public._name_initial(r.full_name) = public._name_initial(p_name)
         and not exists (select 1 from public.prefill_dismissals d where d.record_id = r.id and d.user_id = p_user)
       order by r.created_at
       limit 1;
  end if;
end;
$$;
revoke execute on function public._prefill_candidate(uuid, text, text) from anon, authenticated, public;

-- "We found your details from the reunion list": what the member sees (never the record's e-mail or phone).
-- Phone look-ups are limited to 10 a day per member, so nobody can walk through numbers.
create or replace function public.my_prefill_match(p_phone text default null, p_name text default null)
returns table (id uuid, match_kind text, full_name text, grad_year int, join_year int, branch text, city text, country text,
               organisation text, designation text, source text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_day date := public._india_today();
  v_lookups int;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if me is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if v_phone is not null then
    insert into public.ai_fill_usage (user_id, day, prefill_lookups) values (me, v_day, 1)
    on conflict (user_id, day) do update set prefill_lookups = public.ai_fill_usage.prefill_lookups + 1
    returning prefill_lookups into v_lookups;
    if v_lookups > 10 then v_phone := null; end if;
  end if;
  return query
    select r.id, c.match_kind, r.full_name, r.grad_year, r.join_year, r.branch, r.city, r.country, r.organisation, r.designation, r.source
      from public._prefill_candidate(me, v_phone, p_name) c
      join public.prefill_records r on r.id = c.id;
end;
$$;
revoke execute on function public.my_prefill_match(text, text) from anon, public;
grant execute on function public.my_prefill_match(text, text) to authenticated;

-- "Yes, fill my profile": checks the match again, marks the record as claimed (once), and fills EMPTY profile fields.
-- Returns the names of the fields it filled.
create or replace function public.claim_prefill(p_id uuid, p_phone text default null, p_name text default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.prefill_records;
  p public.profiles;
  v_kind text;
  v_filled text[] := '{}';
  v_phone text;
begin
  if me is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select c.match_kind into v_kind from public._prefill_candidate(me, nullif(btrim(coalesce(p_phone, '')), ''), p_name) c where c.id = p_id;
  if v_kind is null then
    raise exception 'These details could not be matched to you' using errcode = '42501';
  end if;
  update public.prefill_records x set claimed_by = me, claimed_at = now(), updated_at = now()
   where x.id = p_id and x.claimed_by is null
  returning * into r;
  if not found then
    raise exception 'These details have already been used' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = me;

  if char_length(btrim(coalesce(p.full_name, ''))) < 2 then v_filled := v_filled || 'full_name'; end if;
  if p.member_type is null and r.member_type is not null then v_filled := v_filled || 'member_type'; end if;
  if nullif(btrim(coalesce(p.branch, '')), '') is null and r.branch is not null then v_filled := v_filled || 'branch'; end if;
  if p.grad_year is null and r.grad_year is not null then v_filled := v_filled || 'grad_year'; end if;
  if p.join_year is null and r.join_year is not null then v_filled := v_filled || 'join_year'; end if;
  if nullif(btrim(coalesce(p.city, '')), '') is null and r.city is not null then v_filled := v_filled || 'city'; end if;
  if nullif(btrim(coalesce(p.current_title, '')), '') is null and r.designation is not null then v_filled := v_filled || 'current_title'; end if;
  if nullif(btrim(coalesce(p.current_company, '')), '') is null and r.organisation is not null then v_filled := v_filled || 'current_company'; end if;

  update public.profiles x set
    full_name = case when 'full_name' = any (v_filled) then r.full_name else x.full_name end,
    member_type = case when 'member_type' = any (v_filled) then r.member_type else x.member_type end,
    branch = case when 'branch' = any (v_filled) then r.branch else x.branch end,
    grad_year = case when 'grad_year' = any (v_filled) then r.grad_year else x.grad_year end,
    join_year = case when 'join_year' = any (v_filled) then r.join_year else x.join_year end,
    city = case when 'city' = any (v_filled) then r.city else x.city end,
    country = case when 'city' = any (v_filled) and r.country is not null then r.country else x.country end,
    current_title = case when 'current_title' = any (v_filled) then r.designation else x.current_title end,
    current_company = case when 'current_company' = any (v_filled) then r.organisation else x.current_company end,
    updated_at = now()
  where x.id = me;

  -- the mobile number: the one the member typed (it matched), else the list's number when the e-mail matched
  v_phone := case when v_kind = 'phone' then btrim(p_phone) else r.phone end;
  if v_phone is not null then
    insert into public.profile_private (id) values (me) on conflict (id) do nothing;
    update public.profile_private pp set phone = v_phone where pp.id = me and nullif(btrim(coalesce(pp.phone, '')), '') is null;
    if found then v_filled := v_filled || 'phone'; end if;
  end if;
  return v_filled;
end;
$$;
revoke execute on function public.claim_prefill(uuid, text, text) from anon, public;
grant execute on function public.claim_prefill(uuid, text, text) to authenticated;

create or replace function public.dismiss_prefill(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  -- hides that record from this member only; the answer is the same whether or not the id exists (no probing)
  if exists (select 1 from public.prefill_records r where r.id = p_id and r.claimed_by is null) then
    insert into public.prefill_dismissals (record_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.dismiss_prefill(uuid) from anon, public;
grant execute on function public.dismiss_prefill(uuid) to authenticated;

-- ------------------------------------------------------------------ admin: upload and status
-- p_rows: [{full_name, email, phone (E.164), member_type, grad_year, join_year, branch, city, country, organisation,
-- designation}]. Rows are matched by e-mail, else by phone; claimed rows are never changed. Nothing in auth is created.
create or replace function public.admin_prefill_import(p_rows jsonb, p_source text default 'Reunion list')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_line int := 0;
  v_added int := 0;
  v_updated int := 0;
  v_claimed int := 0;
  v_problems jsonb := '[]'::jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_type public.member_type;
  v_id uuid;
  v_claimed_by uuid;
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'Reunion list'), 80);
  yr int;
  jy int;
begin
  perform public._require_perm('members_import');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'At most 5000 rows at a time';
  end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    v_name := left(regexp_replace(btrim(coalesce(e ->> 'full_name', '')), '\s+', ' ', 'g'), 120);
    v_email := lower(nullif(btrim(coalesce(e ->> 'email', '')), ''));
    v_phone := nullif(btrim(coalesce(e ->> 'phone', '')), '');
    if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_email := null; end if;
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then v_phone := null; end if;
    if char_length(v_name) < 2 or (v_email is null and v_phone is null) then
      v_problems := v_problems || jsonb_build_object('line', v_line, 'problem', 'needs a name and an e-mail or mobile number');
      continue;
    end if;
    v_type := case lower(coalesce(e ->> 'member_type', '')) when 'alumnus' then 'alumnus'::public.member_type
                when 'student' then 'student'::public.member_type when 'faculty' then 'faculty'::public.member_type else null end;
    yr := case when (e ->> 'grad_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'grad_year')::int end;
    jy := case when (e ->> 'join_year') ~ '^(19|20)[0-9]{2}$' then (e ->> 'join_year')::int end;
    v_id := null;
    if v_email is not null then select r.id, r.claimed_by into v_id, v_claimed_by from public.prefill_records r where r.email = v_email; end if;
    if v_id is null and v_phone is not null then
      select r.id, r.claimed_by into v_id, v_claimed_by from public.prefill_records r
       where r.phone = v_phone and (r.email is null or v_email is null) and public._norm_name(r.full_name) = public._norm_name(v_name) limit 1;
    end if;
    if v_id is not null and v_claimed_by is not null then
      v_claimed := v_claimed + 1;
      continue;
    end if;
    if v_id is null then
      insert into public.prefill_records (full_name, email, phone, member_type, grad_year, join_year, branch, city, country, organisation, designation, source, created_by)
      values (v_name, v_email, v_phone, coalesce(v_type, 'alumnus'), yr, jy, left(nullif(btrim(e ->> 'branch'), ''), 80), left(nullif(btrim(e ->> 'city'), ''), 80),
              left(nullif(btrim(e ->> 'country'), ''), 80), left(nullif(btrim(e ->> 'organisation'), ''), 120), left(nullif(btrim(e ->> 'designation'), ''), 120),
              v_source, auth.uid());
      v_added := v_added + 1;
    else
      update public.prefill_records r set
        full_name = v_name, email = coalesce(v_email, r.email), phone = coalesce(v_phone, r.phone), member_type = coalesce(v_type, r.member_type),
        grad_year = coalesce(yr, r.grad_year), join_year = coalesce(jy, r.join_year),
        branch = coalesce(left(nullif(btrim(e ->> 'branch'), ''), 80), r.branch), city = coalesce(left(nullif(btrim(e ->> 'city'), ''), 80), r.city),
        country = coalesce(left(nullif(btrim(e ->> 'country'), ''), 80), r.country),
        organisation = coalesce(left(nullif(btrim(e ->> 'organisation'), ''), 120), r.organisation),
        designation = coalesce(left(nullif(btrim(e ->> 'designation'), ''), 120), r.designation),
        source = v_source, updated_at = now()
      where r.id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  insert into public.admin_audit (actor, action, target_table, details)
  values (auth.uid(), 'prefill_import', 'prefill_records',
          jsonb_build_object('rows', v_line, 'added', v_added, 'updated', v_updated, 'claimed_skipped', v_claimed, 'problems', jsonb_array_length(v_problems), 'source', v_source));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'claimed_skipped', v_claimed, 'problems', v_problems);
end;
$$;
revoke execute on function public.admin_prefill_import(jsonb, text) from anon, public;
grant execute on function public.admin_prefill_import(jsonb, text) to authenticated;

-- The list for organisers: who has claimed their details. Contact details are masked.
create or replace function public.admin_prefill_list(p_q text default null, p_status text default 'all', p_limit int default 50, p_offset int default 0)
returns table (id uuid, full_name text, email_masked text, phone_tail text, grad_year int, branch text, city text, organisation text,
               designation text, source text, created_at timestamptz, claimed boolean, claimed_at timestamptz, claimed_by uuid,
               claimed_by_name text, total bigint, claimed_total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_perm('members_view');
  return query
    with base as (
      select r.* from public.prefill_records r
       where (coalesce(btrim(p_q), '') = '' or r.full_name ilike '%' || btrim(p_q) || '%' or r.email ilike '%' || btrim(p_q) || '%'
              or r.organisation ilike '%' || btrim(p_q) || '%' or r.grad_year::text = btrim(p_q))
         and (coalesce(p_status, 'all') = 'all' or (p_status = 'claimed') = (r.claimed_by is not null))
    )
    select b.id, b.full_name, public._mask_email(b.email), case when b.phone is not null then '••' || right(b.phone, 4) end,
           b.grad_year, b.branch, b.city, b.organisation, b.designation, b.source, b.created_at, b.claimed_by is not null, b.claimed_at,
           b.claimed_by, pr.full_name, count(*) over (), (select count(*) from public.prefill_records x where x.claimed_by is not null)
      from base b
      left join public.profiles pr on pr.id = b.claimed_by
     order by b.claimed_by is not null, b.full_name
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke execute on function public.admin_prefill_list(text, text, int, int) from anon, public;
grant execute on function public.admin_prefill_list(text, text, int, int) to authenticated;

create or replace function public.admin_prefill_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_perm('members_import');
  delete from public.prefill_records where id = p_id and claimed_by is null;
  if found then
    insert into public.admin_audit (actor, action, target_table, target_id) values (auth.uid(), 'prefill_delete', 'prefill_records', p_id);
  end if;
end;
$$;
revoke execute on function public.admin_prefill_delete(uuid) from anon, public;
grant execute on function public.admin_prefill_delete(uuid) to authenticated;

-- ------------------------------------------------------------------ registration answers fill empty profile fields
create or replace function public._registration_fill_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or new.status = 'cancelled' then
    return new;
  end if;
  update public.profiles p set
    city = coalesce(nullif(btrim(p.city), ''), nullif(btrim(new.city), '')),
    country = case when nullif(btrim(p.city), '') is null and nullif(btrim(new.country), '') is not null then btrim(new.country) else p.country end,
    current_title = coalesce(nullif(btrim(p.current_title), ''), left(nullif(btrim(new.designation), ''), 120)),
    current_company = coalesce(nullif(btrim(p.current_company), ''), left(nullif(btrim(new.company), ''), 120))
  where p.id = new.user_id
    and ((nullif(btrim(p.city), '') is null and nullif(btrim(new.city), '') is not null)
      or (nullif(btrim(p.current_title), '') is null and nullif(btrim(new.designation), '') is not null)
      or (nullif(btrim(p.current_company), '') is null and nullif(btrim(new.company), '') is not null));
  if nullif(btrim(new.phone), '') is not null and new.phone ~ '^\+?[0-9 ]{8,16}$' then
    update public.profile_private pp set phone = btrim(new.phone)
     where pp.id = new.user_id and nullif(btrim(coalesce(pp.phone, '')), '') is null;
  end if;
  return new;
end;
$$;
revoke execute on function public._registration_fill_profile() from anon, authenticated, public;
drop trigger if exists registration_fill_profile on public.event_registrations;
create trigger registration_fill_profile
  after insert or update of city, phone, designation, company on public.event_registrations
  for each row execute function public._registration_fill_profile();
