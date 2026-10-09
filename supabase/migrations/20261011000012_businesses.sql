-- Alumni business directory ("JEC Businesses"): verified alumni list their business or services so batchmates can support them.
-- Listings are created and edited only through functions (validation, max 3 per member); reports auto-hide at 3, admins moderate.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  category text not null check (category in ('IT & Software', 'Consulting', 'Manufacturing', 'Education & Coaching', 'Food & Hospitality',
    'Health & Wellness', 'Real Estate', 'Finance & Legal', 'Retail & E-commerce', 'Media & Design', 'Travel', 'Other')),
  city text not null check (char_length(city) between 2 and 80),
  description text not null check (char_length(description) between 20 and 1500),
  offer text check (offer is null or char_length(offer) between 1 and 200),
  website_url text check (website_url is null or (char_length(website_url) <= 300 and website_url ~* '^https?://[^[:space:]]+$')),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{8,16}$'),
  whatsapp boolean not null default false,          -- the phone number is on WhatsApp
  email text check (email is null or (char_length(email) <= 200 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  logo_path text check (logo_path is null or char_length(logo_path) <= 300),
  is_hidden boolean not null default false,          -- moderation
  created_at timestamptz not null default now(),
  check (not whatsapp or phone is not null),
  check (website_url is not null or phone is not null or email is not null)  -- a way to reach the business
);
create index businesses_listing_idx on public.businesses (created_at desc) where not is_hidden;
create index businesses_owner_idx on public.businesses (owner_id, created_at desc);

alter table public.businesses enable row level security;
create policy "see businesses" on public.businesses for select to authenticated using (
  public.is_admin() or owner_id = auth.uid() or (public.is_verified() and not is_hidden));
create policy "delete own business" on public.businesses for delete to authenticated using (owner_id = auth.uid());
grant select, delete on public.businesses to authenticated;

-- Shared normalisation of the form fields (friendly errors; the table checks are the backstop).
create or replace function public._business_clean(p_fields jsonb)
returns public.businesses
language plpgsql
immutable
set search_path = ''
as $$
declare
  b public.businesses;
begin
  b.name := btrim(coalesce(p_fields ->> 'name', ''));
  b.category := btrim(coalesce(p_fields ->> 'category', ''));
  b.city := btrim(coalesce(p_fields ->> 'city', ''));
  b.description := btrim(coalesce(p_fields ->> 'description', ''));
  b.offer := nullif(btrim(coalesce(p_fields ->> 'offer', '')), '');
  b.website_url := nullif(btrim(coalesce(p_fields ->> 'website_url', '')), '');
  b.phone := nullif(btrim(coalesce(p_fields ->> 'phone', '')), '');
  b.email := nullif(btrim(coalesce(p_fields ->> 'email', '')), '');
  b.whatsapp := coalesce((p_fields ->> 'whatsapp')::boolean, false);
  b.logo_path := nullif(btrim(coalesce(p_fields ->> 'logo_path', '')), '');
  if char_length(b.name) < 2 then raise exception 'Please enter the business name'; end if;
  if char_length(b.city) < 2 then raise exception 'Please enter the city'; end if;
  if char_length(b.description) < 20 then raise exception 'Describe the business in at least 20 characters'; end if;
  if b.website_url is null and b.phone is null and b.email is null then
    raise exception 'Add a website, phone or email so people can reach you';
  end if;
  return b;
end;
$$;

create or replace function public.add_business(p_fields jsonb)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.businesses;
  b public.businesses;
begin
  if not public.is_verified() then
    raise exception 'Only verified members can list a business' using errcode = '42501';
  end if;
  if (select count(*) from public.businesses where owner_id = auth.uid()) >= 3 then
    raise exception 'You can list up to 3 businesses. Remove one to add another.';
  end if;
  c := public._business_clean(p_fields);
  insert into public.businesses (owner_id, name, category, city, description, offer, website_url, phone, whatsapp, email, logo_path)
  values (auth.uid(), c.name, c.category, c.city, c.description, c.offer, c.website_url, c.phone, c.whatsapp, c.email, c.logo_path)
  returning * into b;
  return b;
end;
$$;

create or replace function public.update_my_business(p_id uuid, p_fields jsonb)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.businesses;
  b public.businesses;
begin
  c := public._business_clean(p_fields);
  update public.businesses set name = c.name, category = c.category, city = c.city, description = c.description, offer = c.offer,
         website_url = c.website_url, phone = c.phone, whatsapp = c.whatsapp, email = c.email, logo_path = c.logo_path
   where id = p_id and owner_id = auth.uid()
   returning * into b;
  if not found then raise exception 'Business not found' using errcode = '42501'; end if;
  return b;
end;
$$;

-- Directory search, newest first. The query matches name, city and description; wildcards are literal.
create or replace function public.search_businesses(p_query text default null, p_category text default null, p_city text default null,
                                                    p_limit int default 30, p_offset int default 0)
returns table (id uuid, name text, category text, city text, description text, offer text, website_url text, phone text, whatsapp boolean,
               email text, logo_path text, created_at timestamptz, owner_id uuid, owner_name text, owner_avatar text, owner_batch int)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.category, b.city, b.description, b.offer, b.website_url, b.phone, b.whatsapp, b.email, b.logo_path, b.created_at,
         p.id, p.full_name, p.avatar_url, p.grad_year
    from public.businesses b
    join public.profiles p on p.id = b.owner_id
   where public.is_verified() and not b.is_hidden
     and not public.is_blocked_between(b.owner_id, auth.uid())
     and (p_category is null or btrim(p_category) = '' or b.category = p_category)
     and (coalesce(btrim(p_city), '') = '' or b.city ilike '%' || replace(replace(replace(btrim(p_city), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (coalesce(btrim(p_query), '') = ''
          or b.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or b.city ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or b.description ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by b.created_at desc
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

-- Reports and moderation reach businesses too.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'comment', 'profile', 'message', 'job', 'help', 'business'));

create or replace function public.report_business(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where id = p_id and not is_hidden;
  if not found or not public.is_verified() then raise exception 'Business not found' using errcode = '42501'; end if;
  if b.owner_id = auth.uid() then raise exception 'You can’t report your own listing'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'business', p_id, left(btrim(p_reason), 500), left(b.name || ' (' || b.category || ', ' || b.city || ')', 500))
  on conflict (reporter, target_type, target_id) do nothing;
end;
$$;

create or replace function public._auto_hide_businesses()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'business' and (select count(*) from public.reports where target_type = 'business' and target_id = new.target_id) >= 3 then
    update public.businesses set is_hidden = true where id = new.target_id;
  end if;
  return null;
end;
$$;
create trigger reports_auto_hide_businesses after insert on public.reports for each row execute function public._auto_hide_businesses();

-- extends the version from the Ask JEC migration
create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_report_status text default 'actioned')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  if p_type = 'post' then update public.posts set is_hidden = p_hide where id = p_id;
  elsif p_type = 'comment' then update public.comments set is_hidden = p_hide where id = p_id;
  elsif p_type = 'job' then update public.jobs set is_hidden = p_hide where id = p_id;
  elsif p_type = 'help' then update public.help_requests set is_hidden = p_hide where id = p_id;
  elsif p_type = 'business' then update public.businesses set is_hidden = p_hide where id = p_id;
  end if;
  update public.reports set status = p_report_status, handled_by = auth.uid() where target_type = p_type and target_id = p_id and status = 'open';
  perform public._audit(case when p_hide then 'hide_' else 'restore_' end || p_type, p_type || 's', p_id, jsonb_build_object('reports', p_report_status));
end;
$$;

create or replace function public.admin_reports(p_status text default 'open')
returns table (target_type text, target_id uuid, report_count bigint, last_reported timestamptz, reasons text,
               preview text, author_id uuid, author_name text, removed boolean, place text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can view reports' using errcode = '42501'; end if;
  return query
  with g as (
    select r.target_type, r.target_id, count(*) as n, max(r.created_at) as last_at,
           string_agg(distinct r.reason, ' · ') as reasons, (array_agg(r.snapshot) filter (where r.snapshot is not null))[1] as snap
      from public.reports r where r.status = p_status group by r.target_type, r.target_id),
  src as (
    select g.*,
      case g.target_type
        when 'post' then (select left(po.body, 300) from public.posts po where po.id = g.target_id)
        when 'comment' then (select left(co.body, 300) from public.comments co where co.id = g.target_id)
        when 'message' then coalesce((select left(me.body, 300) from public.messages me where me.id = g.target_id and me.deleted_at is null), g.snap)
        when 'job' then coalesce((select left(jo.title || ' at ' || jo.company || E'\n' || jo.description, 300) from public.jobs jo where jo.id = g.target_id), g.snap)
        when 'help' then coalesce((select left(hr.title || coalesce(E'\n' || hr.body, ''), 300) from public.help_requests hr where hr.id = g.target_id), g.snap)
        when 'business' then coalesce((select left(bu.name || ' (' || bu.category || ', ' || bu.city || ')' || E'\n' || bu.description, 300) from public.businesses bu where bu.id = g.target_id), g.snap)
        when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)
      end as prev,
      case g.target_type
        when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
        when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
        when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
        when 'job' then (select jo.posted_by from public.jobs jo where jo.id = g.target_id)
        when 'help' then (select hr.author_id from public.help_requests hr where hr.id = g.target_id)
        when 'business' then (select bu.owner_id from public.businesses bu where bu.id = g.target_id)
        when 'profile' then g.target_id
      end as who,
      case g.target_type
        when 'post' then (select po.is_hidden from public.posts po where po.id = g.target_id)
        when 'comment' then (select co.is_hidden from public.comments co where co.id = g.target_id)
        when 'message' then coalesce((select me.deleted_at is not null from public.messages me where me.id = g.target_id), true)
        when 'job' then coalesce((select jo.is_hidden from public.jobs jo where jo.id = g.target_id), true)
        when 'help' then coalesce((select hr.is_hidden from public.help_requests hr where hr.id = g.target_id), true)
        when 'business' then coalesce((select bu.is_hidden from public.businesses bu where bu.id = g.target_id), true)
        else false
      end as gone,
      case g.target_type
        when 'message' then (select coalesce(gr.name, 'Direct message') from public.messages me join public.chats ch on ch.id = me.chat_id left join public.groups gr on gr.id = ch.group_id where me.id = g.target_id)
        when 'post' then (select coalesce(gr.name, 'Public feed') from public.posts po left join public.groups gr on gr.id = po.group_id where po.id = g.target_id)
        when 'job' then 'Jobs'
        when 'help' then 'Ask JEC'
        when 'business' then 'Businesses'
      end as pl
    from g)
  select src.target_type, src.target_id, src.n, src.last_at, src.reasons, src.prev, src.who,
         (select p2.full_name from public.profiles p2 where p2.id = src.who), src.gone, src.pl
    from src order by src.last_at desc limit 100;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['add_business(jsonb)', 'update_my_business(uuid, jsonb)',
    'search_businesses(text, text, text, int, int)', 'report_business(uuid, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public._business_clean(jsonb) from anon, authenticated, public;
  revoke execute on function public._auto_hide_businesses() from anon, authenticated, public;
end $$;
