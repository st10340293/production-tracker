-- ============================================================
-- Migration: comments per item
-- Run once in Supabase SQL editor, after schema.sql and
-- migration_activity_log.sql (comment posts get logged to activity too).
-- ============================================================

create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  author_id    uuid references profiles(id),
  body         text not null,
  created_at   timestamptz not null default now()
);

alter table comments enable row level security;

create policy "comments_select_member" on comments for select
  using (is_project_member(project_id, auth.uid()));
create policy "comments_insert_owner_editor" on comments for insert
  with check (project_role(project_id, auth.uid()) in ('owner','editor'));
-- delete: the author can remove their own comment; owner/editor can moderate any.
create policy "comments_delete_own_or_owner_editor" on comments for delete
  using (
    author_id = auth.uid()
    or project_role(project_id, auth.uid()) in ('owner','editor')
  );

-- log to the activity feed too, same pattern as items/stages/members —
-- exception-guarded from the start against the project-deletion FK race
-- documented in migration_fix_activity_delete_fk.sql.
create or replace function log_comment_activity()
returns trigger language plpgsql security definer as $$
declare
  v_item_name text;
begin
  select name into v_item_name from items where id = new.item_id;
  insert into activity (project_id, actor_id, action, item_name)
  values (new.project_id, auth.uid(), 'comment_added', v_item_name);
  return new;
exception
  when foreign_key_violation then
    return new;
end;
$$;

drop trigger if exists trg_log_comment_activity on comments;
create trigger trg_log_comment_activity
  after insert on comments
  for each row execute function log_comment_activity();
