-- ACHIEVEMENTS: computed badges (nothing is stored, nothing to write by hand, so they can never drift).
--
--   _profile_completeness(user)  the same score as profileCompleteness() in the app (8 steps + a social-link bonus), with the
--                                missing steps; used by the profile_star badge and by home_highlights().
--   member_achievements(user)    every badge of the catalogue (src/features/badges/catalog.ts holds titles, icons, tiers):
--                                earned + earned_at, and progress / target for the ones not earned yet. Verified members may
--                                read anyone's (a blocked pair reads nothing); anyone reads their own.
--                                Privacy: anonymous donations count only towards the member's OWN view of donor / patron.
--
-- The older member_badges(uuid) (invite badges on the profile page) is left as it is.

create index if not exists event_photos_uploader_idx on public.event_photos (uploaded_by, created_at) where status = 'approved' and not is_hidden;
create index if not exists event_registrations_user_idx on public.event_registrations (user_id, status);
create index if not exists connections_requester_status_idx on public.connections (requester, status);
create index if not exists giving_donations_user_status_idx on public.giving_donations (user_id, status) where user_id is not null;

create or replace function public._profile_completeness(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.profiles where id = p_user),
  steps as (
    select array_remove(array[
      case when nullif(btrim(coalesce(p.avatar_url, '')), '') is null then 'photo' end,
      case when nullif(btrim(coalesce(p.headline, '')), '') is null and nullif(btrim(coalesce(p.current_title, '')), '') is null then 'role' end,
      case when nullif(btrim(coalesce(p.about, '')), '') is null then 'about' end,
      case when cardinality(p.skills) = 0 then 'skills' end,
      case when cardinality(p.help_tags) = 0 then 'help' end,
      case when nullif(btrim(coalesce(p.linkedin_url, '')), '') is null then 'linkedin' end], null) as missing,
      exists (select 1 from public.profile_social_links l where l.user_id = p.id and (l.instagram_url is not null or l.facebook_url is not null)) as social
      from p
  )
  select jsonb_build_object(
    'percent', least(100, round(((6 - cardinality(missing) + 2 + case when social then 1 else 0 end)::numeric / 8) * 100)::int),
    'missing', to_jsonb(missing),
    'has_social', social)
    from steps;
$$;

create or replace function public.member_achievements(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  is_me boolean;
  result jsonb;
begin
  if me is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
  is_me := p_user = me;
  if not is_me and not public.is_verified() then
    raise exception 'Only verified members can see badges' using errcode = '42501';
  end if;
  if not is_me and (public.is_blocked_between(me, p_user)
                    or not exists (select 1 from public.profiles x where x.id = p_user and x.verification = 'verified')) then
    return null;
  end if;

  with p as (select * from public.profiles where id = p_user),
  card as (select c.serial, c.issued_at from public.member_cards c where c.user_id = p_user),
  comp as (select (public._profile_completeness(p_user) ->> 'percent')::int as pct),
  conn as (
    select count(*)::int as n, (array_agg(c.accepted_at order by c.accepted_at))[10] as at10,
           (array_agg(c.accepted_at order by c.accepted_at))[50] as at50
      from public.connections c
     where c.status = 'accepted' and (c.requester = p_user or c.addressee = p_user)),
  mentor as (
    select coalesce(
      (select mp.created_at from public.mentor_profiles mp where mp.user_id = p_user and mp.is_accepting),
      (select min(coalesce(ms.responded_at, ms.created_at)) from public.mentorships ms
        where ms.mentor_id = p_user and ms.status in ('accepted', 'ended'))) as at,
      exists (select 1 from public.mentor_profiles mp where mp.user_id = p_user and mp.is_accepting)
      or exists (select 1 from public.mentorships ms where ms.mentor_id = p_user and ms.status in ('accepted', 'ended')) as yes),
  told as (
    select count(*)::int as n, (array_agg(t.at order by t.at))[5] as at5 from (
      select po.created_at as at from public.posts po where po.author_id = p_user and not po.is_hidden
      union all
      select st.created_at from public.stories st where st.owner_id = p_user and not st.is_official and not st.is_hidden) t),
  photos as (
    select count(*)::int as n, (array_agg(ph.created_at order by ph.created_at))[10] as at10
      from public.event_photos ph where ph.uploaded_by = p_user and ph.status = 'approved' and not ph.is_hidden),
  reunion as (
    select min(r.created_at) as at from public.event_registrations r join public.events e on e.id = r.event_id
     where r.user_id = p_user and r.status = 'confirmed' and e.slug = 'alumni-meet-2026'),
  vol as (
    select least(
      (select min(s.granted_at) from public.event_staff s where s.user_id = p_user and s.role = 'checkin'),
      (select min(r.created_at) from public.event_registrations r
        where r.user_id = p_user and r.status in ('confirmed', 'under_review') and r.org_team_interest and cardinality(r.org_teams) > 0)) as at),
  gifts as (
    select d.verified_at, d.amount_paise, sum(d.amount_paise) over (order by d.verified_at, d.id) as running
      from public.giving_donations d
     where d.user_id = p_user and d.status = 'verified' and (is_me or not d.is_anonymous)),
  give as (
    select count(*)::int as n, coalesce(sum(amount_paise), 0)::bigint as total, min(verified_at) as first_at,
           min(verified_at) filter (where running >= 1000000) as patron_at from gifts),
  roles as (select coalesce(public._member_role_keys(p_user), '{}'::text[]) as keys),
  org as (select min(s.granted_at) as at from public.event_staff s where s.user_id = p_user)
  select jsonb_build_object(
    'user_id', p_user,
    'badges', jsonb_build_array(
      jsonb_build_object('key', 'verified_jecian', 'earned', p.verification = 'verified', 'earned_at', card.issued_at, 'progress', null, 'target', null, 'attainable', true),
      jsonb_build_object('key', 'founding_member', 'earned', coalesce(card.serial <= 500, false) and p.verification = 'verified',
                         'earned_at', case when card.serial <= 500 then card.issued_at end, 'progress', null, 'target', null,
                         'attainable', card.serial is null or card.serial <= 500),
      jsonb_build_object('key', 'profile_star', 'earned', comp.pct >= 100, 'earned_at', null, 'progress', comp.pct, 'target', 100, 'attainable', true),
      jsonb_build_object('key', 'connector', 'earned', conn.n >= 10, 'earned_at', conn.at10, 'progress', least(conn.n, 10), 'target', 10, 'attainable', true),
      jsonb_build_object('key', 'super_connector', 'earned', conn.n >= 50, 'earned_at', conn.at50, 'progress', least(conn.n, 50), 'target', 50, 'attainable', true),
      jsonb_build_object('key', 'mentor', 'earned', mentor.yes, 'earned_at', mentor.at, 'progress', case when mentor.yes then 1 else 0 end, 'target', 1, 'attainable', true),
      jsonb_build_object('key', 'helper', 'earned', cardinality(p.help_tags) > 0, 'earned_at', null,
                         'progress', least(cardinality(p.help_tags), 1), 'target', 1, 'attainable', true),
      jsonb_build_object('key', 'storyteller', 'earned', told.n >= 5, 'earned_at', told.at5, 'progress', least(told.n, 5), 'target', 5, 'attainable', true),
      jsonb_build_object('key', 'photographer', 'earned', photos.n >= 10, 'earned_at', photos.at10, 'progress', least(photos.n, 10), 'target', 10, 'attainable', true),
      jsonb_build_object('key', 'reunion_2026', 'earned', reunion.at is not null, 'earned_at', reunion.at, 'progress', null, 'target', null, 'attainable', true),
      jsonb_build_object('key', 'volunteer', 'earned', vol.at is not null, 'earned_at', vol.at, 'progress', null, 'target', null, 'attainable', true),
      jsonb_build_object('key', 'donor', 'earned', give.n >= 1, 'earned_at', give.first_at, 'progress', least(give.n, 1), 'target', 1, 'attainable', true),
      jsonb_build_object('key', 'patron', 'earned', give.total >= 1000000, 'earned_at', give.patron_at,
                         'progress', least(give.total, 1000000), 'target', 1000000, 'attainable', true),
      jsonb_build_object('key', 'organiser', 'earned', 'organiser' = any (roles.keys), 'earned_at', case when 'organiser' = any (roles.keys) then org.at end,
                         'progress', null, 'target', null, 'attainable', true),
      jsonb_build_object('key', 'batch_rep', 'earned', 'batch_rep' = any (roles.keys), 'earned_at', null, 'progress', null, 'target', null, 'attainable', true)))
    into result
    from p
    left join card on true
    cross join comp cross join conn cross join mentor cross join told cross join photos cross join reunion cross join vol
    cross join give cross join roles cross join org;
  return result;
end;
$$;

revoke execute on function public._profile_completeness(uuid) from public, anon, authenticated;
revoke execute on function public.member_achievements(uuid) from public, anon;
grant execute on function public.member_achievements(uuid) to authenticated;
