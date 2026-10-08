-- JEC Alumni Connect: members, profiles and roles.
-- Every table has row-level security. Columns that users must not change themselves
-- (is_admin, verification) are protected with column-level grants.

create extension if not exists pg_trgm with schema extensions;

create type public.member_type as enum ('student', 'alumnus', 'faculty');
create type public.verification_status as enum ('pending', 'verified', 'rejected');

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_url text check (char_length(avatar_url) <= 1000),
  headline text check (char_length(headline) <= 160),
  member_type public.member_type,
  branch text check (char_length(branch) <= 80),
  join_year int check (join_year between 1947 and 2100),
  grad_year int check (grad_year between 1947 and 2100),
  current_title text check (char_length(current_title) <= 120),
  current_company text check (char_length(current_company) <= 120),
  city text check (char_length(city) <= 80),
  country text default 'India' check (char_length(country) <= 80),
  about text check (char_length(about) <= 3000),
  linkedin_url text check (char_length(linkedin_url) <= 300),
  website_url text check (char_length(website_url) <= 300),
  skills text[] not null default '{}' check (cardinality(skills) <= 50),
  help_tags text[] not null default '{}' check (cardinality(help_tags) <= 12),
  interests text[] not null default '{}' check (cardinality(interests) <= 30),
  onboarded boolean not null default false,
  verification public.verification_status not null default 'pending',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_grad_year_idx on public.profiles (grad_year);
create index profiles_branch_idx on public.profiles (branch);
create index profiles_name_trgm_idx on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- Private contact details: visible only to the member and to admins / event staff.
create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  phone text check (phone ~ '^\+?[0-9 ]{8,16}$'),
  whatsapp_same_as_phone boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  company text not null check (char_length(company) between 1 and 160),
  location text check (char_length(location) <= 120),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  description text check (char_length(description) <= 3000),
  source text not null default 'manual' check (source in ('manual', 'linkedin')),
  created_at timestamptz not null default now()
);
create index experiences_profile_idx on public.experiences (profile_id);

create table public.educations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school text not null check (char_length(school) between 1 and 200),
  degree text check (char_length(degree) <= 160),
  field text check (char_length(field) <= 160),
  start_year int check (start_year between 1940 and 2100),
  end_year int check (end_year between 1940 and 2100),
  source text not null default 'manual' check (source in ('manual', 'linkedin')),
  created_at timestamptz not null default now()
);
create index educations_profile_idx on public.educations (profile_id);

-- ------------------------------------------------------------------ helpers
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger profile_private_touch before update on public.profile_private
  for each row execute function public.touch_updated_at();

-- Create a profile for every new auth user, prefilled from Google / LinkedIn metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(coalesce(meta ->> 'full_name', meta ->> 'name',
                  nullif(trim(concat_ws(' ', meta ->> 'given_name', meta ->> 'family_name')), ''), ''), 120),
    left(coalesce(meta ->> 'avatar_url', meta ->> 'picture'), 1000)
  );
  insert into public.profile_private (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ RLS
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.experiences enable row level security;
alter table public.educations enable row level security;

create policy "members can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "members update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admins update any profile" on public.profiles
  for update to authenticated using (public.is_admin()) with check (true);

-- Members may only change these columns; is_admin and verification are admin-only.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, headline, member_type, branch, join_year, grad_year,
              current_title, current_company, city, country, about, linkedin_url, website_url,
              skills, help_tags, interests, onboarded)
  on public.profiles to authenticated;

create policy "own private details" on public.profile_private
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "update own private details" on public.profile_private
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members can read experiences" on public.experiences
  for select to authenticated using (true);
create policy "manage own experiences" on public.experiences
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "members can read educations" on public.educations
  for select to authenticated using (true);
create policy "manage own educations" on public.educations
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Admins change is_admin / verification through this function only.
create or replace function public.admin_set_member(p_id uuid, p_is_admin boolean, p_verification public.verification_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
  update public.profiles
     set is_admin = coalesce(p_is_admin, is_admin),
         verification = coalesce(p_verification, verification)
   where id = p_id;
end;
$$;

-- ------------------------------------------------------------------ directory search
create or replace function public.search_members(
  q text default null,
  p_branch text default null,
  p_year_from int default null,
  p_year_to int default null,
  p_limit int default 30,
  p_offset int default 0
)
returns setof public.profiles
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
    from public.profiles p
   where p.onboarded
     and (p_branch is null or p.branch = p_branch)
     and (p_year_from is null or p.grad_year >= p_year_from)
     and (p_year_to is null or p.grad_year <= p_year_to)
     and (
       q is null or btrim(q) = ''
       or p.full_name operator(extensions.%) q
       or concat_ws(' ', p.full_name, p.headline, p.current_title, p.current_company, p.city,
                    p.branch, array_to_string(p.skills, ' '), array_to_string(p.help_tags, ' '))
          ilike '%' || replace(replace(btrim(q), '%', '\%'), '_', '\_') || '%'
     )
   order by
     case when q is null or btrim(q) = '' then 0
          else extensions.similarity(p.full_name, q) end desc,
     p.full_name
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;
