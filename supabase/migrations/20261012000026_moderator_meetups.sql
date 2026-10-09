-- Verification pass: moderators may hide, close and restore city meetups (admin_set_meetup already allows them), so they must also be
-- able to SEE hidden and closed meetups to restore them. Everyone else still sees active meetups only.
create or replace function public.city_meetups(p_city_id int)
returns table (group_id uuid, chat_id uuid, name text, description text, meet_when text, place text, creator_id uuid, creator_name text,
               creator_avatar text, member_count int, joined boolean, is_creator boolean, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.group_id, c.id, g.name, g.description, m.meet_when, m.place, m.creator_id, p.full_name, p.avatar_url, g.member_count,
         exists (select 1 from public.group_members gm where gm.group_id = m.group_id and gm.user_id = auth.uid()),
         m.creator_id = auth.uid(), m.status, m.created_at
    from public.city_meetups m
    join public.groups g on g.id = m.group_id
    left join public.chats c on c.group_id = m.group_id
    left join public.profiles p on p.id = m.creator_id
   where public.is_verified() and m.city_id = p_city_id
     and (public.is_moderator() or (m.status = 'active' and (m.creator_id is null or not public.is_blocked_between(m.creator_id, auth.uid()))))
   order by (m.status = 'active') desc, g.member_count desc, m.created_at desc
   limit 50;
$$;
