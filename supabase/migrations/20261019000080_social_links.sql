-- Social links on profiles: Instagram and Facebook, each with its own visibility.
-- Stored in their own table (not on profiles, which every verified member can read in full), so the database itself
-- decides who gets a link: the owner and admins read the table directly; everyone else goes through get_social_links(),
-- which applies verification, blocks, the owner's per-link visibility and "connections only".
-- Only canonical https://www.instagram.com/<name>/ and https://www.facebook.com/... addresses can be stored.

create table if not exists public.profile_social_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  instagram_url text,
  facebook_url text,
  instagram_visibility text not null default 'verified',
  facebook_visibility text not null default 'verified',
  updated_at timestamptz not null default now(),
  constraint psl_instagram_ck check (
    instagram_url is null or (
      char_length(instagram_url) <= 80
      and instagram_url ~ '^https://www\.instagram\.com/[A-Za-z0-9._]{1,30}/$')),
  constraint psl_facebook_ck check (
    facebook_url is null or (
      char_length(facebook_url) <= 300
      and facebook_url ~ '^https://www\.facebook\.com/(profile\.php\?id=[0-9]{5,25}|[A-Za-z0-9._-]{1,100}(/[A-Za-z0-9._%-]{1,100}){0,2}/?)$'
      and (facebook_url ~ '^https://www\.facebook\.com/profile\.php\?id=[0-9]+$' or facebook_url !~* '\.php'))),
  constraint psl_instagram_vis_ck check (instagram_visibility in ('verified', 'connections', 'hidden')),
  constraint psl_facebook_vis_ck check (facebook_visibility in ('verified', 'connections', 'hidden'))
);

drop trigger if exists psl_touch on public.profile_social_links;
create trigger psl_touch before update on public.profile_social_links
  for each row execute function public.touch_updated_at();

alter table public.profile_social_links enable row level security;

drop policy if exists "own social links" on public.profile_social_links;
create policy "own social links" on public.profile_social_links
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "admins read social links" on public.profile_social_links;
create policy "admins read social links" on public.profile_social_links
  for select to authenticated using (public._admin_can('members_view'));
drop policy if exists "insert own social links" on public.profile_social_links;
create policy "insert own social links" on public.profile_social_links
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own social links" on public.profile_social_links;
create policy "update own social links" on public.profile_social_links
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own social links" on public.profile_social_links;
create policy "delete own social links" on public.profile_social_links
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.profile_social_links from public, anon, authenticated;
grant select, delete on public.profile_social_links to authenticated;
grant insert (user_id, instagram_url, facebook_url, instagram_visibility, facebook_visibility) on public.profile_social_links to authenticated;
grant update (instagram_url, facebook_url, instagram_visibility, facebook_visibility) on public.profile_social_links to authenticated;

-- What the signed-in member may see of other members' links. Returns nothing unless the caller is a verified member;
-- skips blocked pairs (either direction) and members who are not verified themselves.
create or replace function public.get_social_links(p_ids uuid[])
returns table (user_id uuid, instagram_url text, facebook_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id,
         case when l.instagram_visibility = 'verified' or l.user_id = auth.uid()
                or (l.instagram_visibility = 'connections' and public.are_connected(auth.uid(), l.user_id))
              then l.instagram_url end,
         case when l.facebook_visibility = 'verified' or l.user_id = auth.uid()
                or (l.facebook_visibility = 'connections' and public.are_connected(auth.uid(), l.user_id))
              then l.facebook_url end
    from public.profile_social_links l
    join public.profiles p on p.id = l.user_id
   where auth.uid() is not null
     and public.is_verified()
     and l.user_id = any ((coalesce(p_ids, '{}'::uuid[]))[1:200])
     and (l.user_id = auth.uid() or (p.verification = 'verified' and not public.is_blocked_between(auth.uid(), l.user_id)))
$$;

revoke all on function public.get_social_links(uuid[]) from public, anon;
grant execute on function public.get_social_links(uuid[]) to authenticated;
