-- International mobile numbers. The app now stores E.164 ("+447700900123", up to 15 digits after the +), and
-- some countries have short national numbers (a 4-digit island number plus a 3-digit code is 7 digits in all).
-- Every phone check in the database used "+?, then 8 or 10 to 16 digits and spaces". They all become
-- "+?, then 7 to 16 digits and spaces": still no letters or punctuation, but wide enough for any country.
-- Safe to run twice and tolerant of spacing inside the old pattern. It reads the live definitions instead of
-- copying them, so each function keeps its own grants, owner and settings.

do $$
declare
  pat constant text := '\[0-9 \]\s*\{\s*(8|10)\s*,\s*16\s*\}';
  rep constant text := '[0-9 ]{7,16}';
  r record;
  def text;
  new_def text;
begin
  -- 1. functions that validate a phone (registration, member import, admin edits, ...)
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ pat
  loop
    def := pg_get_functiondef(r.oid);
    new_def := regexp_replace(def, pat, rep, 'g');
    if new_def <> def then
      execute new_def;
    end if;
  end loop;

  -- 2. table checks (profile_private.phone, businesses.phone, event_registrations.emergency_phone, ...)
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as cdef
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'public' and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ pat
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, regexp_replace(r.cdef, pat, rep, 'g'));
  end loop;
end $$;
