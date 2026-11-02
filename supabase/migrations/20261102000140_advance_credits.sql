-- ADVANCE PAYMENTS MADE BEFORE THE APP (Google Form days).
-- Some alumni paid an advance (usually Rs 500) offline before registrations moved into the app. Organisers import that list
-- per event (event_advance_credits). When such a member registers, the server finds their ONE open credit (verified phone,
-- sign-in / registration email, or name + batch + branch) and applies it: a verified event_payments row with method 'advance'
-- (so every existing "due = price - money received" rule, the treasurer's checks, refunds and the ledger stay right) and
-- event_registrations.advance_paise for display. The ticket total (amount_paise) stays the full price.
-- Two or more matching credits are never applied automatically: the registration is flagged for an admin (advance_review).
-- Members cannot read the credits; admins with the payments permission (or the event treasurer) manage them, audited.
-- Additive, idempotent, safe with Windows (CRLF) line endings.

-- ------------------------------------------------------------------ columns
alter table public.event_registrations add column if not exists advance_paise int not null default 0;
alter table public.event_registrations add column if not exists advance_review boolean not null default false;
-- an admin has decided about this registration's advance (applied, removed or "not a match"): no more automatic matching
alter table public.event_registrations add column if not exists advance_manual boolean not null default false;
alter table public.event_registrations drop constraint if exists event_registrations_advance_paise_check;
alter table public.event_registrations add constraint event_registrations_advance_paise_check check (advance_paise >= 0);

-- payments: 'advance' = money received offline before the app, brought in from the organisers' advance list
alter table public.event_payments drop constraint if exists event_payments_method_check;
alter table public.event_payments add constraint event_payments_method_check
  check (method in ('upi', 'cash', 'bank_transfer', 'waiver', 'advance'));

-- ------------------------------------------------------------------ the credits
create table if not exists public.event_advance_credits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  grad_year int check (grad_year between 1947 and 2100),
  branch text check (char_length(branch) <= 120),
  phone text check (phone ~ '^\+[0-9]{8,15}$'),
  email text check (char_length(email) <= 200 and email = lower(email) and email !~ '\s'),
  amount_paise int not null check (amount_paise > 0 and amount_paise <= 100000000),
  note text check (char_length(note) <= 500),
  source text check (char_length(source) <= 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'claimed', 'void')),
  claimed_registration_id uuid unique references public.event_registrations (id) on delete set null,
  claimed_at timestamptz,
  claimed_by text check (claimed_by in ('auto', 'admin')),
  match_reason text check (match_reason in ('phone', 'email', 'name', 'admin')),
  payment_id uuid references public.event_payments (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 500),
  check (status <> 'open' or claimed_registration_id is null)
);
create index if not exists event_advance_credits_event_idx on public.event_advance_credits (event_id, status);

alter table public.event_advance_credits enable row level security;
drop policy if exists "money admins read advance credits" on public.event_advance_credits;
create policy "money admins read advance credits" on public.event_advance_credits
  for select to authenticated using (public.has_event_cap('finance', event_id));
revoke all on public.event_advance_credits from anon, authenticated;
grant select on public.event_advance_credits to authenticated;

-- ------------------------------------------------------------------ normalisation (mirrored in src/features/events/advance.ts)
-- Phone -> E.164. Indian numbers in any common form ("98765 43210", "098765...", "91987...", "+91-98765-...") become
-- "+91" + 10 digits; other numbers count only when written internationally ("+44 ...", "0044 ...").
create or replace function public._adv_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when x.intl is not null then
             case when x.intl ~ '^910?[6-9][0-9]{9}$' then '+91' || right(x.intl, 10)
                  when x.intl ~ '^91' then null
                  when char_length(x.intl) between 8 and 15 then '+' || x.intl
             end
           when ltrim(x.dg, '0') ~ '^[6-9][0-9]{9}$' then '+91' || ltrim(x.dg, '0')
           when x.dg ~ '^910?[6-9][0-9]{9}$' then '+91' || right(x.dg, 10)
         end
    from (select d.dg,
                 case when d.plus then d.dg when d.dg ~ '^00[1-9]' and char_length(d.dg) > 8 then substr(d.dg, 3) end as intl
            from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as dg, left(btrim(coalesce(p, '')), 1) = '+' as plus) d) x;
$$;

-- Email: lower case, every space removed (" Asha.Rao @Example.com " -> "asha.rao@example.com"); null without an @.
create or replace function public._adv_email(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^[^@]+@[^@]+$' then v end
    from (select lower(regexp_replace(coalesce(p, ''), '\s', '', 'g')) as v) s;
$$;

-- Name: lower case, titles (Dr. Mr. Mrs. Ms. Er. Prof. Shri Smt Miss) dropped, dots and apostrophes removed,
-- any other punctuation a space, spaces collapsed. "Dr. A.K. Sharma" -> "ak sharma".
create or replace function public._adv_name(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p, '')));
  prev text;
begin
  loop
    prev := v;
    v := regexp_replace(v, '^(dr|mr|mrs|ms|er|prof|shri|smt|miss)(\.\s*|\s+)', '');
    exit when v = prev;
  end loop;
  v := regexp_replace(v, '[.''`’]', '', 'g');
  v := regexp_replace(v, '[^[:alpha:]]+', ' ', 'g');
  return btrim(v);
end;
$$;

-- First and last word of the normalised name (null for a one-word name): "rahul kumar sharma" -> "rahul sharma".
create or replace function public._adv_name_fl(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when cardinality(w) >= 2 then w[1] || ' ' || w[cardinality(w)] end
    from (select string_to_array(public._adv_name(p), ' ') as w) s;
$$;

-- Branch: tolerant key. "B.E. in Electronics & Telecommunications", "Electronics and Telecommunication Engg", "E&TC", "ECE"
-- -> "electronic telecommunication". Degree words, and/in/of/engineering and punctuation are ignored; plurals are singular.
create or replace function public._adv_branch(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(coalesce(p, ''));
  w text;
  out text[] := '{}';
begin
  v := replace(v, '&', ' and ');
  v := ' ' || btrim(regexp_replace(regexp_replace(v, '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) || ' ';
  v := regexp_replace(v, ' (b e|be|b tech|btech|bachelor of engineering|bachelor of technology|bachelors of engineering) ', ' ', 'g');
  v := regexp_replace(v, ' (m e|m tech|mtech) ', ' me ', 'g');
  foreach w in array string_to_array(btrim(v), ' ') loop
    continue when w = '' or w = any (array['in', 'and', 'of', 'the', 'engineering', 'engg', 'eng', 'dept', 'department', 'branch']);
    if char_length(w) > 3 and w ~ 's$' and w !~ 'ss$' then
      w := left(w, -1);
    end if;
    out := out || w;
  end loop;
  v := array_to_string(out, ' ');
  return case
    when v in ('electronic telecommunication', 'e tc', 'etc', 'entc', 'extc', 'e and tc', 'ece', 'ec', 'e c', 'et', 'e t', 'electronic',
               'electronic communication', 'electronic telecom', 'electronic tele communication', 'electronic and telecommunication')
      then 'electronic telecommunication'
    when v in ('computer science', 'cse', 'cs', 'c s', 'c s e', 'computer', 'co', 'computer sc', 'computer science technology') then 'computer science'
    when v in ('information technology', 'it', 'i t') then 'information technology'
    when v in ('electrical', 'ee', 'e e') then 'electrical'
    when v in ('mechanical', 'mech') then 'mechanical'
    when v in ('civil', 'ce', 'c e') then 'civil'
    when v in ('industrial production', 'ip', 'ipe', 'i p', 'production', 'industrial', 'production industrial') then 'industrial production'
    when v in ('mca', 'master computer application', 'master of computer application') then 'mca'
    else v
  end;
end;
$$;

-- How a credit matches a person: 'phone', 'email', 'name' (name + batch + branch) or null.
create or replace function public._adv_match(c public.event_advance_credits, p_phones text[], p_emails text[], p_name text, p_year int, p_branch text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when c.phone is not null and c.phone = any (p_phones) then 'phone'
    when c.email is not null and c.email = any (p_emails) then 'email'
    when c.grad_year is not null and c.grad_year = p_year
         and public._adv_branch(c.branch) <> '' and public._adv_branch(c.branch) = public._adv_branch(p_branch)
         and public._adv_name(c.full_name) <> ''
         and (public._adv_name(c.full_name) = public._adv_name(p_name)
              or public._adv_name_fl(c.full_name) = public._adv_name_fl(p_name))
      then 'name'
  end;
$$;

-- The identity of a registration for matching: phones (profile, registration; the app has no phone sign-in), emails (sign-in, registration), name, batch, branch.
create or replace function public._adv_identity(p_registration uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'phones', to_jsonb(array_remove(array[public._adv_phone(pp.phone), public._adv_phone(r.phone)], null)),
    'emails', to_jsonb(array_remove(array[public._adv_email(u.email), public._adv_email(r.email)], null)),
    'name', r.full_name, 'year', coalesce(r.grad_year, p.grad_year), 'branch', coalesce(nullif(r.branch, ''), p.branch))
    from public.event_registrations r
    left join public.profiles p on p.id = r.user_id
    left join public.profile_private pp on pp.id = r.user_id
    left join auth.users u on u.id = r.user_id
   where r.id = p_registration;
$$;

create or replace function public._adv_match_id(c public.event_advance_credits, ident jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select public._adv_match(c,
    array(select jsonb_array_elements_text(coalesce(ident -> 'phones', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(ident -> 'emails', '[]'::jsonb))),
    ident ->> 'name', nullif(ident ->> 'year', '')::int, ident ->> 'branch');
$$;

-- Keep event_registrations.advance_paise equal to the advance money on record (verified 'advance' payments).
create or replace function public._adv_sync(p_registration uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.event_registrations r
     set advance_paise = coalesce((select sum(p.amount_paise) from public.event_payments p
                                    where p.registration_id = r.id and p.method = 'advance' and p.status in ('verified', 'refunded')), 0)::int
   where r.id = p_registration;
$$;

-- Puts one credit on one registration (both rows already locked by the caller): the advance payment, the claim, the status.
create or replace function public._adv_attach(p_credit uuid, p_registration uuid, p_by text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.event_advance_credits;
  v_pay uuid;
begin
  select * into strict c from public.event_advance_credits where id = p_credit;
  insert into public.event_payments (registration_id, amount_paise, method, status, review_note, reviewed_by, reviewed_at)
  values (p_registration, c.amount_paise, 'advance', 'verified',
          left('Advance paid before the app (offline)' || coalesce(': ' || c.note, ''), 500),
          case when p_by = 'admin' then auth.uid() end, now())
  returning id into v_pay;
  update public.event_advance_credits
     set status = 'claimed', claimed_registration_id = p_registration, claimed_at = now(), claimed_by = p_by,
         match_reason = p_reason, payment_id = v_pay
   where id = c.id;
  update public.event_registrations set advance_review = false where id = p_registration;
  perform public._adv_sync(p_registration);
  if (select status from public.event_registrations where id = p_registration) <> 'cancelled' then
    perform public._refresh_registration_status(p_registration);
  end if;
end;
$$;

-- AUTOMATIC MATCHING for one registration. Returns 'applied', 'review' (ambiguous: flagged for an admin), 'none' or 'skipped'.
-- Only unpaid registrations with something to pay, no advance yet and no admin decision are matched. Lock order: the
-- registration row, then the credit rows (FOR UPDATE: a credit taken meanwhile no longer counts as open).
create or replace function public._claim_advance_credit(p_registration uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  ident jsonb;
  v_ids uuid[];
  v_reasons text[];
  c public.event_advance_credits;
  v_reason text;
begin
  select * into reg from public.event_registrations where id = p_registration for update;
  if not found or reg.status <> 'pending_payment' or reg.amount_paise <= 0 or reg.advance_paise > 0 or reg.advance_manual
     or exists (select 1 from public.event_advance_credits x where x.claimed_registration_id = reg.id)
     or not exists (select 1 from public.event_advance_credits x where x.event_id = reg.event_id and x.status = 'open') then
    return 'skipped';
  end if;
  ident := public._adv_identity(reg.id);

  select array_agg(m.id order by m.id), array_agg(m.reason order by m.id) into v_ids, v_reasons
    from (select x.id, public._adv_match_id(x, ident) as reason
            from public.event_advance_credits x
           where x.event_id = reg.event_id and x.status = 'open'
           order by x.id
             for update) m
   where m.reason is not null;

  if coalesce(cardinality(v_ids), 0) = 0 then
    if reg.advance_review then
      update public.event_registrations set advance_review = false where id = reg.id;
    end if;
    return 'none';
  end if;
  if cardinality(v_ids) > 1 then
    update public.event_registrations set advance_review = true where id = reg.id;
    return 'review';
  end if;

  select * into c from public.event_advance_credits where id = v_ids[1];
  v_reason := v_reasons[1];
  -- a name match is not enough when another active registration of this event matches the same credit too
  if v_reason = 'name' and exists (
       select 1 from public.event_registrations o
        where o.event_id = reg.event_id and o.id <> reg.id and o.status <> 'cancelled' and o.advance_paise = 0
          and (o.grad_year = c.grad_year or public._adv_phone(o.phone) = c.phone or public._adv_email(o.email) = c.email)
          and public._adv_match_id(c, public._adv_identity(o.id)) is not null) then
    update public.event_registrations set advance_review = true where id = reg.id;
    return 'review';
  end if;

  perform public._adv_attach(c.id, reg.id, 'auto', v_reason);
  perform public._audit('auto_apply_advance', 'event_advance_credits', c.id,
    jsonb_build_object('event_id', reg.event_id, 'registration_id', reg.id, 'code', reg.code, 'amount', c.amount_paise, 'match', v_reason));
  return 'applied';
end;
$$;

-- ------------------------------------------------------------------ hook: member registers / updates
create or replace function pg_temp.flex_replace(def text, p_from text, p_to text)
returns text
language plpgsql
as $$
declare
  rx text;
begin
  if position(p_from in def) > 0 then return replace(def, p_from, p_to); end if;
  rx := regexp_replace(p_from, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g');
  rx := regexp_replace(rx, '\s+', '\s+', 'g');
  if def !~ rx then return def; end if;
  return regexp_replace(def, rx, replace(p_to, '\', '\\'));
end $$;

do $$
declare
  def text;
  d text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'upsert_registration' and p.prokind = 'f';
  if def like '%_claim_advance_credit%' then return; end if; -- already patched
  if (select count(*) from regexp_matches(def, 'return reg;', 'g')) <> 1 then
    raise exception 'upsert_registration could not be patched for advance credits (expected one return)';
  end if;
  d := pg_temp.flex_replace(def, 'return reg;
end;',
    '-- an advance paid before the app (organisers'' advance list) is applied once, on the server
  perform public._claim_advance_credit(reg.id);
  select * into reg from public.event_registrations where id = reg.id;
  return reg;
end;');
  if d = def or d not like '%_claim_advance_credit%' then
    raise exception 'upsert_registration could not be patched for advance credits';
  end if;
  execute d;

  -- check-in volunteers never see money
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_sanitized_registration' and p.prokind = 'f';
  if def not like '%advance_paise%' then
    d := pg_temp.flex_replace(def, '''amount_paise'', 0,', '''amount_paise'', 0, ''advance_paise'', 0, ''advance_review'', false,');
    if d = def then raise exception '_sanitized_registration could not be patched for advance credits'; end if;
    execute d;
  end if;

  -- ledger: the advance money (received offline before the app) as its own total; by_method already shows it as 'advance'
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_event_ledger' and p.prokind = 'f';
  if def not like '%''advance'', coalesce%' then
    d := pg_temp.flex_replace(def, '''waived'', coalesce(sum(amount) filter (where kind = ''waived''), 0),',
      '''waived'', coalesce(sum(amount) filter (where kind = ''waived''), 0),
                 ''advance'', coalesce(sum(amount) filter (where kind = ''verified'' and method = ''advance''), 0),
                 ''advance_count'', count(*) filter (where kind = ''verified'' and method = ''advance''),');
    if d = def then raise exception 'admin_event_ledger could not be patched for advance credits'; end if;
    execute d;
  end if;
end $$;

-- ------------------------------------------------------------------ member: what will be / was taken off my total
-- {amount_paise, state: 'applied' | 'expected' | 'review'} or null. Never shows anything about the credit itself.
create or replace function public.my_advance_credit(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  me public.profiles;
  ident jsonb;
  v_n int;
  v_amount int;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into reg from public.event_registrations where event_id = p_event and user_id = auth.uid();
  if found then
    if reg.advance_paise > 0 then
      return jsonb_build_object('amount_paise', reg.advance_paise, 'state', 'applied');
    end if;
    if reg.advance_review and not reg.advance_manual then
      return jsonb_build_object('amount_paise', null, 'state', 'review');
    end if;
    if reg.advance_manual or reg.status <> 'pending_payment' then
      return null;
    end if;
    ident := public._adv_identity(reg.id);
  else
    select * into me from public.profiles where id = auth.uid();
    select jsonb_build_object(
             'phones', to_jsonb(array_remove(array[public._adv_phone(pp.phone)], null)),
             'emails', to_jsonb(array_remove(array[public._adv_email(u.email)], null)),
             'name', me.full_name, 'year', me.grad_year, 'branch', me.branch)
      into ident
      from auth.users u left join public.profile_private pp on pp.id = u.id
     where u.id = auth.uid();
  end if;
  select count(*), min(x.amount_paise) into v_n, v_amount
    from public.event_advance_credits x
   where x.event_id = p_event and x.status = 'open' and public._adv_match_id(x, ident) is not null;
  if v_n = 1 then
    return jsonb_build_object('amount_paise', v_amount, 'state', 'expected');
  elsif v_n > 1 then
    return jsonb_build_object('amount_paise', null, 'state', 'review');
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------------ admins
create or replace function public._adv_require(p_event uuid, p_write boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_event_cap(case when p_write then 'payments' else 'finance' end, p_event) then
    raise exception 'Only people who handle payments for this event can do this' using errcode = '42501';
  end if;
end;
$$;

-- The credits with masked contact details and the registration each one went to, plus registrations waiting for a decision.
create or replace function public.admin_advance_credits(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._adv_require(p_event, false);
  return jsonb_build_object(
    'credits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'full_name', c.full_name, 'grad_year', c.grad_year, 'branch', c.branch,
        'phone_masked', case when c.phone is not null then '•••• ' || right(c.phone, 4) end,
        'email_masked', public._mask_email(c.email),
        'amount_paise', c.amount_paise, 'note', c.note, 'source', c.source, 'status', c.status, 'created_at', c.created_at,
        'claimed_at', c.claimed_at, 'claimed_by', c.claimed_by, 'match_reason', c.match_reason, 'void_reason', c.void_reason,
        'registration_id', c.claimed_registration_id, 'registration_code', r.code, 'registration_name', r.full_name)
        order by (c.status = 'open') desc, c.full_name, c.created_at)
      from public.event_advance_credits c left join public.event_registrations r on r.id = c.claimed_registration_id
     where c.event_id = p_event), '[]'::jsonb),
    'review', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'full_name', r.full_name, 'grad_year', r.grad_year, 'branch', r.branch)
                                         order by r.full_name)
      from public.event_registrations r where r.event_id = p_event and r.advance_review and r.status <> 'cancelled'), '[]'::jsonb));
end;
$$;

-- Open credits that match a registration (best first), for "Apply advance".
create or replace function public.admin_advance_candidates(p_registration uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  ident jsonb;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found then raise exception 'Registration not found'; end if;
  perform public._adv_require(reg.event_id, false);
  ident := public._adv_identity(reg.id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'match', m.reason) order by m.rank, m.full_name)
    from (select c.id, c.full_name, public._adv_match_id(c, ident) as reason,
                 case public._adv_match_id(c, ident) when 'phone' then 1 when 'email' then 2 when 'name' then 3 end as rank
            from public.event_advance_credits c where c.event_id = reg.event_id and c.status = 'open') m
   where m.reason is not null), '[]'::jsonb);
end;
$$;

-- Add credits (manual entry or a CSV / Excel import). p_rows: [{full_name, grad_year, branch, phone, email, amount_paise, note}].
-- A row that is already on the list (same phone, same email, or same name + batch + branch when neither has a contact) is
-- skipped, so importing the same file twice is safe. Afterwards unpaid registrations are matched again.
create or replace function public.admin_add_advance_credits(p_event uuid, p_rows jsonb, p_source text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  n int := 0;
  v_added int := 0;
  v_dupes jsonb := '[]'::jsonb;
  v_bad jsonb := '[]'::jsonb;
  v_name text;
  v_year int;
  v_branch text;
  v_phone text;
  v_email text;
  v_amount int;
  v_id uuid;
  v_applied int := 0;
  v_review int := 0;
  r record;
  v_res text;
begin
  perform public._adv_require(p_event, true);
  if not exists (select 1 from public.events where id = p_event) then raise exception 'Event not found'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Add at least one person.';
  end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5000 rows at a time.'; end if;
  perform 1 from public.events where id = p_event for update; -- one import at a time per event (duplicate checks stay true)

  for e in select x from jsonb_array_elements(p_rows) x loop
    n := n + 1;
    if jsonb_typeof(e) <> 'object' then
      v_bad := v_bad || jsonb_build_object('row', n, 'error', 'not valid');
      continue;
    end if;
    v_name := left(btrim(regexp_replace(coalesce(e ->> 'full_name', ''), '\s+', ' ', 'g')), 120);
    v_phone := public._adv_phone(e ->> 'phone');
    v_email := public._adv_email(e ->> 'email');
    v_branch := left(nullif(btrim(coalesce(e ->> 'branch', '')), ''), 120);
    v_year := case when coalesce(e ->> 'grad_year', '') ~ '^(19|20)[0-9]{2}$' then (e ->> 'grad_year')::int end;
    v_amount := case when coalesce(e ->> 'amount_paise', '') ~ '^[0-9]{1,9}$' then (e ->> 'amount_paise')::int end;
    if char_length(v_name) < 2 then
      v_bad := v_bad || jsonb_build_object('row', n, 'error', 'name');
      continue;
    end if;
    if v_amount is null or v_amount < 100 or v_amount > 100000000 then
      v_bad := v_bad || jsonb_build_object('row', n, 'error', 'amount');
      continue;
    end if;
    if v_phone is null and v_email is null and (v_year is null or public._adv_branch(v_branch) = '') then
      v_bad := v_bad || jsonb_build_object('row', n, 'error', 'contact');
      continue;
    end if;
    if exists (select 1 from public.event_advance_credits c
                where c.event_id = p_event and c.status <> 'void'
                  and ((v_phone is not null and c.phone = v_phone)
                    or (v_email is not null and c.email = v_email)
                    or (v_phone is null and v_email is null and c.phone is null and c.email is null
                        and c.grad_year = v_year and public._adv_branch(c.branch) = public._adv_branch(v_branch)
                        and public._adv_name(c.full_name) = public._adv_name(v_name)))) then
      v_dupes := v_dupes || jsonb_build_object('row', n, 'full_name', v_name);
      continue;
    end if;
    insert into public.event_advance_credits (event_id, full_name, grad_year, branch, phone, email, amount_paise, note, source, created_by)
    values (p_event, v_name, v_year, v_branch, v_phone, v_email, v_amount,
            left(nullif(btrim(coalesce(e ->> 'note', '')), ''), 500), left(nullif(btrim(coalesce(p_source, '')), ''), 80), auth.uid())
    returning id into v_id;
    v_added := v_added + 1;
  end loop;

  perform public._audit('add_advance_credits', 'events', p_event,
    jsonb_build_object('event_id', p_event, 'added', v_added, 'duplicates', jsonb_array_length(v_dupes), 'rejected', jsonb_array_length(v_bad),
                       'source', nullif(btrim(coalesce(p_source, '')), '')));

  -- people who registered before the list arrived
  if v_added > 0 then
    for r in select id from public.event_registrations
              where event_id = p_event and status = 'pending_payment' and amount_paise > 0 and advance_paise = 0 and not advance_manual
              order by created_at, id loop
      v_res := public._claim_advance_credit(r.id);
      if v_res = 'applied' then v_applied := v_applied + 1; elsif v_res = 'review' then v_review := v_review + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('added', v_added, 'duplicates', v_dupes, 'rejected', v_bad, 'applied', v_applied, 'review', v_review);
end;
$$;

create or replace function public.admin_void_advance_credit(p_credit uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.event_advance_credits;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into c from public.event_advance_credits where id = p_credit;
  perform public._adv_require(c.event_id, true); -- before telling whether it exists
  if c.id is null then raise exception 'Advance not found'; end if;
  select * into c from public.event_advance_credits where id = p_credit for update;
  if c.status = 'claimed' then raise exception 'This advance is applied to a registration. Remove it from the registration first.'; end if;
  if c.status = 'void' then raise exception 'This advance is already void.'; end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a reason (it is kept in the activity log).'; end if;
  update public.event_advance_credits set status = 'void', void_reason = left(v_reason, 500) where id = c.id;
  perform public._audit('void_advance_credit', 'event_advance_credits', c.id,
    jsonb_build_object('event_id', c.event_id, 'full_name', c.full_name, 'amount', c.amount_paise, 'reason', v_reason));
end;
$$;

-- Manual match: put an open credit on a registration (when automatic matching found none or more than one).
create or replace function public.admin_apply_advance_credit(p_registration uuid, p_credit uuid, p_reason text default null)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  c public.event_advance_credits;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found then raise exception 'Registration not found'; end if;
  perform public._adv_require(reg.event_id, true);
  perform 1 from public.events where id = reg.event_id for update;
  select * into reg from public.event_registrations where id = p_registration for update;
  select * into c from public.event_advance_credits where id = p_credit for update;
  if not found or c.event_id <> reg.event_id then raise exception 'That advance is not on this event''s list.'; end if;
  if c.status <> 'open' then raise exception 'That advance is already used or void.'; end if;
  if reg.status = 'cancelled' then raise exception 'This registration was cancelled'; end if;
  if reg.advance_paise > 0 or exists (select 1 from public.event_advance_credits x where x.claimed_registration_id = reg.id) then
    raise exception 'This registration already has an advance. Remove it first.';
  end if;
  perform public._adv_attach(c.id, reg.id, 'admin', 'admin');
  update public.event_registrations set advance_manual = true, advance_review = false where id = reg.id;
  perform public._audit('apply_advance_credit', 'event_registrations', reg.id,
    jsonb_build_object('event_id', reg.event_id, 'code', reg.code, 'credit_id', c.id, 'credit_name', c.full_name, 'amount', c.amount_paise,
                       'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  select * into reg from public.event_registrations where id = reg.id;
  return reg;
end;
$$;

-- Take a (wrong) advance off a registration: the advance payment goes, the credit is open again for the right person, and
-- this registration is no longer matched automatically. Not possible once part of the advance was refunded.
create or replace function public.admin_remove_advance_credit(p_registration uuid, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  c public.event_advance_credits;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found then raise exception 'Registration not found'; end if;
  perform public._adv_require(reg.event_id, true);
  if char_length(v_reason) < 3 then raise exception 'Please give a reason (it is kept in the activity log).'; end if;
  perform 1 from public.events where id = reg.event_id for update;
  select * into reg from public.event_registrations where id = p_registration for update;
  select * into c from public.event_advance_credits where claimed_registration_id = reg.id for update;
  if not found then raise exception 'This registration has no advance.'; end if;
  if exists (select 1 from public.event_refunds f where f.payment_id = c.payment_id)
     or exists (select 1 from public.event_payments p where p.id = c.payment_id and p.status = 'refunded') then
    raise exception 'Part of this advance was refunded, so it cannot be removed.';
  end if;
  update public.event_advance_credits
     set status = 'open', claimed_registration_id = null, claimed_at = null, claimed_by = null, match_reason = null, payment_id = null
   where id = c.id;
  delete from public.event_payments where id = c.payment_id and method = 'advance';
  update public.event_registrations set advance_manual = true, advance_review = false where id = reg.id;
  perform public._adv_sync(reg.id);
  if reg.status <> 'cancelled' then
    perform public._refresh_registration_status(reg.id);
  end if;
  perform public._audit('remove_advance_credit', 'event_registrations', reg.id,
    jsonb_build_object('event_id', reg.event_id, 'code', reg.code, 'credit_id', c.id, 'credit_name', c.full_name, 'amount', c.amount_paise, 'reason', v_reason));
  select * into reg from public.event_registrations where id = reg.id;
  return reg;
end;
$$;

-- "Not a match": clears the review flag and stops automatic matching for this registration.
create or replace function public.admin_dismiss_advance_review(p_registration uuid)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
begin
  select * into reg from public.event_registrations where id = p_registration;
  if not found then raise exception 'Registration not found'; end if;
  perform public._adv_require(reg.event_id, true);
  update public.event_registrations set advance_review = false, advance_manual = true where id = reg.id returning * into reg;
  perform public._audit('dismiss_advance_review', 'event_registrations', reg.id, jsonb_build_object('event_id', reg.event_id, 'code', reg.code));
  return reg;
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public._adv_phone(text) from anon, authenticated, public;
revoke execute on function public._adv_email(text) from anon, authenticated, public;
revoke execute on function public._adv_name(text) from anon, authenticated, public;
revoke execute on function public._adv_name_fl(text) from anon, authenticated, public;
revoke execute on function public._adv_branch(text) from anon, authenticated, public;
revoke execute on function public._adv_match(public.event_advance_credits, text[], text[], text, int, text) from anon, authenticated, public;
revoke execute on function public._adv_match_id(public.event_advance_credits, jsonb) from anon, authenticated, public;
revoke execute on function public._adv_identity(uuid) from anon, authenticated, public;
revoke execute on function public._adv_sync(uuid) from anon, authenticated, public;
revoke execute on function public._adv_attach(uuid, uuid, text, text) from anon, authenticated, public;
revoke execute on function public._claim_advance_credit(uuid) from anon, authenticated, public;
revoke execute on function public._adv_require(uuid, boolean) from anon, authenticated, public;
revoke execute on function public.my_advance_credit(uuid) from anon, public;
grant execute on function public.my_advance_credit(uuid) to authenticated;
revoke execute on function public.admin_advance_credits(uuid) from anon, public;
grant execute on function public.admin_advance_credits(uuid) to authenticated;
revoke execute on function public.admin_advance_candidates(uuid) from anon, public;
grant execute on function public.admin_advance_candidates(uuid) to authenticated;
revoke execute on function public.admin_add_advance_credits(uuid, jsonb, text) from anon, public;
grant execute on function public.admin_add_advance_credits(uuid, jsonb, text) to authenticated;
revoke execute on function public.admin_void_advance_credit(uuid, text) from anon, public;
grant execute on function public.admin_void_advance_credit(uuid, text) to authenticated;
revoke execute on function public.admin_apply_advance_credit(uuid, uuid, text) from anon, public;
grant execute on function public.admin_apply_advance_credit(uuid, uuid, text) to authenticated;
revoke execute on function public.admin_remove_advance_credit(uuid, text) from anon, public;
grant execute on function public.admin_remove_advance_credit(uuid, text) to authenticated;
revoke execute on function public.admin_dismiss_advance_review(uuid) from anon, public;
grant execute on function public.admin_dismiss_advance_review(uuid) to authenticated;
