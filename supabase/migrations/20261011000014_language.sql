-- Interface language preference ('en' | 'hi'), saved on the member's profile so it follows them across devices.
alter table public.profiles add column language text not null default 'en' check (language in ('en', 'hi'));
-- self-editable like the other personal columns (RLS still limits updates to the member's own row)
grant update (language) on public.profiles to authenticated;
