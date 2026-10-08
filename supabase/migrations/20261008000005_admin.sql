-- Admin console: edit any member or registration, with every change written to an audit log.

create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles (id) on delete set null,
  action text not null,
  target_table text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit (created_at desc);
create index admin_audit_target_idx on public.admin_audit (target_id);

alter table public.admin_audit enable row level security;
create policy "admins read audit" on public.admin_audit for select to authenticated using (public.is_admin());
grant select on public.admin_audit to authenticated;

create or replace function public._audit(p_action text, p_table text, p_target uuid, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit (actor, action, target_table, target_id, details)
  values (auth.uid(), p_action, p_table, p_target, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public._audit(text, text, uuid, jsonb) from anon, authenticated, public;

-- Admins can read members' private contact details already; let them correct them too.
create policy "admins update private details" on public.profile_private
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------------ members
-- Edit any member's profile fields (not admin/verification flags; see admin_set_member).
create or replace function public.admin_update_member(p_id uuid, p_fields jsonb, p_phone text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  before public.profiles;
  after public.profiles;
  allowed constant text[] := array['full_name', 'headline', 'member_type', 'branch', 'join_year', 'grad_year', 'current_title',
                                   'current_company', 'city', 'country', 'about', 'linkedin_url', 'website_url', 'onboarded'];
  k text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not k = any (allowed) then
      raise exception 'Field % cannot be changed here', k;
    end if;
  end loop;
  if p_fields ? 'full_name' and coalesce(btrim(p_fields ->> 'full_name'), '') = '' then
    raise exception 'Name cannot be empty';
  end if;
  select * into before from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Member not found';
  end if;

  update public.profiles p set
    full_name = case when p_fields ? 'full_name' then left(btrim(p_fields ->> 'full_name'), 120) else p.full_name end,
    headline = case when p_fields ? 'headline' then nullif(btrim(p_fields ->> 'headline'), '') else p.headline end,
    member_type = case when p_fields ? 'member_type' then nullif(p_fields ->> 'member_type', '')::public.member_type else p.member_type end,
    branch = case when p_fields ? 'branch' then nullif(p_fields ->> 'branch', '') else p.branch end,
    join_year = case when p_fields ? 'join_year' then nullif(p_fields ->> 'join_year', '')::int else p.join_year end,
    grad_year = case when p_fields ? 'grad_year' then nullif(p_fields ->> 'grad_year', '')::int else p.grad_year end,
    current_title = case when p_fields ? 'current_title' then nullif(btrim(p_fields ->> 'current_title'), '') else p.current_title end,
    current_company = case when p_fields ? 'current_company' then nullif(btrim(p_fields ->> 'current_company'), '') else p.current_company end,
    city = case when p_fields ? 'city' then nullif(btrim(p_fields ->> 'city'), '') else p.city end,
    country = case when p_fields ? 'country' then nullif(btrim(p_fields ->> 'country'), '') else p.country end,
    about = case when p_fields ? 'about' then nullif(btrim(p_fields ->> 'about'), '') else p.about end,
    linkedin_url = case when p_fields ? 'linkedin_url' then nullif(btrim(p_fields ->> 'linkedin_url'), '') else p.linkedin_url end,
    website_url = case when p_fields ? 'website_url' then nullif(btrim(p_fields ->> 'website_url'), '') else p.website_url end,
    onboarded = case when p_fields ? 'onboarded' then (p_fields ->> 'onboarded')::boolean else p.onboarded end
  where p.id = p_id
  returning * into after;

  if p_phone is not null then
    if btrim(p_phone) <> '' and btrim(p_phone) !~ '^\+?[0-9 ]{8,16}$' then
      raise exception 'Please enter a valid mobile number';
    end if;
    update public.profile_private set phone = nullif(btrim(p_phone), '') where id = p_id;
  end if;

  perform public._audit('update_member', 'profiles', p_id,
    jsonb_build_object('changed', (select jsonb_object_agg(key, jsonb_build_object('from', to_jsonb(before) -> key, 'to', value))
                                     from jsonb_each(to_jsonb(after)) where key = any (allowed) and to_jsonb(before) -> key is distinct from value),
                       'phone_changed', p_phone is not null));
  return after;
end;
$$;

-- Re-define admin_set_member so flag changes are audited too.
create or replace function public.admin_set_member(p_id uuid, p_is_admin boolean, p_verification public.verification_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
  select * into before from public.profiles where id = p_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_id = auth.uid() and p_is_admin is false then
    raise exception 'You cannot remove your own admin access. Ask another admin.';
  end if;
  update public.profiles
     set is_admin = coalesce(p_is_admin, is_admin),
         verification = coalesce(p_verification, verification)
   where id = p_id;
  perform public._audit('set_member_flags', 'profiles', p_id,
    jsonb_build_object('is_admin', jsonb_build_object('from', before.is_admin, 'to', coalesce(p_is_admin, before.is_admin)),
                       'verification', jsonb_build_object('from', before.verification, 'to', coalesce(p_verification, before.verification))));
end;
$$;

-- ------------------------------------------------------------------ registrations
-- Update a registration on a member's behalf. Tickets are re-priced on the server; if the total changes,
-- the status follows the money (e.g. a confirmed registration with an extra ticket goes back to "payment pending"
-- for the balance).
create or replace function public.admin_update_registration(p_registration uuid, p_details jsonb, p_items jsonb, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  before public.event_registrations;
  v_lines jsonb;
  v_bad jsonb;
  total int;
  heads int;
  primaries int;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found or not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can edit registrations' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Please give a reason for the change (it is kept in the audit log)';
  end if;
  perform 1 from public.events where id = reg.event_id for update;
  select * into before from public.event_registrations where id = p_registration for update;

  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' or exists (select 1 from jsonb_array_elements(p_items) e group by lower(e ->> 'ticket_type_id') having count(*) > 1) then
      raise exception 'Ticket selection is not valid';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', coalesce(t.label, ''), 'price', t.price_paise, 'qty', r.q,
                                                 'max', t.max_per_registration, 'primary', t.is_primary)), '[]'::jsonb)
      into v_lines
      from (select (e ->> 'ticket_type_id')::uuid as tid, coalesce((e ->> 'quantity')::int, 0) as q from jsonb_array_elements(p_items) e) r
      left join public.event_ticket_types t on t.id = r.tid and t.event_id = reg.event_id
     where r.q <> 0;
    select l into v_bad from jsonb_array_elements(v_lines) l
     where l ->> 'id' is null or (l ->> 'qty')::int < 0 or (l ->> 'qty')::int > (l ->> 'max')::int limit 1;
    if v_bad is not null then
      raise exception 'Ticket selection is not valid';
    end if;
    select coalesce(sum((l ->> 'price')::int * (l ->> 'qty')::int), 0), coalesce(sum((l ->> 'qty')::int), 0),
           coalesce(sum((l ->> 'qty')::int) filter (where (l ->> 'primary')::boolean), 0)
      into total, heads, primaries from jsonb_array_elements(v_lines) l;
    if primaries <> 1 then
      raise exception 'Choose exactly one main (alumnus) ticket';
    end if;
    if before.status in ('under_review', 'confirmed') and heads > before.headcount then
      perform public._assert_capacity(reg.event_id, reg.id, heads);
    end if;
    delete from public.event_registration_items where registration_id = reg.id;
    insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity)
      select reg.id, (l ->> 'id')::uuid, l ->> 'label', (l ->> 'price')::int, (l ->> 'qty')::int from jsonb_array_elements(v_lines) l;
    update public.event_registrations set amount_paise = total, headcount = heads where id = reg.id;
  end if;

  if p_details is not null then
    if p_details ? 'phone' and coalesce(p_details ->> 'phone', '') !~ '^\+?[0-9 ]{10,16}$' then
      raise exception 'Please enter a valid mobile number';
    end if;
    update public.event_registrations r set
      full_name = case when p_details ? 'full_name' and btrim(p_details ->> 'full_name') <> '' then left(btrim(p_details ->> 'full_name'), 120) else r.full_name end,
      phone = case when p_details ? 'phone' then btrim(p_details ->> 'phone') else r.phone end,
      email = case when p_details ? 'email' then nullif(btrim(p_details ->> 'email'), '') else r.email end,
      tshirt_size = case when p_details ? 'tshirt_size' then nullif(p_details ->> 'tshirt_size', '') else r.tshirt_size end,
      food_pref = case when p_details ? 'food_pref' then nullif(p_details ->> 'food_pref', '') else r.food_pref end,
      needs_accommodation = case when p_details ? 'needs_accommodation' then (p_details ->> 'needs_accommodation')::boolean else r.needs_accommodation end,
      guests = case when p_details ? 'guests' then p_details -> 'guests' else r.guests end,
      notes = case when p_details ? 'notes' then nullif(btrim(p_details ->> 'notes'), '') else r.notes end,
      admin_note = case when p_details ? 'admin_note' then nullif(btrim(p_details ->> 'admin_note'), '') else r.admin_note end
    where r.id = reg.id;
  end if;

  -- status follows the money (cancelled stays cancelled; use admin_set_registration_status to reopen)
  if before.status <> 'cancelled' then
    perform public._refresh_registration_status(reg.id);
  end if;
  select * into reg from public.event_registrations where id = p_registration;
  perform public._audit('update_registration', 'event_registrations', reg.id,
    jsonb_build_object('reason', p_reason, 'code', reg.code,
                       'amount', jsonb_build_object('from', before.amount_paise, 'to', reg.amount_paise),
                       'headcount', jsonb_build_object('from', before.headcount, 'to', reg.headcount),
                       'status', jsonb_build_object('from', before.status, 'to', reg.status),
                       'details', p_details));
  return reg;
end;
$$;

-- Cancel (e.g. refund handled offline) or reopen a registration.
create or replace function public.admin_set_registration_status(p_registration uuid, p_cancel boolean, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  before_status public.registration_status;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found or not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Please give a reason (it is kept in the audit log)';
  end if;
  before_status := reg.status;
  if p_cancel then
    update public.event_registrations set status = 'cancelled', admin_note = left(btrim(p_reason), 500) where id = reg.id;
  else
    if reg.status <> 'cancelled' then
      raise exception 'This registration is not cancelled';
    end if;
    perform public._assert_capacity(reg.event_id, reg.id, reg.headcount);
    update public.event_registrations set status = 'pending_payment' where id = reg.id;
    perform public._refresh_registration_status(reg.id);
  end if;
  select * into reg from public.event_registrations where id = p_registration;
  perform public._audit(case when p_cancel then 'cancel_registration' else 'reopen_registration' end, 'event_registrations', reg.id,
    jsonb_build_object('reason', p_reason, 'code', reg.code, 'status', jsonb_build_object('from', before_status, 'to', reg.status)));
  return reg;
end;
$$;

-- Audit the existing money actions as well.
create or replace function public._audit_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.method <> 'upi' then
    perform public._audit('record_' || new.method, 'event_payments', new.registration_id,
      jsonb_build_object('payment_id', new.id, 'amount', new.amount_paise, 'note', new.review_note));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public._audit(case when new.status = 'verified' then 'verify_payment' else 'reject_payment' end, 'event_payments', new.registration_id,
      jsonb_build_object('payment_id', new.id, 'amount', new.amount_paise, 'utr', new.utr, 'note', new.review_note));
  end if;
  return new;
end;
$$;
create trigger event_payments_audit after insert or update on public.event_payments
  for each row execute function public._audit_payment_change();

revoke execute on function public.admin_update_member(uuid, jsonb, text) from anon, public;
revoke execute on function public.admin_update_registration(uuid, jsonb, jsonb, text) from anon, public;
revoke execute on function public.admin_set_registration_status(uuid, boolean, text) from anon, public;
revoke execute on function public._audit_payment_change() from anon, authenticated, public;
grant execute on function public.admin_update_member(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_update_registration(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.admin_set_registration_status(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------------ LinkedIn import (members)
-- Replaces the member's previously imported experience/education and applies profile fields in ONE
-- transaction, so a dropped connection can never leave the profile half-replaced.
create or replace function public.save_my_linkedin_import(p_profile jsonb, p_experiences jsonb, p_educations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if jsonb_typeof(p_experiences) <> 'array' or jsonb_typeof(p_educations) <> 'array'
     or jsonb_array_length(p_experiences) > 60 or jsonb_array_length(p_educations) > 30 then
    raise exception 'Import is not valid';
  end if;

  update public.profiles p set
    headline = case when p_profile ? 'headline' then left(p_profile ->> 'headline', 160) else p.headline end,
    about = case when p_profile ? 'about' then left(p_profile ->> 'about', 3000) else p.about end,
    city = case when p_profile ? 'city' then left(p_profile ->> 'city', 80) else p.city end,
    current_title = case when p_profile ? 'current_title' then left(p_profile ->> 'current_title', 120) else p.current_title end,
    current_company = case when p_profile ? 'current_company' then left(p_profile ->> 'current_company', 120) else p.current_company end,
    linkedin_url = case when p_profile ? 'linkedin_url' and p_profile ->> 'linkedin_url' ~ '^https://www\.linkedin\.com/in/[^/?#\s]+$'
                        then p_profile ->> 'linkedin_url' else p.linkedin_url end,
    skills = case when p_profile ? 'skills' then (select coalesce(array_agg(left(x, 80)), '{}') from (select jsonb_array_elements_text(p_profile -> 'skills') x limit 50) s) else p.skills end
  where p.id = me;

  delete from public.experiences where profile_id = me and source = 'linkedin';
  delete from public.educations where profile_id = me and source = 'linkedin';

  insert into public.experiences (profile_id, title, company, location, start_date, end_date, is_current, description, source)
  select me, left(e ->> 'title', 160), left(e ->> 'company', 160), left(nullif(e ->> 'location', ''), 120),
         nullif(e ->> 'start_date', '')::date, nullif(e ->> 'end_date', '')::date, coalesce((e ->> 'is_current')::boolean, false),
         left(nullif(e ->> 'description', ''), 3000), 'linkedin'
    from jsonb_array_elements(p_experiences) e
   where coalesce(e ->> 'title', '') <> '' and coalesce(e ->> 'company', '') <> '';

  insert into public.educations (profile_id, school, degree, field, start_year, end_year, source)
  select me, left(e ->> 'school', 200), left(nullif(e ->> 'degree', ''), 160), left(nullif(e ->> 'field', ''), 160),
         nullif(e ->> 'start_year', '')::int, nullif(e ->> 'end_year', '')::int, 'linkedin'
    from jsonb_array_elements(p_educations) e
   where coalesce(e ->> 'school', '') <> '';
end;
$$;
revoke execute on function public.save_my_linkedin_import(jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.save_my_linkedin_import(jsonb, jsonb, jsonb) to authenticated;
