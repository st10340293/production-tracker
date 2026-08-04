-- ============================================================
-- Production Tracker — Supabase schema + Row Level Security
-- Run in Supabase SQL editor, in order, once per project.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------------- Tables ----------------

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles(id) on delete cascade,
  title          text not null,
  description    text,
  item_singular  text not null default 'Item',
  item_plural    text not null default 'Items',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null check (role in ('owner','editor','viewer')),
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists stages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  stage_name   text not null,
  stage_order  int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  assignee    text,
  due_date    date,
  notes       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists item_progress (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references items(id) on delete cascade,
  stage_id      uuid not null references stages(id) on delete cascade,
  completed     boolean not null default false,
  completed_at  timestamptz,
  unique (item_id, stage_id)
);

-- ---------------- Helper functions (security definer -> avoid RLS recursion) ----------------

create or replace function is_project_member(p_project_id uuid, p_user_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = p_user_id
  );
$$;

create or replace function project_role(p_project_id uuid, p_user_id uuid)
returns text language sql security definer stable as $$
  select role from project_members
  where project_id = p_project_id and user_id = p_user_id
  limit 1;
$$;

create or replace function is_project_owner(p_project_id uuid, p_user_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects where id = p_project_id and owner_id = p_user_id
  );
$$;

-- ---------------- RLS ----------------

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table stages enable row level security;
alter table items enable row level security;
alter table item_progress enable row level security;

-- profiles: anyone signed in can read (needed to resolve assignee/member emails);
-- a user can only edit their own row.
create policy "profiles_select_authenticated" on profiles for select
  using (auth.role() = 'authenticated');
create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());
create policy "profiles_insert_own" on profiles for insert
  with check (id = auth.uid());

-- projects: visible to members; created by the signed-in user (becomes owner);
-- only the owner may update core fields or delete.
create policy "projects_select_member" on projects for select
  using (is_project_member(id, auth.uid()));
create policy "projects_insert_own" on projects for insert
  with check (owner_id = auth.uid());
create policy "projects_update_owner_or_editor" on projects for update
  using (project_role(id, auth.uid()) in ('owner','editor'));
create policy "projects_delete_owner" on projects for delete
  using (owner_id = auth.uid());

-- project_members: members can see the roster; only the owner manages membership.
create policy "members_select_member" on project_members for select
  using (is_project_member(project_id, auth.uid()));
create policy "members_insert_owner" on project_members for insert
  with check (is_project_owner(project_id, auth.uid()));
create policy "members_update_owner" on project_members for update
  using (is_project_owner(project_id, auth.uid()));
create policy "members_delete_owner" on project_members for delete
  using (is_project_owner(project_id, auth.uid()));

-- stages: readable by all members, writable by owner/editor.
create policy "stages_select_member" on stages for select
  using (is_project_member(project_id, auth.uid()));
create policy "stages_write_owner_editor" on stages for insert
  with check (project_role(project_id, auth.uid()) in ('owner','editor'));
create policy "stages_update_owner_editor" on stages for update
  using (project_role(project_id, auth.uid()) in ('owner','editor'));
create policy "stages_delete_owner_editor" on stages for delete
  using (project_role(project_id, auth.uid()) in ('owner','editor'));

-- items: readable by all members, writable by owner/editor. viewers are read-only.
create policy "items_select_member" on items for select
  using (is_project_member(project_id, auth.uid()));
create policy "items_insert_owner_editor" on items for insert
  with check (project_role(project_id, auth.uid()) in ('owner','editor'));
create policy "items_update_owner_editor" on items for update
  using (project_role(project_id, auth.uid()) in ('owner','editor'));
create policy "items_delete_owner_editor" on items for delete
  using (project_role(project_id, auth.uid()) in ('owner','editor'));

-- item_progress: same rule, checked via the parent item's project.
create policy "progress_select_member" on item_progress for select
  using (is_project_member(
    (select project_id from items where id = item_id), auth.uid()
  ));
create policy "progress_write_owner_editor" on item_progress for insert
  with check (project_role(
    (select project_id from items where id = item_id), auth.uid()
  ) in ('owner','editor'));
create policy "progress_update_owner_editor" on item_progress for update
  using (project_role(
    (select project_id from items where id = item_id), auth.uid()
  ) in ('owner','editor'));
create policy "progress_delete_owner_editor" on item_progress for delete
  using (project_role(
    (select project_id from items where id = item_id), auth.uid()
  ) in ('owner','editor'));

-- ---------------- Auto-create profile row on signup ----------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
