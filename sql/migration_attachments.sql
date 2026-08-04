-- ============================================================
-- Migration: file / link attachments per item
-- Run once in Supabase SQL editor, after schema.sql.
-- ============================================================

create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  kind         text not null check (kind in ('file','link')),
  file_path    text,   -- storage object path, set when kind = 'file'
  url          text,   -- external link, set when kind = 'link'
  label        text not null,   -- filename, or a short label for a link
  mime_type    text,
  size_bytes   bigint,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  constraint attachment_payload check (
    (kind = 'file' and file_path is not null) or
    (kind = 'link' and url is not null)
  )
);

alter table attachments enable row level security;

create policy "attachments_select_member" on attachments for select
  using (is_project_member(project_id, auth.uid()));
create policy "attachments_insert_owner_editor" on attachments for insert
  with check (project_role(project_id, auth.uid()) in ('owner','editor'));
create policy "attachments_delete_owner_editor" on attachments for delete
  using (project_role(project_id, auth.uid()) in ('owner','editor'));

-- ---------------- Storage bucket ----------------
-- private bucket; objects are only ever reached through signed URLs the
-- client requests after an RLS-checked read of the `attachments` table.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Object paths follow the convention: {project_id}/{item_id}/{filename}
-- storage.foldername(name) splits the path into an array of folder segments,
-- so foldername(name)[1] is the project_id for every object in this bucket.

create policy "attachment_objects_select_member" on storage.objects for select
  using (
    bucket_id = 'attachments'
    and is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy "attachment_objects_insert_owner_editor" on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and project_role((storage.foldername(name))[1]::uuid, auth.uid()) in ('owner','editor')
  );

create policy "attachment_objects_delete_owner_editor" on storage.objects for delete
  using (
    bucket_id = 'attachments'
    and project_role((storage.foldername(name))[1]::uuid, auth.uid()) in ('owner','editor')
  );
