-- GIVE BACK, part 2: SPONSORSHIP for events and appeals.
--
--   sponsor_packages       tiers per event or per appeal (price, slots, benefits); sold / available are computed
--   sponsors               organisations: logo, website, blurb (public) and contact details (admins only), pipeline stage, owner, follow-up date
--   sponsor_notes          the pipeline timeline (notes and stage changes)
--   sponsor_deliverables   checklist per sponsor (logo received, banner printed, ...) with due dates
--   payments               rows of giving_donations with kind = 'sponsorship' (same verification queue); in-kind value is kept apart and never counted in cash
--   permission             sponsors_manage (pipeline, packages, wall); verification stays with funds_verify, exports with funds_reports

create or replace function pg_temp.patch(p_fn text, p_from text, p_to text)
returns void language plpgsql as $$
declare def text; new_def text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f';
  new_def := replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

select pg_temp.patch('_permission_catalog', $$    ('admins', 'Admins', 'See who$$,
$$    ('sponsors_manage', 'Funds', 'Sponsors', 'Sponsor packages, the sponsor pipeline (leads to delivered), the sponsor wall, proposals and agreements.', 77),
    ('admins', 'Admins', 'See who$$);


-- sponsorship payments can be larger than a single member gift (still integer paise)
alter table public.giving_donations drop constraint giving_donations_amount_paise_check;
alter table public.giving_donations alter column amount_paise type bigint;
alter table public.giving_donations add constraint giving_donations_amount_paise_check
  check ((kind = 'donation' and amount_paise between 1000 and 100000000) or (kind = 'sponsorship' and amount_paise between 1000 and 100000000000));

-- ------------------------------------------------------------------ packages
create table public.sponsor_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete cascade,
  campaign_id uuid references public.giving_campaigns (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  rank int not null default 10 check (rank between 1 and 99),
  price_paise bigint not null check (price_paise between 0 and 100000000000),
  slots int check (slots between 1 and 1000),
  benefits text[] not null default '{}' check (cardinality(benefits) <= 15),
  is_in_kind boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((event_id is null) <> (campaign_id is null)),
  check (is_in_kind or price_paise >= 1000)
);
create index sponsor_packages_event_idx on public.sponsor_packages (event_id);
create index sponsor_packages_campaign_idx on public.sponsor_packages (campaign_id);
alter table public.sponsor_packages enable row level security;

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete restrict,
  campaign_id uuid references public.giving_campaigns (id) on delete restrict,
  package_id uuid references public.sponsor_packages (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  logo_path text check (logo_path like 'giving/%'),
  website text check (website ~ '^https?://[^\s]{3,255}$'),
  blurb text check (char_length(blurb) <= 300),
  contact_name text check (char_length(contact_name) <= 120),
  contact_email text check (char_length(contact_email) <= 200),
  contact_phone text check (char_length(contact_phone) <= 40),
  alumni_id uuid references public.profiles (id) on delete set null,
  owner_id uuid references public.profiles (id) on delete set null,
  stage text not null default 'lead' check (stage in ('lead', 'contacted', 'proposal_sent', 'committed', 'paid', 'delivered', 'declined')),
  committed_paise bigint check (committed_paise between 0 and 100000000000),
  is_in_kind boolean not null default false,
  in_kind_description text check (char_length(in_kind_description) <= 300),
  in_kind_value_paise bigint check (in_kind_value_paise between 0 and 100000000000),
  follow_up_on date,
  follow_up_notified_on date,
  show_on_wall boolean not null default true,
  source_registration_id uuid unique references public.event_registrations (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_id is not null or campaign_id is not null),
  check (not is_in_kind or in_kind_value_paise is not null)
);
create index sponsors_event_idx on public.sponsors (event_id);
create index sponsors_campaign_idx on public.sponsors (campaign_id);
create index sponsors_package_idx on public.sponsors (package_id);
alter table public.sponsors enable row level security;
alter table public.giving_donations add constraint giving_donations_sponsor_fk foreign key (sponsor_id) references public.sponsors (id) on delete restrict;

create table public.sponsor_notes (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors (id) on delete cascade,
  author uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index sponsor_notes_idx on public.sponsor_notes (sponsor_id, created_at desc);
alter table public.sponsor_notes enable row level security;

create table public.sponsor_deliverables (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  due_on date,
  done boolean not null default false,
  done_at timestamptz,
  sort int not null default 0
);
create index sponsor_deliverables_idx on public.sponsor_deliverables (sponsor_id);
alter table public.sponsor_deliverables enable row level security;

-- ------------------------------------------------------------------ the slot limit, enforced where the data changes
create or replace function public._sponsor_slot_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pkg public.sponsor_packages; n int;
begin
  if new.package_id is null or new.stage not in ('committed', 'paid', 'delivered') then return new; end if;
  select * into pkg from public.sponsor_packages where id = new.package_id for update;
  if pkg.slots is null then return new; end if;
  select count(*) into n from public.sponsors s where s.package_id = pkg.id and s.id <> new.id and s.stage in ('committed', 'paid', 'delivered');
  if n >= pkg.slots then raise exception 'No slots left in the % package.', pkg.name; end if;
  return new;
end $$;
create trigger sponsors_slot_guard before insert or update of stage, package_id on public.sponsors
  for each row execute function public._sponsor_slot_guard();

create or replace function public._sponsor_paid(p_sponsor uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_paise), 0)::bigint from public.giving_donations where sponsor_id = p_sponsor and status = 'verified';
$$;

-- a verified sponsorship payment settles the sponsor; a refund re-opens it
create or replace function public._giving_after_change(d public.giving_donations)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sponsors;
begin
  if d.sponsor_id is null then return; end if;
  select * into s from public.sponsors where id = d.sponsor_id for update;
  if not found then return; end if;
  if s.stage = 'committed' and public._sponsor_paid(s.id) >= coalesce(s.committed_paise, 0) and coalesce(s.committed_paise, 0) > 0 and d.status = 'verified' then
    update public.sponsors set stage = 'paid', updated_at = now() where id = s.id;
    insert into public.sponsor_notes (sponsor_id, author, body, is_system) values (s.id, auth.uid(), 'Payment verified: marked as paid.', true);
  elsif s.stage = 'paid' and not s.is_in_kind and public._sponsor_paid(s.id) < coalesce(s.committed_paise, 0) then
    update public.sponsors set stage = 'committed', updated_at = now() where id = s.id;
    insert into public.sponsor_notes (sponsor_id, author, body, is_system) values (s.id, auth.uid(), 'A payment was refunded: back to committed.', true);
  end if;
end $$;

-- follow-up reminders go to the owner once a day
create or replace function public._sponsor_run_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for s in select * from public.sponsors where follow_up_on is not null and follow_up_on <= v_today and owner_id is not null
              and stage not in ('paid', 'delivered', 'declined') and follow_up_notified_on is distinct from v_today loop
    insert into public.notifications (user_id, kind, actor_id, target_id, body) values (s.owner_id, 'sponsor_followup', null, s.id, left(s.name, 200));
    update public.sponsors set follow_up_notified_on = v_today where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public._giving_maybe_remind()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.giving_settings set reminders_run_at = now()
   where id and (reminders_run_at is null or reminders_run_at < now() - interval '1 hour');
  if found then
    perform public._giving_run_reminders();
    perform public._sponsor_run_reminders();
  end if;
end $$;

select pg_temp.patch('admin_giving_run_reminders', $$n := public._giving_run_reminders();$$, $$n := public._giving_run_reminders() + public._sponsor_run_reminders();$$);

-- ------------------------------------------------------------------ member side: the wall, the packages, "we would like to sponsor"
-- only organisations that have paid (or in-kind sponsors that are committed) appear, grouped by tier; no contact details, ever
create or replace function public.giving_sponsor_wall(p_event uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(t order by (t ->> 'rank')::int, t ->> 'tier') from (
    select jsonb_build_object('tier', coalesce(pk.name, 'Supporters'), 'rank', coalesce(pk.rank, 99), 'sponsors', jsonb_agg(
        jsonb_build_object('id', s.id, 'name', s.name, 'logo_path', s.logo_path, 'website', s.website, 'blurb', s.blurb, 'in_kind', s.is_in_kind) order by s.name)) as t
      from public.sponsors s left join public.sponsor_packages pk on pk.id = s.package_id
     where s.show_on_wall
       and (s.stage in ('paid', 'delivered') or (s.is_in_kind and s.stage = 'committed'))
       and ((p_event is not null and s.event_id = p_event) or (p_campaign is not null and s.campaign_id = p_campaign))
     group by coalesce(pk.name, 'Supporters'), coalesce(pk.rank, 99)) x), '[]'::jsonb);
end $$;

create or replace function public.giving_sponsor_packages(p_event uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._giving_member();
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'price_paise', k.price_paise, 'is_in_kind', k.is_in_kind, 'benefits', to_jsonb(k.benefits),
      'slots', k.slots, 'available', case when k.slots is null then null else greatest(k.slots - (select count(*) from public.sponsors s where s.package_id = k.id and s.stage in ('committed', 'paid', 'delivered')), 0) end) order by k.rank, k.price_paise desc)
      from public.sponsor_packages k where k.is_active and ((p_event is not null and k.event_id = p_event) or (p_campaign is not null and k.campaign_id = p_campaign))), '[]'::jsonb);
end $$;

-- a member (or their company) tells the committee they would like to sponsor: becomes a lead in the pipeline
create or replace function public.giving_sponsor_interest(p_event uuid, p_campaign uuid, p_package uuid, p_org text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_id uuid;
begin
  perform public._giving_member();
  if (p_event is null) = (p_campaign is null) then raise exception 'Choose an event or an appeal.'; end if;
  if char_length(btrim(coalesce(p_org, ''))) < 2 then raise exception 'Enter the organisation name (or your own name).'; end if;
  if (select count(*) from public.sponsors where alumni_id = auth.uid() and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You have already told us about several sponsors today. Thank you, the committee will be in touch.';
  end if;
  if p_package is not null and not exists (select 1 from public.sponsor_packages where id = p_package and is_active and event_id is not distinct from p_event and campaign_id is not distinct from p_campaign) then
    raise exception 'That package was not found.';
  end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.sponsors (event_id, campaign_id, package_id, name, contact_name, alumni_id, stage, created_by)
  values (p_event, p_campaign, p_package, left(btrim(p_org), 120), me.full_name, auth.uid(), 'lead', auth.uid()) returning id into v_id;
  insert into public.sponsor_notes (sponsor_id, author, body, is_system)
  values (v_id, auth.uid(), 'Interested in sponsoring (sent by the member from the app).' || coalesce(' Note: ' || left(btrim(p_note), 500), ''), true);
end $$;

create or replace function public.giving_transparency()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._giving_member();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'slug', c.slug, 'type', c.type, 'raised_paise', public._giving_raised(c.id),
        'spent_paise', (select coalesce(sum(x.amount_paise), 0) from public.giving_expenses x where x.campaign_id = c.id)) order by c.created_at desc)
        from public.giving_campaigns c where c.status <> 'draft'), '[]'::jsonb),
    'sponsorship', jsonb_build_object(
      'cash_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations where kind = 'sponsorship' and status = 'verified'),
      'in_kind_paise', (select coalesce(sum(in_kind_value_paise), 0) from public.sponsors where is_in_kind and stage in ('committed', 'paid', 'delivered')),
      'events', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'cash_paise', t.s, 'spent_paise', (select coalesce(sum(x.amount_paise), 0) from public.giving_expenses x where x.event_id = e.id)))
          from (select event_id, sum(amount_paise) s from public.giving_donations where kind = 'sponsorship' and status = 'verified' and event_id is not null group by event_id) t
          join public.events e on e.id = t.event_id), '[]'::jsonb)),
    'reunion', public._giving_reunion(),
    'total_raised_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations where status = 'verified'),
    'total_spent_paise', (select coalesce(sum(amount_paise), 0) from public.giving_expenses),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'amount_paise', x.amount_paise, 'spent_on', x.spent_on, 'receipt_path', x.receipt_path,
        'campaign_title', coalesce(c.title, ev.title), 'campaign_slug', c.slug) order by x.spent_on desc, x.created_at desc)
        from (select * from public.giving_expenses order by spent_on desc, created_at desc limit 300) x
        left join public.giving_campaigns c on c.id = x.campaign_id left join public.events ev on ev.id = x.event_id), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ admin: packages
create or replace function public._sponsor_perm()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('sponsors_manage');
end $$;

create or replace function public.admin_sponsor_packages(p_event uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._admin_can_any(array['sponsors_manage', 'funds_reports']) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'event_id', k.event_id, 'campaign_id', k.campaign_id, 'name', k.name, 'rank', k.rank,
      'price_paise', k.price_paise, 'slots', k.slots, 'benefits', to_jsonb(k.benefits), 'is_in_kind', k.is_in_kind, 'is_active', k.is_active,
      'sold', (select count(*) from public.sponsors s where s.package_id = k.id and s.stage in ('committed', 'paid', 'delivered')),
      'available', case when k.slots is null then null else greatest(k.slots - (select count(*) from public.sponsors s where s.package_id = k.id and s.stage in ('committed', 'paid', 'delivered')), 0) end) order by k.rank, k.price_paise desc)
      from public.sponsor_packages k where (p_event is null and p_campaign is null) or k.event_id = p_event or k.campaign_id = p_campaign), '[]'::jsonb);
end $$;

create or replace function public.admin_sponsor_save_package(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_camp uuid := nullif(p ->> 'campaign_id', '')::uuid;
  v_price bigint;
  v_slots int;
  v_ben text[];
  v_kind boolean := coalesce((p ->> 'is_in_kind')::boolean, false);
  v_sold int;
begin
  perform public._sponsor_perm();
  if (v_event is null) = (v_camp is null) then raise exception 'A package belongs to one event or one appeal.'; end if;
  if char_length(btrim(coalesce(p ->> 'name', ''))) < 2 then raise exception 'Give the package a name (for example Gold).'; end if;
  begin v_price := (p ->> 'price_paise')::bigint; exception when others then v_price := null; end;
  if v_price is null or v_price < 0 or (not v_kind and v_price < 1000) then raise exception 'Enter the price (at least ₹10; in-kind packages may be 0).'; end if;
  begin v_slots := nullif(p ->> 'slots', '')::int; exception when others then raise exception 'Slots must be a whole number.'; end;
  if v_slots is not null and v_slots < 1 then raise exception 'Slots must be at least 1.'; end if;
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_ben from jsonb_array_elements_text(coalesce(p -> 'benefits', '[]'::jsonb)) x;
  if cardinality(v_ben) > 15 then raise exception 'At most 15 benefits per package.'; end if;
  if v_id is null then
    insert into public.sponsor_packages (event_id, campaign_id, name, rank, price_paise, slots, benefits, is_in_kind, is_active)
    values (v_event, v_camp, btrim(p ->> 'name'), coalesce((p ->> 'rank')::int, 10), v_price, v_slots, v_ben, v_kind, coalesce((p ->> 'is_active')::boolean, true)) returning id into v_id;
    perform public._audit('sponsor_package_create', 'sponsor_packages', v_id, jsonb_build_object('name', p ->> 'name', 'price_paise', v_price, 'slots', v_slots));
  else
    select count(*) into v_sold from public.sponsors where package_id = v_id and stage in ('committed', 'paid', 'delivered');
    if v_slots is not null and v_slots < v_sold then raise exception 'Already % sponsors hold this package; slots cannot go below that.', v_sold; end if;
    update public.sponsor_packages set name = btrim(p ->> 'name'), rank = coalesce((p ->> 'rank')::int, rank), price_paise = v_price, slots = v_slots, benefits = v_ben,
           is_in_kind = v_kind, is_active = coalesce((p ->> 'is_active')::boolean, is_active) where id = v_id;
    if not found then raise exception 'Package not found.'; end if;
    perform public._audit('sponsor_package_update', 'sponsor_packages', v_id, jsonb_build_object('name', p ->> 'name', 'price_paise', v_price, 'slots', v_slots));
  end if;
  return v_id;
end $$;

create or replace function public.admin_sponsor_delete_package(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.sponsor_packages;
begin
  perform public._sponsor_perm();
  select * into k from public.sponsor_packages where id = p_id;
  if not found then raise exception 'Package not found.'; end if;
  if exists (select 1 from public.sponsors where package_id = p_id) then raise exception 'Sponsors are attached to this package. Switch it off instead of deleting it.'; end if;
  delete from public.sponsor_packages where id = p_id;
  perform public._audit('sponsor_package_delete', 'sponsor_packages', p_id, jsonb_build_object('name', k.name));
end $$;

-- ------------------------------------------------------------------ admin: sponsors and the pipeline (contact details are visible to these admins only)
create or replace function public._sponsor_json(s public.sponsors)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'event_id', s.event_id, 'campaign_id', s.campaign_id, 'package_id', s.package_id, 'name', s.name, 'logo_path', s.logo_path,
      'website', s.website, 'blurb', s.blurb, 'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
      'alumni_id', s.alumni_id, 'alumni_name', (select p.full_name from public.profiles p where p.id = s.alumni_id),
      'owner_id', s.owner_id, 'owner_name', (select p.full_name from public.profiles p where p.id = s.owner_id),
      'stage', s.stage, 'committed_paise', s.committed_paise, 'is_in_kind', s.is_in_kind, 'in_kind_description', s.in_kind_description,
      'in_kind_value_paise', s.in_kind_value_paise, 'follow_up_on', s.follow_up_on, 'show_on_wall', s.show_on_wall, 'created_at', s.created_at,
      'package_name', (select k.name from public.sponsor_packages k where k.id = s.package_id),
      'for_title', coalesce((select e.title from public.events e where e.id = s.event_id), (select c.title from public.giving_campaigns c where c.id = s.campaign_id)),
      'paid_paise', public._sponsor_paid(s.id),
      'pending_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations d where d.sponsor_id = s.id and d.status = 'submitted'));
$$;

create or replace function public.admin_sponsors(p_event uuid default null, p_campaign uuid default null, p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._sponsor_perm();
  return coalesce((select jsonb_agg(public._sponsor_json(s) order by s.created_at desc) from public.sponsors s
     where (p_event is null or s.event_id = p_event) and (p_campaign is null or s.campaign_id = p_campaign) and (p_stage is null or s.stage = p_stage)), '[]'::jsonb);
end $$;

create or replace function public.admin_sponsor(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sponsors;
begin
  perform public._sponsor_perm();
  select * into s from public.sponsors where id = p_id;
  if not found then raise exception 'Sponsor not found.'; end if;
  return public._sponsor_json(s) || jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'is_system', n.is_system, 'created_at', n.created_at, 'author', (select p.full_name from public.profiles p where p.id = n.author)) order by n.created_at desc)
        from public.sponsor_notes n where n.sponsor_id = s.id), '[]'::jsonb),
    'deliverables', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'due_on', d.due_on, 'done', d.done) order by d.sort, d.due_on nulls last)
        from public.sponsor_deliverables d where d.sponsor_id = s.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'amount_paise', d.amount_paise, 'status', d.status, 'method', d.method, 'utr', d.utr, 'receipt_no', d.receipt_no, 'created_at', d.created_at) order by d.created_at desc)
        from public.giving_donations d where d.sponsor_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.admin_sponsor_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_camp uuid := nullif(p ->> 'campaign_id', '')::uuid;
  v_pkg uuid := nullif(p ->> 'package_id', '')::uuid;
  v_logo text := nullif(p ->> 'logo_path', '');
  v_web text := nullif(btrim(coalesce(p ->> 'website', '')), '');
  v_kind boolean := coalesce((p ->> 'is_in_kind')::boolean, false);
  v_kv bigint;
  v_comm bigint;
  v_fu date;
  s public.sponsors;
begin
  perform public._sponsor_perm();
  if char_length(btrim(coalesce(p ->> 'name', ''))) < 2 then raise exception 'Enter the sponsor''s name.'; end if;
  if v_event is null and v_camp is null then raise exception 'Choose the event or appeal being sponsored.'; end if;
  if v_event is not null and v_camp is not null then raise exception 'Choose the event or the appeal, not both.'; end if;
  if v_logo is not null and v_logo not like 'giving/%' then raise exception 'Invalid logo.'; end if;
  if v_web is not null and v_web !~ '^https?://[^\s]{3,255}$' then raise exception 'The website must start with https:// (or http://).'; end if;
  if v_pkg is not null and not exists (select 1 from public.sponsor_packages where id = v_pkg and event_id is not distinct from v_event and campaign_id is not distinct from v_camp) then
    raise exception 'That package belongs to something else.';
  end if;
  begin v_kv := nullif(p ->> 'in_kind_value_paise', '')::bigint; exception when others then raise exception 'Enter the estimated in-kind value in rupees.'; end;
  begin v_comm := nullif(p ->> 'committed_paise', '')::bigint; exception when others then raise exception 'Enter the agreed amount in rupees.'; end;
  begin v_fu := nullif(p ->> 'follow_up_on', '')::date; exception when others then raise exception 'Enter a valid follow-up date.'; end;
  if v_kind and v_kv is null then raise exception 'Enter the estimated value of the in-kind support.'; end if;
  if not v_kind then v_kv := null; end if;
  if v_id is null then
    insert into public.sponsors (event_id, campaign_id, package_id, name, logo_path, website, blurb, contact_name, contact_email, contact_phone, alumni_id, owner_id,
                                 committed_paise, is_in_kind, in_kind_description, in_kind_value_paise, follow_up_on, show_on_wall, created_by)
    values (v_event, v_camp, v_pkg, btrim(p ->> 'name'), v_logo, v_web, left(nullif(btrim(p ->> 'blurb'), ''), 300), left(nullif(btrim(p ->> 'contact_name'), ''), 120),
            left(nullif(btrim(p ->> 'contact_email'), ''), 200), left(nullif(btrim(p ->> 'contact_phone'), ''), 40), nullif(p ->> 'alumni_id', '')::uuid,
            coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()), v_comm, v_kind, left(nullif(btrim(p ->> 'in_kind_description'), ''), 300), v_kv, v_fu,
            coalesce((p ->> 'show_on_wall')::boolean, true), auth.uid()) returning id into v_id;
    perform public._audit('sponsor_create', 'sponsors', v_id, jsonb_build_object('name', p ->> 'name'));
  else
    select * into s from public.sponsors where id = v_id for update;
    if not found then raise exception 'Sponsor not found.'; end if;
    if (s.event_id is distinct from v_event or s.campaign_id is distinct from v_camp) and exists (select 1 from public.giving_donations where sponsor_id = v_id) then
      raise exception 'This sponsor already has payments, so what they sponsor cannot change.';
    end if;
    update public.sponsors set event_id = v_event, campaign_id = v_camp, package_id = v_pkg, name = btrim(p ->> 'name'), logo_path = v_logo, website = v_web,
           blurb = left(nullif(btrim(p ->> 'blurb'), ''), 300), contact_name = left(nullif(btrim(p ->> 'contact_name'), ''), 120),
           contact_email = left(nullif(btrim(p ->> 'contact_email'), ''), 200), contact_phone = left(nullif(btrim(p ->> 'contact_phone'), ''), 40),
           alumni_id = nullif(p ->> 'alumni_id', '')::uuid, owner_id = nullif(p ->> 'owner_id', '')::uuid, committed_paise = v_comm, is_in_kind = v_kind,
           in_kind_description = left(nullif(btrim(p ->> 'in_kind_description'), ''), 300), in_kind_value_paise = v_kv, follow_up_on = v_fu,
           follow_up_notified_on = case when v_fu is distinct from s.follow_up_on then null else s.follow_up_notified_on end,
           show_on_wall = coalesce((p ->> 'show_on_wall')::boolean, true), updated_at = now() where id = v_id;
    perform public._audit('sponsor_update', 'sponsors', v_id, jsonb_build_object('name', p ->> 'name'));
  end if;
  return v_id;
end $$;

create or replace function public.admin_sponsor_set_stage(p_id uuid, p_stage text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sponsors; k public.sponsor_packages; v_comm bigint;
begin
  perform public._sponsor_perm();
  if p_stage not in ('lead', 'contacted', 'proposal_sent', 'committed', 'paid', 'delivered', 'declined') then raise exception 'Unknown stage.'; end if;
  select * into s from public.sponsors where id = p_id for update;
  if not found then raise exception 'Sponsor not found.'; end if;
  if p_stage = s.stage then return; end if;
  v_comm := s.committed_paise;
  if p_stage in ('committed', 'paid', 'delivered') and s.package_id is not null then
    select * into k from public.sponsor_packages where id = s.package_id;
    v_comm := coalesce(v_comm, k.price_paise);
  end if;
  if p_stage = 'committed' and not s.is_in_kind and coalesce(v_comm, 0) < 1000 then raise exception 'Choose a package or enter the agreed amount before marking this as committed.'; end if;
  if p_stage = 'paid' and not s.is_in_kind then raise exception 'A cash sponsor becomes Paid when the payment is verified. Record the payment instead.'; end if;
  if p_stage = 'delivered' and s.stage not in ('paid', 'delivered') and not (s.is_in_kind and s.stage = 'committed') then raise exception 'Mark the sponsor as paid before delivered.'; end if;
  update public.sponsors set stage = p_stage, committed_paise = v_comm, updated_at = now() where id = p_id;
  insert into public.sponsor_notes (sponsor_id, author, body, is_system) values (p_id, auth.uid(), 'Stage: ' || s.stage || ' to ' || p_stage || coalesce('. ' || left(btrim(p_note), 500), ''), true);
  perform public._audit('sponsor_stage', 'sponsors', p_id, jsonb_build_object('name', s.name, 'from', s.stage, 'to', p_stage));
  if p_stage = 'committed' and not s.is_in_kind and public._sponsor_paid(p_id) >= v_comm and v_comm > 0 then
    update public.sponsors set stage = 'paid' where id = p_id;
  end if;
end $$;

create or replace function public.admin_sponsor_add_note(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._sponsor_perm();
  if char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write the note first.'; end if;
  if not exists (select 1 from public.sponsors where id = p_id) then raise exception 'Sponsor not found.'; end if;
  insert into public.sponsor_notes (sponsor_id, author, body) values (p_id, auth.uid(), left(btrim(p_body), 2000));
  perform public._audit('sponsor_note', 'sponsors', p_id, '{}'::jsonb);
end $$;

create or replace function public.admin_sponsor_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sponsors;
begin
  perform public._sponsor_perm();
  select * into s from public.sponsors where id = p_id;
  if not found then raise exception 'Sponsor not found.'; end if;
  if exists (select 1 from public.giving_donations where sponsor_id = p_id) then raise exception 'This sponsor has payments on record and cannot be deleted. Mark it declined instead.'; end if;
  delete from public.sponsors where id = p_id;
  perform public._audit('sponsor_delete', 'sponsors', p_id, jsonb_build_object('name', s.name));
end $$;

create or replace function public.admin_sponsor_save_deliverable(p_sponsor uuid, p_id uuid, p_title text, p_due date, p_done boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  perform public._sponsor_perm();
  if not exists (select 1 from public.sponsors where id = p_sponsor) then raise exception 'Sponsor not found.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Describe the deliverable (for example Logo received).'; end if;
  if v_id is null then
    insert into public.sponsor_deliverables (sponsor_id, title, due_on, done, done_at, sort)
    values (p_sponsor, btrim(p_title), p_due, coalesce(p_done, false), case when p_done then now() end, (select coalesce(max(sort), 0) + 1 from public.sponsor_deliverables where sponsor_id = p_sponsor)) returning id into v_id;
  else
    update public.sponsor_deliverables set title = btrim(p_title), due_on = p_due, done = coalesce(p_done, false),
           done_at = case when coalesce(p_done, false) and not done then now() when not coalesce(p_done, false) then null else done_at end
     where id = v_id and sponsor_id = p_sponsor;
    if not found then raise exception 'Deliverable not found.'; end if;
  end if;
  perform public._audit('sponsor_deliverable', 'sponsors', p_sponsor, jsonb_build_object('title', left(p_title, 80), 'done', coalesce(p_done, false)));
  return v_id;
end $$;

create or replace function public.admin_sponsor_delete_deliverable(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._sponsor_perm();
  delete from public.sponsor_deliverables where id = p_id;
  if not found then raise exception 'Deliverable not found.'; end if;
end $$;

-- leads the registration form already collected ("would you like to sponsor?"): admin only, with contact details
create or replace function public.admin_sponsor_suggested_leads(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._sponsor_perm();
  return coalesce((select jsonb_agg(jsonb_build_object('registration_id', r.id, 'member_id', r.user_id, 'name', r.full_name, 'org', r.sponsor_org, 'level', r.sponsor_level,
      'note', r.sponsor_note, 'phone', r.phone, 'email', r.email, 'batch', r.grad_year) order by r.created_at)
      from public.event_registrations r
     where r.event_id = p_event and r.sponsor_interest and r.status <> 'cancelled'
       and not exists (select 1 from public.sponsors s where s.source_registration_id = r.id)), '[]'::jsonb);
end $$;

create or replace function public.admin_sponsor_import_lead(p_registration uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.event_registrations; v_id uuid;
begin
  perform public._sponsor_perm();
  select * into r from public.event_registrations where id = p_registration;
  if not found or not coalesce(r.sponsor_interest, false) then raise exception 'That registration did not ask to sponsor.'; end if;
  if exists (select 1 from public.sponsors where source_registration_id = p_registration) then raise exception 'This lead was already added.'; end if;
  insert into public.sponsors (event_id, name, contact_name, contact_email, contact_phone, alumni_id, owner_id, stage, source_registration_id, created_by)
  values (r.event_id, left(coalesce(nullif(btrim(r.sponsor_org), ''), r.full_name), 120), left(r.full_name, 120), left(r.email, 200), left(r.phone, 40), r.user_id, auth.uid(), 'lead', r.id, auth.uid())
  returning id into v_id;
  insert into public.sponsor_notes (sponsor_id, author, body, is_system)
  values (v_id, auth.uid(), 'From the registration form (level: ' || coalesce(r.sponsor_level, 'not sure') || ')' || coalesce('. ' || r.sponsor_note, ''), true);
  perform public._audit('sponsor_import_lead', 'sponsors', v_id, jsonb_build_object('registration', p_registration));
  return v_id;
end $$;

-- a sponsor's payment: UPI / bank transfers wait in the same verification queue as donations; cash and cheques are verified on the spot
-- (that needs funds_verify as well)
create or replace function public.admin_sponsor_record_payment(p_sponsor uuid, p_amount bigint, p_method text, p_reference text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.sponsors;
  v_utr text := public._giving_clean_utr(p_reference);
  v_instant boolean := p_method in ('cash', 'cheque');
  d public.giving_donations;
begin
  perform public._sponsor_perm();
  if v_instant then perform public._require_perm('funds_verify'); end if;
  select * into s from public.sponsors where id = p_sponsor for update;
  if not found then raise exception 'Sponsor not found.'; end if;
  if s.is_in_kind then raise exception 'In-kind sponsors have no cash payment. Record the value on the sponsor.'; end if;
  if s.stage not in ('committed', 'paid') then raise exception 'Mark the sponsor as committed before recording a payment.'; end if;
  if p_method not in ('upi', 'bank_transfer', 'cash', 'cheque') then raise exception 'Choose how the money was paid.'; end if;
  if p_amount is null or p_amount < 1000 or p_amount > 100000000000 then raise exception 'Enter a valid amount (at least ₹10).'; end if;
  if p_method in ('upi', 'bank_transfer') then
    if v_utr !~ '^[0-9]{12}$' then raise exception 'The UPI reference (UTR) must be 12 digits.'; end if;
    if public._giving_utr_taken(v_utr, null) then raise exception 'This UPI reference has already been used.'; end if;
  else
    v_utr := null;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why this is recorded by hand (for the records).'; end if;
  end if;
  insert into public.giving_donations (kind, campaign_id, event_id, sponsor_id, donor_name, amount_paise, method, utr, reference, status, offline_reason,
                                       reviewed_by, reviewed_at, verified_at, received_on, receipt_no)
  values ('sponsorship', s.campaign_id, s.event_id, s.id, s.name, p_amount, p_method, v_utr, left(nullif(btrim(p_reference), ''), 120),
          case when v_instant then 'verified' else 'submitted' end, left(nullif(btrim(p_reason), ''), 500),
          case when v_instant then auth.uid() end, case when v_instant then now() end, case when v_instant then now() end,
          (now() at time zone 'Asia/Kolkata')::date, case when v_instant then public._giving_receipt_no() end)
  returning * into d;
  perform public._audit('sponsor_payment', 'giving_donations', d.id, jsonb_build_object('sponsor', s.name, 'amount_paise', p_amount, 'method', p_method, 'utr', v_utr));
  insert into public.sponsor_notes (sponsor_id, author, body, is_system) values (s.id, auth.uid(), 'Payment recorded (' || p_method || '), waiting for verification.', true);
  if v_instant then
    if s.campaign_id is not null then perform public._giving_check_milestones(s.campaign_id); end if;
    perform public._giving_after_change(d);
  end if;
  return d.id;
end $$;

-- printable proposal / agreement / invoice-receipt data (sponsors_manage, or funds_verify for the money side)
create or replace function public.admin_sponsor_document(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sponsors; st public.giving_settings; k public.sponsor_packages;
begin
  if auth.uid() is null or not public._admin_can_any(array['sponsors_manage', 'funds_verify']) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  select * into s from public.sponsors where id = p_id;
  if not found then raise exception 'Sponsor not found.'; end if;
  select * into st from public.giving_settings;
  select * into k from public.sponsor_packages where id = s.package_id;
  return jsonb_build_object('sponsor', s.name, 'contact_name', s.contact_name, 'stage', s.stage, 'is_in_kind', s.is_in_kind, 'in_kind_description', s.in_kind_description,
    'in_kind_value_paise', s.in_kind_value_paise, 'agreed_paise', s.committed_paise, 'paid_paise', public._sponsor_paid(s.id),
    'package', k.name, 'benefits', to_jsonb(coalesce(k.benefits, '{}')),
    'for_title', coalesce((select e.title from public.events e where e.id = s.event_id), (select c.title from public.giving_campaigns c where c.id = s.campaign_id)),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('receipt_no', d.receipt_no, 'amount_paise', d.amount_paise, 'method', d.method, 'utr', d.utr, 'date', coalesce(d.received_on::timestamptz, d.verified_at)) order by d.verified_at)
        from public.giving_donations d where d.sponsor_id = s.id and d.status = 'verified'), '[]'::jsonb),
    'deliverables', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'due_on', x.due_on, 'done', x.done) order by x.sort) from public.sponsor_deliverables x where x.sponsor_id = s.id), '[]'::jsonb),
    'assoc_name', st.assoc_name, 'assoc_details', st.assoc_details, 'payee_name', st.payee_name, 'upi_id', st.default_upi_id, 'footer', st.receipt_footer,
    'tax_text', nullif(btrim(st.tax_text), ''), 'foreign_notice', nullif(btrim(st.foreign_notice), ''));
end $$;

create or replace function public.admin_sponsor_report(p_kind text, p_event uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('funds_reports');
  if p_kind = 'event' then
    return coalesce((select jsonb_agg(r) from (
      select jsonb_build_object('title', coalesce(e.title, c.title), 'event_id', x.event_id, 'campaign_id', x.campaign_id,
          'target_paise', (select coalesce(sum(k.price_paise * coalesce(k.slots, 1)), 0) from public.sponsor_packages k where k.is_active and not k.is_in_kind and k.event_id is not distinct from x.event_id and k.campaign_id is not distinct from x.campaign_id),
          'committed_paise', (select coalesce(sum(s.committed_paise), 0) from public.sponsors s where not s.is_in_kind and s.stage in ('committed', 'paid', 'delivered') and s.event_id is not distinct from x.event_id and s.campaign_id is not distinct from x.campaign_id),
          'paid_paise', (select coalesce(sum(d.amount_paise), 0) from public.giving_donations d where d.kind = 'sponsorship' and d.status = 'verified' and d.event_id is not distinct from x.event_id and d.campaign_id is not distinct from x.campaign_id),
          'in_kind_paise', (select coalesce(sum(s.in_kind_value_paise), 0) from public.sponsors s where s.is_in_kind and s.stage in ('committed', 'paid', 'delivered') and s.event_id is not distinct from x.event_id and s.campaign_id is not distinct from x.campaign_id)) as r
        from (select distinct event_id, campaign_id from public.sponsor_packages union select distinct event_id, campaign_id from public.sponsors) x
        left join public.events e on e.id = x.event_id left join public.giving_campaigns c on c.id = x.campaign_id
       where p_event is null or x.event_id = p_event) t), '[]'::jsonb);
  elsif p_kind = 'tier' then
    return coalesce((select jsonb_agg(jsonb_build_object('tier', k.name, 'for_title', coalesce(e.title, c.title), 'price_paise', k.price_paise, 'slots', k.slots, 'is_in_kind', k.is_in_kind,
        'sold', (select count(*) from public.sponsors s where s.package_id = k.id and s.stage in ('committed', 'paid', 'delivered')),
        'committed_paise', (select coalesce(sum(s.committed_paise), 0) from public.sponsors s where s.package_id = k.id and not s.is_in_kind and s.stage in ('committed', 'paid', 'delivered')),
        'paid_paise', (select coalesce(sum(d.amount_paise), 0) from public.giving_donations d join public.sponsors s on s.id = d.sponsor_id where s.package_id = k.id and d.status = 'verified'))
        order by k.rank)
        from public.sponsor_packages k left join public.events e on e.id = k.event_id left join public.giving_campaigns c on c.id = k.campaign_id
       where p_event is null or k.event_id = p_event), '[]'::jsonb);
  elsif p_kind = 'outstanding' then
    return coalesce((select jsonb_agg(jsonb_build_object('sponsor', s.name, 'stage', s.stage, 'for_title', coalesce(e.title, c.title), 'committed_paise', s.committed_paise,
        'paid_paise', public._sponsor_paid(s.id), 'outstanding_paise', greatest(coalesce(s.committed_paise, 0) - public._sponsor_paid(s.id), 0), 'follow_up_on', s.follow_up_on) order by s.created_at)
        from public.sponsors s left join public.events e on e.id = s.event_id left join public.giving_campaigns c on c.id = s.campaign_id
       where not s.is_in_kind and s.stage = 'committed' and (p_event is null or s.event_id = p_event)), '[]'::jsonb);
  end if;
  raise exception 'Unknown report.';
end $$;

-- ------------------------------------------------------------------ privileges
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_giving\_%' or p.proname like 'giving\_%' or p.proname like 'admin\_giving\_%'
               or p.proname like '\_sponsor\_%' or p.proname like 'admin\_sponsor%') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname not like '\_%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
