-- DIGITAL ALUMNI ID CARD.
--
--   member_cards         one row per member, made the moment they are first verified (backfilled below for everyone verified
--                        before this migration, oldest account first). serial comes from a sequence and is NEVER changed or
--                        reused (it stays reserved even if the member is later un-verified), so the membership number
--                        JEC-<batch>-<serial, 6 digits> is stable. The first 500 serials are the "founding members".
--   member_card_tokens   the random, unguessable token behind the card's QR code (32 hex = 122 random bits). One active token
--                        per member; the owner can regenerate it (old one stops working) or revoke it (card shows no QR).
--                        Revoked tokens are kept so a check can say "revoked" instead of "unknown".
--   card_verify_log      rate limiting for the public check: an md5 of the caller's address (or user id) and a time. No token,
--                        no address.
--   my_id_card()         the member's own card.
--   verify_id_card(t)    anyone (anon too): status + name, batch, branch, verified, and the photo ONLY when the member allowed it
--                        (member_showcase_prefs.card_show_photo). No ids, no contact data. 30 checks per 10 minutes per caller.
-- None of the tables has a grant: everything goes through the functions.

create sequence if not exists public.member_card_serial as bigint start 1;
revoke all on sequence public.member_card_serial from public, anon, authenticated;

create table if not exists public.member_cards (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  serial bigint not null unique default nextval('public.member_card_serial') check (serial > 0),
  issued_at timestamptz not null default now()
);
alter sequence public.member_card_serial owned by public.member_cards.serial;

create table if not exists public.member_card_tokens (
  token text primary key check (token ~ '^[0-9a-f]{32}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists member_card_tokens_active_idx on public.member_card_tokens (user_id) where revoked_at is null;
create index if not exists member_card_tokens_user_idx on public.member_card_tokens (user_id, created_at desc);

create table if not exists public.card_verify_log (
  client text not null check (client ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
create index if not exists card_verify_log_idx on public.card_verify_log (client, created_at desc);

alter table public.member_cards enable row level security;
alter table public.member_card_tokens enable row level security;
alter table public.card_verify_log enable row level security;
revoke all on public.member_cards, public.member_card_tokens, public.card_verify_log from public, anon, authenticated;

-- ------------------------------------------------------------------ helpers
-- JEC-2008-000123 (JEC-000123 when the batch is unknown). Mirrors formatMembershipNo() in src/features/idcard/card.ts.
create or replace function public.membership_no(p_grad_year int, p_serial bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_serial is null then null
              else 'JEC-' || coalesce(p_grad_year::text || '-', '')
                   || case when p_serial < 1000000 then lpad(p_serial::text, 6, '0') else p_serial::text end end;
$$;

create or replace function public._new_card_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '');
$$;

-- a card (and a first token) the first time a member is verified
create or replace function public._issue_member_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification = 'verified' and (tg_op = 'INSERT' or old.verification is distinct from 'verified') then
    insert into public.member_cards (user_id) values (new.id) on conflict (user_id) do nothing;
    if found then
      insert into public.member_card_tokens (token, user_id) values (public._new_card_token(), new.id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_issue_member_card on public.profiles;
create trigger profiles_issue_member_card after insert or update of verification on public.profiles
  for each row execute function public._issue_member_card();

-- backfill in join order (idempotent: members who already hold a card are skipped)
do $$
declare r record;
begin
  for r in select p.id from public.profiles p
            where p.verification = 'verified' and not exists (select 1 from public.member_cards c where c.user_id = p.id)
            order by p.created_at, p.id loop
    insert into public.member_cards (user_id, issued_at) values (r.id, now()) on conflict (user_id) do nothing;
    insert into public.member_card_tokens (token, user_id)
      select public._new_card_token(), r.id
       where not exists (select 1 from public.member_card_tokens t where t.user_id = r.id);
  end loop;
end $$;

-- the roles a member holds, as keys the app turns into labels (Organiser, Moderator, ...)
create or replace function public._member_role_keys(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p.is_super_admin then 'owner' end,
    case when p.is_admin then 'admin' end,
    case when p.is_admin or exists (select 1 from public.event_staff s where s.user_id = p.id) then 'organiser' end,
    case when exists (select 1 from public.site_roles r where r.user_id = p.id and r.role = 'moderator') then 'moderator' end,
    case when p.is_admin and exists (select 1 from public.admin_grants g where g.user_id = p.id
                                      and (g.template_key = 'batch_rep' or g.scope_kind = 'batch')) then 'batch_rep' end,
    case when p.is_admin and exists (select 1 from public.admin_grants g where g.user_id = p.id
                                      and (g.template_key = 'department_head' or g.scope_kind = 'department')) then 'department_head' end,
    case when exists (select 1 from public.mentor_profiles m where m.user_id = p.id and m.is_accepting) then 'mentor' end
  ], null)
    from public.profiles p where p.id = p_user;
$$;

-- ------------------------------------------------------------------ the member's own card
create or replace function public.my_id_card()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'status', case when p.verification = 'verified' and c.user_id is not null then 'active'
                   when p.verification = 'rejected' then 'rejected' else 'pending' end,
    'membership_no', case when p.verification = 'verified' then public.membership_no(p.grad_year, c.serial) end,
    'serial', case when p.verification = 'verified' then c.serial end,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'grad_year', p.grad_year,
    'join_year', p.join_year,
    'branch', p.branch,
    'member_type', p.member_type,
    'verified', p.verification = 'verified',
    'member_since', c.issued_at,
    'joined_app_at', p.created_at,
    'roles', to_jsonb(coalesce(public._member_role_keys(p.id), '{}'::text[])),
    'token', case when p.verification = 'verified' then t.token end,
    'token_created_at', case when p.verification = 'verified' then t.created_at end,
    'card_show_photo', coalesce(s.card_show_photo, false)) end
    from public.profiles p
    left join public.member_cards c on c.user_id = p.id
    left join public.member_card_tokens t on t.user_id = p.id and t.revoked_at is null
    left join public.member_showcase_prefs s on s.user_id = p.id
   where p.id = auth.uid();
$$;

-- a new QR token (the old one stops working at once)
create or replace function public.regenerate_my_id_card_token()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  if not exists (select 1 from public.member_cards c join public.profiles p on p.id = c.user_id
                  where c.user_id = me and p.verification = 'verified') then
    raise exception 'Your ID card is ready once your membership is verified' using errcode = '42501', hint = 'card.errNotVerified';
  end if;
  select count(*) into n from public.member_card_tokens where user_id = me and created_at > now() - interval '1 day';
  if n >= 10 then
    raise exception 'You made many new codes today. Please try again tomorrow.' using errcode = 'P0001', hint = 'card.errTooMany';
  end if;
  update public.member_card_tokens set revoked_at = now() where user_id = me and revoked_at is null;
  insert into public.member_card_tokens (token, user_id) values (public._new_card_token(), me);
  return public.my_id_card();
end;
$$;

-- switch the QR off (until a new one is made)
create or replace function public.revoke_my_id_card_token()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  update public.member_card_tokens set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
  return public.my_id_card();
end;
$$;

-- ------------------------------------------------------------------ the public check behind the QR code
create or replace function public.verify_id_card(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hdr jsonb;
  who text;
  v_client text;
  n int;
  t public.member_card_tokens;
  p public.profiles;
  show_photo boolean;
  tok text := lower(btrim(coalesce(p_token, '')));
begin
  -- who is asking: the signed-in member, or the first address the gateway saw. Only an md5 of it is stored.
  begin hdr := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then hdr := null; end;
  who := coalesce(auth.uid()::text,
                  nullif(btrim(split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1)), ''),
                  nullif(btrim(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', '')), ''),
                  'unknown');
  v_client := md5('jec-card|' || who);
  delete from public.card_verify_log l where l.client = v_client and l.created_at < now() - interval '1 day';
  if random() < 0.02 then delete from public.card_verify_log l where l.created_at < now() - interval '1 day'; end if;
  select count(*) into n from public.card_verify_log l where l.client = v_client and l.created_at > now() - interval '10 minutes';
  if n >= 30 then
    return jsonb_build_object('status', 'rate_limited', 'valid', false);
  end if;
  insert into public.card_verify_log (client) values (v_client);

  if tok !~ '^[0-9a-f]{32}$' then return jsonb_build_object('status', 'not_found', 'valid', false); end if;
  select * into t from public.member_card_tokens where token = tok;
  if not found then return jsonb_build_object('status', 'not_found', 'valid', false); end if;
  if t.revoked_at is not null then return jsonb_build_object('status', 'revoked', 'valid', false); end if;
  select * into p from public.profiles where id = t.user_id;
  if not found or p.verification <> 'verified' then
    return jsonb_build_object('status', 'inactive', 'valid', false, 'verified', false);
  end if;
  select coalesce(s.card_show_photo, false) into show_photo from (select 1) one
    left join public.member_showcase_prefs s on s.user_id = p.id;
  return jsonb_build_object(
    'status', 'valid', 'valid', true, 'verified', true,
    'full_name', p.full_name,
    'avatar_url', case when show_photo then p.avatar_url end,
    'grad_year', p.grad_year,
    'branch', p.branch,
    'member_type', p.member_type);
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public._new_card_token() from public, anon, authenticated;
revoke execute on function public._issue_member_card() from public, anon, authenticated;
revoke execute on function public._member_role_keys(uuid) from public, anon, authenticated;
revoke execute on function public.membership_no(int, bigint) from public, anon;
grant execute on function public.membership_no(int, bigint) to authenticated;
do $$
declare f text;
begin
  foreach f in array array['my_id_card()', 'regenerate_my_id_card_token()', 'revoke_my_id_card_token()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.verify_id_card(text) from public;
grant execute on function public.verify_id_card(text) to anon, authenticated;
