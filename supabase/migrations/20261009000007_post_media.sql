-- Photos attached to feed posts (compressed on the phone; files live under "<user id>/...").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 3 * 1024 * 1024, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy "upload own post media" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_verified());
create policy "delete own post media" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Post media entries must point into the author's own folder.
alter table public.posts add constraint posts_media_paths check (
  not jsonb_path_exists(media, '$[*] ? (!(@.path starts with $p))', jsonb_build_object('p', author_id::text || '/'))
);

