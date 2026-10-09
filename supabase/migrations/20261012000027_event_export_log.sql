-- Downloads of event data (registrations with phones and emails, payments, responses, attendee lists) are written to the activity log,
-- the same way the finance ledger and member exports already are. The browser calls this just before it saves the file.
create or replace function public.admin_log_event_export(p_event uuid, p_what text, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (public.is_event_manager(p_event) or public.has_event_cap('checkin', p_event)) then
    raise exception 'Only event organisers can do this' using errcode = '42501';
  end if;
  if p_what not in ('registrations', 'attendees', 'payments', 'responses', 'performers', 'song_requests', 'not_arrived') then
    raise exception 'Unknown export.';
  end if;
  -- the finance-only lists need a manager; a gate volunteer may only export the not-arrived list
  if p_what <> 'not_arrived' and not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  perform public._audit('export_event_data', 'events', p_event,
    jsonb_build_object('what', p_what, 'count', greatest(coalesce(p_count, 0), 0), 'event_id', p_event));
end;
$$;
revoke execute on function public.admin_log_event_export(uuid, text, integer) from anon, public;
grant execute on function public.admin_log_event_export(uuid, text, integer) to authenticated;
