-- Event operations (admin pass 3): targeted messages and reminders, finance ledger with refunds and discrepancy flags,
-- waiting list and capacity tools, day-of check-in search and arrivals, attendance report, registration adjustments
-- (transfer, discount) and bulk payment review. Every function checks its caller itself (event managers; check-in
-- volunteers only where stated), is SECURITY DEFINER with an empty search_path, and writes what it changes to the
-- activity log. Money is integer paise. Nothing here changes how members register (upsert_registration is untouched).

-- ------------------------------------------------------------------ tables
-- A message to a chosen audience: sent now or scheduled. The audience is a small JSON description (segment + filters),
-- looked up again at send time so a payment reminder scheduled for tomorrow skips people who paid tonight.
create table if not exists public.event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null default 'announcement' check (kind in ('announcement', 'payment_reminder', 'reminder')),
  title text not null check (char_length(title) between 3 and 60),
  body text not null check (char_length(body) between 3 and 130),
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object' and pg_column_size(audience) <= 2000),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  recipient_count int,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_messages_event_idx on public.event_messages (event_id, created_at desc);
create index if not exists event_messages_due_idx on public.event_messages (scheduled_for) where status = 'scheduled';

-- Who a message went to (for a message built from a saved member view, the list fixed when it was scheduled).
create table if not exists public.event_message_recipients (
  message_id uuid not null references public.event_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz,
  primary key (message_id, user_id)
);

-- Refunds are money going back out: kept as their own records (a payment can be refunded in parts).
create table if not exists public.event_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.event_payments (id) on delete restrict,
  registration_id uuid not null references public.event_registrations (id) on delete restrict,
  amount_paise int not null check (amount_paise > 0),
  method text not null check (method in ('upi', 'cash', 'bank_transfer', 'other')),
  reference text check (char_length(reference) <= 120),
  note text not null check (char_length(note) between 3 and 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_refunds_payment_idx on public.event_refunds (payment_id);
create index if not exists event_refunds_registration_idx on public.event_refunds (registration_id);

-- The waiting list for a full event.
create table if not exists public.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  headcount int not null default 1 check (headcount between 1 and 20),
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'registered', 'removed', 'expired')),
  offered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists event_waitlist_event_idx on public.event_waitlist (event_id, status, created_at);

-- Per-event operations settings, and the number of people each day can take.
create table if not exists public.event_ops (
  event_id uuid primary key references public.events (id) on delete cascade,
  waitlist_auto_promote boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.event_day_capacity (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  capacity int not null check (capacity between 1 and 100000),
  label text check (char_length(label) <= 40),
  primary key (event_id, day)
);

alter table public.event_messages enable row level security;
alter table public.event_message_recipients enable row level security;
alter table public.event_refunds enable row level security;
alter table public.event_waitlist enable row level security;
alter table public.event_ops enable row level security;
alter table public.event_day_capacity enable row level security;

drop policy if exists "managers read messages" on public.event_messages;
create policy "managers read messages" on public.event_messages for select to authenticated using (public.is_event_manager(event_id));
drop policy if exists "managers read message recipients" on public.event_message_recipients;
create policy "managers read message recipients" on public.event_message_recipients for select to authenticated using (
  exists (select 1 from public.event_messages m where m.id = message_id and public.is_event_manager(m.event_id)));
drop policy if exists "managers read refunds" on public.event_refunds;
create policy "managers read refunds" on public.event_refunds for select to authenticated using (
  exists (select 1 from public.event_registrations r where r.id = registration_id and public.is_event_manager(r.event_id)));
drop policy if exists "own waitlist or managers" on public.event_waitlist;
create policy "own waitlist or managers" on public.event_waitlist for select to authenticated using (user_id = auth.uid() or public.is_event_manager(event_id));
drop policy if exists "managers read event ops" on public.event_ops;
create policy "managers read event ops" on public.event_ops for select to authenticated using (public.is_event_manager(event_id));
drop policy if exists "managers read day capacity" on public.event_day_capacity;
create policy "managers read day capacity" on public.event_day_capacity for select to authenticated using (public.is_event_manager(event_id));

grant select on public.event_messages, public.event_message_recipients, public.event_refunds, public.event_waitlist,
                public.event_ops, public.event_day_capacity to authenticated;

-- A refunded payment was being logged as "payment not received": give it its own wording, and let a function that
-- writes its own, richer log line switch the automatic one off for the current transaction.
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
    if coalesce(current_setting('app.skip_payment_audit', true), '') = '1' then
      return new;
    end if;
    perform public._audit(case new.status when 'verified' then 'verify_payment' when 'refunded' then 'refund_payment' else 'reject_payment' end,
      'event_payments', new.registration_id,
      jsonb_build_object('payment_id', new.id, 'amount', new.amount_paise, 'utr', new.utr, 'note', new.review_note));
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------ audiences (internal)
-- Who a message goes to. p_aud keys (all optional): segment (registered | unpaid | under_review | confirmed | not_checked_in |
-- checked_in | cancelled | not_registered | waitlist), batch_from, batch_to, city, branch, ticket_type_id, view_id.
-- A saved member view is resolved by the caller (admins only) and handed in as p_view_ids.
create or replace function public._event_audience(p_event uuid, p_aud jsonb, p_exclude uuid default null, p_view_ids uuid[] default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a jsonb := coalesce(p_aud, '{}'::jsonb);
  seg text := coalesce(nullif(a ->> 'segment', ''), 'registered');
  v_from int;
  v_to int;
  v_city text := nullif(lower(btrim(coalesce(a ->> 'city', ''))), '');
  v_branch text := nullif(btrim(coalesce(a ->> 'branch', '')), '');
  v_ticket uuid;
begin
  if jsonb_typeof(a) <> 'object' then raise exception 'That audience is not valid.'; end if;
  select * into ev from public.events where id = p_event;
  if not found then raise exception 'Event not found'; end if;
  if seg not in ('registered', 'unpaid', 'under_review', 'confirmed', 'not_checked_in', 'checked_in', 'cancelled', 'not_registered', 'waitlist') then
    raise exception 'Unknown audience.';
  end if;
  if coalesce(a ->> 'batch_from', '') <> '' then
    if (a ->> 'batch_from') !~ '^[0-9]{4}$' then raise exception 'Batch years look like 2005.'; end if;
    v_from := (a ->> 'batch_from')::int;
  end if;
  if coalesce(a ->> 'batch_to', '') <> '' then
    if (a ->> 'batch_to') !~ '^[0-9]{4}$' then raise exception 'Batch years look like 2005.'; end if;
    v_to := (a ->> 'batch_to')::int;
  end if;
  if coalesce(a ->> 'ticket_type_id', '') <> '' then
    if (a ->> 'ticket_type_id') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Unknown ticket type.'; end if;
    v_ticket := (a ->> 'ticket_type_id')::uuid;
    if not exists (select 1 from public.event_ticket_types t where t.id = v_ticket and t.event_id = p_event) then
      raise exception 'Unknown ticket type.';
    end if;
    if seg in ('not_registered', 'waitlist') then raise exception 'A ticket type only applies to people who registered.'; end if;
  end if;
  v_city := left(v_city, 80);

  if seg = 'not_registered' then
    return query
      select p.id from public.profiles p
       where p.verification = 'verified' and p.onboarded
         and (ev.eligible_from_year is null or p.grad_year >= ev.eligible_from_year)
         and (ev.eligible_to_year is null or p.grad_year <= ev.eligible_to_year)
         and not exists (select 1 from public.event_registrations r where r.event_id = p_event and r.user_id = p.id and r.status <> 'cancelled')
         and (v_from is null or p.grad_year >= v_from) and (v_to is null or p.grad_year <= v_to)
         and (v_city is null or position(v_city in lower(coalesce(p.city, ''))) > 0)
         and (v_branch is null or p.branch = v_branch)
         and (p_view_ids is null or p.id = any (p_view_ids))
         and p.id is distinct from p_exclude;
  elsif seg = 'waitlist' then
    return query
      select w.user_id from public.event_waitlist w join public.profiles p on p.id = w.user_id
       where w.event_id = p_event and w.status in ('waiting', 'offered')
         and (v_from is null or p.grad_year >= v_from) and (v_to is null or p.grad_year <= v_to)
         and (v_city is null or position(v_city in lower(coalesce(p.city, ''))) > 0)
         and (v_branch is null or p.branch = v_branch)
         and (p_view_ids is null or w.user_id = any (p_view_ids))
         and w.user_id is distinct from p_exclude;
  else
    return query
      select r.user_id from public.event_registrations r join public.profiles p on p.id = r.user_id
       where r.event_id = p_event
         and case seg
               when 'registered' then r.status <> 'cancelled'
               when 'unpaid' then r.status = 'pending_payment'
               when 'under_review' then r.status = 'under_review'
               when 'confirmed' then r.status = 'confirmed'
               when 'not_checked_in' then r.status = 'confirmed' and r.checked_in_at is null
               when 'checked_in' then r.checked_in_at is not null
               when 'cancelled' then r.status = 'cancelled'
             end
         and (v_from is null or coalesce(r.grad_year, p.grad_year) >= v_from)
         and (v_to is null or coalesce(r.grad_year, p.grad_year) <= v_to)
         and (v_city is null or position(v_city in lower(coalesce(r.city, p.city, ''))) > 0)
         and (v_branch is null or coalesce(r.branch, p.branch) = v_branch)
         and (v_ticket is null or exists (select 1 from public.event_registration_items i where i.registration_id = r.id and i.ticket_type_id = v_ticket))
         and (p_view_ids is null or r.user_id = any (p_view_ids))
         and r.user_id is distinct from p_exclude;
  end if;
end;
$$;
revoke execute on function public._event_audience(uuid, jsonb, uuid, uuid[]) from anon, authenticated, public;

-- A saved member view as a list of ids (admins only); null when the audience does not use one.
create or replace function public._audience_view_ids(p_aud jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_view text := nullif(p_aud ->> 'view_id', '');
  v_filter jsonb;
begin
  if v_view is null then
    return null;
  end if;
  if not public.is_admin() then
    raise exception 'Only admins can use a saved member view as an audience.' using errcode = '42501';
  end if;
  if v_view !~ '^[0-9a-fA-F-]{36}$' then raise exception 'That saved view no longer exists.'; end if;
  select filter into v_filter from public.admin_member_views where id = v_view::uuid;
  if not found then raise exception 'That saved view no longer exists.'; end if;
  return coalesce(array(select jsonb_array_elements_text(public.admin_list_members(v_filter, 1, 0, true) -> 'ids')::uuid), '{}'::uuid[]);
end;
$$;
revoke execute on function public._audience_view_ids(jsonb) from anon, authenticated, public;

-- ------------------------------------------------------------------ messages
create or replace function public.admin_message_preview(p_event uuid, p_audience jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count int;
  v_sample jsonb;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  v_ids := public._audience_view_ids(p_audience);
  with aud as (select distinct t.uid from public._event_audience(p_event, p_audience, auth.uid(), v_ids) as t(uid))
  select (select count(*) from aud),
         coalesce((select jsonb_agg(s.full_name order by s.full_name) from (
                     select p.full_name from aud join public.profiles p on p.id = aud.uid order by p.full_name limit 5) s), '[]'::jsonb)
    into v_count, v_sample;
  return jsonb_build_object('count', v_count, 'sample', v_sample);
end;
$$;

-- Sends a scheduled message to its audience: in-app notification + push (the notification trigger does the push).
create or replace function public._deliver_event_message(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.event_messages;
  v_view_ids uuid[];
  n int;
  r record;
begin
  update public.event_messages set status = 'sending' where id = p_id and status = 'scheduled' returning * into m;
  if not found then
    return 0;
  end if;
  if m.audience ? 'view_id' and nullif(m.audience ->> 'view_id', '') is not null then
    v_view_ids := coalesce(array(select user_id from public.event_message_recipients where message_id = m.id), '{}'::uuid[]);
  end if;
  delete from public.event_message_recipients where message_id = m.id;
  insert into public.event_message_recipients (message_id, user_id, delivered_at)
    select m.id, s.uid, now() from (select distinct t.uid from public._event_audience(m.event_id, m.audience, m.created_by, v_view_ids) as t(uid)) s;
  get diagnostics n = row_count;
  for r in select user_id from public.event_message_recipients where message_id = m.id loop
    perform public._notify(r.user_id, 'announcement', m.created_by, m.id, m.title || ': ' || m.body);
  end loop;
  update public.event_messages set status = 'sent', sent_at = now(), recipient_count = n where id = m.id;
  perform public._audit('send_event_message', 'event_messages', m.id,
    jsonb_build_object('title', m.title, 'count', n, 'audience', m.audience, 'kind', m.kind, 'event_id', m.event_id));
  return n;
end;
$$;
revoke execute on function public._deliver_event_message(uuid) from anon, authenticated, public;

create or replace function public.admin_send_event_message(p_event uuid, p_kind text, p_title text, p_body text, p_audience jsonb, p_send_at timestamptz default null)
returns public.event_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_aud jsonb := coalesce(p_audience, '{}'::jsonb);
  v_ids uuid[];
  v_count int;
  m public.event_messages;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can send messages' using errcode = '42501';
  end if;
  if coalesce(p_kind, 'announcement') not in ('announcement', 'payment_reminder', 'reminder') then raise exception 'Unknown message type.'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 60 then raise exception 'The title needs 3 to 60 characters.'; end if;
  if char_length(v_body) < 3 or char_length(v_body) > 130 then raise exception 'The message needs 3 to 130 characters (it is shown as a notification).'; end if;
  if jsonb_typeof(v_aud) <> 'object' or pg_column_size(v_aud) > 2000 then raise exception 'That audience is not valid.'; end if;
  if p_send_at is not null and (p_send_at <= now() or p_send_at > now() + interval '90 days') then
    raise exception 'Pick a time in the future (up to 90 days ahead), or send it now.';
  end if;
  if (select count(*) from public.event_messages where event_id = p_event and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'That is a lot of messages in an hour. Please wait a little before sending more.';
  end if;
  v_ids := public._audience_view_ids(v_aud);
  select count(*) into v_count from (select distinct t.uid from public._event_audience(p_event, v_aud, auth.uid(), v_ids) as t(uid)) s;
  if v_count = 0 then
    raise exception 'Nobody matches this audience right now.';
  end if;

  insert into public.event_messages (event_id, kind, title, body, audience, status, scheduled_for, created_by)
  values (p_event, coalesce(p_kind, 'announcement'), v_title, v_body, v_aud, 'scheduled', coalesce(p_send_at, now()), auth.uid())
  returning * into m;
  if v_ids is not null then
    -- a saved view is fixed when the message is created: remember who was in it
    insert into public.event_message_recipients (message_id, user_id) select m.id, unnest(v_ids) on conflict do nothing;
  end if;
  if p_send_at is null then
    perform public._deliver_event_message(m.id);
  else
    perform public._audit('schedule_event_message', 'event_messages', m.id,
      jsonb_build_object('title', v_title, 'audience', v_aud, 'send_at', p_send_at, 'event_id', p_event));
  end if;
  select * into m from public.event_messages where id = m.id;
  return m;
end;
$$;

create or replace function public.admin_cancel_event_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.event_messages;
begin
  select * into m from public.event_messages where id = p_id for update;
  if not found or not public.is_event_manager(m.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if m.status <> 'scheduled' then
    raise exception 'This message has already been sent or cancelled.';
  end if;
  update public.event_messages set status = 'cancelled' where id = m.id;
  perform public._audit('cancel_event_message', 'event_messages', m.id, jsonb_build_object('title', m.title, 'event_id', m.event_id));
end;
$$;

-- Sends whatever is due for the events I manage. The app calls this while an organiser has the Messages tab open;
-- pg_cron (when enabled) does the same every minute without anyone signed in.
create or replace function public.admin_send_due_messages()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  for r in select id from public.event_messages
            where status = 'scheduled' and scheduled_for <= now() and public.is_event_manager(event_id)
            order by scheduled_for limit 20 for update skip locked loop
    perform public._deliver_event_message(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public._cron_deliver_due_messages()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.event_messages where status = 'scheduled' and scheduled_for <= now() order by scheduled_for limit 50 for update skip locked loop
    perform public._deliver_event_message(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public._cron_deliver_due_messages() from anon, authenticated, public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('event-messages-due', '* * * * *', 'select public._cron_deliver_due_messages()');
    exception when others then
      raise notice 'pg_cron is not usable here: scheduled messages go out when an organiser opens the Messages tab';
    end;
  end if;
end $$;

-- ------------------------------------------------------------------ finance: refunds
create or replace function public.admin_record_refund(p_payment uuid, p_amount_paise int, p_method text, p_reference text, p_note text, p_cancel boolean default false)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.event_payments;
  reg public.event_registrations;
  v_already int;
  v_left int;
  v_full boolean;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into pay from public.event_payments where id = p_payment for update;
  if not found then raise exception 'Payment not found'; end if;
  select * into reg from public.event_registrations where id = pay.registration_id for update;
  if not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can record refunds' using errcode = '42501';
  end if;
  if pay.method = 'waiver' then raise exception 'A waiver is not money, so there is nothing to refund.'; end if;
  if pay.status <> 'verified' then raise exception 'Only verified payments can be refunded.'; end if;
  if coalesce(p_method, '') not in ('upi', 'cash', 'bank_transfer', 'other') then raise exception 'Choose how the money was returned.'; end if;
  if char_length(v_note) < 3 then raise exception 'Please give a reason (it is kept in the activity log).'; end if;
  if char_length(coalesce(p_reference, '')) > 120 then raise exception 'The reference is too long.'; end if;
  select coalesce(sum(amount_paise), 0) into v_already from public.event_refunds where payment_id = pay.id;
  v_left := pay.amount_paise - v_already;
  if p_amount_paise is null or p_amount_paise < 1 or p_amount_paise > v_left then
    raise exception 'The refund must be between ₹0.01 and the ₹% still refundable on this payment.', round(v_left / 100.0, 2);
  end if;

  perform set_config('app.skip_payment_audit', '1', true);
  insert into public.event_refunds (payment_id, registration_id, amount_paise, method, reference, note, created_by)
  values (pay.id, reg.id, p_amount_paise, p_method, nullif(btrim(p_reference), ''), left(v_note, 500), auth.uid());
  v_full := v_already + p_amount_paise = pay.amount_paise;
  if v_full then
    update public.event_payments set status = 'refunded' where id = pay.id;
  end if;
  if coalesce(p_cancel, false) then
    update public.event_registrations set status = 'cancelled', admin_note = left(v_note, 500) where id = reg.id;
  elsif v_full then
    perform public._refresh_registration_status(reg.id);
  end if;
  perform set_config('app.skip_payment_audit', '', true);

  select * into reg from public.event_registrations where id = reg.id;
  perform public._audit('record_refund', 'event_registrations', reg.id,
    jsonb_build_object('code', reg.code, 'amount', p_amount_paise, 'payment_id', pay.id, 'method', p_method, 'reference', nullif(btrim(p_reference), ''),
                       'reason', v_note, 'full', v_full, 'cancelled', coalesce(p_cancel, false), 'event_id', reg.event_id));
  perform public._notify(reg.user_id, 'announcement', auth.uid(), reg.id,
    'A refund of ₹' || round(p_amount_paise / 100.0, 2)::text || ' was recorded for your registration ' || reg.code || '.');
  return reg;
end;
$$;

-- ------------------------------------------------------------------ finance: ledger and reconciliation
-- Money flows are counted in the chosen period (IST days); the position (booked / outstanding) and the flags are as of now.
create or replace function public.admin_event_ledger(p_event uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := '-infinity';
  v_to timestamptz := 'infinity';
  v_out jsonb;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The end date is before the start date.';
  end if;
  if p_from is not null then v_from := p_from::timestamp at time zone 'Asia/Kolkata'; end if;
  if p_to is not null then v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata'; end if;

  with pay as (
    select p.id, p.status, p.method, p.amount_paise, p.created_at, p.reviewed_at
      from public.event_payments p join public.event_registrations r on r.id = p.registration_id where r.event_id = p_event
  ), flow_all as (
    select 'verified'::text as kind, coalesce(reviewed_at, created_at) as at, method, amount_paise as amount from pay where status in ('verified', 'refunded') and method <> 'waiver'
    union all
    select 'waived', coalesce(reviewed_at, created_at), 'waiver', amount_paise from pay where status = 'verified' and method = 'waiver'
    union all
    select 'pending', created_at, method, amount_paise from pay where status = 'submitted'
    union all
    select 'refund', f.created_at, f.method, f.amount_paise
      from public.event_refunds f join public.event_registrations r on r.id = f.registration_id where r.event_id = p_event
    -- refunds made before refunds were recorded separately: the whole payment, dated by its review
    union all
    select 'refund', coalesce(reviewed_at, created_at), method, amount_paise from pay
     where status = 'refunded' and not exists (select 1 from public.event_refunds f where f.payment_id = pay.id)
  ), flow as (
    select * from flow_all where at >= v_from and at < v_to
  ), reg as (
    select r.id, r.code, r.full_name, r.status, r.amount_paise as amount,
           -- verified money still held: what was verified, less any part refunded since
           coalesce(sum(p.amount_paise - coalesce(rf.refunded, 0)) filter (where p.status = 'verified'), 0)::int as ver,
           coalesce(sum(p.amount_paise - coalesce(rf.refunded, 0)) filter (where p.status = 'verified' and p.method <> 'waiver'), 0)::int as ver_cash,
           coalesce(sum(p.amount_paise) filter (where p.status = 'submitted'), 0)::int as sub,
           (count(*) filter (where p.status = 'submitted'))::int as nsub,
           min(p.created_at) filter (where p.status = 'submitted') as oldest_sub
      from public.event_registrations r
      left join public.event_payments p on p.registration_id = r.id
      left join lateral (select sum(f.amount_paise)::int as refunded from public.event_refunds f where f.payment_id = p.id) rf on true
     where r.event_id = p_event group by r.id
  ), flag as (
    select 'confirmed_underpaid'::text as kind, id, code, full_name, amount - ver as amt, 'Confirmed, but verified money covers only part of the price'::text as detail
      from reg where status = 'confirmed' and ver < amount
    union all
    select 'overpaid', id, code, full_name, ver - amount, 'More money verified than the registration costs: refund or adjust'
      from reg where status <> 'cancelled' and ver > amount
    union all
    select 'cancelled_holds_money', id, code, full_name, ver_cash, 'Cancelled, but money is still on record: refund it or keep it on purpose'
      from reg where status = 'cancelled' and ver_cash > 0
    union all
    select 'stale_submitted', id, code, full_name, sub, 'A payment has been waiting for verification for over 3 days'
      from reg where nsub > 0 and oldest_sub < now() - interval '3 days'
    union all
    select 'amount_mismatch', id, code, full_name, sub, 'The payment waiting for verification is not the amount still due'
      from reg where status <> 'cancelled' and nsub > 0 and sub <> amount - ver
    union all
    select 'status_mismatch', id, code, full_name, amount,
           case when status = 'under_review' then 'Marked as being verified, but no payment is waiting' else 'Marked unpaid, but a payment is waiting' end
      from reg where (status = 'under_review' and nsub = 0) or (status = 'pending_payment' and nsub > 0)
  ), tix as (
    select tt.id, tt.label, tt.sort, coalesce(sum(i.quantity), 0)::int as qty,
           coalesce(sum(i.quantity * i.unit_price_paise), 0)::bigint as booked,
           coalesce(round(sum(i.quantity * i.unit_price_paise * least(1.0, rg.ver::numeric / nullif(rg.amount, 0)))), 0)::bigint as collected
      from public.event_ticket_types tt
      left join public.event_registration_items i on i.ticket_type_id = tt.id
      left join reg rg on rg.id = i.registration_id and rg.status <> 'cancelled'
     where tt.event_id = p_event and (i.registration_id is null or rg.id is not null)
     group by tt.id, tt.label, tt.sort
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (select jsonb_build_object(
                 'verified', coalesce(sum(amount) filter (where kind = 'verified'), 0),
                 'refunded', coalesce(sum(amount) filter (where kind = 'refund'), 0),
                 'net', coalesce(sum(amount) filter (where kind = 'verified'), 0) - coalesce(sum(amount) filter (where kind = 'refund'), 0),
                 'pending', coalesce(sum(amount) filter (where kind = 'pending'), 0),
                 'pending_count', count(*) filter (where kind = 'pending'),
                 'waived', coalesce(sum(amount) filter (where kind = 'waived'), 0),
                 'payments', count(*) filter (where kind = 'verified'),
                 'refunds', count(*) filter (where kind = 'refund')) from flow),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m.method, 'verified', m.verified, 'refunded', m.refunded, 'pending', m.pending) order by m.method)
                             from (select method, coalesce(sum(amount) filter (where kind = 'verified'), 0) as verified,
                                          coalesce(sum(amount) filter (where kind = 'refund'), 0) as refunded,
                                          coalesce(sum(amount) filter (where kind = 'pending'), 0) as pending
                                     from flow where kind <> 'waived' group by method) m), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'verified', d.verified, 'refunded', d.refunded, 'pending', d.pending, 'waived', d.waived) order by d.day)
                          from (select (at at time zone 'Asia/Kolkata')::date as day,
                                       coalesce(sum(amount) filter (where kind = 'verified'), 0) as verified,
                                       coalesce(sum(amount) filter (where kind = 'refund'), 0) as refunded,
                                       coalesce(sum(amount) filter (where kind = 'pending'), 0) as pending,
                                       coalesce(sum(amount) filter (where kind = 'waived'), 0) as waived
                                  from flow group by 1) d), '[]'::jsonb),
    'position', (select jsonb_build_object(
                   'booked', coalesce(sum(amount) filter (where status <> 'cancelled'), 0),
                   'covered', coalesce(sum(least(ver, amount)) filter (where status <> 'cancelled'), 0),
                   'awaiting', coalesce(sum(sub) filter (where status <> 'cancelled'), 0),
                   'outstanding', coalesce(sum(greatest(0, amount - ver - sub)) filter (where status <> 'cancelled'), 0),
                   'registrations', count(*) filter (where status <> 'cancelled')) from reg),
    'by_ticket', coalesce((select jsonb_agg(jsonb_build_object('ticket_type_id', t.id, 'label', t.label, 'quantity', t.qty, 'booked', t.booked, 'collected', t.collected) order by t.sort) from tix t), '[]'::jsonb),
    'flag_total', (select count(*) from flag),
    'flags', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'registration_id', f.id, 'code', f.code, 'full_name', f.full_name,
                                                           'amount_paise', f.amt, 'detail', f.detail) order by f.kind, f.code)
                         from (select * from flag order by kind, code limit 300) f), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$$;

-- The ledger line by line (payments and refunds) for the spreadsheet. Logged when it is downloaded.
create or replace function public.admin_event_ledger_rows(p_event uuid, p_from date default null, p_to date default null, p_log boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := '-infinity';
  v_to timestamptz := 'infinity';
  v_rows jsonb;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The end date is before the start date.';
  end if;
  if p_from is not null then v_from := p_from::timestamp at time zone 'Asia/Kolkata'; end if;
  if p_to is not null then v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata'; end if;
  select coalesce(jsonb_agg(x.j order by x.at, x.ord), '[]'::jsonb) into v_rows from (
    select coalesce(p.reviewed_at, p.created_at) as at, 1 as ord,
           jsonb_build_object('at', coalesce(p.reviewed_at, p.created_at), 'type', 'payment', 'status', p.status, 'method', p.method, 'amount_paise', p.amount_paise,
                              'code', r.code, 'full_name', r.full_name, 'utr', p.utr, 'payer_name', p.payer_name, 'reference', null, 'note', p.review_note,
                              'by', rv.full_name) as j
      from public.event_payments p join public.event_registrations r on r.id = p.registration_id
      left join public.profiles rv on rv.id = p.reviewed_by
     where r.event_id = p_event and coalesce(p.reviewed_at, p.created_at) >= v_from and coalesce(p.reviewed_at, p.created_at) < v_to
    union all
    select f.created_at, 2,
           jsonb_build_object('at', f.created_at, 'type', 'refund', 'status', 'refunded', 'method', f.method, 'amount_paise', f.amount_paise,
                              'code', r.code, 'full_name', r.full_name, 'utr', p.utr, 'payer_name', p.payer_name, 'reference', f.reference, 'note', f.note,
                              'by', cb.full_name)
      from public.event_refunds f join public.event_registrations r on r.id = f.registration_id
      join public.event_payments p on p.id = f.payment_id left join public.profiles cb on cb.id = f.created_by
     where r.event_id = p_event and f.created_at >= v_from and f.created_at < v_to
    limit 20000
  ) x;
  if coalesce(p_log, false) then
    perform public._audit('export_ledger', 'events', p_event,
      jsonb_build_object('count', jsonb_array_length(v_rows), 'from', p_from, 'to', p_to, 'event_id', p_event));
  end if;
  return v_rows;
end;
$$;

-- ------------------------------------------------------------------ adjustments
-- Move a registration (and what was paid for it) to another member, e.g. a spouse or a friend taking the place.
create or replace function public.admin_transfer_registration(p_registration uuid, p_to_user uuid, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  before public.event_registrations;
  tgt public.profiles;
  v_phone text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found or not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a reason (it is kept in the activity log).'; end if;
  perform 1 from public.events where id = reg.event_id for update;
  select * into reg from public.event_registrations where id = p_registration for update;
  before := reg;
  if reg.status = 'cancelled' then raise exception 'Cancelled registrations cannot be transferred. Reopen it first.'; end if;
  if reg.checked_in_at is not null then raise exception 'This person is already checked in. Undo the check-in before transferring.'; end if;
  if p_to_user = reg.user_id then raise exception 'That is the same person.'; end if;
  select * into tgt from public.profiles where id = p_to_user;
  if not found then raise exception 'Member not found'; end if;
  if exists (select 1 from public.event_registrations r where r.event_id = reg.event_id and r.user_id = p_to_user) then
    raise exception 'That member already has a registration for this event.';
  end if;
  select phone into v_phone from public.profile_private where id = p_to_user;

  update public.event_registrations set
    user_id = p_to_user, full_name = tgt.full_name, phone = coalesce(nullif(v_phone, ''), phone), email = null,
    branch = tgt.branch, grad_year = tgt.grad_year, city = tgt.city
  where id = reg.id
  returning * into reg;

  perform public._audit('transfer_registration', 'event_registrations', reg.id,
    jsonb_build_object('code', reg.code, 'reason', v_reason, 'event_id', reg.event_id,
                       'from', jsonb_build_object('id', before.user_id, 'name', before.full_name),
                       'to', jsonb_build_object('id', p_to_user, 'name', tgt.full_name)));
  perform public._notify(before.user_id, 'announcement', auth.uid(), reg.id,
    'Your Alumni Meet registration ' || reg.code || ' was transferred to ' || tgt.full_name || ' by the organisers.');
  perform public._notify(p_to_user, 'announcement', auth.uid(), reg.id,
    'The organisers transferred registration ' || reg.code || ' to you. Open the Alumni Meet page to see your ticket.');
  return reg;
end;
$$;

-- A partial waiver: reduces what is still owed without claiming any money was received.
create or replace function public.admin_apply_discount(p_registration uuid, p_amount_paise int, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  covered int;
  due int;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found or not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Please note who approved the discount.'; end if;
  perform 1 from public.events where id = reg.event_id for update;
  select * into reg from public.event_registrations where id = p_registration for update;
  if reg.status = 'cancelled' then raise exception 'This registration was cancelled'; end if;
  select coalesce(sum(amount_paise), 0) into covered from public.event_payments where registration_id = reg.id and status in ('submitted', 'verified');
  due := reg.amount_paise - covered;
  if due <= 0 then raise exception 'Nothing is due on this registration'; end if;
  if p_amount_paise is null or p_amount_paise < 1 or p_amount_paise > due then
    raise exception 'The discount must be between ₹0.01 and the ₹% still due', round(due / 100.0, 2);
  end if;
  insert into public.event_payments (registration_id, amount_paise, method, status, review_note, reviewed_by, reviewed_at)
  values (reg.id, p_amount_paise, 'waiver', 'verified', left('Discount: ' || v_reason, 500), auth.uid(), now());
  return public._refresh_registration_status(reg.id);
end;
$$;

-- ------------------------------------------------------------------ bulk payment review
create or replace function public.admin_bulk_review_payments(p_ids uuid[], p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_done int := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one payment.'; end if;
  if cardinality(p_ids) > 200 then raise exception 'At most 200 payments at a time.'; end if;
  for v_id in select distinct x from unnest(p_ids) x loop
    begin
      perform public.review_payment(v_id, p_approve, p_note);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_failed);
end;
$$;

-- ------------------------------------------------------------------ capacity, waiting list
-- Free places (null = no limit). Public for a published event, like the headcount on the event page.
create or replace function public.event_seats_left(p_event uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.capacity is null then null
              else greatest(0, e.capacity - coalesce((select sum(r.headcount) from public.event_registrations r
                                                       where r.event_id = e.id and r.status in ('under_review', 'confirmed')), 0))::int end
    from public.events e where e.id = p_event and (e.is_published or public.is_event_manager(e.id));
$$;

-- Free places minus the places currently offered to people on the waiting list (an offer lasts 48 hours).
create or replace function public._waitlist_free(p_event uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.event_seats_left(p_event) is null then null
              else greatest(0, public.event_seats_left(p_event) - coalesce((select sum(w.headcount) from public.event_waitlist w
                    where w.event_id = p_event and w.status = 'offered' and w.offered_at > now() - interval '48 hours'), 0))::int end;
$$;

-- Offer free places to the people waiting, oldest first (someone who needs more places than are free is skipped).
create or replace function public._waitlist_offer(p_event uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  v_free int;
  w record;
  n int := 0;
begin
  select * into ev from public.events where id = p_event;
  if not found then return 0; end if;
  update public.event_waitlist set status = 'expired' where event_id = p_event and status = 'offered' and offered_at <= now() - interval '48 hours';
  v_free := public._waitlist_free(p_event);
  if v_free is null then return 0; end if;
  for w in select * from public.event_waitlist where event_id = p_event and status = 'waiting' order by created_at, id loop
    exit when v_free <= 0;
    if w.headcount <= v_free then
      update public.event_waitlist set status = 'offered', offered_at = now() where id = w.id;
      v_free := v_free - w.headcount;
      n := n + 1;
      perform public._notify(w.user_id, 'announcement', null, w.id,
        'A place has opened up for you at ' || ev.title || '. Register now: places go to whoever completes first.');
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public._waitlist_registration_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'cancelled' then
    update public.event_waitlist set status = 'registered' where event_id = new.event_id and user_id = new.user_id and status in ('waiting', 'offered');
  end if;
  if tg_op = 'UPDATE' and old.status in ('under_review', 'confirmed')
     and (new.status not in ('under_review', 'confirmed') or new.headcount < old.headcount)
     and coalesce((select o.waitlist_auto_promote from public.event_ops o where o.event_id = new.event_id), false) then
    perform public._waitlist_offer(new.event_id);
  end if;
  return null;
end;
$$;
revoke execute on function public._waitlist_registration_trigger() from anon, authenticated, public;
drop trigger if exists event_registrations_waitlist on public.event_registrations;
create trigger event_registrations_waitlist after insert or update of status, headcount, user_id on public.event_registrations
  for each row execute function public._waitlist_registration_trigger();

-- More room (capacity raised) also frees places.
create or replace function public._waitlist_capacity_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.capacity is null or new.capacity > coalesce(old.capacity, 0)) and old.capacity is not null
     and coalesce((select o.waitlist_auto_promote from public.event_ops o where o.event_id = new.id), false) then
    perform public._waitlist_offer(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public._waitlist_capacity_trigger() from anon, authenticated, public;
drop trigger if exists events_waitlist on public.events;
create trigger events_waitlist after update of capacity on public.events for each row execute function public._waitlist_capacity_trigger();

create or replace function public.join_waitlist(p_event uuid, p_headcount int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  me uuid := auth.uid();
  w public.event_waitlist;
  v_heads int := coalesce(p_headcount, 1);
begin
  if me is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  select * into ev from public.events where id = p_event and is_published;
  if not found then raise exception 'This event is not open for registration'; end if;
  if ev.registration_closes_at is not null and now() > ev.registration_closes_at then raise exception 'Registration for this event has closed'; end if;
  if v_heads < 1 or v_heads > 20 then raise exception 'Choose between 1 and 20 people.'; end if;
  if exists (select 1 from public.event_registrations r where r.event_id = p_event and r.user_id = me and r.status <> 'cancelled') then
    raise exception 'You are already registered for this event.';
  end if;
  if public.event_seats_left(p_event) is null or public.event_seats_left(p_event) >= v_heads then
    raise exception 'There are places available, so you can register now.';
  end if;
  select * into w from public.event_waitlist where event_id = p_event and user_id = me for update;
  if found and w.status in ('waiting', 'offered') then raise exception 'You are already on the waiting list.'; end if;
  insert into public.event_waitlist (event_id, user_id, headcount) values (p_event, me, v_heads)
  on conflict (event_id, user_id) do update set status = 'waiting', headcount = excluded.headcount, offered_at = null, created_at = now();
  return public.my_waitlist(p_event);
end;
$$;

create or replace function public.leave_waitlist(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_waitlist set status = 'removed' where event_id = p_event and user_id = auth.uid() and status in ('waiting', 'offered');
  if not found then raise exception 'You are not on the waiting list.'; end if;
end;
$$;

create or replace function public.my_waitlist(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', w.status, 'headcount', w.headcount, 'offered_at', w.offered_at,
           'position', (select count(*) + 1 from public.event_waitlist x where x.event_id = w.event_id and x.status = 'waiting' and (x.created_at, x.id) < (w.created_at, w.id)))
    from public.event_waitlist w where w.event_id = p_event and w.user_id = auth.uid() and w.status in ('waiting', 'offered', 'expired');
$$;

create or replace function public.admin_waitlist(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event;
  return jsonb_build_object(
    'capacity', ev.capacity,
    'seats_left', public.event_seats_left(p_event),
    'free_after_offers', public._waitlist_free(p_event),
    'auto_promote', coalesce((select o.waitlist_auto_promote from public.event_ops o where o.event_id = p_event), false),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'id', w.id, 'user_id', w.user_id, 'full_name', p.full_name, 'grad_year', p.grad_year, 'branch', p.branch, 'city', p.city,
          'headcount', w.headcount, 'status', case when w.status = 'offered' and w.offered_at <= now() - interval '48 hours' then 'expired' else w.status end,
          'created_at', w.created_at, 'offered_at', w.offered_at) order by (w.status in ('waiting', 'offered')) desc, w.created_at, w.id)
        from public.event_waitlist w join public.profiles p on p.id = w.user_id where w.event_id = p_event and w.status <> 'removed'), '[]'::jsonb));
end;
$$;

create or replace function public.admin_promote_waitlist(p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.event_waitlist;
  ev public.events;
  v_free int;
begin
  select * into w from public.event_waitlist where id = p_entry for update;
  if not found or not public.is_event_manager(w.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if w.status not in ('waiting', 'offered', 'expired') then raise exception 'This person is no longer waiting.'; end if;
  select * into ev from public.events where id = w.event_id;
  if w.status = 'offered' and w.offered_at > now() - interval '48 hours' then
    v_free := public._waitlist_free(w.event_id) + w.headcount; -- re-sending their own offer
  else
    v_free := public._waitlist_free(w.event_id);
  end if;
  if v_free is not null and v_free < w.headcount then
    raise exception 'Only % free places right now and this person needs %. Free up places or raise the capacity first.', v_free, w.headcount;
  end if;
  update public.event_waitlist set status = 'offered', offered_at = now() where id = w.id;
  perform public._notify(w.user_id, 'announcement', auth.uid(), w.id,
    'A place has opened up for you at ' || ev.title || '. Register now: places go to whoever completes first.');
  perform public._audit('promote_waitlist', 'event_waitlist', w.id,
    jsonb_build_object('name', (select full_name from public.profiles where id = w.user_id), 'headcount', w.headcount, 'event_id', w.event_id));
  return public.admin_waitlist(w.event_id);
end;
$$;

create or replace function public.admin_run_waitlist(p_event uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  n := public._waitlist_offer(p_event);
  perform public._audit('run_waitlist', 'events', p_event, jsonb_build_object('offered', n, 'event_id', p_event));
  return n;
end;
$$;

create or replace function public.admin_remove_waitlist(p_entry uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.event_waitlist;
begin
  select * into w from public.event_waitlist where id = p_entry for update;
  if not found or not public.is_event_manager(w.event_id) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  update public.event_waitlist set status = 'removed' where id = w.id;
  perform public._audit('remove_waitlist', 'event_waitlist', w.id,
    jsonb_build_object('name', (select full_name from public.profiles where id = w.user_id), 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'event_id', w.event_id));
end;
$$;

create or replace function public.admin_add_waitlist(p_event uuid, p_user uuid, p_headcount int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.event_waitlist;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found'; end if;
  if coalesce(p_headcount, 1) < 1 or coalesce(p_headcount, 1) > 20 then raise exception 'Choose between 1 and 20 people.'; end if;
  if exists (select 1 from public.event_registrations r where r.event_id = p_event and r.user_id = p_user and r.status <> 'cancelled') then
    raise exception 'That member is already registered.';
  end if;
  select * into w from public.event_waitlist where event_id = p_event and user_id = p_user;
  if found and w.status in ('waiting', 'offered') then raise exception 'That member is already on the waiting list.'; end if;
  insert into public.event_waitlist (event_id, user_id, headcount) values (p_event, p_user, coalesce(p_headcount, 1))
  on conflict (event_id, user_id) do update set status = 'waiting', headcount = excluded.headcount, offered_at = null, created_at = now()
  returning * into w;
  perform public._audit('add_waitlist', 'event_waitlist', w.id,
    jsonb_build_object('name', (select full_name from public.profiles where id = p_user), 'headcount', w.headcount, 'event_id', p_event));
  return public.admin_waitlist(p_event);
end;
$$;

-- Auto-promote switch and the people each day can take (replaces the list of days).
create or replace function public.admin_event_ops(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'auto_promote', coalesce((select o.waitlist_auto_promote from public.event_ops o where o.event_id = p_event), false),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'capacity', d.capacity, 'label', d.label) order by d.day)
                        from public.event_day_capacity d where d.event_id = p_event), '[]'::jsonb));
end;
$$;

create or replace function public.admin_save_event_ops(p_event uuid, p_auto_promote boolean, p_days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb;
  v_day date;
  v_cap int;
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  if p_days is not null and (jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 31) then
    raise exception 'The list of days is not valid (at most 31 days).';
  end if;
  insert into public.event_ops (event_id, waitlist_auto_promote) values (p_event, coalesce(p_auto_promote, false))
  on conflict (event_id) do update set waitlist_auto_promote = excluded.waitlist_auto_promote, updated_at = now();
  if p_days is not null then
    delete from public.event_day_capacity where event_id = p_event;
    for d in select * from jsonb_array_elements(p_days) loop
      if coalesce(d ->> 'day', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Each day needs a date.'; end if;
      v_day := (d ->> 'day')::date;
      if coalesce(d ->> 'capacity', '') !~ '^\d{1,6}$' or (d ->> 'capacity')::int < 1 then raise exception 'Each day needs a capacity of at least 1.'; end if;
      v_cap := (d ->> 'capacity')::int;
      insert into public.event_day_capacity (event_id, day, capacity, label) values (p_event, v_day, v_cap, left(nullif(btrim(coalesce(d ->> 'label', '')), ''), 40))
      on conflict (event_id, day) do update set capacity = excluded.capacity, label = excluded.label;
    end loop;
  end if;
  perform public._audit('save_event_ops', 'events', p_event,
    jsonb_build_object('auto_promote', coalesce(p_auto_promote, false), 'days', coalesce(jsonb_array_length(p_days), 0), 'event_id', p_event));
  return public.admin_event_ops(p_event);
end;
$$;

-- ------------------------------------------------------------------ day of the event
-- Check-in volunteers and managers: find someone by name, ticket code or the last digits of the mobile number.
-- The result leaves out phone, e-mail, notes and amounts, like event_attendees().
create or replace function public.checkin_search(p_event uuid, p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
begin
  if not public.is_event_staff(p_event) then
    raise exception 'Only event volunteers can do this' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then return '[]'::jsonb; end if;
  v_q := left(replace(replace(replace(v_q, '%', ''), '_', ''), chr(92), ''), 60);
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', r.code, 'full_name', r.full_name, 'branch', r.branch, 'grad_year', r.grad_year,
             'headcount', r.headcount, 'status', r.status, 'checked_in_at', r.checked_in_at, 'guests', jsonb_array_length(r.guests)) order by (r.status = 'cancelled'), r.full_name)
      from (select * from public.event_registrations x
             where x.event_id = p_event
               and (lower(x.full_name) like '%' || v_q || '%' or lower(x.code) like '%' || v_q || '%'
                    or (char_length(v_digits) >= 4 and regexp_replace(x.phone, '[^0-9]', '', 'g') like '%' || v_digits))
             order by (x.status = 'cancelled'), x.full_name limit 15) r), '[]'::jsonb);
end;
$$;

-- Live numbers for the gate: how many are in, how many are expected, who just arrived, arrivals by hour and by day.
create or replace function public.event_arrivals(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_event_staff(p_event) then
    raise exception 'Only event volunteers can do this' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'expected_people', coalesce(sum(r.headcount) filter (where r.status = 'confirmed'), 0),
      'arrived_people', coalesce(sum(r.headcount) filter (where r.status = 'confirmed' and r.checked_in_at is not null), 0),
      'expected_registrations', count(*) filter (where r.status = 'confirmed'),
      'arrived_registrations', count(*) filter (where r.status = 'confirmed' and r.checked_in_at is not null),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('full_name', x.full_name, 'code', x.code, 'headcount', x.headcount, 'at', x.checked_in_at) order by x.checked_in_at desc)
                            from (select * from public.event_registrations y where y.event_id = p_event and y.checked_in_at is not null order by y.checked_in_at desc limit 8) x), '[]'::jsonb),
      'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour', h.hour, 'people', h.people) order by h.hour)
                            from (select to_char(y.checked_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24":00"') as hour, sum(y.headcount) as people
                                    from public.event_registrations y where y.event_id = p_event and y.checked_in_at is not null group by 1) h), '[]'::jsonb),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', dd.day, 'people', dd.people, 'capacity', dd.capacity, 'label', dd.label) order by dd.day)
                          from (select coalesce(a.day, c.day) as day, coalesce(a.people, 0) as people, c.capacity, c.label
                                  from (select (y.checked_in_at at time zone 'Asia/Kolkata')::date as day, sum(y.headcount)::int as people
                                          from public.event_registrations y where y.event_id = p_event and y.checked_in_at is not null group by 1) a
                                  full join (select * from public.event_day_capacity where event_id = p_event) c on c.day = a.day) dd), '[]'::jsonb))
      from public.event_registrations r where r.event_id = p_event);
end;
$$;

-- Managers: who came and who did not, by batch (confirmed registrations only).
create or replace function public.admin_attendance_report(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_event_manager(p_event) then
    raise exception 'Only event managers can do this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_batch', coalesce((select jsonb_agg(jsonb_build_object('batch', b.batch, 'confirmed', b.confirmed, 'arrived', b.arrived, 'no_show', b.confirmed - b.arrived) order by b.batch nulls last)
                            from (select grad_year as batch, sum(headcount)::int as confirmed, coalesce(sum(headcount) filter (where checked_in_at is not null), 0)::int as arrived
                                    from public.event_registrations where event_id = p_event and status = 'confirmed' group by grad_year) b), '[]'::jsonb),
    'no_shows', coalesce((select jsonb_agg(jsonb_build_object('code', n.code, 'full_name', n.full_name, 'batch', n.grad_year, 'branch', n.branch,
                            'headcount', n.headcount, 'phone', n.phone) order by n.full_name)
                            from public.event_registrations n where n.event_id = p_event and n.status = 'confirmed' and n.checked_in_at is null), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public.admin_message_preview(uuid, jsonb) from anon, public;
revoke execute on function public.admin_send_event_message(uuid, text, text, text, jsonb, timestamptz) from anon, public;
revoke execute on function public.admin_cancel_event_message(uuid) from anon, public;
revoke execute on function public.admin_send_due_messages() from anon, public;
revoke execute on function public.admin_record_refund(uuid, int, text, text, text, boolean) from anon, public;
revoke execute on function public.admin_event_ledger(uuid, date, date) from anon, public;
revoke execute on function public.admin_event_ledger_rows(uuid, date, date, boolean) from anon, public;
revoke execute on function public.admin_transfer_registration(uuid, uuid, text) from anon, public;
revoke execute on function public.admin_apply_discount(uuid, int, text) from anon, public;
revoke execute on function public.admin_bulk_review_payments(uuid[], boolean, text) from anon, public;
revoke execute on function public.event_seats_left(uuid) from anon, public;
revoke execute on function public._waitlist_free(uuid) from anon, authenticated, public;
revoke execute on function public._waitlist_offer(uuid) from anon, authenticated, public;
revoke execute on function public.join_waitlist(uuid, int) from anon, public;
revoke execute on function public.leave_waitlist(uuid) from anon, public;
revoke execute on function public.my_waitlist(uuid) from anon, public;
revoke execute on function public.admin_waitlist(uuid) from anon, public;
revoke execute on function public.admin_promote_waitlist(uuid) from anon, public;
revoke execute on function public.admin_run_waitlist(uuid) from anon, public;
revoke execute on function public.admin_remove_waitlist(uuid, text) from anon, public;
revoke execute on function public.admin_add_waitlist(uuid, uuid, int) from anon, public;
revoke execute on function public.admin_event_ops(uuid) from anon, public;
revoke execute on function public.admin_save_event_ops(uuid, boolean, jsonb) from anon, public;
revoke execute on function public.checkin_search(uuid, text) from anon, public;
revoke execute on function public.event_arrivals(uuid) from anon, public;
revoke execute on function public.admin_attendance_report(uuid) from anon, public;
revoke execute on function public._audit_payment_change() from anon, authenticated, public;

grant execute on function public.admin_message_preview(uuid, jsonb) to authenticated;
grant execute on function public.admin_send_event_message(uuid, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.admin_cancel_event_message(uuid) to authenticated;
grant execute on function public.admin_send_due_messages() to authenticated;
grant execute on function public.admin_record_refund(uuid, int, text, text, text, boolean) to authenticated;
grant execute on function public.admin_event_ledger(uuid, date, date) to authenticated;
grant execute on function public.admin_event_ledger_rows(uuid, date, date, boolean) to authenticated;
grant execute on function public.admin_transfer_registration(uuid, uuid, text) to authenticated;
grant execute on function public.admin_apply_discount(uuid, int, text) to authenticated;
grant execute on function public.admin_bulk_review_payments(uuid[], boolean, text) to authenticated;
grant execute on function public.event_seats_left(uuid) to authenticated;
grant execute on function public.join_waitlist(uuid, int) to authenticated;
grant execute on function public.leave_waitlist(uuid) to authenticated;
grant execute on function public.my_waitlist(uuid) to authenticated;
grant execute on function public.admin_waitlist(uuid) to authenticated;
grant execute on function public.admin_promote_waitlist(uuid) to authenticated;
grant execute on function public.admin_run_waitlist(uuid) to authenticated;
grant execute on function public.admin_remove_waitlist(uuid, text) to authenticated;
grant execute on function public.admin_add_waitlist(uuid, uuid, int) to authenticated;
grant execute on function public.admin_event_ops(uuid) to authenticated;
grant execute on function public.admin_save_event_ops(uuid, boolean, jsonb) to authenticated;
grant execute on function public.checkin_search(uuid, text) to authenticated;
grant execute on function public.event_arrivals(uuid) to authenticated;
grant execute on function public.admin_attendance_report(uuid) to authenticated;
