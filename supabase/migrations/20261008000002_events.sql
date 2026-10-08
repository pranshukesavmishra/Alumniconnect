-- Events (first use: the Alumni Meet 2026 for batches 2001–2010):
-- registration, fees, UPI payment proof, admin verification, QR check-in and a photo gallery.
-- Money is stored in paise (integer) to avoid rounding errors.
-- Members never write registrations or payments directly; they go through the functions
-- below, which validate input and calculate the amount on the server.

create type public.registration_status as enum ('pending_payment', 'under_review', 'confirmed', 'cancelled');
create type public.payment_status as enum ('submitted', 'verified', 'rejected');
create type public.staff_role as enum ('manager', 'checkin');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null check (char_length(title) <= 120),
  tagline text check (char_length(tagline) <= 200),
  description text check (char_length(description) <= 5000),
  venue text check (char_length(venue) <= 200),
  venue_map_url text check (char_length(venue_map_url) <= 500),
  starts_at timestamptz,
  ends_at timestamptz,
  registration_closes_at timestamptz,
  eligible_from_year int,
  eligible_to_year int,
  capacity int check (capacity > 0),
  upi_id text check (upi_id ~ '^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,64}$'),
  upi_payee_name text check (char_length(upi_payee_name) <= 80),
  payment_note text check (char_length(payment_note) <= 1000),
  contact_phone text check (char_length(contact_phone) <= 40),
  contact_email text check (char_length(contact_email) <= 120),
  cover_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Admin-only settings kept out of the public events table (e.g. the Google Drive archive folder).
create table public.event_settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  drive_folder_id text check (drive_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  updated_at timestamptz not null default now()
);

create table public.event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null check (char_length(label) <= 80),
  description text check (char_length(description) <= 200),
  price_paise int not null check (price_paise >= 0),
  is_primary boolean not null default false, -- exactly one per registration (the alumnus)
  max_per_registration int not null default 1 check (max_per_registration between 1 and 20),
  sort int not null default 0
);
create index event_ticket_types_event_idx on public.event_ticket_types (event_id);

create table public.event_staff (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.staff_role not null default 'checkin',
  primary key (event_id, user_id)
);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  -- restrict: financial records must never disappear with an account or event
  event_id uuid not null references public.events (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  code text not null unique,
  status public.registration_status not null default 'pending_payment',
  full_name text not null,
  email text,
  phone text not null,
  branch text,
  grad_year int,
  city text,
  tshirt_size text check (tshirt_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
  food_pref text check (food_pref in ('veg', 'non_veg', 'jain')),
  needs_accommodation boolean not null default false,
  arrival_note text check (char_length(arrival_note) <= 300),
  guests jsonb not null default '[]'::jsonb,
  notes text check (char_length(notes) <= 1000),
  terms_accepted_at timestamptz,
  photo_consent boolean not null default true,
  headcount int not null default 1,
  amount_paise int not null default 0,
  admin_note text,
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index event_registrations_event_status_idx on public.event_registrations (event_id, status);
create trigger event_registrations_touch before update on public.event_registrations
  for each row execute function public.touch_updated_at();

create table public.event_registration_items (
  registration_id uuid not null references public.event_registrations (id) on delete cascade,
  ticket_type_id uuid not null references public.event_ticket_types (id),
  label text not null,
  unit_price_paise int not null,
  quantity int not null check (quantity > 0),
  primary key (registration_id, ticket_type_id)
);

create table public.event_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations (id) on delete cascade,
  amount_paise int not null check (amount_paise >= 0),
  method text not null default 'upi' check (method in ('upi', 'cash', 'bank_transfer', 'waiver')),
  utr text check (utr ~ '^[0-9]{12}$'),
  payer_name text check (char_length(payer_name) <= 120),
  proof_path text,
  status public.payment_status not null default 'submitted',
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index event_payments_registration_idx on public.event_payments (registration_id);
-- A UPI reference can only be claimed once (submit_upi_payment also stops reuse of rejected ones).
create unique index event_payments_utr_unique on public.event_payments (utr)
  where utr is not null and status <> 'rejected';

create table public.event_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  thumb_path text not null,
  width int,
  height int,
  caption text check (char_length(caption) <= 300),
  kind text not null default 'event' check (kind in ('event', 'throwback')),
  drive_file_id text,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (storage_path like uploaded_by::text || '/%' and thumb_path like uploaded_by::text || '/%')
);
create index event_photos_event_idx on public.event_photos (event_id, created_at desc);

-- ------------------------------------------------------------------ helpers
create or replace function public.event_role(p_event uuid)
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then 'manager'::public.staff_role
    else (select s.role from public.event_staff s where s.event_id = p_event and s.user_id = auth.uid())
  end;
$$;

create or replace function public.is_event_staff(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.event_role(p_event) is not null;
$$;

create or replace function public.is_event_manager(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.event_role(p_event) = 'manager', false);
$$;

-- Short, unambiguous ticket codes such as JEC-7KQ4M2 (no 0/O, 1/I/L).
create or replace function public.new_registration_code()
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate := 'JEC-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.event_registrations r where r.code = candidate);
  end loop;
  return candidate;
end;
$$;

-- ------------------------------------------------------------------ RLS
alter table public.events enable row level security;
alter table public.event_settings enable row level security;
alter table public.event_ticket_types enable row level security;
alter table public.event_staff enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_registration_items enable row level security;
alter table public.event_payments enable row level security;
alter table public.event_photos enable row level security;

create policy "published events are public" on public.events
  for select using (is_published or public.is_admin());
create policy "admins manage events" on public.events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins manage event settings" on public.event_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "ticket types are public" on public.event_ticket_types
  for select using (exists (select 1 from public.events e where e.id = event_id and (e.is_published or public.is_admin())));
create policy "admins manage ticket types" on public.event_ticket_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff see staff list" on public.event_staff
  for select to authenticated using (user_id = auth.uid() or public.is_event_manager(event_id));
create policy "admins manage staff" on public.event_staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "own registration or staff" on public.event_registrations
  for select to authenticated using (user_id = auth.uid() or public.is_event_staff(event_id));

-- Check-in volunteers see registrations (names, headcount) but not tickets bought or payments.
create policy "own items or managers" on public.event_registration_items
  for select to authenticated using (exists (
    select 1 from public.event_registrations r
     where r.id = registration_id and (r.user_id = auth.uid() or public.is_event_manager(r.event_id))));

create policy "own payments or managers" on public.event_payments
  for select to authenticated using (exists (
    select 1 from public.event_registrations r
     where r.id = registration_id and (r.user_id = auth.uid() or public.is_event_manager(r.event_id))));

-- Photos are for the JEC community: verified members, or anyone registered for that event.
create or replace function public.can_view_event_photos(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_verified() or public.is_event_staff(p_event) or exists (
    select 1 from public.event_registrations r
     where r.event_id = p_event and r.user_id = auth.uid() and r.status <> 'cancelled');
$$;

create policy "community sees visible photos" on public.event_photos
  for select to authenticated using (
    uploaded_by = auth.uid() or public.is_event_staff(event_id) or (not is_hidden and public.can_view_event_photos(event_id)));
create policy "community adds photos" on public.event_photos
  for insert to authenticated with check (
    uploaded_by = auth.uid()
    and public.can_view_event_photos(event_id)
    and exists (select 1 from public.events e where e.id = event_id and e.is_published)
    and (select count(*) from public.event_photos p where p.event_id = event_photos.event_id
           and p.uploaded_by = auth.uid()) < 300
  );
create policy "owners edit captions" on public.event_photos
  for update to authenticated using (uploaded_by = auth.uid()) with check (uploaded_by = auth.uid());
create policy "owners or staff delete photos" on public.event_photos
  for delete to authenticated using (uploaded_by = auth.uid() or public.is_event_manager(event_id));


-- ------------------------------------------------------------------ internal helpers
-- Serialises everything that can change an event's headcount (one lock per event) and checks
-- the capacity. Counts registrations that are paid-and-waiting or confirmed, excluding p_exclude.
create or replace function public._assert_capacity(p_event uuid, p_exclude uuid, p_heads int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap int;
  taken int;
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
end;
$$;

-- A paid, treasurer-verified registration also verifies the member's JEC profile.
create or replace function public._verify_member_from_payment(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set verification = 'verified' where id = p_user and verification = 'pending';
$$;

-- ------------------------------------------------------------------ member actions
-- Create or update my registration. p_details: attendee fields; p_items: [{ticket_type_id, quantity}].
create or replace function public.upsert_registration(p_event uuid, p_details jsonb, p_items jsonb)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  reg public.event_registrations;
  v_lines jsonb;
  v_bad jsonb;
  total int := 0;
  heads int := 0;
  primaries int := 0;
  v_guests jsonb := coalesce(p_details -> 'guests', '[]'::jsonb);
  v_locked boolean;
  v_year int;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;

  select * into ev from public.events where id = p_event and is_published;
  if not found then
    raise exception 'This event is not open for registration';
  end if;

  if coalesce(btrim(p_details ->> 'full_name'), '') = '' then
    raise exception 'Please enter your full name';
  end if;
  if coalesce(p_details ->> 'phone', '') !~ '^\+?[0-9 ]{10,16}$' then
    raise exception 'Please enter a valid mobile number';
  end if;
  if coalesce((p_details ->> 'accept_terms')::boolean, false) is not true then
    raise exception 'Please accept the terms to register';
  end if;
  if jsonb_typeof(v_guests) <> 'array' or jsonb_array_length(v_guests) > 15 then
    raise exception 'Guest list is not valid';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Ticket selection is not valid';
  end if;
  v_year := nullif(p_details ->> 'grad_year', '')::int;
  if v_year is not null and (v_year < 1947 or v_year > 2100) then
    raise exception 'Please check your passing-out year';
  end if;

  -- Price everything on the server from the ticket table; the client only sends ids and quantities.
  if exists (select 1 from jsonb_array_elements(p_items) e
              group by lower(e ->> 'ticket_type_id') having count(*) > 1) then
    raise exception 'Ticket selection is not valid';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'label', coalesce(t.label, ''), 'price', t.price_paise, 'qty', r.q,
           'max', t.max_per_registration, 'primary', t.is_primary) order by t.sort), '[]'::jsonb)
    into v_lines
    from (select (e ->> 'ticket_type_id')::uuid as tid, coalesce((e ->> 'quantity')::int, 0) as q
            from jsonb_array_elements(p_items) e) r
    left join public.event_ticket_types t on t.id = r.tid and t.event_id = p_event
   where r.q <> 0;

  select l into v_bad from jsonb_array_elements(v_lines) l
   where l ->> 'id' is null or (l ->> 'qty')::int < 0 or (l ->> 'qty')::int > (l ->> 'max')::int
   limit 1;
  if v_bad is not null then
    if v_bad ->> 'id' is null then
      raise exception 'Unknown ticket type';
    end if;
    raise exception 'You can choose at most % of "%"', v_bad ->> 'max', v_bad ->> 'label';
  end if;

  select coalesce(sum((l ->> 'price')::int * (l ->> 'qty')::int), 0),
         coalesce(sum((l ->> 'qty')::int), 0),
         coalesce(sum((l ->> 'qty')::int) filter (where (l ->> 'primary')::boolean), 0)
    into total, heads, primaries
    from jsonb_array_elements(v_lines) l;
  if primaries <> 1 then
    raise exception 'Choose exactly one main (alumnus) ticket';
  end if;

  -- Lock order everywhere: event row, then registration row.
  perform 1 from public.events where id = p_event for update;
  select * into reg from public.event_registrations where event_id = p_event and user_id = auth.uid() for update;
  v_locked := reg.id is not null and reg.status in ('under_review', 'confirmed');

  if not v_locked and ev.registration_closes_at is not null and now() > ev.registration_closes_at then
    raise exception 'Registration for this event has closed';
  end if;

  if v_locked then
    -- After payment, the ticket mix is fixed: compare the exact (ticket, quantity) sets.
    if exists (
      (select (l ->> 'id')::uuid, (l ->> 'qty')::int from jsonb_array_elements(v_lines) l
       except select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id)
      union all
      (select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id
       except select (l ->> 'id')::uuid, (l ->> 'qty')::int from jsonb_array_elements(v_lines) l)
    ) then
      raise exception 'Your payment is already submitted, so tickets can no longer be changed. Please contact the organisers.';
    end if;
  else
    -- Early check (unpaid registrations don't hold places); enforced again when paying.
    perform public._assert_capacity(p_event, reg.id, heads);
  end if;

  if reg.id is null then
    insert into public.event_registrations (event_id, user_id, code, full_name, email, phone)
    values (p_event, auth.uid(), public.new_registration_code(), '', null, '')
    returning * into reg;
  end if;

  update public.event_registrations set
    status = case
               when v_locked then status
               when total = 0 then 'confirmed'::public.registration_status
               else 'pending_payment'::public.registration_status
             end,
    -- the attendee's name is fixed once paid, so tickets can't be passed on
    full_name = case when v_locked then full_name else left(btrim(p_details ->> 'full_name'), 120) end,
    email = left(nullif(btrim(p_details ->> 'email'), ''), 120),
    phone = btrim(p_details ->> 'phone'),
    branch = left(nullif(p_details ->> 'branch', ''), 80),
    grad_year = v_year,
    city = left(nullif(btrim(p_details ->> 'city'), ''), 80),
    tshirt_size = nullif(p_details ->> 'tshirt_size', ''),
    food_pref = nullif(p_details ->> 'food_pref', ''),
    needs_accommodation = coalesce((p_details ->> 'needs_accommodation')::boolean, false),
    arrival_note = left(nullif(btrim(p_details ->> 'arrival_note'), ''), 300),
    guests = v_guests,
    notes = left(nullif(btrim(p_details ->> 'notes'), ''), 1000),
    terms_accepted_at = coalesce(terms_accepted_at, now()),
    photo_consent = coalesce((p_details ->> 'photo_consent')::boolean, true),
    headcount = heads,
    amount_paise = total
  where id = reg.id
  returning * into reg;

  if not v_locked then
    delete from public.event_registration_items where registration_id = reg.id;
    insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity)
      select reg.id, (l ->> 'id')::uuid, l ->> 'label', (l ->> 'price')::int, (l ->> 'qty')::int
        from jsonb_array_elements(v_lines) l;
  end if;

  return reg;
end;
$$;

-- Tell the organisers I paid by UPI. Amount is whatever is still due.
create or replace function public.submit_upi_payment(p_registration uuid, p_utr text, p_payer_name text, p_proof_path text)
returns public.event_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  paid int;
  pay public.event_payments;
  v_utr text := regexp_replace(coalesce(p_utr, ''), '\s', '', 'g');
begin
  select * into reg from public.event_registrations where id = p_registration and user_id = auth.uid();
  if not found then
    raise exception 'Registration not found';
  end if;
  -- event lock first, then the registration row (same order as upsert_registration)
  perform public._assert_capacity(reg.event_id, reg.id, case when reg.status = 'pending_payment' then reg.headcount else 0 end);
  select * into reg from public.event_registrations where id = p_registration for update;
  if reg.status not in ('pending_payment', 'under_review') then
    raise exception 'This registration does not need a payment';
  end if;
  if v_utr !~ '^[0-9]{12}$' then
    raise exception 'The UPI reference (UTR) must be 12 digits';
  end if;
  if p_proof_path is not null and p_proof_path not like auth.uid()::text || '/%' then
    raise exception 'Invalid screenshot';
  end if;
  -- A UTR belongs to one registration forever; only that registration may resubmit it after a rejection.
  if exists (select 1 from public.event_payments p
              where p.utr = v_utr and (p.status <> 'rejected' or p.registration_id <> reg.id)) then
    raise exception 'This UPI reference has already been used';
  end if;

  select coalesce(sum(amount_paise), 0) into paid from public.event_payments
   where registration_id = reg.id and status in ('submitted', 'verified');
  if paid >= reg.amount_paise then
    raise exception 'Payment already submitted, please wait for verification';
  end if;

  insert into public.event_payments (registration_id, amount_paise, method, utr, payer_name, proof_path)
  values (reg.id, reg.amount_paise - paid, 'upi', v_utr, left(nullif(btrim(p_payer_name), ''), 120), p_proof_path)
  returning * into pay;

  update public.event_registrations set status = 'under_review' where id = reg.id;
  return pay;
end;
$$;

create or replace function public.cancel_my_registration(p_registration uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_registrations r set status = 'cancelled'
   where r.id = p_registration and r.user_id = auth.uid() and r.status = 'pending_payment'
     and not exists (select 1 from public.event_payments p
                      where p.registration_id = r.id and p.status in ('submitted', 'verified'));
  if not found then
    raise exception 'Only unpaid registrations can be cancelled here. Please contact the organisers.';
  end if;
end;
$$;

-- ------------------------------------------------------------------ staff actions
create or replace function public._refresh_registration_status(p_registration uuid)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  verified int;
begin
  select coalesce(sum(amount_paise), 0) into verified
    from public.event_payments where registration_id = p_registration and status = 'verified';
  update public.event_registrations r
     set status = case
                    when r.status = 'cancelled' then r.status
                    when verified >= r.amount_paise then 'confirmed'::public.registration_status
                    when exists (select 1 from public.event_payments p where p.registration_id = r.id and p.status = 'submitted')
                      then 'under_review'::public.registration_status
                    else 'pending_payment'::public.registration_status
                  end,
         admin_note = case when verified >= r.amount_paise then null else r.admin_note end
   where r.id = p_registration
  returning * into reg;
  if reg.status = 'confirmed' then
    perform public._verify_member_from_payment(reg.user_id);
  end if;
  return reg;
end;
$$;

create or replace function public.review_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.event_payments;
  reg public.event_registrations;
begin
  if p_approve is null then
    raise exception 'Choose approve or reject';
  end if;
  select * into pay from public.event_payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  select * into reg from public.event_registrations where id = pay.registration_id for update;
  if not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can review payments' using errcode = '42501';
  end if;
  if pay.status <> 'submitted' then
    raise exception 'This payment has already been reviewed';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please give a reason so the member knows what to do';
  end if;

  update public.event_payments
     set status = case when p_approve then 'verified'::public.payment_status else 'rejected'::public.payment_status end,
         review_note = left(nullif(btrim(p_note), ''), 500),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = pay.id;

  if not p_approve then
    update public.event_registrations set admin_note = left(btrim(p_note), 500) where id = reg.id;
  end if;
  return public._refresh_registration_status(reg.id);
end;
$$;

-- Record a cash / bank payment or a fee waiver at the desk. Waivers are not counted as money collected.
create or replace function public.record_offline_payment(p_registration uuid, p_method text, p_amount_paise int, p_note text default null)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  covered int;
  due int;
  amt int := p_amount_paise;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found or not public.is_event_manager(reg.event_id) then
    raise exception 'Only event managers can record payments' using errcode = '42501';
  end if;
  if p_method not in ('cash', 'bank_transfer', 'waiver') then
    raise exception 'Payment method must be cash, bank transfer or waiver';
  end if;
  perform public._assert_capacity(reg.event_id, reg.id, case when reg.status = 'pending_payment' then reg.headcount else 0 end);
  select * into reg from public.event_registrations where id = p_registration for update;
  if reg.status = 'cancelled' then
    raise exception 'This registration was cancelled';
  end if;
  select coalesce(sum(amount_paise), 0) into covered from public.event_payments
   where registration_id = reg.id and status in ('submitted', 'verified');
  due := reg.amount_paise - covered;
  if due <= 0 then
    raise exception 'Nothing is due on this registration';
  end if;
  if p_method = 'waiver' then
    amt := due;
  elsif amt is null or amt < 1 or amt > due then
    raise exception 'Amount must be between ₹0.01 and the ₹% still due', round(due / 100.0, 2);
  end if;
  if p_method = 'waiver' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please note who approved the waiver';
  end if;

  insert into public.event_payments (registration_id, amount_paise, method, status, review_note, reviewed_by, reviewed_at)
  values (reg.id, amt, p_method, 'verified', left(p_note, 500), auth.uid(), now());
  return public._refresh_registration_status(reg.id);
end;
$$;

-- Scan a ticket at the gate. Returns the registration and whether it was already checked in.
create or replace function public.check_in(p_event uuid, p_code text, p_undo boolean default false)
returns table (registration public.event_registrations, already_checked_in boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  was_in boolean;
begin
  if not public.is_event_staff(p_event) then
    raise exception 'Only event volunteers can check people in' using errcode = '42501';
  end if;
  select * into reg from public.event_registrations
   where event_id = p_event and code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'No ticket found for code %', upper(btrim(p_code));
  end if;
  was_in := reg.checked_in_at is not null;
  if p_undo then
    update public.event_registrations set checked_in_at = null, checked_in_by = null
     where id = reg.id returning * into reg;
  elsif not was_in and reg.status = 'confirmed' then
    update public.event_registrations set checked_in_at = now(), checked_in_by = auth.uid()
     where id = reg.id returning * into reg;
  end if;
  return query select reg, was_in;
end;
$$;

-- Managers hide / unhide photos (members can only edit their own captions).
create or replace function public.moderate_photo(p_photo uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev uuid;
begin
  select event_id into ev from public.event_photos where id = p_photo;
  if ev is null or not public.is_event_manager(ev) then
    raise exception 'Only event managers can moderate photos' using errcode = '42501';
  end if;
  update public.event_photos set is_hidden = coalesce(p_hidden, true) where id = p_photo;
end;
$$;

revoke execute on function public._assert_capacity(uuid, uuid, int) from anon, authenticated, public;
revoke execute on function public._verify_member_from_payment(uuid) from anon, authenticated, public;
revoke execute on function public._refresh_registration_status(uuid) from anon, authenticated, public;
revoke execute on function public.new_registration_code() from anon, authenticated, public;
revoke execute on function public.moderate_photo(uuid, boolean) from anon, public;
grant execute on function public.moderate_photo(uuid, boolean) to authenticated;

-- Lock down direct execution: these are the only entry points and each checks the caller.
revoke execute on function public.upsert_registration(uuid, jsonb, jsonb) from anon, public;
revoke execute on function public.submit_upi_payment(uuid, text, text, text) from anon, public;
revoke execute on function public.cancel_my_registration(uuid) from anon, public;
revoke execute on function public.review_payment(uuid, boolean, text) from anon, public;
revoke execute on function public.record_offline_payment(uuid, text, int, text) from anon, public;
revoke execute on function public.check_in(uuid, text, boolean) from anon, public;
revoke execute on function public.admin_set_member(uuid, boolean, public.verification_status) from anon, public;
grant execute on function public.upsert_registration(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.submit_upi_payment(uuid, text, text, text) to authenticated;
grant execute on function public.cancel_my_registration(uuid) to authenticated;
grant execute on function public.review_payment(uuid, boolean, text) to authenticated;
grant execute on function public.record_offline_payment(uuid, text, int, text) to authenticated;
grant execute on function public.check_in(uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_member(uuid, boolean, public.verification_status) to authenticated;

-- ------------------------------------------------------------------ storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png']),
  ('event-photos', 'event-photos', true, 5 * 1024 * 1024, array['image/webp', 'image/jpeg']),
  ('payment-proofs', 'payment-proofs', false, 5 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- Files live under "<user id>/..." so ownership is visible in the path.
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "upload own event photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own event photos" on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "upload own payment proof" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own payment proof or managers" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (select 1 from public.event_payments p
                 join public.event_registrations r on r.id = p.registration_id
                where p.proof_path = name and public.is_event_manager(r.event_id))
  ));
