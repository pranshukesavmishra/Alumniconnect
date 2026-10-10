-- GIVE BACK, part 1: donation drives, scholarship fund, adopt-a-lab / classroom, alumni fund and crowdfunding appeals.
--
--   giving_settings      one row: default UPI id, payee, association details, receipt footer, tax text, foreign-donor notice
--   giving_campaigns     appeals (type project | scholarship | adopt | alumni_fund | drive), draft | live | paused | completed
--   giving_items         things to fund inside a campaign (e.g. "Smart board", price)
--   giving_milestones    25 / 50 / 75 / 100 % with what each unlocks
--   giving_updates       the committee's news feed on a campaign
--   giving_expenses      "where the money went"
--   giving_donations     one row per gift. Money is integer paise; counters are always computed from VERIFIED rows.
--   giving_pledges       "remind me on <date>" / monthly reminders (a notification only, never a debit)
--   giving_prefs         opt out of "new appeal" notifications
--
-- Payments are UPI to the association's account with a 12-digit UTR, verified by the committee exactly like event payments. There is
-- no gateway and no card data. Nothing here is writable through the API: every change goes through a SECURITY DEFINER function that
-- checks the caller and writes the activity log (public._audit).
--
-- Permissions (added to the catalog): funds_manage (campaigns, items, updates, expenses, settings), funds_verify (verify, reject,
-- offline gifts, refunds; sees donor names even when the gift is anonymous), funds_reports (totals and exports).

-- ------------------------------------------------------------------ patch helper (same idea as migrations 34 and 37)
create or replace function pg_temp.patch(p_fn text, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into strict def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f';
  new_def := replace(def, p_from, p_to);
  if new_def = def then raise exception 'function % has nothing to replace for %', p_fn, p_from; end if;
  execute new_def;
end $$;

select pg_temp.patch('_permission_catalog', $$    ('admins', 'Admins', 'See who$$,
$$    ('funds_manage', 'Funds', 'Campaigns and funds', 'Create, edit, publish and pause fund appeals, items, milestones, updates, the "where the money went" log and the fund settings.', 67),
    ('funds_verify', 'Funds', 'Verify donations', 'Verify or reject donations, record cash and bank gifts, record refunds. Sees donor names even for anonymous gifts.', 68),
    ('funds_reports', 'Funds', 'Fund reports', 'Fund totals by campaign, batch, department, month and donor, and CSV downloads.', 69),
    ('admins', 'Admins', 'See who$$);

-- ------------------------------------------------------------------ settings
create table public.giving_settings (
  id boolean primary key default true check (id),
  default_upi_id text check (char_length(default_upi_id) <= 100),
  payee_name text check (char_length(payee_name) <= 50),
  assoc_name text check (char_length(assoc_name) <= 120),
  assoc_details text check (char_length(assoc_details) <= 600),
  receipt_footer text check (char_length(receipt_footer) <= 600),
  tax_text text check (char_length(tax_text) <= 600),
  foreign_notice text check (char_length(foreign_notice) <= 600),
  reminders_run_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.giving_settings (id, payee_name, assoc_name) values (true, 'JEC Alumni', 'JEC Alumni Association');
alter table public.giving_settings enable row level security;

-- ------------------------------------------------------------------ campaigns
create table public.giving_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  type text not null check (type in ('project', 'scholarship', 'adopt', 'alumni_fund', 'drive')),
  title text not null check (char_length(title) between 3 and 120),
  summary text check (char_length(summary) <= 300),
  story text check (char_length(story) <= 8000),
  goal_paise bigint not null check (goal_paise between 100000 and 1000000000000),
  starts_at timestamptz,
  ends_at timestamptz,
  cover_path text check (cover_path like 'giving/%'),
  suggested_paise int[] not null default '{50000,100000,250000,500000}' check (cardinality(suggested_paise) between 1 and 8),
  upi_id text check (char_length(upi_id) <= 100),
  payee_name text check (char_length(payee_name) <= 50),
  department text check (char_length(department) <= 80),
  batch_from int check (batch_from between 1947 and 2100),
  batch_to int check (batch_to between 1947 and 2100),
  status text not null default 'draft' check (status in ('draft', 'live', 'paused', 'completed')),
  is_featured boolean not null default false,
  published_at timestamptz,
  ending_notified_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (batch_to is null or batch_from is null or batch_from <= batch_to)
);
create index giving_campaigns_status_idx on public.giving_campaigns (status);
alter table public.giving_campaigns enable row level security;

create table public.giving_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.giving_campaigns (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 500),
  price_paise bigint not null check (price_paise between 1000 and 1000000000000),
  sort int not null default 0
);
create index giving_items_campaign_idx on public.giving_items (campaign_id);
alter table public.giving_items enable row level security;

create table public.giving_milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.giving_campaigns (id) on delete cascade,
  percent int not null check (percent between 1 and 100),
  title text not null check (char_length(title) between 2 and 120),
  unlocks text check (char_length(unlocks) <= 300),
  reached_at timestamptz,
  unique (campaign_id, percent)
);
alter table public.giving_milestones enable row level security;

create table public.giving_updates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.giving_campaigns (id) on delete cascade,
  title text check (char_length(title) <= 120),
  body text not null check (char_length(body) between 2 and 4000),
  image_path text check (image_path like 'giving/%'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index giving_updates_campaign_idx on public.giving_updates (campaign_id, created_at desc);
alter table public.giving_updates enable row level security;

create table public.giving_expenses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.giving_campaigns (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  description text not null check (char_length(description) between 3 and 300),
  amount_paise bigint not null check (amount_paise between 100 and 1000000000000),
  spent_on date not null,
  receipt_path text check (receipt_path like 'giving/%'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index giving_expenses_campaign_idx on public.giving_expenses (campaign_id);
alter table public.giving_expenses enable row level security;

-- ------------------------------------------------------------------ donations
create sequence public.giving_receipt_seq;

create table public.giving_donations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'donation' check (kind in ('donation', 'sponsorship')),
  campaign_id uuid references public.giving_campaigns (id) on delete restrict,
  item_id uuid references public.giving_items (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  sponsor_id uuid,
  user_id uuid references public.profiles (id) on delete set null,
  donor_name text check (char_length(donor_name) <= 120),
  amount_paise int not null check (amount_paise between 1000 and 100000000),
  method text not null default 'upi' check (method in ('upi', 'cash', 'cheque', 'bank_transfer')),
  utr text check (utr ~ '^[0-9]{12}$'),
  reference text check (char_length(reference) <= 120),
  payer_name text check (char_length(payer_name) <= 120),
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected', 'refunded')),
  is_anonymous boolean not null default false,
  message text check (char_length(message) <= 300),
  dedication text check (char_length(dedication) <= 150),
  donor_batch int,
  donor_department text,
  receipt_no text unique,
  review_note text check (char_length(review_note) <= 500),
  offline_reason text check (char_length(offline_reason) <= 500),
  refund_reason text check (char_length(refund_reason) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  verified_at timestamptz,
  refunded_at timestamptz,
  received_on date,
  created_at timestamptz not null default now(),
  check ((kind = 'donation' and campaign_id is not null) or (kind = 'sponsorship' and (campaign_id is not null or event_id is not null))),
  check (item_id is null or campaign_id is not null),
  check (user_id is not null or donor_name is not null)
);
-- a UPI reference can be claimed once (a rejected one is free again); event payments are checked inside the functions
create unique index giving_donations_utr_unique on public.giving_donations (utr) where utr is not null and status <> 'rejected';
create index giving_donations_campaign_idx on public.giving_donations (campaign_id, status);
create index giving_donations_user_idx on public.giving_donations (user_id, created_at desc);
create index giving_donations_event_idx on public.giving_donations (event_id) where event_id is not null;
alter table public.giving_donations enable row level security;

create table public.giving_pledges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.giving_campaigns (id) on delete cascade,
  amount_paise int check (amount_paise between 1000 and 100000000),
  remind_on date not null,
  monthly boolean not null default false,
  active boolean not null default true,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, campaign_id)
);
alter table public.giving_pledges enable row level security;

create table public.giving_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  notify_new boolean not null default true
);
alter table public.giving_prefs enable row level security;

-- ------------------------------------------------------------------ storage: covers, update pictures and expense receipts (public read, random file names)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('giving', 'giving', true, 5 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy "fund managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'giving' and (storage.foldername(name))[1] = 'giving' and public._admin_can_any(array['funds_manage', 'sponsors_manage']));
create policy "fund managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'giving' and (storage.foldername(name))[1] = 'giving' and public._admin_can_any(array['funds_manage', 'sponsors_manage']));

-- ------------------------------------------------------------------ internal helpers
create or replace function public._giving_raised(p_campaign uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_paise), 0)::bigint from public.giving_donations where campaign_id = p_campaign and status = 'verified';
$$;

create or replace function public._giving_summary(c public.giving_campaigns)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'type', c.type, 'title', c.title, 'summary', c.summary, 'cover_path', c.cover_path,
    'goal_paise', c.goal_paise, 'raised_paise', public._giving_raised(c.id),
    'donor_count', (select count(distinct coalesce(d.user_id::text, d.id::text)) from public.giving_donations d where d.campaign_id = c.id and d.status = 'verified'),
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'status', c.status, 'department', c.department,
    'batch_from', c.batch_from, 'batch_to', c.batch_to, 'is_featured', c.is_featured);
$$;

create or replace function public._giving_open(c public.giving_campaigns)
returns boolean language sql stable security definer set search_path = '' as $$
  select c.status = 'live' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now());
$$;

create or replace function public._giving_receipt_no()
returns text language sql volatile security definer set search_path = '' as $$
  select 'JEC-GV-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.giving_receipt_seq')::text, 6, '0');
$$;

-- a UTR is "taken" when an event payment or another (not rejected) donation holds it
create or replace function public._giving_utr_taken(p_utr text, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_payments e where e.utr = p_utr and e.status <> 'rejected')
      or exists (select 1 from public.giving_donations d where d.utr = p_utr and d.status <> 'rejected' and d.id is distinct from p_except);
$$;

create or replace function public._giving_clean_utr(p_utr text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p_utr, ''), '\s', '', 'g');
$$;

-- hook for the sponsorship pass (replaced in the next migration): called after a gift is verified or refunded
create or replace function public._giving_after_change(d public.giving_donations)
returns void language plpgsql security definer set search_path = '' as $$
begin
  null;
end $$;

create or replace function public._giving_check_milestones(p_campaign uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.giving_campaigns;
  m record;
  v_raised bigint;
begin
  select * into c from public.giving_campaigns where id = p_campaign;
  if not found then return; end if;
  v_raised := public._giving_raised(p_campaign);
  for m in select * from public.giving_milestones where campaign_id = p_campaign and reached_at is null order by percent loop
    if v_raised * 100 >= c.goal_paise * m.percent then
      update public.giving_milestones set reached_at = now() where id = m.id;
      insert into public.notifications (user_id, kind, actor_id, target_id, body)
        select distinct d.user_id, 'giving_milestone', null, c.id, left(m.percent || '% ' || m.title, 200)
          from public.giving_donations d where d.campaign_id = p_campaign and d.status = 'verified' and d.user_id is not null;
    end if;
  end loop;
end $$;

-- reminders: pledges due, campaigns ending within 3 days. Runs from cron when available and otherwise whenever someone opens the hub (at most hourly).
create or replace function public._giving_run_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  p record;
  c record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for p in select pl.*, gc.title, gc.status from public.giving_pledges pl join public.giving_campaigns gc on gc.id = pl.campaign_id
            where pl.active and pl.remind_on <= v_today loop
    if p.status = 'live' then
      insert into public.notifications (user_id, kind, actor_id, target_id, body) values (p.user_id, 'pledge_reminder', null, p.campaign_id, left(p.title, 200));
      n := n + 1;
    end if;
    if p.monthly and p.status in ('live', 'paused') then
      update public.giving_pledges set remind_on = (p.remind_on + interval '1 month')::date, last_reminded_at = now() where id = p.id;
    else
      update public.giving_pledges set active = false, last_reminded_at = now() where id = p.id;
    end if;
  end loop;
  for c in select * from public.giving_campaigns where status = 'live' and ends_at is not null and ends_at > now()
              and ends_at <= now() + interval '3 days' and ending_notified_at is null loop
    update public.giving_campaigns set ending_notified_at = now() where id = c.id;
    insert into public.notifications (user_id, kind, actor_id, target_id, body)
      select u, 'giving_ending', null, c.id, left(c.title, 200) from (
        select d.user_id as u from public.giving_donations d where d.campaign_id = c.id and d.status in ('submitted', 'verified') and d.user_id is not null
        union select pl.user_id from public.giving_pledges pl where pl.campaign_id = c.id and pl.active) x;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public._giving_maybe_remind()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.giving_settings set reminders_run_at = now()
   where id and (reminders_run_at is null or reminders_run_at < now() - interval '1 hour');
  if found then perform public._giving_run_reminders(); end if;
end $$;

-- ------------------------------------------------------------------ member side
create or replace function public._giving_member()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified() then
    raise exception 'Giving is open to verified members. Please sign in.' using errcode = '42501';
  end if;
end $$;

create or replace function public._giving_reunion()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'raised_paise', coalesce(sum(fund_paise) filter (where status = 'confirmed'), 0)::bigint,
    'pending_paise', coalesce(sum(fund_paise) filter (where status in ('pending_payment', 'under_review')), 0)::bigint,
    'contributors', count(*) filter (where status = 'confirmed' and fund_paise > 0))
    from public.event_registrations where fund_paise > 0;
$$;

create or replace function public.giving_hub()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._giving_member();
  perform public._giving_maybe_remind();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(public._giving_summary(c) order by c.is_featured desc, (c.status = 'live') desc, c.ends_at nulls last, c.created_at desc)
                             from public.giving_campaigns c where c.status in ('live', 'paused', 'completed')), '[]'::jsonb),
    'reunion', public._giving_reunion(),
    'departments', coalesce((select jsonb_agg(distinct c.department) from public.giving_campaigns c where c.status in ('live', 'paused', 'completed') and c.department is not null), '[]'::jsonb));
end $$;

create or replace function public.giving_featured()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.giving_campaigns;
begin
  if auth.uid() is null or not public.is_verified() then return null; end if;
  select * into c from public.giving_campaigns g where g.status = 'live' and (g.ends_at is null or g.ends_at > now())
   order by g.is_featured desc, g.published_at desc nulls last limit 1;
  if not found then return null; end if;
  return public._giving_summary(c);
end $$;

create or replace function public.giving_campaign(p_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.giving_campaigns;
  s public.giving_settings;
  v_raised bigint;
begin
  perform public._giving_member();
  select * into c from public.giving_campaigns where slug = p_slug;
  if not found or (c.status = 'draft' and not public._admin_can('funds_manage')) then raise exception 'This appeal was not found.'; end if;
  select * into s from public.giving_settings;
  v_raised := public._giving_raised(c.id);
  return public._giving_summary(c) || jsonb_build_object(
    'story', c.story, 'suggested_paise', to_jsonb(c.suggested_paise),
    'upi_id', coalesce(nullif(c.upi_id, ''), nullif(s.default_upi_id, '')),
    'payee_name', coalesce(nullif(c.payee_name, ''), nullif(s.payee_name, ''), s.assoc_name, 'JEC Alumni'),
    'accepting', public._giving_open(c),
    'foreign_notice', s.foreign_notice,
    'spent_paise', (select coalesce(sum(amount_paise), 0) from public.giving_expenses where campaign_id = c.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'description', i.description, 'price_paise', i.price_paise,
        'funded_paise', (select coalesce(sum(d.amount_paise), 0) from public.giving_donations d where d.item_id = i.id and d.status = 'verified'),
        'pending_paise', (select coalesce(sum(d.amount_paise), 0) from public.giving_donations d where d.item_id = i.id and d.status = 'submitted')) order by i.sort, i.name)
        from public.giving_items i where i.campaign_id = c.id), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('percent', m.percent, 'title', m.title, 'unlocks', m.unlocks,
        'amount_paise', (c.goal_paise * m.percent / 100), 'reached', m.reached_at is not null or v_raised * 100 >= c.goal_paise * m.percent) order by m.percent)
        from public.giving_milestones m where m.campaign_id = c.id), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'image_path', u.image_path, 'created_at', u.created_at) order by u.created_at desc)
        from (select * from public.giving_updates where campaign_id = c.id order by created_at desc limit 30) u), '[]'::jsonb),
    'my_pledge', (select jsonb_build_object('remind_on', pl.remind_on, 'monthly', pl.monthly, 'amount_paise', pl.amount_paise, 'active', pl.active)
                    from public.giving_pledges pl where pl.campaign_id = c.id and pl.user_id = auth.uid() and pl.active),
    'my_total_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations d where d.campaign_id = c.id and d.user_id = auth.uid() and d.status = 'verified'));
end $$;

-- the donor wall: anonymous gifts show no name, batch, message or dedication
create or replace function public.giving_donors(p_campaign uuid, p_limit int default 30, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._giving_member();
  if not exists (select 1 from public.giving_campaigns c where c.id = p_campaign and (c.status <> 'draft' or public._admin_can('funds_manage'))) then
    raise exception 'This appeal was not found.';
  end if;
  return coalesce((select jsonb_agg(r) from (
    select jsonb_build_object('id', d.id, 'anonymous', d.is_anonymous, 'amount_paise', d.amount_paise, 'at', d.verified_at,
        'name', case when d.is_anonymous then null else coalesce(p.full_name, d.donor_name) end,
        'batch', case when d.is_anonymous then null else d.donor_batch end,
        'message', case when d.is_anonymous then null else d.message end,
        'dedication', case when d.is_anonymous then null else d.dedication end) as r
      from public.giving_donations d left join public.profiles p on p.id = d.user_id
     where d.campaign_id = p_campaign and d.status = 'verified' and d.kind = 'donation'
     order by d.verified_at desc nulls last limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) x), '[]'::jsonb);
end $$;

-- friendly competition between batches: named gifts only, anonymous ones are summed apart
create or replace function public.giving_leaderboard(p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._giving_member();
  return jsonb_build_object(
    'batches', coalesce((select jsonb_agg(b order by (b ->> 'raised_paise')::bigint desc) from (
        select jsonb_build_object('batch', d.donor_batch, 'raised_paise', sum(d.amount_paise)::bigint, 'donors', count(distinct coalesce(d.user_id::text, d.id::text))) as b
          from public.giving_donations d join public.giving_campaigns c on c.id = d.campaign_id
         where d.status = 'verified' and d.kind = 'donation' and not d.is_anonymous and d.donor_batch is not null
           and c.status <> 'draft' and (p_campaign is null or d.campaign_id = p_campaign)
         group by d.donor_batch order by sum(d.amount_paise) desc limit 20) t), '[]'::jsonb),
    'anonymous_paise', coalesce((select sum(d.amount_paise) from public.giving_donations d join public.giving_campaigns c on c.id = d.campaign_id
         where d.status = 'verified' and d.kind = 'donation' and d.is_anonymous and c.status <> 'draft' and (p_campaign is null or d.campaign_id = p_campaign)), 0)::bigint);
end $$;

create or replace function public.giving_submit(p_campaign uuid, p_item uuid, p_amount int, p_utr text, p_payer text, p_anonymous boolean, p_message text, p_dedication text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.giving_campaigns;
  it public.giving_items;
  me public.profiles;
  v_utr text := public._giving_clean_utr(p_utr);
  v_id uuid;
begin
  perform public._giving_member();
  select * into c from public.giving_campaigns where id = p_campaign for share;
  if not found or c.status = 'draft' then raise exception 'This appeal was not found.'; end if;
  if c.status = 'paused' then raise exception 'This appeal is paused for now. Please check back soon.'; end if;
  if c.status = 'completed' then raise exception 'This appeal is complete. Thank you!'; end if;
  if not public._giving_open(c) then raise exception 'This appeal is not open for gifts right now.'; end if;
  if p_amount is null or p_amount < 1000 or p_amount > 100000000 then raise exception 'A gift must be between ₹10 and ₹10,00,000.'; end if;
  if v_utr !~ '^[0-9]{12}$' then raise exception 'The UPI reference (UTR) must be 12 digits.'; end if;
  if p_item is not null then
    select * into it from public.giving_items where id = p_item and campaign_id = c.id;
    if not found then raise exception 'That item was not found.'; end if;
    if p_amount > it.price_paise - coalesce((select sum(d.amount_paise) from public.giving_donations d where d.item_id = it.id and d.status in ('submitted', 'verified')), 0) then
      raise exception 'That is more than this item still needs (or it is already fully funded).';
    end if;
  end if;
  -- rate limits: 5 gifts an hour, 15 a day, 5 waiting for review at once
  if (select count(*) from public.giving_donations where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.giving_donations where user_id = auth.uid() and created_at > now() - interval '1 day') >= 15 then
    raise exception 'You have sent several gifts just now. Please try again a little later.';
  end if;
  if (select count(*) from public.giving_donations where user_id = auth.uid() and status = 'submitted') >= 5 then
    raise exception 'You already have 5 gifts waiting to be verified. Please wait for them to be confirmed.';
  end if;
  if public._giving_utr_taken(v_utr, null) then raise exception 'This UPI reference has already been used.'; end if;
  select * into me from public.profiles where id = auth.uid();
  begin
    insert into public.giving_donations (kind, campaign_id, item_id, user_id, amount_paise, method, utr, payer_name, is_anonymous, message, dedication, donor_batch, donor_department)
    values ('donation', c.id, p_item, auth.uid(), p_amount, 'upi', v_utr, left(nullif(btrim(p_payer), ''), 120), coalesce(p_anonymous, false),
            left(nullif(btrim(p_message), ''), 300), left(nullif(btrim(p_dedication), ''), 150), me.grad_year, me.branch)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This UPI reference has already been used.';
  end;
  return jsonb_build_object('id', v_id, 'status', 'submitted');
end $$;

create or replace function public.giving_my_donations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._giving_member();
  return jsonb_build_object(
    'donations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'amount_paise', d.amount_paise, 'status', d.status, 'created_at', d.created_at,
        'verified_at', d.verified_at, 'receipt_no', d.receipt_no, 'is_anonymous', d.is_anonymous, 'review_note', d.review_note, 'dedication', d.dedication,
        'campaign_title', c.title, 'campaign_slug', c.slug, 'item_name', i.name) order by d.created_at desc)
        from public.giving_donations d left join public.giving_campaigns c on c.id = d.campaign_id left join public.giving_items i on i.id = d.item_id
       where d.user_id = auth.uid()), '[]'::jsonb),
    'pledges', coalesce((select jsonb_agg(jsonb_build_object('campaign_title', c.title, 'campaign_slug', c.slug, 'remind_on', pl.remind_on, 'monthly', pl.monthly, 'amount_paise', pl.amount_paise))
        from public.giving_pledges pl join public.giving_campaigns c on c.id = pl.campaign_id where pl.user_id = auth.uid() and pl.active), '[]'::jsonb),
    'notify_new', coalesce((select notify_new from public.giving_prefs where user_id = auth.uid()), true));
end $$;

-- a receipt for a verified (or refunded) gift: the donor, or an admin who verifies donations
create or replace function public.giving_receipt(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d public.giving_donations;
  s public.giving_settings;
begin
  if auth.uid() is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  select * into d from public.giving_donations where id = p_id;
  if not found or d.receipt_no is null or (d.user_id is distinct from auth.uid() and not public._admin_can('funds_verify')) then
    raise exception 'Receipt not found.';
  end if;
  select * into s from public.giving_settings;
  return jsonb_build_object(
    'receipt_no', d.receipt_no, 'status', d.status, 'amount_paise', d.amount_paise, 'method', d.method, 'utr', d.utr, 'reference', d.reference,
    'date', coalesce(d.received_on::timestamptz, d.verified_at), 'kind', d.kind, 'dedication', d.dedication,
    'donor_name', coalesce((select p.full_name from public.profiles p where p.id = d.user_id), d.donor_name),
    'donor_batch', d.donor_batch,
    'campaign_title', (select c.title from public.giving_campaigns c where c.id = d.campaign_id),
    'item_name', (select i.name from public.giving_items i where i.id = d.item_id),
    'event_title', (select e.title from public.events e where e.id = d.event_id),
    'assoc_name', s.assoc_name, 'assoc_details', s.assoc_details, 'payee_name', s.payee_name, 'footer', s.receipt_footer,
    'tax_text', nullif(btrim(s.tax_text), ''), 'foreign_notice', nullif(btrim(s.foreign_notice), ''));
end $$;

create or replace function public.giving_pledge_set(p_campaign uuid, p_remind_on date, p_monthly boolean, p_amount int)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.giving_campaigns;
begin
  perform public._giving_member();
  select * into c from public.giving_campaigns where id = p_campaign;
  if not found or c.status not in ('live', 'paused') then raise exception 'This appeal is not open for pledges.'; end if;
  if p_remind_on is null or p_remind_on < (now() at time zone 'Asia/Kolkata')::date or p_remind_on > (now() at time zone 'Asia/Kolkata')::date + 400 then
    raise exception 'Choose a reminder date within the next year.';
  end if;
  if p_amount is not null and (p_amount < 1000 or p_amount > 100000000) then raise exception 'A gift must be between ₹10 and ₹10,00,000.'; end if;
  insert into public.giving_pledges (user_id, campaign_id, amount_paise, remind_on, monthly, active)
  values (auth.uid(), p_campaign, p_amount, p_remind_on, coalesce(p_monthly, false), true)
  on conflict (user_id, campaign_id) do update set amount_paise = excluded.amount_paise, remind_on = excluded.remind_on, monthly = excluded.monthly, active = true;
end $$;

create or replace function public.giving_pledge_cancel(p_campaign uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._giving_member();
  update public.giving_pledges set active = false where user_id = auth.uid() and campaign_id = p_campaign;
end $$;

create or replace function public.giving_set_prefs(p_notify_new boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._giving_member();
  insert into public.giving_prefs (user_id, notify_new) values (auth.uid(), coalesce(p_notify_new, true))
  on conflict (user_id) do update set notify_new = excluded.notify_new;
end $$;

-- ------------------------------------------------------------------ admin: campaigns
create or replace function public._giving_slug(p_title text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare s text; base text;
begin
  base := left(trim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g')), 48);
  if base = '' or base is null then base := 'appeal'; end if;
  s := base;
  while exists (select 1 from public.giving_campaigns where slug = s) loop
    s := base || '-' || substr(md5(random()::text), 1, 4);
  end loop;
  return s;
end $$;

create or replace function public._giving_valid_upi(p_upi text)
returns boolean language sql immutable set search_path = '' as $$
  select p_upi ~ '^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,64}$';
$$;

create or replace function public.admin_giving_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._admin_can_any(array['funds_manage', 'funds_verify', 'funds_reports']) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(public._giving_summary(c) || jsonb_build_object(
      'submitted_count', (select count(*) from public.giving_donations d where d.campaign_id = c.id and d.status = 'submitted'),
      'created_at', c.created_at) order by c.created_at desc) from public.giving_campaigns c), '[]'::jsonb);
end $$;

create or replace function public.admin_giving_campaign(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.giving_campaigns;
begin
  perform public._require_perm('funds_manage');
  select * into c from public.giving_campaigns where id = p_id;
  if not found then raise exception 'Appeal not found.'; end if;
  return public._giving_summary(c) || jsonb_build_object(
    'story', c.story, 'suggested_paise', to_jsonb(c.suggested_paise), 'upi_id', c.upi_id, 'payee_name', c.payee_name, 'published_at', c.published_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'description', i.description, 'price_paise', i.price_paise,
        'funded_paise', (select coalesce(sum(d.amount_paise), 0) from public.giving_donations d where d.item_id = i.id and d.status = 'verified')) order by i.sort, i.name)
        from public.giving_items i where i.campaign_id = c.id), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'percent', m.percent, 'title', m.title, 'unlocks', m.unlocks, 'reached_at', m.reached_at) order by m.percent)
        from public.giving_milestones m where m.campaign_id = c.id), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'image_path', u.image_path, 'created_at', u.created_at) order by u.created_at desc)
        from public.giving_updates u where u.campaign_id = c.id), '[]'::jsonb));
end $$;

create or replace function public.admin_giving_save_campaign(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.giving_campaigns;
  v_id uuid := p_id;
  v_type text := p ->> 'type';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_goal bigint;
  v_sugg int[];
  v_upi text := nullif(btrim(coalesce(p ->> 'upi_id', '')), '');
  v_cover text := nullif(p ->> 'cover_path', '');
  v_from timestamptz := nullif(p ->> 'starts_at', '')::timestamptz;
  v_to timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
  it jsonb;
  ms jsonb;
  v_keep uuid[] := '{}';
  v_iid uuid;
  v_n int := 0;
begin
  perform public._require_perm('funds_manage');
  if v_type not in ('project', 'scholarship', 'adopt', 'alumni_fund', 'drive') then raise exception 'Choose what kind of appeal this is.'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'Give the appeal a title (3 to 120 letters).'; end if;
  begin v_goal := (p ->> 'goal_paise')::bigint; exception when others then v_goal := null; end;
  if v_goal is null or v_goal < 100000 or v_goal > 1000000000000 then raise exception 'The goal must be at least ₹1,000.'; end if;
  if p ? 'suggested_paise' and jsonb_typeof(p -> 'suggested_paise') = 'array' and jsonb_array_length(p -> 'suggested_paise') > 0 then
    select array_agg(x::int order by x::int) into v_sugg from jsonb_array_elements_text(p -> 'suggested_paise') x;
    if cardinality(v_sugg) > 8 or exists (select 1 from unnest(v_sugg) a where a < 1000 or a > 100000000) then raise exception 'Suggested amounts must be between ₹10 and ₹10,00,000 (up to 8).'; end if;
  else
    v_sugg := '{50000,100000,250000,500000}';
  end if;
  if v_upi is not null and not public._giving_valid_upi(v_upi) then raise exception 'That UPI id does not look right (example: jecalumni@okicici).'; end if;
  if v_cover is not null and v_cover not like 'giving/%' then raise exception 'Invalid cover picture.'; end if;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'The end date must be after the start date.'; end if;
  if (p ->> 'batch_from') is not null and (p ->> 'batch_to') is not null and (p ->> 'batch_from')::int > (p ->> 'batch_to')::int then raise exception 'Batch "from" must not be after "to".'; end if;

  if v_id is null then
    insert into public.giving_campaigns (slug, type, title, summary, story, goal_paise, starts_at, ends_at, cover_path, suggested_paise, upi_id, payee_name, department, batch_from, batch_to, created_by)
    values (public._giving_slug(v_title), v_type, v_title, left(nullif(btrim(p ->> 'summary'), ''), 300), nullif(btrim(p ->> 'story'), ''), v_goal, v_from, v_to, v_cover, v_sugg, v_upi,
            left(nullif(btrim(p ->> 'payee_name'), ''), 50), nullif(btrim(p ->> 'department'), ''), nullif(p ->> 'batch_from', '')::int, nullif(p ->> 'batch_to', '')::int, auth.uid())
    returning id into v_id;
    perform public._audit('giving_campaign_create', 'giving_campaigns', v_id, jsonb_build_object('title', v_title, 'goal_paise', v_goal, 'type', v_type));
  else
    select * into c from public.giving_campaigns where id = v_id for update;
    if not found then raise exception 'Appeal not found.'; end if;
    update public.giving_campaigns set type = v_type, title = v_title, summary = left(nullif(btrim(p ->> 'summary'), ''), 300), story = nullif(btrim(p ->> 'story'), ''),
      goal_paise = v_goal, starts_at = v_from, ends_at = v_to, cover_path = v_cover, suggested_paise = v_sugg, upi_id = v_upi,
      payee_name = left(nullif(btrim(p ->> 'payee_name'), ''), 50), department = nullif(btrim(p ->> 'department'), ''),
      batch_from = nullif(p ->> 'batch_from', '')::int, batch_to = nullif(p ->> 'batch_to', '')::int, updated_at = now(),
      ending_notified_at = case when v_to is distinct from c.ends_at then null else c.ending_notified_at end
     where id = v_id;
    perform public._audit('giving_campaign_update', 'giving_campaigns', v_id, jsonb_build_object('title', v_title, 'goal_paise_before', c.goal_paise, 'goal_paise', v_goal));
  end if;

  if p ? 'items' and jsonb_typeof(p -> 'items') = 'array' then
    for it in select * from jsonb_array_elements(p -> 'items') loop
      v_n := v_n + 1;
      if char_length(btrim(coalesce(it ->> 'name', ''))) < 2 then raise exception 'Every item needs a name.'; end if;
      if coalesce((it ->> 'price_paise')::bigint, 0) < 1000 then raise exception 'Every item needs a price of at least ₹10.'; end if;
      if nullif(it ->> 'id', '') is not null and exists (select 1 from public.giving_items where id = (it ->> 'id')::uuid and campaign_id = v_id) then
        v_iid := (it ->> 'id')::uuid;
        update public.giving_items set name = btrim(it ->> 'name'), description = left(nullif(btrim(it ->> 'description'), ''), 500), price_paise = (it ->> 'price_paise')::bigint, sort = v_n where id = v_iid;
      else
        insert into public.giving_items (campaign_id, name, description, price_paise, sort)
        values (v_id, btrim(it ->> 'name'), left(nullif(btrim(it ->> 'description'), ''), 500), (it ->> 'price_paise')::bigint, v_n) returning id into v_iid;
      end if;
      v_keep := v_keep || v_iid;
    end loop;
    if exists (select 1 from public.giving_items i join public.giving_donations d on d.item_id = i.id where i.campaign_id = v_id and i.id <> all (v_keep)) then
      raise exception 'An item that already has gifts cannot be removed.';
    end if;
    delete from public.giving_items where campaign_id = v_id and id <> all (v_keep);
  end if;

  if p ? 'milestones' and jsonb_typeof(p -> 'milestones') = 'array' then
    if (select count(distinct (m ->> 'percent')) from jsonb_array_elements(p -> 'milestones') m) <> jsonb_array_length(p -> 'milestones') then
      raise exception 'Each milestone needs a different percentage.';
    end if;
    v_keep := '{}';
    for ms in select * from jsonb_array_elements(p -> 'milestones') loop
      if coalesce((ms ->> 'percent')::int, 0) not between 1 and 100 then raise exception 'A milestone percentage must be between 1 and 100.'; end if;
      if char_length(btrim(coalesce(ms ->> 'title', ''))) < 2 then raise exception 'Every milestone needs a title.'; end if;
      insert into public.giving_milestones (campaign_id, percent, title, unlocks)
      values (v_id, (ms ->> 'percent')::int, btrim(ms ->> 'title'), left(nullif(btrim(ms ->> 'unlocks'), ''), 300))
      on conflict (campaign_id, percent) do update set title = excluded.title, unlocks = excluded.unlocks
      returning id into v_iid;
      v_keep := v_keep || v_iid;
    end loop;
    delete from public.giving_milestones where campaign_id = v_id and id <> all (v_keep);
    perform public._giving_check_milestones(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.admin_giving_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.giving_campaigns;
  s public.giving_settings;
begin
  perform public._require_perm('funds_manage');
  if p_status not in ('draft', 'live', 'paused', 'completed') then raise exception 'Unknown status.'; end if;
  select * into c from public.giving_campaigns where id = p_id for update;
  if not found then raise exception 'Appeal not found.'; end if;
  select * into s from public.giving_settings;
  if p_status = 'live' and c.status = 'draft' then
    if not public._giving_valid_upi(coalesce(nullif(c.upi_id, ''), nullif(s.default_upi_id, ''), '')) then
      raise exception 'Set a UPI id first (on the appeal, or the default in Fund settings).';
    end if;
  end if;
  if p_status = 'draft' and c.status <> 'draft' and exists (select 1 from public.giving_donations where campaign_id = p_id) then
    raise exception 'An appeal that has gifts cannot go back to draft. Pause it instead.';
  end if;
  if p_status = c.status then return; end if;
  update public.giving_campaigns set status = p_status, updated_at = now(),
         published_at = case when p_status = 'live' and published_at is null then now() else published_at end,
         is_featured = case when p_status in ('draft', 'completed') then false else is_featured end
   where id = p_id;
  perform public._audit('giving_campaign_status', 'giving_campaigns', p_id, jsonb_build_object('title', c.title, 'from', c.status, 'to', p_status));
  if p_status = 'live' and c.published_at is null then
    insert into public.notifications (user_id, kind, actor_id, target_id, body)
      select p.id, 'giving_new', null, p_id, left(c.title, 200) from public.profiles p
       where p.verification = 'verified' and p.id is distinct from auth.uid()
         and coalesce((select gp.notify_new from public.giving_prefs gp where gp.user_id = p.id), true);
  end if;
end $$;

create or replace function public.admin_giving_set_featured(p_id uuid, p_featured boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.giving_campaigns;
begin
  perform public._require_perm('funds_manage');
  select * into c from public.giving_campaigns where id = p_id;
  if not found then raise exception 'Appeal not found.'; end if;
  if p_featured and c.status not in ('live', 'paused') then raise exception 'Only a live appeal can be featured.'; end if;
  if p_featured then update public.giving_campaigns set is_featured = false where is_featured and id <> p_id; end if;
  update public.giving_campaigns set is_featured = coalesce(p_featured, false) where id = p_id;
  perform public._audit('giving_campaign_feature', 'giving_campaigns', p_id, jsonb_build_object('title', c.title, 'featured', coalesce(p_featured, false)));
end $$;

create or replace function public.admin_giving_delete_campaign(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.giving_campaigns;
begin
  perform public._require_perm('funds_manage');
  select * into c from public.giving_campaigns where id = p_id;
  if not found then raise exception 'Appeal not found.'; end if;
  if c.status <> 'draft' or exists (select 1 from public.giving_donations where campaign_id = p_id) then
    raise exception 'Only a draft appeal with no gifts can be deleted.';
  end if;
  delete from public.giving_campaigns where id = p_id;
  perform public._audit('giving_campaign_delete', 'giving_campaigns', p_id, jsonb_build_object('title', c.title));
end $$;

create or replace function public.admin_giving_post_update(p_campaign uuid, p_title text, p_body text, p_image text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.giving_campaigns; v_id uuid;
begin
  perform public._require_perm('funds_manage');
  select * into c from public.giving_campaigns where id = p_campaign;
  if not found then raise exception 'Appeal not found.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 2 then raise exception 'Write the update first.'; end if;
  if p_image is not null and p_image not like 'giving/%' then raise exception 'Invalid picture.'; end if;
  insert into public.giving_updates (campaign_id, title, body, image_path, created_by)
  values (p_campaign, left(nullif(btrim(p_title), ''), 120), btrim(p_body), p_image, auth.uid()) returning id into v_id;
  perform public._audit('giving_update_post', 'giving_campaigns', p_campaign, jsonb_build_object('title', c.title));
  if c.status <> 'draft' then
    insert into public.notifications (user_id, kind, actor_id, target_id, body)
      select distinct d.user_id, 'giving_update', null, c.id, left(coalesce(nullif(btrim(p_title), ''), c.title), 200)
        from public.giving_donations d where d.campaign_id = c.id and d.status = 'verified' and d.user_id is not null;
  end if;
  return v_id;
end $$;

create or replace function public.admin_giving_delete_update(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare u public.giving_updates;
begin
  perform public._require_perm('funds_manage');
  delete from public.giving_updates where id = p_id returning * into u;
  if not found then raise exception 'Update not found.'; end if;
  perform public._audit('giving_update_delete', 'giving_campaigns', u.campaign_id, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------------ admin: expenses ("where the money went") and settings
create or replace function public.admin_giving_save_expense(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_camp uuid := nullif(p ->> 'campaign_id', '')::uuid;
  v_event uuid := nullif(p ->> 'event_id', '')::uuid;
  v_amt bigint;
  v_receipt text := nullif(p ->> 'receipt_path', '');
  v_date date;
begin
  perform public._require_perm('funds_manage');
  begin v_amt := (p ->> 'amount_paise')::bigint; exception when others then v_amt := null; end;
  begin v_date := (p ->> 'spent_on')::date; exception when others then v_date := null; end;
  if v_amt is null or v_amt < 100 then raise exception 'Enter the amount spent (at least ₹1).'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Enter the date it was spent (not in the future).'; end if;
  if char_length(btrim(coalesce(p ->> 'description', ''))) < 3 then raise exception 'Describe what the money was spent on.'; end if;
  if v_receipt is not null and v_receipt not like 'giving/%' then raise exception 'Invalid receipt picture.'; end if;
  if v_camp is not null and not exists (select 1 from public.giving_campaigns where id = v_camp) then raise exception 'Appeal not found.'; end if;
  if v_event is not null and (v_camp is not null or not exists (select 1 from public.events where id = v_event)) then raise exception 'Choose either an appeal or an event, not both.'; end if;
  if v_id is null then
    insert into public.giving_expenses (campaign_id, event_id, description, amount_paise, spent_on, receipt_path, created_by)
    values (v_camp, v_event, btrim(p ->> 'description'), v_amt, v_date, v_receipt, auth.uid()) returning id into v_id;
    perform public._audit('giving_expense_add', 'giving_expenses', v_id, jsonb_build_object('amount_paise', v_amt, 'description', left(p ->> 'description', 80)));
  else
    update public.giving_expenses set campaign_id = v_camp, event_id = v_event, description = btrim(p ->> 'description'), amount_paise = v_amt, spent_on = v_date, receipt_path = v_receipt where id = v_id;
    if not found then raise exception 'Expense not found.'; end if;
    perform public._audit('giving_expense_update', 'giving_expenses', v_id, jsonb_build_object('amount_paise', v_amt));
  end if;
  return v_id;
end $$;

create or replace function public.admin_giving_delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.giving_expenses;
begin
  perform public._require_perm('funds_manage');
  delete from public.giving_expenses where id = p_id returning * into e;
  if not found then raise exception 'Expense not found.'; end if;
  perform public._audit('giving_expense_delete', 'giving_expenses', p_id, jsonb_build_object('amount_paise', e.amount_paise, 'description', left(e.description, 80)));
end $$;

create or replace function public.admin_giving_expenses(p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._admin_can_any(array['funds_manage', 'funds_reports']) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'campaign_id', e.campaign_id, 'event_id', e.event_id, 'campaign_title', coalesce(c.title, ev.title), 'description', e.description,
      'amount_paise', e.amount_paise, 'spent_on', e.spent_on, 'receipt_path', e.receipt_path) order by e.spent_on desc, e.created_at desc)
      from public.giving_expenses e left join public.giving_campaigns c on c.id = e.campaign_id left join public.events ev on ev.id = e.event_id where p_campaign is null or e.campaign_id = p_campaign), '[]'::jsonb);
end $$;

create or replace function public.admin_giving_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._admin_can_any(array['funds_manage', 'funds_verify', 'funds_reports']) then
    raise exception 'You do not have permission to do this. Ask a super admin for access.' using errcode = '42501';
  end if;
  return (select to_jsonb(s) - 'reminders_run_at' - 'id' from public.giving_settings s);
end $$;

create or replace function public.admin_giving_save_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_upi text := nullif(btrim(coalesce(p ->> 'default_upi_id', '')), '');
begin
  perform public._require_perm('funds_manage');
  if v_upi is not null and not public._giving_valid_upi(v_upi) then raise exception 'That UPI id does not look right (example: jecalumni@okicici).'; end if;
  update public.giving_settings set default_upi_id = v_upi,
    payee_name = left(nullif(btrim(p ->> 'payee_name'), ''), 50), assoc_name = left(nullif(btrim(p ->> 'assoc_name'), ''), 120),
    assoc_details = left(nullif(btrim(p ->> 'assoc_details'), ''), 600), receipt_footer = left(nullif(btrim(p ->> 'receipt_footer'), ''), 600),
    tax_text = left(nullif(btrim(p ->> 'tax_text'), ''), 600), foreign_notice = left(nullif(btrim(p ->> 'foreign_notice'), ''), 600), updated_at = now()
   where id;
  perform public._audit('giving_settings_save', 'giving_settings', null, jsonb_build_object('default_upi_id', v_upi));
end $$;

create or replace function public.admin_giving_run_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public._require_perm('funds_manage');
  n := public._giving_run_reminders();
  update public.giving_settings set reminders_run_at = now() where id;
  return n;
end $$;

-- ------------------------------------------------------------------ admin: verification queue
create or replace function public.admin_giving_donations(p_status text default 'submitted', p_campaign uuid default null, p_q text default null, p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_perm('funds_verify');
  return coalesce((select jsonb_agg(r) from (
    select jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'amount_paise', d.amount_paise, 'method', d.method, 'utr', d.utr, 'reference', d.reference,
        'created_at', d.created_at, 'verified_at', d.verified_at, 'receipt_no', d.receipt_no, 'is_anonymous', d.is_anonymous, 'message', d.message, 'dedication', d.dedication,
        'donor_name', coalesce(p.full_name, d.donor_name), 'payer_name', d.payer_name, 'donor_batch', d.donor_batch, 'user_id', d.user_id,
        'campaign_id', d.campaign_id, 'campaign_title', coalesce(c.title, e.title), 'item_name', i.name, 'sponsor_id', d.sponsor_id,
        'offline_reason', d.offline_reason, 'review_note', d.review_note, 'refund_reason', d.refund_reason,
        'utr_conflict', d.utr is not null and public._giving_utr_taken(d.utr, d.id) and (
            exists (select 1 from public.event_payments ep where ep.utr = d.utr and ep.status <> 'rejected')
            or exists (select 1 from public.giving_donations o where o.utr = d.utr and o.id <> d.id and o.status <> 'rejected'))) as r
      from public.giving_donations d
      left join public.profiles p on p.id = d.user_id
      left join public.giving_campaigns c on c.id = d.campaign_id
      left join public.events e on e.id = d.event_id
      left join public.giving_items i on i.id = d.item_id
     where (p_status is null or p_status = 'all' or d.status = p_status)
       and (p_campaign is null or d.campaign_id = p_campaign)
       and (nullif(btrim(p_q), '') is null or d.utr = btrim(p_q) or coalesce(p.full_name, d.donor_name, '') ilike '%' || btrim(p_q) || '%' or d.receipt_no ilike '%' || btrim(p_q) || '%')
     order by d.created_at desc limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) x), '[]'::jsonb);
end $$;

create or replace function public.admin_giving_verify(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.giving_donations;
  v_id uuid;
  v_ok int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_camps uuid[] := '{}';
  v_title text;
begin
  perform public._require_perm('funds_verify');
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 200 then raise exception 'Choose between 1 and 200 gifts.'; end if;
  foreach v_id in array p_ids loop
    select * into d from public.giving_donations where id = v_id for update;
    if not found then v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'Not found'); continue; end if;
    if d.status <> 'submitted' then v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'Already ' || d.status); continue; end if;
    if d.utr is not null and exists (select 1 from public.event_payments e where e.utr = d.utr and e.status <> 'rejected') then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'This UTR is also used by an event payment'); continue;
    end if;
    update public.giving_donations set status = 'verified', verified_at = now(), reviewed_by = auth.uid(), reviewed_at = now(), receipt_no = public._giving_receipt_no()
     where id = v_id returning * into d;
    v_ok := v_ok + 1;
    perform public._audit('giving_verify', 'giving_donations', d.id, jsonb_build_object('amount_paise', d.amount_paise, 'utr', d.utr, 'receipt_no', d.receipt_no, 'campaign_id', d.campaign_id));
    if d.user_id is not null then
      select coalesce((select c.title from public.giving_campaigns c where c.id = d.campaign_id), (select e.title from public.events e where e.id = d.event_id), '') into v_title;
      perform public._notify(d.user_id, 'donation_verified', auth.uid(), d.id, v_title || '|' || d.amount_paise);
    end if;
    if d.campaign_id is not null and not d.campaign_id = any (v_camps) then v_camps := v_camps || d.campaign_id; end if;
    perform public._giving_after_change(d);
  end loop;
  foreach v_id in array v_camps loop perform public._giving_check_milestones(v_id); end loop;
  return jsonb_build_object('verified', v_ok, 'skipped', v_skipped);
end $$;

create or replace function public.admin_giving_reject(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.giving_donations;
begin
  perform public._require_perm('funds_verify');
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why (the donor will see it).'; end if;
  select * into d from public.giving_donations where id = p_id for update;
  if not found then raise exception 'Gift not found.'; end if;
  if d.status <> 'submitted' then raise exception 'Only a gift waiting for review can be rejected.'; end if;
  update public.giving_donations set status = 'rejected', review_note = left(btrim(p_note), 500), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id returning * into d;
  perform public._audit('giving_reject', 'giving_donations', p_id, jsonb_build_object('amount_paise', d.amount_paise, 'utr', d.utr, 'note', left(btrim(p_note), 200)));
  if d.user_id is not null then perform public._notify(d.user_id, 'donation_rejected', auth.uid(), d.id, left(btrim(p_note), 150)); end if;
  perform public._giving_after_change(d);
end $$;

create or replace function public.admin_giving_refund(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.giving_donations;
begin
  perform public._require_perm('funds_verify');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why the gift is refunded.'; end if;
  select * into d from public.giving_donations where id = p_id for update;
  if not found then raise exception 'Gift not found.'; end if;
  if d.status <> 'verified' then raise exception 'Only a verified gift can be refunded.'; end if;
  update public.giving_donations set status = 'refunded', refund_reason = left(btrim(p_reason), 500), refunded_at = now(), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id returning * into d;
  perform public._audit('giving_refund', 'giving_donations', p_id, jsonb_build_object('amount_paise', d.amount_paise, 'reason', left(btrim(p_reason), 200)));
  if d.user_id is not null then perform public._notify(d.user_id, 'donation_refunded', auth.uid(), d.id, left(btrim(p_reason), 150)); end if;
  perform public._giving_after_change(d);
end $$;

create or replace function public.admin_giving_record_offline(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_camp uuid := nullif(p ->> 'campaign_id', '')::uuid;
  v_item uuid := nullif(p ->> 'item_id', '')::uuid;
  v_user uuid := nullif(p ->> 'user_id', '')::uuid;
  v_name text := left(nullif(btrim(p ->> 'donor_name'), ''), 120);
  v_amt int;
  v_method text := p ->> 'method';
  v_ref text := left(nullif(btrim(p ->> 'reference'), ''), 120);
  v_utr text;
  v_date date;
  v_prof public.profiles;
  d public.giving_donations;
begin
  perform public._require_perm('funds_verify');
  begin v_amt := (p ->> 'amount_paise')::int; exception when others then v_amt := null; end;
  begin v_date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone 'Asia/Kolkata')::date); exception when others then v_date := null; end;
  if v_amt is null or v_amt < 1000 or v_amt > 100000000 then raise exception 'A gift must be between ₹10 and ₹10,00,000.'; end if;
  if v_method not in ('cash', 'cheque', 'bank_transfer') then raise exception 'Choose cash, cheque or bank transfer.'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The date received cannot be in the future.'; end if;
  if char_length(btrim(coalesce(p ->> 'reason', ''))) < 3 then raise exception 'Say why this is recorded by hand (for the records).'; end if;
  if v_user is null and v_name is null then raise exception 'Choose the member or type the donor''s name.'; end if;
  if not exists (select 1 from public.giving_campaigns where id = v_camp and status <> 'draft') then raise exception 'Choose an appeal that has been published.'; end if;
  if v_item is not null and not exists (select 1 from public.giving_items where id = v_item and campaign_id = v_camp) then raise exception 'That item is not part of this appeal.'; end if;
  if v_method = 'bank_transfer' and public._giving_clean_utr(v_ref) ~ '^[0-9]{12}$' then
    v_utr := public._giving_clean_utr(v_ref);
    if public._giving_utr_taken(v_utr, null) then raise exception 'This UPI reference has already been used.'; end if;
  end if;
  if v_user is not null then select * into v_prof from public.profiles where id = v_user; if not found then raise exception 'Member not found.'; end if; end if;
  insert into public.giving_donations (kind, campaign_id, item_id, user_id, donor_name, amount_paise, method, utr, reference, status, is_anonymous, message, dedication,
                                       donor_batch, donor_department, offline_reason, reviewed_by, reviewed_at, verified_at, received_on, receipt_no)
  values ('donation', v_camp, v_item, v_user, v_name, v_amt, v_method, v_utr, v_ref, 'verified', coalesce((p ->> 'anonymous')::boolean, false),
          left(nullif(btrim(p ->> 'message'), ''), 300), left(nullif(btrim(p ->> 'dedication'), ''), 150), v_prof.grad_year, v_prof.branch,
          left(btrim(p ->> 'reason'), 500), auth.uid(), now(), now(), v_date, public._giving_receipt_no())
  returning * into d;
  perform public._audit('giving_record_offline', 'giving_donations', d.id, jsonb_build_object('amount_paise', v_amt, 'method', v_method, 'reason', left(p ->> 'reason', 200), 'campaign_id', v_camp));
  if v_user is not null then perform public._notify(v_user, 'donation_verified', auth.uid(), d.id, (select title from public.giving_campaigns where id = v_camp) || '|' || v_amt); end if;
  perform public._giving_check_milestones(v_camp);
  perform public._giving_after_change(d);
  return d.id;
end $$;

-- ------------------------------------------------------------------ admin: reports
create or replace function public.admin_giving_report(p_kind text, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_names boolean;
begin
  perform public._require_perm('funds_reports');
  v_names := public._admin_can('funds_verify');
  if p_kind = 'campaign' then
    return coalesce((select jsonb_agg(jsonb_build_object('campaign_id', c.id, 'title', c.title, 'type', c.type, 'status', c.status, 'goal_paise', c.goal_paise,
        'raised_paise', public._giving_raised(c.id),
        'pending_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations d where d.campaign_id = c.id and d.status = 'submitted'),
        'refunded_paise', (select coalesce(sum(amount_paise), 0) from public.giving_donations d where d.campaign_id = c.id and d.status = 'refunded'),
        'gifts', (select count(*) from public.giving_donations d where d.campaign_id = c.id and d.status = 'verified'),
        'spent_paise', (select coalesce(sum(amount_paise), 0) from public.giving_expenses x where x.campaign_id = c.id)) order by c.created_at desc)
        from public.giving_campaigns c where p_campaign is null or c.id = p_campaign), '[]'::jsonb);
  elsif p_kind = 'batch' then
    return coalesce((select jsonb_agg(r order by (r ->> 'raised_paise')::bigint desc) from (
      select jsonb_build_object('batch', d.donor_batch, 'raised_paise', sum(d.amount_paise)::bigint, 'gifts', count(*), 'donors', count(distinct coalesce(d.user_id::text, d.id::text))) as r
        from public.giving_donations d where d.status = 'verified' and (p_campaign is null or d.campaign_id = p_campaign) group by d.donor_batch) t), '[]'::jsonb);
  elsif p_kind = 'department' then
    return coalesce((select jsonb_agg(r order by (r ->> 'raised_paise')::bigint desc) from (
      select jsonb_build_object('department', d.donor_department, 'raised_paise', sum(d.amount_paise)::bigint, 'gifts', count(*), 'donors', count(distinct coalesce(d.user_id::text, d.id::text))) as r
        from public.giving_donations d where d.status = 'verified' and (p_campaign is null or d.campaign_id = p_campaign) group by d.donor_department) t), '[]'::jsonb);
  elsif p_kind = 'month' then
    return coalesce((select jsonb_agg(r order by r ->> 'month' desc) from (
      select jsonb_build_object('month', to_char(d.verified_at at time zone 'Asia/Kolkata', 'YYYY-MM'), 'raised_paise', sum(d.amount_paise)::bigint, 'gifts', count(*)) as r
        from public.giving_donations d where d.status = 'verified' and (p_campaign is null or d.campaign_id = p_campaign) group by 1) t), '[]'::jsonb);
  elsif p_kind = 'donor' then
    return coalesce((select jsonb_agg(r order by (r ->> 'total_paise')::bigint desc) from (
      select jsonb_build_object('name', case when d.is_anonymous and not v_names then 'A JECian' else coalesce(p.full_name, d.donor_name, 'A JECian') end,
          'batch', case when d.is_anonymous and not v_names then null else d.donor_batch end, 'anonymous', d.is_anonymous,
          'gifts', 1, 'total_paise', d.amount_paise::bigint, 'last', d.verified_at, 'campaign', coalesce(c.title, e.title), 'receipt_no', d.receipt_no) as r
        from public.giving_donations d left join public.profiles p on p.id = d.user_id left join public.giving_campaigns c on c.id = d.campaign_id left join public.events e on e.id = d.event_id
       where d.status = 'verified' and (p_campaign is null or d.campaign_id = p_campaign)) t), '[]'::jsonb);
  end if;
  raise exception 'Unknown report.';
end $$;

create or replace function public.admin_giving_log_export(p_what text, p_count int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_perm('funds_reports');
  if p_what not in ('campaign', 'batch', 'department', 'month', 'donor', 'sponsors', 'sponsor_tiers', 'sponsor_outstanding') then raise exception 'Unknown export.'; end if;
  perform public._audit('export_giving_data', 'giving_donations', null, jsonb_build_object('what', p_what, 'rows', coalesce(p_count, 0)));
end $$;

-- ------------------------------------------------------------------ the old event payment path must also refuse a UTR a donor already used
select pg_temp.patch('submit_upi_payment', $$    raise exception 'This UPI reference has already been used';
  end if;$$, $$    raise exception 'This UPI reference has already been used';
  end if;
  if exists (select 1 from public.giving_donations g where g.utr = v_utr and g.status <> 'rejected') then
    raise exception 'This UPI reference has already been used';
  end if;$$);

-- ------------------------------------------------------------------ cron (when available)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('giving-reminders', '7 * * * *', 'select public._giving_run_reminders()');
    exception when others then
      raise notice 'pg_cron is not usable here: giving reminders run when someone opens the Give Back page';
    end;
  end if;
end $$;

-- ------------------------------------------------------------------ privileges: internal helpers closed, the rest for signed-in people only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_giving\_%' or p.proname like 'giving\_%' or p.proname like 'admin\_giving\_%') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname not like '\_%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
