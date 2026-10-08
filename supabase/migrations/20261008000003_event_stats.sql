-- Public, aggregate-only numbers for the event page ("312 registered · 58 from 2005").
-- Counts confirmed registrations only (so unverified payment claims can't inflate it); never exposes names.
create or replace function public.event_public_stats(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with regs as (
    select r.grad_year, r.headcount
      from public.event_registrations r
      join public.events e on e.id = r.event_id and e.is_published
     where r.event_id = p_event and r.status = 'confirmed'
  )
  select jsonb_build_object(
    'registered', (select count(*) from regs),
    'people', (select coalesce(sum(headcount), 0) from regs),
    'by_year', coalesce((select jsonb_agg(jsonb_build_object('year', grad_year, 'count', n) order by grad_year)
                          from (select grad_year, count(*) as n from regs group by grad_year) y), '[]'::jsonb)
  );
$$;

revoke execute on function public.event_public_stats(uuid) from public;
grant execute on function public.event_public_stats(uuid) to anon, authenticated;
