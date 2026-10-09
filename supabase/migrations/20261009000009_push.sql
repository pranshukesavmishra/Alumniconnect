-- Push notifications (Web Push). Each phone/browser that turns notifications on stores one subscription.
-- Whenever a notification row is created (message, @mention, like, comment, connection, invite), a trigger
-- asks the push-send function to deliver it to that member's devices. If push isn't configured (no URL/secret
-- in private.settings) nothing is sent and everything else keeps working: notifications stay in the app.

create extension if not exists pg_net;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https?://'),
  p256dh text not null check (char_length(p256dh) between 80 and 120),
  auth text not null check (char_length(auth) between 16 and 40),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "add own subscription" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "remove own subscription" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Server-only settings (no grants: not readable through the API).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);

create or replace function public._push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.settings where key = 'push_function_url';
  select value into v_secret from private.settings where key = 'push_secret';
  if v_url is null or v_secret is null then
    return null; -- push not set up: notifications stay in the app only
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return null;
  end if;
  -- asynchronous: the insert never waits for (or fails because of) delivery
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 8000
  );
  return null;
end;
$$;
revoke execute on function public._push_notification() from anon, authenticated, public;
create trigger notifications_push after insert on public.notifications for each row execute function public._push_notification();

-- Turn notifications on for this device. A device belongs to whoever is signed in on it now: if someone else used
-- this phone before, their subscription for it is removed so they no longer receive this member's notifications.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end;
$$;

-- Turn them off for this device (also used on sign-out, so a shared phone stops getting the previous member's messages).
create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from anon, public;
revoke execute on function public.remove_push_subscription(text) from anon, public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
