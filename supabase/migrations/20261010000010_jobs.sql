-- Jobs board: alumni post openings and referrals, batchmates find and apply. Verified members only.
-- Each posting has an apply link or email; postings expire on their own; members can report abuse and admins hide.

create type public.job_type as enum ('full_time', 'part_time', 'internship', 'contract');
create type public.work_mode as enum ('onsite', 'hybrid', 'remote');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  posted_by uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  company text not null check (char_length(company) between 2 and 120),
  location text check (char_length(location) <= 120),
  job_type public.job_type not null default 'full_time',
  work_mode public.work_mode not null default 'onsite',
  experience text check (char_length(experience) <= 60),
  description text not null check (char_length(description) between 20 and 4000),
  apply_url text check (apply_url is null or (char_length(apply_url) <= 500 and apply_url ~* '^https?://[^[:space:]]+$')),
  apply_email text check (apply_email is null or (char_length(apply_email) <= 200 and apply_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  can_refer boolean not null default false,        -- "I can refer you at this company"
  is_closed boolean not null default false,
  is_hidden boolean not null default false,        -- moderation
  expires_at timestamptz not null default now() + interval '45 days',
  created_at timestamptz not null default now(),
  check (apply_url is not null or apply_email is not null),
  check (expires_at > created_at and expires_at <= created_at + interval '120 days')
);
create index jobs_listing_idx on public.jobs (created_at desc) where not is_hidden and not is_closed;
create index jobs_poster_idx on public.jobs (posted_by, created_at desc);
create index jobs_search_idx on public.jobs using gin (to_tsvector('simple', title || ' ' || company || ' ' || coalesce(location, '')));

create table public.job_saves (
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

alter table public.jobs enable row level security;
alter table public.job_saves enable row level security;

-- Verified members see open, unexpired, unhidden postings; posters always see their own; admins see everything.
create policy "see open jobs" on public.jobs for select to authenticated using (
  public.is_admin()
  or posted_by = auth.uid()
  or (public.is_verified() and not is_hidden and not is_closed and expires_at > now()));
create policy "own saves" on public.job_saves for select to authenticated using (user_id = auth.uid());
create policy "save a job" on public.job_saves for insert to authenticated with check (
  user_id = auth.uid() and public.is_verified() and exists (select 1 from public.jobs j where j.id = job_id and not j.is_hidden));
create policy "unsave" on public.job_saves for delete to authenticated using (user_id = auth.uid());

grant select on public.jobs to authenticated;
grant select, insert, delete on public.job_saves to authenticated;

-- Posting goes through a function: validation, a daily limit, and the poster is always the caller.
create or replace function public.post_job(p_fields jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  n int;
  v_days int := coalesce((p_fields ->> 'days')::int, 45);
begin
  if not public.is_verified() then
    raise exception 'Only verified members can post jobs' using errcode = '42501';
  end if;
  select count(*) into n from public.jobs where posted_by = auth.uid() and created_at > now() - interval '1 day';
  if n >= 5 then
    raise exception 'You can post up to 5 jobs a day. Please try again tomorrow.';
  end if;
  if v_days not between 7 and 120 then
    raise exception 'A posting can stay up for 7 to 120 days';
  end if;
  insert into public.jobs (posted_by, title, company, location, job_type, work_mode, experience, description, apply_url, apply_email, can_refer, expires_at)
  values (auth.uid(),
          btrim(p_fields ->> 'title'), btrim(p_fields ->> 'company'), nullif(btrim(p_fields ->> 'location'), ''),
          coalesce(nullif(p_fields ->> 'job_type', ''), 'full_time')::public.job_type,
          coalesce(nullif(p_fields ->> 'work_mode', ''), 'onsite')::public.work_mode,
          nullif(btrim(p_fields ->> 'experience'), ''), btrim(p_fields ->> 'description'),
          nullif(btrim(p_fields ->> 'apply_url'), ''), nullif(btrim(p_fields ->> 'apply_email'), ''),
          coalesce((p_fields ->> 'can_refer')::boolean, false), now() + make_interval(days => v_days))
  returning * into j;
  return j;
end;
$$;

-- Poster: close a filled posting, reopen it, or extend it. Delete is a plain delete of the own row.
create or replace function public.update_my_job(p_id uuid, p_closed boolean, p_extend_days int default null)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs set
    is_closed = coalesce(p_closed, is_closed),
    expires_at = case when p_extend_days is not null then greatest(expires_at, now()) + make_interval(days => least(greatest(p_extend_days, 1), 60)) else expires_at end
   where id = p_id and posted_by = auth.uid()
   returning * into j;
  if not found then raise exception 'Posting not found' using errcode = '42501'; end if;
  if j.expires_at > j.created_at + interval '120 days' then
    update public.jobs set expires_at = j.created_at + interval '120 days' where id = j.id returning * into j;
  end if;
  return j;
end;
$$;
create policy "delete own job" on public.jobs for delete to authenticated using (posted_by = auth.uid());
grant delete on public.jobs to authenticated;

-- Search with filters, newest first, plus whether I saved it. One round trip.
create or replace function public.search_jobs(p_query text default null, p_type public.job_type default null, p_mode public.work_mode default null,
                                              p_only_saved boolean default false, p_limit int default 30, p_offset int default 0)
returns table (id uuid, title text, company text, location text, job_type public.job_type, work_mode public.work_mode, experience text,
               can_refer boolean, created_at timestamptz, expires_at timestamptz, poster_id uuid, poster_name text, poster_avatar text,
               poster_batch int, saved boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.title, j.company, j.location, j.job_type, j.work_mode, j.experience, j.can_refer, j.created_at, j.expires_at,
         p.id, p.full_name, p.avatar_url, p.grad_year,
         exists (select 1 from public.job_saves s where s.job_id = j.id and s.user_id = auth.uid())
    from public.jobs j
    join public.profiles p on p.id = j.posted_by
   where public.is_verified() and not j.is_hidden and not j.is_closed and j.expires_at > now()
     and (p_type is null or j.job_type = p_type)
     and (p_mode is null or j.work_mode = p_mode)
     and (coalesce(btrim(p_query), '') = ''
          or to_tsvector('simple', j.title || ' ' || j.company || ' ' || coalesce(j.location, '')) @@ plainto_tsquery('simple', p_query)
          or j.title ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or j.company ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (not p_only_saved or exists (select 1 from public.job_saves s where s.job_id = j.id and s.user_id = auth.uid()))
   order by j.created_at desc
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

-- Reports and moderation reach jobs too.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'comment', 'profile', 'message', 'job'));

create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_report_status text default 'actioned')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  if p_type = 'post' then update public.posts set is_hidden = p_hide where id = p_id;
  elsif p_type = 'comment' then update public.comments set is_hidden = p_hide where id = p_id;
  elsif p_type = 'job' then update public.jobs set is_hidden = p_hide where id = p_id;
  end if;
  update public.reports set status = p_report_status, handled_by = auth.uid() where target_type = p_type and target_id = p_id and status = 'open';
  perform public._audit(case when p_hide then 'hide_' else 'restore_' end || p_type, p_type || 's', p_id, jsonb_build_object('reports', p_report_status));
end;
$$;

create or replace function public.report_job(p_job uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job and not is_hidden;
  if not found or not public.is_verified() then raise exception 'Posting not found' using errcode = '42501'; end if;
  if j.posted_by = auth.uid() then raise exception 'You can’t report your own posting'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'job', p_job, left(btrim(p_reason), 500), left(j.title || ' at ' || j.company, 500))
  on conflict (reporter, target_type, target_id) do nothing;
end;
$$;

-- Three reports hide a job until a moderator looks (same rule as posts and comments).
create or replace function public._auto_hide_jobs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'job' and (select count(*) from public.reports where target_type = 'job' and target_id = new.target_id) >= 3 then
    update public.jobs set is_hidden = true where id = new.target_id;
  end if;
  return null;
end;
$$;
create trigger reports_auto_hide_jobs after insert on public.reports for each row execute function public._auto_hide_jobs();

-- The moderation queue lists jobs too.
create or replace function public.admin_reports(p_status text default 'open')
returns table (target_type text, target_id uuid, report_count bigint, last_reported timestamptz, reasons text,
               preview text, author_id uuid, author_name text, removed boolean, place text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can view reports' using errcode = '42501'; end if;
  return query
  with g as (
    select r.target_type, r.target_id, count(*) as n, max(r.created_at) as last_at,
           string_agg(distinct r.reason, ' · ') as reasons, (array_agg(r.snapshot) filter (where r.snapshot is not null))[1] as snap
      from public.reports r where r.status = p_status group by r.target_type, r.target_id)
  select g.target_type, g.target_id, g.n, g.last_at, g.reasons,
         case g.target_type
           when 'post' then (select left(po.body, 300) from public.posts po where po.id = g.target_id)
           when 'comment' then (select left(co.body, 300) from public.comments co where co.id = g.target_id)
           when 'message' then coalesce((select left(me.body, 300) from public.messages me where me.id = g.target_id and me.deleted_at is null), g.snap)
           when 'job' then coalesce((select left(jo.title || ' at ' || jo.company || E'\n' || jo.description, 300) from public.jobs jo where jo.id = g.target_id), g.snap)
           when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)
         end,
         case g.target_type
           when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
           when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
           when 'job' then (select jo.posted_by from public.jobs jo where jo.id = g.target_id)
           when 'profile' then g.target_id
         end,
         (select p2.full_name from public.profiles p2 where p2.id = case g.target_type
           when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
           when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
           when 'job' then (select jo.posted_by from public.jobs jo where jo.id = g.target_id)
           when 'profile' then g.target_id end),
         case g.target_type
           when 'post' then (select po.is_hidden from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.is_hidden from public.comments co where co.id = g.target_id)
           when 'message' then coalesce((select me.deleted_at is not null from public.messages me where me.id = g.target_id), true)
           when 'job' then coalesce((select jo.is_hidden from public.jobs jo where jo.id = g.target_id), true)
           else false
         end,
         case g.target_type
           when 'message' then (select coalesce(gr.name, 'Direct message') from public.messages me join public.chats ch on ch.id = me.chat_id left join public.groups gr on gr.id = ch.group_id where me.id = g.target_id)
           when 'post' then (select coalesce(gr.name, 'Public feed') from public.posts po left join public.groups gr on gr.id = po.group_id where po.id = g.target_id)
           when 'job' then 'Jobs'
           else null
         end
    from g order by g.last_at desc limit 100;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['post_job(jsonb)', 'update_my_job(uuid, boolean, int)', 'search_jobs(text, public.job_type, public.work_mode, boolean, int, int)', 'report_job(uuid, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._auto_hide_jobs() from anon, authenticated, public;
end $$;

