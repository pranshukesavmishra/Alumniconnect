-- OPTIONAL EXTRAS: PRICE PER PERSON TYPE.
-- An optional extra (event_ticket_types.is_addon) keeps its own price as the DEFAULT. event_addon_prices can override it for a
-- person type (a normal ticket: Alumnus, Spouse, Child ...): price_paise null = use the default, 0 = free for that person type,
-- available = false = that person type cannot take the extra. A registration says WHICH person type each extra belongs to
-- (item.for_ticket_type_id); the server prices every extra line itself, so the UI total and the server total always agree.
-- Items saved before this migration have no person type (for_ticket_type_id null) and keep the default price.
-- Additive and re-runnable; the register functions are patched tolerant of CRLF / spacing differences in the live text.

-- ------------------------------------------------------------------ the override table
create table if not exists public.event_addon_prices (
  addon_id uuid not null references public.event_ticket_types (id) on delete cascade,
  ticket_type_id uuid not null references public.event_ticket_types (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  price_paise int check (price_paise is null or price_paise >= 0),
  available boolean not null default true,
  primary key (addon_id, ticket_type_id),
  check (addon_id <> ticket_type_id)
);
create index if not exists event_addon_prices_event_idx on public.event_addon_prices (event_id);

create or replace function public._addon_price_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.event_ticket_types a where a.id = new.addon_id and a.event_id = new.event_id and a.is_addon) then
    raise exception 'The extra does not belong to this event';
  end if;
  if not exists (select 1 from public.event_ticket_types t where t.id = new.ticket_type_id and t.event_id = new.event_id and not t.is_addon) then
    raise exception 'A price for an extra can only be set on a normal ticket of the same event';
  end if;
  return new;
end $$;
revoke execute on function public._addon_price_check() from anon, authenticated, public;
drop trigger if exists event_addon_prices_check on public.event_addon_prices;
create trigger event_addon_prices_check before insert or update on public.event_addon_prices for each row execute function public._addon_price_check();
drop trigger if exists event_addon_prices_audit on public.event_addon_prices;
create trigger event_addon_prices_audit after insert or update or delete on public.event_addon_prices for each row execute function public._audit_config_change();

alter table public.event_addon_prices enable row level security;
drop policy if exists "addon prices are public" on public.event_addon_prices;
create policy "addon prices are public" on public.event_addon_prices for select using (
  exists (select 1 from public.events e where e.id = event_addon_prices.event_id
          and (e.is_published or public._admin_can_any(array['events_*', 'money_*', 'messages_*']))));
drop policy if exists "admins manage addon prices" on public.event_addon_prices;
create policy "admins manage addon prices" on public.event_addon_prices for all to authenticated
  using (public._admin_can('events_tickets')) with check (public._admin_can('events_tickets'));
grant select on public.event_addon_prices to anon, authenticated;
grant insert, update, delete on public.event_addon_prices to authenticated; -- RLS: ticket managers only

-- ------------------------------------------------------------------ the person type on a registration item
alter table public.event_registration_items add column if not exists for_ticket_type_id uuid references public.event_ticket_types (id);
do $$
declare c text;
begin
  -- one row per (registration, ticket, person type); legacy rows have no person type
  select conname into c from pg_constraint where conrelid = 'public.event_registration_items'::regclass and contype = 'p';
  if c is not null then
    execute format('alter table public.event_registration_items drop constraint %I', c);
  end if;
end $$;
create unique index if not exists event_registration_items_uniq
  on public.event_registration_items (registration_id, ticket_type_id, coalesce(for_ticket_type_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ------------------------------------------------------------------ pricing
-- p_items: [{ticket_type_id, quantity, for_ticket_type_id?}]. for_ticket_type_id is only for extras: the person type taking it.
-- Returns {lines: [{id,label,price,qty,max,primary,addon,for,days}], total, heads, days, day_heads}.
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
                   or coalesce(e ->> 'for_ticket_type_id', '00000000-0000-0000-0000-000000000000') !~* '^[0-9a-f-]{36}$'
                   or coalesce(e ->> 'quantity', '0') !~ '^-?[0-9]{1,4}$') then
    raise exception 'Ticket selection is not valid';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
              group by lower(e ->> 'ticket_type_id'), lower(coalesce(e ->> 'for_ticket_type_id', '')) having count(*) > 1) then
    raise exception 'Ticket selection is not valid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'label', case when r.fid is not null then coalesce(t.label, '') || ' (' || coalesce(ft.label, '') || ')' else coalesce(t.label, '') end,
           'price', case when t.is_addon and r.fid is not null and o.price_paise is not null then o.price_paise else t.price_paise end,
           'qty', r.q, 'max', t.max_per_registration, 'primary', t.is_primary, 'addon', t.is_addon,
           'for', r.fid, 'for_bad', r.fid is not null and (t.is_addon is not true or ft.id is null or ft.is_addon),
           'avail', coalesce(o.available, true), 'name', coalesce(t.label, ''), 'for_name', coalesce(ft.label, ''),
           'days', to_jsonb(t.days)) order by t.sort, ft.sort nulls first), '[]'::jsonb)
    into v_lines
    from (select (e ->> 'ticket_type_id')::uuid as tid, (e ->> 'for_ticket_type_id')::uuid as fid, coalesce((e ->> 'quantity')::int, 0) as q
            from jsonb_array_elements(p_items) e) r
    left join public.event_ticket_types t on t.id = r.tid and t.event_id = p_event
    left join public.event_ticket_types ft on ft.id = r.fid and ft.event_id = p_event
    left join public.event_addon_prices o on o.addon_id = t.id and o.ticket_type_id = r.fid
   where r.q <> 0;

  select l into v_bad from jsonb_array_elements(v_lines) l
   where l ->> 'id' is null or (l ->> 'qty')::int < 0 or (l ->> 'qty')::int > (l ->> 'max')::int or (l ->> 'for_bad')::boolean
   limit 1;
  if v_bad is not null then
    if v_bad ->> 'id' is null then
      raise exception 'Unknown ticket type';
    end if;
    if (v_bad ->> 'qty')::int < 0 or (v_bad ->> 'for_bad')::boolean then
      raise exception 'Ticket selection is not valid';
    end if;
    raise exception 'You can choose at most % of "%"', v_bad ->> 'max', v_bad ->> 'name';
  end if;

  -- the same extra over several person types still obeys its overall maximum
  select l into v_bad from jsonb_array_elements(v_lines) l
   where (l ->> 'addon')::boolean
     and (select sum((x ->> 'qty')::int) from jsonb_array_elements(v_lines) x where x ->> 'id' = l ->> 'id') > (l ->> 'max')::int
   limit 1;
  if v_bad is not null then
    raise exception 'You can choose at most % of "%"', v_bad ->> 'max', v_bad ->> 'name';
  end if;

  -- an extra the organisers switched off for a person type cannot be taken by that person type
  select l into v_bad from jsonb_array_elements(v_lines) l where not (l ->> 'avail')::boolean limit 1;
  if v_bad is not null then
    raise exception '"%" is not available for "%"', v_bad ->> 'name', v_bad ->> 'for_name';
  end if;

  select coalesce(sum((l ->> 'price')::int * (l ->> 'qty')::int), 0),
         coalesce(sum((l ->> 'qty')::int) filter (where not (l ->> 'addon')::boolean), 0),
         coalesce(sum((l ->> 'qty')::int) filter (where (l ->> 'primary')::boolean), 0)
    into total, heads, primaries
    from jsonb_array_elements(v_lines) l;
  if primaries <> 1 then
    raise exception 'Choose exactly one main (alumnus) ticket';
  end if;

  -- an extra is per person: at most one per person in the registration (the main person included), and an extra
  -- for a person type cannot be taken by more people of that type than there are in the registration
  if exists (select 1 from (select l ->> 'id' as id, sum((l ->> 'qty')::int) as q from jsonb_array_elements(v_lines) l
                             where (l ->> 'addon')::boolean group by l ->> 'id') s where s.q > heads) then
    raise exception 'Optional extras are one per person: you have % people in your registration', heads;
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) l
              where l ->> 'for' is not null
                and (l ->> 'qty')::int > coalesce((select sum((x ->> 'qty')::int) from jsonb_array_elements(v_lines) x
                                                    where x ->> 'id' = l ->> 'for' and not (x ->> 'addon')::boolean), 0)) then
    raise exception 'Optional extras are one per person: there are not that many people of this ticket type in your registration';
  end if;

  select public._jsonb_smallints(l -> 'days') into v_primary_days
    from jsonb_array_elements(v_lines) l where (l ->> 'primary')::boolean;
  if v_primary_days is not null then
    for v_line in select l from jsonb_array_elements(v_lines) l where not (l ->> 'primary')::boolean and not (l ->> 'addon')::boolean loop
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
revoke execute on function public._price_items(uuid, jsonb) from anon, authenticated, public;

-- ------------------------------------------------------------------ keep the person type when a registration is saved
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
  fn text;
  def text;
  d text;
begin
  foreach fn in array array['upsert_registration', 'admin_update_registration'] loop
    select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn and p.prokind = 'f';
    if def like '%for_ticket_type_id%' then continue; end if; -- already patched
    d := def;
    d := pg_temp.flex_replace(d, '(registration_id, ticket_type_id, label, unit_price_paise, quantity)',
                                 '(registration_id, ticket_type_id, for_ticket_type_id, label, unit_price_paise, quantity)');
    d := pg_temp.flex_replace(d, 'select reg.id, (l ->> ''id'')::uuid, l ->> ''label'',',
                                 'select reg.id, (l ->> ''id'')::uuid, nullif(l ->> ''for'', '''')::uuid, l ->> ''label'',');
    if fn = 'upsert_registration' then
      -- after payment the exact (ticket, person type, quantity) set is compared
      d := pg_temp.flex_replace(d, '(select (l ->> ''id'')::uuid, (l ->> ''qty'')::int from jsonb_array_elements(v_price -> ''lines'') l
       except select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id)',
                                   '(select (l ->> ''id'')::uuid, nullif(l ->> ''for'', '''')::uuid, (l ->> ''qty'')::int from jsonb_array_elements(v_price -> ''lines'') l
       except select i.ticket_type_id, i.for_ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id)');
      d := pg_temp.flex_replace(d, '(select i.ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id
       except select (l ->> ''id'')::uuid, (l ->> ''qty'')::int from jsonb_array_elements(v_price -> ''lines'') l)',
                                   '(select i.ticket_type_id, i.for_ticket_type_id, i.quantity from public.event_registration_items i where i.registration_id = reg.id
       except select (l ->> ''id'')::uuid, nullif(l ->> ''for'', '''')::uuid, (l ->> ''qty'')::int from jsonb_array_elements(v_price -> ''lines'') l)');
      if d not like '%i.for_ticket_type_id, i.quantity%' or d not like '%except select i.ticket_type_id, i.for_ticket_type_id%' then
        raise exception 'upsert_registration could not be patched (compare)';
      end if;
    end if;
    if d = def or d not like '%for_ticket_type_id, label, unit_price_paise%' or d not like '%nullif(l ->> ''for'', '''')::uuid, l ->> ''label''%' then
      raise exception '% could not be patched for extras by person type', fn;
    end if;
    execute d;
  end loop;
end $$;
