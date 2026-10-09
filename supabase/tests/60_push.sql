-- Push subscriptions: own rows only; settings unreadable; the trigger queues a request only when configured. Rolls back.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_uid::text, true);
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('60000000-0000-0000-0000-00000000000a', 'p1@x.com', '{"full_name":"Pia"}'),
  ('60000000-0000-0000-0000-00000000000b', 'p2@x.com', '{"full_name":"Ravi"}');
update public.profiles set verification = 'verified' where id::text like '60000000-%';

select pg_temp.login('60000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$ begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), 'https://fcm.googleapis.com/fcm/send/abc', repeat('B', 87), repeat('a', 22));
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('60000000-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/other', repeat('B', 87), repeat('a', 22));
    assert false, 'cannot add a subscription for someone else';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'javascript:x', repeat('B', 87), repeat('a', 22));
    assert false, 'endpoint must be a web address';
  exception when check_violation then null; end;
  begin perform 1 from private.settings; assert false, 'settings are private';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.login('60000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 0, 'cannot see others subscriptions';
  delete from public.push_subscriptions; -- no effect on others
end $$;
reset role;

-- the same phone used by another member: it moves to them (the previous owner stops receiving pushes on it)
select pg_temp.login('60000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('C', 87), repeat('z', 22), 'Pixel');
  assert (select count(*) from public.push_subscriptions) = 1, 'now Ravi''s device';
  perform public.remove_push_subscription('https://fcm.googleapis.com/fcm/send/abc');
  assert (select count(*) from public.push_subscriptions) = 0, 'removed on sign-out';
  perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('C', 87), repeat('z', 22), null);
end $$;
reset role;
do $$ begin
  assert (select user_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc') = '60000000-0000-0000-0000-00000000000b', 'device moved';
  -- give it back to Pia for the trigger tests below
  update public.push_subscriptions set user_id = '60000000-0000-0000-0000-00000000000a';
end $$;

do $$
declare n0 bigint;
begin
  assert (select count(*) from public.push_subscriptions) = 1, 'other member could not delete it';
  -- not configured: a notification queues nothing
  n0 := (select count(*) from net.http_request_queue);
  perform public._notify('60000000-0000-0000-0000-00000000000a', 'like', '60000000-0000-0000-0000-00000000000b', gen_random_uuid(), null);
  assert (select count(*) from net.http_request_queue) = n0, 'nothing sent when push is not configured';
  -- configured: one request queued for a member with a device, none for a member without
  insert into private.settings values ('push_function_url', 'http://push.invalid/functions/v1/push-send'), ('push_secret', 's3cret');
  perform public._notify('60000000-0000-0000-0000-00000000000a', 'like', '60000000-0000-0000-0000-00000000000b', gen_random_uuid(), null);
  assert (select count(*) from net.http_request_queue) = n0 + 1, 'request queued for the device owner';
  assert (select headers ->> 'x-push-secret' from net.http_request_queue order by id desc limit 1) = 's3cret', 'secret header sent';
  perform public._notify('60000000-0000-0000-0000-00000000000b', 'like', '60000000-0000-0000-0000-00000000000a', gen_random_uuid(), null);
  assert (select count(*) from net.http_request_queue) = n0 + 1, 'no request for a member without devices';
end $$;
select 'ALL PUSH TESTS PASSED';
rollback;
