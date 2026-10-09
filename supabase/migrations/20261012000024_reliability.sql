-- Admin pass 5: reliability. Resumable member-import jobs, idempotent bulk actions, optimistic locking of registrations,
-- and a health summary for admins. Everything checks its caller inside and writes what it changes to the activity log.

-- ------------------------------------------------------------------ import jobs (survive closing the tab)
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  created_by uuid references public.profiles (id) on delete set null,
  verified boolean not null default true,
  total int not null check (total between 1 and 2000),
  created_at timestamptz not null default now()
);
create table public.import_job_rows (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  line int not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  error text,
  member_id uuid,
  attempts int not null default 0,
  updated_at timestamptz not null default now()
);
create index import_job_rows_job_idx on public.import_job_rows (job_id, status);
-- no grants and no policies: only the functions below (and the import edge function, as the signed-in admin) touch these
alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;

create or replace function public.admin_import_start(p_rows jsonb, p_verified boolean, p_request uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n int;
begin
  perform public._require_admin();
  if p_request is not null then
    select id into v_id from public.import_jobs where request_id = p_request and created_by = auth.uid();
    if found then return v_id; end if;  -- the same click twice makes one job
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to import.'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then raise exception 'There are no rows to import.'; end if;
  if v_n > 2000 then raise exception 'At most 2000 members per import. Split the file.'; end if;
  insert into public.import_jobs (request_id, created_by, verified, total) values (p_request, auth.uid(), coalesce(p_verified, true), v_n) returning id into v_id;
  insert into public.import_job_rows (job_id, line, payload)
    select v_id, coalesce(nullif(r ->> 'line', '')::int, i::int), r - 'line'
      from jsonb_array_elements(p_rows) with ordinality as t(r, i)
     where jsonb_typeof(r) = 'object' and pg_column_size(r) < 4000;
  update public.import_jobs set total = (select count(*) from public.import_job_rows where job_id = v_id) where id = v_id;
  perform public._audit('import_job_start', 'profiles', null, jsonb_build_object('count', v_n, 'job', v_id, 'verified', coalesce(p_verified, true)));
  return v_id;
end;
$$;

-- Hands out the next rows to work on. Rows left "processing" by a worker that died are handed out again after 2 minutes.
create or replace function public.admin_import_claim(p_job uuid, p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_verified boolean;
begin
  perform public._require_admin();
  select verified into v_verified from public.import_jobs where id = p_job;
  if not found then raise exception 'That import no longer exists.'; end if;
  with c as (
    select id from public.import_job_rows
     where job_id = p_job and (status = 'pending' or (status = 'processing' and updated_at < now() - interval '2 minutes'))
     order by id limit least(greatest(coalesce(p_limit, 20), 1), 50) for update skip locked),
  u as (
    update public.import_job_rows r set status = 'processing', attempts = r.attempts + 1, updated_at = now()
      from c where r.id = c.id returning r.id, r.line, r.payload)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'line', u.line, 'payload', u.payload) order by u.id), '[]'::jsonb) into v_rows from u;
  return jsonb_build_object('verified', v_verified, 'rows', v_rows);
end;
$$;

create or replace function public.admin_import_mark(p_row bigint, p_ok boolean, p_member uuid default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  update public.import_job_rows
     set status = case when p_ok then 'done' else 'failed' end,
         member_id = case when p_ok then p_member end,
         error = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'Could not add this member.'), 300) end,
         updated_at = now()
   where id = p_row and status in ('processing', 'pending', 'failed');
end;
$$;

create or replace function public.admin_import_retry(p_job uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  perform public._require_admin();
  update public.import_job_rows set status = 'pending', error = null, updated_at = now() where job_id = p_job and status = 'failed';
  get diagnostics n = row_count;
  if n > 0 then perform public._audit('import_job_retry', 'profiles', null, jsonb_build_object('count', n, 'job', p_job)); end if;
  return n;
end;
$$;

-- One job (or the latest ones) with progress counts and the rows that failed, for the progress screen.
create or replace function public.admin_import_jobs(p_job uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', j.id, 'created_at', j.created_at, 'total', j.total, 'verified', j.verified, 'by', p.full_name,
             'pending', c.pending, 'processing', c.processing, 'done', c.done, 'failed', c.failed,
             'failures', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'line', r.line, 'name', r.payload ->> 'full_name', 'email', r.payload ->> 'email', 'error', r.error) order by r.line)
                                     from (select * from public.import_job_rows where job_id = j.id and status = 'failed' order by line limit 100) r), '[]'::jsonb))
             order by j.created_at desc)
      from (select * from public.import_jobs where p_job is null or id = p_job order by created_at desc limit case when p_job is null then 8 else 1 end) j
      left join public.profiles p on p.id = j.created_by
      cross join lateral (
        select count(*) filter (where status = 'pending') as pending, count(*) filter (where status = 'processing') as processing,
               count(*) filter (where status = 'done') as done, count(*) filter (where status = 'failed') as failed
          from public.import_job_rows where job_id = j.id) c), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_import_start(jsonb, boolean, uuid) from anon, public;
revoke execute on function public.admin_import_claim(uuid, int) from anon, public;
revoke execute on function public.admin_import_mark(bigint, boolean, uuid, text) from anon, public;
revoke execute on function public.admin_import_retry(uuid) from anon, public;
revoke execute on function public.admin_import_jobs(uuid) from anon, public;
grant execute on function public.admin_import_start(jsonb, boolean, uuid) to authenticated;
grant execute on function public.admin_import_claim(uuid, int) to authenticated;
grant execute on function public.admin_import_mark(bigint, boolean, uuid, text) to authenticated;
grant execute on function public.admin_import_retry(uuid) to authenticated;
grant execute on function public.admin_import_jobs(uuid) to authenticated;

-- ------------------------------------------------------------------ idempotent bulk actions
-- A bulk action carries a request id. Sending the same request again (double tap, retry after a dropped connection)
-- returns the first result and changes nothing more.
create table public.admin_requests (
  id uuid primary key,
  actor uuid not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admin_requests enable row level security;
create index admin_requests_created_idx on public.admin_requests (created_at);

drop function if exists public.admin_bulk_set_verification(uuid[], public.verification_status, text);
create or replace function public.admin_bulk_set_verification(p_ids uuid[], p_verification public.verification_status, p_note text default null, p_request uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  r record;
  v_changed int := 0;
  v_total int := coalesce(cardinality(p_ids), 0);
  v_result jsonb;
begin
  perform public._require_admin();
  if p_request is not null then
    select result into v_result from public.admin_requests where id = p_request and actor = auth.uid();
    if found then return v_result || jsonb_build_object('repeated', true); end if;
  end if;
  if p_verification is null then raise exception 'Choose verify, reject or not yet verified.'; end if;
  if v_total = 0 then raise exception 'Select at least one member.'; end if;
  if v_total > 1000 then raise exception 'At most 1000 members at a time.'; end if;
  for r in
    select p.id, p.verification from public.profiles p
     where p.id = any (p_ids) and p.verification <> p_verification
     for update
  loop
    update public.profiles set verification = p_verification where id = r.id;
    perform public._audit('set_member_flags', 'profiles', r.id,
      jsonb_build_object('verification', jsonb_build_object('from', r.verification, 'to', p_verification), 'bulk', true)
      || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
    v_changed := v_changed + 1;
  end loop;
  v_result := jsonb_build_object('changed', v_changed, 'unchanged', v_total - v_changed);
  if p_request is not null then insert into public.admin_requests (id, actor, action, result) values (p_request, auth.uid(), 'bulk_verification', v_result) on conflict do nothing; end if;
  return v_result;
end;
$$;

-- Payments already in the requested state count as "unchanged", not as failures; the same request id returns the first result.
drop function if exists public.admin_bulk_review_payments(uuid[], boolean, text);
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
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  if p_request is not null then
    select result into v_result from public.admin_requests where id = p_request and actor = auth.uid();
    if found then return v_result || jsonb_build_object('repeated', true); end if;
  end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one payment.'; end if;
  if cardinality(p_ids) > 200 then raise exception 'At most 200 payments at a time.'; end if;
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      select status into v_status from public.event_payments where id = v_id;
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
revoke execute on function public.admin_bulk_set_verification(uuid[], public.verification_status, text, uuid) from anon, public;
revoke execute on function public.admin_bulk_review_payments(uuid[], boolean, text, uuid) from anon, public;
grant execute on function public.admin_bulk_set_verification(uuid[], public.verification_status, text, uuid) to authenticated;
grant execute on function public.admin_bulk_review_payments(uuid[], boolean, text, uuid) to authenticated;

-- ------------------------------------------------------------------ optimistic lock on registrations
-- Passing the updated_at you loaded makes the save fail with a clear message when someone else changed the registration since.
do $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef('public.admin_update_registration(uuid, jsonb, jsonb, text)'::regprocedure) into def;
  new_def := replace(def, 'p_reason text)', 'p_reason text, p_expected timestamptz DEFAULT NULL)');
  new_def := replace(new_def, E'select * into before from public.event_registrations where id = p_registration for update;',
    E'select * into before from public.event_registrations where id = p_registration for update;\n  if p_expected is not null and before.updated_at is distinct from p_expected then\n    raise exception ''Someone else changed this registration while you were editing. Close this and open it again to see their changes, then redo yours.'' using errcode = ''P0001'';\n  end if;');
  if new_def = def or position('p_expected is not null' in new_def) = 0 then raise exception 'admin_update_registration did not match'; end if;
  drop function public.admin_update_registration(uuid, jsonb, jsonb, text);
  execute new_def;

  select pg_get_functiondef('public.admin_set_registration_status(uuid, boolean, text, boolean)'::regprocedure) into def;
  new_def := replace(def, 'p_refunded boolean DEFAULT false)', 'p_refunded boolean DEFAULT false, p_expected timestamptz DEFAULT NULL)');
  new_def := replace(new_def, E'  if coalesce(btrim(p_reason), '''') = '''' then',
    E'  if p_expected is not null and reg.updated_at is distinct from p_expected then\n    raise exception ''Someone else changed this registration while you were editing. Close this and open it again to see their changes, then redo yours.'' using errcode = ''P0001'';\n  end if;\n  if coalesce(btrim(p_reason), '''') = '''' then');
  if position('p_expected is not null' in new_def) = 0 then raise exception 'admin_set_registration_status did not match'; end if;
  drop function public.admin_set_registration_status(uuid, boolean, text, boolean);
  execute new_def;
end $$;
revoke execute on function public.admin_update_registration(uuid, jsonb, jsonb, text, timestamptz) from anon, public;
revoke execute on function public.admin_set_registration_status(uuid, boolean, text, boolean, timestamptz) from anon, public;
grant execute on function public.admin_update_registration(uuid, jsonb, jsonb, text, timestamptz) to authenticated;
grant execute on function public.admin_set_registration_status(uuid, boolean, text, boolean, timestamptz) to authenticated;

-- ------------------------------------------------------------------ health
-- Written by the nightly backup (service role). Nobody else can read or write it directly.
create table public.system_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('backup', 'push', 'import')),
  ok boolean not null,
  detail text check (char_length(detail) <= 500),
  at timestamptz not null default now()
);
create index system_events_kind_idx on public.system_events (kind, at desc);
alter table public.system_events enable row level security;
grant select, insert on public.system_events to service_role;
grant usage on sequence public.system_events_id_seq to service_role;

create or replace function public.admin_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_backup jsonb;
  v_storage jsonb;
  v_push jsonb;
  v_failures int := 0;
  v_total int := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can view this' using errcode = '42501';
  end if;
  v_backup := jsonb_build_object(
    'last', (select jsonb_build_object('at', at, 'ok', ok, 'detail', detail) from public.system_events where kind = 'backup' order by at desc limit 1),
    'last_ok_at', (select max(at) from public.system_events where kind = 'backup' and ok));
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'objects', n, 'bytes', bytes) order by bytes desc), '[]'::jsonb) into v_storage
    from (select bucket_id, count(*) as n, coalesce(sum((metadata ->> 'size')::bigint), 0) as bytes from storage.objects group by bucket_id) s;
  begin
    execute 'select count(*) filter (where status_code >= 400 or error_msg is not null), count(*) from net._http_response where created > now() - interval ''24 hours''' into v_failures, v_total;
  exception when others then
    v_failures := null; v_total := null;
  end;
  v_push := jsonb_build_object(
    'subscriptions', (select count(*) from public.push_subscriptions),
    'last_used_at', (select max(last_used_at) from public.push_subscriptions),
    'requests_24h', v_total, 'failures_24h', v_failures,
    'configured', exists (select 1 from private.settings where key = 'push_function_url'));
  return jsonb_build_object(
    'generated_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'backup', v_backup, 'storage', v_storage, 'push', v_push,
    'members', (select count(*) from public.profiles),
    'import_failed_rows', (select count(*) from public.import_job_rows where status = 'failed'),
    'import_unfinished_rows', (select count(*) from public.import_job_rows where status in ('pending', 'processing')),
    'audit_last_day', (select count(*) from public.admin_audit where created_at > now() - interval '1 day'));
end;
$$;
revoke execute on function public.admin_health() from anon, public;
grant execute on function public.admin_health() to authenticated;
