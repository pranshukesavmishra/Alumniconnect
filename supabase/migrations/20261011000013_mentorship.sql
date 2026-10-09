-- Mentorship: senior alumni offer to mentor, younger members request a mentor.
-- All writes go through functions; slots can never be oversubscribed (the mentor's profile row is locked while accepting).

create table public.mentor_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  topics text[] not null check (
    cardinality(topics) between 1 and 5
    and topics <@ array['Career growth', 'Interview prep', 'Higher studies', 'Startups', 'Leadership', 'Switching careers', 'Government exams', 'Work abroad']::text[]),
  bio text not null check (char_length(bio) between 20 and 600),
  availability text check (char_length(availability) <= 80),
  is_accepting boolean not null default true,
  max_mentees int not null default 3 check (max_mentees between 1 and 10),
  created_at timestamptz not null default now()
);

create type public.mentorship_status as enum ('requested', 'accepted', 'declined', 'ended');

create table public.mentorships (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.profiles (id) on delete cascade,
  mentee_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null check (char_length(topic) between 2 and 40),
  message text not null check (char_length(message) between 20 and 600),
  status public.mentorship_status not null default 'requested',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  ended_at timestamptz,
  check (mentor_id <> mentee_id)
);
create unique index mentorships_open_pair_idx on public.mentorships (mentor_id, mentee_id) where status in ('requested', 'accepted');
create index mentorships_mentor_idx on public.mentorships (mentor_id, status);
create index mentorships_mentee_idx on public.mentorships (mentee_id, status);

alter table public.mentor_profiles enable row level security;
alter table public.mentorships enable row level security;
-- Reads only: the directory comes from list_mentors (it hides blocked pairs); a request is visible to its two people.
create policy "see own mentor profile" on public.mentor_profiles for select to authenticated using (user_id = auth.uid());
create policy "see own mentorships" on public.mentorships for select to authenticated using (auth.uid() in (mentor_id, mentee_id));
grant select on public.mentor_profiles, public.mentorships to authenticated;

create or replace function public.become_mentor(p_fields jsonb)
returns public.mentor_profiles
language plpgsql security definer set search_path = ''
as $$
declare
  r public.mentor_profiles;
  v_topics text[];
  v_bio text := btrim(coalesce(p_fields ->> 'bio', ''));
  v_avail text := nullif(btrim(coalesce(p_fields ->> 'availability', '')), '');
  v_max int;
  v_accepting boolean;
begin
  if not public.is_verified() then raise exception 'Only verified members can offer to mentor' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct t), '{}') into v_topics from jsonb_array_elements_text(coalesce(p_fields -> 'topics', '[]'::jsonb)) t;
  if cardinality(v_topics) < 1 or cardinality(v_topics) > 5 then raise exception 'Choose 1 to 5 topics'; end if;
  if not v_topics <@ array['Career growth', 'Interview prep', 'Higher studies', 'Startups', 'Leadership', 'Switching careers', 'Government exams', 'Work abroad']::text[] then
    raise exception 'Unknown topic';
  end if;
  if char_length(v_bio) < 20 or char_length(v_bio) > 600 then raise exception 'Tell mentees about yourself in 20 to 600 characters'; end if;
  if char_length(coalesce(v_avail, '')) > 80 then raise exception 'Availability must be 80 characters or fewer'; end if;
  v_max := coalesce((p_fields ->> 'max_mentees')::int, (select max_mentees from public.mentor_profiles where user_id = auth.uid()), 3);
  if v_max < 1 or v_max > 10 then raise exception 'You can mentor 1 to 10 people at a time'; end if;
  v_accepting := coalesce((p_fields ->> 'is_accepting')::boolean, true);
  insert into public.mentor_profiles (user_id, topics, bio, availability, is_accepting, max_mentees)
  values (auth.uid(), v_topics, v_bio, v_avail, v_accepting, v_max)
  on conflict (user_id) do update
    set topics = excluded.topics, bio = excluded.bio, availability = excluded.availability,
        is_accepting = excluded.is_accepting, max_mentees = excluded.max_mentees
  returning * into r;
  return r;
end;
$$;

create or replace function public.pause_mentoring(p_accepting boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_verified() then raise exception 'Only verified members can do this' using errcode = '42501'; end if;
  update public.mentor_profiles set is_accepting = coalesce(p_accepting, false) where user_id = auth.uid();
  if not found then raise exception 'Set up your mentor profile first'; end if;
end;
$$;

create or replace function public.list_mentors(p_topic text default null, p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (user_id uuid, full_name text, avatar_url text, grad_year int, branch text, headline text, current_title text, current_company text,
               topics text[], bio text, availability text, is_accepting boolean, max_mentees int, open_slots int, my_status text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, p.full_name, p.avatar_url, p.grad_year, p.branch, p.headline, p.current_title, p.current_company,
         m.topics, m.bio, m.availability, m.is_accepting, m.max_mentees,
         greatest(m.max_mentees - (select count(*) from public.mentorships s where s.mentor_id = m.user_id and s.status = 'accepted'), 0)::int,
         (select s.status::text from public.mentorships s where s.mentor_id = m.user_id and s.mentee_id = auth.uid()
           order by (s.status in ('requested', 'accepted')) desc, s.created_at desc limit 1)
    from public.mentor_profiles m
    join public.profiles p on p.id = m.user_id
   where public.is_verified() and p.verification = 'verified'
     and not public.is_blocked_between(m.user_id, auth.uid())
     and (p_topic is null or p_topic = any (m.topics))
     and (nullif(btrim(p_query), '') is null
          or p.full_name ilike '%' || btrim(p_query) || '%' or m.bio ilike '%' || btrim(p_query) || '%'
          or p.current_company ilike '%' || btrim(p_query) || '%' or p.branch ilike '%' || btrim(p_query) || '%')
   order by (m.is_accepting and m.max_mentees > (select count(*) from public.mentorships s where s.mentor_id = m.user_id and s.status = 'accepted')) desc,
            m.created_at desc
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

create or replace function public.request_mentor(p_mentor uuid, p_topic text, p_message text)
returns public.mentorships
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  mp public.mentor_profiles;
  r public.mentorships;
  v_msg text := btrim(coalesce(p_message, ''));
  n int;
begin
  if not public.is_verified() then raise exception 'Only verified members can request a mentor' using errcode = '42501'; end if;
  if p_mentor = me then raise exception 'You can’t mentor yourself'; end if;
  if char_length(v_msg) < 20 or char_length(v_msg) > 600 then raise exception 'Tell the mentor what you need help with in 20 to 600 characters'; end if;
  select * into mp from public.mentor_profiles where user_id = p_mentor;
  if not found or public.is_blocked_between(me, p_mentor)
     or not exists (select 1 from public.profiles where id = p_mentor and verification = 'verified') then
    raise exception 'Mentor not found';
  end if;
  if not (p_topic = any (mp.topics)) then raise exception 'This mentor does not cover that topic'; end if;
  if not mp.is_accepting then raise exception 'This mentor is not taking new mentees right now'; end if;
  if (select count(*) from public.mentorships where mentor_id = p_mentor and status = 'accepted') >= mp.max_mentees then
    raise exception 'This mentor has no free slots right now';
  end if;
  if exists (select 1 from public.mentorships where mentor_id = p_mentor and mentee_id = me and status in ('requested', 'accepted')) then
    raise exception 'You already have an open request with this mentor';
  end if;
  select count(*) into n from public.mentorships where mentee_id = me and status in ('requested', 'accepted');
  if n >= 3 then raise exception 'You can have up to 3 open mentor requests. End or wait for one first.'; end if;
  insert into public.mentorships (mentor_id, mentee_id, topic, message) values (p_mentor, me, p_topic, v_msg) returning * into r;
  perform public._notify(p_mentor, 'mentor_request', me, r.id, p_topic);
  return r;
end;
$$;

-- Returns the mentee id so the app can open the conversation; the DM is created here and is never a "message request".
create or replace function public.respond_mentorship(p_id uuid, p_accept boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.mentorships;
  mp public.mentor_profiles;
begin
  if not public.is_verified() then raise exception 'Only verified members can do this' using errcode = '42501'; end if;
  -- the lock on the mentor's profile serialises every accept for this mentor, so the slot count below is exact
  select * into mp from public.mentor_profiles where user_id = me for update;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  select * into s from public.mentorships where id = p_id and mentor_id = me for update;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  if s.status <> 'requested' then raise exception 'This request has already been answered'; end if;
  if coalesce(p_accept, false) then
    if public.is_blocked_between(me, s.mentee_id) then raise exception 'You can’t accept this request'; end if;
    if (select count(*) from public.mentorships where mentor_id = me and status = 'accepted') >= mp.max_mentees then
      raise exception 'You have no free mentoring slots. Increase your limit or end a mentorship first.';
    end if;
    update public.mentorships set status = 'accepted', responded_at = now() where id = s.id;
    insert into public.chats (kind, dm_a, dm_b, started_by, is_request)
    values ('dm', least(me, s.mentee_id), greatest(me, s.mentee_id), me, false)
    on conflict (dm_a, dm_b) where kind = 'dm' do update set is_request = false;
    perform public._notify(s.mentee_id, 'mentor_accepted', me, s.id, s.topic);
  else
    update public.mentorships set status = 'declined', responded_at = now() where id = s.id;
    perform public._notify(s.mentee_id, 'mentor_declined', me, s.id, s.topic);
  end if;
  return s.mentee_id;
end;
$$;

create or replace function public.end_mentorship(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.mentorships;
begin
  select * into s from public.mentorships where id = p_id and me in (mentor_id, mentee_id) for update;
  if not found then raise exception 'Mentorship not found' using errcode = '42501'; end if;
  if s.status = 'requested' and me = s.mentor_id then raise exception 'Accept or decline this request instead'; end if;
  if s.status not in ('requested', 'accepted') then raise exception 'This mentorship is already over'; end if;
  update public.mentorships set status = 'ended', ended_at = now() where id = s.id;
end;
$$;

create or replace function public.my_mentorships()
returns table (id uuid, role text, other_id uuid, other_name text, other_avatar text, other_batch int, topic text, message text,
               status text, created_at timestamptz, responded_at timestamptz, ended_at timestamptz, chat_id uuid)
language sql stable security definer set search_path = ''
as $$
  select s.id, case when s.mentor_id = auth.uid() then 'mentor' else 'mentee' end,
         o.id, o.full_name, o.avatar_url, o.grad_year, s.topic, s.message, s.status::text, s.created_at, s.responded_at, s.ended_at,
         (select c.id from public.chats c where c.kind = 'dm' and c.dm_a = least(s.mentor_id, s.mentee_id) and c.dm_b = greatest(s.mentor_id, s.mentee_id))
    from public.mentorships s
    join public.profiles o on o.id = case when s.mentor_id = auth.uid() then s.mentee_id else s.mentor_id end
   where public.is_verified() and auth.uid() in (s.mentor_id, s.mentee_id)
   order by (s.status = 'requested') desc, (s.status = 'accepted') desc, s.created_at desc
   limit 200;
$$;

do $$
declare f text;
begin
  foreach f in array array['become_mentor(jsonb)', 'pause_mentoring(boolean)', 'list_mentors(text, text, int, int)',
    'request_mentor(uuid, text, text)', 'respond_mentorship(uuid, boolean)', 'end_mentorship(uuid)', 'my_mentorships()'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
