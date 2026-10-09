-- Alumni Connect Grand Reunion 2026 (26–27 Dec 2026, batches 2003–2012): the registration replaces the organisers'
-- Google Form. Everything the profile already knows is snapshotted from the profile on the server; the new questions
-- (days, organising teams, help needed, Reunion Fund, sponsorship, performances, memorable extras, feedback) are typed
-- columns validated here; organisers can add their own questions per event (event_questions) without code.
--
-- Money stays in paise. amount_paise = tickets + Reunion Fund contribution (fund_paise), both priced on the server.
-- After a payment is submitted, tickets and the fund are locked; every non-financial answer stays editable.

-- ------------------------------------------------------------------ events and ticket days
alter table public.events add column ask_reunion_questions boolean not null default false;
comment on column public.events.ask_reunion_questions is
  'When true, registration requires the reunion questions (profile snapshot, teams, help, fund, sponsorship, performances).';

-- Which event days (1 = the day starts_at falls on, India time) a ticket covers. null = every day.
-- A family / guest ticket may only be bought with a main ticket that covers all of its days.
alter table public.event_ticket_types add column days smallint[]
  check (days is null or (cardinality(days) between 1 and 14 and 1 <= all (days) and 14 >= all (days)));

-- ------------------------------------------------------------------ registration answers
alter table public.event_registrations
  add column country text check (char_length(country) <= 80),
  add column designation text check (char_length(designation) <= 120),
  add column company text check (char_length(company) <= 120),
  add column past_experience text check (char_length(past_experience) <= 1000),
  add column days smallint[],
  add column day_heads jsonb not null default '{}'::jsonb check (jsonb_typeof(day_heads) = 'object'),
  add column fund_interest boolean,
  add column fund_paise int not null default 0 check (fund_paise = 0 or fund_paise between 10000 and 100000000),
  add column org_team_interest boolean,
  add column org_teams text[] not null default '{}'
    check (org_teams <@ array['core', 'events', 'venue_food', 'transport', 'hospitality', 'media', 'other']),
  add column needs_local_travel boolean not null default false,
  add column sponsor_interest boolean,
  add column sponsor_level text check (sponsor_level in ('main', 'co', 'in_kind', 'not_sure')),
  add column sponsor_org text check (char_length(sponsor_org) <= 120),
  add column sponsor_note text check (char_length(sponsor_note) <= 500),
  add column perform_interest boolean,
  add column perform_types text[] not null default '{}'
    check (perform_types <@ array['singing', 'dancing', 'band', 'talk', 'poetry', 'comedy', 'other']),
  add column perform_group boolean,
  add column perform_members text check (char_length(perform_members) <= 300),
  add column perform_description text check (char_length(perform_description) <= 300),
  add column perform_minutes int check (perform_minutes between 1 and 30),
  add column feedback text check (char_length(feedback) <= 2000),
  add column nickname text check (char_length(nickname) <= 40),
  add column hostel text check (char_length(hostel) <= 80),
  add column faculty_wish text check (char_length(faculty_wish) <= 500),
  add column song_requests text[] not null default '{}' check (cardinality(song_requests) <= 3),
  add column memory text check (char_length(memory) <= 1000),
  add column memory_wall_consent boolean not null default false,
  add column arrival_from text check (char_length(arrival_from) <= 80),
  add column arrival_date date,
  add column arrival_mode text check (arrival_mode in ('train', 'flight', 'road', 'local')),
  add column emergency_name text check (char_length(emergency_name) <= 80),
  add column emergency_phone text check (emergency_phone ~ '^\+?[0-9 ]{8,16}$'),
  add column medical_notes text check (char_length(medical_notes) <= 300),
  add column custom_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_answers) = 'object');

-- "No meal / fasting" is a food choice too (for the member and for each guest).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.event_registrations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%food_pref%'
  loop
    execute format('alter table public.event_registrations drop constraint %I', c);
  end loop;
end $$;
alter table public.event_registrations add constraint event_registrations_food_pref_check
  check (food_pref in ('veg', 'non_veg', 'jain', 'none'));

-- ------------------------------------------------------------------ organisers' own questions
create table public.event_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('yes_no', 'single', 'multi', 'short_text', 'long_text')),
  label text not null check (char_length(btrim(label)) between 3 and 200),
  help text check (char_length(help) <= 300),
  options text[] not null default '{}' check (cardinality(options) <= 20),
  required boolean not null default false,
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- choice questions need at least two options; the others take none
  check ((kind in ('single', 'multi')) = (cardinality(options) >= 2))
);
create index event_questions_event_idx on public.event_questions (event_id, sort);
create trigger event_questions_touch before update on public.event_questions
  for each row execute function public.touch_updated_at();
create trigger event_questions_audit after insert or update or delete on public.event_questions
  for each row execute function public._audit_config_change();

-- options: 1–80 characters each, no duplicates
create or replace function public._question_options_ok()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.options := coalesce((select array_agg(btrim(o) order by n) from unnest(new.options) with ordinality u(o, n)), '{}');
  if exists (select 1 from unnest(new.options) o where char_length(o) not between 1 and 80) then
    raise exception 'Each option must be 1 to 80 characters';
  end if;
  if (select count(distinct lower(o)) from unnest(new.options) o) <> cardinality(new.options) then
    raise exception 'Options must be different from each other';
  end if;
  new.label := btrim(new.label);
  new.help := nullif(btrim(new.help), '');
  return new;
end;
$$;
create trigger event_questions_options before insert or update on public.event_questions
  for each row execute function public._question_options_ok();

alter table public.event_questions enable row level security;
create policy "questions of published events are public" on public.event_questions
  for select using (exists (select 1 from public.events e where e.id = event_id and e.is_published) or public.is_event_staff(event_id));
create policy "managers manage questions" on public.event_questions
  for all to authenticated using (public.is_event_manager(event_id)) with check (public.is_event_manager(event_id));
grant select on public.event_questions to anon, authenticated;
grant insert, update, delete on public.event_questions to authenticated;

-- ------------------------------------------------------------------ helpers
-- Number of event days (India time), at least 1 and at most 14; ticket days count too.
create or replace function public._event_day_count(p_event uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select least(14, greatest(1,
           coalesce((e.ends_at at time zone 'Asia/Kolkata')::date - (e.starts_at at time zone 'Asia/Kolkata')::date + 1, 1),
           coalesce((select max(d) from public.event_ticket_types t, unnest(t.days) d where t.event_id = e.id), 1)))
    from public.events e where e.id = p_event;
$$;

-- "27 Dec" for day 2 of an event starting 26 Dec.
create or replace function public._event_day_label(p_event uuid, p_day int)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(to_char((e.starts_at at time zone 'Asia/Kolkata')::date + (p_day - 1), 'FMDD Mon'), 'day ' || p_day)
    from public.events e where e.id = p_event;
$$;

create or replace function public._jsonb_smallints(j jsonb)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'array' then array(select x::smallint from jsonb_array_elements_text(j) x) end;
$$;

-- Prices a ticket selection on the server. p_items: [{ticket_type_id, quantity}]. Returns
-- {lines: [{id,label,price,qty,max,primary,days}], total, heads, days (main ticket's days, null = all), day_heads: {"1": n, ...}}.
-- Enforces: known tickets, max per registration, exactly one main ticket, guest tickets only on days the main ticket covers.
create or replace function public._price_items(p_event uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_bad jsonb;
  total int;
  heads int;
  primaries int;
  v_primary_days smallint[];
  v_line jsonb;
  v_days smallint[];
  v_day_heads jsonb := '{}'::jsonb;
  n_days int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object'
                   or coalesce(e ->> 'ticket_type_id', '') !~* '^[0-9a-f-]{36}$'
                   or coalesce(e ->> 'quantity', '0') !~ '^-?[0-9]{1,4}$') then
    raise exception 'Ticket selection is not valid';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by lower(e ->> 'ticket_type_id') having count(*) > 1) then
    raise exception 'Ticket selection is not valid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'label', coalesce(t.label, ''), 'price', t.price_paise, 'qty', r.q,
           'max', t.max_per_registration, 'primary', t.is_primary, 'days', to_jsonb(t.days)) order by t.sort), '[]'::jsonb)
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
    if (v_bad ->> 'qty')::int < 0 then
      raise exception 'Ticket selection is not valid';
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

  select public._jsonb_smallints(l -> 'days') into v_primary_days
    from jsonb_array_elements(v_lines) l where (l ->> 'primary')::boolean;
  if v_primary_days is not null then
    for v_line in select l from jsonb_array_elements(v_lines) l where not (l ->> 'primary')::boolean loop
      v_days := public._jsonb_smallints(v_line -> 'days');
      if v_days is not null and not (v_days <@ v_primary_days) then
        raise exception '"%" is only for %. Please choose days that include %, or remove it.',
          v_line ->> 'label',
          (select string_agg(public._event_day_label(p_event, d), ' & ' order by d) from unnest(v_days) d),
          (select string_agg(public._event_day_label(p_event, d), ' & ' order by d) from unnest(v_days) d where not d = any (v_primary_days));
      end if;
    end loop;
  end if;

  n_days := public._event_day_count(p_event);
  select coalesce(jsonb_object_agg(d::text, (
           select coalesce(sum((l ->> 'qty')::int), 0) from jsonb_array_elements(v_lines) l
            where jsonb_typeof(l -> 'days') <> 'array' or (l -> 'days') @> to_jsonb(d))), '{}'::jsonb)
    into v_day_heads
    from generate_series(1, n_days) d;

  return jsonb_build_object('lines', v_lines, 'total', total, 'heads', heads, 'days', to_jsonb(v_primary_days), 'day_heads', v_day_heads);
end;
$$;

-- Small readers for the answers below: they raise a member-friendly message on bad input.
create or replace function public._ans_text(p jsonb, k text, maxlen int, what text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text;
begin
  if p is null or not p ? k or jsonb_typeof(p -> k) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> k) not in ('string', 'number') then
    raise exception '% is not valid', what;
  end if;
  v := nullif(btrim(p ->> k), '');
  if char_length(v) > maxlen then
    raise exception '% can be at most % characters', what, maxlen;
  end if;
  return v;
end;
$$;

create or replace function public._ans_bool(p jsonb, k text, what text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or not p ? k or jsonb_typeof(p -> k) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> k) <> 'boolean' then
    raise exception 'Please answer "%" with yes or no', what;
  end if;
  return (p ->> k)::boolean;
end;
$$;

create or replace function public._ans_list(p jsonb, k text, what text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or not p ? k or jsonb_typeof(p -> k) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p -> k) <> 'array' or exists (select 1 from jsonb_array_elements(p -> k) e where jsonb_typeof(e) <> 'string') then
    raise exception '% is not valid', what;
  end if;
  -- trimmed, blanks dropped, duplicates removed, order kept
  return coalesce((select array_agg(v order by n)
                     from (select distinct on (lower(btrim(x))) btrim(x) as v, n
                             from jsonb_array_elements_text(p -> k) with ordinality e(x, n)
                            where btrim(x) <> '' order by lower(btrim(x)), n) s), '{}');
end;
$$;

create or replace function public._ans_int(p jsonb, k text, what text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or not p ? k or jsonb_typeof(p -> k) = 'null' or p ->> k = '' then
    return null;
  end if;
  if (p ->> k) !~ '^-?[0-9]{1,10}$' then
    raise exception '% is not valid', what;
  end if;
  return (p ->> k)::bigint::int;
exception when numeric_value_out_of_range then
  raise exception '% is not valid', what;
end;
$$;

-- Validates and normalises every non-ticket answer of a registration. p_strict = the event asks the reunion questions
-- (then the yes/no questions, food and T-shirt must be answered). Returns the clean values keyed by column name.
create or replace function public._clean_answers(p_event uuid, p jsonb, p_strict boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  out jsonb := '{}'::jsonb;
  b boolean;
  lst text[];
  n int;
  t text;
  d date;
  v_guests jsonb := coalesce(p -> 'guests', '[]'::jsonb);
  foods constant text[] := array['veg', 'non_veg', 'jain', 'none'];
begin
  select * into ev from public.events where id = p_event;

  -- food, T-shirt, guests (each guest may have a food choice, for exact catering counts)
  t := nullif(p ->> 'food_pref', '');
  if t is not null and not t = any (foods) then
    raise exception 'Please choose a food preference';
  end if;
  if p_strict and t is null then
    raise exception 'Please choose a food preference';
  end if;
  out := out || jsonb_build_object('food_pref', t);
  t := nullif(p ->> 'tshirt_size', '');
  if t is not null and not t = any (array['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']) then
    raise exception 'Please choose your T-shirt size';
  end if;
  if p_strict and t is null then
    raise exception 'Please choose your T-shirt size';
  end if;
  out := out || jsonb_build_object('tshirt_size', t);

  if jsonb_typeof(v_guests) <> 'array' or jsonb_array_length(v_guests) > 15
     or exists (select 1 from jsonb_array_elements(v_guests) g
                 where jsonb_typeof(g) <> 'object'
                    or (g ? 'name' and jsonb_typeof(g -> 'name') not in ('string', 'null'))
                    or char_length(g ->> 'name') > 80
                    or char_length(g ->> 'relation') > 80
                    or (nullif(g ->> 'food', '') is not null and not (g ->> 'food') = any (foods))) then
    raise exception 'Guest list is not valid';
  end if;
  out := out || jsonb_build_object('guests', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'name', coalesce(btrim(g ->> 'name'), ''),
             'relation', nullif(btrim(g ->> 'relation'), ''),
             'ticket_type_id', case when coalesce(g ->> 'ticket_type_id', '') ~* '^[0-9a-f-]{36}$' then g ->> 'ticket_type_id' end,
             'food', nullif(g ->> 'food', ''))) order by gn)
      from jsonb_array_elements(v_guests) with ordinality x(g, gn)), '[]'::jsonb));

  -- help needed (we share vendor details and deal prices; the member pays)
  b := public._ans_bool(p, 'needs_accommodation', 'Help with accommodation');
  if p_strict and b is null then
    raise exception 'Please tell us if you need help with accommodation';
  end if;
  out := out || jsonb_build_object('needs_accommodation', coalesce(b, false));
  b := public._ans_bool(p, 'needs_local_travel', 'Help with local travel');
  if p_strict and b is null then
    raise exception 'Please tell us if you need help with local travel or pickup';
  end if;
  out := out || jsonb_build_object('needs_local_travel', coalesce(b, false));

  -- organising teams
  b := public._ans_bool(p, 'org_team_interest', 'Organising team');
  if p_strict and b is null then
    raise exception 'Please tell us if you would like to join an organising team';
  end if;
  lst := public._ans_list(p, 'org_teams', 'Organising teams');
  if b then
    if cardinality(lst) = 0 then
      raise exception 'Please choose at least one organising team';
    end if;
    if not lst <@ array['core', 'events', 'venue_food', 'transport', 'hospitality', 'media', 'other'] then
      raise exception 'Please choose organising teams from the list';
    end if;
  else
    lst := '{}';
  end if;
  out := out || jsonb_build_object('org_team_interest', b, 'org_teams', to_jsonb(lst));

  -- Reunion Fund (₹100 – ₹10,00,000)
  b := public._ans_bool(p, 'fund_interest', 'Reunion Fund');
  if p_strict and b is null then
    raise exception 'Please tell us if you would like to contribute to the Reunion Fund';
  end if;
  n := public._ans_int(p, 'fund_paise', 'Reunion Fund amount');
  if b then
    if n is null or n < 10000 or n > 100000000 then
      raise exception 'Please choose a Reunion Fund amount between ₹100 and ₹10,00,000';
    end if;
    if n % 100 <> 0 then
      raise exception 'Please give the Reunion Fund amount in whole rupees';
    end if;
  else
    n := 0;
  end if;
  out := out || jsonb_build_object('fund_interest', b, 'fund_paise', n);

  -- sponsorship
  b := public._ans_bool(p, 'sponsor_interest', 'Sponsorship');
  if p_strict and b is null then
    raise exception 'Please tell us if you or your organisation would like to sponsor';
  end if;
  if b then
    t := nullif(p ->> 'sponsor_level', '');
    if t is null or not t = any (array['main', 'co', 'in_kind', 'not_sure']) then
      raise exception 'Please choose a sponsorship level';
    end if;
    if public._ans_text(p, 'sponsor_org', 120, 'Organisation name') is null then
      raise exception 'Please enter the organisation name (or your own name if sponsoring personally)';
    end if;
    out := out || jsonb_build_object('sponsor_interest', true, 'sponsor_level', t,
                                     'sponsor_org', public._ans_text(p, 'sponsor_org', 120, 'Organisation name'),
                                     'sponsor_note', public._ans_text(p, 'sponsor_note', 500, 'Sponsorship note'));
  else
    out := out || jsonb_build_object('sponsor_interest', b, 'sponsor_level', null, 'sponsor_org', null, 'sponsor_note', null);
  end if;

  -- performances
  b := public._ans_bool(p, 'perform_interest', 'Performances');
  if p_strict and b is null then
    raise exception 'Please tell us if you would like to perform at the reunion';
  end if;
  if b then
    lst := public._ans_list(p, 'perform_types', 'Performance type');
    if cardinality(lst) = 0 then
      raise exception 'Please choose what you would like to perform';
    end if;
    if not lst <@ array['singing', 'dancing', 'band', 'talk', 'poetry', 'comedy', 'other'] then
      raise exception 'Please choose the performance type from the list';
    end if;
    if public._ans_bool(p, 'perform_group', 'Solo or group') is null then
      raise exception 'Please tell us if it is a solo or a group performance';
    end if;
    n := public._ans_int(p, 'perform_minutes', 'Time needed');
    if n is null or n not between 1 and 30 then
      raise exception 'Please give the time you need in minutes (1 to 30)';
    end if;
    out := out || jsonb_build_object('perform_interest', true, 'perform_types', to_jsonb(lst),
      'perform_group', public._ans_bool(p, 'perform_group', 'Solo or group'),
      'perform_members', case when public._ans_bool(p, 'perform_group', 'Solo or group')
                              then public._ans_text(p, 'perform_members', 300, 'Group members') end,
      'perform_description', public._ans_text(p, 'perform_description', 300, 'Performance description'),
      'perform_minutes', n);
  else
    out := out || jsonb_build_object('perform_interest', b, 'perform_types', '[]'::jsonb, 'perform_group', null,
                                     'perform_members', null, 'perform_description', null, 'perform_minutes', null);
  end if;

  -- make it memorable (all optional)
  lst := public._ans_list(p, 'song_requests', 'Song requests');
  if cardinality(lst) > 3 then
    raise exception 'You can request up to 3 songs';
  end if;
  if exists (select 1 from unnest(lst) s where char_length(s) > 100) then
    raise exception 'Each song request can be at most 100 characters';
  end if;
  out := out || jsonb_build_object(
    'feedback', public._ans_text(p, 'feedback', 2000, 'Feedback'),
    'nickname', public._ans_text(p, 'nickname', 40, 'Badge name'),
    'hostel', public._ans_text(p, 'hostel', 80, 'Hostel'),
    'faculty_wish', public._ans_text(p, 'faculty_wish', 500, 'Faculty you would like to meet'),
    'song_requests', to_jsonb(lst),
    'memory', public._ans_text(p, 'memory', 1000, 'Memory or shout-out'),
    'memory_wall_consent', coalesce(public._ans_bool(p, 'memory_wall_consent', 'Memory wall'), false)
                           and public._ans_text(p, 'memory', 1000, 'Memory or shout-out') is not null,
    'arrival_note', public._ans_text(p, 'arrival_note', 300, 'Arrival plan'),
    'arrival_from', public._ans_text(p, 'arrival_from', 80, 'Arriving from'),
    'medical_notes', public._ans_text(p, 'medical_notes', 300, 'Accessibility or medical needs'));

  t := nullif(btrim(p ->> 'arrival_mode'), '');
  if t is not null and not t = any (array['train', 'flight', 'road', 'local']) then
    raise exception 'Please choose how you are arriving from the list';
  end if;
  out := out || jsonb_build_object('arrival_mode', t);
  t := nullif(btrim(p ->> 'arrival_date'), '');
  d := null;
  if t is not null then
    begin
      d := t::date;
    exception when others then
      raise exception 'Please check your arrival date';
    end;
    if ev.starts_at is not null and (d < (ev.starts_at at time zone 'Asia/Kolkata')::date - 60
                                     or d > (coalesce(ev.ends_at, ev.starts_at) at time zone 'Asia/Kolkata')::date + 1) then
      raise exception 'Please check your arrival date (it should be close to the event dates)';
    end if;
  end if;
  out := out || jsonb_build_object('arrival_date', d);

  -- emergency contact: both or neither
  t := public._ans_text(p, 'emergency_phone', 20, 'Emergency contact number');
  if t is not null and t !~ '^\+?[0-9 ]{8,16}$' then
    raise exception 'Please enter a valid emergency contact number';
  end if;
  if (t is null) <> (public._ans_text(p, 'emergency_name', 80, 'Emergency contact name') is null) then
    raise exception 'Please add both the name and the number of your emergency contact';
  end if;
  out := out || jsonb_build_object('emergency_phone', t, 'emergency_name', public._ans_text(p, 'emergency_name', 80, 'Emergency contact name'));

  return out;
end;
$$;

-- Validates answers to the organisers' own questions. Answers to questions that are switched off are kept as they were.
create or replace function public._clean_custom_answers(p_event uuid, p_answers jsonb, p_previous jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.event_questions;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v jsonb;
  out jsonb := '{}'::jsonb;
  k text;
  maxlen int;
begin
  if jsonb_typeof(a) <> 'object' then
    raise exception 'Answers are not valid';
  end if;
  for k in select jsonb_object_keys(a) loop
    if k !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.event_questions x where x.id = k::uuid and x.event_id = p_event) then
      raise exception 'Unknown question';
    end if;
  end loop;
  for q in select * from public.event_questions where event_id = p_event order by sort, created_at loop
    if not q.is_active then
      if p_previous ? q.id::text then
        out := out || jsonb_build_object(q.id::text, p_previous -> q.id::text);
      end if;
      continue;
    end if;
    v := a -> q.id::text;
    if v is not null and (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
                          or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)) then
      v := null;
    end if;
    if v is null then
      if q.required then
        raise exception 'Please answer: %', q.label;
      end if;
      continue;
    end if;
    case q.kind
      when 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Please answer "%" with yes or no', q.label;
        end if;
      when 'single' then
        if jsonb_typeof(v) <> 'string' or not (v #>> '{}') = any (q.options) then
          raise exception 'Please choose one of the options for: %', q.label;
        end if;
      when 'multi' then
        if jsonb_typeof(v) <> 'array'
           or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or not (e #>> '{}') = any (q.options)) then
          raise exception 'Please choose from the options for: %', q.label;
        end if;
        v := (select jsonb_agg(to_jsonb(o) order by i) from unnest(q.options) with ordinality u(o, i) where v ? o);
      else
        if jsonb_typeof(v) <> 'string' then
          raise exception 'Answer for "%" is not valid', q.label;
        end if;
        v := to_jsonb(btrim(v #>> '{}'));
        maxlen := 2000;
        if q.kind = 'short_text' then
          maxlen := 200;
        end if;
        if char_length(v #>> '{}') > maxlen then
          raise exception 'Answer for "%" can be at most % characters', q.label, maxlen;
        end if;
    end case;
    out := out || jsonb_build_object(q.id::text, v);
  end loop;
  return out;
end;
$$;

-- "Senior Engineer at Infosys (2008–2015); Engineer at TCS (2004–2008)": earlier jobs from the profile (LinkedIn import or manual).
create or replace function public._past_experience_text(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(string_agg(x.title || ' at ' || x.company
                         || coalesce(' (' || nullif(concat_ws('–', extract(year from x.start_date)::int, extract(year from x.end_date)::int), '') || ')', ''),
                         '; ' order by x.start_date desc nulls last, x.created_at desc), 1000)
    from public.experiences x
   where x.profile_id = p_user and not x.is_current;
$$;

-- ------------------------------------------------------------------ member: register / update
create or replace function public.upsert_registration(p_event uuid, p_details jsonb, p_items jsonb)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  reg public.event_registrations;
  me public.profiles;
  v_price jsonb;
  c jsonb;
  v_custom jsonb;
  total int;
  heads int;
  v_fund int;
  v_locked boolean;
  v_year int;
  v_phone text;
  v_email text;
  v_branch text;
  v_city text;
  v_country text;
  v_designation text;
  v_company text;
  v_guests jsonb;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event and is_published;
  if not found then
    raise exception 'This event is not open for registration';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Registration details are not valid';
  end if;
  select * into me from public.profiles where id = auth.uid();

  -- Snapshot from the profile: what the member's profile says at the moment of registering.
  v_phone := coalesce(nullif(btrim(p_details ->> 'phone'), ''), (select pp.phone from public.profile_private pp where pp.id = auth.uid()));
  v_email := coalesce(nullif(btrim(p_details ->> 'email'), ''), (select u.email from auth.users u where u.id = auth.uid()));
  v_branch := coalesce(nullif(p_details ->> 'branch', ''), me.branch);
  v_city := coalesce(nullif(btrim(p_details ->> 'city'), ''), me.city);
  v_country := nullif(btrim(me.country), '');
  v_designation := coalesce(nullif(btrim(me.current_title), ''),
                            (select x.title from public.experiences x where x.profile_id = auth.uid() and x.is_current order by x.start_date desc nulls last limit 1));
  v_company := coalesce(nullif(btrim(me.current_company), ''),
                        (select x.company from public.experiences x where x.profile_id = auth.uid() and x.is_current order by x.start_date desc nulls last limit 1));
  begin
    v_year := coalesce(nullif(p_details ->> 'grad_year', '')::int, me.grad_year);
  exception when invalid_text_representation then
    raise exception 'Please check your passing-out year';
  end;

  if coalesce(btrim(p_details ->> 'full_name'), '') = '' then
    raise exception 'Please enter your full name';
  end if;
  if coalesce(v_phone, '') !~ '^\+?[0-9 ]{10,16}$' then
    raise exception 'Please enter a valid mobile number';
  end if;
  if coalesce((p_details ->> 'accept_terms')::boolean, false) is not true then
    raise exception 'Please accept the terms to register';
  end if;
  if v_year is not null and (v_year < 1947 or v_year > 2100) then
    raise exception 'Please check your passing-out year';
  end if;
  if ev.ask_reunion_questions then
    if v_year is null then raise exception 'Please add your JEC graduation year to your profile'; end if;
    if v_branch is null then raise exception 'Please add your branch to your profile'; end if;
    if v_city is null or v_country is null then raise exception 'Please add your current city and country to your profile'; end if;
    if v_designation is null or v_company is null then raise exception 'Please add your current designation and company to your profile'; end if;
  end if;

  c := public._clean_answers(p_event, p_details, ev.ask_reunion_questions);
  v_guests := c -> 'guests';
  v_fund := (c ->> 'fund_paise')::int;

  -- Price everything on the server from the ticket table; the client only sends ids and quantities.
  v_price := public._price_items(p_event, p_items);
  total := (v_price ->> 'total')::int;
  heads := (v_price ->> 'heads')::int;
  -- the guest list can't name more people than the extra tickets paid for
  if jsonb_array_length(v_guests) > heads - 1 then
    raise exception 'The guest list has more names than the tickets you selected';
  end if;

  -- Lock order everywhere: event row, then registration row.
  perform 1 from public.events where id = p_event for update;
  select * into reg from public.event_registrations where event_id = p_event and user_id = auth.uid() for update;
  v_locked := reg.id is not null and reg.status in ('under_review', 'confirmed');
  v_custom := public._clean_custom_answers(p_event, p_details -> 'custom_answers', coalesce(reg.custom_answers, '{}'::jsonb));

  if not v_locked and ev.registration_closes_at is not null and now() > ev.registration_closes_at then
    raise exception 'Registration for this event has closed';
  end if;

  if v_locked then
    -- After payment, the ticket mix and the Reunion Fund amount are fixed: compare the exact (ticket, quantity) sets.
    if exists (
      (select (l ->> 'id')::uuid, (l ->> 'qty')::int from jsonb_array_elements(v_price -> 'lines') l
       except select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id)
      union all
      (select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id
       except select (l ->> 'id')::uuid, (l ->> 'qty')::int from jsonb_array_elements(v_price -> 'lines') l)
    ) then
      raise exception 'Your payment is already submitted, so tickets can no longer be changed. Please contact the organisers.';
    end if;
    if v_fund <> reg.fund_paise then
      raise exception 'Your payment is already submitted, so the Reunion Fund amount can no longer be changed. Please contact the organisers.';
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
               when total + v_fund = 0 then 'confirmed'::public.registration_status
               else 'pending_payment'::public.registration_status
             end,
    -- the attendee's name is fixed once paid, so tickets can't be passed on
    full_name = case when v_locked then full_name else left(btrim(p_details ->> 'full_name'), 120) end,
    email = left(v_email, 120),
    phone = btrim(v_phone),
    branch = left(v_branch, 80),
    grad_year = v_year,
    city = left(v_city, 80),
    country = left(v_country, 80),
    designation = left(v_designation, 120),
    company = left(v_company, 120),
    past_experience = public._past_experience_text(auth.uid()),
    tshirt_size = c ->> 'tshirt_size',
    food_pref = c ->> 'food_pref',
    needs_accommodation = (c ->> 'needs_accommodation')::boolean,
    needs_local_travel = (c ->> 'needs_local_travel')::boolean,
    arrival_note = c ->> 'arrival_note',
    guests = v_guests,
    notes = left(nullif(btrim(p_details ->> 'notes'), ''), 1000),
    terms_accepted_at = coalesce(terms_accepted_at, now()),
    photo_consent = coalesce((p_details ->> 'photo_consent')::boolean, true),
    days = case when v_locked then days else public._jsonb_smallints(v_price -> 'days') end,
    day_heads = case when v_locked then day_heads else v_price -> 'day_heads' end,
    headcount = case when v_locked then headcount else heads end,
    fund_interest = case when v_locked then fund_interest else (c ->> 'fund_interest')::boolean end,
    fund_paise = v_fund,
    amount_paise = case when v_locked then amount_paise else total + v_fund end,
    org_team_interest = (c ->> 'org_team_interest')::boolean,
    org_teams = array(select jsonb_array_elements_text(c -> 'org_teams')),
    sponsor_interest = (c ->> 'sponsor_interest')::boolean,
    sponsor_level = c ->> 'sponsor_level',
    sponsor_org = c ->> 'sponsor_org',
    sponsor_note = c ->> 'sponsor_note',
    perform_interest = (c ->> 'perform_interest')::boolean,
    perform_types = array(select jsonb_array_elements_text(c -> 'perform_types')),
    perform_group = (c ->> 'perform_group')::boolean,
    perform_members = c ->> 'perform_members',
    perform_description = c ->> 'perform_description',
    perform_minutes = (c ->> 'perform_minutes')::int,
    feedback = c ->> 'feedback',
    nickname = c ->> 'nickname',
    hostel = c ->> 'hostel',
    faculty_wish = c ->> 'faculty_wish',
    song_requests = array(select jsonb_array_elements_text(c -> 'song_requests')),
    memory = c ->> 'memory',
    memory_wall_consent = (c ->> 'memory_wall_consent')::boolean,
    arrival_from = c ->> 'arrival_from',
    arrival_date = (c ->> 'arrival_date')::date,
    arrival_mode = c ->> 'arrival_mode',
    emergency_name = c ->> 'emergency_name',
    emergency_phone = c ->> 'emergency_phone',
    medical_notes = c ->> 'medical_notes',
    custom_answers = v_custom
  where id = reg.id
  returning * into reg;

  if not v_locked then
    delete from public.event_registration_items where registration_id = reg.id;
    insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity)
      select reg.id, (l ->> 'id')::uuid, l ->> 'label', (l ->> 'price')::int, (l ->> 'qty')::int
        from jsonb_array_elements(v_price -> 'lines') l;
    -- a registration that is re-activated after cancellation may already be paid for (money still held): settle it
    perform public._refresh_registration_status(reg.id);
    select * into reg from public.event_registrations where id = reg.id;
  end if;

  return reg;
end;
$$;

-- ------------------------------------------------------------------ managers: edit on a member's behalf
-- As before, plus the Reunion Fund (fund_paise: 0, or ₹100 – ₹10,00,000) and the reunion answers. Tickets follow the
-- same day rules as members' own changes. amount = tickets + fund; the status follows the money.
create or replace function public.admin_update_registration(p_registration uuid, p_details jsonb, p_items jsonb, p_reason text)
returns public.event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.event_registrations;
  before public.event_registrations;
  v_price jsonb;
  c jsonb;
  v_fund int;
  v_tickets int;
  heads int;
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
  v_tickets := before.amount_paise - before.fund_paise;
  heads := before.headcount;

  if p_items is not null then
    v_price := public._price_items(reg.event_id, p_items);
    v_tickets := (v_price ->> 'total')::int;
    heads := (v_price ->> 'heads')::int;
    if before.status in ('under_review', 'confirmed') and heads > before.headcount then
      perform public._assert_capacity(reg.event_id, reg.id, heads);
    end if;
    delete from public.event_registration_items where registration_id = reg.id;
    insert into public.event_registration_items (registration_id, ticket_type_id, label, unit_price_paise, quantity)
      select reg.id, (l ->> 'id')::uuid, l ->> 'label', (l ->> 'price')::int, (l ->> 'qty')::int from jsonb_array_elements(v_price -> 'lines') l;
    update public.event_registrations
       set headcount = heads, days = public._jsonb_smallints(v_price -> 'days'), day_heads = v_price -> 'day_heads'
     where id = reg.id;
  end if;

  v_fund := before.fund_paise;
  if p_details is not null then
    if jsonb_typeof(p_details) <> 'object' then
      raise exception 'Registration details are not valid';
    end if;
    if p_details ? 'phone' and coalesce(p_details ->> 'phone', '') !~ '^\+?[0-9 ]{10,16}$' then
      raise exception 'Please enter a valid mobile number';
    end if;
    if p_details ? 'fund_paise' then
      v_fund := public._ans_int(p_details, 'fund_paise', 'Reunion Fund amount');
      if v_fund is null or (v_fund <> 0 and (v_fund < 10000 or v_fund > 100000000 or v_fund % 100 <> 0)) then
        raise exception 'Reunion Fund amount must be ₹0, or whole rupees between ₹100 and ₹10,00,000';
      end if;
    end if;
    -- validate the answers that were sent (missing ones are left alone)
    c := public._clean_answers(reg.event_id, p_details, false);
    update public.event_registrations r set
      full_name = case when p_details ? 'full_name' and btrim(p_details ->> 'full_name') <> '' then left(btrim(p_details ->> 'full_name'), 120) else r.full_name end,
      phone = case when p_details ? 'phone' then btrim(p_details ->> 'phone') else r.phone end,
      email = case when p_details ? 'email' then nullif(btrim(p_details ->> 'email'), '') else r.email end,
      tshirt_size = case when p_details ? 'tshirt_size' then c ->> 'tshirt_size' else r.tshirt_size end,
      food_pref = case when p_details ? 'food_pref' then c ->> 'food_pref' else r.food_pref end,
      needs_accommodation = case when p_details ? 'needs_accommodation' then (c ->> 'needs_accommodation')::boolean else r.needs_accommodation end,
      needs_local_travel = case when p_details ? 'needs_local_travel' then (c ->> 'needs_local_travel')::boolean else r.needs_local_travel end,
      guests = case when p_details ? 'guests' then c -> 'guests' else r.guests end,
      notes = case when p_details ? 'notes' then nullif(btrim(p_details ->> 'notes'), '') else r.notes end,
      admin_note = case when p_details ? 'admin_note' then nullif(btrim(p_details ->> 'admin_note'), '') else r.admin_note end,
      feedback = case when p_details ? 'feedback' then c ->> 'feedback' else r.feedback end,
      org_team_interest = case when p_details ? 'org_team_interest' then (c ->> 'org_team_interest')::boolean else r.org_team_interest end,
      org_teams = case when p_details ? 'org_team_interest' then array(select jsonb_array_elements_text(c -> 'org_teams')) else r.org_teams end,
      sponsor_interest = case when p_details ? 'sponsor_interest' then (c ->> 'sponsor_interest')::boolean else r.sponsor_interest end,
      sponsor_level = case when p_details ? 'sponsor_interest' then c ->> 'sponsor_level' else r.sponsor_level end,
      sponsor_org = case when p_details ? 'sponsor_interest' then c ->> 'sponsor_org' else r.sponsor_org end,
      sponsor_note = case when p_details ? 'sponsor_interest' then c ->> 'sponsor_note' else r.sponsor_note end,
      emergency_name = case when p_details ? 'emergency_name' or p_details ? 'emergency_phone' then c ->> 'emergency_name' else r.emergency_name end,
      emergency_phone = case when p_details ? 'emergency_name' or p_details ? 'emergency_phone' then c ->> 'emergency_phone' else r.emergency_phone end,
      medical_notes = case when p_details ? 'medical_notes' then c ->> 'medical_notes' else r.medical_notes end,
      fund_paise = v_fund,
      fund_interest = case when p_details ? 'fund_paise' then v_fund > 0 else r.fund_interest end
    where r.id = reg.id;
  end if;

  update public.event_registrations set amount_paise = v_tickets + v_fund where id = reg.id;

  -- status follows the money (cancelled stays cancelled; use admin_set_registration_status to reopen)
  if before.status <> 'cancelled' then
    perform public._refresh_registration_status(reg.id);
  end if;
  select * into reg from public.event_registrations where id = p_registration;
  perform public._audit('update_registration', 'event_registrations', reg.id,
    jsonb_build_object('reason', p_reason, 'code', reg.code,
                       'amount', jsonb_build_object('from', before.amount_paise, 'to', reg.amount_paise),
                       'fund', jsonb_build_object('from', before.fund_paise, 'to', reg.fund_paise),
                       'headcount', jsonb_build_object('from', before.headcount, 'to', reg.headcount),
                       'status', jsonb_build_object('from', before.status, 'to', reg.status),
                       'details', p_details));
  return reg;
end;
$$;

-- ------------------------------------------------------------------ check-in volunteers see less
-- Volunteers (event_attendees(), check_in()) never see contact details, money, sponsorship, feedback, emergency contact,
-- medical needs, memories or the organisers' own questions. Managers get the full row.
create or replace function public._sanitized_registration(r public.event_registrations)
returns public.event_registrations
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_event_manager(r.event_id) then r
              else jsonb_populate_record(r, jsonb_build_object(
                'phone', '', 'email', null, 'notes', null, 'admin_note', null, 'amount_paise', 0,
                'fund_interest', null, 'fund_paise', 0,
                'sponsor_interest', null, 'sponsor_level', null, 'sponsor_org', null, 'sponsor_note', null,
                'feedback', null, 'memory', null, 'memory_wall_consent', false,
                'emergency_name', null, 'emergency_phone', null, 'medical_notes', null,
                'custom_answers', '{}'::jsonb)) end;
$$;

-- ------------------------------------------------------------------ grants for the new functions
revoke execute on function public._event_day_count(uuid) from anon, authenticated, public;
revoke execute on function public._event_day_label(uuid, int) from anon, authenticated, public;
revoke execute on function public._jsonb_smallints(jsonb) from anon, authenticated, public;
revoke execute on function public._price_items(uuid, jsonb) from anon, authenticated, public;
revoke execute on function public._ans_text(jsonb, text, int, text) from anon, authenticated, public;
revoke execute on function public._ans_bool(jsonb, text, text) from anon, authenticated, public;
revoke execute on function public._ans_list(jsonb, text, text) from anon, authenticated, public;
revoke execute on function public._ans_int(jsonb, text, text) from anon, authenticated, public;
revoke execute on function public._clean_answers(uuid, jsonb, boolean) from anon, authenticated, public;
revoke execute on function public._clean_custom_answers(uuid, jsonb, jsonb) from anon, authenticated, public;
revoke execute on function public._past_experience_text(uuid) from anon, authenticated, public;
revoke execute on function public._question_options_ok() from anon, authenticated, public;
revoke execute on function public._sanitized_registration(public.event_registrations) from anon, authenticated, public;
revoke execute on function public.upsert_registration(uuid, jsonb, jsonb) from anon, public;
grant execute on function public.upsert_registration(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.admin_update_registration(uuid, jsonb, jsonb, text) from anon, public;
grant execute on function public.admin_update_registration(uuid, jsonb, jsonb, text) to authenticated;

-- ------------------------------------------------------------------ branches: the reunion form's 14 options
-- Old stored names map to the new ones (unambiguous renames only). Batch groups are renamed in place so posts,
-- chats and members stay where they are (the batch trigger is paused so nobody is moved out and back in).
create temp table _branch_map (old text primary key, new text not null);
insert into _branch_map values
  ('Civil Engineering', 'B.E. in Civil Engineering'),
  ('Computer Science & Engineering', 'B.E. in Computer Science & Engineering'),
  ('Electrical Engineering', 'B.E. in Electrical Engineering'),
  ('Electronics & Telecommunication Engineering', 'B.E. in Electronics & Telecommunications'),
  ('Industrial & Production Engineering', 'B.E. Industrial & Production Engineering'),
  ('Information Technology', 'B.E. in Information Technology'),
  ('Mechanical Engineering', 'B.E. in Mechanical Engineering'),
  ('M.Tech. / M.E.', 'M.E. / M.Tech. (other specialisation)');

update public.groups g
   set branch = m.new,
       name = left(m.new || ' ' || g.grad_year, 80),
       description = m.new || ', batch of ' || g.grad_year,
       slug = regexp_replace(left(regexp_replace(lower(m.new), '[^a-z0-9]+', '-', 'g'), 60) || '-' || g.grad_year, '(^-+|-+$)', '', 'g')
  from _branch_map m
 where g.kind = 'batch' and g.branch = m.old
   and not exists (select 1 from public.groups x
                    where x.slug = regexp_replace(left(regexp_replace(lower(m.new), '[^a-z0-9]+', '-', 'g'), 60) || '-' || g.grad_year, '(^-+|-+$)', '', 'g'));

alter table public.profiles disable trigger profiles_batch_groups;
update public.profiles p set branch = m.new from _branch_map m where p.branch = m.old;
alter table public.profiles enable trigger profiles_batch_groups;
update public.event_registrations r set branch = m.new from _branch_map m where r.branch = m.old;
update public.batch_sizes b set branch = m.new from _branch_map m
 where b.branch = m.old and not exists (select 1 from public.batch_sizes x where x.grad_year = b.grad_year and x.branch = m.new);
drop table _branch_map;

-- ------------------------------------------------------------------ the real event: Grand Reunion 2026
update public.events set
  title = 'Alumni Connect Grand Reunion 2026',
  tagline = 'Batches 2003–2012 · A Decade of JECians',
  description = 'A Decade of JECians comes home. All branches (B.E., M.E. & MCA) of the batches 2003 to 2012 meet again in Jabalpur.' || E'\n\n'
    || '26 December 2026: the main event, for alumni only.' || E'\n'
    || '27 December 2026: an optional outdoor event for alumni and their families.' || E'\n\n'
    || 'Register once, choose your days and bring your family on the 27th. Join an organising team, perform on stage, '
    || 'support the Reunion Fund for a better reunion and continuous support to the college and students, or sponsor the event. '
    || 'We can help with accommodation and local travel (vendor details and deal prices; the cost is paid by you).',
  starts_at = '2026-12-26 10:00+05:30',
  ends_at = '2026-12-27 18:00+05:30',
  eligible_from_year = 2003,
  eligible_to_year = 2012,
  ask_reunion_questions = true
 where slug = 'alumni-meet-2026';

-- Days as ticket types: the alumnus picks 26 only / 27 only / both; family tickets are for the 27th only.
-- An existing single main ticket becomes "both days" (registrations already made keep it); prices stay as the admins
-- set them, new tickets get placeholder prices for the admins to edit.
with ev as (select id from public.events where slug = 'alumni-meet-2026'),
     prim as (select t.id from public.event_ticket_types t join ev on ev.id = t.event_id where t.is_primary and t.days is null)
update public.event_ticket_types t
   set label = 'Both days · 26 & 27 Dec', description = 'Main event on 26 Dec and the outdoor event with family on 27 Dec', sort = 3
  from ev
 where t.event_id = ev.id and t.is_primary and t.days is null and (select count(*) from prim) = 1;

insert into public.event_ticket_types (event_id, label, description, price_paise, is_primary, max_per_registration, sort, days)
select e.id, x.label, x.description, x.price, true, 1, x.sort, x.days
  from public.events e
 cross join (values
   ('26 Dec only · main event', 'Main event for alumni only', 200000, 1, '{1}'::smallint[]),
   ('27 Dec only · outdoor event', 'Optional outdoor event for alumni and family', 150000, 2, '{2}'::smallint[])
 ) as x(label, description, price, sort, days)
 where e.slug = 'alumni-meet-2026'
   and not exists (select 1 from public.event_ticket_types t where t.event_id = e.id and t.is_primary and t.days = x.days);

update public.event_ticket_types t
   set days = '{2}',
       label = case t.label when 'Spouse' then 'Family adult · 27 Dec'
                            when 'Child (5–12 years)' then 'Child 5–12 years · 27 Dec'
                            when 'Child (under 5)' then 'Child under 5 · 27 Dec'
                            else t.label end,
       description = case t.label when 'Spouse' then 'Spouse, parent or another adult in your family, for the outdoor event'
                                  when 'Child (5–12 years)' then 'For the outdoor event'
                                  when 'Child (under 5)' then 'For the outdoor event'
                                  else t.description end,
       max_per_registration = case when t.label = 'Spouse' then greatest(t.max_per_registration, 4) else t.max_per_registration end,
       sort = 3 + t.sort
  from public.events e
 where e.id = t.event_id and e.slug = 'alumni-meet-2026' and not t.is_primary and t.days is null;

-- Backfill the new per-day numbers for every registration made before this migration.
update public.event_registrations r set
  days = (select t.days from public.event_registration_items i join public.event_ticket_types t on t.id = i.ticket_type_id
           where i.registration_id = r.id and t.is_primary limit 1),
  day_heads = coalesce((select jsonb_object_agg(d::text, (
                 select coalesce(sum(i.quantity), 0) from public.event_registration_items i
                   join public.event_ticket_types t on t.id = i.ticket_type_id
                  where i.registration_id = r.id and (t.days is null or d = any (t.days))))
                from generate_series(1, public._event_day_count(r.event_id)) d), '{}'::jsonb);
