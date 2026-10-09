-- Verification pass: the announcement screen counted registrants with a direct table read, which a content manager (who must not read
-- registrations) cannot do, so it said "0 people" for them. This returns just the number, to anyone who may post announcements.
create or replace function public.event_announcement_audience(p_event uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_event_cap('programme', p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  return (select count(*)::int from public.event_registrations r where r.event_id = p_event and r.status <> 'cancelled' and r.user_id <> auth.uid());
end;
$$;
revoke execute on function public.event_announcement_audience(uuid) from anon, public;
grant execute on function public.event_announcement_audience(uuid) to authenticated;
