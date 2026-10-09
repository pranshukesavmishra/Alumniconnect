-- Downloading the activity log as a spreadsheet is itself written to the activity log (who, how many entries, which filters),
-- like the member and ledger exports. The browser calls this just before it saves the file.
create or replace function public.admin_log_audit_export(p_count integer, p_filter jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  perform public._audit('export_audit', 'admin_audit', null,
    jsonb_build_object('count', greatest(coalesce(p_count, 0), 0), 'filter', coalesce(p_filter, '{}'::jsonb)));
end;
$$;
revoke execute on function public.admin_log_audit_export(integer, jsonb) from anon, public;
grant execute on function public.admin_log_audit_export(integer, jsonb) to authenticated;
