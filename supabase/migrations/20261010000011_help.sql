-- Ask JEC: a member asks for help on a topic; members who offered that kind of help (profiles.help_tags) are told.
-- Replies happen in direct messages. The asker marks it resolved. Same abuse protections as the rest of the app.

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  tag text not null check (char_length(tag) between 2 and 40),
  title text not null check (char_length(title) between 5 and 140),
  body text check (char_length(body) <= 2000),
  is_resolved boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index help_requests_open_idx on public.help_requests (created_at desc) where not is_resolved and not is_hidden;
create index help_requests_author_idx on public.help_requests (author_id, created_at desc);

alter table public.help_requests enable row level security;
create policy "see help requests" on public.help_requests for select to authenticated using (
  public.is_admin() or author_id = auth.uid() or (public.is_verified() and not is_hidden));
create policy "delete own help request" on public.help_requests for delete to authenticated using (author_id = auth.uid());
grant select, delete on public.help_requests to authenticated;

-- Asking: validation, 3 a day, and the right people are told (at most 40 members, never the asker, never blockers).
create or replace function public.ask_for_help(p_tag text, p_title text, p_body text default null)
returns public.help_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.help_requests;
  n int;
  v_tag text := btrim(coalesce(p_tag, ''));
  who record;
begin
  if not public.is_verified() then
    raise exception 'Only verified members can ask for help' using errcode = '42501';
  end if;
  if char_length(v_tag) < 2 then raise exception 'Please choose a topic'; end if;
  select count(*) into n from public.help_requests where author_id = auth.uid() and created_at > now() - interval '1 day';
  if n >= 3 then
    raise exception 'You can ask up to 3 questions a day. Please try again tomorrow.';
  end if;
  insert into public.help_requests (author_id, tag, title, body)
  values (auth.uid(), v_tag, btrim(p_title), nullif(btrim(p_body), ''))
  returning * into r;
  for who in
    select p.id from public.profiles p
     where v_tag = any (p.help_tags) and p.id <> auth.uid() and p.verification = 'verified' and p.onboarded
       and not public.is_blocked_between(p.id, auth.uid())
     order by random() limit 40
  loop
    perform public._notify(who.id, 'help_request', auth.uid(), r.id, r.title);
  end loop;
  return r;
end;
$$;

create or replace function public.resolve_help_request(p_id uuid, p_resolved boolean default true)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.help_requests set is_resolved = coalesce(p_resolved, true), resolved_at = case when coalesce(p_resolved, true) then now() else null end
   where id = p_id and author_id = auth.uid();
$$;

-- The board, newest first. "For me" shows only topics I offered help on; tag filters one topic.
create or replace function public.list_help_requests(p_tag text default null, p_for_me boolean default false, p_include_resolved boolean default false,
                                                     p_limit int default 30, p_offset int default 0)
returns table (id uuid, tag text, title text, body text, is_resolved boolean, created_at timestamptz,
               author_id uuid, author_name text, author_avatar text, author_batch int, matches_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.tag, h.title, h.body, h.is_resolved, h.created_at, p.id, p.full_name, p.avatar_url, p.grad_year,
         h.tag = any (me.help_tags)
    from public.help_requests h
    join public.profiles p on p.id = h.author_id
    join public.profiles me on me.id = auth.uid()
   where public.is_verified() and not h.is_hidden
     and (p_include_resolved or not h.is_resolved)
     and (p_tag is null or h.tag = p_tag)
     and (not p_for_me or h.tag = any (me.help_tags))
     and not public.is_blocked_between(h.author_id, auth.uid())
   order by h.created_at desc
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

-- Report a request (shared moderation queue).
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'comment', 'profile', 'message', 'job', 'help'));

create or replace function public.report_help_request(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.help_requests;
begin
  select * into h from public.help_requests where id = p_id and not is_hidden;
  if not found or not public.is_verified() then raise exception 'Request not found' using errcode = '42501'; end if;
  if h.author_id = auth.uid() then raise exception 'You can’t report your own request'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'help', p_id, left(btrim(p_reason), 500), left(h.title, 500))
  on conflict (reporter, target_type, target_id) do nothing;
end;
$$;

create or replace function public._auto_hide_help()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'help' and (select count(*) from public.reports where target_type = 'help' and target_id = new.target_id) >= 3 then
    update public.help_requests set is_hidden = true where id = new.target_id;
  end if;
  return null;
end;
$$;
create trigger reports_auto_hide_help after insert on public.reports for each row execute function public._auto_hide_help();

create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_report_status text default 'actioned')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  if p_type = 'post' then update public.posts set is_hidden = p_hide where id = p_id;
  elsif p_type = 'comment' then update public.comments set is_hidden = p_hide where id = p_id;
  elsif p_type = 'job' then update public.jobs set is_hidden = p_hide where id = p_id;
  elsif p_type = 'help' then update public.help_requests set is_hidden = p_hide where id = p_id;
  end if;
  update public.reports set status = p_report_status, handled_by = auth.uid() where target_type = p_type and target_id = p_id and status = 'open';
  perform public._audit(case when p_hide then 'hide_' else 'restore_' end || p_type, p_type || 's', p_id, jsonb_build_object('reports', p_report_status));
end;
$$;

-- the moderation queue lists help requests too (extends the version from the jobs migration)
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
      from public.reports r where r.status = p_status group by r.target_type, r.target_id),
  src as (
    select g.*,
      case g.target_type
        when 'post' then (select left(po.body, 300) from public.posts po where po.id = g.target_id)
        when 'comment' then (select left(co.body, 300) from public.comments co where co.id = g.target_id)
        when 'message' then coalesce((select left(me.body, 300) from public.messages me where me.id = g.target_id and me.deleted_at is null), g.snap)
        when 'job' then coalesce((select left(jo.title || ' at ' || jo.company || E'\n' || jo.description, 300) from public.jobs jo where jo.id = g.target_id), g.snap)
        when 'help' then coalesce((select left(hr.title || coalesce(E'\n' || hr.body, ''), 300) from public.help_requests hr where hr.id = g.target_id), g.snap)
        when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)
      end as prev,
      case g.target_type
        when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
        when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
        when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
        when 'job' then (select jo.posted_by from public.jobs jo where jo.id = g.target_id)
        when 'help' then (select hr.author_id from public.help_requests hr where hr.id = g.target_id)
        when 'profile' then g.target_id
      end as who,
      case g.target_type
        when 'post' then (select po.is_hidden from public.posts po where po.id = g.target_id)
        when 'comment' then (select co.is_hidden from public.comments co where co.id = g.target_id)
        when 'message' then coalesce((select me.deleted_at is not null from public.messages me where me.id = g.target_id), true)
        when 'job' then coalesce((select jo.is_hidden from public.jobs jo where jo.id = g.target_id), true)
        when 'help' then coalesce((select hr.is_hidden from public.help_requests hr where hr.id = g.target_id), true)
        else false
      end as gone,
      case g.target_type
        when 'message' then (select coalesce(gr.name, 'Direct message') from public.messages me join public.chats ch on ch.id = me.chat_id left join public.groups gr on gr.id = ch.group_id where me.id = g.target_id)
        when 'post' then (select coalesce(gr.name, 'Public feed') from public.posts po left join public.groups gr on gr.id = po.group_id where po.id = g.target_id)
        when 'job' then 'Jobs'
        when 'help' then 'Ask JEC'
      end as pl
    from g)
  select src.target_type, src.target_id, src.n, src.last_at, src.reasons, src.prev, src.who,
         (select p2.full_name from public.profiles p2 where p2.id = src.who), src.gone, src.pl
    from src order by src.last_at desc limit 100;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['ask_for_help(text, text, text)', 'resolve_help_request(uuid, boolean)',
    'list_help_requests(text, boolean, boolean, int, int)', 'report_help_request(uuid, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._auto_hide_help() from anon, authenticated, public;
end $$;
