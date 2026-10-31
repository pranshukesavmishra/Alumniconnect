-- OPTIONAL EXTRAS: INDEPENDENT COUNTS + NAMES.
-- The people who take an optional extra (e.g. the 27 Dec event) are NOT limited by the family on the main ticket: a person may
-- attend only the extra. Rules: the 'Me' line (person type = main ticket) <= 1; every other person type <= the extra's
-- max_per_registration; all people of one extra together <= max_per_registration. Prices stay per person type.
-- CAPACITY DECISION: headcount = people on tickets + the largest group of extra-only people (people on an extra beyond those
-- already on the ticket), so day-2-only attendees take a place; day_heads already counts every extra person on the extra's days.
-- Optional names (for the name badge) are kept per extra line in event_registration_items.names.
-- Additive and re-runnable.

alter table public.event_registration_items add column if not exists names jsonb not null default '[]'::jsonb;

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
           'days', to_jsonb(t.days),
           'names', case when t.is_addon and jsonb_typeof(r.nm) = 'array' then
             (select coalesce(jsonb_agg(left(btrim(x.v), 80)), '[]'::jsonb) from (select v from jsonb_array_elements_text(r.nm) with ordinality y(v, n) where n <= 20 and btrim(v) <> '') x)
             else '[]'::jsonb end) order by t.sort, ft.sort nulls first), '[]'::jsonb)
    into v_lines
    from (select (e ->> 'ticket_type_id')::uuid as tid, (e ->> 'for_ticket_type_id')::uuid as fid, coalesce((e ->> 'quantity')::int, 0) as q, e -> 'names' as nm
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

  -- an extra has its OWN counts, independent of the family on the main ticket (someone may attend only the extra):
  -- the 'Me' line (person type = the main ticket) is at most 1, every other person type at most the extra's maximum
  -- (checked above per line), and all people of one extra together at most its maximum (checked above too).
  if exists (select 1 from jsonb_array_elements(v_lines) l
              where (l ->> 'addon')::boolean and (l ->> 'qty')::int > 1
                and l ->> 'for' = (select x ->> 'id' from jsonb_array_elements(v_lines) x where (x ->> 'primary')::boolean limit 1)) then
    raise exception 'Optional extras: the main person can take an extra only once';
  end if;
  -- another main (alumnus) ticket type cannot be a person type for an extra
  if exists (select 1 from jsonb_array_elements(v_lines) l
              where (l ->> 'addon')::boolean and l ->> 'for' is not null
                and exists (select 1 from public.event_ticket_types p where p.id = (l ->> 'for')::uuid and p.is_primary)
                and l ->> 'for' <> (select x ->> 'id' from jsonb_array_elements(v_lines) x where (x ->> 'primary')::boolean limit 1)) then
    raise exception 'Ticket selection is not valid';
  end if;
  -- people who join only through an extra are attendees too: capacity counts the largest group of extra-only people
  heads := heads + coalesce((select max(greatest(s.q - heads, 0)) from (
             select l ->> 'id' as id, sum((l ->> 'qty')::int) as q from jsonb_array_elements(v_lines) l
              where (l ->> 'addon')::boolean group by l ->> 'id') s), 0);

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
    if def like '%for_ticket_type_id, names,%' then continue; end if; -- already patched
    d := pg_temp.flex_replace(def, '(registration_id, ticket_type_id, for_ticket_type_id, label, unit_price_paise, quantity)',
                                   '(registration_id, ticket_type_id, for_ticket_type_id, names, label, unit_price_paise, quantity)');
    d := pg_temp.flex_replace(d, 'nullif(l ->> ''for'', '''')::uuid, l ->> ''label'',',
                                 'nullif(l ->> ''for'', '''')::uuid, coalesce(l -> ''names'', ''[]''::jsonb), l ->> ''label'',');
    if d = def or d not like '%for_ticket_type_id, names,%' or d not like '%coalesce(l -> ''names''%' then
      raise exception '% could not be patched for extra names', fn;
    end if;
    execute d;
  end loop;
end $$;
