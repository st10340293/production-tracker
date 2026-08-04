-- ============================================================
-- Migration: activity log
-- Run once in Supabase SQL editor, after schema.sql (and, if you
-- installed it, after migration_pending_invites.sql — order between
-- the two doesn't matter to each other).
-- ============================================================

create table if not exists activity (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  actor_id     uuid references profiles(id),
  action       text not null,   -- item_created / item_deleted / item_renamed / stage_completed /
                                  -- stage_uncompleted / stage_added / stage_renamed / stage_removed /
                                  -- member_added / member_removed
  item_name    text,
  stage_name   text,
  detail       text,
  created_at   timestamptz not null default now()
);

alter table activity enable row level security;

create policy "activity_select_member" on activity for select
  using (is_project_member(project_id, auth.uid()));
-- no insert/update/delete policy for regular clients — only the trigger
-- functions below (security definer, owned by postgres) write to this table.

-- ---------------- items ----------------

create or replace function log_item_activity()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into activity (project_id, actor_id, action, item_name)
    values (new.project_id, auth.uid(), 'item_created', new.name);
  elsif tg_op = 'DELETE' then
    insert into activity (project_id, actor_id, action, item_name)
    values (old.project_id, auth.uid(), 'item_deleted', old.name);
  elsif tg_op = 'UPDATE' and new.name is distinct from old.name then
    insert into activity (project_id, actor_id, action, item_name, detail)
    values (new.project_id, auth.uid(), 'item_renamed', new.name, 'from "' || old.name || '"');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_item_activity on items;
create trigger trg_log_item_activity
  after insert or update or delete on items
  for each row execute function log_item_activity();

-- ---------------- item_progress (stage toggles) ----------------

create or replace function log_progress_activity()
returns trigger language plpgsql security definer as $$
declare
  v_project_id uuid;
  v_item_name  text;
  v_stage_name text;
begin
  select project_id, name into v_project_id, v_item_name from items where id = new.item_id;
  select stage_name into v_stage_name from stages where id = new.stage_id;

  if tg_op = 'INSERT' and new.completed = true then
    insert into activity (project_id, actor_id, action, item_name, stage_name)
    values (v_project_id, auth.uid(), 'stage_completed', v_item_name, v_stage_name);
  elsif tg_op = 'UPDATE' and new.completed is distinct from old.completed then
    insert into activity (project_id, actor_id, action, item_name, stage_name)
    values (v_project_id, auth.uid(), case when new.completed then 'stage_completed' else 'stage_uncompleted' end, v_item_name, v_stage_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_progress_activity on item_progress;
create trigger trg_log_progress_activity
  after insert or update on item_progress
  for each row execute function log_progress_activity();

-- ---------------- stages ----------------

create or replace function log_stage_activity()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into activity (project_id, actor_id, action, stage_name)
    values (new.project_id, auth.uid(), 'stage_added', new.stage_name);
  elsif tg_op = 'DELETE' then
    insert into activity (project_id, actor_id, action, stage_name)
    values (old.project_id, auth.uid(), 'stage_removed', old.stage_name);
  elsif tg_op = 'UPDATE' and new.stage_name is distinct from old.stage_name then
    insert into activity (project_id, actor_id, action, stage_name, detail)
    values (new.project_id, auth.uid(), 'stage_renamed', new.stage_name, 'from "' || old.stage_name || '"');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_stage_activity on stages;
create trigger trg_log_stage_activity
  after insert or update or delete on stages
  for each row execute function log_stage_activity();

-- ---------------- project_members ----------------

create or replace function log_member_activity()
returns trigger language plpgsql security definer as $$
declare
  v_email text;
begin
  if tg_op = 'INSERT' then
    select email into v_email from profiles where id = new.user_id;
    insert into activity (project_id, actor_id, action, detail)
    values (new.project_id, auth.uid(), 'member_added', coalesce(v_email, new.user_id::text) || ' (' || new.role || ')');
  elsif tg_op = 'DELETE' then
    select email into v_email from profiles where id = old.user_id;
    insert into activity (project_id, actor_id, action, detail)
    values (old.project_id, auth.uid(), 'member_removed', coalesce(v_email, old.user_id::text));
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_member_activity on project_members;
create trigger trg_log_member_activity
  after insert or delete on project_members
  for each row execute function log_member_activity();
