-- Command centre (admin home): one "needs your attention" summary, one global search, one roles overview.
-- All three are read-only functions. Each checks the caller itself (never trust the client) and returns counts or
-- names only, never phone numbers or e-mail addresses. Event managers (treasurers) get the same views limited to their events.

-- ------------------------------------------------------------------ needs your attention
create or replace function public.admin_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_events jsonb;
  v_global jsonb := null;
begin
  if auth.uid() is null
     or not (v_admin or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'manager')) then
    raise exception 'Only admins and event managers can view this' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'starts_at') nulls last), '[]'::jsonb) into v_events
    from (
      select jsonb_build_object(
        'id', e.id, 'slug', e.slug, 'title', e.title, 'is_published', e.is_published,
        'starts_at', e.starts_at, 'registration_closes_at', e.registration_closes_at, 'capacity', e.capacity,
        'payments_to_verify', (select count(*) from public.event_payments p join public.event_registrations r on r.id = p.registration_id
                                where r.event_id = e.id and p.status = 'submitted'),
        'oldest_payment_at', (select min(p.created_at) from public.event_payments p join public.event_registrations r on r.id = p.registration_id
                               where r.event_id = e.id and p.status = 'submitted'),
        'unpaid', (select count(*) from public.event_registrations r where r.event_id = e.id and r.status = 'pending_payment'),
        'seats_taken', (select coalesce(sum(r.headcount), 0) from public.event_registrations r
                         where r.event_id = e.id and r.status in ('under_review', 'confirmed')),
        'closes_soon', e.registration_closes_at is not null and e.registration_closes_at > now() and e.registration_closes_at <= now() + interval '7 days',
        'closed', e.registration_closes_at is not null and e.registration_closes_at <= now(),
        'missing_upi', e.is_published and e.upi_id is null
                        and exists (select 1 from public.event_ticket_types t where t.event_id = e.id and t.price_paise > 0)
      ) as x
      from public.events e
     where public.is_event_manager(e.id)
       and coalesce(e.ends_at, e.starts_at, now()) > now() - interval '3 days'
    ) q;

  if v_admin then
    v_global := jsonb_build_object(
      'members_pending', (select count(*) from public.profiles where onboarded and verification = 'pending'),
      'oldest_member_pending_at', (select min(created_at) from public.profiles where onboarded and verification = 'pending'),
      'reports_open', (select count(*) from (select 1 from public.reports where status = 'open' group by target_type, target_id) g),
      'circles_waiting', (select count(*) from public.groups where kind = 'circle' and not is_approved),
      'jobs_expiring', (select count(*) from public.jobs where not is_closed and not is_hidden
                         and expires_at > now() and expires_at <= now() + interval '7 days'));
  end if;

  return jsonb_build_object('generated_at', now(), 'is_admin', v_admin, 'global', v_global, 'events', v_events);
end;
$$;

-- ------------------------------------------------------------------ global search
-- Members (admins only), registrations and payments (events you manage). Matches name, ticket code, 12-digit UTR,
-- phone and e-mail, but phone/e-mail are only ever matched, never returned. Searching by contact detail is logged.
create or replace function public.admin_search(p_q text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  q text := lower(btrim(coalesce(p_q, '')));
  digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  by_contact boolean;
  v_members jsonb := '[]'::jsonb;
  v_regs jsonb;
  v_pays jsonb;
begin
  if auth.uid() is null
     or not (v_admin or exists (select 1 from public.event_staff s where s.user_id = auth.uid() and s.role = 'manager')) then
    raise exception 'Only admins and event managers can search here' using errcode = '42501';
  end if;
  if char_length(q) < 2 then
    return jsonb_build_object('members', '[]'::jsonb, 'registrations', '[]'::jsonb, 'payments', '[]'::jsonb, 'by_contact', false);
  end if;
  q := left(q, 100);
  by_contact := position('@' in q) > 0 or char_length(digits) >= 6;
  if char_length(digits) < 6 then digits := null; end if;

  if v_admin then
    select coalesce(jsonb_agg(m), '[]'::jsonb) into v_members from (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'grad_year', p.grad_year, 'branch', p.branch, 'city', p.city,
               'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
               'matched_on', case when position(q in lower(p.full_name)) > 0 then 'name'
                                  when position(q in lower(coalesce(p.current_company, ''))) > 0 then 'company'
                                  when position(q in lower(coalesce(p.city, ''))) > 0 then 'city'
                                  when position('@' in q) > 0 and lower(u.email) like q || '%' then 'email'
                                  else 'phone' end) as m
        from public.profiles p
        join auth.users u on u.id = p.id
        left join public.profile_private pp on pp.id = p.id
       where position(q in lower(p.full_name)) > 0
          or position(q in lower(coalesce(p.current_company, ''))) > 0
          or position(q in lower(coalesce(p.city, ''))) > 0
          or (position('@' in q) > 0 and lower(u.email) like q || '%')
          or (digits is not null and regexp_replace(coalesce(pp.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%')
       order by (position(q in lower(p.full_name)) = 1) desc, p.full_name
       limit 8) s;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_regs from (
    select jsonb_build_object('id', r.id, 'code', r.code, 'full_name', r.full_name, 'status', r.status, 'amount_paise', r.amount_paise,
             'headcount', r.headcount, 'event_slug', e.slug, 'event_title', e.title, 'user_id', r.user_id,
             'matched_on', case when lower(r.code) = q or position(q in lower(r.code)) > 0 then 'ticket code'
                                when position(q in lower(r.full_name)) > 0 then 'name'
                                when position('@' in q) > 0 then 'email'
                                else 'phone' end) as m
      from public.event_registrations r
      join public.events e on e.id = r.event_id
     where public.is_event_manager(r.event_id)
       and (position(q in lower(r.code)) > 0
         or position(q in lower(r.full_name)) > 0
         or (position('@' in q) > 0 and lower(coalesce(r.email, '')) like q || '%')
         or (digits is not null and regexp_replace(r.phone, '[^0-9]', '', 'g') like '%' || digits || '%'))
     order by (lower(r.code) = q) desc, r.created_at desc
     limit 8) s;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_pays from (
    select jsonb_build_object('id', p.id, 'utr', p.utr, 'amount_paise', p.amount_paise, 'status', p.status, 'method', p.method,
             'payer_name', p.payer_name, 'created_at', p.created_at, 'registration_id', r.id, 'code', r.code, 'full_name', r.full_name,
             'event_slug', e.slug, 'event_title', e.title) as m
      from public.event_payments p
      join public.event_registrations r on r.id = p.registration_id
      join public.events e on e.id = r.event_id
     where public.is_event_manager(r.event_id)
       and ((p.utr is not null and p.utr like '%' || regexp_replace(q, '[^0-9]', '', 'g') || '%' and char_length(regexp_replace(q, '[^0-9]', '', 'g')) >= 4)
         or position(q in lower(coalesce(p.payer_name, ''))) > 0)
     order by p.created_at desc
     limit 8) s;

  if by_contact then
    perform public._audit('search_contact', 'profiles', null,
      jsonb_build_object('kind', case when position('@' in q) > 0 then 'email' else 'phone' end,
                         'members', jsonb_array_length(v_members), 'registrations', jsonb_array_length(v_regs)));
  end if;
  return jsonb_build_object('members', v_members, 'registrations', v_regs, 'payments', v_pays, 'by_contact', by_contact);
end;
$$;

-- ------------------------------------------------------------------ roles overview (admins)
create or replace function public.admin_roles_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                 'grad_year', p.grad_year, 'branch', p.branch) order by p.full_name), '[]'::jsonb)
                 from public.profiles p where p.is_admin),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                 'role', s.role, 'event_id', e.id, 'event_slug', e.slug, 'event_title', e.title, 'is_admin', p.is_admin)
                 order by e.starts_at desc nulls last, s.role, p.full_name), '[]'::jsonb)
                 from public.event_staff s
                 join public.profiles p on p.id = s.user_id
                 join public.events e on e.id = s.event_id),
    'circle_admins', (select count(*) from public.group_members where role = 'admin'));
end;
$$;

revoke execute on function public.admin_attention() from anon, public;
revoke execute on function public.admin_search(text) from anon, public;
revoke execute on function public.admin_roles_overview() from anon, public;
grant execute on function public.admin_attention() to authenticated;
grant execute on function public.admin_search(text) to authenticated;
grant execute on function public.admin_roles_overview() to authenticated;
