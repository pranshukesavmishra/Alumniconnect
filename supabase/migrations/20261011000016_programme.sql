-- Alumni Meet programme (the day's schedule) and announcements to the people who registered.

create table public.event_programme (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  title text not null check (char_length(title) between 2 and 120),
  venue text check (char_length(venue) <= 120),
  details text check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index event_programme_idx on public.event_programme (event_id, starts_at);

create table public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 2000),
  pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index event_announcements_idx on public.event_announcements (event_id, created_at desc);

alter table public.event_programme enable row level security;
alter table public.event_announcements enable row level security;

-- Anyone can read the programme of a published event (it is public information, like the event page).
create policy "read programme" on public.event_programme for select to anon, authenticated using (
  exists (select 1 from public.events e where e.id = event_id and (e.is_published or public.is_event_manager(e.id))));
create policy "managers write programme" on public.event_programme for all to authenticated using (public.is_event_manager(event_id)) with check (public.is_event_manager(event_id));

-- Announcements are for registered people (not cancelled) and the team.
create policy "read announcements" on public.event_announcements for select to authenticated using (
  public.is_event_staff(event_id)
  or exists (select 1 from public.event_registrations r where r.event_id = event_announcements.event_id and r.user_id = auth.uid() and r.status <> 'cancelled'));
create policy "managers write announcements" on public.event_announcements for all to authenticated using (public.is_event_manager(event_id)) with check (public.is_event_manager(event_id));

grant select on public.event_programme to anon, authenticated;
grant insert, update, delete on public.event_programme to authenticated;
grant select, insert, update, delete on public.event_announcements to authenticated;

-- Sending an announcement tells everyone registered (in the app, and as a push where they enabled it).
create or replace function public.post_announcement(p_event uuid, p_title text, p_body text, p_pinned boolean default false)
returns public.event_announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.event_announcements;
  who record;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can post announcements' using errcode = '42501';
  end if;
  insert into public.event_announcements (event_id, title, body, pinned, created_by)
  values (p_event, btrim(p_title), btrim(p_body), coalesce(p_pinned, false), auth.uid())
  returning * into a;
  for who in select r.user_id from public.event_registrations r where r.event_id = p_event and r.status <> 'cancelled' and r.user_id <> auth.uid() loop
    perform public._notify(who.user_id, 'announcement', auth.uid(), a.id, a.title);
  end loop;
  perform public._audit('post_announcement', 'event_announcements', a.id, jsonb_build_object('title', a.title));
  return a;
end;
$$;
revoke execute on function public.post_announcement(uuid, text, text, boolean) from anon, public;
grant execute on function public.post_announcement(uuid, text, text, boolean) to authenticated;

create trigger event_programme_audit after insert or update or delete on public.event_programme for each row execute function public._audit_config_change();
