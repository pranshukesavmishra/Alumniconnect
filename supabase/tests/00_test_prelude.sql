-- Test-only: the bare supabase/postgres image ships a stub storage schema. Hosted Supabase
-- (and `supabase start`) add these columns via the storage service's own migrations.
alter table storage.buckets add column if not exists public boolean default false;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
