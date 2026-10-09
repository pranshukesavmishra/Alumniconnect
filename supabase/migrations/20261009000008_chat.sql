-- Chat: one model for direct messages and group chats.
--  * every group (batch, year, circle) has a group chat; channels are broadcast-only (admins post)
--  * group history is visible to ALL current members, including people who join later
--  * DMs honour "who can message me", start as requests for strangers, respect blocks
--  * rich messages: replies, reactions, edit (15 min) / delete for everyone, photos, files, voice notes, polls
--  * read state per member; "Seen" receipts for DMs; mute; pin (group admins); @mentions notify

create type public.chat_kind as enum ('dm', 'group');
create type public.message_kind as enum ('text', 'image', 'file', 'voice', 'poll', 'system');

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_kind not null,
  group_id uuid unique references public.groups (id) on delete cascade,
  dm_a uuid references public.profiles (id) on delete cascade,
  dm_b uuid references public.profiles (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  is_request boolean not null default false,
  last_message_at timestamptz,
  last_message text,
  last_sender uuid references public.profiles (id) on delete set null,
  pinned_message uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'group' and group_id is not null and dm_a is null and dm_b is null)
      or (kind = 'dm' and group_id is null and dm_a is not null and dm_b is not null and dm_a < dm_b))
);
create unique index chats_dm_pair_idx on public.chats (dm_a, dm_b) where kind = 'dm';
create index chats_dm_a_idx on public.chats (dm_a);
create index chats_dm_b_idx on public.chats (dm_b);

create table public.chat_reads (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (chat_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  kind public.message_kind not null default 'text',
  body text check (char_length(body) <= 4000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  reply_to uuid references public.messages (id) on delete set null,
  poll jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp()   -- strict order even within one transaction
);
create index messages_chat_idx on public.messages (chat_id, created_at desc);
create index messages_search_idx on public.messages using gin (to_tsvector('simple', coalesce(body, '')));

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,   -- lets live updates filter by chat
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_chat_idx on public.message_reactions (chat_id);
alter table public.message_reactions replica identity full;  -- deletions carry chat_id for live filters

create table public.poll_votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,   -- lets live updates filter by chat
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_index int not null check (option_index between 0 and 11),
  primary key (message_id, user_id, option_index)
);
create index poll_votes_chat_idx on public.poll_votes (chat_id);
alter table public.poll_votes replica identity full;

-- Slow mode: group admins can limit how often each member may send (0 = off).
alter table public.groups add column if not exists slow_mode_seconds int not null default 0 check (slow_mode_seconds between 0 and 3600);

create or replace function public.set_slow_mode(p_group uuid, p_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'Only group admins can change slow mode' using errcode = '42501'; end if;
  if p_seconds is null or p_seconds not between 0 and 3600 then raise exception 'Choose between off and 1 hour'; end if;
  update public.groups set slow_mode_seconds = p_seconds where id = p_group;
  perform public._audit('slow_mode', 'groups', p_group, jsonb_build_object('seconds', p_seconds));
end;
$$;

-- ------------------------------------------------------------------ access
create or replace function public.can_read_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c left join public.groups g on g.id = c.group_id
     where c.id = p_chat and (
       (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b))
       or (c.kind = 'group' and public.is_verified() and (public.is_group_member(c.group_id) or g.kind = 'channel' or public.is_admin()))
     ));
$$;

create or replace function public.can_post_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c left join public.groups g on g.id = c.group_id
     where c.id = p_chat and (
       (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b) and public.is_verified()
          and not public.is_blocked_between(c.dm_a, c.dm_b))
       or (c.kind = 'group' and public.is_verified() and (
             (g.kind = 'channel' and public.is_group_admin(c.group_id))
             or (g.kind <> 'channel' and public.is_group_member(c.group_id))))
     ));
$$;

-- Every group gets a chat (existing and future ones).
create or replace function public._group_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chats (kind, group_id) values ('group', new.id) on conflict (group_id) do nothing;
  return null;
end;
$$;
create trigger groups_chat after insert on public.groups for each row execute function public._group_chat();
insert into public.chats (kind, group_id) select 'group', id from public.groups on conflict (group_id) do nothing;

-- Joining a group: the whole history is readable, but none of it counts as "unread".
create or replace function public._group_join_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_reads (chat_id, user_id, last_read_at)
  select c.id, new.user_id, clock_timestamp() from public.chats c where c.group_id = new.group_id
  on conflict (chat_id, user_id) do nothing;
  return null;
end;
$$;
create trigger group_members_chat_read after insert on public.group_members for each row execute function public._group_join_read();
insert into public.chat_reads (chat_id, user_id, last_read_at)
select c.id, gm.user_id, now() from public.group_members gm join public.chats c on c.group_id = gm.group_id
on conflict (chat_id, user_id) do nothing;

-- ------------------------------------------------------------------ direct messages
create or replace function public.start_dm(p_other uuid)
returns public.chats language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.chats;
  other public.profiles;
  mine public.profiles;
  allowed boolean;
  n int;
begin
  if not public.is_verified() then raise exception 'Only verified members can send messages' using errcode = '42501'; end if;
  if p_other = me then raise exception 'That’s you!'; end if;
  select * into other from public.profiles where id = p_other;
  if not found then raise exception 'Member not found'; end if;
  if public.is_blocked_between(me, p_other) then raise exception 'You can’t message this member'; end if;
  select * into c from public.chats where kind = 'dm' and dm_a = least(me, p_other) and dm_b = greatest(me, p_other);
  if found then return c; end if;

  select * into mine from public.profiles where id = me;
  allowed := case other.message_policy
    when 'jec' then true
    when 'batch_and_connections' then public.are_connected(me, p_other) or (mine.grad_year is not null and mine.grad_year = other.grad_year)
    else public.are_connected(me, p_other) end;
  if not allowed then raise exception 'This member only accepts messages from connections. Send a connection request first.'; end if;
  select count(*) into n from public.chats where kind = 'dm' and started_by = me and created_at > now() - interval '1 day';
  if n >= 10 and not public.are_connected(me, p_other) then
    raise exception 'You can start up to 10 new conversations a day. Please try again tomorrow.';
  end if;
  insert into public.chats (kind, dm_a, dm_b, started_by, is_request)
  values ('dm', least(me, p_other), greatest(me, p_other), me, not public.are_connected(me, p_other))
  returning * into c;
  return c;
end;
$$;

create or replace function public.accept_message_request(p_chat uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chats set is_request = false
   where id = p_chat and kind = 'dm' and auth.uid() in (dm_a, dm_b) and auth.uid() <> started_by;
$$;

-- Once two members connect, a pending message request between them is no longer a request.
create or replace function public._connection_clears_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' then
    update public.chats set is_request = false
     where kind = 'dm' and is_request and dm_a = least(new.requester, new.addressee) and dm_b = greatest(new.requester, new.addressee);
  end if;
  return null;
end;
$$;
create trigger connections_clear_request after insert or update of status on public.connections
  for each row execute function public._connection_clears_request();

-- ------------------------------------------------------------------ sending
create or replace function public.send_message(p_chat uuid, p_body text, p_kind public.message_kind default 'text',
                                               p_attachments jsonb default '[]'::jsonb, p_reply_to uuid default null, p_poll jsonb default null)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare
  c public.chats;
  m public.messages;
  me uuid := auth.uid();
  n int;
  preview text;
  a jsonb;
begin
  select * into c from public.chats where id = p_chat for update;
  if not found or not public.can_post_chat(p_chat) then
    raise exception 'You can’t send messages here' using errcode = '42501';
  end if;
  if p_kind = 'system' then raise exception 'Not allowed'; end if;
  if p_kind = 'text' and coalesce(btrim(p_body), '') = '' then raise exception 'Message is empty'; end if;
  if p_kind in ('image', 'file', 'voice') then
    if jsonb_array_length(coalesce(p_attachments, '[]')) = 0 then raise exception 'Attachment missing'; end if;
    for a in select * from jsonb_array_elements(p_attachments) loop
      if coalesce(a ->> 'path', '') not like me::text || '/' || c.id::text || '/%'
         or (a ? 'thumb' and coalesce(a ->> 'thumb', '') not like me::text || '/' || c.id::text || '/%') then
        raise exception 'Invalid attachment';
      end if;
    end loop;
  end if;
  if p_kind = 'poll' then
    if jsonb_typeof(p_poll -> 'options') <> 'array' or jsonb_array_length(p_poll -> 'options') not between 2 and 12
       or coalesce(btrim(p_poll ->> 'question'), '') = '' then
      raise exception 'A poll needs a question and 2–12 options';
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from public.messages r where r.id = p_reply_to and r.chat_id = p_chat) then
    raise exception 'Reply target not found';
  end if;
  -- unanswered request: the starter can send 3 messages until the other person replies
  if c.kind = 'dm' and c.is_request and me = c.started_by then
    select count(*) into n from public.messages where chat_id = c.id;
    if n >= 3 then raise exception 'Please wait for a reply before sending more messages.'; end if;
  end if;
  -- flood control: 30 messages a minute
  select count(*) into n from public.messages where sender_id = me and created_at > now() - interval '1 minute';
  if n >= 30 then raise exception 'You’re sending messages too fast. Please slow down.'; end if;

  -- slow mode (not for group admins)
  if c.kind = 'group' and not public.is_group_admin(c.group_id) then
    select g.slow_mode_seconds into n from public.groups g where g.id = c.group_id;
    if n > 0 and exists (select 1 from public.messages where chat_id = c.id and sender_id = me and created_at > now() - make_interval(secs => n)) then
      raise exception 'Slow mode is on: you can send one message every % seconds.', n;
    end if;
  end if;

  insert into public.messages (chat_id, sender_id, kind, body, attachments, reply_to, poll)
  values (c.id, me, p_kind, left(nullif(btrim(p_body), ''), 4000), coalesce(p_attachments, '[]'), p_reply_to, p_poll)
  returning * into m;

  preview := case p_kind when 'image' then '📷 Photo' when 'file' then '📄 ' || coalesce(p_attachments -> 0 ->> 'name', 'File')
                         when 'voice' then '🎤 Voice message' when 'poll' then '📊 ' || (p_poll ->> 'question') else m.body end;
  update public.chats set last_message_at = m.created_at, last_message = left(preview, 140), last_sender = me,
         is_request = case when kind = 'dm' and me <> started_by then false else is_request end
   where id = c.id;
  insert into public.chat_reads (chat_id, user_id, last_read_at) values (c.id, me, m.created_at)
  on conflict (chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  return m;
end;
$$;

-- Edit within 15 minutes; delete for everyone (own messages; group admins can remove any in their group).
create or replace function public.edit_message(p_message uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  -- text needs a body; photo/file captions may be cleared
  update public.messages set body = left(nullif(btrim(p_body), ''), 4000), edited_at = now()
   where id = p_message and sender_id = auth.uid() and kind in ('text', 'image', 'file') and deleted_at is null
     and created_at > now() - interval '15 minutes'
     and (kind <> 'text' or coalesce(btrim(p_body), '') <> '')
  returning * into m;
  if not found then
    if coalesce(btrim(p_body), '') = '' then raise exception 'Message is empty'; end if;
    raise exception 'Messages can be edited for 15 minutes after sending';
  end if;
  if (select last_message_at from public.chats where id = m.chat_id) = m.created_at and m.kind = 'text' then
    update public.chats set last_message = left(m.body, 140) where id = m.chat_id;
  end if;
  return m;
end;
$$;

create or replace function public.delete_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  c public.chats;
begin
  select * into m from public.messages where id = p_message;
  select * into c from public.chats where id = m.chat_id;
  if m.id is null or not (m.sender_id = auth.uid() or (c.kind = 'group' and public.is_group_admin(c.group_id))) then
    raise exception 'You can only delete your own messages' using errcode = '42501';
  end if;
  update public.messages set body = null, attachments = '[]', poll = null, deleted_at = now() where id = p_message;
  delete from public.message_reactions where message_id = p_message;
  delete from public.poll_votes where message_id = p_message;
  if (select last_message_at from public.chats where id = m.chat_id) = m.created_at then
    update public.chats set last_message = 'This message was deleted' where id = m.chat_id;
  end if;
  if c.pinned_message = p_message then update public.chats set pinned_message = null where id = c.id; end if;
end;
$$;

create or replace function public.react_to_message(p_message uuid, p_emoji text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ch uuid;
begin
  select chat_id into ch from public.messages where id = p_message and deleted_at is null;
  if ch is null or not public.can_read_chat(ch) or not public.is_verified() then
    raise exception 'You can’t react here' using errcode = '42501';
  end if;
  if p_emoji is null or btrim(p_emoji) = '' then
    delete from public.message_reactions where message_id = p_message and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, chat_id, user_id, emoji) values (p_message, ch, auth.uid(), left(btrim(p_emoji), 16))
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end;
$$;

create or replace function public.vote_poll(p_message uuid, p_options int[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  n int;
begin
  select * into m from public.messages where id = p_message and kind = 'poll' and deleted_at is null;
  if not found or not public.can_read_chat(m.chat_id) or not public.is_verified() then
    raise exception 'You can’t vote here' using errcode = '42501';
  end if;
  n := jsonb_array_length(m.poll -> 'options');
  if exists (select 1 from unnest(p_options) o where o < 0 or o >= n) then raise exception 'Invalid option'; end if;
  if coalesce((m.poll ->> 'multiple')::boolean, false) is not true and cardinality(p_options) > 1 then
    raise exception 'Choose one option';
  end if;
  delete from public.poll_votes where message_id = p_message and user_id = auth.uid();
  insert into public.poll_votes (message_id, chat_id, user_id, option_index) select p_message, m.chat_id, auth.uid(), o from unnest(p_options) o;
end;
$$;

create or replace function public.mark_chat_read(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_read_chat(p_chat) then return; end if;
  insert into public.chat_reads (chat_id, user_id, last_read_at) values (p_chat, auth.uid(), clock_timestamp())
  on conflict (chat_id, user_id) do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
end;
$$;

create or replace function public.set_chat_muted(p_chat uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_read_chat(p_chat) then raise exception 'Chat not found'; end if;
  insert into public.chat_reads (chat_id, user_id, muted) values (p_chat, auth.uid(), p_muted)
  on conflict (chat_id, user_id) do update set muted = excluded.muted;
end;
$$;

create or replace function public.pin_message(p_chat uuid, p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.chats;
begin
  select * into c from public.chats where id = p_chat;
  if not found or not ((c.kind = 'group' and public.is_group_admin(c.group_id)) or (c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b))) then
    raise exception 'Only group admins can pin messages' using errcode = '42501';
  end if;
  if p_message is not null and not exists (select 1 from public.messages where id = p_message and chat_id = p_chat and deleted_at is null) then
    raise exception 'Message not found';
  end if;
  update public.chats set pinned_message = p_message where id = p_chat;
end;
$$;

-- ------------------------------------------------------------------ notifications for messages
-- DMs always notify (unless muted); in groups only @mentions notify, so busy groups never spam.
create or replace function public._message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.chats;
  other uuid;
  r record;
begin
  if new.kind = 'system' then return null; end if;
  select * into c from public.chats where id = new.chat_id;
  if c.kind = 'dm' then
    other := case when c.dm_a = new.sender_id then c.dm_b else c.dm_a end;
    if not exists (select 1 from public.chat_reads cr where cr.chat_id = c.id and cr.user_id = other and cr.muted) then
      perform public._notify(other, 'message', new.sender_id, c.id, coalesce(new.body, 'sent you an attachment'));
    end if;
  elsif new.body ~ '@' then
    for r in
      select gm.user_id from public.group_members gm join public.profiles p on p.id = gm.user_id
       where gm.group_id = c.group_id and gm.user_id <> new.sender_id
         and position('@' || lower(split_part(p.full_name, ' ', 1)) in lower(new.body)) > 0
       limit 50
    loop
      perform public._notify(r.user_id, 'mention', new.sender_id, c.id, new.body);
    end loop;
  end if;
  return null;
end;
$$;
create trigger messages_notify after insert on public.messages for each row execute function public._message_notify();

-- What was reported, as it read at report time (so moderators can act even on private chats, and after edits).
alter table public.reports add column if not exists snapshot text;

-- Report a message to the moderators (one report per member per message). Admins see these in the moderation queue.
create or replace function public.report_message(p_message uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message and deleted_at is null;
  if not found or not public.can_read_chat(m.chat_id) or not public.is_verified() then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if m.sender_id = auth.uid() then raise exception 'You can’t report your own message'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please tell us briefly what is wrong'; end if;
  insert into public.reports (reporter, target_type, target_id, reason, snapshot)
  values (auth.uid(), 'message', p_message, left(btrim(p_reason), 500), left(coalesce(m.body, case m.kind when 'image' then '[photo]' when 'file' then '[file]' when 'voice' then '[voice message]' when 'poll' then '[poll]' else '' end), 500))
  on conflict (reporter, target_type, target_id) do nothing;
end;
$$;

-- ------------------------------------------------------------------ my chat list in ONE round trip (fast)
-- p_chat = null: my inbox. p_chat = id: that one chat (also a channel I can read without following).
create or replace function public.my_chats(p_chat uuid default null)
returns table (id uuid, kind public.chat_kind, title text, avatar_url text, icon text, subtitle text, other_id uuid,
               group_id uuid, group_slug text, group_kind public.group_kind, joined boolean, is_group_admin boolean,
               is_request boolean, started_by uuid, last_message text, last_message_at timestamptz, last_sender uuid,
               unread int, muted boolean, last_read_at timestamptz, other_last_read_at timestamptz, pinned_message uuid, can_post boolean, last_sender_name text, slow_mode_seconds int)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid)
  select c.id, c.kind,
         coalesce(g.name, op.full_name) as title,
         op.avatar_url, g.icon,
         case when c.kind = 'dm' then concat_ws(' ', op.branch, op.grad_year::text)
              else g.member_count || case when g.member_count = 1 then ' member' else ' members' end end,
         op.id, g.id, g.slug, g.kind, gm.user_id is not null or c.kind = 'dm',
         c.kind = 'group' and public.is_group_admin(c.group_id),
         c.is_request, c.started_by, c.last_message, c.last_message_at, c.last_sender,
         -- unread since last read (late joiners: since they joined, so old history isn't "unread"); capped for speed
         (select count(*)::int from (select 1 from public.messages m
             where m.chat_id = c.id and m.deleted_at is null and m.sender_id is distinct from me.uid
               and m.created_at > coalesce(r.last_read_at, gm.joined_at, '-infinity') limit 100) u),
         coalesce(r.muted, false),
         r.last_read_at,
         (select orr.last_read_at from public.chat_reads orr where orr.chat_id = c.id and orr.user_id = op.id),
         c.pinned_message,
         public.can_post_chat(c.id),
         (select split_part(lp.full_name, ' ', 1) from public.profiles lp where lp.id = c.last_sender),
         coalesce(g.slow_mode_seconds, 0)
    from public.chats c
    cross join me
    left join public.groups g on g.id = c.group_id
    left join public.profiles op on c.kind = 'dm' and op.id = case when c.dm_a = me.uid then c.dm_b else c.dm_a end
    left join public.chat_reads r on r.chat_id = c.id and r.user_id = me.uid
    left join public.group_members gm on gm.group_id = c.group_id and gm.user_id = me.uid
   where public.is_verified()
     and (p_chat is null or c.id = p_chat)
     and (
           (c.kind = 'dm' and me.uid in (c.dm_a, c.dm_b) and (c.last_message_at is not null or c.started_by = me.uid or p_chat is not null))
        or (c.kind = 'group' and (gm.user_id is not null or (p_chat is not null and public.can_read_chat(c.id)))))
   order by c.last_message_at desc nulls last
   limit 300;
$$;

-- Search messages I can read: all my chats, or just one (p_chat).
create or replace function public.search_messages(p_query text, p_chat uuid default null)
returns table (id uuid, chat_id uuid, body text, created_at timestamptz, sender_name text, chat_title text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.chat_id, m.body, m.created_at, p.full_name, coalesce(g.name, op.full_name)
    from public.messages m
    join public.chats c on c.id = m.chat_id
    left join public.groups g on g.id = c.group_id
    left join public.profiles op on c.kind = 'dm' and op.id = case when c.dm_a = auth.uid() then c.dm_b else c.dm_a end
    left join public.profiles p on p.id = m.sender_id
   where char_length(btrim(p_query)) >= 2 and m.deleted_at is null and public.is_verified()
     and (p_chat is null or m.chat_id = p_chat) and public.can_read_chat(m.chat_id)
     and m.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by m.created_at desc
   limit 50;
$$;

-- Members of a chat's group whose names start with a prefix, for @mention suggestions.
create or replace function public.mention_candidates(p_chat uuid, p_prefix text default '')
returns table (id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url
    from public.chats c
    join public.group_members gm on gm.group_id = c.group_id
    join public.profiles p on p.id = gm.user_id
   where c.id = p_chat and c.kind = 'group' and public.is_group_member(c.group_id) and p.id <> auth.uid()
     and (btrim(p_prefix) = '' or lower(p.full_name) like lower(replace(replace(replace(btrim(p_prefix), '\', '\\'), '%', '\%'), '_', '\_')) || '%'
          or lower(split_part(p.full_name, ' ', 1)) like lower(replace(replace(replace(btrim(p_prefix), '\', '\\'), '%', '\%'), '_', '\_')) || '%')
   order by p.full_name
   limit 8;
$$;


-- ------------------------------------------------------------------ moderation queue (admins)
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
      from public.reports r where r.status = p_status group by r.target_type, r.target_id)
  select g.target_type, g.target_id, g.n, g.last_at, g.reasons,
         case g.target_type
           when 'post' then (select left(po.body, 300) from public.posts po where po.id = g.target_id)
           when 'comment' then (select left(co.body, 300) from public.comments co where co.id = g.target_id)
           when 'message' then coalesce((select left(me.body, 300) from public.messages me where me.id = g.target_id and me.deleted_at is null), g.snap)
           when 'profile' then (select pr.full_name from public.profiles pr where pr.id = g.target_id)
         end,
         case g.target_type
           when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
           when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
           when 'profile' then g.target_id
         end,
         (select p2.full_name from public.profiles p2 where p2.id = case g.target_type
           when 'post' then (select po.author_id from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.author_id from public.comments co where co.id = g.target_id)
           when 'message' then (select me.sender_id from public.messages me where me.id = g.target_id)
           when 'profile' then g.target_id end),
         case g.target_type
           when 'post' then (select po.is_hidden from public.posts po where po.id = g.target_id)
           when 'comment' then (select co.is_hidden from public.comments co where co.id = g.target_id)
           when 'message' then coalesce((select me.deleted_at is not null from public.messages me where me.id = g.target_id), true)
           else false
         end,
         case g.target_type
           when 'message' then (select coalesce(gr.name, 'Direct message') from public.messages me join public.chats ch on ch.id = me.chat_id left join public.groups gr on gr.id = ch.group_id where me.id = g.target_id)
           when 'post' then (select coalesce(gr.name, 'Public feed') from public.posts po left join public.groups gr on gr.id = po.group_id where po.id = g.target_id)
           else null
         end
    from g order by g.last_at desc limit 100;
end;
$$;

-- Admin action on a reported message: remove it for everyone (any chat, including private ones) and close its reports.
create or replace function public.admin_remove_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'Message not found'; end if;
  update public.messages set body = null, attachments = '[]', poll = null, deleted_at = coalesce(deleted_at, now()) where id = p_message;
  delete from public.message_reactions where message_id = p_message;
  delete from public.poll_votes where message_id = p_message;
  if (select last_message_at from public.chats where id = m.chat_id) = m.created_at then
    update public.chats set last_message = 'This message was deleted' where id = m.chat_id;
  end if;
  update public.chats set pinned_message = null where id = m.chat_id and pinned_message = p_message;
  update public.reports set status = 'actioned', handled_by = auth.uid() where target_type = 'message' and target_id = p_message and status = 'open';
  perform public._audit('remove_message', 'messages', p_message, jsonb_build_object('chat', m.chat_id));
end;
$$;

-- Dismiss reports on any target without taking action.
create or replace function public.admin_dismiss_reports(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can moderate' using errcode = '42501'; end if;
  update public.reports set status = 'dismissed', handled_by = auth.uid() where target_type = p_type and target_id = p_id and status = 'open';
  perform public._audit('dismiss_reports', p_type || 's', p_id, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------------ RLS + grants
alter table public.chats enable row level security;
alter table public.chat_reads enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.poll_votes enable row level security;

create policy "readable chats" on public.chats for select to authenticated using (public.can_read_chat(id));
create policy "own read state" on public.chat_reads for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.chats c where c.id = chat_id and c.kind = 'dm' and auth.uid() in (c.dm_a, c.dm_b)));
create policy "readable messages" on public.messages for select to authenticated using (
  public.can_read_chat(chat_id) and (sender_id is null or not public.is_blocked_between(auth.uid(), sender_id)));
create policy "readable reactions" on public.message_reactions for select to authenticated using (public.can_read_chat(chat_id));
create policy "readable votes" on public.poll_votes for select to authenticated using (public.can_read_chat(chat_id));

grant select on public.chats, public.chat_reads, public.messages, public.message_reactions, public.poll_votes to authenticated;

do $$
declare f text;
begin
  foreach f in array array['start_dm(uuid)', 'accept_message_request(uuid)',
    'send_message(uuid, text, public.message_kind, jsonb, uuid, jsonb)', 'edit_message(uuid, text)', 'delete_message(uuid)',
    'react_to_message(uuid, text)', 'vote_poll(uuid, int[])', 'mark_chat_read(uuid)', 'set_chat_muted(uuid, boolean)',
    'pin_message(uuid, uuid)', 'set_slow_mode(uuid, int)', 'report_message(uuid, text)', 'admin_reports(text)', 'admin_remove_message(uuid)', 'admin_dismiss_reports(text, uuid)', 'my_chats(uuid)', 'search_messages(text, uuid)', 'mention_candidates(uuid, text)']
  loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_group_chat()', '_group_join_read()', '_connection_clears_request()', '_message_notify()'] loop
    execute format('revoke execute on function public.%s from anon, authenticated, public', f);
  end loop;
end $$;

-- Chat attachments (photos, files, voice notes): private bucket; files under "<user id>/<chat id>/...".
-- The folder name is parsed safely so a malformed path is simply denied (never a cast error).
create or replace function public._chat_of_path(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return ((storage.foldername(p_name))[2])::uuid;
exception when others then return null;
end;
$$;
revoke execute on function public._chat_of_path(text) from anon, public;
grant execute on function public._chat_of_path(text) to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 25 * 1024 * 1024, null)
on conflict (id) do nothing;
create policy "upload own chat media" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text
              and public.can_post_chat(public._chat_of_path(name)));
create policy "delete own chat media" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read chat media of my chats" on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.can_read_chat(public._chat_of_path(name)));

-- Live updates
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.message_reactions, public.poll_votes;
  end if;
end $$;
