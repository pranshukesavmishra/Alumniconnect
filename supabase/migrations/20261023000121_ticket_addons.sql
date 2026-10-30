-- OPTIONAL ADD-ON TICKETS.
-- An add-on (for example a 27 Dec outdoor tour at a price per person) can be bought by ANY registrant, whichever main ticket
-- they chose, and for any person in the registration including the main person. It is exempt from "guest tickets only on days
-- the main ticket covers", still honours max_per_registration, never counts toward the headcount (those people are already
-- counted by their main / guest tickets, so capacity and waitlist stay right) and adds its heads to the days it covers.
-- Re-runnable and tolerant of CRLF / spacing differences in the live function text.

alter table public.event_ticket_types add column if not exists is_addon boolean not null default false;
alter table public.event_ticket_types drop constraint if exists event_ticket_types_addon_not_primary;
alter table public.event_ticket_types add constraint event_ticket_types_addon_not_primary check (not (is_addon and is_primary));

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
   where n.nspname = 'public' and p.proname = '_price_items' and p.prokind = 'f';
  if def like '%''addon''%' then return; end if; -- already patched
  d := def;
  -- 1. lines carry the add-on flag
  d := pg_temp.flex_replace(d, '''primary'', t.is_primary, ''days'', to_jsonb(t.days))',
                               '''primary'', t.is_primary, ''addon'', t.is_addon, ''days'', to_jsonb(t.days))');
  -- 2. heads = people (add-ons are extra per-person options for people already counted)
  d := pg_temp.flex_replace(d, 'coalesce(sum((l ->> ''qty'')::int), 0),',
                               'coalesce(sum((l ->> ''qty'')::int) filter (where not coalesce((l ->> ''addon'')::boolean, false)), 0),');
  -- 3. add-ons skip the main-ticket day check
  d := pg_temp.flex_replace(d, 'for v_line in select l from jsonb_array_elements(v_lines) l where not (l ->> ''primary'')::boolean loop',
                               'for v_line in select l from jsonb_array_elements(v_lines) l where not (l ->> ''primary'')::boolean and not coalesce((l ->> ''addon'')::boolean, false) loop');
  -- 4. an add-on is per person: at most one per person in the registration (main person included)
  d := pg_temp.flex_replace(d, 'select public._jsonb_smallints(l -> ''days'') into v_primary_days',
                               'if exists (select 1 from jsonb_array_elements(v_lines) l where coalesce((l ->> ''addon'')::boolean, false) and (l ->> ''qty'')::int > heads) then
    raise exception ''Optional extras are one per person: you have % people in your registration'', heads;
  end if;

  select public._jsonb_smallints(l -> ''days'') into v_primary_days');
  if d = def or d not like '%''addon'', t.is_addon%' or d not like '%filter (where not coalesce%' or d not like '%and not coalesce((l ->> ''addon'')%'
     or d not like '%one per person%' then
    raise exception '_price_items could not be patched for add-ons';
  end if;
  execute d;
end $$;
