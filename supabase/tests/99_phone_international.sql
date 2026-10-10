-- International phone numbers: E.164 and short island numbers pass every phone check; letters and too-short numbers still fail.
-- The migration is run a second time to prove it can be repeated. Rolls back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('99700000-0000-0000-0000-00000000000a', 'phone-a@x.com', '{"full_name":"Phone A"}');

do $$
declare ph text;
begin
  -- the signup trigger made the private row; E.164 from several countries, an old Indian format and a 7-digit island number
  foreach ph in array array['+447700900123', '+919876543210', '+91 98765 43210', '9876543210', '+14155550123', '+6831234', '+971501234567', '+4915123456789'] loop
    update public.profile_private set phone = ph where id = '99700000-0000-0000-0000-00000000000a';
    assert (select phone from public.profile_private where id = '99700000-0000-0000-0000-00000000000a') = ph, 'accepts ' || ph;
  end loop;
  foreach ph in array array['abc', '12345', '+44 77-00', '+44(0)7700', '+4477009001234567890'] loop
    begin
      update public.profile_private set phone = ph where id = '99700000-0000-0000-0000-00000000000a';
      assert false, 'should refuse ' || ph;
    exception when check_violation then null; end;
  end loop;
end $$;

-- no phone check is left with the old 8/10-digit minimum, in a function or a table
do $$ begin
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prosrc ~ '\[0-9 \]\s*\{\s*(8|10)\s*,\s*16\s*\}'), 'a function still has the old phone pattern';
  assert not exists (select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                      where n.nspname = 'public' and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '\[0-9 \]\s*\{\s*(8|10)\s*,\s*16\s*\}'), 'a table still has the old phone pattern';
  assert exists (select 1 from pg_constraint c where pg_get_constraintdef(c.oid) like '%[0-9 ]{7,16}%'), 'the widened checks exist';
end $$;

-- the registration check accepts a UK number (function patched) and still refuses junk
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'upsert_registration' limit 1;
  assert def like '%[0-9 ]{7,16}%', 'upsert_registration accepts international numbers';
end $$;

-- running the migration again changes nothing and does not fail
\i supabase/migrations/20261018000070_phone_international.sql
do $$ begin
  assert exists (select 1 from pg_constraint c where pg_get_constraintdef(c.oid) like '%[0-9 ]{7,16}%'), 'still widened after a second run';
end $$;
rollback;
