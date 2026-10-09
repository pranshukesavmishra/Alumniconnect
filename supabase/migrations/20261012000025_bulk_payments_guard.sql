-- Verification pass: admin_bulk_review_payments checked nothing before looking at each payment, so any signed-in member could
-- learn whether a payment id was already verified/rejected (the 'unchanged' count) and write rows to admin_requests.
-- Now only admins and treasurers may call it, and each payment must belong to an event the caller handles money for.
create or replace function public.admin_bulk_review_payments(p_ids uuid[], p_approve boolean, p_note text default null, p_request uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_done int := 0;
  v_unchanged int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_status public.payment_status;
  v_event uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  if not (public.is_admin() or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'treasurer')) then
    raise exception 'Only treasurers can review payments' using errcode = '42501';
  end if;
  if p_request is not null then
    select result into v_result from public.admin_requests where id = p_request and actor = auth.uid();
    if found then return v_result || jsonb_build_object('repeated', true); end if;
  end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one payment.'; end if;
  if cardinality(p_ids) > 200 then raise exception 'At most 200 payments at a time.'; end if;
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      select p.status, r.event_id into v_status, v_event
        from public.event_payments p join public.event_registrations r on r.id = p.registration_id where p.id = v_id;
      if not found or not public.has_event_cap('finance', v_event) then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'error', 'You cannot review this payment.');
        continue;
      end if;
      if v_status = (case when p_approve then 'verified' else 'rejected' end)::public.payment_status then
        v_unchanged := v_unchanged + 1;
        continue;
      end if;
      perform public.review_payment(v_id, p_approve, p_note);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;
  v_result := jsonb_build_object('done', v_done, 'unchanged', v_unchanged, 'failed', v_failed);
  if p_request is not null then insert into public.admin_requests (id, actor, action, result) values (p_request, auth.uid(), 'bulk_payments', v_result) on conflict do nothing; end if;
  return v_result;
end;
$$;
