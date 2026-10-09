-- A place offered to someone on the waiting list is held for them for 48 hours: another member whose registration is still
-- unpaid cannot take it by paying first. (Until now only the "free after offers" figure knew about offers; the payment check did not.)
-- The offered person's own registration is never blocked by their own offer, and people who already paid are never bumped.
create or replace function public._assert_capacity(p_event uuid, p_exclude uuid, p_heads int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap int;
  taken int;
  held int := 0;
  v_user uuid;
begin
  select capacity into cap from public.events where id = p_event for update;
  if cap is null then
    return;
  end if;
  select coalesce(sum(r.headcount), 0) into taken from public.event_registrations r
   where r.event_id = p_event and r.status in ('under_review', 'confirmed')
     and r.id is distinct from p_exclude;
  if taken + p_heads > cap then
    raise exception 'Sorry, the event is full';
  end if;
  if p_heads > 0 then
    select r.user_id into v_user from public.event_registrations r where r.id = p_exclude;
    v_user := coalesce(v_user, auth.uid());
    select coalesce(sum(w.headcount), 0) into held from public.event_waitlist w
     where w.event_id = p_event and w.status = 'offered' and w.offered_at > now() - interval '48 hours'
       and w.user_id is distinct from v_user;
    if taken + held + p_heads > cap then
      raise exception 'The last places are being held for people on the waiting list. Please try again later.';
    end if;
  end if;
end;
$$;
revoke execute on function public._assert_capacity(uuid, uuid, int) from anon, authenticated, public;
