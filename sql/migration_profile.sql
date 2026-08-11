-- ============================================================
-- Migration: profile management (avatar, name, email, password)
-- Run once in Supabase SQL editor, after schema.sql.
-- ============================================================

alter table profiles add column if not exists avatar_url text;

-- Public bucket: profile pictures aren't sensitive, and serving them via the
-- public URL endpoint avoids needing a signed-URL round trip just to show
-- someone's avatar next to their name.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Path convention: {user_id}/{filename} — everyone can read (public bucket,
-- served straight from the public endpoint, no RLS check on that path), but
-- only the owner of that folder can write/replace/delete their own avatar.
create policy "avatar_objects_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_objects_update_own" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_objects_delete_own" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
